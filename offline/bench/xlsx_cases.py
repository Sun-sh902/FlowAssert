"""The golden cases of workbooks (offline/golden-xlsx/), written by golden.py. docs/design/1.1-excel.md.

Every result state, every cell form and every refusal of the design note has a case. Each case is (files, arguments),
as in golden.py's CASES; the workbooks are written by xlsx_writer.py, this repository's own writer, and the
independent writers' fixtures are tested apart (scripts/dev/tests/test_xlsx.py).
"""
import xlsx_writer as w
from xlsx_writer import Book, Cell, Sheet, workbook

EXAMPLE_ROWS = [
    ["external_id", "phone", "email"],
    ["SYN-001", "+1 212 555 0101", "ada@example.test"],
    ["SYN-002", "+1 212 555 0102", "grace@example.test"],
    ["SYN-003", "+1 212 555 0103", "alan@example.test"],
    ["SYN-004", "+1 212 555 0104", "edsger@example.test"],
]
DESTINATION_ROWS = [
    ["external_id", "phone", "hs_email"],
    ["SYN-001", "+1 212 555 0101", "ada@example.test"],
    ["SYN-002", "+1 212 555 0199", "grace@example.test"],
    ["SYN-004", "+1 212 555 0104", "edsger@example.test"],
    ["SYN-004", "+1 212 555 0104", "edsger.2@example.test"],
]
EXAMPLE_ARGS = ["--key", "external_id", "--field", "phone", "--field", "email:hs_email"]
COMPLETE = ["--source-complete", "--destination-complete"]


def csv(rows):
    return "".join(",".join(r) + "\n" for r in rows).encode("utf-8")


SOURCE_XLSX = ["--source", "source.xlsx", "--source-format", "xlsx", "--destination", "destination.csv"]
DESTINATION_XLSX = ["--source", "source.csv", "--destination", "destination.xlsx", "--destination-format", "xlsx"]
BOTH_XLSX = ["--source", "source.xlsx", "--source-format", "xlsx", "--destination", "destination.xlsx",
             "--destination-format", "xlsx"]


def book(rows, name="Contacts", **options):
    return workbook([Sheet(name, rows)], **options)


def source_case(data, args=None, destination=None):
    """A case whose source is the workbook `data`, against the example destination."""
    files = {"source.xlsx": data, "destination.csv": destination or csv(DESTINATION_ROWS)}
    return files, SOURCE_XLSX + (EXAMPLE_ARGS + COMPLETE if args is None else args)


def refused(data, args=None):
    return source_case(data, args)


# Every cell form, in one worksheet: each row's key, then the cell, then the text the reader must give.
FORMS = Book(sheets=[], formats={164: "yyyy/m/d", 165: "00000", 166: "[h]:mm:ss", 167: '"Total: "0.0', 168: "m/d/yy h:mm"},
             xfs=(0, 2, 3, 9, 10, 11, 14, 22, 20, 164, 165, 166, 167, 49, 168, 45))
FORM_ROWS = [
    ["id", "value", "expected"],
    ["shared", "a shared string", "a shared string"],
    ["inline", Cell(inline=["an inline string"]), "an inline string"],
    ["rich", Cell(inline=["rich ", "text"]), "rich text"],
    ["formula-string", Cell(t="str", f="UPPER(\"x\")", v="X"), "X"],
    ["general-integer", Cell(v="45678"), "45678"],
    ["general-decimal", Cell(v="0.1"), "0.1"],
    ["general-long", Cell(v="1.1000000000000001"), "1.1"],
    ["general-big", Cell(v="13800138000"), "13800138000"],
    ["general-exponent", Cell(v="1.5E-7"), "1.5e-7"],
    ["general-huge", Cell(v="1E+21"), "1e+21"],
    ["negative-zero", Cell(v="-0"), "0"],
    ["format-0.00", Cell(v="1234.5", s=1), "1234.5"],
    ["format-thousands", Cell(v="1234567", s=2), "1234567"],
    ["format-percent", Cell(v="0.125", s=3), "0.125"],
    ["format-percent-2", Cell(v="0.5", s=4), "0.5"],
    ["format-scientific", Cell(v="12345", s=5), "12345"],
    ["format-zero-padded", Cell(v="123", s=10), "123"],
    ["format-quoted-text", Cell(v="7", s=12), "7"],
    ["format-text-@", Cell(v="42", s=13), "42"],
    ["date-builtin-14", Cell(v="45973", s=6), "2025-11-12"],
    ["date-custom", Cell(v="45973", s=9), "2025-11-12"],
    ["date-with-time", Cell(v="45973.5", s=7), "2025-11-12T12:00:00"],
    ["date-with-millis", Cell(v="45973.50000578704", s=14), "2025-11-12T12:00:00.500"],
    ["date-early-1900", Cell(v="59", s=6), "1900-02-28"],
    ["date-after-60", Cell(v="61", s=6), "1900-03-01"],
    ["time-only", Cell(v="0.75", s=8), "18:00:00"],
    ["time-minutes-seconds", Cell(v="0.0006944444444444445", s=15), "00:01:00"],
    ["time-over-a-day", Cell(v="1.25", s=8), "1900-01-01T06:00:00"],
    ["duration", Cell(v="1.5", s=11), "1.5"],
    ["boolean-true", Cell(t="b", v="1"), "TRUE"],
    ["boolean-false", Cell(t="b", v="0"), "FALSE"],
    ["iso-date", Cell(t="d", v="2025-11-12T09:30:00Z"), "2025-11-12T09:30:00Z"],
    ["formula-number", Cell(f="SUM(1,2)", v="3"), "3"],
    # The writer stores a carriage return as _x000D_, and a text like _x0041_ as _x005F_x0041_, as Excel does.
    ["escape-cr", "a\rb", "a\rb"],
    ["escape-underscore", "_x0041_", "_x0041_"],
    ["spaces", "  kept  ", "  kept  "],
    ["line-break", "two\nlines", "two\nlines"],
    ["cjk", "名字", "名字"],
    ["emoji", "😀", "😀"],
    ["empty-string", Cell(t="str", v=""), ""],
    ["no-value", Cell(s=1), ""],
]


def forms_case():
    book_ = Book(sheets=[Sheet("Forms", [[r[0], r[1]] if i else ["id", "value"] for i, r in enumerate(FORM_ROWS)],
                               hidden_rows=(3, 5), hidden_columns=((2, 3),), merged=("A40:B40",))],
                 formats=FORMS.formats, xfs=FORMS.xfs)
    destination = csv([["id", "text"]] + [[r[0], _csv_cell(r[2])] for r in FORM_ROWS[1:]])
    files = {"source.xlsx": w.zip_bytes(w.parts(book_).items()), "destination.csv": destination}
    return files, SOURCE_XLSX + ["--key", "id", "--field", "value:text", "--source-complete", "--destination-complete",
                                 "--details", "all"]


def _csv_cell(text):
    if any(c in text for c in ',"\r\n'):
        return '"' + text.replace('"', '""') + '"'
    return text


def several_sheets():
    return workbook([Sheet("Summary", [["total"], ["4"]]), Sheet("Contacts", EXAMPLE_ROWS, state="hidden"),
                     Sheet("Notes", [["note"], ["synthetic"]])])


def gaps():
    # Rows and cells without references, an empty row in the middle, and a row with only an empty cell.
    rows = [EXAMPLE_ROWS[0], EXAMPLE_ROWS[1], None, [Cell(t="str", v="")], EXAMPLE_ROWS[2], [], EXAMPLE_ROWS[3],
            EXAMPLE_ROWS[4]]
    return workbook([Sheet("Contacts", rows, row_refs=False, cell_refs=False)])


def entries(data):
    """A workbook's parts as (name, bytes), in order."""
    return list(w.parts(Book(sheets=[Sheet("Contacts", EXAMPLE_ROWS)])).items()) if data is None else data


def with_parts(replace=None, drop=(), rows=EXAMPLE_ROWS, **options):
    book_ = Book(sheets=[Sheet("Contacts", rows)], **options)
    items = w.parts(book_)
    for name in drop:
        items.pop(name)
    items.update(replace or {})
    return w.zip_bytes(items.items())


def sheet_part(body, head=""):
    return (w.DECLARATION + f'<worksheet xmlns="{w.M}">{head}<sheetData>{body}</sheetData></worksheet>').encode()


def raw_sheet(body, **options):
    return with_parts({"xl/worksheets/sheet1.xml": sheet_part(body)}, **options)


HEADER_ROW = ('<row r="1"><c r="A1" t="inlineStr"><is><t>external_id</t></is></c><c r="B1" t="inlineStr"><is><t>phone'
              '</t></is></c><c r="C1" t="inlineStr"><is><t>email</t></is></c></row>')


def data_row(number, cells):
    return f'<row r="{number}">{cells}</row>'


def inline(ref, text):
    return f'<c r="{ref}" t="inlineStr"><is><t>{text}</t></is></c>'


def bomb(size):
    """A worksheet that inflates to about `size` bytes from a few kilobytes: spaces before its cells."""
    body = HEADER_ROW + data_row(2, inline("A2", "SYN-001") + inline("B2", "+1 212 555 0101")
                                 + inline("C2", "ada@example.test"))
    return with_parts({"xl/worksheets/sheet1.xml": (w.DECLARATION + f'<worksheet xmlns="{w.M}">' + " " * size
                                                    + f"<sheetData>{body}</sheetData></worksheet>").encode()})


def zip_with(overrides, items=None):
    return w.hostile(entries(items), overrides)


CRC_MISMATCH = {"xl/workbook.xml": {"crc": 1}}


def utf16_workbook():
    items = dict(entries(None))
    items["xl/workbook.xml"] = items["xl/workbook.xml"].decode().replace('encoding="UTF-8"', 'encoding="UTF-16"').encode(
        "utf-16")
    return w.zip_bytes(items.items())


def deep_nesting():
    inner = "<x>" * 70 + "</x>" * 70
    return with_parts({"xl/worksheets/sheet1.xml": (w.DECLARATION + f'<worksheet xmlns="{w.M}">{inner}<sheetData/>'
                                                    "</worksheet>").encode()})


def long_cell():
    return book([["external_id", "phone", "email"], ["SYN-001", "x" * 131073, "ada@example.test"]])


PAGE_CONFIG = ('{\n  "key": [\n    "external_id",\n    "external_id"\n  ],\n  "fields": [\n    {\n      "source": "phone",\n'
               '      "destination": "phone",\n      "rule": "exact"\n    },\n    {\n      "source": "email",\n'
               '      "destination": "hs_email",\n      "rule": "exact"\n    }\n  ],\n  "scope": "source"\n}\n').encode()
OLE_FILE = bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) + bytes(504)
ONLY_DESTINATION_ROWS = DESTINATION_ROWS + [["SYN-099", "+1 212 555 0199", "extra@example.test"]]

XLSX_CASES = {
    # Results.
    "xlsx-verified": source_case(book(EXAMPLE_ROWS), EXAMPLE_ARGS + COMPLETE, csv(
        [["external_id", "phone", "hs_email"]] + [r for r in EXAMPLE_ROWS[1:]])),
    "xlsx-mismatch": source_case(book(EXAMPLE_ROWS)),
    "xlsx-unverified": source_case(book(EXAMPLE_ROWS), EXAMPLE_ARGS, csv(
        [["external_id", "phone", "hs_email"]] + [r for r in EXAMPLE_ROWS[1:]])),
    "xlsx-both-workbooks-scope-exact": ({"source.xlsx": book(EXAMPLE_ROWS),
                                         "destination.xlsx": book(ONLY_DESTINATION_ROWS, inline_strings=True)},
                                        BOTH_XLSX + EXAMPLE_ARGS + COMPLETE + ["--scope", "exact"]),
    "xlsx-destination-workbook-source-encoding": ({"source.csv": csv(EXAMPLE_ROWS),
                                                   "destination.xlsx": book(DESTINATION_ROWS, rich=True)},
                                                  DESTINATION_XLSX + EXAMPLE_ARGS + COMPLETE
                                                  + ["--source-encoding", "utf-8"]),
    "xlsx-cell-forms": forms_case(),
    "xlsx-date-1904": ({"source.xlsx": workbook([Sheet("Dates", [["id", "when"], ["d-1", Cell(v="0", s=1)],
                                                                 ["d-2", Cell(v="44511", s=1)]])],
                                                date1904=True, xfs=(0, 14)),
                        "destination.csv": csv([["id", "date"], ["d-1", "1904-01-01"], ["d-2", "2025-11-12"]])},
                       SOURCE_XLSX + ["--key", "id", "--field", "when:date"] + COMPLETE),
    "xlsx-hidden-sheet-by-name": source_case(several_sheets(), EXAMPLE_ARGS + COMPLETE
                                             + ["--source-worksheet", "Contacts"]),
    "xlsx-gaps-and-no-references": source_case(gaps()),
    "xlsx-identical-content-refused": ({"source.xlsx": book(EXAMPLE_ROWS), "destination.csv": csv(EXAMPLE_ROWS)},
                                       SOURCE_XLSX + ["--key", "external_id", "--field", "phone"] + COMPLETE),
    "xlsx-identical-content-allowed": ({"source.xlsx": book(EXAMPLE_ROWS), "destination.csv": csv(EXAMPLE_ROWS)},
                                       SOURCE_XLSX + ["--key", "external_id", "--field", "phone"] + COMPLETE
                                       + ["--allow-identical-content"]),
    "xlsx-max-rows-at-limit": source_case(book(EXAMPLE_ROWS), EXAMPLE_ARGS + ["--max-rows", "4"]),
    "xlsx-redacted": source_case(book(EXAMPLE_ROWS), EXAMPLE_ARGS + COMPLETE + ["--redact-values"]),
    "xlsx-bomb-within-bounds": source_case(bomb(2_000_000), EXAMPLE_ARGS),
    "xlsx-config-rules": ({"source.xlsx": book(EXAMPLE_ROWS), "destination.csv": csv(DESTINATION_ROWS),
                           "config.json": b'{"key": ["external_id", "external_id"], "fields": [{"source": "phone", '
                                          b'"destination": "phone", "rule": "digits"}], "scope": "exact"}\n'},
                          ["--source", "source.xlsx", "--source-format", "xlsx", "--destination", "destination.csv",
                           "--config", "config.json"] + COMPLETE),
    # As the browser page and the packaged checker run a check: a --config file, the CSV file's encoding stated.
    "xlsx-as-the-page-runs-it": ({"source.xlsx": book(EXAMPLE_ROWS), "destination.csv": csv(DESTINATION_ROWS),
                                  "config.json": PAGE_CONFIG},
                                 ["--source", "source.xlsx", "--source-format", "xlsx", "--destination",
                                  "destination.csv", "--config", "config.json", "--destination-encoding", "utf-8"]
                                 + COMPLETE),
    # Refusals of the options.
    "xlsx-refused-format-name": source_case(book(EXAMPLE_ROWS), EXAMPLE_ARGS + ["--destination-format", "xls"]),
    "xlsx-refused-worksheet-without-format": ({}, ["--source", "source.csv", "--destination", "destination.csv",
                                                   "--source-worksheet", "Contacts"] + EXAMPLE_ARGS),
    "xlsx-refused-encoding-with-workbook": source_case(book(EXAMPLE_ROWS), EXAMPLE_ARGS + ["--source-encoding",
                                                                                           "utf-8"]),
    # Refusals of the file.
    "xlsx-refused-ole": refused(OLE_FILE),
    "xlsx-refused-not-zip": refused(csv(EXAMPLE_ROWS)),
    "xlsx-refused-crc": refused(zip_with(CRC_MISMATCH)),
    "xlsx-refused-header-mismatch": refused(zip_with({"xl/workbook.xml": {"local_name": b"xl/workbook.xmx"}})),
    "xlsx-refused-zip64": refused(w.raw_zip([{"name": "a", "data": b"", "method": 0}], zip64_locator=True)),
    "xlsx-refused-repeated-entry": refused(w.hostile(entries(None) + [("XL/Workbook.xml", b"<x/>")])),
    "xlsx-refused-encrypted-entry": refused(zip_with({"[Content_Types].xml": {"flags": 1}})),
    "xlsx-refused-method": refused(zip_with({"[Content_Types].xml": {"method": 12, "local_method": 12}})),
    "xlsx-refused-bomb-beyond-bounds": source_case(bomb(2_000_000), EXAMPLE_ARGS + ["--max-bytes", "1000000"]),
    "xlsx-refused-not-deflate": refused(zip_with({"xl/styles.xml": {"data": b"\xff\xff\xff\xff"}})),
    "xlsx-refused-missing-content-types": refused(with_parts(drop=("[Content_Types].xml",))),
    "xlsx-refused-missing-shared-strings": refused(with_parts(drop=("xl/sharedStrings.xml",))),
    "xlsx-refused-no-office-document": refused(with_parts({"_rels/.rels": (
        w.DECLARATION + f'<Relationships xmlns="{w.PR}"/>').encode()})),
    "xlsx-refused-macro-enabled": refused(with_parts(content_type=w.XLSM)),
    "xlsx-refused-template": refused(with_parts(
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml")),
    "xlsx-refused-strict": refused(with_parts({"_rels/.rels": (
        w.DECLARATION + f'<Relationships xmlns="{w.PR}"><Relationship Id="rId1" '
        'Type="http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>").encode()})),
    "xlsx-refused-external": refused(with_parts({"xl/_rels/workbook.xml.rels": (
        w.DECLARATION + f'<Relationships xmlns="{w.PR}"><Relationship Id="rId1" Type="{w.R}/worksheet" '
        'Target="https://example.test/sheet1.xml" TargetMode="External"/></Relationships>').encode()})),
    "xlsx-refused-not-utf8": refused(utf16_workbook()),
    "xlsx-refused-doctype": refused(with_parts({"xl/workbook.xml": (
        '<?xml version="1.0"?><!DOCTYPE workbook [<!ENTITY a "aaaa">]>'
        f'<workbook xmlns="{w.M}" xmlns:r="{w.R}"><sheets><sheet name="Contacts" sheetId="1" r:id="rId1"/></sheets>'
        "</workbook>").encode()})),
    "xlsx-refused-not-well-formed": refused(with_parts({"xl/styles.xml": (
        w.DECLARATION + f'<styleSheet xmlns="{w.M}"><cellXfs></styleSheet>').encode()})),
    "xlsx-refused-undefined-entity": refused(raw_sheet(HEADER_ROW + data_row(2, inline("A2", "&nbsp;")))),
    "xlsx-refused-deep-nesting": refused(deep_nesting()),
    # Refusals of the workbook.
    "xlsx-refused-no-sheet": refused(with_parts({"xl/workbook.xml": (
        w.DECLARATION + f'<workbook xmlns="{w.M}"><sheets/></workbook>').encode()})),
    "xlsx-refused-several-sheets": refused(several_sheets()),
    "xlsx-refused-no-such-worksheet": source_case(several_sheets(), EXAMPLE_ARGS + ["--source-worksheet", "contacts"]),
    "xlsx-refused-chart-sheet": source_case(workbook([Sheet("Chart", [], chart=True)]),
                                            EXAMPLE_ARGS + ["--source-worksheet", "Chart"]),
    # Refusals of the worksheet.
    "xlsx-refused-row-1-empty": refused(raw_sheet(data_row(2, inline("A2", "external_id")))),
    "xlsx-refused-repeated-column": refused(book([["external_id", "phone", "phone"], ["SYN-001", "1", "2"]])),
    "xlsx-refused-missing-column": refused(book([["external_id", "phone"], ["SYN-001", "1"]])),
    "xlsx-refused-max-rows": source_case(book(EXAMPLE_ROWS), EXAMPLE_ARGS + ["--max-rows", "3"]),
    "xlsx-refused-huge-column": refused(raw_sheet(HEADER_ROW + data_row(2, inline("XFE2", "x")))),
    "xlsx-refused-cell-out-of-order": refused(raw_sheet(HEADER_ROW + data_row(
        2, inline("B2", "+1 212 555 0101") + inline("A2", "SYN-001")))),
    "xlsx-refused-row-out-of-order": refused(raw_sheet(HEADER_ROW + data_row(3, inline("A3", "SYN-001"))
                                                       + data_row(2, inline("A2", "SYN-002")))),
    "xlsx-refused-bad-row-number": refused(raw_sheet(HEADER_ROW + '<row r="0x2"/>')),
    "xlsx-refused-beyond-header": refused(raw_sheet(HEADER_ROW + data_row(2, inline("A2", "SYN-001")
                                                                          + inline("D2", "extra")))),
    "xlsx-refused-error-value": refused(raw_sheet(HEADER_ROW + data_row(2, inline("A2", "SYN-001")
                                                                        + '<c r="B2" t="e"><v>#N/A</v></c>'))),
    "xlsx-refused-formula-without-value": refused(raw_sheet(HEADER_ROW + data_row(
        2, inline("A2", "SYN-001") + '<c r="B2"><f>1+1</f></c>'))),
    "xlsx-refused-shared-string-index": refused(raw_sheet(HEADER_ROW + data_row(2, '<c r="A2" t="s"><v>99</v></c>'))),
    "xlsx-refused-no-value": refused(raw_sheet(HEADER_ROW + data_row(2, '<c r="A2" t="b"/>'))),
    "xlsx-refused-unknown-type": refused(raw_sheet(HEADER_ROW + data_row(2, '<c r="A2" t="x"><v>1</v></c>'))),
    "xlsx-refused-not-a-number": refused(raw_sheet(HEADER_ROW + data_row(2, '<c r="A2"><v>1,5</v></c>'))),
    "xlsx-refused-not-a-boolean": refused(raw_sheet(HEADER_ROW + data_row(2, '<c r="A2" t="b"><v>2</v></c>'))),
    "xlsx-refused-not-iso-date": refused(raw_sheet(HEADER_ROW + data_row(2, '<c r="A2" t="d"><v>12/11/2025</v></c>'))),
    "xlsx-refused-undefined-style": refused(raw_sheet(HEADER_ROW + data_row(2, '<c r="A2" s="9"><v>1</v></c>'))),
    "xlsx-refused-undefined-format": refused(raw_sheet(HEADER_ROW + data_row(2, '<c r="A2" s="1"><v>1</v></c>'),
                                                       xfs=(0, 27))),
    "xlsx-refused-unread-format": refused(raw_sheet(HEADER_ROW + data_row(2, '<c r="A2" s="1"><v>1</v></c>'),
                                                    xfs=(0, 164), formats={164: "bb/mm/dd"})),
    "xlsx-refused-date-60": refused(raw_sheet(HEADER_ROW + data_row(2, '<c r="A2" s="1"><v>60</v></c>'), xfs=(0, 14))),
    "xlsx-refused-negative-date": refused(raw_sheet(HEADER_ROW + data_row(2, '<c r="A2" s="1"><v>-1</v></c>'),
                                                    xfs=(0, 14))),
    "xlsx-refused-long-cell": refused(long_cell()),
    "xlsx-refused-escaped-surrogate": refused(raw_sheet(HEADER_ROW + data_row(2, inline("A2", "_xD83D_")))),
}
