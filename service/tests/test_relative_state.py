"""Relative state paths must work without weakening the private-path boundary."""
import json
import os
import subprocess
import sys

import pytest

from app.history_security import HistoryError
from app.history_store import ArchiveStore
from app.identity import ROOT


def test_cli_relative_state_init_seed_and_check(tmp_path):
    state = tmp_path / 'relative-cli-state'
    relative = os.path.relpath(state, ROOT)
    for command in ('init', 'seed', 'check'):
        run = subprocess.run([sys.executable, '-B', 'archive_cli.py', '--state', relative, command],
                             cwd=ROOT, text=True, capture_output=True, check=False)
        assert run.returncode == 0, (command, run.stdout, run.stderr)
        result = json.loads(run.stdout)
        if command == 'init':
            assert result['initialized'] is True
        elif command == 'seed':
            assert result['evaluations'] == 5
        else:
            assert result['validated_archives'] == 5
            assert result['integrity'] == 'INTEGRITY_VERIFIED'


def test_relative_environment_state_and_symlink_rejection(tmp_path, monkeypatch):
    monkeypatch.chdir(ROOT)
    state = tmp_path / 'state'
    monkeypatch.setenv('FLOWASSERT_HISTORY_STATE', os.path.relpath(state, ROOT))
    store = ArchiveStore()
    store.initialize()
    assert store.directory == state
    assert store.listing()['page']['total'] == 0

    link = tmp_path / 'linked-state'
    link.symlink_to(state, target_is_directory=True)
    monkeypatch.setenv('FLOWASSERT_HISTORY_STATE', os.path.relpath(link, ROOT))
    with pytest.raises(HistoryError, match='unsafe_state_path'):
        ArchiveStore().listing()
