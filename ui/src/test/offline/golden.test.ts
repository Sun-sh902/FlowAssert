/**
 * Byte-for-byte parity with the command-line checker: every case in offline/golden/ (written by
 * offline/bench/golden.py from the Python CLI) is run through the TypeScript check, and the exit status, the printed
 * summary, the refusal and both reports must be identical. A case the page can run is also run as the page runs it,
 * where only the premises' origin differs: "browser form" instead of "command-line option".
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, reportHtml, reportJson, type CheckOutcome } from "../../offline/check";
import type { Encoding } from "../../offline/csv";
import { pageCheck } from "../../offline/pageCheck";
import { compareCodePoints } from "../../offline/pystr";
import { REPO_ROOT } from "../fixtures/sources";
import { inputFile, parseArgs } from "./cli-args";

const GOLDEN = join(REPO_ROOT, "offline/golden");
const EVALUATED_AT = () => "2000-01-01T00:00:00Z";

interface GoldenCase {
  name: string;
  args: string[];
  page?: {
    source_encoding: Encoding;
    destination_encoding: Encoding;
    config: "canonical" | "loaded";
    source_complete: boolean;
    destination_complete: boolean;
    allow_identical_content: boolean;
    source_count: string | null;
    destination_count: string | null;
  };
}

const text = (folder: string, file: string) => (existsSync(join(folder, file)) ? readFileSync(join(folder, file), "utf-8") : null);

function expected(folder: string) {
  return {
    exit: Number(text(folder, "exit_status.txt")),
    stdout: text(folder, "stdout.txt"),
    stderr: text(folder, "stderr.txt"),
    json: text(folder, "report.json"),
    html: text(folder, "report.html"),
  };
}

function actual(outcome: CheckOutcome) {
  return {
    exit: outcome.exit,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    json: outcome.report ? reportJson(outcome.report) : null,
    html: outcome.report ? reportHtml(outcome.report) : null,
  };
}

const names = readdirSync(GOLDEN).sort(compareCodePoints);

describe("golden reports", () => {
  test("the golden folder holds the cases golden.py writes", () => {
    expect(names.length).toBeGreaterThanOrEqual(80);
  });

  test.each(names)("%s, as the command line runs it", async (name) => {
    const folder = join(GOLDEN, name);
    const c = JSON.parse(readFileSync(join(folder, "case.json"), "utf-8")) as GoldenCase;
    const outcome = await check({ ...parseArgs(c.args, folder), now: EVALUATED_AT });
    expect(actual(outcome)).toEqual(expected(folder));
  });

  const pageCases = names.filter((name) => (JSON.parse(readFileSync(join(GOLDEN, name, "case.json"), "utf-8")) as GoldenCase).page);

  test("most cases are also run as the page runs them", () => {
    expect(pageCases.length).toBeGreaterThanOrEqual(50);
  });

  test.each(pageCases)("%s, as the page runs it", async (name) => {
    const folder = join(GOLDEN, name);
    const p = (JSON.parse(readFileSync(join(folder, "case.json"), "utf-8")) as GoldenCase).page!;
    const outcome = await pageCheck({
      source: inputFile(folder, "source.csv"),
      destination: inputFile(folder, "destination.csv"),
      sourceEncoding: p.source_encoding,
      destinationEncoding: p.destination_encoding,
      config:
        p.config === "loaded"
          ? { loaded: inputFile(folder, "config.json") }
          : { chosen: (() => {
              const cfg = JSON.parse(readFileSync(join(folder, "config.json"), "utf-8")) as {
                key: [string, string];
                fields: { source: string; destination: string; rule: string }[];
                scope: "source" | "exact";
              };
              return { key: cfg.key, fields: cfg.fields.map((f) => [f.source, f.destination, f.rule] as const), scope: cfg.scope };
            })() },
      sourceComplete: p.source_complete,
      destinationComplete: p.destination_complete,
      sourceCount: p.source_count,
      destinationCount: p.destination_count,
      allowIdenticalContent: p.allow_identical_content,
      sameFile: false,
      now: EVALUATED_AT,
    });
    const golden = expected(folder);
    expect(actual(outcome)).toEqual({
      ...golden,
      json: golden.json?.replaceAll('"origin": "command-line option"', '"origin": "browser form"') ?? null,
      html: golden.html?.replaceAll("<td>command-line option</td>", "<td>browser form</td>") ?? null,
    });
  });
});
