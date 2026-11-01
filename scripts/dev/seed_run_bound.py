"""Create the synthetic archive state dev-run-bound: dev-single plus one genuinely run-bound evaluation.

    PYTHONPATH=service service/.venv/bin/python -B scripts/dev/seed_run_bound.py STATE_DIR     (called by seed.sh)

Five seeded evaluations, then SPEC-001 evaluated again through the Service's own ExecutionCollector and published with
that run's signed receipt, so the newest SPEC-001 entry is CAPTURED_COMPLETE / ADMITTED_RUN_BOUND by the Service's own
checks, read back over its real HTTP routes by ui/e2e-workspace. Nothing here writes a status: a status the Service does
not compute cannot appear. No service/ file is changed, and the input is the reviewed synthetic fixture: this proves the
frontend wiring only. It is not a capture of anything external.
"""
import copy
import json
import sys
import tempfile
from pathlib import Path

from app.execution_collector import ExecutionCollector
from app.history_store import ArchiveStore
from app.identity import load_evaluator
from archive_cli import configure_ephemeral_key


def main(state):
    configure_ephemeral_key(state)
    store = ArchiveStore(state)
    seeded = store.seed()
    with store.connection() as db:
        candidates = [store._read(db, hid)[0] for hid in seeded['history_ids']]
    original = next(c for c in candidates if c['bundle']['run']['identity']['id'] == 'SPEC-001')
    with tempfile.TemporaryDirectory(dir=Path(state).parent / 'tmp') as cwd:
        execution = ExecutionCollector(state).collect(load_evaluator(), original['bundle']['input'], cwd)
    candidate = copy.deepcopy(original)
    candidate['execution_context'] = execution.context
    candidate['evidence_receipt'] = execution.receipt
    hid = store.publish(candidate, current_execution_context=execution.context)
    print(json.dumps({'run_bound_history_id': hid, 'run_id': execution.context['run_id']}))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
