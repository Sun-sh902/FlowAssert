#!/usr/bin/env python3
"""Run the command-line checker on generated cases, for the random parity test of the browser check.

    python3 offline/bench/parity.py FOLDER

FOLDER holds one sub-folder per case with a `spec.json`, written by ui/src/test/offline/random-parity.test.ts:

    {"files": {"source.csv": {"text": "...", "encoding": "utf-8", "inject": [[0.5, "ff"]]}, ...}, "args": [...]}

For each case this writes the files as bytes, encoded here with Python's own codecs (so the browser is given exactly
the bytes Python reads), runs cli.main in the case folder with `evaluated_at` fixed, and appends one JSON line to
FOLDER/results.jsonl: the exit status, the printed summary, stderr, and the JSON and HTML reports, or null.

encoding is utf-8, utf-8-bom, utf-16 (with a byte order mark, little-endian), utf-16-be (with one), utf-16-nobom or
gb18030. inject inserts bytes (hex) at a fraction of the encoded length; truncate drops that many bytes at the end.
"""
import codecs
import contextlib
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "offline"))
from flowassert_offline import cli  # noqa: E402

ENCODE = {
    "utf-8": lambda t: t.encode("utf-8"),
    "utf-8-bom": lambda t: codecs.BOM_UTF8 + t.encode("utf-8"),
    "utf-16": lambda t: codecs.BOM_UTF16_LE + t.encode("utf-16-le"),
    "utf-16-be": lambda t: codecs.BOM_UTF16_BE + t.encode("utf-16-be"),
    "utf-16-nobom": lambda t: t.encode("utf-16-le"),
    "gb18030": lambda t: t.encode("gb18030"),
}


class _FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2000, 1, 1, tzinfo=timezone.utc)


def materialize(folder, spec):
    for name, file in spec["files"].items():
        data = ENCODE[file["encoding"]](file["text"])
        for at, hexbytes in file.get("inject", []):
            i = int(len(data) * at)
            data = data[:i] + bytes.fromhex(hexbytes) + data[i:]
        if file.get("truncate"):
            data = data[:-file["truncate"]]
        (folder / name).write_bytes(data)


def run(folder, args):
    for report in ("report.json", "report.html"):
        if (folder / report).exists():
            (folder / report).unlink()
    stdout, stderr = io.StringIO(), io.StringIO()
    cwd = os.getcwd()
    os.chdir(folder)
    saved = cli.datetime
    cli.datetime = _FixedDatetime
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = cli.main(args + ["--json", "report.json", "--html", "report.html"])
    finally:
        cli.datetime = saved
        os.chdir(cwd)
    reports = {}
    for name, report in (("json", "report.json"), ("html", "report.html")):
        path = folder / report
        reports[name] = path.read_text(encoding="utf-8") if path.exists() else None
        if path.exists():
            path.unlink()
    return {"exit": code, "stdout": stdout.getvalue(), "stderr": stderr.getvalue(), **reports}


def main(argv):
    if len(argv) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    root = Path(argv[0])
    cases = sorted(p for p in root.iterdir() if (p / "spec.json").exists())
    with open(root / "results.jsonl", "w", encoding="utf-8") as out:
        for folder in cases:
            spec = json.loads((folder / "spec.json").read_text(encoding="utf-8"))
            materialize(folder, spec)
            result = run(folder, spec["args"])
            out.write(json.dumps({"case": folder.name, **result}) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
