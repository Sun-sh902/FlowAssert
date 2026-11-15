#!/usr/bin/env python3
"""The Python side of the connectors' records-to-resend parity (ui/src/test/offline/golden-connectors.test.ts).

    python3 offline/bench/connector_exports.py ROOT...   every case in each ROOT (offline/golden-sheets,
                                                         offline/golden-hubspot) run as golden.py runs it, against the
                                                         same local fake, with --export-dir records-to-resend: a JSON
                                                         object of "ROOT/case" to its exit status, stdout, stderr and
                                                         each file's bytes as hex

Standard library only; nothing here contacts Google or HubSpot.
"""
import json
from pathlib import Path
import shutil
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import golden  # noqa: E402

EXPORT = "records-to-resend"
KEPT = {"case.json", "report.json", "report.html", "stdout.txt", "stderr.txt", "exit_status.txt", "requests.json",
        "sheet-responses.json", "hubspot-responses.json"}


def run(folder):
    kind = "hubspot" if (folder / "hubspot-responses.json").exists() or folder.name.startswith("hubspot") else "sheets"
    case = json.loads((folder / "case.json").read_text(encoding="utf-8"))
    responses_file = folder / ("hubspot-responses.json" if kind == "hubspot" else "sheet-responses.json")
    responses = json.loads(responses_file.read_text(encoding="utf-8")) if responses_file.exists() else (
        [] if kind == "hubspot" else {})
    spec = {**case, "responses": responses, "args": case["args"] + ["--export-dir", EXPORT]}
    with tempfile.TemporaryDirectory() as tmp:
        for p in folder.iterdir():
            if p.is_file() and p.name not in KEPT:
                shutil.copyfile(p, Path(tmp, p.name))
        code, stdout, stderr, _ = golden.run_sheet_case(spec, tmp, kind)
        out = Path(tmp, EXPORT)
        files = {p.name: p.read_bytes().hex() for p in sorted(out.iterdir())} if out.is_dir() else None
    return {"exit": code, "stdout": stdout, "stderr": stderr, "files": files}


def main(roots):
    result = {}
    for root in roots:
        for folder in sorted(Path(root).iterdir()):
            result[f"{Path(root).name}/{folder.name}"] = run(folder)
    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
