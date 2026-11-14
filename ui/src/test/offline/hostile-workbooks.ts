/**
 * Test helper: the workbooks the .xlsx parity test writes by hand (xlsx-parity.test.ts), a small ZIP writer for them,
 * and the hostile workbooks found by fuzzing the two readers against each other (review of 2026-11-13), with what each
 * reader must make of each. Kept apart from the test so that the iPhone and iPad app's engine test can write the same
 * workbooks (ios/scripts/engine-cases.mjs).
 */
// ---------- A small ZIP writer, for the generated workbooks ----------

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
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

export async function zip(parts: [string, Uint8Array][], deflated: boolean): Promise<Uint8Array> {
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


export const M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
export const CT = "http://schemas.openxmlformats.org/package/2006/content-types";

// ---------- Hostile workbooks found by fuzzing the two readers against each other (review of 2026-11-13) ----------

export interface RawEntry {
  name: string;
  /** The bytes stored in the archive: the part itself when stored, its deflate stream (and anything after it) when deflated. */
  body: Uint8Array;
  deflated: boolean;
  /** The CRC-32 and inflated size the archive records. */
  crc: number;
  usize: number;
}

/** A ZIP archive of these entries exactly as given, so an entry can record what its data does not hold. */
export function rawZip(entries: RawEntry[]): Uint8Array {
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

export const encode = (s: string) => new TextEncoder().encode(s);
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** The parts of a one-sheet workbook with inline strings and no styles: `sheet` is the worksheet's text. */
export function smallBook(sheet: string, sheetElement = '<sheet name="S" sheetId="1" r:id="rId1"/>'): [string, Uint8Array][] {
  return [
    ["[Content_Types].xml", encode(`${XML_DECLARATION}<Types xmlns="${CT}"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`)],
    ["_rels/.rels", encode(`${XML_DECLARATION}<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)],
    ["xl/workbook.xml", encode(`${XML_DECLARATION}<workbook xmlns="${M}" xmlns:r="${R}"><sheets>${sheetElement}</sheets></workbook>`)],
    ["xl/_rels/workbook.xml.rels", encode(`${XML_DECLARATION}<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)],
    ["xl/worksheets/sheet1.xml", encode(sheet)],
  ];
}

export const inline = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
export const SHEET = `${XML_DECLARATION}<worksheet xmlns="${M}"><sheetData><row r="1">${inline("A1", "id")}${inline("B1", "phone")}</row><row r="2">${inline("A2", "K1")}${inline("B2", "1")}</row></sheetData></worksheet>`;

/** Each hostile workbook, and what both readers must make of it. */
export async function hostileWorkbooks(): Promise<{ name: string; bytes: Uint8Array; expected: { worksheet: string } | { refused: string } }[]> {
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
    // An inline string with a <v> and no <is> has no value. Before, both readers failed internally on it.
    ...(await Promise.all(
      [
        ['<c r="B2" t="inlineStr"><v>0.5</v></c>', "cell B2 has no value"],
        ['<c r="B2" t="inlineStr"><f>A1</f><v>x</v></c>', "cell B2 has a formula without a cached value; open and save the workbook in a spreadsheet program, which stores the values"],
      ].map(async ([cell, refusal], i) => {
        const sheet = `${XML_DECLARATION}<worksheet xmlns="${M}"><sheetData><row r="1">${inline("A1", "id")}${inline("B1", "n")}</row><row r="2">${inline("A2", "K1")}${cell}</row></sheetData></worksheet>`;
        return { name: `inline-string-without-text-${i}.xlsx`, bytes: await zip(smallBook(sheet), true), expected: { refused: `worksheet 'S': ${refusal}` } };
      }),
    )),
  ];
}

export const BOUND = "exceeds a reading bound (a tag longer than 65536 characters, or elements nested deeper than 64)";
/** Malformed markup: what comes before the root element, the markup's opening and its closing. */
export const PAST_THE_BOUND: [string, string, string, string][] = [
  ["not-a-tag", "", "< ", ">"],
  ["attribute-without-value", "", '<a b="1" c', ">"],
  ["comment-with-dashes", "", "<!-- -- ", "-->"],
  ["instruction-without-target", "", "<? ", "?>"],
  ["cdata-outside-the-root", "<![CDATA[", "", "]]>"],
];
