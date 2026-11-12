/**
 * Reading a CSV file as cli.CsvFile does: io.TextIOWrapper(encoding, newline="") over the file's bytes, then
 * csv.reader(strict=True) with the default dialect. The same refusals, with the same messages and line numbers.
 *
 * Python decodes the file in chunks of 8192 bytes, only when the CSV reader needs the next line. So a malformed row
 * early in a file is refused as malformed even when a later chunk would not decode, and the other way round. This
 * module reads in the same chunks, at the same moments, so the first refusal is the one Python gives.
 *
 * A file is read as a stream (docs/design/1.0-streaming.md): ByteFeed turns the stream's chunks, whatever their sizes,
 * into those 8192-byte pieces and hashes every byte it hands out; the line reader and the CSV reader keep their state
 * when a piece has not arrived yet (NEED) and continue when it has. No more of a file is held than the chunk in hand.
 *
 * Decoding uses TextDecoder with fatal: true. Python's gb18030 codec and the browser's differ for 22 byte sequences
 * (found by decoding every one- to four-byte sequence both ways); those are decoded as Python decodes them.
 */
import { pyLen } from "./pystr";
import { Sha256 } from "./sha256";

export const MAX_BYTES = 209_715_200;
export const MAX_ROWS = 1_000_000;
/** csv.field_size_limit() default. */
export const FIELD_LIMIT = 131_072;
/** io.TextIOWrapper's chunk size. */
const CHUNK = 8192;
/** The buffer a file's stream is read into, again and again. */
const STREAM_BUFFER = 1 << 20;

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

/**
 * Python's utf_16 incremental decoder (encodings/utf_16.py): the input must start with a byte order mark. Without
 * one, Python first decodes what it has as little-endian, so an invalid sequence there is reported as such, and only
 * once it has decoded at least one character does it refuse the missing mark.
 */
function utf16Decoder(): ChunkDecoder {
  let inner: ChunkDecoder | null = null;
  let held = new Uint8Array(0);
  return {
    decode(chunk, final) {
      if (inner) return inner.decode(chunk, final);
      const bytes = new Uint8Array(held.length + chunk.length);
      bytes.set(held);
      bytes.set(chunk, held.length);
      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) inner = webDecoder("utf-16le");
      else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) inner = webDecoder("utf-16be");
      if (inner) return inner.decode(bytes, final);
      // utf_16_ex_decode in native (little-endian) order: an error first, then the missing mark once a character decoded.
      const decoded = webDecoder("utf-16le").decode(bytes, final);
      if (decoded) throw new DecodeError(true);
      held = bytes;
      return "";
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

/** The next piece of the file has not arrived: ask again after more of the stream is in. */
export const NEED = Symbol("need more bytes");
export type Need = typeof NEED;

/**
 * Where the line reader takes the file's bytes from, 8192 at a time (the last piece shorter). `take` returns an empty
 * piece at the end of the file, and undefined when the next piece is not available yet.
 */
export interface PieceSource {
  take(): Uint8Array | undefined;
}

/** A whole file, or the start of one (`partial`: taking a piece past it throws NeedMore), already in memory. */
function arraySource(bytes: Uint8Array, partial: boolean): PieceSource {
  let position = 0;
  return {
    take() {
      const piece = bytes.subarray(position, position + CHUNK);
      if (partial && piece.length < CHUNK) throw new NeedMore();
      position += piece.length;
      return piece;
    },
  };
}

/**
 * The chunks of a stream, whatever their sizes, handed out as pieces of exactly 8192 bytes, the last one shorter and
 * then an empty one. A piece inside one chunk is a view of it; one that straddles chunks is copied. Every byte handed
 * out goes to the digest, in order, so a file read to its end has the SHA-256 of all its bytes.
 */
export class ByteFeed implements PieceSource {
  /** Bytes handed out so far. */
  bytes = 0;
  private readonly queue: Uint8Array[] = [];
  private at = 0;
  private buffered = 0;
  private ended = false;
  private readonly digest = new Sha256();

  push(chunk: Uint8Array) {
    if (!chunk.length) return;
    this.queue.push(chunk);
    this.buffered += chunk.length;
  }

  end() {
    this.ended = true;
  }

  /** Copy what is left of the chunks pushed so far (less than one piece), because their memory is about to be reused. */
  own() {
    if (!this.buffered) return;
    const rest = new Uint8Array(this.buffered);
    let filled = 0;
    for (const [i, chunk] of this.queue.entries()) {
      const part = i === 0 ? chunk.subarray(this.at) : chunk;
      rest.set(part, filled);
      filled += part.length;
    }
    this.queue.length = 0;
    this.queue.push(rest);
    this.at = 0;
  }

  take(): Uint8Array | undefined {
    if (this.buffered < CHUNK && !this.ended) return undefined;
    const size = Math.min(CHUNK, this.buffered);
    let piece: Uint8Array;
    const first = this.queue[0];
    if (first && first.length - this.at >= size) {
      piece = first.subarray(this.at, this.at + size);
      this.at += size;
    } else {
      piece = new Uint8Array(size);
      for (let filled = 0; filled < size; ) {
        const chunk = this.queue[0]!;
        const part = chunk.subarray(this.at, this.at + size - filled);
        piece.set(part, filled);
        filled += part.length;
        this.at += part.length;
        if (this.at === chunk.length) {
          this.queue.shift();
          this.at = 0;
        }
      }
    }
    if (first && this.queue[0] === first && this.at === first.length) {
      this.queue.shift();
      this.at = 0;
    }
    this.buffered -= size;
    this.bytes += size;
    this.digest.update(piece);
    return piece;
  }

  /** The SHA-256 of every byte handed out, as hex. Call it once, after the file's end. */
  sha256(): string {
    return hex(this.digest.digest());
  }
}

/** How many line endings of each kind the line reader met; `none` is a last line without one. */
export interface LineEndings {
  lf: number;
  crlf: number;
  cr: number;
}

/**
 * Lines as io.TextIOWrapper(newline="") yields them: ending at "\n", "\r\n" or "\r", with the ending kept. A piece is
 * decoded only when no whole line is left, and a final "\r" waits for the next piece (IncrementalNewlineDecoder).
 */
export class LineReader {
  /** Bytes handed to the decoder so far. */
  bytesRead = 0;
  readonly endings: LineEndings = { lf: 0, crlf: 0, cr: 0 };
  private text = "";
  private start = 0;
  /** Where to resume looking for a line ending in `text`. */
  private scan = 0;
  private pendingCr = false;
  private eof = false;
  private readonly source: PieceSource;
  private readonly decoder: ChunkDecoder;

  /** `bytes` is a whole file, the start of one (`partial`), or a source of pieces such as a ByteFeed. */
  constructor(bytes: Uint8Array | PieceSource, decoder: ChunkDecoder, partial = false) {
    // Not instanceof: bytes can come from another realm, such as a Buffer handed in by a sandbox's host.
    this.source = ArrayBuffer.isView(bytes) ? arraySource(bytes, partial) : bytes;
    this.decoder = decoder;
  }

  /** The next line, null at the end of the file, or NEED when the source has no piece ready. */
  readLine(): string | null | Need {
    for (;;) {
      const text = this.text;
      let i = this.scan;
      for (; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c !== 10 && c !== 13) continue;
        // A "\r" at the very end could still be followed by "\n"; the newline decoder holds it back, so only at EOF.
        if (c === 13 && i + 1 >= text.length && !this.eof) break;
        const crlf = c === 13 && text.charCodeAt(i + 1) === 10;
        const end = crlf ? i + 2 : i + 1;
        if (crlf) this.endings.crlf++;
        else if (c === 13) this.endings.cr++;
        else this.endings.lf++;
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
      if (!this.more()) return NEED;
    }
  }

  private more(): boolean {
    const chunk = this.source.take();
    if (chunk === undefined) return false;
    this.bytesRead += chunk.length;
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
    return true;
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
  // The row being read. They outlive a call that returns NEED, so the row continues where it stopped.
  private fields: string[] = [];
  private field = "";
  /** The length of `field` in code points, as Python counts. */
  private length = 0;
  private state: (typeof S)[keyof typeof S] = S.StartRecord;
  private inRow = false;

  constructor(lines: LineReader) {
    this.lines = lines;
  }

  private add(piece: string) {
    const n = pyLen(piece);
    if (this.length + n > FIELD_LIMIT) throw new CsvError(`field larger than field limit (${FIELD_LIMIT})`);
    this.field += piece;
    this.length += n;
  }

  private save() {
    this.fields.push(this.field);
    this.field = "";
    this.length = 0;
  }

  /** The next row from bytes already in memory: [] for a blank line, null at the end. Throws CsvError or DecodeError. */
  next(): string[] | null {
    const row = this.poll();
    if (row === NEED) throw new Error("the CSV reader needs bytes that have not arrived; use poll() with a stream");
    return row;
  }

  /** The next row, [] for a blank line, null at the end, or NEED when the row's next line has not arrived yet. */
  poll(): string[] | null | Need {
    if (!this.inRow) {
      this.fields = [];
      this.field = "";
      this.length = 0;
      this.state = S.StartRecord;
      this.inRow = true;
    }
    do {
      const line = this.lines.readLine();
      if (line === NEED) return NEED;
      if (line === null) {
        this.inRow = false;
        if (this.length !== 0 || this.state === S.InQuotedField) throw new CsvError("unexpected end of data");
        return null;
      }
      this.lineNum++;
      let state = this.state;
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
              this.save();
              state = eol ? S.StartRecord : S.EatCrnl;
            } else if (c === '"') state = S.InQuotedField;
            else if (c === ",") this.save();
            else {
              let j = i + 1;
              while (j < n && line[j] !== "," && line[j] !== "\n" && line[j] !== "\r") j++;
              this.add(line.slice(i, j));
              i = j - 1;
              state = S.InField;
            }
            break;
          case S.InField:
            if (newline || eol) {
              this.save();
              state = eol ? S.StartRecord : S.EatCrnl;
            } else if (c === ",") {
              this.save();
              state = S.StartField;
            } else this.add(c);
            break;
          case S.InQuotedField:
            if (eol) break;
            if (c === '"') state = S.QuoteInQuotedField;
            else {
              let j = i + 1;
              while (j < n && line[j] !== '"') j++;
              this.add(line.slice(i, j));
              i = j - 1;
            }
            break;
          case S.QuoteInQuotedField:
            if (c === '"') {
              this.add('"');
              state = S.InQuotedField;
            } else if (c === ",") {
              this.save();
              state = S.StartField;
            } else if (newline || eol) {
              this.save();
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
      this.state = state;
    } while (this.state !== S.StartRecord);
    this.inRow = false;
    return this.fields;
  }
}

const hex = (bytes: Uint8Array) => {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
};

/**
 * The digest to use where crypto.subtle is missing, for a small file read whole (a configuration). Only the packaged
 * checker (api.ts) sets one, the SHA-256 of sha256.ts. A CSV file is read as a stream, which crypto.subtle cannot
 * hash, so its digest always comes from sha256.ts (ByteFeed).
 */
let digestWithoutSubtle: ((bytes: Uint8Array) => Uint8Array) | null = null;

export function useDigestWithoutSubtle(digest: ((bytes: Uint8Array) => Uint8Array) | null): void {
  digestWithoutSubtle = digest;
}

/** Python's SHA-256 of bytes read whole, as hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = digestWithoutSubtle && !globalThis.crypto?.subtle
    ? digestWithoutSubtle(bytes)
    : new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return hex(digest);
}

/** A file's bytes as they arrive: `read` gives the next chunk, of any size, or null at the end. */
export interface ByteStream {
  read(): Promise<Uint8Array | null>;
  /** True when the next read overwrites the chunk the last one returned: whoever still needs bytes of it copies them first. */
  reuses?: boolean;
  /** Stop reading: the rest of the file is not needed. */
  cancel?(): void;
}

/** Bytes already in memory, as a stream of one chunk. */
export function bytesStream(bytes: Uint8Array): ByteStream {
  let done = false;
  return {
    read: () => {
      const chunk = done ? null : bytes;
      done = true;
      return Promise.resolve(chunk);
    },
  };
}

/**
 * A chosen file (or any Blob) as a stream: File.stream(), read chunk by chunk and never whole. Every browser the page
 * supports has Blob.stream; where it is missing (an old test environment), the file is read whole as one chunk.
 */
export function blobStream(blob: Blob): ByteStream {
  if (typeof blob.stream !== "function") {
    let done = false;
    return {
      read: async () => {
        if (done) return null;
        done = true;
        return new Uint8Array(await blob.arrayBuffer());
      },
    };
  }
  const stream = blob.stream() as ReadableStream<Uint8Array>;
  // A byte stream fills one buffer again and again (a "bring your own buffer" reader), so reading a file allocates
  // nothing per chunk. Where the stream is not a byte stream, each chunk is the browser's own.
  let byob: ReadableStreamBYOBReader | null = null;
  try {
    byob = stream.getReader({ mode: "byob" });
  } catch {
    byob = null;
  }
  if (byob) {
    const own = byob;
    let buffer: ArrayBufferLike = new ArrayBuffer(STREAM_BUFFER);
    return {
      reuses: true,
      read: async () => {
        const { done, value } = await own.read(new Uint8Array(buffer as ArrayBuffer));
        if (value) buffer = value.buffer;
        return done || !value ? null : value;
      },
      cancel: () => void own.cancel().catch(() => undefined),
    };
  }
  const reader = stream.getReader();
  return {
    read: async () => {
      const { done, value } = await reader.read();
      return done ? null : value;
    },
    cancel: () => void reader.cancel().catch(() => undefined),
  };
}

export interface CsvSource {
  /** The name refusals start with: the path on the command line, the file's name in the browser. */
  name: string;
  /** The file's bytes, as a stream; called once. */
  open: () => ByteStream;
  encoding: Encoding;
}

export interface CsvProgress {
  (bytesRead: number, rows: number): void;
}

/** What a complete read of one file gives. */
export interface CsvRead {
  /** Data rows: blank lines are not rows. */
  rows: number;
  header: string[];
  /** SHA-256 of every byte of the file, as hex. */
  sha256: string;
  bytes: number;
  endings: LineEndings;
}

const decodeRefusal = (file: { name: string; encoding: Encoding }, e: unknown): unknown => {
  if (e instanceof DecodeError) return new Refused(`${file.name}: not ${ENCODINGS[file.encoding]}${e.noBom ? " (no byte order mark)" : ""}`);
  if (e instanceof CsvError) return new Refused(`${file.name}: ${e.message}`);
  return e;
};

/**
 * Read one CSV file strictly and once, as iterating cli.CsvFile does: `onRow` gets the values of `columns` for each
 * data row, or of every column when `columns` is null (the file profile). Blank lines are skipped. Resolves to the
 * number of rows, the header and the digest of the whole file, or rejects with Refused before any partial result is
 * used. This one function reads a file for the check and for the profile, so their row counts cannot differ.
 */
export async function readCsv(
  file: CsvSource,
  columns: readonly string[] | null,
  onRow: (values: string[]) => void,
  maxRows: number | bigint = MAX_ROWS,
  progress?: CsvProgress,
  onHeader?: (header: string[]) => void,
): Promise<CsvRead> {
  const stream = file.open();
  const feed = new ByteFeed();
  const lines = new LineReader(feed, decoderFor(file.encoding));
  const reader = new CsvReader(lines);
  const limit = BigInt(maxRows);
  let count = 0;
  /** The next row, waiting for the stream whenever the reader needs bytes that have not arrived. */
  const next = async (): Promise<string[] | null> => {
    for (;;) {
      const row = reader.poll();
      if (row !== NEED) return row;
      if (stream.reuses) feed.own();
      const chunk = await stream.read();
      if (chunk === null) feed.end();
      else feed.push(chunk);
    }
  };
  try {
    let polled = reader.poll();
    const header = (polled === NEED ? await next() : polled) ?? [];
    if (new Set(header).size !== header.length) throw new Refused(`${file.name}: repeated column name`);
    const wanted = columns === null ? header : [...new Set(columns)];
    const missing = wanted.filter((c) => !header.includes(c));
    if (missing.length) throw new Refused(`${file.name}: missing column ${missing.join(", ")}`);
    const index = columns === null ? null : columns.map((c) => header.indexOf(c));
    const width = header.length;
    onHeader?.(header);
    let lastReport = 0;
    for (;;) {
      // Rows are taken synchronously while the feed has bytes; the stream is awaited only when it runs dry.
      polled = reader.poll();
      const row = polled === NEED ? await next() : polled;
      if (row === null) break;
      if (row.length === 0) continue; // a blank line is not a record
      if (row.length !== width) throw new Refused(`${file.name}: line ${reader.lineNum} does not match the header`);
      if (BigInt(count) === limit) throw new Refused(`${file.name}: exceeds --max-rows limit of ${maxRows}`);
      count++;
      onRow(index === null ? row : index.map((i) => row[i]!));
      if (progress && lines.bytesRead - lastReport >= 1 << 18) {
        lastReport = lines.bytesRead;
        progress(lastReport, count);
      }
    }
    progress?.(lines.bytesRead, count);
    return { rows: count, header, sha256: feed.sha256(), bytes: feed.bytes, endings: lines.endings };
  } catch (e) {
    stream.cancel?.();
    throw decodeRefusal(file, e);
  }
}

/**
 * The header of a file, for choosing columns, refused as the full read would refuse a bad header. `bytes` may be the
 * start of the file only (`complete` false, a multiple of 8192 bytes long); NeedMore asks for a longer start.
 */
export function readHeader(file: { name: string; bytes: Uint8Array; encoding: Encoding; complete: boolean }): string[] {
  const reader = new CsvReader(new LineReader(file.bytes, decoderFor(file.encoding), !file.complete));
  try {
    const header = reader.next() ?? [];
    if (new Set(header).size !== header.length) throw new Refused(`${file.name}: repeated column name`);
    return header;
  } catch (e) {
    throw decodeRefusal(file, e);
  }
}
