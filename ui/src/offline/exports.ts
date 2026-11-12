/**
 * The records to resend: CSV files of the rows a check says need action, as offline/flowassert_offline/exports.py
 * writes them, byte for byte. docs/design/1.1-exports.md is the design.
 *
 * An export is advice. It is computed from the records the check concluded and changes none of them. A row whose
 * state is unknown is never placed beside rows the check showed missing, and a destination not stated complete never
 * gives a file of missing rows. Each row is written as it was read, under its file's own header.
 */
import { keyOf, type SourceRecord } from "./evaluator";
import type { Report } from "./report";

export const MISSING = "missing-from-destination.csv";
export const DIFFERS = "values-differ.csv";
export const DUPLICATED = "duplicated-in-destination.csv";
export const UNKNOWN = "unknown-status-resending-may-create-duplicates.csv";
export const ONLY = "only-in-destination.csv";
export const ONLY_UNKNOWN = "only-in-destination-not-concluded.csv";
/** In the order the files are listed. */
export const FILES = [MISSING, DIFFERS, DUPLICATED, UNKNOWN, ONLY, ONLY_UNKNOWN] as const;
export type ExportFile = (typeof FILES)[number];

export const MEANING: Record<ExportFile, string> = {
  [MISSING]: "The destination, stated complete, has no row with this key: these records did not arrive.",
  [DIFFERS]: "The destination has one row with this key, and at least one compared field differs.",
  [DUPLICATED]: "More than one destination row has this key: resending would add another; the destination needs merging.",
  [UNKNOWN]: "The check could not conclude: the record may already be in the destination, so resending it may create a duplicate.",
  [ONLY]: "Scope exact, source population known: the destination has rows whose key is not in the source.",
  [ONLY_UNKNOWN]: "Scope exact, source population unknown: rows whose key is not among the source rows supplied, listed without a conclusion.",
};

export const BOM = "\ufeff";
/** A field a spreadsheet may run as a formula when it opens the file; a plain number is not counted. */
const FORMULA = /^[=+\-@\t\r]/;
const NUMBER = /^[+-]?[0-9]+(?:\.[0-9]+)?$/;

export interface Export {
  file: ExportFile;
  rows: number;
  meaning: string;
  /** How many of its fields begin with =, +, -, @, a tab or a carriage return, plain numbers excepted. */
  formulaFields: number;
  /** The file's text, its byte order mark first: written as UTF-8, it is the command line's file. */
  text: string;
}

/** The file a source record belongs to, or null for a Verified record. */
export function fileOf(record: SourceRecord): ExportFile | null {
  if (record.state === "Verified") return null;
  if (record.state !== "Mismatch") return UNKNOWN;
  const rules = record.rules!;
  if (rules.existence!.status === "fail") return MISSING;
  if (rules.uniqueness!.status === "fail") return DUPLICATED;
  return DIFFERS;
}

/** A file the records to resend will have, known from the report alone, before any file is read again. */
export interface PlannedExport {
  file: ExportFile;
  rows: number;
  meaning: string;
}

/** The files that will have rows, in FILES order, with their row counts: what the page offers before reading. */
export function plannedFiles(report: Report): PlannedExport[] {
  const rows = new Map<ExportFile, number>(FILES.map((f) => [f, 0]));
  for (const record of report.records.problems()) {
    const file = fileOf(record);
    if (file) rows.set(file, rows.get(file)! + 1);
  }
  for (const record of report.destination_only ?? []) {
    const file = record.state === "Mismatch" ? ONLY : ONLY_UNKNOWN;
    rows.set(file, rows.get(file)! + record.rows);
  }
  return FILES.filter((f) => rows.get(f)! > 0).map((file) => ({ file, rows: rows.get(file)!, meaning: MEANING[file] }));
}

/** True when records were not found but the destination was not stated complete: no file of missing rows. */
export function absenceNotEstablished(report: Report): boolean {
  if (report.destination_coverage_sufficient) return false;
  for (const record of report.records.problems()) {
    if (record.key !== null && record.candidates === 0 && record.rules!.existence!.status === "unknown") return true;
  }
  return false;
}

const field = (value: string) => (/[,"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/** One row of an exported file, with its CR LF. */
export function rowText(row: readonly string[]): string {
  // An empty line would be a blank line, which a reader skips.
  if (row.length === 1 && row[0] === "") return '""\r\n';
  return row.map(field).join(",") + "\r\n";
}

export const formulaLike = (value: string) => value !== "" && FORMULA.test(value) && !NUMBER.test(value);

/**
 * Collects the rows to export while a side is read again: `source(values)` for every source data row in order, and
 * `destination(values)` for every destination data row, after `header`. Only the rows wanted are kept.
 */
export class ExportPlan {
  private readonly wanted = new Map<number, ExportFile>();
  private readonly onlyKeys = new Map<string, ExportFile>();
  /** Each row kept as its text, as soon as it is read, and the number of its fields that begin like a formula. */
  private readonly out = new Map<ExportFile, string[]>(FILES.map((f) => [f, []]));
  private readonly formulaFields = new Map<ExportFile, number>(FILES.map((f) => [f, 0]));
  private readonly headers = new Map<ExportFile, readonly string[]>();
  private sourceRow = 0;
  private keyIndex = -1;

  constructor(report: Report) {
    for (const record of report.records.problems()) {
      const file = fileOf(record);
      if (file) this.wanted.set(record.source_row, file);
    }
    for (const record of report.destination_only ?? []) this.onlyKeys.set(record.key, record.state === "Mismatch" ? ONLY : ONLY_UNKNOWN);
  }

  /** Whether the destination needs reading again: only for destination-only rows. */
  get needsDestination(): boolean {
    return this.onlyKeys.size > 0;
  }

  sourceHeader(header: readonly string[]) {
    for (const file of FILES) if (!this.headers.has(file)) this.headers.set(file, header);
  }

  source(values: string[]) {
    const file = this.wanted.get(this.sourceRow++);
    if (file) this.keep(file, values);
  }

  private keep(file: ExportFile, values: string[]) {
    let n = 0;
    for (const value of values) if (formulaLike(value)) n++;
    this.formulaFields.set(file, this.formulaFields.get(file)! + n);
    this.out.get(file)!.push(rowText(values));
  }

  destinationHeader(header: readonly string[], key: string) {
    this.keyIndex = header.indexOf(key);
    this.headers.set(ONLY, header);
    this.headers.set(ONLY_UNKNOWN, header);
  }

  destination(values: string[]) {
    const k = keyOf(values[this.keyIndex] ?? null);
    const file = k === null ? undefined : this.onlyKeys.get(k);
    if (file) this.keep(file, values);
  }

  /** The files that have rows, in FILES order, and the number of exported fields that begin like a formula. */
  finish(): { exports: Export[]; formulas: number } {
    const exports: Export[] = [];
    let formulas = 0;
    for (const file of FILES) {
      const rows = this.out.get(file)!;
      if (!rows.length) continue;
      const formulaFields = this.formulaFields.get(file)!;
      formulas += formulaFields;
      exports.push({ file, rows: rows.length, meaning: MEANING[file], formulaFields, text: BOM + rowText(this.headers.get(file)!) + rows.join("") });
    }
    return { exports, formulas };
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The lines the summary adds after the limitations when the records to resend were written to `directory`. */
export function summaryLines(report: Report, exports: readonly Export[], directory: string, formulas: number): string[] {
  const lines: string[] = [];
  if (!exports.length) lines.push(`Records to resend: none; ${directory} is empty.`);
  else {
    lines.push(`Records to resend, written to ${directory} (advice from this check, not a further conclusion):`);
    for (const e of exports) lines.push(`  ${e.file}: ${plural(e.rows, "row", "rows")}${e.file === UNKNOWN ? "; resending them may create duplicates" : ""}`);
  }
  if (absenceNotEstablished(report)) lines.push(`  No ${MISSING}: the destination was not stated complete, so absence is not established.`);
  if (formulas) {
    lines.push(
      `  ${plural(formulas, "exported field", "exported fields")} ${formulas === 1 ? "begins" : "begin"} with =, +, -, @, a tab or a carriage return: import the files rather than open them in a spreadsheet.`,
    );
  }
  return lines;
}
