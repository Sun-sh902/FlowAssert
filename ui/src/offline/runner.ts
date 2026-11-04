/**
 * How the CSV check page runs a check: in a Web Worker (./worker.ts), so reading and evaluating large files never
 * blocks the page, or in this thread for the unit tests. Both run the same code (pageCheck, readHeader) and give the
 * same results. Nothing here makes a request: files are read with File.arrayBuffer, reports are built as Blobs.
 *
 * A worker is started before any file is chosen, so a check never has to load code. Cancelling ends the worker at
 * once and starts the next one; a cancelled check never delivers a result.
 */
import { MAX_BYTES, NeedMore, Refused, readHeader, sha256Hex, type Encoding } from "./csv";
import type { DestinationOnlyRecord, Premise, SourceRecord, State } from "./evaluator";
import { explain, type Explanation } from "./explain";
import { pageCheck, type ChosenConfig } from "./pageCheck";
import { writeHtml, writeJson, type Report } from "./report";

export type Phase = "reading-source" | "reading-destination" | "evaluating" | "writing-reports";

export interface Progress {
  phase: Phase;
  /** Bytes of both files read so far, of `total`. */
  bytes: number;
  total: number;
  rows: number;
}

export type HeaderResult = { ok: true; columns: string[] } | { ok: false; message: string };

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
}

export interface CheckRunner {
  header(file: File, encoding: Encoding): Promise<HeaderResult>;
  run(input: RunInput, onProgress: (p: Progress) => void): Promise<RunResult>;
  /** Abandon the running check: its promise rejects with Cancelled and no result arrives. */
  cancel(): void;
  dispose(): void;
}

export class Cancelled extends Error {}

/** How many records the page lists; the reports have all of them. */
export const SHOWN_RECORDS = 500;

/** Read just enough of the file for its header: 64 KiB at first, more only if the header is longer. */
export async function header(file: File, encoding: Encoding): Promise<HeaderResult> {
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
    inputs: Object.entries(report.inputs),
  };
}

const same = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/**
 * Run one check in this thread. The browser does not say where a chosen file is, so two choices count as the same
 * file when their name, size, modification time and bytes are all equal: a copy that equal is refused too.
 */
export async function runCheck(input: RunInput, onProgress: (p: Progress) => void): Promise<RunResult> {
  const total = input.source.size + input.destination.size;
  let sameFile = false;
  if (same(input.source, input.destination)) {
    const read = async (f: File) => sha256Hex(new Uint8Array(await f.arrayBuffer()));
    sameFile = (await read(input.source)) === (await read(input.destination));
  }
  const file = (f: File) => ({ name: f.name, size: f.size, read: async () => new Uint8Array(await f.arrayBuffer()) });
  const config = "loaded" in input.config
    ? { loaded: { name: input.config.loaded.name, size: input.config.loaded.bytes.length, read: () => (input.config as { loaded: { bytes: Uint8Array } }).loaded.bytes } }
    : input.config;
  let rows = 0;
  const outcome = await pageCheck({
    source: file(input.source),
    destination: file(input.destination),
    sourceEncoding: input.sourceEncoding,
    destinationEncoding: input.destinationEncoding,
    config,
    sourceComplete: input.sourceComplete,
    destinationComplete: input.destinationComplete,
    sourceCount: input.sourceCount,
    destinationCount: input.destinationCount,
    allowIdenticalContent: input.allowIdenticalContent,
    sameFile,
    progress: (side, bytes, n) => {
      rows = n;
      const done = side === "source" ? bytes : input.source.size + bytes;
      onProgress({ phase: side === "source" ? "reading-source" : "reading-destination", bytes: Math.min(done, total), total, rows: n });
    },
    evaluating: () => onProgress({ phase: "evaluating", bytes: total, total, rows }),
  });
  const report = outcome.report;
  if (!report) return { exit: outcome.exit, summary: "", message: outcome.stderr.trimEnd(), view: null, explanation: null, json: null, html: null };
  onProgress({ phase: "writing-reports", bytes: total, total, rows });
  return {
    exit: outcome.exit,
    summary: outcome.stdout,
    message: "",
    view: view(report),
    explanation: explain(report),
    json: new Blob([...writeJson(report)], { type: "application/json" }),
    html: new Blob([...writeHtml(report)], { type: "text/html;charset=utf-8" }),
  };
}

/** A runner in this thread, for tests and for a browser without module workers. Cancel only drops the result. */
export function inThreadRunner(): CheckRunner {
  let generation = 0;
  return {
    header,
    async run(input, onProgress) {
      const mine = ++generation;
      const result = await runCheck(input, (p) => mine === generation && onProgress(p));
      if (mine !== generation) throw new Cancelled();
      return result;
    },
    cancel: () => void generation++,
    dispose: () => void generation++,
  };
}

/** Messages to the worker. */
export type Request = { id: number; type: "header"; file: File; encoding: Encoding } | { id: number; type: "run"; input: RunInput };
/** Messages from the worker. */
export type Reply =
  | { id: number; type: "header"; result: HeaderResult }
  | { id: number; type: "progress"; progress: Progress }
  | { id: number; type: "result"; result: RunResult }
  | { id: number; type: "error"; message: string };

/** The runner the page uses: a module worker, replaced by a fresh one when a check is cancelled. */
export function workerRunner(start: () => Worker): CheckRunner {
  let worker = start();
  let next = 0;
  const pending = new Map<number, { resolve: (r: never) => void; reject: (e: Error) => void; progress?: (p: Progress) => void }>();
  const listen = (w: Worker) => {
    w.onmessage = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      const entry = pending.get(reply.id);
      if (!entry) return;
      if (reply.type === "progress") return entry.progress?.(reply.progress);
      pending.delete(reply.id);
      if (reply.type === "error") entry.reject(new Error(reply.message));
      else entry.resolve(reply.result as never);
    };
    w.onerror = (event) => {
      event.preventDefault();
      for (const [id, entry] of pending) {
        pending.delete(id);
        entry.reject(new Error("The check stopped: the browser ended its worker, often for lack of memory."));
      }
    };
  };
  listen(worker);
  const send = <T>(request: Request, progress?: (p: Progress) => void) =>
    new Promise<T>((resolve, reject) => {
      pending.set(request.id, { resolve: resolve as (r: never) => void, reject, progress });
      worker.postMessage(request);
    });
  return {
    header: (file, encoding) => send<HeaderResult>({ id: ++next, type: "header", file, encoding }),
    run: (input, onProgress) => send<RunResult>({ id: ++next, type: "run", input }, onProgress),
    cancel() {
      worker.terminate();
      for (const [id, entry] of pending) {
        pending.delete(id);
        entry.reject(new Cancelled());
      }
      worker = start();
      listen(worker);
    },
    dispose() {
      worker.terminate();
      pending.clear();
    },
  };
}
