"""Execute only the pinned evaluator and issue locally authenticated receipts.

This is a local trust boundary, not an OS sandbox: the service code and the
pinned evaluator must be trusted. Receipts do not attest external capture.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
import multiprocessing
import os
from pathlib import Path
import signal
import time
from uuid import uuid4

from .identity import ROOT, EXAMPLES_HASH, MODEL_HASH, canonical, check_sources, checked_bytes, digest, load_evaluator
from .history_security import private_file, signing_key, state_directory


def _token(key, context, receipt):
    message = {'context': context, 'receipt': {k: v for k, v in receipt.items() if k != 'token'}}
    return hmac.new(key, b'flowassert-execution-v1\0' + canonical(message), hashlib.sha256).hexdigest()


def verify_receipt(key, context, receipt):
    try:
        token = receipt['token']
        return isinstance(token, str) and hmac.compare_digest(token, _token(key, context, receipt))
    except (KeyError, TypeError, ValueError):
        return False


def _worker(connection, evidence, cwd):
    try:
        os.setsid()
        os.chdir(cwd)
        check_sources()
        evaluator = load_evaluator()
        before = digest(evidence)
        at = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        result = evaluator(evidence)
        if digest(evidence) != before:
            raise ValueError('evaluator modified input')
        check_sources()
        canonical(result)
        connection.send((True, 0, result, at))
    except BaseException:
        try:
            connection.send((False, 1, None, None))
        except (BrokenPipeError, EOFError, OSError):
            pass
    finally:
        connection.close()


def _bind_candidates(templates, outcomes):
    """Construct fresh runs and one shared snapshot from the actual collected outputs."""
    candidates = json.loads(canonical(templates))
    basis = candidates[0]['snapshot_basis']
    for candidate, (result, executed_at) in zip(candidates, outcomes):
        if 'execution_context' in candidate or 'evidence_receipt' in candidate:
            raise ValueError('candidate must not contain a previous execution receipt')
        bundle = candidate['bundle']
        run = bundle['run']
        bundle['raw'] = result
        run['result'] = result
        run['identity']['created_at'] = executed_at
        run['meta']['generated_at'] = executed_at
        run['evaluation_context']['service_executed_at'] = executed_at
        run['snapshot_id'] = 'pending-publication'
        basis[run['identity']['id']] = json.loads(canonical(bundle))
    snapshot_id = 'snapshot-' + digest(basis)
    for candidate in candidates:
        candidate['snapshot_basis'] = basis
        candidate['bundle']['run']['snapshot_id'] = snapshot_id
    return candidates


@dataclass(frozen=True)
class CollectedExecution:
    context: dict
    receipt: dict
    result: object
    candidate: object


class ExecutionCollector:
    def __init__(self, directory):
        self.directory = Path(directory)

    def collect(self, template, cwd, *, timeout=30):
        """Run the pinned evaluator and bind its result to a newly built run.

        The caller supplies a reviewed synthetic candidate as a template; it
        cannot supply executable code. The worker loads checked evaluator bytes.
        A timeout kills the worker's process group. Archive validation remains
        responsible for accepting the template, full snapshot and provenance.
        The other snapshot members are retained from the template, not re-executed.
        """
        return self._collect([template], cwd, timeout)[0]

    def collect_batch(self, templates, cwd, *, timeout=30):
        """Re-execute every reviewed case and bind them to one shared snapshot.

        Exactly one template per reviewed case is required. If any execution
        fails, no candidate is returned for the batch and each attempt is kept.
        """
        cases = json.loads(checked_bytes(ROOT / 'contracts/verification-examples.json', EXAMPLES_HASH))['examples']
        if sorted(t['provenance']['reviewed_case'] for t in templates) != sorted(c['case_id'] for c in cases):
            raise ValueError('a batch needs exactly one template per reviewed case')
        return self._collect(templates, cwd, timeout)

    def _execute(self, evidence, cwd, timeout):
        run_id = uuid4().hex
        started = time.monotonic_ns()
        completed, status, result, executed_at = False, 1, None, None
        parent, child = multiprocessing.get_context('fork').Pipe(duplex=False)
        process = multiprocessing.get_context('fork').Process(target=_worker, args=(child, evidence, str(cwd)))
        try:
            process.start()
            child.close()
            if parent.poll(timeout):
                try:
                    completed, status, result, executed_at = parent.recv()
                except (EOFError, OSError):
                    pass
                process.join(timeout=1)
            if process.is_alive():
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    process.kill()
                process.join()
                completed, status, result, executed_at = False, 1, None, None
            elif process.exitcode != 0:
                completed, status, result, executed_at = False, process.exitcode or 1, None, None
        except (OSError, RuntimeError):
            if process.pid is not None and process.is_alive():
                process.kill()
                process.join()
            completed, status, result, executed_at = False, 1, None, None
        finally:
            parent.close()
            child.close()
        return {'run_id': run_id, 'started': started, 'completed_ns': time.monotonic_ns(), 'completed': completed,
                'status': status, 'result': result, 'executed_at': executed_at}

    def _collect(self, templates, cwd, timeout):
        cwd = Path(cwd).resolve(strict=True)
        if not cwd.is_dir():
            raise ValueError('execution working directory must be a directory')
        templates = json.loads(canonical(templates))
        for template in templates:
            if 'execution_context' in template or 'evidence_receipt' in template:
                raise ValueError('candidate must not contain a previous execution receipt')
            evidence = template['bundle']['input']
            if not isinstance(evidence, dict) or 'source' not in evidence or 'policy' not in evidence:
                raise ValueError('source and policy input artifacts are required')
        if not isinstance(timeout, (int, float)) or timeout <= 0:
            raise ValueError('timeout must be positive')
        # Use the current implementation/source identity, not the provenance of
        # an archived template. Detect source changes across the execution.
        from .history_store import _LOADED_SOURCE_IDENTITY, make_candidate, source_identity
        source_before = source_identity()
        if _LOADED_SOURCE_IDENTITY is None or source_before != _LOADED_SOURCE_IDENTITY:
            raise ValueError('service source identity changed since import')
        cases = json.loads(checked_bytes(ROOT / 'contracts/verification-examples.json', EXAMPLES_HASH))['examples']
        reviewed = []
        for template in templates:
            matches = [case for case in cases if case['case_id'] == template['provenance']['reviewed_case']]
            if len(matches) != 1:
                raise ValueError('unsupported synthetic source')
            reviewed.append(matches[0])
        key = signing_key(state_directory(self.directory))
        attempts = [self._execute(t['bundle']['input'], cwd, timeout) for t in templates]
        if source_identity() != source_before:
            raise ValueError('service source identity changed during execution')
        candidates = [None] * len(templates)
        if all(a['completed'] for a in attempts):
            bound = _bind_candidates(templates, [(a['result'], a['executed_at']) for a in attempts])
            candidates = [make_candidate(c['bundle'], case, c['snapshot_basis']) for c, case in zip(bound, reviewed)]
            if source_identity() != source_before:
                raise ValueError('service source identity changed during candidate construction')
        return [self._seal(key, cwd, t['bundle']['input'], a, c) for t, a, c in zip(templates, attempts, candidates)]

    def _seal(self, key, cwd, evidence, attempt, candidate):
        run_id, completed, result = attempt['run_id'], attempt['completed'], attempt['result']
        context = {'run_id': run_id, 'execution_cwd_sha256': hashlib.sha256(os.fsencode(str(cwd))).hexdigest(),
                   'source_basis_sha256': digest(evidence['source']), 'rule_basis_sha256': digest(evidence['policy']),
                   'started_mono_ns': attempt['started'], 'completed_mono_ns': attempt['completed_ns'],
                   'verifier_work_completed': completed, 'outer_exit_status': attempt['status'], 'subprocess_failures': 0,
                   'service_executed_at': attempt['executed_at']}
        receipt = {'run_id': run_id, 'execution_cwd_sha256': context['execution_cwd_sha256'],
                   'input_sha256': digest(evidence), 'result_sha256': digest(result) if completed else None,
                   'evaluator_sha256': MODEL_HASH,
                   'candidate_content_sha256': digest(candidate) if candidate is not None else None}
        receipt['token'] = _token(key, context, receipt)
        if candidate is None:
            attempts = state_directory(self.directory / 'failed-executions', create=True)
            private_file(attempts / (run_id + '.json'), create=True,
                         content=canonical({'execution_context': context, 'evidence_receipt': receipt}))
        else:
            candidate['execution_context'] = context
            candidate['evidence_receipt'] = receipt
        return CollectedExecution(context, receipt, result, candidate)
