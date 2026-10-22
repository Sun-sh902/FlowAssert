"""P3A-AUD-001: exact identities, usable continuation and legacy HMAC compatibility.

Expectations come from the frozen examples, fixed four-reference inventory and the
documented cursor protocol. Token construction below never calls the SUT encoder.
TestClient exercises the real ASGI handlers; separate captures establish real HTTP
and proxy behavior. Non-shipped identities are sealed in-memory aliases only.
"""
import base64
import copy
import hashlib
import hmac
import json
from contextlib import contextmanager
from datetime import datetime, timezone
from urllib.parse import quote
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.identity import ROOT
from app.main import create_app


API = '/api/v1/verifications/'
CASES = {case['proposed_response']['identity']['id']: case for case in json.loads(
    (ROOT / 'contracts/verification-examples.json').read_text())['examples']}
CORPUS = [
    ('emoji127', '🧪' * 127), ('emoji128', '🧪' * 128),
    ('ascii128', 'A' * 128), ('bmp128', '中' * 128),
    ('mixed128', 'A中🧪é' * 32), ('colon', 'SPEC:001'),
    ('encoded-unicode', 'A 中🧪é'), ('controls', '\x00\t\x1f\x7f'),
    ('nfc', 'é'), ('decomposed', 'e\u0301'),
    *[(name, name) for name in CASES],
]
# This installed TestClient unquotes httpx.URL.path a second time. Literal
# percent-encoded-looking identities therefore use exact Catalog calls here;
# independently recorded real HTTP, rather than this test transport, checks URLs.
DIRECT_IDENTITIES = ['A 中🧪é%2F', '%F0%9F%A7%AA', '%2F', '%252F']
STATIC_SCOPE = {'workspace': 'ws-synthetic-01', 'mode': 'LOCAL_RESEARCH',
                'contract': '0.1.1-proposed'}


def raw_json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=True, allow_nan=False).encode('utf-8')


def sha(value):
    return hashlib.sha256(raw_json(value)).hexdigest()


def sign_raw(raw, key):
    return (base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=') + '.'
            + hmac.new(key, raw, hashlib.sha256).hexdigest())


def sign(value, key):
    return sign_raw(raw_json(value), key)


def unpack(token, key):
    encoded, signature = token.split('.')
    raw = base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4))
    assert hmac.compare_digest(signature, hmac.new(key, raw, hashlib.sha256).hexdigest())
    return json.loads(raw)


def scope(run_id, limit=1, include_payload=True, legacy=False):
    identity = {'run': run_id} if legacy else {'run_sha256': sha({
        'domain': 'flowassert-evidence-run-id-v2', 'run_id': run_id})}
    return {**STATIC_SCOPE, **identity, 'limit': limit, 'include_payload': include_payload}


def token_body(run_id, snapshot, offset=1, limit=1, include_payload=True, legacy=False):
    result = {'scope': scope(run_id, limit, include_payload, legacy),
              'snapshot': snapshot, 'offset': offset}
    if not legacy:
        result['v'] = 2
    return result


def path(run_id, evidence=False):
    return API + quote(run_id, safe='') + ('/evidence' if evidence else '')


def evidence(client, run_id='SPEC-001', **params):
    return client.get(path(run_id, True), params=params)


def error(response, status=400, code='invalid_cursor'):
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {'error'}
    assert body['error']['code'] == code
    assert body['error']['retryable'] is False
    assert body['error']['details'] == []
    assert response.headers['cache-control'] == 'no-store'


@pytest.fixture
def client():
    with TestClient(create_app()) as current:
        yield current


@contextmanager
def alias(catalog, run_id):
    """Only identity.id changes; all evaluator/input/reference bytes stay exact."""
    if run_id in CASES:
        yield
        return
    before_runs, before_seals = dict(catalog._runs), dict(catalog._seals)
    before_snapshot = catalog.snapshot
    original = catalog._runs['SPEC-001']
    bundle = json.loads(original)
    bundle['run']['identity']['id'] = run_id
    restored = copy.deepcopy(bundle)
    restored['run']['identity']['id'] = 'SPEC-001'
    assert raw_json(restored) == original
    sealed = raw_json(bundle)
    catalog._runs[run_id] = sealed
    catalog._seals[run_id] = hashlib.sha256(sealed).hexdigest()
    try:
        yield
        assert catalog._runs[run_id] == sealed
    finally:
        del catalog._runs[run_id]
        del catalog._seals[run_id]
        assert catalog._runs == before_runs and catalog._seals == before_seals
        assert catalog.snapshot == before_snapshot


def expected_items(run_id, include_payload=True):
    case = CASES.get(run_id, CASES['SPEC-001'])
    original = case['input_evidence']
    refs = case['proposed_response']['evidence_references']
    assert [ref['role'] for ref in refs] == ['source', 'destination', 'policy', 'evaluation_input']
    result = []
    for reference in refs:
        payload = original if reference['role'] == 'evaluation_input' else original[reference['role']]
        assert sha(payload) == reference['sha256']
        result.append({'reference': reference, 'payload': payload if include_payload else None,
                       'payload_reason': None if include_payload else 'omitted_by_request'})
    return result


@pytest.mark.parametrize('limit', [1, 2, 100])
@pytest.mark.parametrize('include_payload', [True, False])
def test_exact_unicode_boundary_every_page(client, limit, include_payload):
    catalog = client.app.state.catalog
    for label, run_id in CORPUS:
        with alias(catalog, run_id):
            response = client.get(path(run_id))
            assert response.status_code == 200, (label, response.text)
            detail = response.json()
            assert detail['identity']['id'] == run_id
            expected_case = CASES.get(run_id, CASES['SPEC-001'])
            assert detail['result'] == expected_case['proposed_response']['result']
            expected = expected_items(run_id, include_payload)
            assert detail['evidence_references'] == [item['reference'] for item in expected]
            if run_id == 'SPEC-005':
                assert detail['result']['cohort_state'] == 'Unverified'
                assert detail['result']['source_population_known'] is False
                assert detail['result']['expected_total'] is None
                assert [r['state'] for r in detail['result']['records']] == ['Verified'] * 12
            snapshot = detail['snapshot_id']
            params = {'snapshot_id': snapshot, 'limit': limit,
                      'include_payload': str(include_payload).lower()}
            seen, all_items = set(), []
            while True:
                response = evidence(client, run_id, **params)
                assert response.status_code == 200, (label, response.text)
                page = response.json()
                assert page['run_id'] == run_id and page['page']['snapshot_id'] == snapshot
                assert page['page']['total'] == 4 and page['meta'] == detail['meta']
                all_items += page['items']
                token = page['page']['next_cursor']
                if token is None:
                    break
                assert token not in seen and len(token) <= 2048
                seen.add(token)
                assert unpack(token, catalog._key) == token_body(
                    run_id, snapshot, len(all_items), limit, include_payload)
                params['cursor'] = token
                request = client.build_request('GET', path(run_id, True), params=params)
                assert len(request.url.raw_path) <= 4096
            assert all_items == expected
            assert len(seen) == (4 + limit - 1) // limit - 1
    # No application evaluation was performed for aliases or subsequent reads.
    assert len(catalog.adapter.calls) == 5


@pytest.mark.parametrize('run_id', ['🧪' * 129, 'A' * 129])
def test_129_code_point_identity_stays_rejected(client, run_id):
    for suffix in ['', '/evidence']:
        response = client.get(API + quote(run_id, safe='') + suffix)
        error(response, 422, 'invalid_parameter')


@pytest.mark.parametrize('limit', [1, 2, 100])
@pytest.mark.parametrize('include_payload', [True, False])
def test_literal_percent_id_exact_catalog_binding(client, limit, include_payload):
    catalog = client.app.state.catalog
    for run_id in DIRECT_IDENTITIES:
        with alias(catalog, run_id):
            detail = catalog.read(run_id)['run']
            assert detail['identity']['id'] == run_id
            cursor, seen, all_items = None, set(), []
            while True:
                page = catalog.evidence(run_id, snapshot=detail['snapshot_id'], limit=limit,
                                        include_payload=include_payload, cursor=cursor)
                assert page['run_id'] == run_id and page['page']['snapshot_id'] == detail['snapshot_id']
                all_items += page['items']
                cursor = page['page']['next_cursor']
                if cursor is None:
                    break
                assert cursor not in seen and len(cursor) <= 2048
                seen.add(cursor)
                assert unpack(cursor, catalog._key) == token_body(
                    run_id, detail['snapshot_id'], len(all_items), limit, include_payload)
            assert all_items == expected_items(run_id, include_payload)
            if limit == 1:
                legacy = sign(token_body(run_id, detail['snapshot_id'], include_payload=include_payload,
                                         legacy=True), catalog._key)
                assert catalog.evidence(run_id, limit=1, include_payload=include_payload,
                                        cursor=legacy)['items'] == expected_items(run_id, include_payload)[1:2]


def test_normalization_distinct_id_cannot_rebind_v2_cursor(client):
    catalog = client.app.state.catalog
    with alias(catalog, 'é'), alias(catalog, 'e\u0301'):
        issued = evidence(client, 'é', limit=1).json()['page']['next_cursor']
        error(evidence(client, 'e\u0301', limit=1, cursor=issued), 400, 'cursor_query_conflict')
        assert scope('é')['run_sha256'] != scope('e\u0301')['run_sha256']


@pytest.mark.parametrize('include_payload', [True, False])
def test_every_shipped_legacy_nonterminal_position_continues(client, include_payload):
    catalog = client.app.state.catalog
    # Four references mean precisely these server-issued nonterminal positions.
    for run_id in CASES:
        snapshot = client.get(path(run_id)).json()['snapshot_id']
        expected = expected_items(run_id, include_payload)
        for limit, positions in [(1, [1, 2, 3]), (2, [2]), (3, [3])]:
            for offset in positions:
                old = sign(token_body(run_id, snapshot, offset, limit, include_payload, True), catalog._key)
                assert len(old) <= 2048
                response = evidence(client, run_id, limit=limit, include_payload=str(include_payload).lower(),
                                    cursor=old, snapshot_id=snapshot)
                assert response.status_code == 200, response.text
                page = response.json()
                assert page['run_id'] == run_id and page['items'] == expected[offset:offset + limit]
                nxt = page['page']['next_cursor']
                if offset + limit < 4:
                    assert unpack(nxt, catalog._key) == token_body(
                        run_id, snapshot, offset + limit, limit, include_payload)
                else:
                    assert nxt is None


def test_legacy_raw_byte_authentication_preserved(client):
    catalog = client.app.state.catalog
    payload = token_body('SPEC-001', catalog.snapshot, legacy=True)
    # Prior decoding authenticated bytes rather than requiring canonical JSON/base64.
    raw = json.dumps(payload, indent=2, ensure_ascii=False).encode('utf-8')
    token = sign_raw(raw, catalog._key)
    response = evidence(client, cursor=token, limit=1)
    assert response.status_code == 200
    assert response.json()['items'] == expected_items('SPEC-001')[1:2]


def test_legacy_unicode_usable_tokens_and_existing_overlong_admission(client):
    catalog = client.app.state.catalog
    for _, run_id in CORPUS:
        if run_id in CASES:
            continue
        with alias(catalog, run_id):
            old = sign(token_body(run_id, catalog.snapshot, legacy=True), catalog._key)
            response = evidence(client, run_id, limit=1, cursor=old)
            if len(old) > 2048:
                error(response, 422, 'invalid_parameter')
            else:
                assert response.status_code == 200, response.text
                assert response.json()['items'] == expected_items(run_id)[1:2]
                assert unpack(response.json()['page']['next_cursor'], catalog._key)['v'] == 2


@pytest.mark.parametrize('legacy', [False, True])
def test_authenticated_context_checks_and_authentication_first(client, legacy):
    catalog = client.app.state.catalog
    payload = token_body('SPEC-001', catalog.snapshot, legacy=legacy)
    good = sign(payload, catalog._key)
    wrong_key = sign(payload, b'independent wrong signing key!!!')
    unsigned_modified = copy.deepcopy(payload)
    unsigned_modified['snapshot'] = 'unavailable-snapshot'
    original_signature = good.split('.')[1]
    changed = base64.urlsafe_b64encode(raw_json(unsigned_modified)).decode().rstrip('=') + '.' + original_signature
    for bad in [wrong_key, changed, good[:-1] + ('0' if good[-1] != '0' else '1'),
                'bad', '', '.', 'a.b.c', '!!!.' + original_signature,
                good.split('.')[0], good + 'x']:
        error(evidence(client, 'SPEC-002', limit=2, include_payload='false',
                       snapshot_id='unavailable-snapshot', cursor=bad))
    for params in [{'limit': 2}, {'limit': 1, 'include_payload': 'false'}]:
        error(evidence(client, cursor=good, **params), 400, 'cursor_query_conflict')
    error(evidence(client, 'SPEC-002', cursor=good, limit=1), 400, 'cursor_query_conflict')
    error(evidence(client, cursor=good, limit=1, snapshot_id='wrong'), 409, 'snapshot_conflict')
    for field, value in [('workspace', 'ws-other'), ('mode', 'MOCK'), ('contract', 'other')]:
        changed = copy.deepcopy(payload)
        changed['scope'][field] = value
        error(evidence(client, cursor=sign(changed, catalog._key), limit=1), 400, 'cursor_query_conflict')
    changed = copy.deepcopy(payload)
    changed['snapshot'] = 'snapshot-' + '0' * 64
    stale = sign(changed, catalog._key)
    error(evidence(client, cursor=stale, limit=1), 409, 'snapshot_unavailable')
    error(evidence(client, cursor=stale, limit=1, snapshot_id=catalog.snapshot), 409, 'snapshot_conflict')
    # Authentication validity and scope validity both precede snapshot availability.
    error(evidence(client, cursor=stale, limit=2), 400, 'cursor_query_conflict')
    assert evidence(client, cursor=good, limit=1).status_code == 200


@pytest.mark.parametrize('legacy', [False, True])
def test_signed_malformed_shape_types_and_position_fail_closed(client, legacy):
    catalog = client.app.state.catalog
    original = token_body('SPEC-001', catalog.snapshot, legacy=legacy)
    malformed = [None, [], True, 'cursor']
    for field in ['scope', 'snapshot', 'offset']:
        changed = copy.deepcopy(original)
        del changed[field]
        malformed.append(changed)
    for field, values in [('snapshot', [None, '', 1, True, [], 's' * 129]),
                          ('scope', [None, [], True]),
                          ('offset', [None, True, '1', 1.0, 0, -1, [], {}, 4, 100])]:
        for value in values:
            malformed.append({**original, field: value})
    malformed.append({**original, 'unexpected': True})
    for field in original['scope']:
        changed = copy.deepcopy(original)
        del changed['scope'][field]
        malformed.append(changed)
    for field, value in [('limit', True), ('limit', '1'), ('limit', 0), ('limit', 101),
                         ('include_payload', 1), ('include_payload', 'true'),
                         ('workspace', None), ('mode', []), ('contract', True)]:
        changed = copy.deepcopy(original)
        changed['scope'][field] = value
        malformed.append(changed)
    changed = copy.deepcopy(original)
    changed['scope']['unexpected'] = True
    malformed.append(changed)
    identity = 'run' if legacy else 'run_sha256'
    for value in [None, [], True] + ([] if legacy else ['abc', 'A' * 64]):
        changed = copy.deepcopy(original)
        changed['scope'][identity] = value
        malformed.append(changed)
    for value in malformed:
        error(evidence(client, cursor=sign(value, catalog._key), limit=1))
    for raw in [b'{', b'not json', b'\xff']:
        error(evidence(client, cursor=sign_raw(raw, catalog._key), limit=1))
    misaligned = token_body('SPEC-001', catalog.snapshot, offset=1, limit=2, legacy=legacy)
    error(evidence(client, cursor=sign(misaligned, catalog._key), limit=2))


@pytest.mark.parametrize('version', [0, 1, 3, True, 2.0, '2', None, []])
def test_signed_unsupported_or_mistyped_version_cannot_fall_back(client, version):
    catalog = client.app.state.catalog
    value = token_body('SPEC-001', catalog.snapshot)
    value['v'] = version
    error(evidence(client, cursor=sign(value, catalog._key), limit=1))
    # Supplying the legacy run shape plus an explicit version must not select legacy.
    value = token_body('SPEC-001', catalog.snapshot, legacy=True)
    value['v'] = version
    error(evidence(client, cursor=sign(value, catalog._key), limit=1))


def test_matching_digest_does_not_bypass_remaining_authenticated_context(client):
    catalog = client.app.state.catalog
    for mutation in [('snapshot', None), ('offset', True), ('v', 99)]:
        payload = token_body('SPEC-001', catalog.snapshot)
        payload[mutation[0]] = mutation[1]
        error(evidence(client, cursor=sign(payload, catalog._key), limit=1))
    payload = token_body('SPEC-001', catalog.snapshot)
    payload['scope']['run_sha256'] = '0' * 64
    error(evidence(client, cursor=sign(payload, catalog._key), limit=1), 400, 'cursor_query_conflict')


def test_cursor_request_cap_remains_2048(client):
    error(evidence(client, limit=1, cursor='A' * 2048))
    error(evidence(client, limit=1, cursor='A' * 2049), 422, 'invalid_parameter')


class FixedClock:
    @staticmethod
    def now(tz=None):
        return datetime(2026, 10, 18, 0, 0, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize('legacy', [False, True])
def test_legacy_and_v2_survive_same_snapshot_lifespan_restart(legacy):
    with patch('app.adapter.datetime', FixedClock):
        with TestClient(create_app()) as first:
            snapshot = first.app.state.catalog.snapshot
            token = sign(token_body('SPEC-001', snapshot, legacy=legacy), first.app.state.catalog._key)
        with TestClient(create_app()) as second:
            assert second.app.state.catalog.snapshot == snapshot
            response = evidence(second, cursor=token, limit=1)
            assert response.status_code == 200
            assert response.json()['items'] == expected_items('SPEC-001')[1:2]
            assert unpack(response.json()['page']['next_cursor'], second.app.state.catalog._key)['v'] == 2


@pytest.mark.parametrize('legacy', [False, True])
def test_legacy_and_v2_remain_authentic_after_unavailable_snapshot_restart(legacy):
    with patch('app.adapter.datetime', FixedClock):
        with TestClient(create_app()) as first:
            snapshot = first.app.state.catalog.snapshot
            token = sign(token_body('SPEC-001', snapshot, legacy=legacy), first.app.state.catalog._key)
    with TestClient(create_app()) as second:
        assert second.app.state.catalog.snapshot != snapshot
        error(evidence(second, cursor=token, limit=1), 409, 'snapshot_unavailable')
        error(evidence(second, cursor=token, limit=1, snapshot_id=snapshot), 409, 'snapshot_unavailable')
        error(evidence(second, cursor=token, limit=1, snapshot_id=second.app.state.catalog.snapshot),
              409, 'snapshot_conflict')
