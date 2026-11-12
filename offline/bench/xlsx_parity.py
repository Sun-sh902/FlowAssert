#!/usr/bin/env python3
"""The Python side of the workbook parity test (ui/src/test/offline/xlsx-parity.test.ts).

    python3 offline/bench/xlsx_parity.py numbers      < bit patterns, one per line   > number_text of each
    python3 offline/bench/xlsx_parity.py dates        < "serial kind 1904" per line  > date_text of each, or None
    python3 offline/bench/xlsx_parity.py formats      < a JSON list of format codes  > a JSON list of classes
    python3 offline/bench/xlsx_parity.py read FOLDER  every *.xlsx in FOLDER, read as offline/flowassert_offline/xlsx.py
                                                      reads it: a JSON object of file name to rows or refusal

Standard library only; nothing here touches a network.
"""
import json
from pathlib import Path
import struct
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from flowassert_offline import xlsx  # noqa: E402
from flowassert_offline.errors import Refused  # noqa: E402


def main(argv):
    kind = argv[0]
    if kind == "numbers":
        for line in sys.stdin.read().split():
            x = struct.unpack(">d", bytes.fromhex(line))[0]
            print(xlsx.number_text(x))
    elif kind == "dates":
        for line in sys.stdin.read().splitlines():
            serial, which, system = line.split(" ")
            print(xlsx.date_text(float(serial), which, system == "1904"))
    elif kind == "formats":
        out = []
        for code in json.load(sys.stdin):
            try:
                out.append([xlsx.classify(s) for s in xlsx._sections(code)[:3]])
            except xlsx._Unreadable:
                out.append(None)
        json.dump(out, sys.stdout)
    elif kind == "read":
        out = {}
        for path in sorted(Path(argv[1]).glob("*.xlsx")):
            f = xlsx.XlsxFile(path.name, [], worksheet=None, max_rows=1_000_000, max_bytes=209_715_200)
            cwd = Path.cwd()
            try:
                import os
                os.chdir(path.parent)
                out[path.name] = {"rows": list(f.full_rows()), "sha256": f.sha256, "member": f.member}
            except Refused as e:
                out[path.name] = {"refused": str(e)}
            finally:
                os.chdir(cwd)
        json.dump(out, sys.stdout, ensure_ascii=False)
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
