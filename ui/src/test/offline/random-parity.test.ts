/**
 * Random parity with the command-line checker. Cases come from a fixed seed (random-cases.ts); Python writes their
 * files and runs the CLI on each (offline/bench/parity.py); the TypeScript check then runs on the same bytes and
 * must give the same exit status, summary, refusal, JSON report and HTML report.
 *
 *   npx vitest run src/test/offline/random-parity.test.ts                      300 cases (the default, as in CI)
 *   FA_PARITY_COUNT=5000 npx vitest run src/test/offline/random-parity.test.ts
 *
 * FA_PYTHON names the interpreter (default python3) and FA_PARITY_SEED the first seed (default 20260302). The browser
 * follows Python 3.15 where Python versions differ (see strptime.ts), so with an older interpreter both tests are
 * skipped, saying so; with FA_PARITY_REQUIRED=1 (CI's parity job) they fail instead, as they do without Python.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, reportHtml, reportJson } from "../../offline/check";
import { REPO_ROOT } from "../fixtures/sources";
import { parseArgs } from "./cli-args";
import { CsvReader, LineReader } from "../../offline/csv";
import { generateCase, random } from "./random-cases";

const COUNT = Number(process.env.FA_PARITY_COUNT ?? 300);
const SEED = Number(process.env.FA_PARITY_SEED ?? 20260302);
const PYTHON = process.env.FA_PYTHON ?? "python3";
const REQUIRED = process.env.FA_PARITY_REQUIRED === "1";

/** The interpreter's version, or null when it cannot run. */
function pythonVersion(): [number, number] | null {
  try {
    const out = execFileSync(PYTHON, ["-c", "import sys; print(sys.version_info[0], sys.version_info[1])"], { encoding: "utf-8" });
    const [major, minor] = out.trim().split(" ").map(Number);
    return [major!, minor!];
  } catch {
    return null;
  }
}

const version = pythonVersion();
const usable = version !== null && (version[0] > 3 || (version[0] === 3 && version[1] >= 15));
const skip = !usable && !REQUIRED;
const why = `random parity needs Python 3.15 or later as ${PYTHON}; found ${version ? version.join(".") : "none"}`;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8 = { decode: (chunk: Uint8Array, final: boolean) => utf8Decoder.decode(chunk, { stream: !final }) };

interface PythonResult {
  case: string;
  exit: number;
  stdout: string;
  stderr: string;
  json: string | null;
  html: string | null;
}

describe.skipIf(skip)(skip ? why : "with Python", () => {
test(`random parity: ${COUNT} cases from seed ${SEED}`, { timeout: 1_800_000 }, async () => {
  if (!usable) throw new Error(why);
  const root = mkdtempSync(join(tmpdir(), "fa-parity-"));
  try {
    const names: string[] = [];
    for (let i = 0; i < COUNT; i++) {
      const name = String(i).padStart(5, "0");
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, "spec.json"), JSON.stringify(generateCase(SEED + i)));
      names.push(name);
    }
    execFileSync(PYTHON, [join(REPO_ROOT, "offline/bench/parity.py"), root], { stdio: ["ignore", "inherit", "inherit"] });
    const results = readFileSync(join(root, "results.jsonl"), "utf-8").trim().split("\n").map((line) => JSON.parse(line) as PythonResult);
    expect(results.map((r) => r.case)).toEqual(names);

    const differences: string[] = [];
    const exits: Record<number, number> = {};
    for (const python of results) {
      const folder = join(root, python.case);
      const spec = JSON.parse(readFileSync(join(folder, "spec.json"), "utf-8")) as { args: string[] };
      const outcome = await check({ ...parseArgs(spec.args, folder), now: () => "2000-01-01T00:00:00Z" });
      const ours = {
        exit: outcome.exit,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        json: outcome.report ? reportJson(outcome.report) : null,
        html: outcome.report ? reportHtml(outcome.report) : null,
      };
      exits[python.exit] = (exits[python.exit] ?? 0) + 1;
      const differing = (["exit", "stdout", "stderr", "json", "html"] as const).filter((k) => ours[k] !== python[k]);
      if (differing.length) {
        const first = differing[0]!;
        differences.push(
          `case ${python.case} (seed ${SEED + Number(python.case)}): ${differing.join(", ")} differ\n` +
            `  args: ${JSON.stringify(spec.args)}\n  python: ${JSON.stringify(python[first]).slice(0, 400)}\n  browser: ${JSON.stringify(ours[first]).slice(0, 400)}`,
        );
      }
    }
    console.info(`random parity: ${results.length} cases, exit statuses ${JSON.stringify(exits)}, ${differences.length} differences`);
    expect(differences.slice(0, 10)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const CSV_READER = `
import csv, io, json, sys
out = []
for text in json.load(sys.stdin):
    reader = csv.reader(io.StringIO(text, newline=""), strict=True)
    rows = []
    try:
        for row in reader:
            rows.append([row, reader.line_num])
        out.append({"rows": rows})
    except csv.Error as e:
        out.append({"rows": rows, "error": str(e), "line": reader.line_num})
json.dump(out, sys.stdout)
`;

test(`csv.reader parity: ${COUNT * 4} random texts of quotes, commas and line breaks`, { timeout: 600_000 }, () => {
  if (!usable) throw new Error(why);
  const r = random(SEED);
  const texts = Array.from({ length: COUNT * 4 }, () => {
    let text = "";
    for (let n = r.int(0, 40); n > 0; n--) text += r.pick(["a", "b", ",", ",", '"', '"', "\r", "\n", "\r\n", " ", "é", "😀", "\x00"]);
    return text;
  });
  const python = JSON.parse(execFileSync(PYTHON, ["-c", CSV_READER], { input: JSON.stringify(texts), maxBuffer: 1 << 28 }).toString()) as {
    rows: [string[], number][];
    error?: string;
    line?: number;
  }[];
  const differences: string[] = [];
  texts.forEach((text, i) => {
    const reader = new CsvReader(new LineReader(new TextEncoder().encode(text), utf8));
    const rows: [string[], number][] = [];
    let ours: { rows: [string[], number][]; error?: string; line?: number };
    try {
      for (let row = reader.next(); row !== null; row = reader.next()) rows.push([row, reader.lineNum]);
      ours = { rows };
    } catch (e) {
      ours = { rows, error: (e as Error).message, line: reader.lineNum };
    }
    if (JSON.stringify(ours) !== JSON.stringify(python[i])) differences.push(`${JSON.stringify(text)}: python ${JSON.stringify(python[i])}, browser ${JSON.stringify(ours)}`);
  });
  expect(differences.slice(0, 10)).toEqual([]);
});
});
