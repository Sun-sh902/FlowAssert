/**
 * Reading a CSV file as cli.CsvFile does: io.TextIOWrapper(encoding, newline="") over the file's bytes, then
 * csv.reader(strict=True) with the default dialect. The same refusals, with the same messages and line numbers.
 *
 * Python decodes the file in chunks of 8192 bytes, only when the CSV reader needs the next line. So a malformed row
 * early in a file is refused as malformed even when a later chunk would not decode, and the other way round. This
 * module reads in the same chunks, at the same moments, so the first refusal is the one Python gives.
 *
 * Decoding uses TextDecoder with fatal: true. Python's gb18030 codec and the browser's differ for 22 byte sequences
 * (found by decoding every one- to four-byte sequence both ways); those are decoded as Python decodes them.
 */
import { pyLen } from "./pystr";

export const MAX_BYTES = 209_715_200;
export const MAX_ROWS = 1_000_000;
/** csv.field_size_limit() default. */
export const FIELD_LIMIT = 131_072;
/** io.TextIOWrapper's chunk size. */
const CHUNK = 8192;

export const ENCODINGS = { "utf-8": "UTF-8", "utf-16": "UTF-16", gb18030: "GB18030" } as const;
export type Encoding = keyof typeof ENCODINGS;

/** The input is refused; the message is the one the command-line checker prints after "refused: ". */
export class Refused extends Error {}

class DecodeError extends Error {
  readonly noBom: boolean;
  constructor(noBom = false) {
    super("decode");
    this.noBom = noBom;
  }
}

interface ChunkDecoder {
  /** Decode the next chunk; `final` with an empty chunk at the end of the file. Throws DecodeError. */
  decode(chunk: Uint8Array, final: boolean): string;
}

function webDecoder(label: string): ChunkDecoder {
  const d = new TextDecoder(label, { fatal: true });
  return {
    decode(chunk, final) {
      try {
        return d.decode(chunk, { stream: !final });
      } catch {
        throw new DecodeError();
      }
    },
  };
}

/** Python's utf_16 incremental decoder: the first two bytes must be a byte order mark. */
function utf16Decoder(): ChunkDecoder {
  let inner: ChunkDecoder | null = null;
  let held = new Uint8Array(0);
  return {
    decode(chunk, final) {
      if (inner) return inner.decode(chunk, final);
      const bytes = new Uint8Array(held.length + chunk.length);
      bytes.set(held);
      bytes.set(chunk, held.length);
      if (bytes.length < 2) {
        if (final && bytes.length) throw new DecodeError();
        held = bytes;
        return "";
      }
      if (bytes[0] === 0xff && bytes[1] === 0xfe) inner = webDecoder("utf-16le");
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) inner = webDecoder("utf-16be");
      else throw new DecodeError(true);
      return inner.decode(bytes, final);
    },
  };
}

/** Byte sequences that Python's gb18030 codec decodes differently from the WHATWG decoder, as Python decodes them. */
const GB18030_PYTHON: ReadonlyMap<number, number> = new Map([
  [0xa3a0, 0xe5e5], [0xa6d9, 0xe78d], [0xa6da, 0xe78e], [0xa6db, 0xe78f], [0xa6dc, 0xe790], [0xa6dd, 0xe791],
  [0xa6de, 0xe792], [0xa6df, 0xe793], [0xa6ec, 0xe794], [0xa6ed, 0xe795], [0xa6f3, 0xe796], [0xa8bc, 0xe7c7],
  [0xfe59, 0xe81e], [0xfe61, 0xe826], [0xfe66, 0xe82b], [0xfe67, 0xe82c], [0xfe6d, 0xe832], [0xfe7e, 0xe843],
  [0xfe90, 0xe854], [0xfea0, 0xe864], [0x8135f437, 0x1e3f],
]);

/**
 * GB18030 as Python decodes it: the bytes are split into whole sequences here, runs of ordinary sequences go to the
 * browser's decoder, and the 22 differing ones are replaced (0x80 alone is an error in Python). An incomplete
 * sequence at the end of a chunk waits for the next chunk, as Python's incremental decoder keeps it.
 */
function gb18030Decoder(): ChunkDecoder {
  const whole = new TextDecoder("gb18030", { fatal: true });
  let held = new Uint8Array(0);
  const run = (bytes: Uint8Array) => {
    try {
      return whole.decode(bytes);
    } catch {
      throw new DecodeError();
    }
  };
  return {
    decode(chunk, final) {
      const bytes = held.length ? new Uint8Array(held.length + chunk.length) : chunk;
      if (held.length) {
        bytes.set(held);
        bytes.set(chunk, held.length);
      }
      let out = "";
      let start = 0;
      let i = 0;
      while (i < bytes.length) {
        const b = bytes[i]!;
        if (b < 0x80) {
          i++;
          continue;
        }
        if (b === 0x80 || b === 0xff) throw new DecodeError();
        if (i + 1 >= bytes.length) break;
        const b2 = bytes[i + 1]!;
        let size: number;
        if (b2 >= 0x30 && b2 <= 0x39) {
          if (i + 3 >= bytes.length) break; // Python checks the third and fourth bytes only once it has both
          const b3 = bytes[i + 2]!;
          const b4 = bytes[i + 3]!;
          if (!(b3 >= 0x81 && b3 <= 0xfe) || !(b4 >= 0x30 && b4 <= 0x39)) throw new DecodeError();
          size = 4;
        } else if ((b2 >= 0x40 && b2 <= 0x7e) || (b2 >= 0x80 && b2 <= 0xfe)) size = 2;
        else throw new DecodeError();
        const code = size === 2 ? (b << 8) | b2 : ((b << 24) | (b2 << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0;
        const replaced = GB18030_PYTHON.get(code);
        if (replaced !== undefined) {
          out += run(bytes.subarray(start, i)) + String.fromCodePoint(replaced);
          start = i + size;
        }
        i += size;
      }
      out += run(bytes.subarray(start, i));
      held = bytes.slice(i);
      if (final && held.length) throw new DecodeError();
      return out;
    },
  };
}

function decoderFor(encoding: Encoding): ChunkDecoder {
  if (encoding === "utf-16") return utf16Decoder();
  if (encoding === "gb18030") return gb18030Decoder();
  return webDecoder("utf-8"); // removes one leading byte order mark, as Python's utf-8-sig does
}

/** The bytes given are only the start of the file, and more are needed. */
export class NeedMore extends Error {}

/**
 * Lines as io.TextIOWrapper(newline="") yields them: ending at "\n", "\r\n" or "\r", with the ending kept. A chunk is
 * decoded only when no whole line is left, and a final "\r" waits for the next chunk (IncrementalNewlineDecoder).
 * With `partial`, `bytes` is only the start of the file: reading past it throws NeedMore instead of ending the file.
 */
export class LineReader {
  private position = 0;
  private text = "";
  private start = 0;
  /** Where to resume looking for a line ending in `text`. */
  private scan = 0;
  private pendingCr = false;
  private eof = false;
  private readonly bytes: Uint8Array;
  private readonly decoder: ChunkDecoder;
  private readonly partial: boolean;

  constructor(bytes: Uint8Array, decoder: ChunkDecoder, partial = false) {
    this.bytes = bytes;
    this.decoder = decoder;
    this.partial = partial;
  }

  /** Bytes handed to the decoder so far. */
  get bytesRead(): number {
    return this.position;
  }

  readLine(): string | null {
    for (;;) {
      const text = this.text;
      let i = this.scan;
      for (; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c !== 10 && c !== 13) continue;
        // A "\r" at the very end could still be followed by "\n"; the newline decoder holds it back, so only at EOF.
        if (c === 13 && i + 1 >= text.length && !this.eof) break;
        const end = c === 13 && text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
        const line = text.slice(this.start, end);
        this.start = this.scan = end;
        return line;
      }
      this.scan = i;
      if (this.eof) {
        if (this.start >= text.length) return null;
        const line = text.slice(this.start);
        this.start = this.scan = text.length;
        return line;
      }
      this.more();
    }
  }

  private more() {
    const chunk = this.bytes.subarray(this.position, this.position + CHUNK);
    if (this.partial && chunk.length < CHUNK) throw new NeedMore();
    this.position += chunk.length;
    const final = chunk.length === 0;
    let out = this.decoder.decode(chunk, final);
    if (this.pendingCr && (out || final)) {
      out = "\r" + out;
      this.pendingCr = false;
    }
    if (!final && out.endsWith("\r")) {
      out = out.slice(0, -1);
      this.pendingCr = true;
    }
    this.text = this.text.slice(this.start) + out;
    this.scan -= this.start;
    this.start = 0;
    this.eof = final;
  }
}

/** The C reader's states (Modules/_csv.c); the escape states do not occur without an escape character. */
const S = { StartRecord: 0, StartField: 1, InField: 2, InQuotedField: 3, QuoteInQuotedField: 4, EatCrnl: 5 } as const;

/** csv.Error: the message is the one Python's _csv module gives. */
export class CsvError extends Error {}

/** csv.reader(lines, strict=True) with the default dialect: delimiter ",", quote '"', doubled quotes, no escape. */
export class CsvReader {
  /** reader.line_num: lines read from the source so far. */
  lineNum = 0;
  private readonly lines: LineReader;

  constructor(lines: LineReader) {
    this.lines = lines;
  }

  /** The next row, [] for a blank line, or null at the end. Throws CsvError, or DecodeError from the lines. */
  next(): string[] | null {
    const fields: string[] = [];
    let field = "";
    let length = 0; // in code points, as Python counts
    let state: (typeof S)[keyof typeof S] = S.StartRecord;
    const add = (piece: string) => {
      const n = pyLen(piece);
      if (length + n > FIELD_LIMIT) throw new CsvError(`field larger than field limit (${FIELD_LIMIT})`);
      field += piece;
      length += n;
    };
    const save = () => {
      fields.push(field);
      field = "";
      length = 0;
    };
    do {
      const line = this.lines.readLine();
      if (line === null) {
        if (length !== 0 || state === S.InQuotedField) throw new CsvError("unexpected end of data");
        return null;
      }
      this.lineNum++;
      let i = 0;
      const n = line.length;
      while (i <= n) {
        // i === n is the end-of-line marker the C reader processes after each line.
        const eol = i === n;
        const c = eol ? "" : line[i]!;
        const newline = c === "\n" || c === "\r";
        if (state === S.StartRecord) {
          if (eol) break;
          if (newline) {
            state = S.EatCrnl;
            i++;
            continue;
          }
          state = S.StartField; // a normal character is handled as the start of a field
        }
        switch (state) {
          case S.StartField:
            if (newline || eol) {
              save();
              state = eol ? S.StartRecord : S.EatCrnl;
            } else if (c === '"') state = S.InQuotedField;
            else if (c === ",") save();
            else {
              let j = i + 1;
              while (j < n && line[j] !== "," && line[j] !== "\n" && line[j] !== "\r") j++;
              add(line.slice(i, j));
              i = j - 1;
              state = S.InField;
            }
            break;
          case S.InField:
            if (newline || eol) {
              save();
              state = eol ? S.StartRecord : S.EatCrnl;
            } else if (c === ",") {
              save();
              state = S.StartField;
            } else add(c);
            break;
          case S.InQuotedField:
            if (eol) break;
            if (c === '"') state = S.QuoteInQuotedField;
            else {
              let j = i + 1;
              while (j < n && line[j] !== '"') j++;
              add(line.slice(i, j));
              i = j - 1;
            }
            break;
          case S.QuoteInQuotedField:
            if (c === '"') {
              add('"');
              state = S.InQuotedField;
            } else if (c === ",") {
              save();
              state = S.StartField;
            } else if (newline || eol) {
              save();
              state = eol ? S.StartRecord : S.EatCrnl;
            } else throw new CsvError(`',' expected after '"'`);
            break;
          case S.EatCrnl:
            if (newline) break;
            if (eol) {
              state = S.StartRecord;
              break;
            }
            throw new CsvError("new-line character seen in unquoted field - do you need to open the file with newline=''?");
        }
        i++;
      }
    } while (state !== S.StartRecord);
    return fields;
  }
}

/** Python's SHA-256 of the file's bytes, as hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CsvSource {
  /** The name refusals start with: the path on the command line, the file's name in the browser. */
  name: string;
  bytes: Uint8Array;
  encoding: Encoding;
}

export interface CsvProgress {
  (bytesRead: number, rows: number): void;
}

/**
 * Read one CSV file strictly and once, as iterating cli.CsvFile does: `onRow` gets the values of `columns` for each
 * data row. Blank lines are skipped. Returns the number of rows, or throws Refused before any partial result is used.
 */
export function readCsv(
  file: CsvSource,
  columns: readonly string[],
  onRow: (values: string[]) => void,
  maxRows: number | bigint = MAX_ROWS,
  progress?: CsvProgress,
): number {
  const label = ENCODINGS[file.encoding];
  const wanted = [...new Set(columns)];
  const lines = new LineReader(file.bytes, decoderFor(file.encoding));
  const reader = new CsvReader(lines);
  let count = 0;
  try {
    const header = reader.next() ?? [];
    if (new Set(header).size !== header.length) throw new Refused(`${file.name}: repeated column name`);
    const missing = wanted.filter((c) => !header.includes(c));
    if (missing.length) throw new Refused(`${file.name}: missing column ${missing.join(", ")}`);
    const index = columns.map((c) => header.indexOf(c));
    const width = header.length;
    let lastReport = 0;
    for (let row = reader.next(); row !== null; row = reader.next()) {
      if (row.length === 0) continue; // a blank line is not a record
      if (row.length !== width) throw new Refused(`${file.name}: line ${reader.lineNum} does not match the header`);
      if (BigInt(count) === BigInt(maxRows)) throw new Refused(`${file.name}: exceeds --max-rows limit of ${maxRows}`);
      count++;
      onRow(index.map((i) => row[i]!));
      if (progress && lines.bytesRead - lastReport >= 1 << 20) {
        lastReport = lines.bytesRead;
        progress(lastReport, count);
      }
    }
  } catch (e) {
    if (e instanceof DecodeError) throw new Refused(`${file.name}: not ${label}${e.noBom ? " (no byte order mark)" : ""}`);
    if (e instanceof CsvError) throw new Refused(`${file.name}: ${e.message}`);
    throw e;
  }
  return count;
}

/**
 * The header of a file, for choosing columns, refused as the full read would refuse a bad header. `bytes` may be the
 * start of the file only (`complete` false, a multiple of 8192 bytes long); NeedMore asks for a longer start.
 */
export function readHeader(file: CsvSource & { complete: boolean }): string[] {
  const label = ENCODINGS[file.encoding];
  const reader = new CsvReader(new LineReader(file.bytes, decoderFor(file.encoding), !file.complete));
  try {
    const header = reader.next() ?? [];
    if (new Set(header).size !== header.length) throw new Refused(`${file.name}: repeated column name`);
    return header;
  } catch (e) {
    if (e instanceof DecodeError) throw new Refused(`${file.name}: not ${label}${e.noBom ? " (no byte order mark)" : ""}`);
    if (e instanceof CsvError) throw new Refused(`${file.name}: ${e.message}`);
    throw e;
  }
}
