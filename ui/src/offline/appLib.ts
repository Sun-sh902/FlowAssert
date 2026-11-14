/**
 * The readers the iPhone and iPad app uses beside the packaged checker (docs/design/1.2-ios-app.md). They are the
 * browser's own: the file profile of the CSV check page (profile.ts), the worksheet listing of the .xlsx reader
 * (xlsx.ts), the saved-report reader (savedReport.ts), the result explorer (explore.ts), "What this result means"
 * (explain.ts) and the character diff (chardiff.ts). None of them checks anything: the verdict, every count and every
 * refusal of a check come from checkCsv in flowassert-check.js; these read a file before a check, or the report after
 * one, exactly as the browser does.
 *
 * `npm run build:app` bundles this module into one script, dist-app/flowassert-app.js, that defines the global
 * FlowAssertApp. Every value it returns can be passed to Swift as it is: no BigInt, no class, no Map.
 */
import { canonicalConfig } from "./check";
import { align, codePoint, codePoints, notes, pieces, type Run } from "./chardiff";
import { MAX_BYTES, Refused, bytesStream, type Encoding } from "./csv";
import { explain } from "./explain";
import { ANY, Explorer, type Query } from "./explore";
import { profileCsv, profileXlsx, type ProfileResult } from "./profile";
import { NotAReport, factsOfSaved, readReport, type SavedReport } from "./savedReport";
import { listSheets } from "./xlsx";

export const VERSION = "1.1.0";

/** A file as the app hands it over: its name, its bytes, and how the person asked for it to be read. */
export interface AppFile {
  name: string;
  bytes: Uint8Array;
  encoding?: string;
  format?: "csv" | "xlsx";
  worksheet?: string;
}

const blobOf = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]);

/** The file profile the CSV check page shows: rows, columns with their empty cells, byte order mark, line endings, or
 * for a workbook the worksheet's; or the refusal a check would give the file. */
export async function profile(file: AppFile): Promise<ProfileResult> {
  if (file.format === "xlsx") return profileXlsx({ name: file.name, size: file.bytes.length, blob: blobOf(file.bytes), worksheet: file.worksheet });
  const bytes = file.bytes;
  return profileCsv({ name: file.name, size: bytes.length, encoding: (file.encoding ?? "utf-8") as Encoding, open: () => bytesStream(bytes), head: () => Promise.resolve(bytes.slice(0, 4)) });
}

export type SheetsResult = { ok: true; sheets: { name: string; state: string; bytes: number | null; worksheet: boolean }[] } | { ok: false; message: string };

/** A workbook's sheets, as the check would list them, before any worksheet is read. */
export async function sheets(file: AppFile): Promise<SheetsResult> {
  try {
    return { ok: true, sheets: await listSheets({ name: file.name, blob: blobOf(file.bytes) }, MAX_BYTES) };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, message: e.message };
    throw e;
  }
}

/** The configuration file of the person's choices, as the CSV check page writes it for "Download configuration". */
export function configuration(key: [string, string], fields: [string, string, string][], scope: "source" | "exact"): string {
  return canonicalConfig({ key, fields, scope });
}

/* ---------- Reports ---------- */

const opened = new Map<number, { report: SavedReport; explorer: Explorer; redacted: boolean }>();
let next = 1;

/** A premise's stated value, as text where the report holds a whole number of any size. */
const plain = (value: unknown): unknown =>
  typeof value === "bigint" ? value.toString() : Array.isArray(value) ? value.map(plain) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)])) : value;

export type OpenResult =
  | {
      ok: true;
      id: number;
      schemaVersion: number;
      cohort: string;
      claim: string | null;
      counts: Record<string, number>;
      expectedTotal: number | null;
      sourceRows: number;
      populationKnown: boolean;
      coverageSufficient: boolean;
      destinationRowsWithoutKey: number;
      premises: [string, unknown][];
      inputs: Record<string, unknown>;
      obligation: unknown;
      limitations: string;
      evaluatedAt: string;
      details: string;
      redacted: boolean;
      rules: string[];
      total: number;
      destinationOnlyTotal: number | null;
      destinationOnlyCounts: Record<string, number> | null;
      explanation: unknown;
    }
  | { ok: false; check: string; message: string };

/** Read a report with the saved-report reader: a file that is not a valid FlowAssert report is refused, and nothing
 * of it is kept. The report stays in this page, under the id returned, until it is released. */
export function open(bytes: Uint8Array, name: string): OpenResult {
  let read;
  try {
    read = readReport(bytes, name);
  } catch (e) {
    if (e instanceof NotAReport) return { ok: false, check: e.check, message: e.message };
    throw e;
  }
  const report = read.report;
  const facts = factsOfSaved(report);
  const explorer = new Explorer({ length: report.records.length, at: (p) => report.records[p]!, destinationOnly: report.destination_only ?? null }, facts);
  const id = next++;
  opened.set(id, { report, explorer, redacted: read.redacted });
  return {
    ok: true,
    id,
    schemaVersion: report.schema_version,
    cohort: report.cohort_state,
    claim: report.claim,
    counts: { ...report.counts },
    expectedTotal: report.expected_total,
    sourceRows: report.source_rows_observed,
    populationKnown: report.source_population_known,
    coverageSufficient: report.destination_coverage_sufficient,
    destinationRowsWithoutKey: report.destination_rows_without_key,
    premises: Object.entries(report.premises).map(([k, v]) => [k, plain(v)]),
    inputs: plain(report.inputs) as Record<string, unknown>,
    obligation: plain(report.obligation),
    limitations: report.limitations,
    evaluatedAt: report.evaluated_at,
    details: report.details,
    redacted: read.redacted,
    rules: facts.rules,
    total: facts.total,
    destinationOnlyTotal: facts.destinationOnlyTotal,
    destinationOnlyCounts: report.destination_only_counts ? { ...report.destination_only_counts } : null,
    explanation: plain(explain(report, { redacted: read.redacted })),
  };
}

function get(id: number) {
  const r = opened.get(id);
  if (!r) throw new Error(`no report ${id} is open`);
  return r;
}

/** List the records that match: as the browser's explorer does. Returns how many match. */
export function query(id: number, q: Partial<Query>) {
  return get(id).explorer.query({ ...ANY, ...q });
}

/** `count` records of the last query, from `start`. */
export function window(id: number, start: number, count: number) {
  return plain(get(id).explorer.window(start, count));
}

export function release(id: number) {
  opened.delete(id);
}

/** Each run with its pieces: invisible characters as the visible tokens the browser draws (· → ↵ NBSP U+202E …). */
const drawn = (runs: Run[]) =>
  runs.map((run, i) => ({ kind: run.kind, pieces: pieces(run.text, run.kind !== "same", { start: i === 0, end: i === runs.length - 1 }) }));

/** Where two values differ, as the record panel of the browser and the HTML report draw it. */
export function diff(a: string, b: string) {
  const alignment = align(a, b);
  return {
    source: drawn(alignment.source),
    destination: drawn(alignment.destination),
    tooLong: alignment.tooLong,
    sourceCodePoints: codePoints(alignment.source),
    destinationCodePoints: codePoints(alignment.destination),
    notes: notes(a, b),
  };
}

export { codePoint };
