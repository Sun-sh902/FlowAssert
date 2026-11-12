#!/usr/bin/env python3
"""The Python side of the records-to-resend parity test (ui/src/test/offline/exports.test.ts).

    python3 offline/bench/exports_parity.py ROOT...   every case in each ROOT (offline/golden, offline/golden-xlsx,
                                                     or a folder of generated cases) run as golden.py runs it, with
                                                     --export-dir records-to-resend: a JSON object of "ROOT/case" to
                                                     its exit status, stdout, stderr and each file's bytes as hex

Standard library only; nothing here touches a network.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from flowassert_offline import cli  # noqa: E402

EXPORT = "records-to-resend"
OUTPUTS = {"case.json", "report.json", "report.html", "stdout.txt", "stderr.txt", "exit_status.txt"}


class _Fixed(cli.datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2000, 1, 1, tzinfo=tz)


def run(folder):
    case = json.loads((folder / "case.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        for p in folder.iterdir():
            if p.is_file() and p.name not in OUTPUTS:
                shutil.copyfile(p, Path(tmp, p.name))
        out, err = io.StringIO(), io.StringIO()
        cwd = os.getcwd()
        os.chdir(tmp)
        saved = cli.datetime
        cli.datetime = _Fixed
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = cli.main(case["args"] + ["--export-dir", EXPORT])
        finally:
            cli.datetime = saved
            os.chdir(cwd)
        directory = Path(tmp, EXPORT)
        files = {p.name: p.read_bytes().hex() for p in sorted(directory.iterdir())} if directory.exists() else None
    return {"exit": code, "stdout": out.getvalue(), "stderr": err.getvalue(), "files": files}


def main(argv):
    result = {}
    for root in argv:
        root = Path(root)
        for folder in sorted(root.iterdir()):
            if (folder / "case.json").exists():
                result[f"{root.name}/{folder.name}"] = run(folder)
    json.dump(result, sys.stdout, ensure_ascii=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
