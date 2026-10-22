import pytest


@pytest.fixture(autouse=True)
def isolated_cursor_key(tmp_path, monkeypatch):
    # Tests never create or read the launcher's default key file inside the workspace.
    path = tmp_path / 'state' / 'cursor-hmac.key'
    monkeypatch.setenv('FLOWASSERT_CURSOR_KEY_FILE', str(path))
    return path
