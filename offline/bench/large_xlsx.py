#!/usr/bin/env python3
"""Write a workbook of N rows for the large-workbook check (ui/e2e/check-large.spec.ts), standard library only.

    python3 offline/bench/large_xlsx.py OUT.xlsx source|destination [ROWS]

One worksheet, "Data", with id, phone and email as shared strings, as a spreadsheet program writes them, the same
rows check-large.spec.ts writes as CSV: the destination's phone differs at rows 17, 500000 and 999999. Rows and
cells have no references, so the parts inflate to about 150 MB, within the default --max-bytes. The parts are written
as streams, so the file is never held whole.
"""
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import xlsx_writer as w  # noqa: E402

DIFFERENT = {17, 500_000, 999_999}
BATCH = 10_000


def main(argv):
    out, side = argv[0], argv[1]
    rows = int(argv[2]) if len(argv) > 2 else 1_000_000
    parts = w.parts(w.Book(sheets=[w.Sheet("Data", [["id", "phone", "email"]])]))

    def phone(i):
        return "+1 555 0000000x" if side == "destination" and i in DIFFERENT else f"+1 555 {i:07d}"

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for name, data in parts.items():
            if name == "xl/worksheets/sheet1.xml":
                with z.open(name, "w") as f:
                    f.write(f'{w.DECLARATION}<worksheet xmlns="{w.M}"><sheetData>'.encode())
                    # Rows and cells without references, as streaming writers write them: each follows the last.
                    f.write(b'<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c><c t="s"><v>2</v></c></row>')
                    for start in range(0, rows, BATCH):
                        f.write("".join(
                            f'<row><c t="s"><v>{3 * i + 3}</v></c><c t="s"><v>{3 * i + 4}</v></c><c t="s">'
                            f'<v>{3 * i + 5}</v></c></row>'
                            for i in range(start, min(rows, start + BATCH))).encode())
                    f.write(b"</sheetData></worksheet>")
            elif name == "xl/sharedStrings.xml":
                with z.open(name, "w") as f:
                    f.write(f'{w.DECLARATION}<sst xmlns="{w.M}"><si><t>id</t></si><si><t>phone</t></si>'
                            f'<si><t>email</t></si>'.encode())
                    for start in range(0, rows, BATCH):
                        f.write("".join(
                            f"<si><t>SYN-{i:07d}</t></si><si><t>{phone(i)}</t></si><si><t>u{i:07d}@ex.test</t></si>"
                            for i in range(start, min(rows, start + BATCH))).encode())
                    f.write(b"</sst>")
            else:
                z.writestr(name, data)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
