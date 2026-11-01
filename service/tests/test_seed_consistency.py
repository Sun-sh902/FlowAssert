"""Regression coverage for source-set drift and concurrent seed publishers."""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

from app import history_store
from app.history_security import HistoryError
from app.history_store import ArchiveStore
from app.identity import ROOT, digest
from archive_cli import configure_ephemeral_key


@pytest.mark.parametrize('change_at_publication', [1, 5])
def test_seed_rolls_back_when_source_set_changes_mid_batch(tmp_path, monkeypatch, change_at_publication):
    state = tmp_path / 'state'
    configure_ephemeral_key(state)
    store = ArchiveStore(state)
    original, identity = history_store.source_identity()
    changed = copy.deepcopy(original)
    changed['implementation'] = hashlib.sha256(b'changed implementation').hexdigest()
    changed_identity = digest(changed)
    changed_now = False
    publications = 0

    def current_source():
        return (changed, changed_identity) if changed_now else (original, identity)

    def fault(stage):
        nonlocal changed_now, publications
        if stage == 'before_publication':
            publications += 1
            if publications == change_at_publication:
                changed_now = True

    monkeypatch.setattr(history_store, 'source_identity', current_source)
    with pytest.raises(HistoryError) as exc:
        store.seed(fault=fault)
    assert exc.value.code == 'source_identity_changed'
    assert store.listing()['page']['total'] == 0
    with store.connection() as connection:
        for table in ('archives', 'records', 'evidence', 'seed_sets'):
            assert connection.execute('SELECT count(*) FROM ' + table).fetchone()[0] == 0




def test_seed_rolls_back_when_source_becomes_unreadable(tmp_path, monkeypatch):
    state = tmp_path / 'state'
    configure_ephemeral_key(state)
    store = ArchiveStore(state)
    original = history_store.source_identity()
    unavailable = False

    def current_source():
        if unavailable: raise OSError('simulated removed source')
        return original

    def fault(stage):
        nonlocal unavailable
        if stage == 'before_publication': unavailable = True

    monkeypatch.setattr(history_store, 'source_identity', current_source)
    with pytest.raises(HistoryError) as exc:
        store.seed(fault=fault)
    assert exc.value.code == 'source_identity_changed'
    assert store.listing()['page']['total'] == 0


def isolated_source_copy(tmp_path):
    source_root = tmp_path / 'source'
    source_root.mkdir(mode=0o700)
    for name in ('app', 'contracts', 'fixtures', 'vendor', 'migrations'):
        shutil.copytree(ROOT / name, source_root / name, ignore=shutil.ignore_patterns('__pycache__'))
    for name in ('run_history.py', 'archive_cli.py', 'research-lock.json'):
        shutil.copy2(ROOT / name, source_root / name)
    baseline = Path('docs/phase3a/evidence/baseline-source.json')
    (source_root / baseline).parent.mkdir(parents=True)
    shutil.copy2(ROOT / baseline, source_root / baseline)
    return source_root


def test_seed_detects_actual_source_change_in_isolated_copy(tmp_path, monkeypatch):
    # Hash real copied files while keeping the checked-out source untouched.
    source_root = isolated_source_copy(tmp_path)
    monkeypatch.setattr(history_store, 'ROOT', source_root)
    monkeypatch.setattr(history_store, 'MIGRATION', source_root / 'migrations/001.sql')
    state = tmp_path / 'state'
    configure_ephemeral_key(state)
    store = ArchiveStore(state)
    changed = False

    def fault(stage):
        nonlocal changed
        if stage == 'before_publication' and not changed:
            with (source_root / 'app/main.py').open('ab') as f:
                f.write(b'\n# simulated concurrent source change\n')
            changed = True

    with pytest.raises(HistoryError) as exc:
        store.seed(fault=fault)
    assert changed and exc.value.code == 'source_identity_changed'
    assert store.listing()['page']['total'] == 0
    with store.connection() as connection:
        assert connection.execute('SELECT count(*) FROM seed_sets').fetchone()[0] == 0



@pytest.mark.parametrize('seed_before_change', [False, True])
def test_loaded_process_refuses_changed_source_and_restart_can_seed_new_version(tmp_path, seed_before_change):
    source = isolated_source_copy(tmp_path)
    state = source / 'state'
    first_process = r"""
import json,sys
from pathlib import Path
from archive_cli import configure_ephemeral_key
from app.history_security import HistoryError
from app.history_store import ArchiveStore
state=Path(sys.argv[1]); configure_ephemeral_key(state)
store=ArchiveStore(state); first=store.seed() if sys.argv[2]=='1' else None
with open('app/main.py','ab') as f: f.write(b'\n# modified after import\n')
try:
 store.seed(reevaluate=True)
except HistoryError as exc:
 print(json.dumps({'first':first, 'error':exc.code, 'count':store.listing()['page']['total']}))
else: raise AssertionError('source drift accepted by old process')
"""
    second_process = r"""
import json,sys
from pathlib import Path
from archive_cli import configure_ephemeral_key
from app.history_store import ArchiveStore
state=Path(sys.argv[1]); configure_ephemeral_key(state)
store=ArchiveStore(state); result=store.seed()
print(json.dumps({'second':result, 'count':store.listing()['page']['total']}))
"""
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    first = subprocess.run([sys.executable, '-B', '-c', first_process, str(state), str(int(seed_before_change))], cwd=source, env=env,
                           capture_output=True, text=True, timeout=45, check=True)
    old = json.loads(first.stdout)
    assert old['error'] == 'source_restart_required' and old['count'] == (5 if seed_before_change else 0)
    second = subprocess.run([sys.executable, '-B', '-c', second_process, str(state)], cwd=source, env=env,
                            capture_output=True, text=True, timeout=45, check=True)
    new = json.loads(second.stdout)
    assert not new['second']['reused'] and new['second']['evaluations'] == 5
    assert new['count'] == (10 if seed_before_change else 5)
    if seed_before_change:
        assert old['first']['source_set_sha256'] != new['second']['source_set_sha256']
        assert set(old['first']['history_ids']).isdisjoint(new['second']['history_ids'])



def test_bad_source_at_import_does_not_break_history_reads_and_requires_restart(tmp_path):
    source = isolated_source_copy(tmp_path)
    state = source / 'state'
    code = r"""
import json,sys
from pathlib import Path
lock=Path('research-lock.json'); original=lock.read_bytes(); lock.write_text('{bad')
from app.history_security import HistoryError
from app.history_store import ArchiveStore
from archive_cli import configure_ephemeral_key
state=Path(sys.argv[1]); configure_ephemeral_key(state); store=ArchiveStore(state)
errors=[]
try: store.seed()
except HistoryError as exc: errors.append(exc.code)
lock.write_bytes(original)
try: store.seed()
except HistoryError as exc: errors.append(exc.code)
print(json.dumps({'errors':errors, 'count':store.listing()['page']['total']}))
"""
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    result = subprocess.run([sys.executable, '-B', '-c', code, str(state)], cwd=source, env=env,
                            capture_output=True, text=True, timeout=45, check=True)
    result = json.loads(result.stdout)
    assert result['errors'] == ['source_identity_unavailable', 'source_restart_required']
    assert result['count'] == 0


def test_concurrent_first_seed_calls_publish_one_batch(tmp_path):
    state = tmp_path / 'state'
    state.parent.mkdir(parents=True, exist_ok=True)
    code = '''
import json,sys
from pathlib import Path
from archive_cli import configure_ephemeral_key
from app.history_store import ArchiveStore
state=Path(sys.argv[1])
configure_ephemeral_key(state)
print(json.dumps(ArchiveStore(state).seed()))
'''
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    children = [subprocess.Popen([sys.executable, '-B', '-c', code, str(state)], cwd=ROOT, env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(4)]
    results = []
    try:
        for child in children:
            stdout, stderr = child.communicate(timeout=45)
            assert child.returncode == 0, stderr
            results.append(json.loads(stdout))
    finally:
        for child in children:
            if child.poll() is None:
                child.kill()
                child.communicate()
    assert sum(not result['reused'] for result in results) == 1
    assert all(result['history_ids'] == results[0]['history_ids'] for result in results)
    configure_ephemeral_key(state)
    assert ArchiveStore(state).listing()['page']['total'] == 5
