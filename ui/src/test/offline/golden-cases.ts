/**
 * Test helper: the golden cases the page can run (offline/golden/, written by offline/bench/golden.py), as input for
 * the packaged checker (api.ts), and what the command line gave for each. The packaged checker has no clock to fix, so
 * evaluated_at is left out of both sides; the premises' origin is the caller's.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CheckCsvInput, CheckCsvResult } from "../../offline/api";
import { compareCodePoints } from "../../offline/pystr";
import { REPO_ROOT } from "../fixtures/sources";

export const GOLDEN = join(REPO_ROOT, "offline/golden");

interface PageChoices {
  source_encoding: string;
  destination_encoding: string;
  config: "canonical" | "loaded";
  source_complete: boolean;
  destination_complete: boolean;
  allow_identical_content: boolean;
  source_count: string | null;
  destination_count: string | null;
}

const caseOf = (name: string) => JSON.parse(readFileSync(join(GOLDEN, name, "case.json"), "utf-8")) as { page?: PageChoices };

/** The golden cases marked `page`, in code point order. */
export const pageCases = readdirSync(GOLDEN).sort(compareCodePoints).filter((name) => caseOf(name).page);

/**
 * The checkCsv input for a case: the files' bytes, as a host such as Node.js reads them (Buffers), and the
 * configuration as the page has it: its value for a configuration chosen in the page (whose canonical bytes are
 * JSON.stringify(value, null, 2) + "\n"), the file's bytes for one the user loaded.
 */
export function apiInput(name: string, read: (path: string) => Uint8Array = (path) => readFileSync(path)): CheckCsvInput {
  const folder = join(GOLDEN, name);
  const p = caseOf(name).page!;
  const config = read(join(folder, "config.json"));
  return {
    source: { name: "source.csv", content: read(join(folder, "source.csv")), encoding: p.source_encoding },
    destination: { name: "destination.csv", content: read(join(folder, "destination.csv")), encoding: p.destination_encoding },
    config: p.config === "loaded" ? config : (JSON.parse(new TextDecoder().decode(config)) as object),
    sourceComplete: p.source_complete,
    destinationComplete: p.destination_complete,
    sourceCount: p.source_count,
    destinationCount: p.destination_count,
    allowIdenticalContent: p.allow_identical_content,
  };
}

const text = (folder: string, file: string) => {
  try {
    return readFileSync(join(folder, file), "utf-8");
  } catch {
    return null;
  }
};

/** A report without its evaluated_at, the one value the caller cannot fix. */
export const withoutTime = (report: string | null) =>
  report?.replace(/"evaluated_at": "[^"]*"/, '"evaluated_at": ""').replace(/<p>Evaluated at [^ ]* by/, "<p>Evaluated at by") ?? null;

/** What the command line gave for a case, with `origin` in place of "command-line option". */
export function expectedResult(name: string, origin: string) {
  const folder = join(GOLDEN, name);
  const exit = Number(text(folder, "exit_status.txt"));
  return {
    exit,
    summary: text(folder, "stdout.txt"),
    message: text(folder, "stderr.txt"),
    json: withoutTime(text(folder, "report.json")?.replaceAll('"origin": "command-line option"', `"origin": ${JSON.stringify(origin)}`) ?? null),
    html: withoutTime(text(folder, "report.html")?.replaceAll("<td>command-line option</td>", `<td>${origin}</td>`) ?? null),
  };
}

/** The same members of a checkCsv result, for comparison. */
export const comparable = (result: CheckCsvResult) => ({
  exit: result.exit,
  summary: result.summary,
  message: result.message,
  json: withoutTime(result.json),
  html: withoutTime(result.html),
});
