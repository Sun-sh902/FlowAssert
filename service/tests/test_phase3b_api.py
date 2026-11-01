"""The 3B projection is additive; the frozen HTTP contracts remain unchanged."""
from fastapi.testclient import TestClient

from app.admission_serialization import LEGACY_ADMISSION
from app.history_api import create_history_app
from app.history_store import ArchiveStore
from app.validation import schema
from archive_cli import configure_ephemeral_key


def test_legacy_and_phase3b_read_transports(tmp_path):
    state = tmp_path / 'history'
    configure_ephemeral_key(state)
    store = ArchiveStore(state)
    history_id = store.seed()['history_ids'][0]
    with TestClient(create_history_app(state), base_url='http://127.0.0.1:8765') as client:
        live = client.get('/api/v1/verifications/SPEC-001').json()
        schema('VerificationRun', live)
        legacy = client.get('/api/v1/verification-lookup', params={'verification_id': 'SPEC-001'}).json()
        assert legacy == live
        for route, params in [('/api/v1/verifications/SPEC-001', {'phase3b': 'true'}),
                              ('/api/v1/verification-lookup', {'verification_id': 'SPEC-001', 'phase3b': 'true'})]:
            result = client.get(route, params=params)
            assert result.status_code == 200
            assert result.json() == {**live, **LEGACY_ADMISSION}
        assert client.get('/api/v1/verification-lookup', params={'verification_id': 'SPEC-001', 'phase3b': 'bad'}).status_code == 422

        old_detail = client.get('/api/v1/history/' + history_id).json()
        new_detail = client.get('/api/v1/history/verifications/' + history_id).json()
        assert new_detail == {**old_detail, **LEGACY_ADMISSION}
        old_items = client.get('/api/v1/history').json()['items']
        new_items = client.get('/api/v1/history/verifications').json()['items']
        assert new_items == [{**item, **LEGACY_ADMISSION} for item in old_items]
