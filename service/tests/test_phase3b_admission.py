"""Run-bound admission and Finder metadata regression tests."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

from app.history_security import HistoryError
from app.history_store import ArchiveStore, evaluate_admission, validate_candidate
from archive_cli import configure_ephemeral_key


@pytest.fixture
def archived_candidate(tmp_path):
    state = tmp_path / 'state'
    configure_ephemeral_key(state)
    store = ArchiveStore(state)
    store.initialize()
    history_id = store.seed()['history_ids'][0]
    with store.connection() as db:
        candidate, _ = store._read(db, history_id)
    return store, history_id, candidate


@pytest.fixture
def run_bound(archived_candidate):
    candidate = copy.deepcopy(archived_candidate[2])
    run = candidate['bundle']['run']
    candidate['execution_context'] = {
        'run_id': run['identity']['id'],
        'execution_cwd_sha256': 'a' * 64,
        'source_basis_sha256': run['result']['source_basis_sha256'],
        'rule_basis_sha256': run['result']['rule_basis_sha256'],
        'started_mono_ns': 100,
        'completed_mono_ns': 200,
        'verifier_work_completed': True,
        'outer_exit_status': 0,
        'subprocess_failures': 0,
    }
    candidate['evidence_receipt'] = {
        'run_id': run['identity']['id'],
        'execution_cwd_sha256': 'a' * 64,
    }
    return candidate


def test_self_reported_complete_capture_cannot_be_admitted(archived_candidate, run_bound):
    store, _, _ = archived_candidate
    assert evaluate_admission(run_bound) == {
        'capture_status': 'CAPTURE_INCOMPLETE', 'admission_status': 'REJECTED_INCOMPLETE_EXECUTION'
    }
    with pytest.raises(HistoryError) as exc:
        validate_candidate(run_bound, replay=True)
    assert exc.value.code == 'rejected_incomplete_execution'
    with pytest.raises(HistoryError) as exc:
        store.publish(run_bound, current_execution_context=run_bound['execution_context'])
    assert exc.value.code == 'rejected_incomplete_execution'


@pytest.mark.parametrize('started,completed', [(300, 400), (100, 200)])
def test_old_receipt_same_verification_and_directory_never_admitted(archived_candidate, run_bound, started, completed):
    store, _, _ = archived_candidate
    # Preserve the original receipt while the candidate and independently
    # supplied current context are replaced with the next execution's data.
    # The identical-times case also covers replay of the entire old pair.
    current = copy.deepcopy(run_bound['execution_context'])
    current.update(started_mono_ns=started, completed_mono_ns=completed)
    run_bound['execution_context'] = copy.deepcopy(current)
    assert evaluate_admission(run_bound, current) == {
        'capture_status': 'CAPTURE_INCOMPLETE', 'admission_status': 'REJECTED_INCOMPLETE_EXECUTION'
    }
    with pytest.raises(HistoryError) as exc:
        store.publish(run_bound, current_execution_context=current)
    assert exc.value.code == 'rejected_incomplete_execution'


@pytest.mark.parametrize('field,value', [('run_id', 'stale-run'), ('execution_cwd_sha256', 'b' * 64)])
def test_stale_receipt_is_rejected(run_bound, field, value):
    run_bound['evidence_receipt'][field] = value
    assert evaluate_admission(run_bound) == {
        'capture_status': 'CAPTURE_STALE_REJECTED', 'admission_status': 'REJECTED_STALE_RECEIPT'
    }
    with pytest.raises(HistoryError):
        validate_candidate(run_bound, replay=True)


@pytest.mark.parametrize('field,value', [('run_id', 'new-run'), ('execution_cwd_sha256', 'b' * 64)])
def test_old_candidate_and_receipt_cannot_replay_into_new_execution(archived_candidate, run_bound, field, value):
    store, _, _ = archived_candidate
    current = copy.deepcopy(run_bound['execution_context'])
    current[field] = value
    assert evaluate_admission(run_bound, current) == {
        'capture_status': 'CAPTURE_STALE_REJECTED', 'admission_status': 'REJECTED_STALE_RECEIPT'
    }
    with pytest.raises(HistoryError):
        store.publish(run_bound, current_execution_context=current)
    with pytest.raises(HistoryError):
        store.publish(run_bound)


@pytest.mark.parametrize('field,value,capture', [
    ('verifier_work_completed', False, 'CAPTURE_INCOMPLETE'),
    ('subprocess_failures', 1, 'CAPTURE_SUBPROCESS_FAILED'),
    ('outer_exit_status', 1, 'CAPTURE_INCOMPLETE'),
    ('outer_exit_status', None, 'CAPTURE_INCOMPLETE'),
    ('completed_mono_ns', 99, 'CAPTURE_INCOMPLETE'),
])
def test_incomplete_or_failed_execution_cannot_be_admitted(run_bound, field, value, capture):
    run_bound['execution_context'][field] = value
    assert evaluate_admission(run_bound) == {
        'capture_status': capture, 'admission_status': 'REJECTED_INCOMPLETE_EXECUTION'
    }
    with pytest.raises(HistoryError):
        validate_candidate(run_bound, replay=True)


@pytest.mark.parametrize('field,value', [
    ('run_id', 'another-run'),
    ('source_basis_sha256', 'b' * 64),
    ('rule_basis_sha256', 'b' * 64),
])
def test_execution_identity_must_bind_to_candidate(run_bound, field, value):
    run_bound['execution_context'][field] = value
    if field == 'run_id':
        run_bound['evidence_receipt']['run_id'] = value
    status = evaluate_admission(run_bound)
    assert status['admission_status'] == 'REJECTED_BINDING_MISMATCH'
    with pytest.raises(HistoryError):
        validate_candidate(run_bound, replay=True)


def test_legacy_archive_remains_readable_without_phase3b_metadata(archived_candidate):
    store, hid, candidate = archived_candidate
    assert 'execution_context' not in candidate and 'evidence_receipt' not in candidate
    assert evaluate_admission(candidate) == {
        'capture_status': 'CAPTURE_NOT_IMPLEMENTED', 'admission_status': 'ADMISSION_NOT_IMPLEMENTED'
    }
    validate_candidate(candidate, replay=True)
    with store.connection() as db:
        restored, _ = store._read(db, hid)
    assert restored == candidate
    assert store.detail(hid)['run'] == candidate['bundle']['run']


def test_lookup_preparation_ignores_finder_metadata(tmp_path, monkeypatch):
    script = Path(__file__).resolve().parents[2] / 'ui/scripts/phase3a/prepare_lookup_runtime.py'
    spec = importlib.util.spec_from_file_location('lookup_runtime_test', script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    source = tmp_path / 'source'
    venv = source / '.venv'
    (venv / 'lib').mkdir(parents=True)
    (venv / 'lib' / 'module.py').write_text('value = 1\n')
    original_tree = module.tree(str(venv))
    (venv / '.DS_Store').write_bytes(b'finder metadata')
    (venv / 'lib' / '._module.py').write_bytes(b'appledouble')
    (venv / '.AppleDouble').mkdir()
    (venv / '.AppleDouble' / 'metadata').write_bytes(b'irrelevant')
    assert module.tree(str(venv)) == original_tree

    contract = source / 'contracts/openapi-id-addressability-v1.yaml'
    contract.parent.mkdir(parents=True)
    contract.write_text('fixture contract\n')
    digest = hashlib.sha256(contract.read_bytes()).hexdigest()
    mapping = {'contracts/openapi-id-addressability-v1.yaml': digest}
    source_hash = hashlib.sha256(json.dumps(mapping, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()).hexdigest()
    ids = source / 'handoff/evidence/source-identities.json'
    ids.parent.mkdir(parents=True)
    ids.write_text(json.dumps({'files': mapping, 'backend_source_sha256': source_hash}))
    runtime = tmp_path / 'runtime'
    destination = runtime / 'service'
    output = tmp_path / 'runtime-manifest.json'
    for name, value in {
        'SERVICE': str(source), 'RUNTIME': str(runtime), 'DST': str(destination),
        'OUT': str(output), 'HANDOFF': 'handoff', 'HELPERS': [],
        'PINNED': {'backend_source_sha256': source_hash, 'contracts/openapi-id-addressability-v1.yaml': digest},
    }.items():
        monkeypatch.setattr(module, name, value)
    with pytest.raises(SystemExit) as exit_info:
        module.main()
    assert exit_info.value.code == 0
    report = json.loads(output.read_text())
    assert report['problems'] == [] and report['venv']['identical']
    assert not (destination / '.venv/.DS_Store').exists()
    assert not (destination / '.venv/lib/._module.py').exists()
    assert not (destination / '.venv/.AppleDouble').exists()
    assert module.tree(str(destination / '.venv')) == original_tree
