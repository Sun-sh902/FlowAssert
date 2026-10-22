"""Regression tests for P1-AUD-001: evidence cursors across service restart.

Expected outcomes are fixed from the frozen contract, not from the implementation:
- frontend-provider-contract.md:119 — "Reusing a cursor with changed filters is 400; an expired/unavailable
  snapshot is 409. An explicit snapshot_id that conflicts with a cursor is 409. Cursor contents are opaque and
  integrity checked; do not trust decoded client values."
- openapi-v1-proposed.yaml evidence responses — 400 "Invalid cursor, unknown parameter or unsupported sort";
  409 "Expired query snapshot ..."; snapshot_id "Never fall forward to a newer snapshot".
- frontend-provider-contract.md:142 — 400 cursor/query, 409 snapshot conflict; errors never carry a verdict.
The contract defines no time-to-live for cursors: expiry means the bound snapshot is no longer served.
"""
import base64
import json
import os
import stat
from datetime import datetime, timezone
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.identity import digest
from app.validation import schema

ROOT = '/api/v1/verifications/'
INVALID = (400, 'invalid_cursor')
QUERY_CONFLICT = (400, 'cursor_query_conflict')
UNAVAILABLE = (409, 'snapshot_unavailable')
CONFLICT = (409, 'snapshot_conflict')


class FixedClock:
    """Deterministic evaluation clock: identical fixtures + identical execution instant => identical snapshot."""
    @staticmethod
    def now(tz=None):
        return datetime(2026, 10, 18, 0, 0, 0, tzinfo=timezone.utc)


def boot():
    return TestClient(create_app())


def get(client, run, **params):
    return client.get(ROOT + run + '/evidence', params=params)


def assert_error(response, expected):
    status, code = expected
    assert response.status_code == status, response.text
    body = response.json()
    schema('Error', body)
    assert body['error']['code'] == code
    assert body['error']['retryable'] is False
    assert body['error']['details'] == []
    assert 'items' not in body and 'result' not in body and 'page' not in body
    assert response.headers['cache-control'] == 'no-store'


def first_page(client, run='SPEC-001', **params):
    params.setdefault('limit', 1)
    r = get(client, run, **params)
    assert r.status_code == 200
    page = r.json()
    schema('EvidencePage', page)
    assert page['page']['next_cursor'] is not None
    return page


def split(cursor):
    encoded, sig = cursor.split('.')
    return json.loads(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4))), sig


def join(payload, sig):
    data = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()
    return base64.urlsafe_b64encode(data).decode().rstrip('=') + '.' + sig


def walk(client, run, **params):
    pages, cursors = [], []
    page = get(client, run, **params)
    while True:
        assert page.status_code == 200
        body = page.json()
        schema('EvidencePage', body)
        pages.append(body)
        token = body['page']['next_cursor']
        if token is None:
            return pages, cursors
        assert token not in cursors
        cursors.append(token)
        page = get(client, run, **params, cursor=token)


# A / K / L — normal continuation within one process across every page size and payload mode.
@pytest.mark.parametrize('run', ['SPEC-001', 'SPEC-004', 'SPEC-005'])
@pytest.mark.parametrize('limit', [1, 2, 3, 4])
@pytest.mark.parametrize('include_payload', ['true', 'false'])
def test_valid_cursor_before_restart(run, limit, include_payload):
    with boot() as client:
        detail = client.get(ROOT + run).json()
        pages, cursors = walk(client, run, limit=limit, include_payload=include_payload, snapshot_id=detail['snapshot_id'])
        assert len(pages) == -(-4 // limit) and len(cursors) == len(pages) - 1
        items = [x for p in pages for x in p['items']]
        assert [x['reference'] for x in items] == detail['evidence_references']
        for p in pages:
            assert p['page']['snapshot_id'] == detail['snapshot_id'] and p['run_id'] == run and p['page']['total'] == 4
            assert p['meta'] == detail['meta']
        for item in items:
            if include_payload == 'true':
                assert item['payload_reason'] is None and digest(item['payload']) == item['reference']['sha256']
            else:
                assert item['payload'] is None and item['payload_reason'] == 'omitted_by_request'


# B / L — genuine catalog teardown and new lifespan; same fixtures and execution instant give the same
# content-addressed snapshot, so an authentic cursor must continue it exactly.
def test_valid_cursor_after_restart_with_snapshot_available():
    with patch('app.adapter.datetime', FixedClock):
        with boot() as first:
            page1 = first_page(first)
            expected_page2 = get(first, 'SPEC-001', limit=1, cursor=page1['page']['next_cursor']).json()
            snapshot = first.app.state.catalog.snapshot
        with boot() as second:
            assert second.app.state.catalog is not None and second.app.state.catalog.snapshot == snapshot
            assert len(second.app.state.catalog.adapter.calls) == 5  # re-evaluated by the real model on startup
            for params in [{}, {'snapshot_id': snapshot}]:
                r = get(second, 'SPEC-001', limit=1, cursor=page1['page']['next_cursor'], **params)
                assert r.status_code == 200
                page2 = r.json()
                schema('EvidencePage', page2)
                assert page2['items'] == expected_page2['items']
                assert page2['page'] == expected_page2['page']
                assert page2['items'][0]['reference'] == second.get(ROOT + 'SPEC-001').json()['evidence_references'][1]
                assert digest(page2['items'][0]['payload']) == page2['items'][0]['reference']['sha256']


# C / J — the defect: an authentic pre-restart cursor whose snapshot is no longer served is 409, never 400/200.
def test_previous_cursor_after_restart_snapshot_unavailable():
    with boot() as first:
        page1 = first_page(first)
        old_snapshot, old_cursor = page1['page']['snapshot_id'], page1['page']['next_cursor']
    with boot() as second:
        new_snapshot = second.app.state.catalog.snapshot
        assert new_snapshot != old_snapshot
        assert_error(get(second, 'SPEC-001', limit=1, cursor=old_cursor), UNAVAILABLE)
        assert_error(get(second, 'SPEC-001', limit=1, cursor=old_cursor, snapshot_id=old_snapshot), UNAVAILABLE)
        assert_error(get(second, 'SPEC-001', limit=1, snapshot_id=old_snapshot), UNAVAILABLE)
        assert_error(second.get(ROOT + 'SPEC-001', params={'snapshot_id': old_snapshot}), UNAVAILABLE)
        # G — an explicit pin to the new snapshot conflicts with the cursor's bound snapshot: no fall-forward.
        assert_error(get(second, 'SPEC-001', limit=1, cursor=old_cursor, snapshot_id=new_snapshot), CONFLICT)
        # Scope checks still precede snapshot availability for a stale cursor.
        assert_error(get(second, 'SPEC-001', limit=2, cursor=old_cursor), QUERY_CONFLICT)
        assert_error(get(second, 'SPEC-002', limit=1, cursor=old_cursor), QUERY_CONFLICT)
        # A fresh first read selects the new snapshot and paginates normally.
        assert first_page(second)['page']['snapshot_id'] == new_snapshot


# E — tampering after restart: rewriting the bound snapshot to the current one must not fall forward.
def test_tampered_cursor_after_restart_rejected():
    with boot() as first:
        old_cursor = first_page(first)['page']['next_cursor']
    with boot() as second:
        payload, sig = split(old_cursor)
        payload['snapshot'] = second.app.state.catalog.snapshot
        assert_error(get(second, 'SPEC-001', limit=1, cursor=join(payload, sig)), INVALID)
        payload, sig = split(old_cursor)
        payload['offset'] = 0
        assert_error(get(second, 'SPEC-001', limit=1, cursor=join(payload, sig)), INVALID)


# Lost verification material: an unauthenticated cursor cannot be classified as an expired snapshot.
def test_cursor_from_another_key_is_invalid(isolated_cursor_key, tmp_path, monkeypatch):
    with boot() as first:
        page1 = first_page(first)
    monkeypatch.setenv('FLOWASSERT_CURSOR_KEY_FILE', str(tmp_path / 'other' / 'cursor-hmac.key'))
    with boot() as second:
        assert_error(get(second, 'SPEC-001', limit=1, cursor=page1['page']['next_cursor']), INVALID)
        assert_error(get(second, 'SPEC-001', limit=1, cursor=page1['page']['next_cursor'], snapshot_id=page1['page']['snapshot_id']), INVALID)


# D / E / F / G / H / I / M — within one process.
def test_cursor_rejections_in_process():
    with boot() as client:
        page1 = first_page(client)
        token = page1['page']['next_cursor']
        snapshot = page1['page']['snapshot_id']
        payload, sig = split(token)
        flipped = sig[:-1] + ('0' if sig[-1] != '0' else '1')
        for malformed in ['bad', '', '.', 'a.b.c', '!!!.' + sig, token.split('.')[0], token + 'x', token + '.', '.' + sig]:
            assert_error(get(client, 'SPEC-001', limit=1, cursor=malformed), INVALID)
        tampered = [join({**payload, 'offset': 3}, sig), join({**payload, 'snapshot': 'snapshot-other'}, sig),
                    join({**payload, 'scope': {**payload['scope'], 'run': 'SPEC-002'}}, sig), token.split('.')[0] + '.' + flipped]
        for bad in tampered:
            assert_error(get(client, 'SPEC-001', limit=1, cursor=bad), INVALID)
        assert_error(get(client, 'SPEC-002', limit=1, cursor=token), QUERY_CONFLICT)
        assert_error(get(client, 'SPEC-001', limit=2, cursor=token), QUERY_CONFLICT)
        assert_error(get(client, 'SPEC-001', limit=1, cursor=token, include_payload='false'), QUERY_CONFLICT)
        assert_error(get(client, 'SPEC-001', limit=1, cursor=token, snapshot_id='snapshot-other'), CONFLICT)
        # An invalid cursor stays 400 even when the explicit snapshot is unavailable.
        assert_error(get(client, 'SPEC-001', limit=1, cursor='bad', snapshot_id='snapshot-other'), INVALID)
        # The cursor still works after all of the above, with or without the matching explicit pin.
        for params in [{}, {'snapshot_id': snapshot}]:
            assert get(client, 'SPEC-001', limit=1, cursor=token, **params).status_code == 200


# J — cursor bound to a snapshot that the serving catalog no longer holds, within one key epoch.
def test_cursor_for_replaced_snapshot_is_expired():
    with boot() as client:
        token = first_page(client)['page']['next_cursor']
        from app.service import Catalog
        client.app.state.catalog = Catalog()  # a newer immutable catalog is published; the old one is gone
        assert_error(get(client, 'SPEC-001', limit=1, cursor=token), UNAVAILABLE)


def test_cursor_key_file_properties(isolated_cursor_key):
    assert not isolated_cursor_key.exists()
    with boot() as client:
        token = first_page(client)['page']['next_cursor']
        info = isolated_cursor_key.lstat()
        assert stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
        assert stat.S_IMODE(isolated_cursor_key.parent.lstat().st_mode) & 0o077 == 0
        secret = isolated_cursor_key.read_text()
        assert len(bytes.fromhex(secret)) == 32
        for text in [token, client.get(ROOT + 'SPEC-001').text, client.get('/openapi.json').text]:
            assert secret not in text
    before = isolated_cursor_key.read_bytes()
    with boot():
        pass
    assert isolated_cursor_key.read_bytes() == before  # never silently regenerated


@pytest.mark.parametrize('damage', ['short', 'not_hex', 'group_readable', 'symlink', 'directory'])
def test_unusable_cursor_key_fails_closed(isolated_cursor_key, tmp_path, damage):
    isolated_cursor_key.parent.mkdir(mode=0o700)
    if damage == 'short':
        isolated_cursor_key.write_text('ab' * 8); isolated_cursor_key.chmod(0o600)
    if damage == 'not_hex':
        isolated_cursor_key.write_text('z' * 64); isolated_cursor_key.chmod(0o600)
    if damage == 'group_readable':
        isolated_cursor_key.write_text('ab' * 32); isolated_cursor_key.chmod(0o640)
    if damage == 'symlink':
        target = tmp_path / 'elsewhere.key'
        target.write_text('ab' * 32); target.chmod(0o600)
        os.symlink(target, isolated_cursor_key)
    if damage == 'directory':
        isolated_cursor_key.mkdir()
    before = os.readlink(isolated_cursor_key) if damage == 'symlink' else None
    with boot() as client:
        for path in [ROOT + 'SPEC-001', ROOT + 'SPEC-001/evidence']:
            r = client.get(path)
            assert r.status_code == 503 and r.json()['error']['code'] == 'cursor_key_unavailable'
            assert 'result' not in r.json() and 'items' not in r.json()
            schema('Error', r.json())
    if damage == 'symlink':
        assert os.readlink(isolated_cursor_key) == before
