"""All local endpoints reject rebinding and ambiguous browser authorities."""
import asyncio

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.adapter import Adapter
from app.identity import ServiceError
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


def test_evidence_limit_accepts_ascii_digits_only():
    with TestClient(create_app(), base_url='http://127.0.0.1') as client:
        url = '/api/v1/verifications/SPEC-001/evidence?limit='
        assert client.get(url + '3').status_code == 200
        response = client.get(url + '%D9%A3')  # ARABIC-INDIC DIGIT THREE
        assert response.status_code == 422
        assert response.json()['error']['code'] == 'invalid_parameter'


def test_lookup_without_server_address_is_refused_not_raised(tmp_path):
    state = tmp_path / 'archive'
    configure_ephemeral_key(state)
    ArchiveStore(state).initialize()
    app = create_history_app(state)
    sent = []

    async def receive():
        return {'type': 'http.request', 'body': b'', 'more_body': False}

    async def send(message):
        sent.append(message)

    path = b'/api/v1/verification-lookup'
    asyncio.run(app({'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1', 'method': 'GET',
               'path': path.decode(), 'raw_path': path, 'query_string': b'verification_id=SPEC-001',
               'headers': [(b'host', b'127.0.0.1')], 'server': None, 'client': None, 'scheme': 'http',
               'root_path': '', 'state': {}}, receive, send))
    assert [m['status'] for m in sent if m['type'] == 'http.response.start'] == [403]


@pytest.mark.parametrize('value', [[1], {'source': 1}, {'source': {'rows': 1}}])
def test_adapter_rejects_malformed_input_with_a_service_error(value):
    with pytest.raises(ServiceError) as caught:
        Adapter().evaluate(value)
    assert (caught.value.status, caught.value.code) == (422, 'invalid_json')
