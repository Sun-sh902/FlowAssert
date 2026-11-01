"""All local endpoints reject rebinding and ambiguous browser authorities."""
import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.local_boundary import local_request_error

from app.history_api import create_history_app
from app.history_store import ArchiveStore
from app.main import create_app
from archive_cli import configure_ephemeral_key


@pytest.mark.parametrize('composed', [False, True])
def test_local_authority_and_origin_apply_across_routes(tmp_path, composed):
    routes = ['/api/v1/verifications/SPEC-001',
              '/api/v1/verifications/SPEC-001/evidence', '/openapi.json']
    if composed:
        state = tmp_path / 'archive'
        configure_ephemeral_key(state)
        store = ArchiveStore(state)
        store.initialize()
        hid = store.seed()['history_ids'][0]
        app = create_history_app(state)
        routes += ['/api/v1/history', f'/api/v1/history/{hid}',
                   f'/api/v1/history/{hid}/evidence',
                   '/api/v1/verification-lookup?verification_id=SPEC-001',
                   '/api/v1/verification-evidence?verification_id=SPEC-001',
                   '/history-openapi.json', '/id-addressability-openapi.json']
    else:
        app = create_app()

    with TestClient(app, base_url='http://127.0.0.1:8765') as client:
        for route in routes:
            assert client.get(route).status_code == 200, route
            assert client.get(route, headers={'Origin': 'http://127.0.0.1:5183'}).status_code == 200
            for headers, code in [
                ([('Host', 'attacker.invalid:8765')], 'host_not_allowed'),
                ([('Host', '127.0.0.1:5183')], 'host_not_allowed'),
                ([('Host', '127.0.0.1')], 'host_not_allowed'),
                ([('Host', '127.0.0.1:8765'), ('Host', 'attacker.invalid:8765')], 'host_not_allowed'),
                ([('Origin', 'https://attacker.invalid')], 'origin_not_allowed'),
                ([('Origin', 'null')], 'origin_not_allowed'),
                ([('Origin', 'http://127.0.0.1:5183'), ('Origin', 'https://attacker.invalid')], 'origin_not_allowed'),
            ]:
                response = client.get(route, headers=headers)
                assert response.status_code == 403, (route, headers, response.text)
                assert response.json()['error']['code'] == code
                assert response.headers['cache-control'] == 'no-store'
        # TestClient fills in a missing Host itself, so exercise that ASGI input directly.
        request = Request({'type': 'http', 'headers': [], 'server': ('127.0.0.1', 8765)})
        assert local_request_error(request) == 'host_not_allowed'
