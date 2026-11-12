/**
 * How the CSV check page runs a check: in a Web Worker (./worker.ts), so reading and evaluating large files never
 * blocks the page, or in this thread for the unit tests. Both run the same code (pageCheck, readHeader) and give the
 * same results. Nothing here makes a request: files are read as streams (File.stream), never whole, and the reports
 * are built as Blobs in pieces, so neither a file nor a report is ever one value in memory.
 *
 * Two workers are started before any file is chosen, so nothing has to load code later: one runs checks, the other
 * reads headers and profiles (./profile.ts). Cancelling a check ends its worker at once and starts the next one; a
 * cancelled check never delivers a result, and the profiles being read are not disturbed.
 */
import { exportsOf, type InputFile } from "./check";
import { ByteFeed, MAX_BYTES, NeedMore, Refused, blobStream, readHeader, type Encoding } from "./csv";
import type { DestinationOnlyRecord, Premise, SourceRecord, State } from "./evaluator";
import { explain, type Explanation } from "./explain";
import { absenceNotEstablished, plannedFiles, type Export, type PlannedExport } from "./exports";
import { Explorer, rulesOf, type Facts, type Item, type Matched, type Query, type RecordAccess, type RecordStore } from "./explore";
import { pageCheck, type ChosenConfig } from "./pageCheck";
import { Abandoned, keyProfileCsv, keyProfileXlsx, profileCsv, profileXlsx, type KeyProfileResult, type ProfileResult, type ProfileSource } from "./profile";
import { writeHtml, writeJson, type Report } from "./report";
import { listSheets, readXlsxHeader } from "./xlsx";

export type Phase = "reading-source" | "reading-destination" | "evaluating" | "writing-reports";

export interface Progress {
  phase: Phase;
  /** Bytes of both files read so far, of `total`. */
  bytes: number;
  total: number;
  /** Rows read from the file being read (as before 1.0), and from each file so far. */
  rows: number;
  sourceRows: number;
  destinationRows: number;
  /** The share of the whole check that is done, from 0 to 1: reading, then evaluating, then writing. */
  fraction: number;
}

/** The shares of a check's time, measured on files of a million rows: reading both files, evaluating, writing. */
const SHARE = { reading: 0.62, evaluating: 0.14, writing: 0.24 } as const;

export type HeaderResult = { ok: true; columns: string[] } | { ok: false; message: string };
/** The sheets a workbook lists (xlsx.listSheets), or the refusal reading its package would give. */
export type SheetsResult = { ok: true; sheets: { name: string; state: string; bytes: number | null; worksheet: boolean }[] } | { ok: false; message: string };
/** A file to read as one worksheet of an .xlsx workbook, and the worksheet chosen; absent for a CSV file. */
export interface Book {
  worksheet?: string;
}

export interface RunInput {
  source: File;
  destination: File;
  sourceEncoding: Encoding;
  destinationEncoding: Encoding;
  config: { loaded: { name: string; bytes: Uint8Array } } | { chosen: ChosenConfig };
  sourceComplete: boolean;
  destinationComplete: boolean;
  sourceCount: string | null;
  destinationCount: string | null;
  allowIdenticalContent: boolean;
  /** A side that is a worksheet of an .xlsx workbook, and its worksheet; its encoding is then not used. */
  sourceBook?: Book;
  destinationBook?: Book;
}

/** What the page shows of a report; the full report is in the two Blobs. */
export interface ResultView {
  cohort: State;
  claim: string | null;
  counts: Record<State, number>;
  expectedTotal: number | null;
  sourceRows: number;
  populationKnown: boolean;
  coverageSufficient: boolean;
  destinationRowsWithoutKey: number;
  premises: [string, Premise][];
  limitations: string;
  /** The first records that are not Verified, in source order. */
  problems: SourceRecord[];
  problemCount: number;
  destinationOnly: DestinationOnlyRecord[] | null;
  destinationOnlyCount: number;
  destinationOnlyCounts: Record<State, number> | null;
  inputs: [string, string | boolean][];
  /** What the result explorer needs to know of the report before it lists a record. */
  facts: Facts;
}

export interface RunResult {
  exit: 0 | 1 | 2 | 3 | 4;
  /** The printed summary, as the command line prints it. */
  summary: string;
  /** The refusal or failure, as the command line prints it on stderr. */
  message: string;
  view: ResultView | null;
  /** "What this result means", read from the whole report (./explain.ts); shown beside the result, never in it. */
  explanation: Explanation | null;
  json: Blob | null;
  html: Blob | null;
  /**
   * The records to resend this result has (exports.ts), known from the report alone: each file that has rows, and
   * whether records were not found in a destination not stated complete. No file is read again until one is asked for.
   */
  resend: { files: PlannedExport[]; absenceNotEstablished: boolean } | null;
}

/** One file of the records to resend, built when asked for, or why it could not be. */
export type ExportFileResult = { ok: true; file: string; blob: Blob; rows: number; formulaFields: number } | { ok: false; message: string };

/** A read of a profile that can be given up: `abandon` ends it, and its promise then rejects with Abandoned. */
export interface Reading<T> {
  result: Promise<T>;
  abandon(): void;
}

export interface CheckRunner {
  /** The header of a CSV file, or with `book`, row 1 of the chosen worksheet. */
  header(file: File, encoding: Encoding, book?: Book): Promise<HeaderResult>;
  /** The sheets a workbook lists, to choose from. */
  sheets(file: File): Promise<SheetsResult>;
  /** The file profile, read from the whole file as a stream; `onRows` gets the rows read so far. */
  profile(file: File, encoding: Encoding, onRows?: (rows: number) => void, book?: Book): Reading<ProfileResult>;
  /** The key profile of one column. */
  keyProfile(file: File, encoding: Encoding, column: string, book?: Book): Reading<KeyProfileResult>;
  run(input: RunInput, onProgress: (p: Progress) => void): Promise<RunResult>;
  /** One file of the records to resend of the last check's result, read again from the files chosen then. */
  exportFile(file: string): Promise<ExportFileResult>;
  /** The records of the result the last check gave, for the result explorer; its reads fail once another check starts. */
  records(facts: Facts): RecordStore;
  /**
   * Let go of the last check's result once the page no longer shows it (a file or a choice changed): the evaluation
   * the explorer reads, about 133 MiB after two files of a million rows, and the records to resend. 1.1.0.
   */
  release(): void;
  /** Abandon the running check: its promise rejects with Cancelled and no result arrives. */
  cancel(): void;
  dispose(): void;
}

export class Cancelled extends Error {}

/** How many records the page lists; the reports have all of them. */
export const SHOWN_RECORDS = 500;

/** Read just enough of the file for its header: 64 KiB at first, more only if the header is longer. */
export async function header(file: File, encoding: Encoding, book?: Book): Promise<HeaderResult> {
  if (book) {
    if (file.size > MAX_BYTES) return { ok: false, message: `${file.name}: file size ${file.size} bytes exceeds --max-bytes limit of ${MAX_BYTES}` };
    try {
      return { ok: true, columns: await readXlsxHeader({ name: file.name, blob: file }, { worksheet: book.worksheet }) };
    } catch (e) {
      if (e instanceof Refused) return { ok: false, message: e.message };
      throw e;
    }
  }
  if (file.size > MAX_BYTES) return { ok: false, message: `${file.name}: file size ${file.size} bytes exceeds --max-bytes limit of ${MAX_BYTES}` };
  for (let length = 65536; ; length *= 4) {
    const complete = length >= file.size;
    const bytes = new Uint8Array(await file.slice(0, complete ? file.size : length).arrayBuffer());
    try {
      return { ok: true, columns: readHeader({ name: file.name, bytes, encoding, complete }) };
    } catch (e) {
      if (e instanceof NeedMore && !complete) continue;
      if (e instanceof Refused) return { ok: false, message: e.message };
      throw e;
    }
  }
}

/** The sheets of a workbook, for the page's choice. */
export async function sheets(file: File): Promise<SheetsResult> {
  if (file.size > MAX_BYTES) return { ok: false, message: `${file.name}: file size ${file.size} bytes exceeds --max-bytes limit of ${MAX_BYTES}` };
  try {
    return { ok: true, sheets: await listSheets({ name: file.name, blob: file }) };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, message: e.message };
    throw e;
  }
}

const profileSource = (file: File, encoding: Encoding): ProfileSource => ({
  name: file.name,
  size: file.size,
  encoding,
  open: () => blobStream(file),
  head: async () => new Uint8Array(await file.slice(0, 4).arrayBuffer()),
});

/** The file profile of a chosen file, in this thread. */
const bookSource = (file: File, book: Book) => ({ name: file.name, size: file.size, blob: file as Blob, worksheet: book.worksheet });

export const profile = (file: File, encoding: Encoding, onRows?: (rows: number) => void, abandoned?: () => boolean, book?: Book) =>
  book ? profileXlsx(bookSource(file, book), onRows, abandoned) :
  profileCsv(profileSource(file, encoding), onRows, abandoned);

/** The key profile of one column of a chosen file, in this thread. */
export const keyProfile = (file: File, encoding: Encoding, column: string, abandoned?: () => boolean, book?: Book) =>
  book ? keyProfileXlsx(bookSource(file, book), column, abandoned) : keyProfileCsv(profileSource(file, encoding), column, abandoned);

function view(report: Report): ResultView {
  const problems: SourceRecord[] = [];
  for (const record of report.records.problems()) {
    if (problems.length === SHOWN_RECORDS) break;
    problems.push(record);
  }
  return {
    cohort: report.cohort_state,
    claim: report.claim,
    counts: report.counts,
    expectedTotal: report.expected_total,
    sourceRows: report.source_rows_observed,
    populationKnown: report.source_population_known,
    coverageSufficient: report.destination_coverage_sufficient,
    destinationRowsWithoutKey: report.destination_rows_without_key,
    premises: Object.entries(report.premises),
    limitations: report.limitations,
    problems,
    problemCount: report.records.length - report.counts.Verified,
    destinationOnly: report.destination_only ? report.destination_only.slice(0, SHOWN_RECORDS) : null,
    destinationOnlyCount: report.destination_only?.length ?? 0,
    destinationOnlyCounts: report.destination_only_counts ?? null,
    inputs: Object.entries(report.inputs).filter((entry): entry is [string, string | boolean] => typeof entry[1] !== "object"),
    facts: factsOf(report),
  };
}

/** What the explorer needs of a report the check has just written. The page never redacts. */
export const factsOf = (report: Report): Facts => ({
  total: report.records.length,
  destinationOnlyTotal: report.destination_only ? report.destination_only.length : null,
  rules: rulesOf(report.obligation.fields),
  details: report.details,
  redacted: false,
});

/** The records of a report the check has just written, each built when it is asked for. */
export const accessOf = (report: Report): RecordAccess => ({
  length: report.records.length,
  at: (p) => report.records.at(p),
  stateAt: (p) => report.records.stateAt(p),
  keyAt: (p) => report.records.keyAt(p),
  destinationOnly: report.destination_only ?? null,
});

/** Calls the explorer of the last result answers, by name. */
export type ExploreCall = { call: "query"; args: [Query] } | { call: "window"; args: [number, number] } | { call: "indexOf"; args: [number] };

export function answer(explorer: Explorer | null, request: ExploreCall): Matched | Item[] | number {
  if (!explorer) throw new Error("The records of this result are no longer held: another check was started.");
  if (request.call === "query") return explorer.query(...request.args);
  if (request.call === "window") return explorer.window(...request.args);
  return explorer.indexOf(...request.args);
}

const same = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/** The SHA-256 of a file read as a stream. */
async function digestOf(file: Blob): Promise<string> {
  const stream = blobStream(file);
  const feed = new ByteFeed();
  for (let chunk = await stream.read(); chunk !== null; chunk = await stream.read()) {
    feed.push(chunk);
    while (feed.take() !== undefined);
    if (stream.reuses) feed.own();
  }
  feed.end();
  while (feed.take()!.length);
  return feed.sha256();
}

/** How large the pieces of a report are when it is handed to a Blob. */
const BLOB_PIECE = 1 << 20;

/** A report as a Blob, from the pieces its writer yields: about 1 MiB of text at a time, never the whole text. */
function blobOf(pieces: Iterable<string>, type: string, onPiece?: () => void): Blob {
  const parts: Blob[] = [];
  let text = "";
  for (const piece of pieces) {
    text += piece;
    if (text.length < BLOB_PIECE) continue;
    parts.push(new Blob([text]));
    text = "";
    onPiece?.();
  }
  parts.push(new Blob([text]));
  return new Blob(parts, { type });
}

/** Counts the records a report writer has written, from the pieces it yields: one piece per record. */
function* counted<T>(pieces: Iterable<T>, count: { n: number }): Generator<T> {
  for (const piece of pieces) {
    count.n++;
    yield piece;
  }
}

/**
 * Run one check in this thread. The browser does not say where a chosen file is, so two choices count as the same
 * file when their name, size, modification time and bytes are all equal: a copy that equal is refused too.
 */
export async function runCheck(input: RunInput, onProgress: (p: Progress) => void): Promise<RunResult> {
  return (await runCheckKeeping(input, onProgress))[0];
}

/** runCheck, with the report itself, whose records the result explorer reads afterwards. */
export async function runCheckKeeping(input: RunInput, onProgress: (p: Progress) => void): Promise<[RunResult, Report | null]> {
  const total = input.source.size + input.destination.size;
  let sameFile = false;
  if (same(input.source, input.destination)) sameFile = (await digestOf(input.source)) === (await digestOf(input.destination));
  const file = (f: File) => ({ name: f.name, size: f.size, read: async () => new Uint8Array(await f.arrayBuffer()), open: () => blobStream(f), blob: () => f });
  const config = "loaded" in input.config
    ? { loaded: { name: input.config.loaded.name, size: input.config.loaded.bytes.length, read: () => (input.config as { loaded: { bytes: Uint8Array } }).loaded.bytes } }
    : input.config;
  const rows = { source: 0, destination: 0 };
  const report_ = (phase: Phase, bytes: number, fraction: number) =>
    onProgress({ phase, bytes: Math.min(bytes, total), total, rows: phase === "reading-source" ? rows.source : rows.destination, sourceRows: rows.source, destinationRows: rows.destination, fraction: Math.min(1, fraction) });
  const outcome = await pageCheck({
    source: file(input.source),
    destination: file(input.destination),
    sourceEncoding: input.sourceEncoding,
    destinationEncoding: input.destinationEncoding,
    ...(input.sourceBook ? { sourceFormat: "xlsx" as const, sourceWorksheet: input.sourceBook.worksheet } : {}),
    ...(input.destinationBook ? { destinationFormat: "xlsx" as const, destinationWorksheet: input.destinationBook.worksheet } : {}),
    config,
    sourceComplete: input.sourceComplete,
    destinationComplete: input.destinationComplete,
    sourceCount: input.sourceCount,
    destinationCount: input.destinationCount,
    allowIdenticalContent: input.allowIdenticalContent,
    sameFile,
    progress: (side, bytes, n) => {
      rows[side] = n;
      const done = side === "source" ? bytes : input.source.size + bytes;
      report_(side === "source" ? "reading-source" : "reading-destination", done, total ? (done / total) * SHARE.reading : SHARE.reading);
    },
    evaluating: (done, records) => report_("evaluating", total, SHARE.reading + (records ? done / records : 1) * SHARE.evaluating),
  });
  const report = outcome.report;
  if (!report) return [{ exit: outcome.exit, summary: "", message: outcome.stderr.trimEnd(), view: null, explanation: null, json: null, html: null, resend: null }, null];
  // The JSON report has one piece per record; the HTML report lists only the records that are not Verified.
  const written = { n: 0 };
  const records = report.records.length || 1;
  const writing = () => report_("writing-reports", total, SHARE.reading + SHARE.evaluating + Math.min(1, written.n / records) * SHARE.writing * 0.9);
  writing();
  const json = blobOf(counted(writeJson(report), written), "application/json", writing);
  const html = blobOf(writeHtml(report), "text/html;charset=utf-8");
  report_("writing-reports", total, 1);
  const resend = { files: plannedFiles(report), absenceNotEstablished: absenceNotEstablished(report) };
  return [{ exit: outcome.exit, summary: outcome.stdout, message: "", view: view(report), explanation: explain(report), json, html, resend }, report];
}

const inputFile = (f: File): InputFile => ({ name: f.name, size: f.size, read: async () => new Uint8Array(await f.arrayBuffer()), open: () => blobStream(f), blob: () => f });

/**
 * The records to resend of one check, built once when the first file is asked for: the files the person chose, read
 * again and refused if they changed, never fetched or stored. What a runner keeps of its last check until the next.
 */
export function resendOf(input: RunInput, report: Report) {
  let built: Promise<Export[]> | null = null;
  const build = () =>
    (built ??= exportsOf(
      report,
      { file: inputFile(input.source), format: input.sourceBook ? "xlsx" : "csv", encoding: input.sourceEncoding, worksheet: input.sourceBook?.worksheet, sha256: report.inputs.source_sha256 as string },
      { file: inputFile(input.destination), format: input.destinationBook ? "xlsx" : "csv", encoding: input.destinationEncoding, worksheet: input.destinationBook?.worksheet, sha256: report.inputs.destination_sha256 as string },
    ).then((r) => r.files));
  return async (file: string): Promise<ExportFileResult> => {
    try {
      const found = (await build()).find((e) => e.file === file);
      if (!found) return { ok: false, message: `${file}: this result has no such file` };
      return { ok: true, file, blob: new Blob([found.text], { type: "text/csv;charset=utf-8" }), rows: found.rows, formulaFields: found.formulaFields };
    } catch (e) {
      built = null;
      return { ok: false, message: e instanceof Refused ? e.message : `${e instanceof Error ? e.name : "Error"}: the file could not be built` };
    }
  };
}

const NO_RESULT: ExportFileResult = { ok: false, message: "There is no result to export: run the check again." };

/** A runner in this thread, for tests and for a browser without module workers. Cancel only drops the result. */
export function inThreadRunner(): CheckRunner {
  let generation = 0;
  let explorer: Explorer | null = null;
  let resend: ((file: string) => Promise<ExportFileResult>) | null = null;
  const reading = <T>(start: (abandoned: () => boolean) => Promise<T>): Reading<T> => {
    let given = false;
    return { result: start(() => given), abandon: () => void (given = true) };
  };
  return {
    header,
    sheets,
    profile: (file, encoding, onRows, book) => reading((abandoned) => profile(file, encoding, onRows, abandoned, book)),
    keyProfile: (file, encoding, column, book) => reading((abandoned) => keyProfile(file, encoding, column, abandoned, book)),
    records: (facts) => {
      const ask = <T>(request: ExploreCall) => Promise.resolve().then(() => answer(explorer, request) as T);
      return { facts, query: (q) => ask({ call: "query", args: [q] }), window: (start, count) => ask({ call: "window", args: [start, count] }), indexOf: (row) => ask({ call: "indexOf", args: [row] }) };
    },
    async run(input, onProgress) {
      const mine = ++generation;
      explorer = null;
      resend = null;
      const [result, report] = await runCheckKeeping(input, (p) => mine === generation && onProgress(p));
      if (mine === generation) explorer = report ? new Explorer(accessOf(report), factsOf(report)) : null;
      if (mine === generation) resend = report ? resendOf(input, report) : null;
      if (mine !== generation) throw new Cancelled();
      return result;
    },
    exportFile: (file) => (resend ? resend(file) : Promise.resolve(NO_RESULT)),
    release: () => {
      explorer = null;
      resend = null;
    },
    cancel: () => void generation++,
    dispose: () => void generation++,
  };
}

/** Messages to a worker. */
export type Request =
  | { id: number; type: "header"; file: File; encoding: Encoding; book?: Book }
  | { id: number; type: "sheets"; file: File }
  | { id: number; type: "profile"; file: File; encoding: Encoding; book?: Book }
  | { id: number; type: "key-profile"; file: File; encoding: Encoding; column: string; book?: Book }
  | { id: number; type: "abandon" }
  | { id: number; type: "run"; input: RunInput }
  | { id: number; type: "export"; file: string }
  | { id: number; type: "release" }
  | ({ id: number; type: "explore" } & ExploreCall);
/** Messages from a worker. */
export type Reply =
  | { id: number; type: "header"; result: HeaderResult }
  | { id: number; type: "sheets"; result: SheetsResult }
  | { id: number; type: "profile"; result: ProfileResult }
  | { id: number; type: "key-profile"; result: KeyProfileResult }
  | { id: number; type: "rows"; rows: number }
  | { id: number; type: "abandoned" }
  | { id: number; type: "progress"; progress: Progress }
  | { id: number; type: "result"; result: RunResult }
  | { id: number; type: "explored"; result: Matched | Item[] | number }
  | { id: number; type: "exported"; result: ExportFileResult }
  | { id: number; type: "error"; message: string };

interface Pending {
  resolve: (r: never) => void;
  reject: (e: Error) => void;
  progress?: (p: Progress) => void;
  rows?: (rows: number) => void;
}

const WORKER_ENDED = "The check stopped: the browser ended its worker, often for lack of memory.";

/** One worker and the requests it has not answered. */
function channel(start: () => Worker) {
  const pending = new Map<number, Pending>();
  const listen = (w: Worker) => {
    w.onmessage = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      const entry = pending.get(reply.id);
      if (!entry) return;
      if (reply.type === "progress") return entry.progress?.(reply.progress);
      if (reply.type === "rows") return entry.rows?.(reply.rows);
      pending.delete(reply.id);
      if (reply.type === "error") entry.reject(new Error(reply.message));
      else if (reply.type === "abandoned") entry.reject(new Abandoned());
      else entry.resolve(reply.result as never);
    };
    w.onerror = (event) => {
      event.preventDefault();
      for (const [id, entry] of pending) {
        pending.delete(id);
        entry.reject(new Error(WORKER_ENDED));
      }
    };
    return w;
  };
  let worker = listen(start());
  return {
    send<T>(request: Request, handlers: Pick<Pending, "progress" | "rows"> = {}) {
      return new Promise<T>((resolve, reject) => {
        pending.set(request.id, { resolve: resolve as (r: never) => void, reject, ...handlers });
        worker.postMessage(request);
      });
    },
    post: (request: Request) => worker.postMessage(request),
    /** End the worker now; every request it had not answered is rejected with `error`. A new worker takes its place. */
    restart(error: () => Error) {
      worker.terminate();
      for (const [id, entry] of pending) {
        pending.delete(id);
        entry.reject(error());
      }
      worker = listen(start());
    },
    dispose() {
      worker.terminate();
      pending.clear();
    },
  };
}

/** The runner the page uses: two module workers, the one for checks replaced by a fresh one when a check is cancelled. */
export function workerRunner(start: () => Worker): CheckRunner {
  const checks = channel(start);
  const profiles = channel(start);
  let next = 0;
  const reading = <T>(request: Request, rows?: (rows: number) => void): Reading<T> => ({
    result: profiles.send<T>(request, { rows }),
    abandon: () => profiles.post({ id: request.id, type: "abandon" }),
  });
  return {
    header: (file, encoding, book) => profiles.send<HeaderResult>({ id: ++next, type: "header", file, encoding, book }),
    sheets: (file) => profiles.send<SheetsResult>({ id: ++next, type: "sheets", file }),
    profile: (file, encoding, onRows, book) => reading<ProfileResult>({ id: ++next, type: "profile", file, encoding, book }, onRows),
    keyProfile: (file, encoding, column, book) => reading<KeyProfileResult>({ id: ++next, type: "key-profile", file, encoding, column, book }),
    run: (input, onProgress) => checks.send<RunResult>({ id: ++next, type: "run", input }, { progress: onProgress }),
    exportFile: (file) => checks.send<ExportFileResult>({ id: ++next, type: "export", file }).catch((e: Error) => ({ ok: false as const, message: e.message })),
    records: (facts) => {
      const ask = <T>(request: ExploreCall) => checks.send<T>({ id: ++next, type: "explore", ...request });
      return { facts, query: (q) => ask({ call: "query", args: [q] }), window: (start, count) => ask({ call: "window", args: [start, count] }), indexOf: (row) => ask({ call: "indexOf", args: [row] }) };
    },
    release: () => checks.post({ id: ++next, type: "release" }),
    cancel: () => checks.restart(() => new Cancelled()),
    dispose() {
      checks.dispose();
      profiles.dispose();
    },
  };
}
