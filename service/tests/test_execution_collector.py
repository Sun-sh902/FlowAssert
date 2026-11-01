"""Pinned execution, authenticated run/snapshot bindings and durable admission."""
import copy
import hashlib
import time

import pytest
from fastapi.testclient import TestClient

from app.execution_collector import ExecutionCollector, _token
from app.history_api import create_history_app
from app.history_security import HistoryError, signing_key
from app.history_store import ArchiveStore, evaluate_admission, source_identity, validate_candidate
from app.identity import MODEL_HASH, canonical, digest
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


def test_collector_archive_and_http_survive_reopen_and_reject_replay(setup_execution, tmp_path):
    store, original, collector = setup_execution
    cwd = tmp_path / 'working'
    cwd.mkdir()
    execution = collector.collect(original, cwd)
    assert execution.context['verifier_work_completed'] is True
    assert execution.context['execution_cwd_sha256'] == hashlib.sha256(str(cwd.resolve()).encode()).hexdigest()
    assert execution.receipt['evaluator_sha256'] == MODEL_HASH
    assert execution.result == original['bundle']['raw']
    candidate = execution.candidate
    run = candidate['bundle']['run']
    assert run['identity']['created_at'] == execution.context['service_executed_at']
    assert run['identity']['created_at'] != original['bundle']['run']['identity']['created_at']
    assert run['snapshot_id'] != original['bundle']['run']['snapshot_id']
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
        assert detail['run']['identity']['created_at'] == execution.context['service_executed_at']
        response = client.get('/api/v1/history/verifications')
        assert response.status_code == 200, response.text
        row = next(item for item in response.json()['items'] if item['history_id'] == hid)
        assert row['admission_status'] == 'ADMITTED_RUN_BOUND'


def test_reject_other_run_and_altered_bound_material(setup_execution, tmp_path):
    store, original, collector = setup_execution
    first_dir, other_dir = tmp_path / 'first', tmp_path / 'other'
    first_dir.mkdir(); other_dir.mkdir()
    first = collector.collect(original, first_dir)
    other = collector.collect(original, other_dir)
    candidate = first.candidate
    with pytest.raises(HistoryError):
        store.publish(candidate, current_execution_context=other.context)
    for field, value in [('run_id', other.context['run_id']),
                         ('execution_cwd_sha256', other.context['execution_cwd_sha256']),
                         ('service_executed_at', '2000-01-01T00:00:00Z')]:
        forged = copy.deepcopy(candidate)
        forged['execution_context'][field] = value
        with pytest.raises(HistoryError):
            store.publish(forged, current_execution_context=forged['execution_context'])
    forged = copy.deepcopy(candidate)
    forged['evidence_receipt']['evaluator_sha256'] = 'a' * 64
    with pytest.raises(HistoryError):
        store.publish(forged, current_execution_context=first.context)
    # Recalculate the full unkeyed snapshot after tampering; the signed
    # candidate-content digest must still reject it.
    forged = copy.deepcopy(candidate)
    run = forged['bundle']['run']
    member = forged['snapshot_basis'][run['identity']['id']]['run']
    at = '2000-01-01T00:00:00Z'
    for obj in (run, member):
        obj['identity']['created_at'] = at
        obj['meta']['generated_at'] = at
        obj['evaluation_context']['service_executed_at'] = at
    run['snapshot_id'] = 'snapshot-' + digest(forged['snapshot_basis'])
    with pytest.raises(HistoryError):
        store.publish(forged, current_execution_context=first.context)
    forged = copy.deepcopy(candidate)
    forged['provenance']['implementation_sha256'] = 'a' * 64
    with pytest.raises(HistoryError):
        store.publish(forged, current_execution_context=first.context)
    forged = copy.deepcopy(candidate)
    unrelated = next(k for k in forged['snapshot_basis'] if k != forged['bundle']['run']['identity']['id'])
    forged['snapshot_basis'][unrelated]['run']['identity']['created_at'] = '2000-01-01T00:00:00Z'
    forged['bundle']['run']['snapshot_id'] = 'snapshot-' + digest(forged['snapshot_basis'])
    with pytest.raises(HistoryError):
        store.publish(forged, current_execution_context=first.context)


def test_old_template_gets_current_implementation_provenance(setup_execution, tmp_path):
    store, original, collector = setup_execution
    old = copy.deepcopy(original)
    old['provenance']['implementation_sha256'] = 'a' * 64
    old['provenance']['source_set_sha256'] = 'b' * 64
    execution = collector.collect(old, tmp_path)
    source, source_set = source_identity()
    assert execution.candidate['provenance']['implementation_sha256'] == source['implementation']
    assert execution.candidate['provenance']['source_set_sha256'] == source_set
    store.publish(execution.candidate, current_execution_context=execution.context)


def test_caller_cannot_select_a_static_evaluator(setup_execution, tmp_path):
    _, original, collector = setup_execution
    with pytest.raises(TypeError):
        collector.collect(lambda _evidence: original['bundle']['raw'], original, tmp_path)
    forged = copy.deepcopy(original)
    forged['execution_context'] = {'run_id': 'forged'}
    with pytest.raises(ValueError, match='previous execution receipt'):
        collector.collect(forged, tmp_path)


def test_exception_and_timeout_fail_closed(setup_execution, tmp_path, monkeypatch):
    store, original, collector = setup_execution
    import app.execution_collector as module
    def crash(_evidence):
        raise ValueError('evaluator failure')
    def hangs(_evidence):
        time.sleep(3)
    for evaluator, timeout in [(crash, 2), (hangs, 0.1)]:
        # Simulate internal failure; the public API does not accept executable code.
        monkeypatch.setattr(module, 'load_evaluator', lambda: evaluator)
        execution = collector.collect(original, tmp_path, timeout=timeout)
        assert not execution.context['verifier_work_completed']
        assert execution.context['outer_exit_status'] != 0
        assert execution.candidate is None
        attempt = store.directory / 'failed-executions' / (execution.context['run_id'] + '.json')
        assert attempt.exists()
        import json
        assert json.loads(attempt.read_bytes()) == {'execution_context': execution.context, 'evidence_receipt': execution.receipt}


def test_old_authenticated_receipt_is_read_only_and_unverified(setup_execution):
    store, original, _ = setup_execution
    candidate = copy.deepcopy(original)
    run = candidate['bundle']['run']
    candidate['execution_context'] = {
        'run_id': 'old-run', 'execution_cwd_sha256': 'a' * 64,
        'source_basis_sha256': run['result']['source_basis_sha256'],
        'rule_basis_sha256': run['result']['rule_basis_sha256'],
        'started_mono_ns': 1, 'completed_mono_ns': 2,
        'verifier_work_completed': True, 'outer_exit_status': 0, 'subprocess_failures': 0,
    }
    candidate['evidence_receipt'] = {
        'run_id': 'old-run', 'execution_cwd_sha256': 'a' * 64,
        'input_sha256': digest(candidate['bundle']['input']), 'result_sha256': digest(candidate['bundle']['raw']),
    }
    secret = signing_key(store.directory)
    candidate['evidence_receipt']['token'] = _token(secret, candidate['execution_context'], candidate['evidence_receipt'])
    assert evaluate_admission(candidate, signing_secret=secret, allow_legacy=True) == {
        'capture_status': 'CAPTURE_NOT_IMPLEMENTED', 'admission_status': 'ADMISSION_NOT_IMPLEMENTED'}
    validate_candidate(candidate, signing_secret=secret, allow_legacy=True)
    # Simulate a genuine old published row without changing the schema: create
    # the immutable record in BUILDING state, as the old publisher did.
    with store.connection(write=True) as db:
        old_hid = db.execute("SELECT history_id FROM archives WHERE state='PUBLISHED' ORDER BY sequence LIMIT 1").fetchone()[0]
        old, row = store._read(db, old_hid)
        assert old == original
        raw = canonical(candidate)
        identity = hashlib.sha256(raw).hexdigest()
        hid = 'hist_' + identity
        header = {'history_id': hid, 'archive_id': 'archive_' + identity, 'snapshot_id': 'history-snapshot_' + identity,
                  'verification_id': row['verification_id'], 'original_snapshot_id': row['original_snapshot_id'],
                  'created_at': row['created_at'], 'candidate_sha256': identity}
        inserted = db.execute('INSERT INTO archives(history_id,archive_id,snapshot_id,verification_id,original_snapshot_id,created_at,candidate,candidate_sha256,seal,state) VALUES(?,?,?,?,?,?,?,?,?,?)',
                              (hid, header['archive_id'], header['snapshot_id'], header['verification_id'], header['original_snapshot_id'], header['created_at'], raw, identity, digest(header), 'BUILDING'))
        header['sequence'] = inserted.lastrowid
        db.execute('UPDATE archives SET seal=? WHERE history_id=?', (digest(header), hid))
        db.execute('INSERT INTO records SELECT ?,position,record FROM records WHERE history_id=?', (hid, old_hid))
        db.execute('INSERT INTO evidence SELECT ?,position,reference_id,original_snapshot_id,reference,payload,payload_reason,expected_sha256 FROM evidence WHERE history_id=?', (hid, old_hid))
        db.execute("UPDATE archives SET state='PUBLISHED' WHERE history_id=?", (hid,))
    with TestClient(create_history_app(store.directory), base_url='http://127.0.0.1:8765') as client:
        response = client.get('/api/v1/history/verifications/' + hid)
        assert response.status_code == 200, response.text
        detail = response.json()
        assert detail['admission_status'] == 'ADMISSION_NOT_IMPLEMENTED'
        assert detail['capture_status'] == 'CAPTURE_NOT_IMPLEMENTED'
        assert 'run_bound_metadata' not in detail
        response = client.get('/api/v1/history/verifications')
        assert response.status_code == 200, response.text
        row = next(item for item in response.json()['items'] if item['history_id'] == hid)
        assert row['admission_status'] == 'ADMISSION_NOT_IMPLEMENTED'
        assert 'run_bound_metadata' not in row
    with pytest.raises(HistoryError):
        store.publish(candidate, current_execution_context=candidate['execution_context'])
    candidate['bundle']['input']['source'] = {}
    # The old MAC still authenticates its original receipt, but the normal
    # historical archive validation must not accept altered candidate content.
    with pytest.raises(HistoryError):
        validate_candidate(candidate, signing_secret=secret, allow_legacy=True)


def batch_templates(store):
    with store.connection() as db:
        ids = [row[0] for row in db.execute("SELECT history_id FROM archives WHERE state='PUBLISHED' ORDER BY sequence")]
        return [store._read(db, hid)[0] for hid in ids]


def test_batch_reexecutes_every_case_under_one_snapshot(setup_execution, tmp_path):
    store, _, collector = setup_execution
    templates = batch_templates(store)
    executions = collector.collect_batch(templates, tmp_path)
    assert len({e.context['run_id'] for e in executions}) == 5
    assert all(e.context['verifier_work_completed'] and e.candidate for e in executions)
    assert len({e.candidate['bundle']['run']['snapshot_id'] for e in executions}) == 1
    # Every snapshot member carries this batch's own execution time, not the template's.
    fresh = {e.candidate['bundle']['run']['identity']['id']: e.context['service_executed_at'] for e in executions}
    basis = executions[0].candidate['snapshot_basis']
    assert {k: v['run']['evaluation_context']['service_executed_at'] for k, v in basis.items()} == fresh
    assert not set(fresh.values()) & {t['bundle']['run']['evaluation_context']['service_executed_at'] for t in templates}
    ids = [store.publish(e.candidate, current_execution_context=e.context) for e in executions]
    statuses = [store.detail(hid)['admission_status'] for hid in ids]
    assert statuses == ['ADMITTED_RUN_BOUND'] * 5


def test_batch_requires_every_reviewed_case(setup_execution, tmp_path):
    store, _, collector = setup_execution
    templates = batch_templates(store)
    with pytest.raises(ValueError):
        collector.collect_batch(templates[:4], tmp_path)
    with pytest.raises(ValueError):
        collector.collect_batch(templates[:4] + templates[:1], tmp_path)


def test_batch_with_one_failure_returns_no_candidates(setup_execution, tmp_path, monkeypatch):
    store, _, collector = setup_execution
    templates = batch_templates(store)
    real = collector._execute
    calls = []

    def fail_third(evidence, cwd, timeout):
        calls.append(evidence)
        attempt = real(evidence, cwd, timeout)
        return {**attempt, 'completed': False, 'status': 1, 'result': None, 'executed_at': None} if len(calls) == 3 else attempt

    monkeypatch.setattr(collector, '_execute', fail_third)
    executions = collector.collect_batch(templates, tmp_path)
    assert [e.candidate for e in executions] == [None] * 5
    assert len(list((store.directory / 'failed-executions').iterdir())) == 5
