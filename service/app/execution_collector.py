"""Issue authenticated execution receipts for isolated local evaluator runs.

This is a local trust boundary, not an OS sandbox: the evaluator must be trusted
code, and only subprocesses launched through the supplied harness are counted.
The collector signs receipts in the parent process after the worker exits.
"""
from dataclasses import dataclass
import hashlib
import hmac
import inspect
import json
import multiprocessing
import os
from pathlib import Path
import signal
import subprocess
import time
from uuid import uuid4

from .identity import canonical
from .history_security import private_file, signing_key, state_directory


def _digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def _token(key, context, receipt):
    message = {'context': context, 'receipt': {k: v for k, v in receipt.items() if k != 'token'}}
    return hmac.new(key, b'flowassert-execution-v1\0' + canonical(message), hashlib.sha256).hexdigest()


def verify_receipt(key, context, receipt):
    try:
        token = receipt['token']
        return isinstance(token, str) and hmac.compare_digest(token, _token(key, context, receipt))
    except (KeyError, TypeError, ValueError):
        return False


class SubprocessHarness:
    """Explicit subprocess accounting; pass this to evaluators that launch children."""
    def __init__(self):
        self.failures = 0

    def run(self, args, **kwargs):
        # Even caught launch/time-out errors count as failures.
        try:
            result = subprocess.run(args, **kwargs)
        except BaseException:
            self.failures += 1
            raise
        if result.returncode:
            self.failures += 1
        return result


def _worker(connection, evaluator, evidence, cwd):
    harness = SubprocessHarness()
    try:
        os.setsid()
        os.chdir(cwd)
        if callable(evaluator):
            # Existing one-argument evaluators remain directly usable.
            signature = inspect.signature(evaluator)
            try:
                signature.bind(evidence, harness)
            except TypeError:
                result = evaluator(evidence)
            else:
                result = evaluator(evidence, harness)
        else:
            completed = harness.run(evaluator, input=canonical(evidence), capture_output=True)
            if completed.returncode:
                connection.send((False, completed.returncode, harness.failures, None))
                return
            result = json.loads(completed.stdout)
        # Ensure that no unserialisable result is authenticated.
        canonical(result)
        connection.send((True, 0, harness.failures, result))
    except BaseException:
        try:
            connection.send((False, 1, harness.failures, None))
        except (BrokenPipeError, EOFError, OSError):
            pass
    finally:
        connection.close()


@dataclass(frozen=True)
class CollectedExecution:
    context: dict
    receipt: dict
    result: object


class ExecutionCollector:
    def __init__(self, directory):
        self.directory = Path(directory)

    def collect(self, evaluator, evidence, cwd, *, timeout=30):
        """Execute with canonical evidence and return a signed receipt even on failure.

        ``evidence`` is the real evaluator input with ``source`` and ``policy``
        artifacts. Commands receive that canonical JSON on stdin and return JSON
        on stdout. A timeout kills the worker's process group.
        """
        cwd = Path(cwd).resolve(strict=True)
        if not cwd.is_dir():
            raise ValueError('execution working directory must be a directory')
        if not isinstance(evidence, dict) or 'source' not in evidence or 'policy' not in evidence:
            raise ValueError('source and policy input artifacts are required')
        if not isinstance(timeout, (int, float)) or timeout <= 0:
            raise ValueError('timeout must be positive')
        # Detach caller-owned mutable data and hash exactly the values sent to the worker.
        evidence = json.loads(canonical(evidence))
        key = signing_key(state_directory(self.directory))
        run_id = uuid4().hex
        started = time.monotonic_ns()
        completed, status, failures, result = False, 1, 0, None
        parent, child = multiprocessing.get_context('fork').Pipe(duplex=False)
        process = multiprocessing.get_context('fork').Process(target=_worker, args=(child, evaluator, evidence, str(cwd)))
        try:
            process.start()
            child.close()
            if parent.poll(timeout):
                try:
                    completed, status, failures, result = parent.recv()
                except (EOFError, OSError):
                    pass
                process.join(timeout=1)
            if process.is_alive():
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    process.kill()
                process.join()
                completed, status = False, 1
            elif process.exitcode != 0:
                completed, status = False, process.exitcode or 1
        except (OSError, RuntimeError):
            if process.pid is not None and process.is_alive():
                process.kill()
                process.join()
            completed, status = False, 1
        finally:
            parent.close()
            child.close()
        if failures:
            completed = False
        context = {'run_id': run_id, 'execution_cwd_sha256': hashlib.sha256(os.fsencode(str(cwd))).hexdigest(),
                   'source_basis_sha256': _digest(evidence['source']), 'rule_basis_sha256': _digest(evidence['policy']),
                   'started_mono_ns': started, 'completed_mono_ns': time.monotonic_ns(),
                   'verifier_work_completed': completed, 'outer_exit_status': status, 'subprocess_failures': failures}
        receipt = {'run_id': run_id, 'execution_cwd_sha256': context['execution_cwd_sha256'],
                   'input_sha256': _digest(evidence), 'result_sha256': _digest(result) if completed else None}
        receipt['token'] = _token(key, context, receipt)
        if not completed:
            # Failure is evidence of an attempt, not a published verification.
            # Use immutable per-attempt files under the existing private state.
            attempts = state_directory(self.directory / 'failed-executions', create=True)
            private_file(attempts / (run_id + '.json'), create=True,
                         content=canonical({'execution_context': context, 'evidence_receipt': receipt}))
        return CollectedExecution(context, receipt, result)
