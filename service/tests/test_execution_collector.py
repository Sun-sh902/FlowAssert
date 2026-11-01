"""Receipt authenticity, execution accounting, durable admission and HTTP reads."""
import copy
import hashlib
import sys
import time

import pytest
from fastapi.testclient import TestClient

from app.execution_collector import ExecutionCollector
from app.history_api import create_history_app
from app.history_security import HistoryError
from app.history_store import ArchiveStore
from app.identity import load_evaluator
from archive_cli import configure_ephemeral_key


@pytest.fixture
def setup_execution(tmp_path):
    state = tmp_path / 'state'
    configure_ephemeral_key(state)
    store = ArchiveStore(state)
    store.initialize()
    hid = store.seed()['history_ids'][0]
    with store.connection() as db:
        candidate, _ = store._read(db, hid)
    return store, candidate, ExecutionCollector(state)


def attach(candidate, collected):
    candidate = copy.deepcopy(candidate)
    candidate['execution_context'] = collected.context
    candidate['evidence_receipt'] = collected.receipt
    return candidate


def test_collector_archive_and_http_survive_reopen_and_reject_replay(setup_execution, tmp_path):
    store, original, collector = setup_execution
    cwd = tmp_path / 'working'
    cwd.mkdir()
    evidence = original['bundle']['input']
    execution = collector.collect(load_evaluator(), evidence, cwd)
    assert execution.context['verifier_work_completed'] is True
    assert execution.context['execution_cwd_sha256'] == hashlib.sha256(str(cwd.resolve()).encode()).hexdigest()
    assert execution.result == original['bundle']['raw']
    candidate = attach(original, execution)
    hid = store.publish(candidate, current_execution_context=execution.context)
    reopened = ArchiveStore(store.directory)
    with pytest.raises(HistoryError, match='execution_receipt_replayed'):
        reopened.publish(candidate, current_execution_context=execution.context)
    with TestClient(create_history_app(store.directory), base_url='http://127.0.0.1:8765') as client:
        response = client.get('/api/v1/history/verifications/' + hid)
        assert response.status_code == 200, response.text
        detail = response.json()
        assert detail['capture_status'] == 'CAPTURED_COMPLETE'
        assert detail['admission_status'] == 'ADMITTED_RUN_BOUND'
        assert detail['run_bound_metadata']['run_id'] == execution.context['run_id']
        response = client.get('/api/v1/history/verifications')
        assert response.status_code == 200, response.text
        row = next(item for item in response.json()['items'] if item['history_id'] == hid)
        assert row['admission_status'] == 'ADMITTED_RUN_BOUND'


def test_reject_cross_run_directory_and_tampering(setup_execution, tmp_path):
    store, original, collector = setup_execution
    first_dir, other_dir = tmp_path / 'first', tmp_path / 'other'
    first_dir.mkdir(); other_dir.mkdir()
    first = collector.collect(load_evaluator(), original['bundle']['input'], first_dir)
    other = collector.collect(load_evaluator(), original['bundle']['input'], other_dir)
    same_directory_next = collector.collect(load_evaluator(), original['bundle']['input'], first_dir)
    candidate = attach(original, first)
    with pytest.raises(HistoryError):
        store.publish(candidate, current_execution_context=other.context)
    with pytest.raises(HistoryError):
        store.publish(candidate, current_execution_context=same_directory_next.context)
    forged = copy.deepcopy(candidate)
    forged['execution_context']['execution_cwd_sha256'] = other.context['execution_cwd_sha256']
    forged['evidence_receipt']['execution_cwd_sha256'] = other.context['execution_cwd_sha256']
    with pytest.raises(HistoryError):
        store.publish(forged, current_execution_context=forged['execution_context'])
    forged = copy.deepcopy(candidate)
    forged['execution_context']['run_id'] = other.context['run_id']
    forged['evidence_receipt']['run_id'] = other.context['run_id']
    with pytest.raises(HistoryError):
        store.publish(forged, current_execution_context=forged['execution_context'])


def test_exception_timeout_and_tracked_subprocess_fail_closed(setup_execution, tmp_path):
    store, original, collector = setup_execution
    cwd = tmp_path / 'work'; cwd.mkdir()
    evidence = original['bundle']['input']

    def crash(_evidence):
        raise ValueError('evaluator failure')

    def hangs(_evidence):
        time.sleep(3)

    def child_fails(_evidence, harness):
        harness.run([sys.executable, '-c', 'raise SystemExit(2)'])
        return load_evaluator()(_evidence)

    for evaluator, timeout, capture in [(crash, 2, 'CAPTURE_INCOMPLETE'),
                                         (hangs, 0.1, 'CAPTURE_INCOMPLETE'),
                                         (child_fails, 2, 'CAPTURE_SUBPROCESS_FAILED')]:
        execution = collector.collect(evaluator, evidence, cwd, timeout=timeout)
        assert not execution.context['verifier_work_completed']
        assert execution.context['outer_exit_status'] != 0 or execution.context['subprocess_failures'] > 0
        candidate = attach(original, execution)
        assert store.admission(candidate) == {'capture_status': capture, 'admission_status': 'REJECTED_INCOMPLETE_EXECUTION'}
        with pytest.raises(HistoryError, match='rejected_incomplete_execution'):
            store.publish(candidate, current_execution_context=execution.context)
        attempt = store.directory / 'failed-executions' / (execution.context['run_id'] + '.json')
        assert attempt.exists()
        import json
        recorded = json.loads(attempt.read_bytes())
        assert recorded == {'execution_context': execution.context, 'evidence_receipt': execution.receipt}


def test_subprocess_command_nonzero_records_failure(setup_execution, tmp_path):
    store, original, collector = setup_execution
    execution = collector.collect([sys.executable, '-c', 'raise SystemExit(7)'],
                                  original['bundle']['input'], tmp_path)
    assert execution.context['outer_exit_status'] == 7
    assert execution.context['subprocess_failures'] == 1
    assert not execution.context['verifier_work_completed']
    assert (store.directory / 'failed-executions' / (execution.context['run_id'] + '.json')).exists()
