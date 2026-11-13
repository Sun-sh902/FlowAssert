/**
 * Random parity of the two .xlsx readers (docs/design/1.1-excel.md): the TypeScript reader must read every workbook
 * exactly as offline/flowassert_offline/xlsx.py does, row for row, digest for digest and refusal for refusal. The
 * workbooks come from a fixed seed: valid worksheets of every cell form, and hostile ones (broken XML, references,
 * characters, bytes, formats). Python reads them through offline/bench/xlsx_parity.py. The text of a number, the text
 * of a date and the class of a number format are compared on their own too, on many more values.
 *
 * As random-parity.test.ts: FA_PYTHON names the interpreter; without Python 3.15 the tests are skipped, saying so,
 * unless FA_PARITY_REQUIRED=1, when they fail.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Refused } from "../../offline/csv";
import { classify, dateText, numberText, readXlsx } from "../../offline/xlsx";
import { REPO_ROOT } from "../fixtures/sources";
import { random } from "./random-cases";

/** A function of the generator: each call the next number in [0, 1). */
const stream = (seed: number) => {
  const r = random(seed);
  return () => r.next();
};

const PYTHON = process.env.FA_PYTHON ?? "python3";
const REQUIRED = process.env.FA_PARITY_REQUIRED === "1";
const COUNT = Number(process.env.FA_XLSX_PARITY_COUNT ?? 250);
const SCRIPT = join(REPO_ROOT, "offline/bench/xlsx_parity.py");

function pythonVersion(): [number, number] | null {
  try {
    const [major, minor] = execFileSync(PYTHON, ["-c", "import sys; print(sys.version_info[0], sys.version_info[1])"], { encoding: "utf-8" }).trim().split(" ").map(Number);
    return [major!, minor!];
  } catch {
    return null;
  }
}
const version = pythonVersion();
const usable = version !== null && (version[0] > 3 || (version[0] === 3 && version[1] >= 15));
const skip = !usable && !REQUIRED;
const why = `workbook parity needs Python 3.15 or later as ${PYTHON}; found ${version ? version.join(".") : "none"}`;
const python = (args: string[], input: string) => execFileSync(PYTHON, [SCRIPT, ...args], { input, maxBuffer: 1 << 28 }).toString();

// ---------- A small ZIP writer, for the generated workbooks ----------

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new CompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const pieces: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pieces.push(value);
  }
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function zip(parts: [string, Uint8Array][], deflated: boolean): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of parts) {
    const nameBytes = new TextEncoder().encode(name);
    const body = deflated ? await deflate(data) : data;
    const local = new DataView(new ArrayBuffer(30));
    const fields = [0x04034b50, 20, 0, deflated ? 8 : 0, 0, 0, crc32(data), body.length, data.length, nameBytes.length, 0];
    [4, 2, 2, 2, 2, 2, 4, 4, 4, 2, 2].reduce((at, size, i) => (size === 4 ? local.setUint32(at, fields[i]!, true) : local.setUint16(at, fields[i]!, true), at + size), 0);
    const entry = new DataView(new ArrayBuffer(46));
    const cfields = [0x02014b50, 20, 20, 0, deflated ? 8 : 0, 0, 0, crc32(data), body.length, data.length, nameBytes.length, 0, 0, 0, 0, 0, offset];
    [4, 2, 2, 2, 2, 2, 2, 4, 4, 4, 2, 2, 2, 2, 2, 4, 4].reduce((at, size, i) => (size === 4 ? entry.setUint32(at, cfields[i]!, true) : entry.setUint16(at, cfields[i]!, true), at + size), 0);
    chunks.push(new Uint8Array(local.buffer), nameBytes, body);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, parts.length, true);
  end.setUint16(10, parts.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// ---------- Random workbooks ----------

const M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const TEXTS = ["SYN-1", "a b", " lead", "trail ", "名字", "😀x", "a&amp;b", "&lt;tag&gt;", "x_x000D_y", "_x005F_x41_", "q\"uote", "c,omma", "two\nlines", "", "&#x41;&#66;", "<![CDATA[cd&ata]]>", "tab\there", "_xD800_", "&bogus;", "\u0001"];
const NUMBERS = ["0", "1", "-0", "0.1", "1.1000000000000001", "45973", "45973.5", "60", "59", "61", "-1", "2958466", "1e21", "1E-7", ".5", "1.", "+1", "abc", "", "0.125", "1e309", "13800138000", "0.000001"];
const FORMATS: [number, string][] = [[164, "yyyy/m/d"], [165, "0.00%"], [166, "[h]:mm:ss"], [167, "h:mm"], [168, "m/d/yy h:mm"], [169, "bb"], [170, '"Due "0'], [171, "0;-0;\"zero\""], [172, "dd/mm/yyyy;@"], [173, "mm:ss.0"]];
const XFS = [0, 1, 14, 22, 9, 46, 20, 49, 27, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173];

function workbook(seed: number): [string, Uint8Array][] | Uint8Array {
  const rnd = stream(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
  const chance = (p: number) => rnd() < p;
  const strings: string[] = [];
  const text = () => pick(TEXTS);
  const prefix = chance(0.15) ? "x:" : "";
  const el = (name: string) => prefix + name;
  const ws = () => (chance(0.1) ? pick([" ", "\n  ", "\r\n", "\t"]) : "");
  const cell = (ref: string | null): string => {
    const r = ref === null ? "" : ` r="${ref}"`;
    const kind = pick(["s", "inline", "n", "n", "b", "e", "str", "d", "empty", "formula", "rich"]);
    const s = chance(0.4) ? ` s="${Math.floor(rnd() * (XFS.length + 1))}"` : "";
    switch (kind) {
      case "s": {
        strings.push(text());
        return `<${el("c")}${r} t="s"><${el("v")}>${chance(0.03) ? 999 : strings.length - 1}</${el("v")}></${el("c")}>`;
      }
      case "inline":
        return `<${el("c")}${r} t="inlineStr"><${el("is")}><${el("t")}>${text()}</${el("t")}></${el("is")}></${el("c")}>`;
      case "rich":
        return `<${el("c")}${r} t="inlineStr"><${el("is")}><${el("r")}><${el("t")}>${text()}</${el("t")}></${el("r")}><${el("rPh")}><${el("t")}>ph</${el("t")}></${el("rPh")}></${el("is")}></${el("c")}>`;
      case "n":
        return `<${el("c")}${r}${s}><${el("v")}>${pick(NUMBERS)}</${el("v")}></${el("c")}>`;
      case "b":
        return `<${el("c")}${r} t="b"><${el("v")}>${pick(["0", "1", "1", "2"])}</${el("v")}></${el("c")}>`;
      case "e":
        return `<${el("c")}${r} t="e"><${el("v")}>#N/A</${el("v")}></${el("c")}>`;
      case "str":
        return `<${el("c")}${r} t="str"><${el("f")}>A1</${el("f")}><${el("v")}>${text()}</${el("v")}></${el("c")}>`;
      case "d":
        return `<${el("c")}${r} t="d"><${el("v")}>${pick(["2025-11-12", "2025-11-12T09:30:00Z", "12/11/2025"])}</${el("v")}></${el("c")}>`;
      case "formula":
        return `<${el("c")}${r}${s}><${el("f")}${chance(0.3) ? ' t="shared" si="0"' : ""}>1+1</${el("f")}>${chance(0.9) ? `<${el("v")}>2</${el("v")}>` : ""}</${el("c")}>`;
      default:
        return `<${el("c")}${r}${s}/>`;
    }
  };
  const letters = (n: number) => {
    let s = "";
    while (n) {
      const k = (n - 1) % 26;
      s = String.fromCharCode(65 + k) + s;
      n = (n - 1 - k) / 26;
    }
    return s;
  };
  const width = 1 + Math.floor(rnd() * 4);
  const refs = chance(0.8);
  let rows = `<${el("row")} r="1">` + Array.from({ length: width }, (_, i) => `<${el("c")} r="${letters(i + 1)}1" t="inlineStr"><${el("is")}><${el("t")}>h${i}${chance(0.05) ? "" : ""}</${el("t")}></${el("is")}></${el("c")}>`).join("") + `</${el("row")}>`;
  const count = chance(0.1) ? 900 + Math.floor(rnd() * 600) : Math.floor(rnd() * 25);
  let number = 1;
  for (let i = 0; i < count; i++) {
    number += chance(0.1) ? 2 : 1;
    if (chance(0.01)) number -= 2;
    const cells: string[] = [];
    let column = 0;
    const n = Math.floor(rnd() * (width + (chance(0.05) ? 2 : 0)));
    for (let k = 0; k < n; k++) {
      column += chance(0.15) ? 2 : 1;
      if (chance(0.01)) column = Math.max(1, column - 2);
      const ref = refs ? (chance(0.005) ? "XFE" + number : letters(column) + number) : null;
      cells.push(ws() + cell(ref));
    }
    rows += ws() + `<${el("row")}${chance(0.9) ? ` r="${number}"` : ""}${chance(0.05) ? ' hidden="1"' : ""}>${cells.join("")}</${el("row")}>`;
    if (chance(0.03)) rows += "<!-- a comment -->";
  }
  const ns = prefix ? `xmlns:x="${M}"` : `xmlns="${M}"`;
  let sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<${el("worksheet")} ${ns}><${el("sheetData")}>${rows}</${el("sheetData")}>${chance(0.2) ? `<${el("mergeCells")}><${el("mergeCell")} ref="A1:B1"/></${el("mergeCells")}>` : ""}</${el("worksheet")}>`;
  // Hostile mutations, one at most.
  const mutation = rnd();
  if (mutation < 0.03) sheet = sheet.replace(`</${el("sheetData")}>`, "");
  else if (mutation < 0.05) sheet = sheet.replace("?>", '?><!DOCTYPE x [<!ENTITY a "b">]>');
  else if (mutation < 0.07) sheet = sheet.replace(`<${el("sheetData")}>`, `<${el("sheetData")}>\u0002`);
  else if (mutation < 0.09) sheet = sheet.replace(`r="1"`, `r="1" r="1"`);
  else if (mutation < 0.1) sheet = sheet.replace(ns, `${ns} xmlns:bad=""`);
  const sst = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${M}">` + strings.map((s, i) => (i % 3 === 1 ? `<si><r><t>${s}</t></r><r><t xml:space="preserve"> </t></r></si>` : `<si><t xml:space="preserve">${s}</t></si>`)).join("") + "</sst>";
  const styles =
    `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${M}"><numFmts>` +
    FORMATS.map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${code.replaceAll('"', "&quot;")}"/>`).join("") +
    `</numFmts><cellXfs>` + XFS.map((id) => `<xf numFmtId="${id}"/>`).join("") + "</cellXfs></styleSheet>";
  const book = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${M}" xmlns:r="${R}">${chance(0.2) ? '<workbookPr date1904="1"/>' : ""}<sheets><sheet name="S${seed}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const enc = (s: string) => new TextEncoder().encode(s);
  let sheetBytes = enc(sheet);
  if (chance(0.03)) {
    // A byte that is not UTF-8, somewhere in the part.
    sheetBytes = sheetBytes.slice();
    sheetBytes[Math.floor(rnd() * (sheetBytes.length - 1))] = 0xff;
  }
  return [
    ["[Content_Types].xml", enc(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${CT}"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`)],
    ["_rels/.rels", enc(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)],
    ["xl/workbook.xml", enc(book)],
    ["xl/_rels/workbook.xml.rels", enc(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${R}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`)],
    ["xl/styles.xml", enc(styles)],
    ["xl/sharedStrings.xml", enc(sst)],
    ["xl/worksheets/sheet1.xml", sheetBytes],
  ];
}

describe.skipIf(skip)(skip ? why : "with Python", () => {
  test("the text of a number is Python's number_text", () => {
    const rnd = stream(20261112);
    const bits: string[] = ["0000000000000000", "8000000000000000", "3ff0000000000000", "3fb999999999999a", "4415af1d78b58c40", "3eb0c6f7a0b5ed8d", "7fefffffffffffff", "0000000000000001", "3ee4f8b588e368f1", "444b1ae4d6e2ef50"];
    for (let i = 0; i < 20000; i++) bits.push(Array.from({ length: 16 }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join(""));
    const values = bits.map((b) => new DataView(Uint8Array.from(b.match(/../g)!.map((h) => parseInt(h, 16))).buffer).getFloat64(0)).map((x, i) => [x, bits[i]!] as const).filter(([x]) => Number.isFinite(x));
    const expected = python(["numbers"], values.map(([, b]) => b).join("\n")).trim().split("\n");
    expect(values.map(([x]) => numberText(x))).toEqual(expected);
  });

  test("the text of a date is Python's date_text", () => {
    const rnd = stream(20261113);
    const lines: string[] = [];
    const cases: [number, "date" | "time" | "date_time", boolean][] = [];
    for (const serial of [0, 0.5, 0.999999999, 1, 59, 60, 61, 2958465, 2958466, 2957003, 2957004, -0.1, 45973.50000578704]) {
      for (const kind of ["date", "time", "date_time"] as const) for (const s1904 of [false, true]) cases.push([serial, kind, s1904]);
    }
    for (let i = 0; i < 5000; i++) cases.push([rnd() * 3_000_000 - 1000, (["date", "time", "date_time"] as const)[i % 3]!, rnd() < 0.5]);
    for (const [serial, kind, s1904] of cases) lines.push(`${serial} ${kind} ${s1904 ? "1904" : "1900"}`);
    const expected = python(["dates"], lines.join("\n")).trim().split("\n");
    expect(cases.map(([s, k, b]) => String(dateText(s, k, b) ?? "None"))).toEqual(expected);
  });

  test("the class of a number format is Python's classify", () => {
    const codes = ["General", "0", "0.00", "#,##0", "0%", "0.00E+00", "# ?/?", "mm-dd-yy", "d-mmm-yy", "h:mm AM/PM", "h:mm:ss", "m/d/yy h:mm", "mm:ss", "[h]:mm:ss", "mmss.0", "@",
      'yyyy"年"m"月"d"日"', "[$-409]dddd, mmmm dd, yyyy", "[Red]0.00;[Blue]-0.00", "0.0%;-0.0%;\"-\"", "\\h0", "_(* #,##0_)", "[>=100]0;0.00", "e", "ee", "0.0e+0", "AM/PM h", "A/P", "b2yyyy", "ggg", "[mm]:ss", "hh:mm:ss.000", "yyyy-mm-dd\\Thh:mm", "\"unterminated", "[Red", "m", "mm", "s", "general text", "😀0", "0;;;@"];
    const expected = JSON.parse(python(["formats"], JSON.stringify(codes))) as (string[] | null)[];
    const actual = codes.map((code) => {
      try {
        const sections: string[] = [];
        let start = 0;
        let quoted = false;
        for (let i = 0; i < code.length; i++) {
          if (code[i] === '"') quoted = !quoted;
          else if (!quoted && code[i] === "\\") i++;
          else if (!quoted && code[i] === ";") {
            sections.push(code.slice(start, i));
            start = i + 1;
          }
        }
        sections.push(code.slice(start));
        return sections.slice(0, 3).map(classify);
      } catch {
        return null;
      }
    });
    expect(actual).toEqual(expected);
  });

  test(`random workbooks: ${COUNT} read the same way by both readers`, { timeout: 600_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "fa-xlsx-parity-"));
    try {
      const names: string[] = [];
      for (let seed = 1; seed <= COUNT; seed++) {
        const parts = workbook(seed) as [string, Uint8Array][];
        const name = `case-${String(seed).padStart(4, "0")}.xlsx`;
        writeFileSync(join(root, name), await zip(parts, seed % 2 === 0));
        names.push(name);
      }
      const expected = JSON.parse(python(["read", root], "")) as Record<string, { rows?: string[][]; sha256?: string; member?: unknown; refused?: string }>;
      let refusals = 0;
      for (const name of names) {
        const bytes = new Uint8Array(execFileSync("cat", [join(root, name)]));
        const rows: string[][] = [];
        let actual: { rows?: string[][]; sha256?: string; member?: unknown; refused?: string };
        try {
          const read = await readXlsx({ name, blob: new Blob([bytes]) }, null, (values) => void rows.push(values));
          actual = { rows: [read.header, ...rows], sha256: read.sha256, member: read.member };
        } catch (e) {
          if (!(e instanceof Refused)) throw e;
          actual = { refused: e.message };
          refusals++;
        }
        expect({ name, ...actual }).toEqual({ name, ...expected[name] });
      }
      // The seed gives both kinds, so the test proves both.
      expect(refusals).toBeGreaterThan(COUNT / 10);
      expect(refusals).toBeLessThan(COUNT * 0.9);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------- Hostile workbooks found by fuzzing the two readers against each other (review of 2026-11-13) ----------

interface RawEntry {
  name: string;
  /** The bytes stored in the archive: the part itself when stored, its deflate stream (and anything after it) when deflated. */
  body: Uint8Array;
  deflated: boolean;
  /** The CRC-32 and inflated size the archive records. */
  crc: number;
  usize: number;
}

/** A ZIP archive of these entries exactly as given, so an entry can record what its data does not hold. */
function rawZip(entries: RawEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    const local = new DataView(new ArrayBuffer(30));
    const fields = [0x04034b50, 20, 0, e.deflated ? 8 : 0, 0, 0, e.crc, e.body.length, e.usize, nameBytes.length, 0];
    [4, 2, 2, 2, 2, 2, 4, 4, 4, 2, 2].reduce((at, size, i) => (size === 4 ? local.setUint32(at, fields[i]! >>> 0, true) : local.setUint16(at, fields[i]!, true), at + size), 0);
    const entry = new DataView(new ArrayBuffer(46));
    const cfields = [0x02014b50, 20, 20, 0, e.deflated ? 8 : 0, 0, 0, e.crc, e.body.length, e.usize, nameBytes.length, 0, 0, 0, 0, 0, offset];
    [4, 2, 2, 2, 2, 2, 2, 4, 4, 4, 2, 2, 2, 2, 2, 4, 4].reduce((at, size, i) => (size === 4 ? entry.setUint32(at, cfields[i]! >>> 0, true) : entry.setUint16(at, cfields[i]!, true), at + size), 0);
    chunks.push(new Uint8Array(local.buffer), nameBytes, e.body);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + e.body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const encode = (s: string) => new TextEncoder().encode(s);
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** The parts of a one-sheet workbook with inline strings and no styles: `sheet` is the worksheet's text. */
function smallBook(sheet: string, sheetElement = '<sheet name="S" sheetId="1" r:id="rId1"/>'): [string, Uint8Array][] {
  return [
    ["[Content_Types].xml", encode(`${XML_DECLARATION}<Types xmlns="${CT}"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`)],
    ["_rels/.rels", encode(`${XML_DECLARATION}<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)],
    ["xl/workbook.xml", encode(`${XML_DECLARATION}<workbook xmlns="${M}" xmlns:r="${R}"><sheets>${sheetElement}</sheets></workbook>`)],
    ["xl/_rels/workbook.xml.rels", encode(`${XML_DECLARATION}<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)],
    ["xl/worksheets/sheet1.xml", encode(sheet)],
  ];
}

const inline = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
const SHEET = `${XML_DECLARATION}<worksheet xmlns="${M}"><sheetData><row r="1">${inline("A1", "id")}${inline("B1", "phone")}</row><row r="2">${inline("A2", "K1")}${inline("B2", "1")}</row></sheetData></worksheet>`;

/** Each hostile workbook, and what both readers must make of it. */
async function hostileWorkbooks(): Promise<{ name: string; bytes: Uint8Array; expected: { worksheet: string } | { refused: string } }[]> {
  return [
    // ECMA-376 requires a sheet's name; without one, both readers record an empty name (the schema's worksheet is a string).
    { name: "sheet-without-a-name.xlsx", bytes: await zip(smallBook(SHEET, '<sheet sheetId="1" r:id="rId1"/>'), true), expected: { worksheet: "" } },
    // Markup that runs past the tag bound is refused for the bound, whatever else is wrong with it and however much of
    // the part a chunk holds. Before, the browser, which inflates larger chunks than Python, called it not well-formed.
    ...(await Promise.all(
      PAST_THE_BOUND.flatMap(([kind, before, opening, closing]) =>
        [70_000, 700_000].flatMap((length) =>
          [false, true].map(async (deflated) => {
            const spaces = " ".repeat(length);
            const head = XML_DECLARATION + (before ? before + spaces + closing : "");
            const sheet = head + `<worksheet xmlns="${M}">` + (before ? "" : opening + spaces + closing) + "<sheetData/></worksheet>";
            const name = `${kind}-${length}-${deflated ? "deflated" : "stored"}.xlsx`;
            return { name, bytes: await zip(smallBook(sheet), deflated), expected: { refused: `xl/worksheets/sheet1.xml ${BOUND}` } };
          }),
        ),
      ),
    )),
    // A problem in the text comes before damage the archive shows only after it: data after the end of the deflate
    // stream, or a part that inflates to more than the archive records. Before, the command line refused the damage
    // without reading the text of the piece that showed it, and the browser refused the larger part the same way.
    ...(await Promise.all(
      (["small", "large"] as const).flatMap((size) =>
        (["problem", "clean"] as const).flatMap((what) =>
          (["trailing", "larger"] as const).map(async (damage) => {
            const padding = size === "large" ? 3_000_000 : 0;
            const row2 = what === "problem" ? '<c r="B2" t="e"><v>#N/A</v></c>' : inline("B2", "1");
            const text = encode(`${XML_DECLARATION}<worksheet xmlns="${M}"><sheetData><row r="1">${inline("A1", "id")}${inline("B1", "phone")}</row><row r="2">${inline("A2", "K1")}${row2}</row>${" ".repeat(padding)}</sheetData></worksheet>`);
            const body = await deflate(text);
            const entries: RawEntry[] = [];
            for (const [partName, data] of smallBook("")) {
              if (partName !== "xl/worksheets/sheet1.xml") entries.push({ name: partName, body: await deflate(data), deflated: true, crc: crc32(data), usize: data.length });
              else if (damage === "trailing") entries.push({ name: partName, body: Uint8Array.from([...body, ...encode("PK\u0003\u0004 data after the end")]), deflated: true, crc: crc32(text), usize: text.length });
              else entries.push({ name: partName, body, deflated: true, crc: crc32(text), usize: text.length - 1 - padding / 3 });
            }
            const refused = what === "problem" ? "worksheet 'S': cell B2 holds the error value #N/A" : "damaged ZIP archive (xl/worksheets/sheet1.xml does not inflate to the data the archive records)";
            return { name: `${damage}-${what}-${size}.xlsx`, bytes: rawZip(entries), expected: { refused } };
          }),
        ),
      ),
    )),
  ];
}

const BOUND = "exceeds a reading bound (a tag longer than 65536 characters, or elements nested deeper than 64)";
/** Malformed markup: what comes before the root element, the markup's opening and its closing. */
const PAST_THE_BOUND: [string, string, string, string][] = [
  ["not-a-tag", "", "< ", ">"],
  ["attribute-without-value", "", '<a b="1" c', ">"],
  ["comment-with-dashes", "", "<!-- -- ", "-->"],
  ["instruction-without-target", "", "<? ", "?>"],
  ["cdata-outside-the-root", "<![CDATA[", "", "]]>"],
];

async function readWithTypeScript(name: string, bytes: Uint8Array): Promise<{ rows?: string[][]; sha256?: string; member?: unknown; refused?: string }> {
  const rows: string[][] = [];
  try {
    const read = await readXlsx({ name, blob: new Blob([bytes as Uint8Array<ArrayBuffer>]) }, null, (values) => void rows.push(values));
    return { rows: [read.header, ...rows], sha256: read.sha256, member: read.member };
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    return { refused: e.message };
  }
}

describe("hostile workbooks found by fuzzing", () => {
  test("the TypeScript reader reads each as the design note says", async () => {
    for (const { name, bytes, expected } of await hostileWorkbooks()) {
      const read = await readWithTypeScript(name, bytes);
      if ("refused" in expected) expect({ name, refused: read.refused }).toEqual({ name, refused: `${name}: ${expected.refused}` });
      else expect({ name, worksheet: (read.member as { worksheet: unknown } | undefined)?.worksheet }).toEqual({ name, worksheet: expected.worksheet });
    }
  });
});

describe.skipIf(skip)(skip ? why : "hostile workbooks, with Python", () => {
  test("each is read the same way by both readers: rows, digest, report member or refusal", async () => {
    const root = mkdtempSync(join(tmpdir(), "fa-xlsx-hostile-"));
    try {
      const books = await hostileWorkbooks();
      for (const { name, bytes } of books) writeFileSync(join(root, name), bytes);
      const expected = JSON.parse(python(["read", root], "")) as Record<string, unknown>;
      for (const { name, bytes } of books) expect({ name, ...(await readWithTypeScript(name, bytes)) }).toEqual({ name, ...(expected[name] as object) });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
