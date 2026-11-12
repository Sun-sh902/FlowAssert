/**
 * Help after a refusal on the CSV check page: a hint, where one is justified, computed only from the refusal message
 * and the first bytes of the files. A hint is a suggestion the person can follow by changing a choice themselves; it
 * never retries, and never changes an encoding, a separator or a column. The refusal itself stays exactly as the
 * command line prints it (docs/guides/refusals.md gives the same help for the command line).
 *
 * The text is English, in parts, as in explain.ts: a string is interface text, a
 * { value } is something from the file, such as a column name, shown exactly as it is.
 */
import { CsvError, CsvReader, LineReader, MAX_BYTES, MAX_ROWS, NeedMore, readHeader, type Encoding } from "./csv";

export type HintPart = string | { value: string };

export interface Hint {
  /** Which hint: "utf-16", "utf-16-no-bom", "utf-8", "gb18030", "missing-column", "line-fields", "separator", … */
  kinds: string[];
  /** Paragraphs, each a list of parts. */
  paragraphs: HintPart[][];
}

export interface HintFile {
  /** The name refusals start with. */
  name: string;
  /** The first bytes of the file, or all of it. */
  head: Uint8Array;
  /** The file's size: `head` is the whole file when they are equal. */
  size: number;
  encoding: Encoding;
  /** The columns the check needs from this file, when the page knows them. */
  columns?: readonly string[];
}

/** How much of each file the page reads for a hint: enough for a header and the lines near the start. */
export const HINT_BYTES = 16 * 1024 * 1024;

const LABELS: Record<Encoding, string> = { "utf-8": "UTF-8", "utf-16": "UTF-16", gb18030: "GB18030" };
const LINE_PREVIEW = 120;

/** Decode with the browser's decoder, for a hint only: a prefix may end inside a character. */
function decodes(label: string, bytes: Uint8Array): string | null {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes, { stream: true });
  } catch {
    return null;
  }
}

/** The text of the start of the file in its chosen encoding, as the browser decodes it, or null. */
function textOf(file: HintFile): string | null {
  const b = file.head;
  if (file.encoding === "utf-16") {
    if (b[0] === 0xff && b[1] === 0xfe) return decodes("utf-16le", b.subarray(2));
    if (b[0] === 0xfe && b[1] === 0xff) return decodes("utf-16be", b.subarray(2));
    return null;
  }
  const text = decodes(file.encoding === "gb18030" ? "gb18030" : "utf-8", b);
  return text === null ? null : text.replace(/^﻿/, "");
}

const firstLine = (text: string) => {
  const line = text.split(/\r\n|\r|\n/, 1)[0] ?? "";
  return line.length > LINE_PREVIEW ? line.slice(0, LINE_PREVIEW) + "…" : line;
};

/* ---------- not UTF-8, not UTF-16, not GB18030 ---------- */

const hasBom16 = (b: Uint8Array) => (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff);

/** Many zero bytes and no byte order mark: UTF-16 text without its mark, which no encoding choice reads. */
function utf16WithoutBom(b: Uint8Array): boolean {
  const sample = b.subarray(0, 4096);
  const zeros = sample.reduce((n, x) => n + (x === 0 ? 1 : 0), 0);
  return !hasBom16(b) && sample.length >= 8 && zeros * 4 >= sample.length;
}

const NO_BOM: Hint = {
  kinds: ["utf-16-no-bom"],
  paragraphs: [
    ["Many of the file’s first bytes are zero, as in UTF-16 text without a byte order mark. FlowAssert reads UTF-16 only with a byte order mark, as the command line does, so no encoding choice reads this file as it is. Save it again as UTF-8, or as UTF-16 with a byte order mark, and choose that file."],
  ],
};

function encodingHint(file: HintFile): Hint | null {
  const b = file.head;
  const bom16 = hasBom16(b);
  if (bom16 && file.encoding !== "utf-16") {
    const text = decodes(b[0] === 0xff ? "utf-16le" : "utf-16be", b.subarray(2));
    return {
      kinds: ["utf-16"],
      paragraphs: [
        ["The file starts with a UTF-16 byte order mark, so it looks like UTF-16 text. If it is, choose UTF-16 as its encoding."],
        ...(text ? [["Read as UTF-16, its first line is:", " ", { value: firstLine(text) }]] : []),
      ],
    };
  }
  if (utf16WithoutBom(b)) return NO_BOM;
  const utf8 = decodes("utf-8", b);
  if (utf8 !== null && file.encoding !== "utf-8") {
    return {
      kinds: ["utf-8"],
      paragraphs: [["The start of the file reads as UTF-8. If the file is UTF-8, choose UTF-8 as its encoding."], ["Read as UTF-8, its first line is:", " ", { value: firstLine(utf8.replace(/^﻿/, "")) }]],
    };
  }
  // GB18030 decodes most byte pairs, so it is suggested only for a start that is not UTF-8 and holds more than ASCII.
  const gb = utf8 === null ? decodes("gb18030", b) : null;
  if (gb !== null && file.encoding !== "gb18030" && b.some((x) => x >= 0x80)) {
    return {
      kinds: ["gb18030"],
      paragraphs: [
        ["The start of the file reads as GB18030, an encoding of Chinese text. If the file is GB18030, choose GB18030 as its encoding."],
        ["Read as GB18030, its first line is:", " ", { value: firstLine(gb) }],
      ],
    };
  }
  return null;
}

/* ---------- separators ---------- */

/** ";" or a tab when most of the first lines split on it and the header does too, or null. */
export function separatorOf(text: string): ";" | "\t" | null {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "").slice(0, 50);
  if (!lines.length) return null;
  for (const separator of [";", "\t"] as const) {
    const header = lines[0]!.split(separator).length;
    if (header < 2 || header <= lines[0]!.split(",").length) continue;
    const splitting = lines.filter((l) => l.split(separator).length >= 2).length;
    if (splitting * 2 > lines.length) return separator;
  }
  return null;
}

function separatorParagraph(separator: ";" | "\t"): HintPart[] {
  return [
    separator === ";" ? "Most of the file’s first lines are separated by semicolons:" : "Most of the file’s first lines are separated by tabs:",
    " ",
    { value: separator === ";" ? ";" : "\\t" },
    " ",
    "FlowAssert reads only commas. Export or save the file again as CSV with a comma as the separator; programs that write CSV usually offer that choice when exporting or saving, sometimes under a name such as “comma-separated” or “comma delimited”.",
  ];
}

/* ---------- the header and its rows ---------- */

function reader(file: HintFile): CsvReader | null {
  const b = file.head;
  const complete = b.length >= file.size;
  // The reader needs whole chunks of the start of the file; a shorter prefix is cut to them.
  const usable = complete ? b : b.subarray(0, b.length - (b.length % 8192));
  const text = textOf({ ...file, head: usable });
  if (text === null) return null;
  // The decoded text is read again as bytes of UTF-8, so the reader can split it the way the check does.
  const bytes = new TextEncoder().encode(text);
  const decoder = { decode: (chunk: Uint8Array, final: boolean) => new TextDecoder("utf-8").decode(chunk, { stream: !final }) };
  return new CsvReader(new LineReader(bytes, decoder, !complete));
}

function headerOf(file: HintFile): string[] | null {
  try {
    return readHeader({ name: file.name, bytes: file.head, encoding: file.encoding, complete: file.head.length >= file.size });
  } catch {
    return null;
  }
}

const sameButCaseOrSpace = (a: string, b: string) => a !== b && a.trim().toLowerCase() === b.trim().toLowerCase();

function missingColumnHint(file: HintFile, listed: string): Hint | null {
  // UTF-16 without its mark reads as UTF-8 with a zero byte between letters, so no column name matches.
  if (file.encoding === "utf-8" && utf16WithoutBom(file.head)) return NO_BOM;
  const header = headerOf(file);
  if (!header) return null;
  const missing = file.columns ? [...new Set(file.columns)].filter((c) => !header.includes(c)) : listed.split(", ").filter((c) => !header.includes(c));
  // The page's choices must explain the refusal, or the hint could be about other columns.
  if (!missing.length || missing.join(", ") !== listed) return null;
  const paragraphs: HintPart[][] = [];
  const kinds = ["missing-column"];
  paragraphs.push(header.length === 1 ? ["The file has one column:", " ", { value: header[0]! }] : [`The file has ${header.length} columns:`, " ", { value: header.join(", ") }]);
  for (const name of missing) {
    for (const near of header.filter((h) => sameButCaseOrSpace(h, name))) {
      kinds.push("near-column");
      paragraphs.push(["The file’s column", " ", { value: JSON.stringify(near) }, " ", "differs from", " ", { value: JSON.stringify(name) }, " ", "only in upper and lower case or in spaces around it. Columns are matched exactly: choose the column as the file names it, or a configuration that names it so."]);
    }
  }
  const separator = header.length === 1 ? separatorOf(header[0]!) : null;
  if (separator) {
    kinds.push("separator");
    paragraphs.push(separatorParagraph(separator));
  }
  return { kinds, paragraphs };
}

function lineHint(file: HintFile, line: number): Hint | null {
  const paragraphs: HintPart[][] = [];
  const kinds: string[] = [];
  const r = reader(file);
  if (r) {
    try {
      const header = r.next() ?? [];
      for (let row = r.next(); row !== null; row = r.next()) {
        if (r.lineNum < line) continue;
        if (r.lineNum === line && row.length !== header.length) {
          kinds.push("line-fields");
          paragraphs.push([
            row.length === 1 ? `Line ${line} has 1 field; the header has ${header.length}.` : `Line ${line} has ${row.length} fields; the header has ${header.length}.`,
            ...(row.length > header.length ? [" ", "A value that contains a comma must be inside double quotes, or it is read as two fields."] : []),
          ]);
        }
        break;
      }
    } catch (e) {
      if (!(e instanceof NeedMore || e instanceof CsvError)) throw e;
    }
  }
  const text = textOf(file);
  const separator = text === null ? null : separatorOf(text);
  if (separator) {
    kinds.push("separator");
    paragraphs.push(separatorParagraph(separator));
  }
  return kinds.length ? { kinds, paragraphs } : null;
}

function repeatedHint(file: HintFile): Hint | null {
  const r = reader(file);
  let header: string[] | null = null;
  try {
    header = r?.next() ?? null;
  } catch (e) {
    if (!(e instanceof NeedMore || e instanceof CsvError)) throw e;
  }
  if (!header) return null;
  const repeated = [...new Set(header.filter((h, i) => header.indexOf(h) !== i))];
  if (!repeated.length) return null;
  return {
    kinds: ["repeated-column"],
    paragraphs: [["The header names these columns more than once:", " ", { value: repeated.map((c) => JSON.stringify(c)).join(", ") }, " ", "Give each column a name of its own in the file’s header, then choose the file again."]],
  };
}

/* ---------- the refusal ---------- */

/** The hint for a refusal, or null when none is justified. `message` may start with "refused: ", as the command line prints it. */
export function refusalHint(message: string, files: readonly HintFile[]): Hint | null {
  const text = message.replace(/^refused: /, "");
  const forFile = (name: string, make: (file: HintFile) => Hint | null) => {
    for (const file of files) {
      if (file.name !== name) continue;
      const hint = make(file);
      if (hint) return hint;
    }
    return null;
  };
  let m: RegExpExecArray | null;
  if ((m = /^(.*): not (UTF-8|UTF-16|GB18030)( \(no byte order mark\))?$/s.exec(text))) {
    const label = m[2]!;
    return forFile(m[1]!, (f) => (LABELS[f.encoding] === label ? encodingHint(f) : null));
  }
  if ((m = /^(.*): missing column (.+)$/s.exec(text))) {
    const listed = m[2]!;
    return forFile(m[1]!, (f) => missingColumnHint(f, listed));
  }
  if ((m = /^(.*): line (\d+) does not match the header$/s.exec(text))) {
    const line = Number(m[2]);
    return forFile(m[1]!, (f) => lineHint(f, line));
  }
  if ((m = /^(.*): repeated column name$/s.exec(text))) return forFile(m[1]!, repeatedHint);
  if (text.startsWith("source and destination have identical content")) {
    return {
      kinds: ["identical-content"],
      paragraphs: [
        ["The two files have exactly the same bytes, so the check would compare a file with itself. Choose the export from the destination system as the destination file. If the two files really come from different systems, “Allow identical content” records that statement in the report; FlowAssert cannot check it."],
      ],
    };
  }
  if (text.startsWith("source and destination are the same file")) {
    return { kinds: ["same-file"], paragraphs: [["The same file was chosen twice. Choose the export from the destination system as the destination file."]] };
  }
  if (/: file size \d+ bytes exceeds --max-bytes limit of \d+$/.test(text)) {
    return {
      kinds: ["max-bytes"],
      paragraphs: [[`The browser check reads files of up to ${MAX_BYTES} bytes (200 MiB). For a larger file, use the command line, where --max-bytes sets the limit and the destination file is read without holding it in memory.`]],
    };
  }
  if (/: exceeds --max-rows limit of \d+$/.test(text)) {
    return { kinds: ["max-rows"], paragraphs: [[`The browser check reads up to ${MAX_ROWS} data rows in each file. For a larger file, use the command line, where --max-rows sets the limit.`]] };
  }
  return null;
}
