"""Unreadable or malformed local fixtures fail closed through the HTTP envelope."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.validation import schema


@pytest.mark.parametrize(('damage', 'expected_code'), [
    ('missing', 'fixture_unavailable'),
    ('malformed', 'fixture_invalid'),
    ('non_utf8', 'fixture_invalid'),
])
def test_fixture_failure_returns_sanitized_503(monkeypatch, damage, expected_code):
    read_text = Path.read_text

    def damaged_fixture(path, *args, **kwargs):
        if path.name == 'A-verified.json' and path.parent.name == 'fixtures':
            if damage == 'missing':
                raise FileNotFoundError('private local fixture path')
            if damage == 'non_utf8':
                raise UnicodeDecodeError('utf-8', b'\xff', 0, 1, 'invalid')
            return '{invalid json'
        return read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, 'read_text', damaged_fixture)
    with TestClient(create_app(), base_url='http://127.0.0.1:8765') as client:
        response = client.get('/api/v1/verifications/SPEC-001')
    assert response.status_code == 503
    body = response.json()
    assert body['error']['code'] == expected_code
    assert body['error']['retryable'] is True
    assert 'private local fixture path' not in response.text
    assert 'result' not in body and 'items' not in body
    schema('Error', body)
