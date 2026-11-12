"""Write .xlsx workbooks for tests, with the standard library only. docs/design/1.1-excel.md, "Test files".

This writer is FlowAssert's own, so the reader is also tested against workbooks from two independent writers
(offline/golden-xlsx/writers/). It writes what Excel's files hold, and, on request, what no spreadsheet program
would write: the hostile cases the reader must refuse.

    from xlsx_writer import Sheet, workbook
    data = workbook([Sheet("Leads", [["id", "phone"], ["L-1", 5550100]])])

A row is a list of cells. A cell is:
  None                     no cell element (an empty cell)
  "text"                   a shared string
  1.5 / 7                  a number (int or float), written with repr
  Cell(...)                anything else: a type, a stored value, a style, a formula, an inline string, a reference
"""
import io
import re
import struct
import zipfile
import zlib
from dataclasses import dataclass, field
from typing import Optional
from xml.sax.saxutils import escape, quoteattr

M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PR = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
XLSM = "application/vnd.ms-excel.sheet.macroEnabled.main+xml"
DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'


@dataclass
class Cell:
    v: Optional[str] = None       # the stored value, as written in <v>
    t: Optional[str] = None       # the type attribute
    s: Optional[int] = None       # the style index
    f: Optional[str] = None       # a formula
    inline: Optional[list] = None  # inline string runs (t="inlineStr")
    ref: Optional[str] = None     # an explicit reference; "" leaves it out
    raw: Optional[str] = None     # the whole <c> element, as given


@dataclass
class Sheet:
    name: str
    rows: list
    state: Optional[str] = None
    hidden_rows: tuple = ()
    hidden_columns: tuple = ()      # (min, max) pairs
    merged: tuple = ()              # "A1:B2" ranges
    row_refs: bool = True           # write r= on each row
    cell_refs: bool = True          # write r= on each cell
    raw: Optional[str] = None       # the whole worksheet part, as given
    chart: bool = False             # a chart sheet instead of a worksheet


_ESCAPED = re.compile("_x[0-9A-Fa-f]{4}_")
_CONTROL = re.compile("[\x00-\x08\x0b-\x1f\ufffe\uffff]")


def text_xml(text):
    """A cell's text as a writer puts it in XML: an existing _xHHHH_ kept by escaping its underscore, a carriage return
    and every character XML cannot hold written _xHHHH_, as Excel writes them, then the XML escapes."""
    text = _ESCAPED.sub(lambda m: "_x005F" + m.group(0), text)
    text = _CONTROL.sub(lambda m: f"_x{ord(m.group(0)):04X}_", text)
    return escape(text)


def column_letters(number):
    letters = ""
    while number:
        number, rest = divmod(number - 1, 26)
        letters = chr(65 + rest) + letters
    return letters


@dataclass
class Book:
    sheets: list
    formats: dict = field(default_factory=dict)   # custom numFmtId: formatCode
    xfs: tuple = (0,)                              # numFmtId of each cellXfs entry
    date1904: bool = False
    inline_strings: bool = False                   # every text cell as an inline string, no shared string part
    rich: bool = False                             # write shared strings as rich text runs
    content_type: str = XLSX
    extra_parts: dict = field(default_factory=dict)  # name: bytes, added or replacing
    drop_parts: tuple = ()
    strings: Optional[list] = None                 # the shared string items, overriding


def _cell(ref, value, strings, index, book):
    if isinstance(value, Cell):
        if value.raw is not None:
            return value.raw
        if value.ref is not None:
            ref = value.ref
        attrs = (f' r="{ref}"' if ref else "") + (f' s="{value.s}"' if value.s is not None else "")
        if value.inline is not None:
            runs = "".join(f"<r><t xml:space=\"preserve\">{text_xml(r)}</t></r>" if book.rich else
                           f"<t xml:space=\"preserve\">{text_xml(r)}</t>" for r in value.inline)
            return f'<c{attrs} t="inlineStr"><is>{runs}</is></c>'
        attrs += f' t="{value.t}"' if value.t is not None else ""
        body = (f"<f>{escape(value.f)}</f>" if value.f is not None else "") + (
            f"<v>{escape(value.v)}</v>" if value.v is not None else "")
        return f"<c{attrs}>{body}</c>" if body else f"<c{attrs}/>"
    r = f' r="{ref}"' if ref else ""
    if isinstance(value, bool):
        return f'<c{r} t="b"><v>{int(value)}</v></c>'
    if isinstance(value, (int, float)):
        return f"<c{r}><v>{value!r}</v></c>"
    if book.inline_strings:
        return f'<c{r} t="inlineStr"><is><t xml:space="preserve">{text_xml(value)}</t></is></c>'
    if value not in index:
        index[value] = len(strings)
        strings.append(value)
    return f'<c{r} t="s"><v>{index[value]}</v></c>'


def sheet_xml(sheet, strings, index, book):
    if sheet.raw is not None:
        return sheet.raw
    out = [DECLARATION, f'<worksheet xmlns="{M}" xmlns:r="{R}">']
    if sheet.hidden_columns:
        out.append("<cols>" + "".join(f'<col min="{a}" max="{b}" width="9" hidden="1"/>'
                                      for a, b in sheet.hidden_columns) + "</cols>")
    out.append("<sheetData>")
    for number, row in enumerate(sheet.rows, start=1):
        if row is None:
            continue
        attrs = (f' r="{number}"' if sheet.row_refs else "") + (' hidden="1"' if number in sheet.hidden_rows else "")
        cells = "".join(_cell(column_letters(c) + str(number) if sheet.cell_refs else "", value, strings, index, book)
                        for c, value in enumerate(row, start=1) if value is not None)
        out.append(f"<row{attrs}>{cells}</row>")
    out.append("</sheetData>")
    if sheet.merged:
        out.append(f'<mergeCells count="{len(sheet.merged)}">' + "".join(
            f'<mergeCell ref="{m}"/>' for m in sheet.merged) + "</mergeCells>")
    out.append("</worksheet>")
    return "".join(out)


def parts(book):
    """The workbook's parts, name: bytes, in the order a spreadsheet program writes them."""
    strings = [] if book.strings is None else list(book.strings)
    index = {s: i for i, s in enumerate(strings)}
    sheet_parts = [sheet_xml(s, strings, index, book) for s in book.sheets]
    result = {}
    overrides = [f'<Override PartName="/xl/workbook.xml" ContentType="{book.content_type}"/>',
                 '<Override PartName="/xl/styles.xml" '
                 'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>']
    for i, sheet in enumerate(book.sheets, start=1):
        kind = "chartsheet" if sheet.chart else "worksheet"
        folder = "chartsheets" if sheet.chart else "worksheets"
        overrides.append(f'<Override PartName="/xl/{folder}/sheet{i}.xml" '
                         f'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.{kind}+xml"/>')
    if strings or not book.inline_strings:
        overrides.append('<Override PartName="/xl/sharedStrings.xml" '
                         'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>')
    result["[Content_Types].xml"] = (
        DECLARATION + f'<Types xmlns="{CT}"><Default Extension="rels" '
        'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>' + "".join(overrides) + "</Types>")
    result["_rels/.rels"] = (DECLARATION + f'<Relationships xmlns="{PR}"><Relationship Id="rId1" '
                             f'Type="{R}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    sheets = "".join(f'<sheet name={quoteattr(s.name)} sheetId="{i}"' + (f' state="{s.state}"' if s.state else "")
                     + f' r:id="rId{i}"/>' for i, s in enumerate(book.sheets, start=1))
    pr = '<workbookPr date1904="1"/>' if book.date1904 else "<workbookPr/>"
    result["xl/workbook.xml"] = (DECLARATION + f'<workbook xmlns="{M}" xmlns:r="{R}">{pr}<sheets>{sheets}</sheets>'
                                 "</workbook>")
    rels = [f'<Relationship Id="rId{i}" Type="{R}/{"chartsheet" if s.chart else "worksheet"}" '
            f'Target="{"chartsheets" if s.chart else "worksheets"}/sheet{i}.xml"/>'
            for i, s in enumerate(book.sheets, start=1)]
    n = len(book.sheets)
    rels.append(f'<Relationship Id="rId{n + 1}" Type="{R}/styles" Target="styles.xml"/>')
    if strings or not book.inline_strings:
        rels.append(f'<Relationship Id="rId{n + 2}" Type="{R}/sharedStrings" Target="sharedStrings.xml"/>')
    result["xl/_rels/workbook.xml.rels"] = DECLARATION + f'<Relationships xmlns="{PR}">' + "".join(rels) + \
        "</Relationships>"
    formats = "".join(f'<numFmt numFmtId="{k}" formatCode={quoteattr(v)}/>' for k, v in book.formats.items())
    xfs = "".join(f'<xf numFmtId="{k}" fontId="0" fillId="0" borderId="0" xfId="0"'
                  + (' applyNumberFormat="1"' if k else "") + "/>" for k in book.xfs)
    result["xl/styles.xml"] = (
        DECLARATION + f'<styleSheet xmlns="{M}">'
        + (f'<numFmts count="{len(book.formats)}">{formats}</numFmts>' if book.formats else "")
        + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        f'<cellXfs count="{len(book.xfs)}">{xfs}</cellXfs></styleSheet>')
    for i, (sheet, text) in enumerate(zip(book.sheets, sheet_parts), start=1):
        result[f"xl/{'chartsheets' if sheet.chart else 'worksheets'}/sheet{i}.xml"] = text
    if strings or not book.inline_strings:
        items = "".join((f'<si><r><t xml:space="preserve">{text_xml(s)}</t></r></si>' if book.rich else
                         f'<si><t xml:space="preserve">{text_xml(s)}</t></si>') for s in strings)
        result["xl/sharedStrings.xml"] = (DECLARATION + f'<sst xmlns="{M}" count="{len(strings)}" '
                                          f'uniqueCount="{len(strings)}">{items}</sst>')
    out = {k: v.encode("utf-8") for k, v in result.items()}
    for name in book.drop_parts:
        out.pop(name, None)
    out.update(book.extra_parts)
    return out


def zip_bytes(items, method=zipfile.ZIP_DEFLATED):
    """A ZIP archive of (name, bytes), with fixed dates so the bytes are reproducible."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", method) as archive:
        for name, data in items:
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 12, 0, 0, 0))
            info.compress_type = method
            info.external_attr = 0o600 << 16
            archive.writestr(info, data)
    return buffer.getvalue()


def workbook(sheets, **options):
    book = Book(sheets=list(sheets), **options)
    return zip_bytes(parts(book).items())


def from_rows(rows, name="Sheet1", **options):
    """A one-worksheet workbook whose cells are the given texts, every one a string: what a CSV file holds."""
    return workbook([Sheet(name, [list(r) for r in rows])], **options)


# ---------- Hostile archives ----------

def deflate_raw(data, level=9):
    compressor = zlib.compressobj(level, zlib.DEFLATED, -15)
    return compressor.compress(data) + compressor.flush()


def raw_zip(entries, comment=b"", zip64_locator=False):
    """A ZIP archive written by hand: entries are dicts with name, data (as stored), and optionally method, crc,
    usize (the size recorded), flags, local_name, local_method. For the cases zipfile will not write."""
    out = bytearray()
    central = bytearray()
    for e in entries:
        name = e["name"].encode("utf-8") if isinstance(e["name"], str) else e["name"]
        data = e["data"]
        method = e.get("method", 8)
        plain = e.get("plain", data if method == 0 else None)
        crc = e.get("crc", zlib.crc32(plain) if plain is not None else 0)
        usize = e.get("usize", len(plain) if plain is not None else 0)
        flags = e.get("flags", 0)
        local_name = e.get("local_name", name)
        offset = len(out)
        out += struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, flags, e.get("local_method", method), 0, 0x5B6C, crc,
                           len(data), usize, len(local_name), 0) + local_name + data
        central += struct.pack("<IHHHHHHIIIHHHHHII", 0x02014B50, 20, 20, flags, method, 0, 0x5B6C, crc, len(data),
                               usize, len(name), 0, 0, 0, 0, 0, offset) + name
    cd_offset = len(out)
    out += central
    if zip64_locator:
        out += struct.pack("<IIQI", 0x07064B50, 0, len(out), 1)
    out += struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, len(entries), len(entries), len(central), cd_offset,
                       len(comment)) + comment
    return bytes(out)


def hostile(items, overrides=None):
    """A workbook's parts as raw entries, each deflated, with per-entry overrides by name."""
    overrides = overrides or {}
    entries = []
    for name, data in items:
        entry = {"name": name, "data": deflate_raw(data), "plain": data}
        entry.update(overrides.get(name, {}))
        entries.append(entry)
    return raw_zip(entries)
