"""Unsafe legacy cursor key paths must not block Service startup."""
import json
import os
import subprocess
import sys


def test_fifo_cursor_key_fails_closed_without_blocking(isolated_cursor_key):
    isolated_cursor_key.parent.mkdir(mode=0o700)
    os.mkfifo(isolated_cursor_key, 0o600)
    # Isolate the whole lifespan in a subprocess: without nonblocking open,
    # a FIFO with no writer hangs the server before it can answer requests.
    code = '''
import json
from fastapi.testclient import TestClient
from app.main import create_app
with TestClient(create_app(), base_url="http://127.0.0.1:8765") as client:
    response = client.get("/api/v1/verifications/SPEC-001")
    print(json.dumps({"status": response.status_code, "code": response.json()["error"]["code"]}))
'''
    process = subprocess.run([sys.executable, '-B', '-c', code],
                             env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
                             text=True, capture_output=True, timeout=10, check=True)
    assert json.loads(process.stdout) == {'status': 503, 'code': 'cursor_key_unavailable'}
    assert isolated_cursor_key.is_fifo()


def test_unexpected_cursor_key_hard_link_fails_closed(isolated_cursor_key):
    from app.identity import ServiceError
    from app.service import cursor_key

    isolated_cursor_key.parent.mkdir(mode=0o700)
    other = isolated_cursor_key.parent / 'other'
    other.write_text('ab' * 32)
    other.chmod(0o600)
    os.link(other, isolated_cursor_key)
    try:
        cursor_key()
    except ServiceError as exc:
        assert exc.status == 503 and exc.code == 'cursor_key_unavailable'
    else:
        raise AssertionError('hard-linked key was accepted')
    assert other.read_text() == 'ab' * 32
    assert isolated_cursor_key.stat().st_nlink == 2


def test_cursor_key_recovers_interrupted_atomic_publication(isolated_cursor_key):
    from app.service import cursor_key

    isolated_cursor_key.parent.mkdir(mode=0o700)
    code = '''
import os
from app import history_security
real_link = os.link
def crash_after_link(*args, **kwargs):
    real_link(*args, **kwargs)
    os._exit(91)
history_security.os.link = crash_after_link
from app.service import cursor_key
cursor_key()
'''
    process = subprocess.run([sys.executable, '-B', '-c', code],
                             env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
                             text=True, capture_output=True, timeout=10)
    assert process.returncode == 91
    original = isolated_cursor_key.read_bytes()
    assert len(original) == 64 and isolated_cursor_key.stat().st_nlink == 2
    assert cursor_key() == bytes.fromhex(original.decode('ascii'))
    assert isolated_cursor_key.read_bytes() == original
    assert isolated_cursor_key.stat().st_nlink == 1
    assert not list(isolated_cursor_key.parent.glob('.cursor-hmac.key.*.tmp'))


def test_new_cursor_key_flushes_file_and_directory(isolated_cursor_key, monkeypatch):
    import stat
    from app import history_security
    from app.service import cursor_key

    isolated_cursor_key.parent.mkdir(mode=0o700)
    actual_fsync = os.fsync
    synced = []

    def observed_fsync(fd):
        synced.append(os.fstat(fd).st_mode)
        return actual_fsync(fd)

    monkeypatch.setattr(history_security.os, 'fsync', observed_fsync)
    assert len(cursor_key()) == 32
    assert any(stat.S_ISREG(mode) for mode in synced)
    assert any(stat.S_ISDIR(mode) for mode in synced)
