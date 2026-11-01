"""Exercise bootstrap's actual Node guard before any dependency installation."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize(
    ("version", "supported"),
    [
        ("20.19.0", False),
        ("22.11.0", False),
        ("22.12.0", True),
        ("22.13.0", True),
        ("23.0.0", False),
        ("24.0.0", True),
        ("25.0.0", False),
        ("26.0.0", True),
        ("26.10.0", True),
        ("27.0.0", True),
        ("26.0.0-rc.1", False),
    ],
)
def test_bootstrap_node_guard_precedes_dependency_install(tmp_path, version, supported):
    real_node = shutil.which("node")
    assert real_node, "Node is required to exercise the bootstrap preflight"
    root = tmp_path / "workspace"
    scripts = root / "scripts/dev"
    scripts.mkdir(parents=True)
    (root / "ui").mkdir()
    bootstrap = scripts / "bootstrap.sh"
    shutil.copy2(ROOT / "scripts/dev/bootstrap.sh", bootstrap)
    tools = tmp_path / "tools"
    tools.mkdir()
    marker = tmp_path / "dependency-install-reached"
    # Use the real Node interpreter for the script's -p/-e expressions, varying
    # only its reported version. This is a guard test, not an old-Node runtime test.
    (tools / "node").write_text(
        f"#!{sys.executable}\n"
        "import json, subprocess, sys\n"
        f"version = {version!r}\n"
        "args = sys.argv[1:]\n"
        "if args == ['-v']:\n"
        "    print('v' + version); sys.exit(0)\n"
        "assert len(args) == 2 and args[0] in ('-p', '-e'), args\n"
        "code = 'Object.defineProperty(process.versions, \"node\", {value: ' + json.dumps(version) + '});'\n"
        "code += 'console.log(' + args[1] + ')' if args[0] == '-p' else args[1]\n"
        f"sys.exit(subprocess.run([{real_node!r}, '-e', code]).returncode)\n"
    )
    # Stop at the first dependency-install operation, without installing anything.
    (tools / "npm").write_text(
        f"#!{sys.executable}\n"
        "from pathlib import Path\n"
        "import sys\n"
        "if sys.argv[1:] in (['-v'], ['--version']):\n"
        "    print('test-npm'); sys.exit(0)\n"
        f"Path({str(marker)!r}).write_text('dependency install reached')\n"
        "sys.exit(42)\n"
    )
    for tool in tools.iterdir():
        tool.chmod(0o755)
    result = subprocess.run(
        [str(bootstrap)],
        env={
            **os.environ,
            "PATH": str(tools) + os.pathsep + os.environ["PATH"],
            "FA_PYTHON": sys.executable,
            "FA_SYSTEM_PYTHON": sys.executable,
        },
        capture_output=True,
        text=True,
    )
    if supported:
        assert result.returncode == 42, result.stdout + result.stderr
        assert marker.exists()
    else:
        assert result.returncode == 11, result.stdout + result.stderr
        assert not marker.exists(), "unsupported Node reached dependency installation"
        assert 'BOOTSTRAP FAILED at stage "tools"' in result.stderr
