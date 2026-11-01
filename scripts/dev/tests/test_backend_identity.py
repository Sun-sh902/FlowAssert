"""Current identity remains distinct from historical acceptance and detects drift."""
import runpy
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
identity = runpy.run_path(str(ROOT / 'scripts/dev/backend_identity.py'))


@pytest.fixture
def copied_service(tmp_path):
    _, files = identity['expected_files']()
    for name in files:
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / 'service' / name, target)
    return tmp_path


def test_identity_detects_changed_bytes(copied_service):
    inspect = identity['inspect']
    assert inspect(copied_service)['problems'] == []
    changed = copied_service / 'app/adapter.py'
    changed.write_bytes(changed.read_bytes() + b'\n# modified\n')
    assert inspect(copied_service)['problems'] == ['app/adapter.py']


def test_identity_rejects_unlisted_python_module(copied_service):
    (copied_service / 'app/unlisted.py').write_text('')
    with pytest.raises(ValueError, match='app source inventory differs'):
        identity['inspect'](copied_service)


def test_identity_detects_changed_runtime_guard(copied_service):
    guard = copied_service / 'scripts/guarded_entry.py'
    guard.write_bytes(guard.read_bytes() + b'\n# modified\n')
    assert identity['inspect'](copied_service)['problems'] == ['scripts/guarded_entry.py']
