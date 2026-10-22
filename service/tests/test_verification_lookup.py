"""Additive lookup behavior; real socket evidence is captured separately."""
import base64
import copy
import hashlib
import hmac
import json
from urllib.parse import urlencode

import pytest
from fastapi.testclient import TestClient
from openapi_spec_validator import validate

from app.history_api import create_history_app
from app.identity import ROOT, canonical
from app.lookup_contract import CONTRACT_SHA256
from app.main import create_app
from app.verification_lookup import DETAIL, EVIDENCE, lookup_spec

ALIASES = [('.', 'SPEC-001'), ('..', 'SPEC-002'), ('x/evidence', 'SPEC-005'),
    ('customer/001', 'SPEC-003'), ('SPEC:006', 'SPEC-004'), ('中文', 'SPEC-005'),
    ('🧪' * 128, 'SPEC-001'), ('a?b#c', 'SPEC-002'), ('a+b', 'SPEC-003'),
    ('a%2Fb', 'SPEC-004'), ('x', 'SPEC-002'), ('a/b', 'SPEC-001'),
    ('a b', 'SPEC-005'), ('é', 'SPEC-002'), ('e\u0301', 'SPEC-003'),
    (' leading and trailing ', 'SPEC-004'), ('\x00\t\n\x1f\x7f', 'SPEC-001')]


@pytest.fixture
def client(tmp_path):
    with TestClient(create_history_app(tmp_path / 'history'),
                    base_url='http://127.0.0.1:8765') as c:
        catalog = c.app.state.catalog
        for identity, basis in ALIASES:
            original = catalog._runs[basis]
            bundle = json.loads(original)
            bundle['run']['identity']['id'] = identity
            restored = copy.deepcopy(bundle)
            restored['run']['identity']['id'] = basis
            assert canonical(restored) == original
            data = canonical(bundle)
            catalog._runs[identity] = data
            catalog._seals[identity] = hashlib.sha256(data).hexdigest()
        yield c


def get(client, endpoint, identity, **params):
    return client.get(endpoint + '?' + urlencode({'verification_id': identity, **params}))


def error(response, status, code):
    assert response.status_code == status, response.text
    from app.validation import schema
    schema('Error', response.json())
    assert response.json()['error']['code'] == code
    assert response.headers['cache-control'] == 'no-store'


def legacy_token(catalog, identity):
    raw = canonical({'scope': {'run': identity, 'limit': 1, 'include_payload': True,
        'workspace': 'ws-synthetic-01', 'mode': 'LOCAL_RESEARCH', 'contract': '0.1.1-proposed'},
        'snapshot': catalog.snapshot, 'offset': 1})
    return base64.urlsafe_b64encode(raw).decode().rstrip('=') + '.' + hmac.new(
        catalog._key, raw, hashlib.sha256).hexdigest()


@pytest.mark.parametrize('limit', [1, 2, 100])
@pytest.mark.parametrize('include_payload', [True, False])
def test_exact_query_identity_all_pages(client, limit, include_payload):
    for identity, basis in ALIASES:
        detail = get(client, DETAIL, identity)
        assert detail.status_code == 200, detail.text
        detail = detail.json()
        control = client.get('/api/v1/verifications/' + basis).json()
        assert detail['identity']['id'] == identity
        assert detail['result'] == control['result']
        params = {'snapshot_id': detail['snapshot_id'], 'limit': limit,
                  'include_payload': str(include_payload).lower()}
        items, cursors = [], set()
        while True:
            page = get(client, EVIDENCE, identity, **params)
            assert page.status_code == 200, page.text
            page = page.json()
            assert page['run_id'] == identity
            assert page['page']['snapshot_id'] == detail['snapshot_id']
            items += page['items']
            token = page['page']['next_cursor']
            if token is None:
                break
            assert len(token) <= 2048 and token not in cursors
            cursors.add(token)
            params['cursor'] = token
        assert [item['reference'] for item in items] == detail['evidence_references']
        assert len(items) == 4
        for item in items:
            if include_payload:
                assert hashlib.sha256(canonical(item['payload'])).hexdigest() == item['reference']['sha256']
            else:
                assert item['payload'] is None and item['payload_reason'] == 'omitted_by_request'
    assert len(client.app.state.catalog.adapter.calls) == 5


@pytest.mark.parametrize('endpoint', [DETAIL, EVIDENCE])
def test_strict_query_admission(client, endpoint):
    cases = [('', 422, 'invalid_parameter'), ('verification_id=', 422, 'invalid_parameter'),
        ('verification_id=' + 'a' * 129, 422, 'invalid_parameter'),
        ('verification_id=' + '%F0%9F%A7%AA' * 129, 422, 'invalid_parameter'),
        ('verification_id=%', 400, 'invalid_query'), ('verification_id=%GG', 400, 'invalid_query'),
        ('verification_id=%FF', 400, 'invalid_query'), ('verification_id=%C0%AF', 400, 'invalid_query'),
        ('verification_id=%ED%A0%80', 400, 'invalid_query'),
        ('verification_id=.%26verification_id%3D..&verification_id=..', 400, 'invalid_query'),
        ('verification_id=.&verification%5Fid=..', 400, 'invalid_query'),
        ('verification_id=.&url=http%3A%2F%2Fexample.invalid', 400, 'invalid_query'),
        ('verification_id=.&snapshot_id=x&snapshot_id=y', 400, 'invalid_query'),
        ('verification_id=.&snapshot_id=', 422, 'invalid_parameter'),
        ('verification_id=.&snapshot_id=' + 's' * 129, 422, 'invalid_parameter'),
        ('verification_id=.&trailing', 400, 'invalid_query'),
        ('verification_id=.&', 400, 'invalid_query')]
    for query, status, code in cases:
        error(client.get(endpoint + '?' + query), status, code)


def test_evidence_parameters_and_bindings(client):
    for query, status, code in [
        ('limit=0', 422, 'invalid_parameter'), ('limit=101', 422, 'invalid_parameter'),
        ('limit=%EF%BC%91', 422, 'invalid_parameter'), ('include_payload=1', 422, 'invalid_parameter'),
        ('cursor=', 400, 'invalid_cursor'), ('cursor=bad', 400, 'invalid_cursor'),
        ('cursor=' + 'A' * 2049, 422, 'invalid_parameter'),
        ('limit=1&limit=1', 400, 'invalid_query')]:
        error(client.get(EVIDENCE + '?verification_id=.&' + query), status, code)
    token = get(client, EVIDENCE, 'x/evidence', limit=1).json()['page']['next_cursor']
    for identity in ['x', 'customer/001', '.', '..']:
        error(get(client, EVIDENCE, identity, limit=1, cursor=token), 400, 'cursor_query_conflict')
    for params, status, code in [({'limit': 2}, 400, 'cursor_query_conflict'),
        ({'limit': 1, 'include_payload': 'false'}, 400, 'cursor_query_conflict'),
        ({'limit': 1, 'snapshot_id': 'wrong'}, 409, 'snapshot_conflict')]:
        error(get(client, EVIDENCE, 'x/evidence', cursor=token, **params), status, code)
    error(get(client, DETAIL, '.', snapshot_id='wrong'), 409, 'snapshot_unavailable')
    error(get(client, EVIDENCE, '.', limit=1, cursor=token[:-1] + ('0' if token[-1] != '0' else '1')),
          400, 'invalid_cursor')


def test_legacy_and_path_query_interoperability(client):
    catalog = client.app.state.catalog
    for identity, _ in ALIASES:
        token = legacy_token(catalog, identity)
        response = get(client, EVIDENCE, identity, limit=1, cursor=token)
        if len(token) > 2048:
            error(response, 422, 'invalid_parameter')
        else:
            assert response.status_code == 200, response.text
            assert response.json()['items'][0]['reference']['role'] == 'destination'
    first = client.get('/api/v1/verifications/SPEC-005/evidence?limit=1').json()
    continued = get(client, EVIDENCE, 'SPEC-005', limit=1, cursor=first['page']['next_cursor'])
    assert continued.status_code == 200
    token = continued.json()['page']['next_cursor']
    old = client.get('/api/v1/verifications/SPEC-005/evidence?' + urlencode({'limit': 1, 'cursor': token}))
    assert old.status_code == 200 and old.json()['items'][0]['reference']['role'] == 'policy'


def test_query_form_semantics_and_no_normalization(client):
    assert client.get(DETAIL + '?verification_id=a+b').json()['identity']['id'] == 'a b'
    assert client.get(DETAIL + '?verification_id=a%2Bb').json()['identity']['id'] == 'a+b'
    assert client.get(DETAIL + '?verification_id=a%252Fb').json()['identity']['id'] == 'a%2Fb'
    assert client.get(DETAIL + '?verification_id=a%2Fb').json()['identity']['id'] == 'a/b'
    first = get(client, EVIDENCE, 'é', limit=1).json()
    error(get(client, EVIDENCE, 'e\u0301', limit=1, cursor=first['page']['next_cursor']),
          400, 'cursor_query_conflict')


@pytest.mark.parametrize('method', ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
@pytest.mark.parametrize('endpoint', [DETAIL, EVIDENCE])
def test_read_only(client, endpoint, method):
    response = client.request(method, endpoint + '?verification_id=.')
    assert response.status_code == 405 and response.headers['allow'] == 'GET'
    if method != 'HEAD':
        error(response, 405, 'method_not_allowed')


@pytest.mark.parametrize('endpoint', [DETAIL, EVIDENCE])
def test_security_boundary(client, endpoint):
    target = endpoint + '?verification_id=.'
    error(client.get(target, headers={'Host': 'attacker.invalid'}), 403, 'host_not_allowed')
    error(client.get(target, headers={'Origin': 'https://attacker.invalid'}), 403, 'origin_not_allowed')
    error(client.request('GET', target, content=b'x'), 400, 'unexpected_request_body')
    error(client.get(target + '&cursor=' + 'A' * 4096), 414, 'request_target_too_long')
    error(client.get(endpoint + '/?verification_id=.', follow_redirects=False), 404, 'lookup_route_not_found')
    assert client.get(target, headers={'Origin': 'http://127.0.0.1:5183'}).status_code == 200


def test_real_catalog_absence_is_not_an_alias_or_verdict(tmp_path):
    with TestClient(create_history_app(tmp_path / 'history'), base_url='http://127.0.0.1:8765') as c:
        for identity, _ in ALIASES:
            for endpoint in [DETAIL, EVIDENCE]:
                error(get(c, endpoint, identity), 404, 'run_not_found')


def test_contract_is_additive_and_reuses_exact_schemas(client):
    spec = lookup_spec()
    validate(spec)
    assert hashlib.sha256((ROOT / 'contracts/openapi-id-addressability-v1.yaml').read_bytes()).hexdigest() == CONTRACT_SHA256
    assert spec['components'] == json.loads((ROOT / 'contracts/openapi-v1-proposed.yaml').read_text())['components']
    assert set(spec['paths']) == {DETAIL, EVIDENCE}
    assert client.get('/id-addressability-openapi.json').json() == spec
    assert client.get('/openapi.json').json() == create_app().openapi()
    assert set(client.get('/history-openapi.json').json()['paths']) == {
        '/api/v1/history', '/api/v1/history/{history_id}', '/api/v1/history/{history_id}/evidence'}


def test_spec005_authority_and_fail_closed(client):
    detail = get(client, DETAIL, 'SPEC-005').json()
    result = detail['result']
    assert [r['state'] for r in result['records']] == ['Verified'] * 12
    assert result['cohort_state'] == 'Unverified'
    assert result['source_population_known'] is False and result['expected_total'] is None
    catalog = client.app.state.catalog
    catalog._runs['SPEC-005'] += b' '
    error(get(client, DETAIL, 'SPEC-005'), 503, 'snapshot_content_corrupt')
    error(get(client, EVIDENCE, 'SPEC-005'), 503, 'snapshot_content_corrupt')
