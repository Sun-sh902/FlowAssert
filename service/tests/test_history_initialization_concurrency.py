"""Crash and concurrency checks for first-time private archive initialization."""
from concurrent.futures import ThreadPoolExecutor
import os
import sqlite3
import subprocess
import sys
import threading

import pytest

from app.history_security import HistoryError, signing_key
from app.history_store import ArchiveStore
import app.history_security as security
import app.history_store as store_module


def test_key_publication_never_exposes_partial_bytes(tmp_path, monkeypatch):
    directory = tmp_path / 'keys'
    directory.mkdir(mode=0o700)
    linked = threading.Event()
    release = threading.Event()
    real_link = os.link

    def paused_link(*args, **kwargs):
        result = real_link(*args, **kwargs)
        linked.set()
        assert release.wait(5)
        return result

    monkeypatch.setattr(security.os, 'link', paused_link)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(signing_key, directory, True)
        try:
            assert linked.wait(5)
            second = pool.submit(signing_key, directory, True)
            assert not second.done()
        finally:
            release.set()
        assert first.result(timeout=5) == second.result(timeout=5)
    assert len((directory / 'history-hmac.key').read_bytes()) == 32


def test_crash_during_key_publication_recovers_without_changing_key(tmp_path):
    directory = tmp_path / 'keys'
    directory.mkdir(mode=0o700)
    key = directory / 'history-hmac.key'
    child = '''
import os, sys
from pathlib import Path
from app import history_security
real_link = os.link
def crash_after_link(*args, **kwargs):
    real_link(*args, **kwargs)
    os._exit(91)
history_security.os.link = crash_after_link
history_security.signing_key(Path(sys.argv[1]), create=True)
'''
    process = subprocess.run([sys.executable, '-B', '-c', child, str(directory)], check=False)
    assert process.returncode == 91
    original_key = key.read_bytes()
    assert len(original_key) == 32 and key.stat().st_nlink == 2
    # A read must not clean up the crash remnant; only initialization may write.
    assert signing_key(directory) == original_key
    assert key.stat().st_nlink == 2
    assert len(list(directory.glob('.history-hmac.key.*.tmp'))) == 1
    assert signing_key(directory, create=True) == original_key
    assert not list(directory.glob('.history-hmac.key.*.tmp'))
    assert key.stat().st_nlink == 1


def test_key_publication_failure_does_not_leave_partial_target(tmp_path, monkeypatch):
    directory = tmp_path / 'keys'
    directory.mkdir(mode=0o700)
    with monkeypatch.context() as patch:
        def failed_link(*args, **kwargs):
            raise OSError('simulated interrupted publication')
        patch.setattr(security.os, 'link', failed_link)
        with pytest.raises(HistoryError):
            signing_key(directory, create=True)
    assert not (directory / 'history-hmac.key').exists()
    assert len(signing_key(directory, create=True)) == 32


def test_unrecognized_hard_link_still_fails_closed(tmp_path):
    directory = tmp_path / 'keys'
    directory.mkdir(mode=0o700)
    signing_key(directory, create=True)
    os.link(directory / 'history-hmac.key', directory / 'unrelated-link')
    with pytest.raises(HistoryError) as exc:
        signing_key(directory)
    assert exc.value.code == 'unsafe_state_file'


def test_concurrent_first_initializers_recheck_schema_under_lock(tmp_path, monkeypatch):
    state = tmp_path / 'state'
    first_checked = threading.Event()
    second_attempted = threading.Event()
    release = threading.Event()
    real_connect = sqlite3.connect

    class ObservedConnection(sqlite3.Connection):
        def execute(self, sql, *args, **kwargs):
            if threading.current_thread().name == 'initializer-two' and sql == 'BEGIN IMMEDIATE':
                second_attempted.set()
            result = super().execute(sql, *args, **kwargs)
            if threading.current_thread().name == 'initializer-one' and sql == 'PRAGMA user_version':
                first_checked.set()
                assert release.wait(5)
            return result

    def connect(*args, **kwargs):
        kwargs['factory'] = ObservedConnection
        return real_connect(*args, **kwargs)

    monkeypatch.setattr(store_module.sqlite3, 'connect', connect)
    failures = []

    def initialize():
        try:
            ArchiveStore(state).initialize()
        except BaseException as exc:
            failures.append(exc)

    first = threading.Thread(target=initialize, name='initializer-one')
    second = threading.Thread(target=initialize, name='initializer-two')
    first.start()
    try:
        assert first_checked.wait(5)
        second.start()
        assert second_attempted.wait(5)
    finally:
        release.set()
        first.join(10)
        if second.ident is not None:
            second.join(10)
    assert not first.is_alive() and not second.is_alive()
    assert failures == []
    with real_connect(state / 'history.sqlite3') as db:
        assert db.execute('PRAGMA user_version').fetchone() == (1,)
        assert db.execute('SELECT count(*) FROM archive_meta').fetchone() == (1,)


@pytest.mark.parametrize('unlink_before_open', [True, False])
def test_disappearing_sqlite_sidecar_does_not_fail_read(tmp_path, monkeypatch, unlink_before_open):
    """A concurrent commit can remove a journal before or after our open."""
    state = tmp_path / 'state'
    store = ArchiveStore(state)
    store.initialize()
    side = state / 'history.sqlite3-journal'
    side.touch(mode=0o600)
    real_open = os.open
    removed = []

    def racing_open(path, flags, *args, **kwargs):
        if os.fspath(path) == os.fspath(side):
            if unlink_before_open:
                side.unlink()
                removed.append(True)
                return real_open(path, flags, *args, **kwargs)
            fd = real_open(path, flags, *args, **kwargs)
            side.unlink()
            removed.append(True)
            return fd
        return real_open(path, flags, *args, **kwargs)

    monkeypatch.setattr(security.os, 'open', racing_open)
    with store.connection() as connection:
        assert connection.execute('PRAGMA user_version').fetchone() == (1,)
    assert removed == [True]


@pytest.mark.parametrize('damage', ['mode', 'hardlink', 'symlink'])
def test_present_unsafe_sqlite_sidecar_still_fails_closed(tmp_path, damage):
    state = tmp_path / 'state'
    store = ArchiveStore(state)
    store.initialize()
    side = state / 'history.sqlite3-journal'
    if damage == 'symlink':
        side.symlink_to(state / 'history.sqlite3')
    elif damage == 'hardlink':
        target = state / 'unrelated'
        target.touch(mode=0o600)
        os.link(target, side)
    else:
        side.touch(mode=0o600)
        side.chmod(0o644)
    with pytest.raises(HistoryError):
        with store.connection():
            pass
