#!/usr/bin/env python3
"""Write a large workbook for the app's engine test (ios/scripts/engine-cases.mjs), standard library only.

    python3 ios/scripts/large_workbook.py OUT.xlsx ROWS NOISE

One worksheet, "Data", with id, phone and email as shared strings, the rows of the large source CSV file
engine-cases.mjs writes (SYN-0000000, +1 555 0000000, u0000000@ex.test, ...), and, when NOISE is above 0, a fourth
column "note" of NOISE characters drawn from a fixed seed, so that the file is large but still inflates to less than
the default --max-bytes. Rows and cells have no references, as streaming writers write them.
"""
import random
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "offline/bench"))
import xlsx_writer as w  # noqa: E402

BATCH = 10_000
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def main(argv):
    out, rows, noise = argv[0], int(argv[1]), int(argv[2])
    columns = ["id", "phone", "email"] + (["note"] if noise else [])
    width = len(columns)
    rnd = random.Random(20261114)
    parts = w.parts(w.Book(sheets=[w.Sheet("Data", [columns])]))
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for name, data in parts.items():
            if name == "xl/worksheets/sheet1.xml":
                with z.open(name, "w") as f:
                    f.write(f'{w.DECLARATION}<worksheet xmlns="{w.M}"><sheetData>'.encode())
                    f.write(("<row>" + "".join(f'<c t="s"><v>{j}</v></c>' for j in range(width)) + "</row>").encode())
                    for start in range(0, rows, BATCH):
                        f.write("".join(
                            "<row>" + "".join(f'<c t="s"><v>{width * (i + 1) + j}</v></c>' for j in range(width)) + "</row>"
                            for i in range(start, min(rows, start + BATCH))).encode())
                    f.write(b"</sheetData></worksheet>")
            elif name == "xl/sharedStrings.xml":
                with z.open(name, "w") as f:
                    f.write(f'{w.DECLARATION}<sst xmlns="{w.M}">'.encode())
                    f.write("".join(f"<si><t>{c}</t></si>" for c in columns).encode())
                    for start in range(0, rows, BATCH):
                        chunk = []
                        for i in range(start, min(rows, start + BATCH)):
                            chunk.append(f"<si><t>SYN-{i:07d}</t></si><si><t>+1 555 {i:07d}</t></si><si><t>u{i:07d}@ex.test</t></si>")
                            if noise:
                                chunk.append("<si><t>" + "".join(rnd.choice(ALPHABET) for _ in range(noise)) + "</t></si>")
                        f.write("".join(chunk).encode())
                    f.write(b"</sst>")
            else:
                z.writestr(name, data)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
