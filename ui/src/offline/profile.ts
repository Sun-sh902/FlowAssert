/**
 * What the page shows of a file before any check (docs/design/1.0-browser.md): the file profile, the key profile, and
 * the lines that say what a check would do with them. All of it is advisory: it is read from the files, changes no
 * file, choice or statement, and is never a result.
 *
 * One code path for one number. The profile reads a file with readCsv, the function the check reads it with, so its
 * row count is the count the report records and its refusal is the refusal the check gives. The key profile counts
 * keys with the Evaluation the check counts them with. A stated total is compared with sameCount, as the evaluator
 * compares it.
 */
import { MAX_BYTES, MAX_ROWS, Refused, readCsv, type CsvSource, type Encoding, type LineEndings } from "./csv";
import { Evaluation, sameCount } from "./evaluator";

/** The byte order mark at the start of a file, for the encoding it is read with. */
export type Bom = "none" | "utf-8" | "utf-16-le" | "utf-16-be" | "gb18030";

export interface ColumnProfile {
  name: string;
  /** Cells of this column that are the empty string. */
  empty: number;
}

export interface FileProfile {
  /** Data rows, as the check counts them: blank lines are not rows. */
  rows: number;
  columns: ColumnProfile[];
  encoding: Encoding;
  bom: Bom;
  endings: LineEndings;
  /** The file's size in bytes. */
  size: number;
}

export type ProfileResult = { ok: true; profile: FileProfile } | { ok: false; message: string };

export interface KeyProfile {
  column: string;
  rows: number;
  /** Rows whose key is empty or only whitespace. */
  withoutKey: number;
  /** Keys that appear in more than one row. */
  repeatedKeys: number;
}

export type KeyProfileResult = { ok: true; key: KeyProfile } | { ok: false; message: string };

/** The reading was given up because its file or encoding was replaced; it has no result. */
export class Abandoned extends Error {}

export interface ProfileSource extends CsvSource {
  size: number;
  /** The file's first four bytes, for the byte order mark. */
  head: () => Promise<Uint8Array>;
}

export function bomOf(head: Uint8Array, encoding: Encoding): Bom {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  if (encoding === "utf-8") return starts(0xef, 0xbb, 0xbf) ? "utf-8" : "none";
  if (encoding === "utf-16") return starts(0xff, 0xfe) ? "utf-16-le" : starts(0xfe, 0xff) ? "utf-16-be" : "none";
  return starts(0x84, 0x31, 0x95, 0x33) ? "gb18030" : "none";
}

const sizeRefusal = (source: ProfileSource) =>
  source.size > MAX_BYTES ? `${source.name}: file size ${source.size} bytes exceeds --max-bytes limit of ${MAX_BYTES}` : null;

/** How often a long read looks at whether it was abandoned, and reports its rows. */
const EVERY = 4096;

/**
 * The profile of one file: read whole, as a stream, with the check's reader and every column. A file the check would
 * refuse is refused here with the same message. `progress` gets the rows read so far; `abandoned` ends the read.
 */
export async function profileCsv(source: ProfileSource, progress?: (rows: number) => void, abandoned?: () => boolean): Promise<ProfileResult> {
  const tooLarge = sizeRefusal(source);
  if (tooLarge) return { ok: false, message: tooLarge };
  let empty: Float64Array | null = null;
  let rows = 0;
  try {
    const head = await source.head();
    const read = await readCsv(source, null, (row) => {
      empty ??= new Float64Array(row.length);
      for (let i = 0; i < row.length; i++) if (row[i] === "") empty[i]!++;
      if (++rows % EVERY === 0) {
        if (abandoned?.()) throw new Abandoned();
        progress?.(rows);
      }
    }, MAX_ROWS);
    const columns = read.header.map((name, i) => ({ name, empty: empty?.[i] ?? 0 }));
    return { ok: true, profile: { rows: read.rows, columns, encoding: source.encoding, bom: bomOf(head, source.encoding), endings: read.endings, size: source.size } };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, message: e.message };
    throw e;
  }
}

/** The key profile of one column of one file: rows without a key, and keys in more than one row. */
export async function keyProfileCsv(source: ProfileSource, column: string, abandoned?: () => boolean): Promise<KeyProfileResult> {
  const tooLarge = sizeRefusal(source);
  if (tooLarge) return { ok: false, message: tooLarge };
  // The check's own count of keys: an evaluation with this key column and no field.
  const keys = new Evaluation({ key: [column, column], fields: [] });
  let rows = 0;
  try {
    await readCsv(source, [column], (row) => {
      keys.addSource(row[0]!, []);
      if (++rows % EVERY === 0 && abandoned?.()) throw new Abandoned();
    }, MAX_ROWS);
    return { ok: true, key: { column, ...keys.keyFacts() } };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, message: e.message };
    throw e;
  }
}

/* ---------- What a check would do ---------- */

/** A piece of a line: interface text, or a value from a file (a column or file name), shown as it is. */
export type Part = string | { value: string };

export interface Warning {
  /** Which fact the line states; the same id never appears twice. */
  id: string;
  parts: Part[];
}

export interface SideFacts {
  /** The file's name, as a refusal would name it. */
  fileName: string | null;
  /** The profile of the file as chosen now, or null while it is not known. */
  profile: FileProfile | null;
  /** The key profile of the key column chosen now, or null while it is not known. */
  key: KeyProfile | null;
  /** The columns the check would need from this file: the key and the compared fields. */
  columns: readonly string[];
  /** The completeness statement, as ticked now. */
  complete: boolean;
  /** The stated total as typed: digits only, or empty. */
  count: string;
}

const grouped = (n: number) => n.toLocaleString("en-US");
const rowsText = (n: number) => (n === 1 ? "1 row" : `${grouped(n)} rows`);

/**
 * The lines of "Before you check": what a check started now would do, from the profiles. Each is true of the facts
 * given; where a fact is not known yet, its line is absent. They state consequences and change nothing.
 */
export function beforeYouCheck(source: SideFacts, destination: SideFacts): Warning[] {
  const lines: Warning[] = [];
  for (const [side, facts] of [["source", source], ["destination", destination]] as const) {
    const held = side === "source" ? "the file" : "the export";
    if (facts.profile && /^[0-9]+$/.test(facts.count) && !sameCount(BigInt(facts.count), facts.profile.rows)) {
      // Leading zeros are not part of the number the report records.
      const stated = BigInt(facts.count).toString();
      lines.push({
        id: `${side}-count`,
        parts: [
          facts.complete
            ? `If you check now, the ${side} statement will not be applied: ${held} has ${rowsText(facts.profile.rows)}, not ${stated}.`
            : `If you check now, the ${side} total will be recorded as not matching: ${held} has ${rowsText(facts.profile.rows)}, not ${stated}.`,
        ],
      });
    }
  }
  for (const [side, facts] of [["source", source], ["destination", destination]] as const) {
    const header = facts.profile?.columns.map((c) => c.name);
    if (header && facts.fileName !== null) {
      const file = side === "source" ? "the source file" : "the destination export";
      for (const column of new Set(facts.columns)) {
        if (column && !header.includes(column)) lines.push({ id: `${side}-missing:${column}`, parts: [`If you check now, it will be refused, because this column is not in ${file}:`, " ", { value: column }] });
      }
    }
  }
  const keyLine = (id: string, key: KeyProfile, one: string, many: (n: string) => string, n: number) =>
    lines.push({ id, parts: [n === 1 ? one : many(grouped(n)), " ", { value: key.column }] });
  if (source.key) {
    const k = source.key;
    if (k.withoutKey) {
      keyLine("source-without-key", k, "If you check now, the batch cannot be Verified: 1 source row has no key in this column:", (n) => `If you check now, the batch cannot be Verified: ${n} source rows have no key in this column:`, k.withoutKey);
    }
    if (k.repeatedKeys) {
      keyLine("source-repeated-key", k, "If you check now, the batch cannot be Verified: 1 key appears in more than one source row in this column:", (n) => `If you check now, the batch cannot be Verified: ${n} keys appear in more than one source row in this column:`, k.repeatedKeys);
    }
  }
  if (destination.key) {
    const k = destination.key;
    if (k.withoutKey) {
      keyLine("destination-without-key", k, "If you check now, absence and uniqueness will stay unknown: 1 destination row has no key in this column:", (n) => `If you check now, absence and uniqueness will stay unknown: ${n} destination rows have no key in this column:`, k.withoutKey);
    }
    if (k.repeatedKeys) {
      keyLine(
        "destination-repeated-key",
        k,
        "If you check now, no source record with this key can be Verified: 1 key appears in more than one destination row in this column:",
        (n) => `If you check now, no source record with one of these keys can be Verified: ${n} keys appear in more than one destination row in this column:`,
        k.repeatedKeys,
      );
    }
  }
  return lines;
}
