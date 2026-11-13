"""Read one worksheet of an .xlsx workbook, strictly and once, as a stream. docs/design/1.1-excel.md is the design.

A workbook is a ZIP archive of XML parts. This module reads it with its own ZIP reader and its own tokenizer for a
subset of XML, the same as ui/src/offline/xlsx.ts, so the two implementations accept and refuse the same files with
the same messages. A worksheet gives rows of text, exactly as a CSV file does; the text of every cell is defined in
the design note and depends on no locale and no program. Anything FlowAssert cannot read with certainty is refused.
"""
import codecs
import datetime
import hashlib
import os
import re
import struct
import zlib

from .errors import Refused

FORMATS = ("csv", "xlsx")
CANONICAL_FORM = "flowassert-xlsx-csv-1"
MAX_ENTRIES = 10_000
TAG_BOUND = 65_536
DEPTH_BOUND = 64
FIELD_LIMIT = 131_072
CHUNK = 65_536
INFLATE_PIECE = 1 << 20
MAX_COLUMN = 16_384
MAX_ROW = 1_048_576

OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
PR_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
M_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
OFFICE_DOCUMENT = R_NS + "/officeDocument"
STRICT_OFFICE_DOCUMENT = "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument"
WORKSHEET = R_NS + "/worksheet"
STYLES = R_NS + "/styles"
SHARED_STRINGS = R_NS + "/sharedStrings"
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
XLSM_TYPE = "application/vnd.ms-excel.sheet.macroEnabled.main+xml"
XML_NS = "http://www.w3.org/XML/1998/namespace"
XMLNS_NS = "http://www.w3.org/2000/xmlns/"

# The built-in number formats ECMA-376 lists for all languages.
BUILTIN_FORMATS = {
    0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00",
    12: "# ?/?", 13: "# ??/??", 14: "mm-dd-yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM",
    19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm", 37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)",
    39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0",
    48: "##0.0E+0", 49: "@",
}
FORMS = ("text", "number", "percentage", "date_time", "duration", "boolean")

# ---------- XML ----------

_NS_START = ("A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏"
             "Ⰰ-⿯、-퟿豈-﷏ﷰ-�\U00010000-\U000effff")
_NS_CHAR = _NS_START + r"\-.0-9·̀-ͯ‿-⁀"
_NCNAME = f"[{_NS_START}][{_NS_CHAR}]*"
_QNAME = f"{_NCNAME}(?::{_NCNAME})?"
_WS = "[ \t\n]"
_ATTR = f"{_WS}+{_QNAME}{_WS}*={_WS}*(?:\"[^\"<]*\"|'[^'<]*')"
_TOKEN = re.compile(f"<({_QNAME})((?:{_ATTR})*){_WS}*(/?)>|</({_QNAME}){_WS}*>|([^<]+)")
_ATTRS = re.compile(f"{_WS}+({_QNAME}){_WS}*={_WS}*(?:\"([^\"<]*)\"|'([^'<]*)')")
_TAG_SCAN = re.compile("<[^>\"']*(?:(?:\"[^\"]*\"|'[^']*')[^>\"']*)*>")
_PI_TARGET = re.compile(f"<\\?({_NCNAME})(?:{_WS}|\\?>)")
_DECLARATION = re.compile(f"<\\?xml{_WS}+version{_WS}*={_WS}*([\"'])1\\.[0-9]+\\1"
                          f"(?:{_WS}+encoding{_WS}*={_WS}*([\"'])([A-Za-z][A-Za-z0-9._-]*)\\2)?"
                          f"(?:{_WS}+standalone{_WS}*={_WS}*([\"'])(?:yes|no)\\4)?{_WS}*\\?>")
_INVALID_CHAR = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")
_REFERENCE = re.compile("&(?:(lt|gt|amp|quot|apos)|#([0-9]+)|#x([0-9A-Fa-f]+));")
_ENTITIES = {"lt": "<", "gt": ">", "amp": "&", "quot": '"', "apos": "'"}
_SPACE = re.compile("[ \t\n]*")


class _NotWellFormed(Exception):
    pass


class _Bound(Exception):
    pass


def _char(code):
    if code == 9 or code == 10 or code == 13 or 0x20 <= code <= 0xD7FF or 0xE000 <= code <= 0xFFFD \
            or 0x10000 <= code <= 0x10FFFF:
        return chr(code)
    raise _NotWellFormed()


def _unreference(text):
    """Text with its references replaced; any other & is not well-formed."""
    if "&" not in text:
        return text
    out = []
    at = 0
    while True:
        amp = text.find("&", at)
        if amp < 0:
            out.append(text[at:])
            return "".join(out)
        out.append(text[at:amp])
        m = _REFERENCE.match(text, amp)
        if not m:
            raise _NotWellFormed()
        name, decimal, hexadecimal = m.groups()
        if name:
            out.append(_ENTITIES[name])
        else:
            digits = decimal if decimal is not None else hexadecimal
            if len(digits) > 8:
                raise _NotWellFormed()
            out.append(_char(int(digits, 10 if decimal is not None else 16)))
        at = m.end()


class _Scope:
    __slots__ = ("names", "cache")

    def __init__(self, names):
        self.names = names
        self.cache = {}


class Xml:
    """A tokenizer for the subset of XML in docs/design/1.1-excel.md. `feed` takes decoded, newline-normalised text;
    the handler gets start(name, attributes), end(name) and text(piece), names in Clark notation ({ns}local)."""

    def __init__(self, handler):
        self.h = handler
        self.buf = ""
        self.started = False   # anything seen yet: the XML declaration may only come first
        self.root_seen = False
        self.stack = []
        self.scopes = [_Scope({"xml": XML_NS})]

    def _name(self, qname, scope, attribute):
        cache = scope.cache
        key = ("@" + qname) if attribute else qname
        known = cache.get(key)
        if known is not None:
            return known
        prefix, colon, local = qname.partition(":")
        if colon:
            ns = scope.names.get(prefix)
            if ns is None or prefix == "xmlns":
                raise _NotWellFormed()
            known = "{" + ns + "}" + local
        else:
            if attribute:
                known = qname
            else:
                ns = scope.names.get("")
                known = qname if not ns else "{" + ns + "}" + qname
        cache[key] = known
        return known

    def _start(self, qname, raw, closed):
        if self.root_seen and not self.stack:
            raise _NotWellFormed()  # a second root element
        scope = self.scopes[-1]
        attrs = {}
        if raw:
            pairs = []
            seen = set()
            declared = None
            for m in _ATTRS.finditer(raw):
                name = m.group(1)
                value = m.group(2) if m.group(2) is not None else m.group(3)
                if name in seen:
                    raise _NotWellFormed()
                seen.add(name)
                value = _unreference(value.replace("\t", " ").replace("\n", " "))
                if name == "xmlns" or name.startswith("xmlns:"):
                    prefix = name[6:]
                    if prefix == "xmlns" or (prefix == "xml") != (value == XML_NS) or value == XMLNS_NS \
                            or (prefix and not value):
                        raise _NotWellFormed()
                    if declared is None:
                        declared = dict(scope.names)
                    declared[prefix] = value
                else:
                    pairs.append((name, value))
            if declared is not None:
                scope = _Scope(declared)
            for name, value in pairs:
                expanded = self._name(name, scope, True)
                if expanded in attrs:
                    raise _NotWellFormed()
                attrs[expanded] = value
        name = self._name(qname, scope, False)
        if len(self.stack) >= DEPTH_BOUND:
            raise _Bound()
        self.root_seen = True
        self.h.start(name, attrs)
        if closed:
            self.h.end(name)
        else:
            self.stack.append(qname)
            self.scopes.append(scope)

    def _text(self, text):
        if not self.stack:
            if not _SPACE.fullmatch(text):
                raise _NotWellFormed()
            return
        if "]]>" in text:
            raise _NotWellFormed()
        self.h.text(_unreference(text))

    def feed(self, data, final=False):
        buf = self.buf + data if self.buf else data
        pos = 0
        size = len(buf)
        token = _TOKEN.match
        handler = self.h
        fast = handler.fast
        while pos < size:
            if fast is not None and len(self.stack) == handler.fast_depth and buf[pos] == "<" \
                    and self.scopes[-1].names.get("") == M_NS:
                moved = fast(buf, pos)
                if moved != pos:
                    pos = moved
                    continue
            m = token(buf, pos)
            if m is not None:
                text = m.group(5)
                if text is not None:
                    end = m.end()
                    if end == size and not final:
                        # The text may go on in the next chunk: hand over what cannot be cut inside a reference or
                        # a "]]>", and keep the rest.
                        cut = text.rfind("&")
                        cut = len(text) - 2 if cut < 0 or text.find(";", cut) >= 0 else cut
                        if cut > 0:
                            self.started = True
                            self._text(text[:cut])
                            pos += cut
                        break
                    self.started = True
                    self._text(text)
                    pos = end
                    continue
                end = m.end()
                if end - pos > TAG_BOUND:
                    raise _Bound()
                self.started = True
                qname = m.group(1)
                if qname is not None:
                    self._start(qname, m.group(2), m.group(3) == "/")
                else:
                    qname = m.group(4)
                    if not self.stack or self.stack[-1] != qname:
                        raise _NotWellFormed()
                    self.stack.pop()
                    scope = self.scopes.pop()
                    self.h.end(self._name(qname, scope, False))
                pos = end
                continue
            # Markup the fast pattern does not take: a comment, a processing instruction, CDATA, a DOCTYPE, a tag not
            # yet complete, or something not well-formed.
            rest = size - pos
            if buf.startswith("<!--", pos):
                end = buf.find("-->", pos + 4)
                if end < 0:
                    pos = self._wait(buf, pos, final)
                    break
                content = buf[pos + 4:end]
                if end + 3 - pos > TAG_BOUND:
                    raise _Bound()
                if "--" in content or content.endswith("-"):
                    raise _NotWellFormed()
                end += 3
            elif buf.startswith("<?", pos):
                end = buf.find("?>", pos + 2)
                if end < 0:
                    pos = self._wait(buf, pos, final)
                    break
                end += 2
                if end - pos > TAG_BOUND:
                    raise _Bound()
                target = _PI_TARGET.match(buf, pos)
                if target is None:
                    raise _NotWellFormed()
                if target.group(1).translate(_ASCII_LOWER) == "xml":
                    if self.started or target.group(1) != "xml":
                        raise _NotWellFormed()
                    declaration = _DECLARATION.fullmatch(buf, pos, end)
                    if declaration is None:
                        raise _NotWellFormed()
                    encoding = declaration.group(3)
                    if encoding is not None and encoding.lower() != "utf-8":
                        raise NotUtf8()
            elif buf.startswith("<![CDATA[", pos):
                end = buf.find("]]>", pos + 9)
                if end < 0:
                    pos = self._wait(buf, pos, final)
                    break
                if end + 3 - pos > TAG_BOUND:
                    raise _Bound()
                if not self.stack:
                    raise _NotWellFormed()
                self.h.text(buf[pos + 9:end])
                end += 3
            elif buf.startswith("<!DOCTYPE", pos):
                raise Doctype()
            elif rest < 9 and not final and ("<![CDATA["[:rest] == buf[pos:] or "<!DOCTYPE"[:rest] == buf[pos:]
                                             or "<!--"[:rest] == buf[pos:]):
                break
            else:
                scanned = _TAG_SCAN.match(buf, pos)
                if scanned is None and not final:
                    pos = self._wait(buf, pos, final)
                    break
                # Markup that runs past the bound is refused for the bound, whatever else is wrong with it, so that
                # the refusal does not depend on how much of the part a chunk held.
                if (size if scanned is None else scanned.end()) - pos > TAG_BOUND:
                    raise _Bound()
                raise _NotWellFormed()
            if end - pos > TAG_BOUND:
                raise _Bound()
            self.started = True
            pos = end
        self.buf = buf[pos:]
        if final:
            if self.buf or self.stack or not self.root_seen:
                raise _NotWellFormed()

    @staticmethod
    def _wait(buf, pos, final):
        if len(buf) - pos > TAG_BOUND:
            raise _Bound()
        if final:
            raise _NotWellFormed()
        return pos


class NotUtf8(Exception):
    pass


class Doctype(Exception):
    pass


# ---------- ZIP ----------

class _Entry:
    __slots__ = ("name", "raw_name", "flags", "method", "crc", "csize", "usize", "offset")


def _damaged(path, detail):
    return Refused(f"{path}: damaged ZIP archive ({detail})")


class Workbook:
    """One .xlsx file, opened once: its central directory, then its parts on demand, inflated as streams."""

    def __init__(self, path, f, size, max_bytes):
        self.path = path
        self.f = f
        self.size = size
        self.remaining = max_bytes
        self.max_bytes = max_bytes
        self.inflated = 0
        self._directory()

    def _read(self, offset, length):
        self.f.seek(offset)
        data = self.f.read(length)
        if len(data) != length:
            raise _damaged(self.path, "central directory out of bounds")
        return data

    def _directory(self):
        path = self.path
        size = self.size
        head = self._read(0, min(8, size))
        if head == OLE:
            raise Refused(f"{path}: not an .xlsx workbook: it is an OLE compound file, the format of legacy .xls "
                          "workbooks and of password-protected workbooks; save it as an Excel Workbook (.xlsx) "
                          "without a password")
        tail_size = min(size, 65_557)
        tail = self._read(size - tail_size, tail_size)
        at = -1
        i = len(tail) - 22
        while i >= 0:
            if tail[i:i + 4] == b"PK\x05\x06" and i + 22 + struct.unpack_from("<H", tail, i + 20)[0] == len(tail):
                at = i
                break
            i -= 1
        if at < 0:
            raise Refused(f"{path}: not an .xlsx workbook (not a ZIP archive)")
        eocd = size - tail_size + at
        disk, cd_disk, here, total, cd_size, cd_offset = struct.unpack_from("<HHHHII", tail, at + 4)
        if (at >= 20 and tail[at - 20:at - 16] == b"PK\x06\x07") or 0xFFFF in (here, total) \
                or 0xFFFFFFFF in (cd_size, cd_offset):
            raise Refused(f"{path}: a ZIP64 archive, which FlowAssert does not read")
        if disk or cd_disk or here != total or cd_offset + cd_size > eocd:
            raise _damaged(path, "central directory out of bounds")
        if total > MAX_ENTRIES:
            raise Refused(f"{path}: more than {MAX_ENTRIES} ZIP entries")
        self.cd_offset = cd_offset
        cd = self._read(cd_offset, cd_size)
        entries = {}
        p = 0
        for _ in range(total):
            if p + 46 > len(cd) or cd[p:p + 4] != b"PK\x01\x02":
                raise _damaged(path, "central directory out of bounds")
            (flags, method, crc, csize, usize, nlen, elen, clen, offset) = (
                struct.unpack_from("<HH", cd, p + 8) + struct.unpack_from("<III", cd, p + 16)
                + struct.unpack_from("<HHH", cd, p + 28) + struct.unpack_from("<I", cd, p + 42))
            if p + 46 + nlen + elen + clen > len(cd):
                raise _damaged(path, "central directory out of bounds")
            raw_name = cd[p + 46:p + 46 + nlen]
            extra = cd[p + 46 + nlen:p + 46 + nlen + elen]
            p += 46 + nlen + elen + clen
            if usize == 0xFFFFFFFF or csize == 0xFFFFFFFF or offset == 0xFFFFFFFF:
                usize, csize, offset = self._zip64(extra, usize, csize, offset)
            if flags & 0x800:
                try:
                    name = raw_name.decode("utf-8")
                except UnicodeDecodeError:
                    raise _damaged(path, "central directory out of bounds")
            else:
                name = raw_name.decode("latin-1")
            folded = name.translate(_ASCII_LOWER)
            if folded in entries:
                raise Refused(f"{path}: repeated ZIP entry {name}")
            entry = _Entry()
            entry.name, entry.raw_name, entry.flags, entry.method = name, raw_name, flags, method
            entry.crc, entry.csize, entry.usize, entry.offset = crc, csize, usize, offset
            entries[folded] = entry
        if p != len(cd):
            raise _damaged(path, "central directory out of bounds")
        self.entries = entries

    def _zip64(self, extra, usize, csize, offset):
        p = 0
        while p + 4 <= len(extra):
            tag, length = struct.unpack_from("<HH", extra, p)
            if tag == 1:
                body = extra[p + 4:p + 4 + length]
                q = 0
                values = []
                for value in (usize, csize, offset):
                    if value == 0xFFFFFFFF:
                        if q + 8 > len(body):
                            raise _damaged(self.path, "central directory out of bounds")
                        values.append(struct.unpack_from("<Q", body, q)[0])
                        q += 8
                    else:
                        values.append(value)
                return tuple(values)
            p += 4 + length
        raise _damaged(self.path, "central directory out of bounds")

    def has(self, name):
        return name.translate(_ASCII_LOWER) in self.entries

    def chunks(self, name):
        """The inflated bytes of one part, as chunks, checked against the central directory."""
        path = self.path
        entry = self.entries.get(name.translate(_ASCII_LOWER))
        if entry is None:
            raise Refused(f"{path}: missing part {name}")
        if entry.flags & 1:
            raise Refused(f"{path}: encrypted ZIP entry {entry.name}")
        if entry.method not in (0, 8):
            raise Refused(f"{path}: ZIP entry {entry.name} uses compression method {entry.method}; only stored and "
                          "deflated entries are read")
        if entry.usize > self.remaining:
            raise Refused(f"{path}: inflated parts exceed --max-bytes limit of {self.max_bytes}")
        local = self._read(entry.offset, 30) if entry.offset + 30 <= self.size else None
        if local is None or local[:4] != b"PK\x03\x04":
            raise _damaged(path, "entry header does not match the central directory")
        method, = struct.unpack_from("<H", local, 8)
        nlen, elen = struct.unpack_from("<HH", local, 26)
        start = entry.offset + 30 + nlen + elen
        if method != entry.method or start + entry.csize > self.cd_offset \
                or self._read(entry.offset + 30, nlen) != entry.raw_name:
            raise _damaged(path, "entry header does not match the central directory")
        bad = _damaged(path, f"{entry.name} does not inflate to the data the archive records")
        inflater = zlib.decompressobj(-15) if entry.method == 8 else None
        crc = 0
        produced = 0
        left = entry.csize
        self.f.seek(start)
        try:
            while left:
                piece = self.f.read(min(CHUNK, left))
                if not piece:
                    raise bad
                left -= len(piece)
                position = self.f.tell()
                if inflater is None:
                    outs = [piece]
                else:
                    outs = []
                    data = piece
                    while data:
                        out = inflater.decompress(data, INFLATE_PIECE)
                        data = inflater.unconsumed_tail
                        if out:
                            outs.append(out)
                            if produced + sum(map(len, outs)) > entry.usize:
                                raise bad
                        if inflater.eof and (data or inflater.unused_data):
                            raise bad
                for out in outs:
                    produced += len(out)
                    if produced > entry.usize:
                        raise bad
                    crc = zlib.crc32(out, crc)
                    yield out
                self.f.seek(position)
            if inflater is not None:
                tail = inflater.flush()
                if tail:
                    produced += len(tail)
                    if produced > entry.usize:
                        raise bad
                    crc = zlib.crc32(tail, crc)
                    yield tail
                if not inflater.eof or inflater.unused_data:
                    raise bad
        except zlib.error:
            raise bad from None
        if produced != entry.usize or crc != entry.crc:
            raise bad
        self.remaining -= produced
        self.inflated += produced

    def tokenize(self, name, handler):
        """Inflate one part, decode it as UTF-8 and tokenize it into the handler, yielding after each chunk so that
        the rows a chunk completed can be handed on. Every problem is met in the order of its position in the part,
        whatever the size of the chunks, so the browser's reader, whose chunks differ, meets the same one first."""
        path = self.path
        decoder = codecs.getincrementaldecoder("utf-8")("strict")
        xml = Xml(handler)
        state = {"carry": "", "first": True}

        def feed(text, final):
            if state["first"] and text:
                state["first"] = False
                if text[0] == "\ufeff":
                    text = text[1:]
            text = state["carry"] + text
            state["carry"] = ""
            if not final and text.endswith("\r"):
                state["carry"] = "\r"
                text = text[:-1]
            bad = _INVALID_CHAR.search(text)
            if bad is not None:
                xml.feed(text[:bad.start()].replace("\r\n", "\n").replace("\r", "\n"))
                raise _NotWellFormed()
            xml.feed(text.replace("\r\n", "\n").replace("\r", "\n"), final)

        def decode(chunk, final):
            try:
                return decoder.decode(chunk, final)
            except UnicodeDecodeError as e:
                feed(e.object[:e.start].decode("utf-8"), False)
                raise NotUtf8() from None

        try:
            for chunk in self.chunks(name):
                feed(decode(chunk, False), False)
                yield
            feed(decode(b"", True), True)
            yield
        except NotUtf8:
            raise Refused(f"{path}: {name} is not UTF-8") from None
        except Doctype:
            raise Refused(f"{path}: {name} has a DOCTYPE declaration, which FlowAssert does not read") from None
        except _NotWellFormed:
            raise Refused(f"{path}: {name} is not well-formed XML") from None
        except _Bound:
            raise Refused(f"{path}: {name} exceeds a reading bound (a tag longer than {TAG_BOUND} characters, or "
                          f"elements nested deeper than {DEPTH_BOUND})") from None

    def parse(self, name, handler):
        for _ in self.tokenize(name, handler):
            pass


_ASCII_LOWER = {c: c + 32 for c in range(65, 91)}


# ---------- Package parts ----------

class _Handler:
    # A handler may consume, at one depth, complete elements that a strict pattern recognises, with the same effect as
    # the tokenizer's events would have; anything else it leaves to the tokenizer.
    fast = None
    fast_depth = -1

    def start(self, name, attrs):
        pass

    def end(self, name):
        pass

    def text(self, piece):
        pass


class _Path(_Handler):
    """A handler that knows the path of open elements."""

    def __init__(self):
        self.path = []

    def start(self, name, attrs):
        self.path.append(name)
        self.on_start(name, attrs)

    def end(self, name):
        self.on_end(name)
        self.path.pop()

    def on_start(self, name, attrs):
        pass

    def on_end(self, name):
        pass


class _ContentTypes(_Path):
    def __init__(self):
        super().__init__()
        self.defaults = {}
        self.overrides = {}

    def on_start(self, name, attrs):
        if len(self.path) == 2 and self.path[0] == "{%s}Types" % CT_NS:
            if name == "{%s}Default" % CT_NS and "Extension" in attrs:
                self.defaults.setdefault(attrs["Extension"].translate(_ASCII_LOWER), attrs.get("ContentType"))
            elif name == "{%s}Override" % CT_NS and "PartName" in attrs:
                self.overrides.setdefault(attrs["PartName"].translate(_ASCII_LOWER), attrs.get("ContentType"))

    def of(self, part):
        found = self.overrides.get("/" + part.translate(_ASCII_LOWER))
        if found is None:
            found = self.defaults.get(part.rpartition(".")[2].translate(_ASCII_LOWER))
        return found


class _Relationships(_Path):
    def __init__(self):
        super().__init__()
        self.items = []

    def on_start(self, name, attrs):
        if len(self.path) == 2 and self.path[0] == "{%s}Relationships" % PR_NS and name == "{%s}Relationship" % PR_NS:
            self.items.append((attrs.get("Id"), attrs.get("Type"), attrs.get("Target"), attrs.get("TargetMode")))


def _true(value):
    return value in ("1", "true")


class _WorkbookPart(_Path):
    def __init__(self):
        super().__init__()
        self.sheets = []
        self.date1904 = False

    def on_start(self, name, attrs):
        path = self.path
        if path[0] != "{%s}workbook" % M_NS:
            return
        if len(path) == 2 and name == "{%s}workbookPr" % M_NS:
            self.date1904 = _true(attrs.get("date1904"))
        elif len(path) == 3 and path[1] == "{%s}sheets" % M_NS and name == "{%s}sheet" % M_NS:
            self.sheets.append((attrs.get("name"), attrs.get("state") or "visible", attrs.get("{%s}id" % R_NS)))


class _Styles(_Path):
    def __init__(self):
        super().__init__()
        self.formats = {}
        self.xfs = []

    def on_start(self, name, attrs):
        path = self.path
        if path[0] != "{%s}styleSheet" % M_NS or len(path) != 3:
            return
        if path[1] == "{%s}numFmts" % M_NS and name == "{%s}numFmt" % M_NS:
            number = attrs.get("numFmtId")
            if number is not None and number.isdigit() and number.isascii() and len(number) < 10 \
                    and "formatCode" in attrs:
                self.formats.setdefault(int(number), attrs["formatCode"])
        elif path[1] == "{%s}cellXfs" % M_NS and name == "{%s}xf" % M_NS:
            number = attrs.get("numFmtId", "0")
            self.xfs.append(int(number) if number.isdigit() and number.isascii() and len(number) < 10 else None)


_FAST_ATTRS = '(?: (?!xmlns)[A-Za-z]+="[^"<&\t\n]*")*'
_FAST_STRING = re.compile('<si><t(?: xml:space="[^"<&\t\n]*")?(?:>([^<&]*)</t>|/>)</si>')
_FAST_CELLS = re.compile(f'<c({_FAST_ATTRS})(?:/>|>(?:<f({_FAST_ATTRS})(?:/>|>[^<&]*</f>))?(?:<v>([^<&]*)</v>)?</c>)')
_FAST_ROW = re.compile(f'<row({_FAST_ATTRS})(?:/>|>((?:<c{_FAST_ATTRS}(?:/>|>(?:<f{_FAST_ATTRS}(?:/>|>[^<&]*</f>))?'
                       f'(?:<v>[^<&]*</v>)?</c>))*)</row>)')
_FAST_ATTR = re.compile(' ([A-Za-z]+)="([^"]*)"')


def _fast_attrs(text):
    """The attributes of a fast-path tag, or None when one repeats (the tokenizer then refuses it)."""
    if not text:
        return {}
    pairs = _FAST_ATTR.findall(text)
    attrs = dict(pairs)
    return attrs if len(attrs) == len(pairs) else None


class _SharedStrings(_Path):
    fast_depth = 1

    def __init__(self):
        super().__init__()
        self.items = []
        self.pieces = None
        self.collect = False
        self.fast = self._fast

    def _fast(self, buf, pos):
        if self.pieces is not None or self.path != [_SST]:
            return pos
        append = self.items.append
        match = _FAST_STRING.match
        while True:
            m = match(buf, pos)
            if m is None or "]]>" in m.group(0):
                return pos
            append(m.group(1) or "")
            pos = m.end()

    def on_start(self, name, attrs):
        path = self.path
        if path[0] != "{%s}sst" % M_NS:
            return
        depth = len(path)
        if depth == 2 and name == "{%s}si" % M_NS:
            self.pieces = []
        elif self.pieces is not None and name == "{%s}t" % M_NS and (
                depth == 3 or (depth == 4 and path[2] == "{%s}r" % M_NS)):
            self.collect = True

    def on_end(self, name):
        if self.collect and name == "{%s}t" % M_NS:
            self.collect = False
        elif len(self.path) == 2 and name == "{%s}si" % M_NS and self.pieces is not None:
            self.items.append("".join(self.pieces))
            self.pieces = None

    def text(self, piece):
        if self.collect:
            self.pieces.append(piece)


# ---------- Cell text ----------

_ESCAPE = re.compile("_x([0-9A-Fa-f]{4})_")
_NUMBER = re.compile(r"-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_ISO_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?"
                       r"(?:Z|[+-][0-9]{2}:[0-9]{2})?)?")
_CELL_REF = re.compile("([A-Z]{1,3})([1-9][0-9]{0,6})")
_ROW_NUMBER = re.compile("[1-9][0-9]{0,6}")
_ELAPSED = re.compile("h+|m+|s+")


class _Surrogate(Exception):
    pass


def unescape(text):
    if "_x" not in text:
        return text

    def one(m):
        code = int(m.group(1), 16)
        if 0xD800 <= code <= 0xDFFF:
            raise _Surrogate()
        return chr(code)
    return _ESCAPE.sub(one, text)


def number_text(x):
    """ECMAScript's Number::toString(x) for a finite double."""
    if x == 0:
        return "0"
    if x < 0:
        return "-" + number_text(-x)
    mantissa, _, exponent = repr(x).partition("e")
    whole, _, fraction = mantissa.partition(".")
    digits = whole + fraction
    n = len(whole) + (int(exponent) if exponent else 0)
    stripped = digits.lstrip("0")
    n -= len(digits) - len(stripped)
    digits = stripped.rstrip("0")
    k = len(digits)
    if k <= n <= 21:
        return digits + "0" * (n - k)
    if 0 < n <= 21:
        return digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return "0." + "0" * -n + digits
    e = n - 1
    sign = "+" if e >= 0 else "-"
    return (digits if k == 1 else digits[0] + "." + digits[1:]) + "e" + sign + str(abs(e))


class _Unreadable(Exception):
    pass


def _clean(section):
    out = []
    elapsed = False
    i = 0
    size = len(section)
    while i < size:
        c = section[i]
        if c == '"':
            j = section.find('"', i + 1)
            if j < 0:
                raise _Unreadable()
            i = j + 1
        elif c in "\\_*":
            i += 2
        elif c == "[":
            j = section.find("]", i)
            if j < 0:
                raise _Unreadable()
            if _ELAPSED.fullmatch(section[i + 1:j].translate(_ASCII_LOWER)):
                elapsed = True
            i = j + 1
        else:
            out.append(c)
            i += 1
    return "".join(out).translate(_ASCII_LOWER).replace("general", ""), elapsed


def _sections(code):
    sections = []
    start = 0
    i = 0
    quoted = False
    while i < len(code):
        c = code[i]
        if c == '"':
            quoted = not quoted
        elif not quoted and c == "\\":
            i += 1
        elif not quoted and c == ";":
            sections.append(code[start:i])
            start = i + 1
        i += 1
    sections.append(code[start:])
    return sections


def classify(section):
    """The class of one section of a number format: number, percentage, duration, date, time or date_time."""
    cleaned, elapsed = _clean(section)
    letters = []
    i = 0
    size = len(cleaned)
    while i < size:
        c = cleaned[i]
        if cleaned.startswith("am/pm", i):
            letters.append("a")
            i += 5
            continue
        if cleaned.startswith("a/p", i):
            letters.append("a")
            i += 3
            continue
        if "a" <= c <= "z":
            j = i
            while j < size and cleaned[j] == c:
                j += 1
            if c == "e" and j < size and cleaned[j] in "+-":
                i = j + 1
                continue
            if c not in "ymdhse":
                raise _Unreadable()
            letters.append(c)
            i = j
            continue
        i += 1
    has_date = has_time = False
    for k, c in enumerate(letters):
        if c == "m":
            minutes = (k > 0 and letters[k - 1] == "h") or (k + 1 < len(letters) and letters[k + 1] == "s")
            if minutes:
                has_time = True
            else:
                has_date = True
        elif c in "yde":
            has_date = True
        else:
            has_time = True
    if elapsed:
        return "duration"
    if has_date and has_time:
        return "date_time"
    if has_date:
        return "date"
    if has_time:
        return "time"
    return "percentage" if "%" in cleaned else "number"


_DAY_MS = 86_400_000
_LIMITS = {False: 2_958_465, True: 2_957_003}
_BASE_1900 = datetime.date(1899, 12, 30).toordinal()
_BASE_1900_EARLY = datetime.date(1899, 12, 31).toordinal()
_BASE_1904 = datetime.date(1904, 1, 1).toordinal()


def _clock(ms):
    seconds, millis = divmod(ms, 1000)
    minutes, second = divmod(seconds, 60)
    hour, minute = divmod(minutes, 60)
    text = f"{hour:02d}:{minute:02d}:{second:02d}"
    return text + (f".{millis:03d}" if millis else "")


def date_text(x, kind, date1904):
    """The ISO 8601 text of a serial number, or None when it is not a date in the date system."""
    if x < 0:
        return None
    total = int((x * 86_400_000.0 + 0.5) // 1)
    days, rest = divmod(total, _DAY_MS)
    if kind == "time" and days == 0:
        return _clock(rest)
    if days > _LIMITS[date1904]:
        return None
    if date1904:
        ordinal = _BASE_1904 + days
    elif days == 0 or days == 60:
        return None
    else:
        ordinal = (_BASE_1900_EARLY if days < 60 else _BASE_1900) + days
    day = datetime.date.fromordinal(ordinal).isoformat()
    if kind == "date" and rest == 0:
        return day
    return day + "T" + _clock(rest)


def column_letters(number):
    letters = ""
    while number:
        number, rest = divmod(number - 1, 26)
        letters = chr(65 + rest) + letters
    return letters


_COLUMNS = {}


def _column(letters):
    number = _COLUMNS.get(letters)
    if number is None:
        number = 0
        for c in letters:
            number = number * 26 + ord(c) - 64
        if len(_COLUMNS) < 20_000:
            _COLUMNS[letters] = number
    return number


def _canonical_cell(value):
    if any(c in value for c in ',"\r\n'):
        return '"' + value.replace('"', '""') + '"'
    return value


def canonical_row(row):
    """One row of the canonical form (flowassert-xlsx-csv-1, the text of flowassert-sheet-csv-1), with its line feed."""
    if len(row) == 1 and row[0] == "":
        return '""\n'
    line = ",".join(row)
    # Most rows need no quoting: then the joined text has exactly the separators and no quote or line break.
    if line.count(",") == len(row) - 1 and '"' not in line and "\r" not in line and "\n" not in line:
        return line + "\n"
    return ",".join(_canonical_cell(value) for value in row) + "\n"


_SST = "{%s}sst" % M_NS
_WS_ = "{%s}worksheet" % M_NS
_SHEET_DATA = "{%s}sheetData" % M_NS
_ROW = "{%s}row" % M_NS
_C = "{%s}c" % M_NS
_V = "{%s}v" % M_NS
_F = "{%s}f" % M_NS
_IS = "{%s}is" % M_NS
_T = "{%s}t" % M_NS
_R = "{%s}r" % M_NS
_COLS = "{%s}cols" % M_NS
_COL = "{%s}col" % M_NS
_MERGE_CELLS = "{%s}mergeCells" % M_NS
_MERGE_CELL = "{%s}mergeCell" % M_NS


class _Cell:
    __slots__ = ("ref", "column", "row", "kind", "style", "has_v", "has_f", "inline", "v")

    def name(self):
        return self.ref if self.ref is not None else column_letters(self.column) + str(self.row)


class _Sheet(_Handler):
    """The worksheet's handler: builds each row's cells and hands the row to the reader when it ends."""
    fast_depth = 2

    def _fast(self, buf, pos):
        """Whole rows in the common form, handled by the same methods the events reach."""
        if not self.in_data or self.cells is not None:
            return pos
        match = _FAST_ROW.match
        while True:
            m = match(buf, pos)
            if m is None:
                return pos
            whole = m.group(0)
            if "]]>" in whole:
                return pos
            attrs = _fast_attrs(m.group(1))
            if attrs is None:
                return pos
            body = m.group(2)
            cells = []
            if body:
                for c in _FAST_CELLS.finditer(body):
                    cell_attrs = _fast_attrs(c.group(1))
                    formula = c.group(2)
                    if cell_attrs is None or (formula and _fast_attrs(formula) is None):
                        return pos
                    cells.append((cell_attrs, formula is not None, c.group(3)))
            self._row(attrs)
            for cell_attrs, formula, v in cells:
                self._cell(cell_attrs)
                cell = self.cell
                cell.has_f = formula
                if v is not None:
                    cell.has_v = True
                    if len(v) > 7 * FIELD_LIMIT:
                        self.r.refuse(f"cell {cell.name()} is longer than {FIELD_LIMIT} characters")
                    cell.v = v
                self.cell = None
                text, form = self.r.text_of(cell)
                if text:
                    self.cells.append((cell.column, text, form, cell.has_f))
            self.r.row(self.row_number, self.cells, self.row_hidden)
            self.cells = None
            pos = m.end()

    def __init__(self, reader):
        self.fast = self._fast
        self.r = reader
        self.path = []
        self.in_data = False
        self.row_number = 0
        self.row_hidden = False
        self.cells = None
        self.column = 0
        self.cell = None
        self.collect = None
        self.collect_depth = 0
        self.size = 0
        self.hidden_columns = []
        self.merged = 0

    def start(self, name, attrs):
        path = self.path
        depth = len(path)
        path.append(name)
        if depth == 3:
            if name == _C and self.cells is not None:
                self._cell(attrs)
        elif depth == 4:
            cell = self.cell
            if cell is not None:
                if name == _V:
                    cell.has_v = True
                    self._collect()
                elif name == _F:
                    cell.has_f = True
                elif name == _IS:
                    cell.inline = []
        elif depth == 2:
            if self.in_data:
                if name == _ROW:
                    self._row(attrs)
            elif name == _COL and path[1] == _COLS:
                self._col(attrs)
            elif name == _MERGE_CELL and path[1] == _MERGE_CELLS:
                self.merged += 1
        elif depth == 1:
            if name == _SHEET_DATA and path[0] == _WS_:
                self.in_data = True
        elif (depth == 5 or depth == 6) and name == _T and self.cell is not None and self.cell.inline is not None \
                and path[4] == _IS and (depth == 5 or path[5] == _R):
            self._collect()

    def _collect(self):
        self.collect = []
        self.collect_depth = len(self.path)
        self.size = 0

    def end(self, name):
        path = self.path
        depth = len(path)
        if self.collect is not None and depth == self.collect_depth:
            text = "".join(self.collect)
            self.collect = None
            if name == _V:
                self.cell.v = text
            else:
                self.cell.inline.append(text)
        elif depth == 4:
            if name == _C and self.cell is not None:
                cell = self.cell
                self.cell = None
                text, form = self.r.text_of(cell)
                if text:
                    self.cells.append((cell.column, text, form, cell.has_f))
        elif depth == 3:
            if name == _ROW and self.cells is not None:
                self.r.row(self.row_number, self.cells, self.row_hidden)
                self.cells = None
        elif depth == 2 and name == _SHEET_DATA:
            self.in_data = False
        path.pop()

    def text(self, piece):
        if self.collect is not None and len(self.path) == self.collect_depth:
            self.size += len(piece)
            if self.size > 7 * FIELD_LIMIT:
                self.r.refuse(f"cell {self.cell.name()} is longer than {FIELD_LIMIT} characters")
            self.collect.append(piece)

    def _row(self, attrs):
        number = attrs.get("r")
        if number is None:
            number = self.row_number + 1
        else:
            if not _ROW_NUMBER.fullmatch(number) or int(number) > MAX_ROW:
                self.r.refuse(f"row {number!r} is not a row of a worksheet")
            number = int(number)
        if number <= self.row_number or number > MAX_ROW:
            self.r.refuse(f"row {number} is out of order")
        self.r.before_row(number)
        self.row_number = number
        self.row_hidden = _true(attrs.get("hidden"))
        self.cells = []
        self.column = 0

    def _cell(self, attrs):
        ref = attrs.get("r")
        if ref is None:
            column = self.column + 1
            if column > MAX_COLUMN:
                self.r.refuse(f"cell reference {column_letters(column) + str(self.row_number)!r} is not a cell of "
                              "a worksheet")
        else:
            m = _CELL_REF.fullmatch(ref)
            if not m:
                self.r.refuse(f"cell reference {ref!r} is not a cell of a worksheet")
            column = _column(m.group(1))
            row = int(m.group(2))
            if column > MAX_COLUMN or row > MAX_ROW:
                self.r.refuse(f"cell reference {ref!r} is not a cell of a worksheet")
            if row != self.row_number or column <= self.column:
                self.r.refuse(f"cell {ref} is out of order")
        self.column = column
        cell = _Cell()
        cell.ref, cell.column, cell.row = ref, column, self.row_number
        cell.kind, cell.style = attrs.get("t", "n"), attrs.get("s")
        cell.has_v = cell.has_f = False
        cell.inline = cell.v = None
        self.cell = cell

    def _col(self, attrs):
        if _true(attrs.get("hidden")):
            low, high = attrs.get("min", ""), attrs.get("max", "")
            if _ROW_NUMBER.fullmatch(low) and _ROW_NUMBER.fullmatch(high):
                self.hidden_columns.append((int(low), int(high)))


_FORMULA = ("has a formula without a cached value; open and save the workbook in a spreadsheet program, which "
            "stores the values")


class WorksheetReader:
    """Reads the package parts of a workbook, chooses the worksheet, and reads its rows."""

    def __init__(self, workbook, worksheet_option, option_name):
        self.wb = workbook
        self.path = workbook.path
        self.option = worksheet_option
        self.option_name = option_name
        self.name = None

    def refuse(self, message):
        raise Refused(f"{self.path}: worksheet {self.name!r}: {message}")

    def open(self):
        """Read the package parts and choose the worksheet. Refuses before any row is read."""
        wb = self.wb
        path = self.path
        if not wb.has("[Content_Types].xml"):
            raise Refused(f"{path}: missing part [Content_Types].xml")
        types = _ContentTypes()
        wb.parse("[Content_Types].xml", types)
        if not wb.has("_rels/.rels"):
            raise Refused(f"{path}: missing part _rels/.rels")
        rels = _Relationships()
        wb.parse("_rels/.rels", rels)
        office = [r for r in rels.items if r[1] == OFFICE_DOCUMENT]
        if not office:
            if any(r[1] == STRICT_OFFICE_DOCUMENT for r in rels.items):
                raise Refused(f"{path}: a Strict Open XML workbook; FlowAssert reads the transitional .xlsx format "
                              "that Excel saves by default")
            raise Refused(f"{path}: no workbook part (_rels/.rels names no office document)")
        part = self._target(office[0], "")
        kind = types.of(part)
        if kind == XLSM_TYPE:
            raise Refused(f"{path}: a macro-enabled workbook (.xlsm); FlowAssert reads .xlsx workbooks only: save a "
                          "copy as an Excel Workbook (.xlsx)")
        if kind != XLSX_TYPE:
            raise Refused(f"{path}: the workbook part has content type {kind or 'none'}, not that of an .xlsx "
                          "workbook")
        if not wb.has(part):
            raise Refused(f"{path}: missing part {part}")
        folder, _, base = part.rpartition("/")
        prefix = folder + "/" if folder else ""
        rels_part = prefix + "_rels/" + base + ".rels"
        workbook_rels = _Relationships()
        if wb.has(rels_part):
            wb.parse(rels_part, workbook_rels)
        book = _WorkbookPart()
        wb.parse(part, book)
        by_id = {}
        for item in workbook_rels.items:
            by_id.setdefault(item[0], item)
        sheets = book.sheets
        if not sheets:
            raise Refused(f"{path}: the workbook has no sheet")
        listed = ", ".join(repr(s[0]) for s in sheets)
        if self.option is None:
            if len(sheets) > 1:
                raise Refused(f"{path}: the workbook has {len(sheets)} sheets ({listed}); choose one with "
                              f"{self.option_name}")
            chosen = sheets[0]
        else:
            matching = [s for s in sheets if s[0] == self.option]
            if not matching:
                raise Refused(f"{path}: no worksheet named {self.option!r}; the workbook has: {listed}")
            chosen = matching[0]
        name, state, rid = chosen
        relation = by_id.get(rid)
        if relation is None or relation[1] != WORKSHEET:
            raise Refused(f"{path}: sheet {name!r} is not a worksheet")
        sheet_part = self._target(relation, prefix)
        styles = _Styles()
        strings = _SharedStrings()
        for kind, handler in ((STYLES, styles), (SHARED_STRINGS, strings)):
            found = [r for r in workbook_rels.items if r[1] == kind]
            if found:
                target = self._target(found[0], prefix)
                if not wb.has(target):
                    raise Refused(f"{path}: missing part {target}")
                wb.parse(target, handler)
        if not wb.has(sheet_part):
            raise Refused(f"{path}: missing part {sheet_part}")
        self.name = name
        self.state = state if state in ("visible", "hidden", "veryHidden") else "visible"
        self.sheet_part = sheet_part
        self.sheet_count = len(sheets)
        self.date1904 = book.date1904
        self.strings = strings.items
        self.xfs = styles.xfs
        self.formats = styles.formats
        self.classes = {}

    def _target(self, relation, base):
        if relation[3] == "External":
            raise Refused(f"{self.path}: external relationship to {relation[2]}")
        target = relation[2] or ""
        pieces = (target[1:] if target.startswith("/") else base + target).split("/")
        resolved = []
        for piece in pieces:
            if piece == "..":
                if resolved:
                    resolved.pop()
            elif piece not in ("", "."):
                resolved.append(piece)
        return "/".join(resolved)

    # ----- Cells -----

    def _class(self, number_format, value):
        known = self.classes.get(number_format)
        if known is None:
            code = self.formats.get(number_format)
            if code is None:
                code = BUILTIN_FORMATS.get(number_format)
            if code is None:
                return None
            classes = []
            for section in _sections(code)[:3]:
                try:
                    classes.append(classify(section))
                except _Unreadable:
                    classes.append(False)
            known = (classes, code)
            self.classes[number_format] = known
        classes, code = known
        if value < 0 and len(classes) > 1:
            return classes[1], code
        if value == 0 and len(classes) > 2:
            return classes[2], code
        return classes[0], code

    def text_of(self, cell):
        """(text, form) of one cell, or a refusal."""
        kind = cell.kind
        v = cell.v
        if not cell.has_v and (kind != "inlineStr" or cell.inline is None):
            if cell.has_f:
                self.refuse(f"cell {cell.name()} {_FORMULA}")
            if kind == "n":
                return "", None
            if kind in ("s", "str", "b", "d", "e", "inlineStr"):
                self.refuse(f"cell {cell.name()} has no value")
        if kind == "n":
            text, form = self._number(cell, v)
        elif kind == "s":
            if not (v.isdigit() and v.isascii()) or int(v) >= len(self.strings):
                self.refuse(f"cell {cell.name()} refers to shared string {v}, which does not exist")
            text, form = self._escaped(self.strings[int(v)], cell), "text"
        elif kind == "inlineStr":
            text, form = self._escaped("".join(cell.inline), cell), "text"
        elif kind == "str":
            text, form = self._escaped(v, cell), "text"
        elif kind == "b":
            if v not in ("0", "1"):
                self.refuse(f"cell {cell.name()} holds {v!r}, which is not a boolean")
            text, form = ("TRUE" if v == "1" else "FALSE"), "boolean"
        elif kind == "d":
            if not _ISO_DATE.fullmatch(v):
                self.refuse(f"cell {cell.name()} holds {v!r}, which is not an ISO 8601 date")
            text, form = v, "date_time"
        elif kind == "e":
            self.refuse(f"cell {cell.name()} holds the error value {v}")
        else:
            self.refuse(f"cell {cell.name()} has the type {kind!r}, which FlowAssert does not read")
        if len(text) > FIELD_LIMIT:
            self.refuse(f"cell {cell.name()} is longer than {FIELD_LIMIT} characters")
        return text, form

    def _escaped(self, text, cell):
        try:
            return unescape(text)
        except _Surrogate:
            self.refuse(f"cell {cell.name()} holds an escaped character that is not a whole character")

    def _number(self, cell, v):
        if not _NUMBER.fullmatch(v):
            self.refuse(f"cell {cell.name()} holds {v!r}, which is not a number")
        x = float(v)
        if x in (_INF, -_INF):
            self.refuse(f"cell {cell.name()} holds {v!r}, which is not a number")
        style = cell.style
        index = 0
        if style is not None:
            if not (style.isdigit() and style.isascii()) or len(style) > 9:
                self.refuse(f"cell {cell.name()} has style {style}, which the workbook does not define")
            index = int(style)
        xfs = self.xfs
        if index < len(xfs):
            number_format = xfs[index]
            if number_format is None:
                self.refuse(f"cell {cell.name()} has style {style}, which the workbook does not define")
        elif index == 0:
            number_format = 0
        else:
            self.refuse(f"cell {cell.name()} has style {style}, which the workbook does not define")
        found = self._class(number_format, x)
        if found is None:
            self.refuse(f"cell {cell.name()} has number format {number_format}, which the workbook does not define")
        kind, code = found
        if kind is False:
            self.refuse(f"cell {cell.name()} has number format {code!r}, which FlowAssert does not read")
        if kind == "date" or kind == "time" or kind == "date_time":
            text = date_text(x, kind, self.date1904)
            if text is None:
                system = "1904" if self.date1904 else "1900"
                self.refuse(f"cell {cell.name()} holds the serial number {number_text(x)}, which is not a date in the "
                            f"{system} date system")
            return text, "date_time"
        return number_text(x), kind

    # ----- Rows -----

    def start_rows(self, on_header, on_row, max_rows):
        self.on_header = on_header
        self.on_row = on_row
        self.max_rows = max_rows
        self.header = None
        self.width = 0
        self.count = 0
        self.sheet = _Sheet(self)

    def before_row(self, number):
        if self.header is None and number > 1:
            self._header([])

    def finish_rows(self):
        if self.header is None:
            self._header([])

    def _header(self, cells):
        names = [""] * (cells[-1][0] if cells else 0)
        for column, text, _, _ in cells:
            names[column - 1] = text
        if not names:
            self.refuse("row 1 is empty; FlowAssert reads the column names from row 1")
        self.header = names
        self.width = len(names)
        self.on_header(names)

    def row(self, number, cells, hidden):
        if number == 1:
            self._header(cells)
            return
        if not cells:
            return
        width = self.width
        for cell in cells:
            if cell[0] > width:
                self.refuse(f"cell {column_letters(cell[0])}{number} has a value beyond the header")
        if self.count == self.max_rows:
            raise Refused(f"{self.path}: exceeds --max-rows limit of {self.max_rows}")
        self.count += 1
        values = [""] * width
        for column, text, _, _ in cells:
            values[column - 1] = text
        self.on_row(values, cells, hidden)


_INF = float("inf")


class XlsxFile:
    """One worksheet of an .xlsx workbook, read strictly and once, as CsvFile reads a CSV file. Iterating yields each
    data row as a dict of the selected columns. After a complete read, `sha256` is the digest of the canonical form,
    `rows` the data rows, `header` row 1, and `member` what the report records under inputs.source_workbook (or
    inputs.destination_workbook)."""

    def __init__(self, path, columns, worksheet=None, max_rows=1_000_000, max_bytes=209_715_200,
                 option="--source-worksheet"):
        self.path = path
        self.columns = list(dict.fromkeys(columns))
        self.worksheet = worksheet
        self.max_rows = max_rows
        self.max_bytes = max_bytes
        self.option = option
        self.sha256 = None
        self.rows = None
        self.header = None
        self.member = None

    def __iter__(self):
        index = None

        def select(values):
            return {c: values[i] for c, i in index}

        def on_header(names):
            nonlocal index
            missing = [c for c in self.columns if c not in names]
            if missing:
                raise Refused(f"{self.path}: missing column {', '.join(missing)}")
            index = [(c, names.index(c)) for c in self.columns]
        return self._read(on_header, select)

    def full_rows(self):
        """The header, then every data row as a full list of texts, read again: for the records to resend."""
        header = []
        rows = self._read(lambda names: header.append(names), lambda values: values)
        first = True
        for values in rows:
            if first:
                yield header[0]
                first = False
            yield values
        if first:
            yield header[0]

    def _read(self, on_header, shape):
        path = self.path
        try:
            f = open(path, "rb")
        except OSError as e:
            raise Refused(f"{path}: {e.strerror}")
        with f:
            try:
                before = os.fstat(f.fileno())
                file_digest = hashlib.sha256()
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    file_digest.update(chunk)
                size = f.tell()
            except OSError as e:
                raise Refused(f"{path}: {e.strerror}")
            workbook = Workbook(path, f, size, self.max_bytes)
            reader = WorksheetReader(workbook, self.worksheet, self.option)
            reader.open()
            digest = hashlib.sha256()
            forms = dict.fromkeys(FORMS, 0)
            counts = [0, 0]   # formula results, hidden rows
            pending = []

            def header(names):
                if len(set(names)) != len(names):
                    raise Refused(f"{path}: repeated column name")
                on_header(names)
                self.header = names
                digest.update(canonical_row(names).encode("utf-8"))

            def row(values, cells, hidden):
                digest.update(canonical_row(values).encode("utf-8"))
                for _, _, form, formula in cells:
                    forms[form] += 1
                    if formula:
                        counts[0] += 1
                if hidden:
                    counts[1] += 1
                pending.append(shape(values))

            reader.start_rows(header, row, self.max_rows)
            for _ in workbook.tokenize(reader.sheet_part, reader.sheet):
                if pending:
                    yield from pending
                    pending.clear()
            reader.finish_rows()
            try:
                after = os.fstat(f.fileno())
            except OSError as e:
                raise Refused(f"{path}: {e.strerror}")
            if (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns) or size != before.st_size:
                raise Refused(f"{path}: changed while it was read; run the check again")
        width = reader.width
        hidden_columns = set()
        for low, high in reader.sheet.hidden_columns:
            hidden_columns.update(range(max(low, 1), min(high, width) + 1))
        self.rows = reader.count
        self.sha256 = digest.hexdigest()
        self.member = {
            # A sheet element without a name attribute is recorded with an empty name, as xlsx.ts records it: the
            # schema's worksheet is a string.
            "format": "xlsx", "worksheet": "" if reader.name is None else reader.name, "worksheet_state": reader.state,
            "sheets": reader.sheet_count,
            "date_system": "1904" if reader.date1904 else "1900", "file_sha256": file_digest.hexdigest(),
            "file_bytes": size, "inflated_bytes": workbook.inflated, "columns": width, "rows": reader.count,
            "cells": dict(forms, formula=counts[0]), "hidden_rows": counts[1],
            "hidden_columns": len(hidden_columns), "merged_ranges": reader.sheet.merged, "values": "stored",
            "canonical_form": CANONICAL_FORM,
        }
