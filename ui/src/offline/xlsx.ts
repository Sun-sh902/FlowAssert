/**
 * Read one worksheet of an .xlsx workbook, strictly and once, as a stream: offline/flowassert_offline/xlsx.py, the
 * reference, written again. docs/design/1.1-excel.md is the design. The ZIP reader, the XML tokenizer, the text of
 * every cell and every refusal are the same as Python's; the parts are inflated by the platform's
 * DecompressionStream("deflate-raw"), and nothing is ever fetched.
 */
import { Refused, type ByteStream } from "./csv";
import { pyRepr } from "./pystr";
import { Sha256 } from "./sha256";

export const FORMATS = ["csv", "xlsx"] as const;
export type Format = (typeof FORMATS)[number];
export const CANONICAL_FORM = "flowassert-xlsx-csv-1";
const MAX_ENTRIES = 10_000;
const TAG_BOUND = 65_536;
const DEPTH_BOUND = 64;
export const FIELD_LIMIT = 131_072;
const MAX_COLUMN = 16_384;
const MAX_ROW = 1_048_576;

const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const PR_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const M_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const OFFICE_DOCUMENT = R_NS + "/officeDocument";
const STRICT_OFFICE_DOCUMENT = "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument";
const WORKSHEET = R_NS + "/worksheet";
const STYLES = R_NS + "/styles";
const SHARED_STRINGS = R_NS + "/sharedStrings";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const XLSM_TYPE = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

/** The built-in number formats ECMA-376 lists for all languages. */
const BUILTIN_FORMATS: ReadonlyMap<number, string> = new Map([
  [0, "General"], [1, "0"], [2, "0.00"], [3, "#,##0"], [4, "#,##0.00"], [9, "0%"], [10, "0.00%"], [11, "0.00E+00"],
  [12, "# ?/?"], [13, "# ??/??"], [14, "mm-dd-yy"], [15, "d-mmm-yy"], [16, "d-mmm"], [17, "mmm-yy"], [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"], [20, "h:mm"], [21, "h:mm:ss"], [22, "m/d/yy h:mm"], [37, "#,##0 ;(#,##0)"],
  [38, "#,##0 ;[Red](#,##0)"], [39, "#,##0.00;(#,##0.00)"], [40, "#,##0.00;[Red](#,##0.00)"], [45, "mm:ss"],
  [46, "[h]:mm:ss"], [47, "mmss.0"], [48, "##0.0E+0"], [49, "@"],
]);
export const FORMS = ["text", "number", "percentage", "date_time", "duration", "boolean"] as const;
export type Form = (typeof FORMS)[number];

const asciiLower = (s: string) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
/** Python's len(): code points, counted only when the UTF-16 length could exceed the limit. */
const codePoints = (s: string, limit: number): number => {
  if (s.length <= limit) return s.length;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
};

// ---------- XML ----------

const NS_START =
  "A-Z_a-z\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u02ff\\u0370-\\u037d\\u037f-\\u1fff\\u200c-\\u200d\\u2070-\\u218f" +
  "\\u2c00-\\u2fef\\u3001-\\ud7ff\\uf900-\\ufdcf\\ufdf0-\\ufffd\\u{10000}-\\u{effff}";
const NS_CHAR = NS_START + "\\-.0-9\\u00b7\\u0300-\\u036f\\u203f-\\u2040";
const NCNAME = `[${NS_START}][${NS_CHAR}]*`;
const QNAME = `${NCNAME}(?::${NCNAME})?`;
const WS = "[ \\t\\n]";
const ATTR = `${WS}+${QNAME}${WS}*=${WS}*(?:"[^"<]*"|'[^'<]*')`;
const TOKEN = new RegExp(`<(${QNAME})((?:${ATTR})*)${WS}*(\\/?)>|<\\/(${QNAME})${WS}*>|([^<]+)`, "uy");
const ATTRS = new RegExp(`${WS}+(${QNAME})${WS}*=${WS}*(?:"([^"<]*)"|'([^'<]*)')`, "gu");
const TAG_SCAN = /<[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/y;
const PI_TARGET = new RegExp(`<\\?(${NCNAME})(?:${WS}|\\?>)`, "uy");
const DECLARATION = new RegExp(
  `^<\\?xml${WS}+version${WS}*=${WS}*(["'])1\\.[0-9]+\\1` +
    `(?:${WS}+encoding${WS}*=${WS}*(["'])([A-Za-z][A-Za-z0-9._-]*)\\2)?` +
    `(?:${WS}+standalone${WS}*=${WS}*(["'])(?:yes|no)\\4)?${WS}*\\?>$`,
  "u",
);
// XML 1.0 forbids these characters, so they are looked for.
// eslint-disable-next-line no-control-regex
const INVALID_CHAR = new RegExp("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\ufffe\\uffff]");
const REFERENCE = /&(?:(lt|gt|amp|quot|apos)|#([0-9]+)|#x([0-9A-Fa-f]+));/y;
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const SPACE = /^[ \t\n]*$/;

class NotWellFormed extends Error {}
class Bound extends Error {}
class NotUtf8 extends Error {}
class Doctype extends Error {}

function xmlChar(code: number): string {
  if (code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff)) {
    return String.fromCodePoint(code);
  }
  throw new NotWellFormed();
}

/** Text with its references replaced; any other & is not well-formed. */
function unreference(text: string): string {
  if (!text.includes("&")) return text;
  let out = "";
  let at = 0;
  for (;;) {
    const amp = text.indexOf("&", at);
    if (amp < 0) return out + text.slice(at);
    out += text.slice(at, amp);
    REFERENCE.lastIndex = amp;
    const m = REFERENCE.exec(text);
    if (!m) throw new NotWellFormed();
    if (m[1]) out += ENTITIES[m[1]];
    else {
      const digits = m[2] ?? m[3]!;
      if (digits.length > 8) throw new NotWellFormed();
      out += xmlChar(parseInt(digits, m[2] !== undefined ? 10 : 16));
    }
    at = REFERENCE.lastIndex;
  }
}

interface Scope {
  names: Map<string, string>;
  cache: Map<string, string>;
}

export interface Handler {
  start(name: string, attrs: Map<string, string>): void;
  end(name: string): void;
  text(piece: string): void;
  /** Complete elements at one depth that a strict pattern recognises, consumed with the effect of their events. */
  fast?: (buf: string, pos: number) => number;
  fastDepth?: number;
}

/** The tokenizer of the XML subset in the design note, as xlsx.Xml. */
export class Xml {
  private buf = "";
  private started = false;
  private rootSeen = false;
  private readonly stack: string[] = [];
  private readonly scopes: Scope[] = [{ names: new Map([["xml", XML_NS]]), cache: new Map() }];

  private readonly h: Handler;

  constructor(handler: Handler) {
    this.h = handler;
  }

  private name(qname: string, scope: Scope, attribute: boolean): string {
    const key = attribute ? "@" + qname : qname;
    const known = scope.cache.get(key);
    if (known !== undefined) return known;
    const colon = qname.indexOf(":");
    let resolved: string;
    if (colon >= 0) {
      const prefix = qname.slice(0, colon);
      const ns = scope.names.get(prefix);
      if (ns === undefined || prefix === "xmlns") throw new NotWellFormed();
      resolved = "{" + ns + "}" + qname.slice(colon + 1);
    } else if (attribute) resolved = qname;
    else {
      const ns = scope.names.get("");
      resolved = !ns ? qname : "{" + ns + "}" + qname;
    }
    scope.cache.set(key, resolved);
    return resolved;
  }

  private start(qname: string, raw: string, closed: boolean): void {
    if (this.rootSeen && !this.stack.length) throw new NotWellFormed();
    let scope = this.scopes[this.scopes.length - 1]!;
    const attrs = new Map<string, string>();
    if (raw) {
      const pairs: [string, string][] = [];
      const seen = new Set<string>();
      let declared: Map<string, string> | null = null;
      ATTRS.lastIndex = 0;
      for (const m of raw.matchAll(ATTRS)) {
        const name = m[1]!;
        let value = m[2] ?? m[3]!;
        if (seen.has(name)) throw new NotWellFormed();
        seen.add(name);
        value = unreference(value.replace(/[\t\n]/g, " "));
        if (name === "xmlns" || name.startsWith("xmlns:")) {
          const prefix = name.slice(6);
          if (prefix === "xmlns" || (prefix === "xml") !== (value === XML_NS) || value === XMLNS_NS || (prefix && !value)) throw new NotWellFormed();
          declared ??= new Map(scope.names);
          declared.set(prefix, value);
        } else pairs.push([name, value]);
      }
      if (declared) scope = { names: declared, cache: new Map() };
      for (const [name, value] of pairs) {
        const expanded = this.name(name, scope, true);
        if (attrs.has(expanded)) throw new NotWellFormed();
        attrs.set(expanded, value);
      }
    }
    const name = this.name(qname, scope, false);
    if (this.stack.length >= DEPTH_BOUND) throw new Bound();
    this.rootSeen = true;
    this.h.start(name, attrs);
    if (closed) this.h.end(name);
    else {
      this.stack.push(qname);
      this.scopes.push(scope);
    }
  }

  private text(text: string): void {
    if (!this.stack.length) {
      if (!SPACE.test(text)) throw new NotWellFormed();
      return;
    }
    if (text.includes("]]>")) throw new NotWellFormed();
    this.h.text(unreference(text));
  }

  private wait(buf: string, pos: number, final: boolean): number {
    if (final) throw new NotWellFormed();
    if (buf.length - pos > TAG_BOUND) throw new Bound();
    return pos;
  }

  feed(data: string, final = false): void {
    const buf = this.buf ? this.buf + data : data;
    let pos = 0;
    const size = buf.length;
    const handler = this.h;
    const fast = handler.fast;
    outer: while (pos < size) {
      if (fast && this.stack.length === handler.fastDepth && buf.charCodeAt(pos) === 60 && this.scopes[this.scopes.length - 1]!.names.get("") === M_NS) {
        const moved = fast(buf, pos);
        if (moved !== pos) {
          pos = moved;
          continue;
        }
      }
      TOKEN.lastIndex = pos;
      const m = TOKEN.exec(buf);
      if (m) {
        const text = m[5];
        const end = TOKEN.lastIndex;
        if (text !== undefined) {
          if (end === size && !final) {
            // The text may go on in the next chunk: hand over what cannot be cut inside a reference or a "]]>".
            let cut = text.lastIndexOf("&");
            cut = cut < 0 || text.indexOf(";", cut) >= 0 ? text.length - 2 : cut;
            if (cut > 0) {
              this.started = true;
              this.text(text.slice(0, cut));
              pos += cut;
            }
            break;
          }
          this.started = true;
          this.text(text);
          pos = end;
          continue;
        }
        if (end - pos > TAG_BOUND) throw new Bound();
        this.started = true;
        if (m[1] !== undefined) this.start(m[1], m[2]!, m[3] === "/");
        else {
          const qname = m[4]!;
          if (!this.stack.length || this.stack[this.stack.length - 1] !== qname) throw new NotWellFormed();
          this.stack.pop();
          const scope = this.scopes.pop()!;
          handler.end(this.name(qname, scope, false));
        }
        pos = end;
        continue;
      }
      const rest = size - pos;
      let end: number;
      if (buf.startsWith("<!--", pos)) {
        end = buf.indexOf("-->", pos + 4);
        if (end < 0) {
          pos = this.wait(buf, pos, final);
          break;
        }
        const content = buf.slice(pos + 4, end);
        if (content.includes("--") || content.endsWith("-")) throw new NotWellFormed();
        end += 3;
      } else if (buf.startsWith("<?", pos)) {
        end = buf.indexOf("?>", pos + 2);
        if (end < 0) {
          pos = this.wait(buf, pos, final);
          break;
        }
        end += 2;
        PI_TARGET.lastIndex = pos;
        const target = PI_TARGET.exec(buf);
        if (!target) throw new NotWellFormed();
        if (asciiLower(target[1]!) === "xml") {
          if (this.started || target[1] !== "xml") throw new NotWellFormed();
          const declaration = DECLARATION.exec(buf.slice(pos, end));
          if (!declaration) throw new NotWellFormed();
          const encoding = declaration[3];
          if (encoding !== undefined && asciiLower(encoding) !== "utf-8") throw new NotUtf8();
        }
      } else if (buf.startsWith("<![CDATA[", pos)) {
        end = buf.indexOf("]]>", pos + 9);
        if (end < 0) {
          pos = this.wait(buf, pos, final);
          break;
        }
        if (!this.stack.length) throw new NotWellFormed();
        if (end + 3 - pos > TAG_BOUND) throw new Bound();
        handler.text(buf.slice(pos + 9, end));
        end += 3;
      } else if (buf.startsWith("<!DOCTYPE", pos)) {
        throw new Doctype();
      } else if (rest < 9 && !final && ["<![CDATA[", "<!DOCTYPE", "<!--"].some((p) => p.slice(0, rest) === buf.slice(pos))) {
        break outer;
      } else {
        TAG_SCAN.lastIndex = pos;
        if (!TAG_SCAN.test(buf) && !final) {
          pos = this.wait(buf, pos, final);
          break;
        }
        throw new NotWellFormed();
      }
      if (end - pos > TAG_BOUND) throw new Bound();
      this.started = true;
      pos = end;
    }
    this.buf = buf.slice(pos);
    if (final && (this.buf || this.stack.length || !this.rootSeen)) throw new NotWellFormed();
  }
}

// ---------- Bytes ----------

/**
 * Where strict UTF-8 decoding, as CPython's, first fails in these bytes (-1 if nowhere), and where the last complete
 * sequence ends: a valid start of a sequence cut off at the end is not a failure until the end of the part.
 */
export function scanUtf8(bytes: Uint8Array): [number, number] {
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const b = bytes[i]!;
    if (b < 0x80) {
      i++;
      continue;
    }
    let need: number;
    let low = 0x80;
    let high = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      if (b === 0xe0) low = 0xa0;
      else if (b === 0xed) high = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      if (b === 0xf0) low = 0x90;
      else if (b === 0xf4) high = 0x8f;
    } else return [i, i];
    for (let k = 1; k <= need; k++) {
      if (i + k >= n) return [-1, i];
      const c = bytes[i + k]!;
      if (k === 1 ? c < low || c > high : c < 0x80 || c > 0xbf) return [i, i];
    }
    i += need + 1;
  }
  return [-1, n];
}

/** A workbook's bytes: random access to any range, as a Blob (a chosen File, or bytes the caller gave). */
export interface XlsxSource {
  name: string;
  blob: Blob;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, crc: number): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

const hex = (bytes: Uint8Array) => {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
};

/** How much of a workbook is read from its file at a time. */
const PIECE = 1 << 20;

/**
 * Bytes [start, end) of a Blob as a stream of pieces, each read with Blob.slice().arrayBuffer(). Not Blob.stream():
 * in Chrome, two streams of one chosen file read at once in a worker (the header and the profile of one worksheet)
 * could leave one of them waiting for ever, piped into a DecompressionStream. A piece is never larger than PIECE.
 */
function sliceStream(blob: Blob, start: number, end: number): ByteStream {
  let at = start;
  return {
    read: async () => {
      if (at >= end) return null;
      const next = Math.min(end, at + PIECE);
      const piece = new Uint8Array(await blob.slice(at, next).arrayBuffer());
      at = next;
      return piece;
    },
    cancel: () => void (at = end),
  };
}

/** Bytes [start, end) of a Blob. */
async function readRange(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  const stream = sliceStream(blob, start, end);
  const pieces: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const chunk = await stream.read();
    if (chunk === null) break;
    pieces.push(chunk.slice());
    length += chunk.length;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}

/** A ByteStream as a web ReadableStream, each chunk its own copy, for pipeThrough. */
function readable(stream: ByteStream): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await stream.read();
      if (chunk === null) controller.close();
      else controller.enqueue(stream.reuses ? chunk.slice() : chunk);
    },
    cancel: () => stream.cancel?.(),
  });
}

/** True where this JavaScript platform can inflate a workbook's parts. */
export const canInflate = () => typeof (globalThis as { DecompressionStream?: unknown }).DecompressionStream === "function";

interface Entry {
  name: string;
  raw: Uint8Array;
  flags: number;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
}

const damaged = (path: string, detail: string) => new Refused(`${path}: damaged ZIP archive (${detail})`);
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** One .xlsx file: its central directory, then its parts on demand, inflated as streams. As xlsx.Workbook. */
export class Workbook {
  remaining: number;
  inflated = 0;
  private entries = new Map<string, Entry>();
  private cdOffset = 0;

  readonly path: string;
  private readonly blob: Blob;
  readonly maxBytes: number;

  private constructor(path: string, blob: Blob, maxBytes: number) {
    this.path = path;
    this.blob = blob;
    this.maxBytes = maxBytes;
    this.remaining = maxBytes;
  }

  static async open(source: XlsxSource, maxBytes: number): Promise<Workbook> {
    const wb = new Workbook(source.name, source.blob, maxBytes);
    await wb.directory();
    return wb;
  }

  private async read(offset: number, length: number): Promise<Uint8Array> {
    const data = await readRange(this.blob, offset, offset + length);
    if (data.length !== length) throw damaged(this.path, "central directory out of bounds");
    return data;
  }

  private async directory(): Promise<void> {
    const path = this.path;
    const size = this.blob.size;
    const head = await this.read(0, Math.min(8, size));
    if (head.length === 8 && OLE.every((b, i) => head[i] === b)) {
      throw new Refused(
        `${path}: not an .xlsx workbook: it is an OLE compound file, the format of legacy .xls workbooks and of password-protected workbooks; save it as an Excel Workbook (.xlsx) without a password`,
      );
    }
    const tailSize = Math.min(size, 65_557);
    const tail = await this.read(size - tailSize, tailSize);
    const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let at = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6 && i + 22 + view.getUint16(i + 20, true) === tail.length) {
        at = i;
        break;
      }
    }
    if (at < 0) throw new Refused(`${path}: not an .xlsx workbook (not a ZIP archive)`);
    const eocd = size - tailSize + at;
    const disk = view.getUint16(at + 4, true);
    const cdDisk = view.getUint16(at + 6, true);
    const here = view.getUint16(at + 8, true);
    const total = view.getUint16(at + 10, true);
    const cdSize = view.getUint32(at + 12, true);
    const cdOffset = view.getUint32(at + 16, true);
    const locator = at >= 20 && tail[at - 20] === 0x50 && tail[at - 19] === 0x4b && tail[at - 18] === 6 && tail[at - 17] === 7;
    if (locator || here === 0xffff || total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new Refused(`${path}: a ZIP64 archive, which FlowAssert does not read`);
    }
    if (disk || cdDisk || here !== total || cdOffset + cdSize > eocd) throw damaged(path, "central directory out of bounds");
    if (total > MAX_ENTRIES) throw new Refused(`${path}: more than ${MAX_ENTRIES} ZIP entries`);
    this.cdOffset = cdOffset;
    const cd = await this.read(cdOffset, cdSize);
    const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    let p = 0;
    for (let n = 0; n < total; n++) {
      if (p + 46 > cd.length || v.getUint32(p, true) !== 0x02014b50) throw damaged(path, "central directory out of bounds");
      const flags = v.getUint16(p + 8, true);
      const method = v.getUint16(p + 10, true);
      const crc = v.getUint32(p + 16, true);
      let csize = v.getUint32(p + 20, true);
      let usize = v.getUint32(p + 24, true);
      const nlen = v.getUint16(p + 28, true);
      const elen = v.getUint16(p + 30, true);
      const clen = v.getUint16(p + 32, true);
      let offset = v.getUint32(p + 42, true);
      if (p + 46 + nlen + elen + clen > cd.length) throw damaged(path, "central directory out of bounds");
      const raw = cd.slice(p + 46, p + 46 + nlen);
      const extra = cd.subarray(p + 46 + nlen, p + 46 + nlen + elen);
      p += 46 + nlen + elen + clen;
      if (usize === 0xffffffff || csize === 0xffffffff || offset === 0xffffffff) [usize, csize, offset] = this.zip64(extra, usize, csize, offset);
      let name: string;
      if (flags & 0x800) {
        try {
          name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
        } catch {
          throw damaged(path, "central directory out of bounds");
        }
      } else name = String.fromCharCode(...raw);
      const folded = asciiLower(name);
      if (this.entries.has(folded)) throw new Refused(`${path}: repeated ZIP entry ${name}`);
      this.entries.set(folded, { name, raw, flags, method, crc, csize, usize, offset });
    }
    if (p !== cd.length) throw damaged(path, "central directory out of bounds");
  }

  private zip64(extra: Uint8Array, usize: number, csize: number, offset: number): [number, number, number] {
    const v = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
    let p = 0;
    while (p + 4 <= extra.length) {
      const tag = v.getUint16(p, true);
      const length = v.getUint16(p + 2, true);
      if (tag === 1) {
        const body = extra.subarray(p + 4, p + 4 + length);
        const b = new DataView(body.buffer, body.byteOffset, body.byteLength);
        let q = 0;
        const values: number[] = [];
        for (const value of [usize, csize, offset]) {
          if (value === 0xffffffff) {
            if (q + 8 > body.length) throw damaged(this.path, "central directory out of bounds");
            const big = b.getBigUint64(q, true);
            if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw damaged(this.path, "central directory out of bounds");
            values.push(Number(big));
            q += 8;
          } else values.push(value);
        }
        return [values[0]!, values[1]!, values[2]!];
      }
      p += 4 + length;
    }
    throw damaged(this.path, "central directory out of bounds");
  }

  has(name: string): boolean {
    return this.entries.has(asciiLower(name));
  }

  /** The inflated bytes of one part, chunk by chunk, checked against the central directory. */
  async *chunks(name: string): AsyncGenerator<Uint8Array> {
    const path = this.path;
    const entry = this.entries.get(asciiLower(name));
    if (!entry) throw new Refused(`${path}: missing part ${name}`);
    if (entry.flags & 1) throw new Refused(`${path}: encrypted ZIP entry ${entry.name}`);
    if (entry.method !== 0 && entry.method !== 8) {
      throw new Refused(`${path}: ZIP entry ${entry.name} uses compression method ${entry.method}; only stored and deflated entries are read`);
    }
    if (entry.usize > this.remaining) throw new Refused(`${path}: inflated parts exceed --max-bytes limit of ${this.maxBytes}`);
    const local = entry.offset + 30 <= this.blob.size ? await this.read(entry.offset, 30) : null;
    if (!local || local[0] !== 0x50 || local[1] !== 0x4b || local[2] !== 3 || local[3] !== 4) throw damaged(path, "entry header does not match the central directory");
    const lv = new DataView(local.buffer, local.byteOffset, local.byteLength);
    const method = lv.getUint16(8, true);
    const nlen = lv.getUint16(26, true);
    const elen = lv.getUint16(28, true);
    const start = entry.offset + 30 + nlen + elen;
    if (method !== entry.method || start + entry.csize > this.cdOffset || !sameBytes(await this.read(entry.offset + 30, nlen), entry.raw)) {
      throw damaged(path, "entry header does not match the central directory");
    }
    const bad = () => damaged(path, `${entry.name} does not inflate to the data the archive records`);
    let stream = readable(sliceStream(this.blob, start, start + entry.csize));
    if (entry.method === 8) {
      if (!canInflate()) throw new Refused(`${path}: this JavaScript platform has no DecompressionStream, so it cannot read an .xlsx workbook`);
      stream = stream.pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
    }
    const reader = stream.getReader();
    let crc = 0;
    let produced = 0;
    try {
      for (;;) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch {
          throw bad();
        }
        if (result.done) break;
        const out = result.value;
        produced += out.length;
        if (produced > entry.usize) throw bad();
        crc = crc32(out, crc);
        yield out;
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
    if (produced !== entry.usize || crc !== entry.crc) throw bad();
    this.remaining -= produced;
    this.inflated += produced;
  }

  /**
   * Inflate one part, decode it as UTF-8 and tokenize it into the handler, pausing after each chunk. Every problem is
   * met in the order of its position in the part, whatever the size of the chunks, as in xlsx.Workbook.tokenize.
   */
  async *tokenize(name: string, handler: Handler): AsyncGenerator<void> {
    const path = this.path;
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    const xml = new Xml(handler);
    let carry = "";
    let first = true;
    let pending: Uint8Array = new Uint8Array(0);
    const feed = (input: string, final: boolean) => {
      let text = input;
      if (first && text) {
        first = false;
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      }
      text = carry + text;
      carry = "";
      if (!final && text.endsWith("\r")) {
        carry = "\r";
        text = text.slice(0, -1);
      }
      const bad = INVALID_CHAR.exec(text);
      if (bad) {
        xml.feed(text.slice(0, bad.index).replace(/\r\n?/g, "\n"));
        throw new NotWellFormed();
      }
      xml.feed(text.replace(/\r\n?/g, "\n"), final);
    };
    const decode = (chunk: Uint8Array, final: boolean): string => {
      let bytes = chunk;
      if (pending.length) {
        bytes = new Uint8Array(pending.length + chunk.length);
        bytes.set(pending);
        bytes.set(chunk, pending.length);
      }
      const [bad, complete] = scanUtf8(bytes);
      if (bad >= 0 || (final && complete < bytes.length)) {
        feed(decoder.decode(bytes.subarray(0, bad >= 0 ? bad : complete)), false);
        throw new NotUtf8();
      }
      pending = bytes.slice(complete);
      return decoder.decode(bytes.subarray(0, complete));
    };
    try {
      for await (const chunk of this.chunks(name)) {
        feed(decode(chunk, false), false);
        yield;
      }
      feed(decode(new Uint8Array(0), true), true);
      yield;
    } catch (e) {
      if (e instanceof NotUtf8) throw new Refused(`${path}: ${name} is not UTF-8`);
      if (e instanceof Doctype) throw new Refused(`${path}: ${name} has a DOCTYPE declaration, which FlowAssert does not read`);
      if (e instanceof NotWellFormed) throw new Refused(`${path}: ${name} is not well-formed XML`);
      if (e instanceof Bound) {
        throw new Refused(`${path}: ${name} exceeds a reading bound (a tag longer than ${TAG_BOUND} characters, or elements nested deeper than ${DEPTH_BOUND})`);
      }
      throw e;
    }
  }

  /** The inflated size of a part, from the central directory, or null when it is not in the archive. */
  sizeOf(name: string): number | null {
    return this.entries.get(asciiLower(name))?.usize ?? null;
  }

  async parse(name: string, handler: Handler): Promise<void> {
    for await (const _ of this.tokenize(name, handler)) void _;
  }
}

// ---------- Package parts ----------

/** A handler that knows the path of open elements. */
abstract class PathHandler implements Handler {
  path: string[] = [];
  fast?: (buf: string, pos: number) => number;
  fastDepth?: number;
  start(name: string, attrs: Map<string, string>): void {
    this.path.push(name);
    this.onStart(name, attrs);
  }
  end(name: string): void {
    this.onEnd(name);
    this.path.pop();
  }
  text(_piece: string): void {}
  onStart(_name: string, _attrs: Map<string, string>): void {}
  onEnd(_name: string): void {}
}

class ContentTypes extends PathHandler {
  defaults = new Map<string, string | undefined>();
  overrides = new Map<string, string | undefined>();
  onStart(name: string, attrs: Map<string, string>): void {
    if (this.path.length === 2 && this.path[0] === `{${CT_NS}}Types`) {
      if (name === `{${CT_NS}}Default` && attrs.has("Extension")) {
        const key = asciiLower(attrs.get("Extension")!);
        if (!this.defaults.has(key)) this.defaults.set(key, attrs.get("ContentType"));
      } else if (name === `{${CT_NS}}Override` && attrs.has("PartName")) {
        const key = asciiLower(attrs.get("PartName")!);
        if (!this.overrides.has(key)) this.overrides.set(key, attrs.get("ContentType"));
      }
    }
  }
  of(part: string): string | undefined {
    const found = this.overrides.get("/" + asciiLower(part));
    if (found !== undefined) return found;
    const dot = part.lastIndexOf(".");
    return this.defaults.get(asciiLower(dot < 0 ? part : part.slice(dot + 1)));
  }
}

type Relation = [string | undefined, string | undefined, string | undefined, string | undefined];

class Relationships extends PathHandler {
  items: Relation[] = [];
  onStart(name: string, attrs: Map<string, string>): void {
    if (this.path.length === 2 && this.path[0] === `{${PR_NS}}Relationships` && name === `{${PR_NS}}Relationship`) {
      this.items.push([attrs.get("Id"), attrs.get("Type"), attrs.get("Target"), attrs.get("TargetMode")]);
    }
  }
}

const isTrue = (value: string | undefined) => value === "1" || value === "true";
const DIGITS = /^[0-9]+$/;

class WorkbookPart extends PathHandler {
  sheets: [string | undefined, string, string | undefined][] = [];
  date1904 = false;
  onStart(name: string, attrs: Map<string, string>): void {
    const path = this.path;
    if (path[0] !== `{${M_NS}}workbook`) return;
    if (path.length === 2 && name === `{${M_NS}}workbookPr`) this.date1904 = isTrue(attrs.get("date1904"));
    else if (path.length === 3 && path[1] === `{${M_NS}}sheets` && name === `{${M_NS}}sheet`) {
      this.sheets.push([attrs.get("name"), attrs.get("state") || "visible", attrs.get(`{${R_NS}}id`)]);
    }
  }
}

class Styles extends PathHandler {
  formats = new Map<number, string>();
  xfs: (number | null)[] = [];
  onStart(name: string, attrs: Map<string, string>): void {
    const path = this.path;
    if (path[0] !== `{${M_NS}}styleSheet` || path.length !== 3) return;
    if (path[1] === `{${M_NS}}numFmts` && name === `{${M_NS}}numFmt`) {
      const number = attrs.get("numFmtId");
      if (number !== undefined && DIGITS.test(number) && number.length < 10 && attrs.has("formatCode")) {
        const key = parseInt(number, 10);
        if (!this.formats.has(key)) this.formats.set(key, attrs.get("formatCode")!);
      }
    } else if (path[1] === `{${M_NS}}cellXfs` && name === `{${M_NS}}xf`) {
      const number = attrs.get("numFmtId") ?? "0";
      this.xfs.push(DIGITS.test(number) && number.length < 10 ? parseInt(number, 10) : null);
    }
  }
}

const SST = `{${M_NS}}sst`;
const FAST_ATTRS = '(?: (?!xmlns)[A-Za-z]+="[^"<&\\t\\n]*")*';
const FAST_STRING = /<si><t(?: xml:space="[^"<&\t\n]*")?(?:>([^<&]*)<\/t>|\/>)<\/si>/y;
const FAST_CELLS = new RegExp(`<c(${FAST_ATTRS})(?:\\/>|>(?:<f(${FAST_ATTRS})(?:\\/>|>[^<&]*<\\/f>))?(?:<v>([^<&]*)<\\/v>)?<\\/c>)`, "g");
const FAST_ROW = new RegExp(
  `<row(${FAST_ATTRS})(?:\\/>|>((?:<c${FAST_ATTRS}(?:\\/>|>(?:<f${FAST_ATTRS}(?:\\/>|>[^<&]*<\\/f>))?(?:<v>[^<&]*<\\/v>)?<\\/c>))*)<\\/row>)`,
  "y",
);
const FAST_ATTR = / ([A-Za-z]+)="([^"]*)"/g;

/** The attributes of a fast-path tag, or null when one repeats (the tokenizer then refuses it). */
function fastAttrs(text: string | undefined): Map<string, string> | null {
  const attrs = new Map<string, string>();
  if (!text) return attrs;
  let n = 0;
  for (const m of text.matchAll(FAST_ATTR)) {
    attrs.set(m[1]!, m[2]!);
    n++;
  }
  return attrs.size === n ? attrs : null;
}

/** The shared string table, kept as one string and offsets, so a million items cost no million objects. */
class SharedStrings extends PathHandler {
  private joined: string[] = [];
  private piecesLength = 0;
  private texts: string[] = [];
  private starts: number[] = [0];
  private pieces: string[] | null = null;
  private collect = false;
  fastDepth = 1;
  constructor() {
    super();
    this.fast = (buf, pos) => {
      if (this.pieces !== null || this.path.length !== 1 || this.path[0] !== SST) return pos;
      for (;;) {
        FAST_STRING.lastIndex = pos;
        const m = FAST_STRING.exec(buf);
        if (!m || m[0].includes("]]>")) return pos;
        this.add(m[1] ?? "");
        pos = FAST_STRING.lastIndex;
      }
    };
  }
  get count(): number {
    return this.starts.length - 1;
  }
  private add(text: string) {
    this.joined.push(text);
    this.piecesLength += text.length;
    this.starts.push(this.starts[this.starts.length - 1]! + text.length);
    if (this.joined.length >= 4096) this.flush();
  }
  private flush() {
    if (this.joined.length) this.texts.push(this.joined.join(""));
    this.joined = [];
  }
  /** The table, ready for lookups. */
  table(): (index: number) => string {
    this.flush();
    const all = this.texts.join("");
    this.texts = [];
    const starts = Float64Array.from(this.starts);
    this.starts = [];
    return (index) => all.slice(starts[index]!, starts[index + 1]!);
  }
  onStart(name: string): void {
    const path = this.path;
    if (path[0] !== SST) return;
    const depth = path.length;
    if (depth === 2 && name === `{${M_NS}}si`) this.pieces = [];
    else if (this.pieces !== null && name === `{${M_NS}}t` && (depth === 3 || (depth === 4 && path[2] === `{${M_NS}}r`))) this.collect = true;
  }
  onEnd(name: string): void {
    if (this.collect && name === `{${M_NS}}t`) this.collect = false;
    else if (this.path.length === 2 && name === `{${M_NS}}si` && this.pieces !== null) {
      this.add(this.pieces.join(""));
      this.pieces = null;
    }
  }
  text(piece: string): void {
    if (this.collect) this.pieces!.push(piece);
  }
}

// ---------- Cell text ----------

const ESCAPE = /_x([0-9A-Fa-f]{4})_/g;
const NUMBER = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;
const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?(?:Z|[+-][0-9]{2}:[0-9]{2})?)?$/;
const CELL_REF = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
const ROW_NUMBER = /^[1-9][0-9]{0,6}$/;
const ELAPSED = /^(?:h+|m+|s+)$/;

class Surrogate extends Error {}
class Unreadable extends Error {}

export function unescape(text: string): string {
  if (!text.includes("_x")) return text;
  return text.replace(ESCAPE, (_m, digits: string) => {
    const code = parseInt(digits, 16);
    if (code >= 0xd800 && code <= 0xdfff) throw new Surrogate();
    return String.fromCharCode(code);
  });
}

/** ECMAScript's Number::toString, which xlsx.number_text writes in Python. */
export const numberText = (x: number) => String(x);

function clean(section: string): [string, boolean] {
  let out = "";
  let elapsed = false;
  let i = 0;
  while (i < section.length) {
    const c = section[i]!;
    if (c === '"') {
      const j = section.indexOf('"', i + 1);
      if (j < 0) throw new Unreadable();
      i = j + 1;
    } else if (c === "\\" || c === "_" || c === "*") {
      // Python's i += 2 skips the next code point; a surrogate pair is one.
      const next = section.codePointAt(i + 1);
      i += 1 + (next !== undefined && next > 0xffff ? 2 : 1);
    } else if (c === "[") {
      const j = section.indexOf("]", i);
      if (j < 0) throw new Unreadable();
      if (ELAPSED.test(asciiLower(section.slice(i + 1, j)))) elapsed = true;
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return [asciiLower(out).replaceAll("general", ""), elapsed];
}

function sections(code: string): string[] {
  const found: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "\\") i++;
    else if (!quoted && c === ";") {
      found.push(code.slice(start, i));
      start = i + 1;
    }
  }
  found.push(code.slice(start));
  return found;
}

export type FormatClass = "number" | "percentage" | "duration" | "date" | "time" | "date_time";

/** The class of one section of a number format, as xlsx.classify. */
export function classify(section: string): FormatClass {
  const [cleaned, elapsed] = clean(section);
  const letters: string[] = [];
  let i = 0;
  const size = cleaned.length;
  while (i < size) {
    const c = cleaned[i]!;
    if (cleaned.startsWith("am/pm", i)) {
      letters.push("a");
      i += 5;
      continue;
    }
    if (cleaned.startsWith("a/p", i)) {
      letters.push("a");
      i += 3;
      continue;
    }
    if (c >= "a" && c <= "z") {
      let j = i;
      while (j < size && cleaned[j] === c) j++;
      if (c === "e" && j < size && (cleaned[j] === "+" || cleaned[j] === "-")) {
        i = j + 1;
        continue;
      }
      if (!"ymdhse".includes(c)) throw new Unreadable();
      letters.push(c);
      i = j;
      continue;
    }
    i++;
  }
  let hasDate = false;
  let hasTime = false;
  letters.forEach((c, k) => {
    if (c === "m") {
      if ((k > 0 && letters[k - 1] === "h") || (k + 1 < letters.length && letters[k + 1] === "s")) hasTime = true;
      else hasDate = true;
    } else if ("yde".includes(c)) hasDate = true;
    else hasTime = true;
  });
  if (elapsed) return "duration";
  if (hasDate && hasTime) return "date_time";
  if (hasDate) return "date";
  if (hasTime) return "time";
  return cleaned.includes("%") ? "percentage" : "number";
}

const DAY_MS = 86_400_000;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function clock(ms: number): string {
  const millis = ms % 1000;
  const seconds = (ms - millis) / 1000;
  const text = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
  return millis ? `${text}.${pad(millis, 3)}` : text;
}

/** The ISO 8601 text of a serial number, or null when it is not a date in the date system. */
export function dateText(x: number, kind: "date" | "time" | "date_time", date1904: boolean): string | null {
  if (x < 0) return null;
  const total = Math.floor(x * 86_400_000 + 0.5);
  const rest = total % DAY_MS;
  const days = (total - rest) / DAY_MS;
  if (kind === "time" && days === 0) return clock(rest);
  if (days > (date1904 ? 2_957_003 : 2_958_465)) return null;
  let base: number;
  if (date1904) base = Date.UTC(1904, 0, 1);
  else if (days === 0 || days === 60) return null;
  else base = days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const when = new Date(base + days * DAY_MS);
  const day = `${pad(when.getUTCFullYear(), 4)}-${pad(when.getUTCMonth() + 1)}-${pad(when.getUTCDate())}`;
  if (kind === "date" && rest === 0) return day;
  return day + "T" + clock(rest);
}

export function columnLetters(number: number): string {
  let letters = "";
  while (number) {
    const rest = (number - 1) % 26;
    number = (number - 1 - rest) / 26;
    letters = String.fromCharCode(65 + rest) + letters;
  }
  return letters;
}

const columnCache = new Map<string, number>();
function columnOf(letters: string): number {
  let number = columnCache.get(letters);
  if (number === undefined) {
    number = 0;
    for (let i = 0; i < letters.length; i++) number = number * 26 + letters.charCodeAt(i) - 64;
    if (columnCache.size < 20_000) columnCache.set(letters, number);
  }
  return number;
}

const canonicalCell = (value: string) => (/[,"\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value);

/** One row of the canonical form (flowassert-xlsx-csv-1, the text of flowassert-sheet-csv-1), with its line feed. */
export function canonicalRow(row: readonly string[]): string {
  if (row.length === 1 && row[0] === "") return '""\n';
  return row.map(canonicalCell).join(",") + "\n";
}

const WS_ = `{${M_NS}}worksheet`;
const SHEET_DATA = `{${M_NS}}sheetData`;
const ROW = `{${M_NS}}row`;
const C = `{${M_NS}}c`;
const V = `{${M_NS}}v`;
const F = `{${M_NS}}f`;
const IS = `{${M_NS}}is`;
const T = `{${M_NS}}t`;
const R = `{${M_NS}}r`;
const COLS = `{${M_NS}}cols`;
const COL = `{${M_NS}}col`;
const MERGE_CELLS = `{${M_NS}}mergeCells`;
const MERGE_CELL = `{${M_NS}}mergeCell`;

interface CellState {
  ref: string | undefined;
  column: number;
  row: number;
  kind: string;
  style: string | undefined;
  hasV: boolean;
  hasF: boolean;
  inline: string[] | null;
  v: string | null;
}
const cellName = (cell: CellState) => cell.ref ?? columnLetters(cell.column) + String(cell.row);

/** A cell of a row: column, text, form, whether it is a formula's result. */
export type RowCell = [number, string, Form, boolean];

class Sheet implements Handler {
  path: string[] = [];
  inData = false;
  rowNumber = 0;
  rowHidden = false;
  cells: RowCell[] | null = null;
  column = 0;
  cell: CellState | null = null;
  collect: string[] | null = null;
  collectDepth = 0;
  size = 0;
  hiddenColumns: [number, number][] = [];
  merged = 0;
  fastDepth = 2;
  fast: (buf: string, pos: number) => number;

  private readonly r: WorksheetReader;

  constructor(reader: WorksheetReader) {
    this.r = reader;
    this.fast = (buf, pos) => this.fastRows(buf, pos);
  }

  /** Whole rows in the common form, handled by the same methods the events reach. */
  private fastRows(buf: string, pos: number): number {
    if (!this.inData || this.cells !== null) return pos;
    for (;;) {
      FAST_ROW.lastIndex = pos;
      const m = FAST_ROW.exec(buf);
      if (!m) return pos;
      if (m[0].includes("]]>")) return pos;
      const attrs = fastAttrs(m[1]);
      if (!attrs) return pos;
      const parsed: [Map<string, string>, boolean, string | undefined][] = [];
      if (m[2]) {
        for (const c of m[2].matchAll(FAST_CELLS)) {
          const cellAttrs = fastAttrs(c[1]);
          const formula = c[2];
          if (!cellAttrs || (formula && !fastAttrs(formula))) return pos;
          parsed.push([cellAttrs, formula !== undefined, c[3]]);
        }
      }
      this.row(attrs);
      for (const [cellAttrs, formula, v] of parsed) {
        this.openCell(cellAttrs);
        const cell = this.cell!;
        cell.hasF = formula;
        if (v !== undefined) {
          cell.hasV = true;
          if (codePoints(v, 7 * FIELD_LIMIT) > 7 * FIELD_LIMIT) this.r.refuse(`cell ${cellName(cell)} is longer than ${FIELD_LIMIT} characters`);
          cell.v = v;
        }
        this.cell = null;
        const [text, form] = this.r.textOf(cell);
        if (text) this.cells!.push([cell.column, text, form!, cell.hasF]);
      }
      this.r.row(this.rowNumber, this.cells!, this.rowHidden);
      this.cells = null;
      pos = FAST_ROW.lastIndex;
    }
  }

  start(name: string, attrs: Map<string, string>): void {
    const path = this.path;
    const depth = path.length;
    path.push(name);
    if (depth === 3) {
      if (name === C && this.cells !== null) this.openCell(attrs);
    } else if (depth === 4) {
      const cell = this.cell;
      if (cell) {
        if (name === V) {
          cell.hasV = true;
          this.startCollect();
        } else if (name === F) cell.hasF = true;
        else if (name === IS) cell.inline = [];
      }
    } else if (depth === 2) {
      if (this.inData) {
        if (name === ROW) this.row(attrs);
      } else if (name === COL && path[1] === COLS) this.col(attrs);
      else if (name === MERGE_CELL && path[1] === MERGE_CELLS) this.merged++;
    } else if (depth === 1) {
      if (name === SHEET_DATA && path[0] === WS_) this.inData = true;
    } else if ((depth === 5 || depth === 6) && name === T && this.cell !== null && this.cell.inline !== null && path[4] === IS && (depth === 5 || path[5] === R)) {
      this.startCollect();
    }
  }

  private startCollect() {
    this.collect = [];
    this.collectDepth = this.path.length;
    this.size = 0;
  }

  end(name: string): void {
    const path = this.path;
    const depth = path.length;
    if (this.collect !== null && depth === this.collectDepth) {
      const text = this.collect.join("");
      this.collect = null;
      if (name === V) this.cell!.v = text;
      else this.cell!.inline!.push(text);
    } else if (depth === 4) {
      if (name === C && this.cell !== null) {
        const cell = this.cell;
        this.cell = null;
        const [text, form] = this.r.textOf(cell);
        if (text) this.cells!.push([cell.column, text, form!, cell.hasF]);
      }
    } else if (depth === 3) {
      if (name === ROW && this.cells !== null) {
        this.r.row(this.rowNumber, this.cells, this.rowHidden);
        this.cells = null;
      }
    } else if (depth === 2 && name === SHEET_DATA) this.inData = false;
    path.pop();
  }

  text(piece: string): void {
    if (this.collect !== null && this.path.length === this.collectDepth) {
      this.size += piece.length;
      // Python counts code points; UTF-16 units are never fewer, so the exact count is needed only past the bound.
      if (this.size > 7 * FIELD_LIMIT && codePoints(this.collect.join("") + piece, 7 * FIELD_LIMIT) > 7 * FIELD_LIMIT) {
        this.r.refuse(`cell ${cellName(this.cell!)} is longer than ${FIELD_LIMIT} characters`);
      }
      this.collect.push(piece);
    }
  }

  private row(attrs: Map<string, string>): void {
    const given = attrs.get("r");
    let number: number;
    if (given === undefined) number = this.rowNumber + 1;
    else {
      if (!ROW_NUMBER.test(given) || parseInt(given, 10) > MAX_ROW) this.r.refuse(`row ${pyRepr(given)} is not a row of a worksheet`);
      number = parseInt(given, 10);
    }
    if (number <= this.rowNumber || number > MAX_ROW) this.r.refuse(`row ${number} is out of order`);
    this.r.beforeRow(number);
    this.rowNumber = number;
    this.rowHidden = isTrue(attrs.get("hidden"));
    this.cells = [];
    this.column = 0;
  }

  private openCell(attrs: Map<string, string>): void {
    const ref = attrs.get("r");
    let column: number;
    if (ref === undefined) {
      column = this.column + 1;
      if (column > MAX_COLUMN) this.r.refuse(`cell reference ${pyRepr(columnLetters(column) + String(this.rowNumber))} is not a cell of a worksheet`);
    } else {
      const m = CELL_REF.exec(ref);
      if (!m) this.r.refuse(`cell reference ${pyRepr(ref)} is not a cell of a worksheet`);
      column = columnOf(m![1]!);
      const row = parseInt(m![2]!, 10);
      if (column > MAX_COLUMN || row > MAX_ROW) this.r.refuse(`cell reference ${pyRepr(ref)} is not a cell of a worksheet`);
      if (row !== this.rowNumber || column <= this.column) this.r.refuse(`cell ${ref} is out of order`);
    }
    this.column = column;
    this.cell = { ref, column, row: this.rowNumber, kind: attrs.get("t") ?? "n", style: attrs.get("s"), hasV: false, hasF: false, inline: null, v: null };
  }

  private col(attrs: Map<string, string>): void {
    if (isTrue(attrs.get("hidden"))) {
      const low = attrs.get("min") ?? "";
      const high = attrs.get("max") ?? "";
      if (ROW_NUMBER.test(low) && ROW_NUMBER.test(high)) this.hiddenColumns.push([parseInt(low, 10), parseInt(high, 10)]);
    }
  }
}

const FORMULA = "has a formula without a cached value; open and save the workbook in a spreadsheet program, which stores the values";

/** Reads the package parts of a workbook, chooses the worksheet, and reads its rows. As xlsx.WorksheetReader. */
export class WorksheetReader {
  name: string | null = null;
  state = "visible";
  sheetPart = "";
  sheetCount = 0;
  date1904 = false;
  private string: (index: number) => string = () => "";
  private stringCount = 0;
  private xfs: (number | null)[] = [];
  private formats = new Map<number, string>();
  private classes = new Map<number, [(FormatClass | false)[], string]>();
  header: string[] | null = null;
  width = 0;
  count = 0;
  sheet: Sheet | null = null;
  private onHeader: (names: string[]) => void = () => undefined;
  private onRow: (values: string[], cells: RowCell[], hidden: boolean) => void = () => undefined;
  private maxRows = 0;
  readonly path: string;
  readonly wb: Workbook;
  private readonly option: string | undefined;
  private readonly optionName: string;

  constructor(wb: Workbook, option: string | undefined, optionName: string) {
    this.wb = wb;
    this.option = option;
    this.optionName = optionName;
    this.path = wb.path;
  }

  refuse(message: string): never {
    throw new Refused(`${this.path}: worksheet ${pyRepr(this.name)}: ${message}`);
  }

  /** The worksheets the workbook lists, after open(): name, state and the size of its part. */
  sheetsListed: { name: string; state: string; bytes: number | null; worksheet: boolean }[] = [];

  private sheets: [string | undefined, string, string | undefined][] = [];
  private byId = new Map<string | undefined, Relation>();
  private prefix = "";
  private workbookRels: Relationships | null = null;
  private book: WorkbookPart | null = null;

  async open(): Promise<void> {
    await this.listed();
    await this.choose();
  }

  /** The package parts up to the list of sheets, as open() reads them, with sheetsListed filled in. */
  async listed(): Promise<void> {
    const wb = this.wb;
    const path = this.path;
    if (!wb.has("[Content_Types].xml")) throw new Refused(`${path}: missing part [Content_Types].xml`);
    const types = new ContentTypes();
    await wb.parse("[Content_Types].xml", types);
    if (!wb.has("_rels/.rels")) throw new Refused(`${path}: missing part _rels/.rels`);
    const rels = new Relationships();
    await wb.parse("_rels/.rels", rels);
    const office = rels.items.filter((r) => r[1] === OFFICE_DOCUMENT);
    if (!office.length) {
      if (rels.items.some((r) => r[1] === STRICT_OFFICE_DOCUMENT)) {
        throw new Refused(`${path}: a Strict Open XML workbook; FlowAssert reads the transitional .xlsx format that Excel saves by default`);
      }
      throw new Refused(`${path}: no workbook part (_rels/.rels names no office document)`);
    }
    const part = this.target(office[0]!, "");
    const kind = types.of(part);
    if (kind === XLSM_TYPE) throw new Refused(`${path}: a macro-enabled workbook (.xlsm); FlowAssert reads .xlsx workbooks only: save a copy as an Excel Workbook (.xlsx)`);
    if (kind !== XLSX_TYPE) throw new Refused(`${path}: the workbook part has content type ${kind || "none"}, not that of an .xlsx workbook`);
    if (!wb.has(part)) throw new Refused(`${path}: missing part ${part}`);
    const slash = part.lastIndexOf("/");
    const prefix = slash >= 0 ? part.slice(0, slash) + "/" : "";
    const relsPart = prefix + "_rels/" + part.slice(slash + 1) + ".rels";
    const workbookRels = new Relationships();
    if (wb.has(relsPart)) await wb.parse(relsPart, workbookRels);
    const book = new WorkbookPart();
    await wb.parse(part, book);
    const byId = new Map<string | undefined, Relation>();
    for (const item of workbookRels.items) if (!byId.has(item[0])) byId.set(item[0], item);
    const sheets = book.sheets;
    if (!sheets.length) throw new Refused(`${path}: the workbook has no sheet`);
    this.sheetsListed = sheets.map(([name, state, rid]) => {
      const relation = byId.get(rid);
      let bytes: number | null = null;
      if (relation && relation[3] !== "External") bytes = wb.sizeOf(this.target(relation, prefix));
      return { name: name ?? "", state, bytes, worksheet: relation?.[1] === WORKSHEET };
    });
    this.sheets = sheets;
    this.byId = byId;
    this.prefix = prefix;
    this.workbookRels = workbookRels;
    this.book = book;
  }

  /** Choose the worksheet, then read the styles and the shared strings, as open() does after listed(). */
  async choose(): Promise<void> {
    const wb = this.wb;
    const path = this.path;
    const sheets = this.sheets;
    const byId = this.byId;
    const prefix = this.prefix;
    const workbookRels = this.workbookRels!;
    const book = this.book!;
    const listed = sheets.map((s) => pyRepr(s[0])).join(", ");
    let chosen: (typeof sheets)[number];
    if (this.option === undefined) {
      if (sheets.length > 1) throw new Refused(`${path}: the workbook has ${sheets.length} sheets (${listed}); choose one with ${this.optionName}`);
      chosen = sheets[0]!;
    } else {
      const matching = sheets.filter((s) => s[0] === this.option);
      if (!matching.length) throw new Refused(`${path}: no worksheet named ${pyRepr(this.option)}; the workbook has: ${listed}`);
      chosen = matching[0]!;
    }
    const [name, state, rid] = chosen;
    const relation = byId.get(rid);
    if (!relation || relation[1] !== WORKSHEET) throw new Refused(`${path}: sheet ${pyRepr(name)} is not a worksheet`);
    const sheetPart = this.target(relation, prefix);
    const styles = new Styles();
    const strings = new SharedStrings();
    for (const [type, handler] of [[STYLES, styles], [SHARED_STRINGS, strings]] as const) {
      const found = workbookRels.items.filter((r) => r[1] === type);
      if (found.length) {
        const target = this.target(found[0]!, prefix);
        if (!wb.has(target)) throw new Refused(`${path}: missing part ${target}`);
        await wb.parse(target, handler);
      }
    }
    if (!wb.has(sheetPart)) throw new Refused(`${path}: missing part ${sheetPart}`);
    this.name = name ?? null;
    this.state = state === "visible" || state === "hidden" || state === "veryHidden" ? state : "visible";
    this.sheetPart = sheetPart;
    this.sheetCount = sheets.length;
    this.date1904 = book.date1904;
    this.stringCount = strings.count;
    this.string = strings.table();
    this.xfs = styles.xfs;
    this.formats = styles.formats;
  }

  private target(relation: Relation, base: string): string {
    if (relation[3] === "External") throw new Refused(`${this.path}: external relationship to ${relation[2]}`);
    const target = relation[2] ?? "";
    const resolved: string[] = [];
    for (const piece of (target.startsWith("/") ? target.slice(1) : base + target).split("/")) {
      if (piece === "..") resolved.pop();
      else if (piece !== "" && piece !== ".") resolved.push(piece);
    }
    return resolved.join("/");
  }

  private classOf(numberFormat: number, value: number): [FormatClass | false, string] | null {
    let known = this.classes.get(numberFormat);
    if (!known) {
      const code = this.formats.get(numberFormat) ?? BUILTIN_FORMATS.get(numberFormat);
      if (code === undefined) return null;
      const classes = sections(code).slice(0, 3).map((s) => {
        try {
          return classify(s);
        } catch (e) {
          if (e instanceof Unreadable) return false as const;
          throw e;
        }
      });
      known = [classes, code];
      this.classes.set(numberFormat, known);
    }
    const [classes, code] = known;
    if (value < 0 && classes.length > 1) return [classes[1]!, code];
    if (value === 0 && classes.length > 2) return [classes[2]!, code];
    return [classes[0]!, code];
  }

  textOf(cell: CellState): [string, Form | null] {
    const kind = cell.kind;
    const v = cell.v;
    if (!cell.hasV && (kind !== "inlineStr" || cell.inline === null)) {
      if (cell.hasF) this.refuse(`cell ${cellName(cell)} ${FORMULA}`);
      if (kind === "n") return ["", null];
      if (["s", "str", "b", "d", "e", "inlineStr"].includes(kind)) this.refuse(`cell ${cellName(cell)} has no value`);
    }
    let text: string;
    let form: Form;
    if (kind === "n") [text, form] = this.number(cell, v!);
    else if (kind === "s") {
      if (!DIGITS.test(v!) || Number(v) >= this.stringCount) this.refuse(`cell ${cellName(cell)} refers to shared string ${v}, which does not exist`);
      [text, form] = [this.escaped(this.string(Number(v)), cell), "text"];
    } else if (kind === "inlineStr") [text, form] = [this.escaped(cell.inline!.join(""), cell), "text"];
    else if (kind === "str") [text, form] = [this.escaped(v!, cell), "text"];
    else if (kind === "b") {
      if (v !== "0" && v !== "1") this.refuse(`cell ${cellName(cell)} holds ${pyRepr(v)}, which is not a boolean`);
      [text, form] = [v === "1" ? "TRUE" : "FALSE", "boolean"];
    } else if (kind === "d") {
      if (!ISO_DATE.test(v!)) this.refuse(`cell ${cellName(cell)} holds ${pyRepr(v)}, which is not an ISO 8601 date`);
      [text, form] = [v!, "date_time"];
    } else if (kind === "e") this.refuse(`cell ${cellName(cell)} holds the error value ${v}`);
    else this.refuse(`cell ${cellName(cell)} has the type ${pyRepr(kind)}, which FlowAssert does not read`);
    if (codePoints(text, FIELD_LIMIT) > FIELD_LIMIT) this.refuse(`cell ${cellName(cell)} is longer than ${FIELD_LIMIT} characters`);
    return [text, form];
  }

  private escaped(text: string, cell: CellState): string {
    try {
      return unescape(text);
    } catch (e) {
      if (e instanceof Surrogate) this.refuse(`cell ${cellName(cell)} holds an escaped character that is not a whole character`);
      throw e;
    }
  }

  private number(cell: CellState, v: string): [string, Form] {
    if (!NUMBER.test(v)) this.refuse(`cell ${cellName(cell)} holds ${pyRepr(v)}, which is not a number`);
    const x = Number(v);
    if (!Number.isFinite(x)) this.refuse(`cell ${cellName(cell)} holds ${pyRepr(v)}, which is not a number`);
    const style = cell.style;
    let index = 0;
    if (style !== undefined) {
      if (!DIGITS.test(style) || style.length > 9) this.refuse(`cell ${cellName(cell)} has style ${style}, which the workbook does not define`);
      index = parseInt(style, 10);
    }
    let numberFormat: number;
    if (index < this.xfs.length) {
      const found = this.xfs[index]!;
      if (found === null) this.refuse(`cell ${cellName(cell)} has style ${style}, which the workbook does not define`);
      numberFormat = found;
    } else if (index === 0) numberFormat = 0;
    else this.refuse(`cell ${cellName(cell)} has style ${style}, which the workbook does not define`);
    const found = this.classOf(numberFormat, x);
    if (!found) this.refuse(`cell ${cellName(cell)} has number format ${numberFormat}, which the workbook does not define`);
    const [kind, code] = found;
    if (kind === false) this.refuse(`cell ${cellName(cell)} has number format ${pyRepr(code)}, which FlowAssert does not read`);
    if (kind === "date" || kind === "time" || kind === "date_time") {
      const text = dateText(x, kind, this.date1904);
      if (text === null) {
        this.refuse(`cell ${cellName(cell)} holds the serial number ${numberText(x)}, which is not a date in the ${this.date1904 ? "1904" : "1900"} date system`);
      }
      return [text, "date_time"];
    }
    return [numberText(x), kind];
  }

  startRows(onHeader: (names: string[]) => void, onRow: (values: string[], cells: RowCell[], hidden: boolean) => void, maxRows: number): Sheet {
    this.onHeader = onHeader;
    this.onRow = onRow;
    this.maxRows = maxRows;
    this.header = null;
    this.width = 0;
    this.count = 0;
    this.sheet = new Sheet(this);
    return this.sheet;
  }

  beforeRow(number: number): void {
    if (this.header === null && number > 1) this.headerOf([]);
  }

  finishRows(): void {
    if (this.header === null) this.headerOf([]);
  }

  private headerOf(cells: RowCell[]): void {
    const names: string[] = Array.from({ length: cells.length ? cells[cells.length - 1]![0] : 0 }, () => "");
    for (const [column, text] of cells) names[column - 1] = text;
    if (!names.length) this.refuse("row 1 is empty; FlowAssert reads the column names from row 1");
    this.header = names;
    this.width = names.length;
    this.onHeader(names);
  }

  row(number: number, cells: RowCell[], hidden: boolean): void {
    if (number === 1) return this.headerOf(cells);
    if (!cells.length) return;
    const width = this.width;
    for (const cell of cells) if (cell[0] > width) this.refuse(`cell ${columnLetters(cell[0])}${number} has a value beyond the header`);
    if (this.count === this.maxRows) throw new Refused(`${this.path}: exceeds --max-rows limit of ${this.maxRows}`);
    this.count++;
    const values: string[] = Array.from({ length: width }, () => "");
    for (const [column, text] of cells) values[column - 1] = text;
    this.onRow(values, cells, hidden);
  }
}

export type CellCounts = Record<Form | "formula", number>;

/** What inputs.source_workbook (or destination_workbook) records. Members in the order Python builds them. */
export interface WorkbookMember {
  format: "xlsx";
  worksheet: string;
  worksheet_state: string;
  sheets: number;
  date_system: "1900" | "1904";
  file_sha256: string;
  file_bytes: number;
  inflated_bytes: number;
  columns: number;
  rows: number;
  cells: CellCounts;
  hidden_rows: number;
  hidden_columns: number;
  merged_ranges: number;
  values: "stored";
  canonical_form: string;
}

/** What a complete read gives, as XlsxFile's attributes after iteration. */
export interface XlsxRead {
  rows: number;
  header: string[];
  /** SHA-256 of the canonical form. */
  sha256: string;
  member: WorkbookMember;
  /** Every listed sheet, for the profile. */
  sheets: { name: string; state: string; bytes: number | null; worksheet: boolean }[];
  /** Data cells within the header's width that are empty. */
  emptyCells: number;
}

async function fileDigest(blob: Blob, progress?: (bytes: number) => void): Promise<string> {
  const digest = new Sha256();
  const stream = sliceStream(blob, 0, blob.size);
  let read = 0;
  for (;;) {
    const chunk = await stream.read();
    if (chunk === null) break;
    digest.update(chunk);
    read += chunk.length;
    progress?.(read);
  }
  return hex(digest.digest());
}

/**
 * Read one worksheet strictly and once, as iterating xlsx.XlsxFile does: `onRow` gets the values of `columns` for each
 * data row, or every value when `columns` is null (the profile and the records to resend). Resolves to the counts and
 * digests, or rejects with Refused before any partial result is used.
 */
export async function readXlsx(
  source: XlsxSource,
  columns: readonly string[] | null,
  onRow: (values: string[]) => void,
  options: {
    maxRows?: number | bigint;
    maxBytes?: number | bigint;
    worksheet?: string;
    option?: string;
    progress?: (bytes: number, rows: number) => void;
    /** Called with row 1's texts before the first data row. */
    onHeader?: (header: string[]) => void;
  } = {},
): Promise<XlsxRead> {
  const path = source.name;
  const maxRows = Number(options.maxRows ?? 1_000_000);
  const maxBytes = Number(options.maxBytes ?? 209_715_200);
  const fileSha = await fileDigest(source.blob);
  const workbook = await Workbook.open(source, maxBytes);
  const reader = new WorksheetReader(workbook, options.worksheet, options.option ?? "--source-worksheet");
  await reader.open();
  const digest = new Sha256();
  const encoder = new TextEncoder();
  const forms: CellCounts = { text: 0, number: 0, percentage: 0, date_time: 0, duration: 0, boolean: 0, formula: 0 };
  let hiddenRows = 0;
  let nonEmpty = 0;
  let index: number[] | null = null;
  let header: string[] = [];
  const sheet = reader.startRows(
    (names) => {
      if (new Set(names).size !== names.length) throw new Refused(`${path}: repeated column name`);
      if (columns !== null) {
        const wanted = [...new Set(columns)];
        const missing = wanted.filter((c) => !names.includes(c));
        if (missing.length) throw new Refused(`${path}: missing column ${missing.join(", ")}`);
        index = columns.map((c) => names.indexOf(c));
      }
      header = names;
      digest.update(encoder.encode(canonicalRow(names)));
      options.onHeader?.(names);
    },
    (values, cells, hidden) => {
      digest.update(encoder.encode(canonicalRow(values)));
      for (const [, , form, formula] of cells) {
        forms[form]++;
        if (formula) forms.formula++;
      }
      nonEmpty += cells.length;
      if (hidden) hiddenRows++;
      onRow(index === null ? values : index.map((i) => values[i]!));
    },
    maxRows,
  );
  for await (const _ of workbook.tokenize(reader.sheetPart, sheet)) options.progress?.(workbook.inflated, reader.count);
  reader.finishRows();
  const width = reader.width;
  const hiddenColumns = new Set<number>();
  for (const [low, high] of sheet.hiddenColumns) for (let c = Math.max(low, 1); c <= Math.min(high, width); c++) hiddenColumns.add(c);
  const member: WorkbookMember = {
    format: "xlsx",
    worksheet: reader.name ?? "",
    worksheet_state: reader.state,
    sheets: reader.sheetCount,
    date_system: reader.date1904 ? "1904" : "1900",
    file_sha256: fileSha,
    file_bytes: source.blob.size,
    inflated_bytes: workbook.inflated,
    columns: width,
    rows: reader.count,
    cells: { ...forms },
    hidden_rows: hiddenRows,
    hidden_columns: hiddenColumns.size,
    merged_ranges: sheet.merged,
    values: "stored",
    canonical_form: CANONICAL_FORM,
  };
  return { rows: reader.count, header, sha256: hex(digest.digest()), member, sheets: reader.sheetsListed, emptyCells: reader.count * width - nonEmpty };
}

/** The sheets a workbook lists, for the page to offer a choice, or the refusal reading it would give. */
export async function listSheets(source: XlsxSource, maxBytes: number | bigint = 209_715_200): Promise<XlsxRead["sheets"]> {
  const workbook = await Workbook.open(source, Number(maxBytes));
  const reader = new WorksheetReader(workbook, undefined, "--source-worksheet");
  await reader.listed();
  return reader.sheetsListed;
}

class HeaderRead extends Error {
  readonly header: string[];
  constructor(header: string[]) {
    super("header read");
    this.header = header;
  }
}

/** Row 1 of a worksheet, refused as the full read would refuse it there; the rest of the worksheet is not read. */
export async function readXlsxHeader(source: XlsxSource, options: { worksheet?: string; option?: string; maxBytes?: number | bigint } = {}): Promise<string[]> {
  const workbook = await Workbook.open(source, Number(options.maxBytes ?? 209_715_200));
  const reader = new WorksheetReader(workbook, options.worksheet, options.option ?? "--source-worksheet");
  await reader.open();
  const sheet = reader.startRows(
    (names) => {
      if (new Set(names).size !== names.length) throw new Refused(`${source.name}: repeated column name`);
      throw new HeaderRead(names);
    },
    () => undefined,
    1,
  );
  try {
    for await (const _ of workbook.tokenize(reader.sheetPart, sheet)) void _;
    reader.finishRows();
  } catch (e) {
    if (e instanceof HeaderRead) return e.header;
    throw e;
  }
  return reader.header ?? [];
}
