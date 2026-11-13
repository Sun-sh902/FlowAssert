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
import { DuplicateMember, JsonError, pyLoads, type PyValue } from "../../offline/pyjson";
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

const JSON_READER = `
import json, struct, sys
def pairs(items):
    out = {}
    for name, value in items:
        if name in out:
            raise KeyError(name)
        out[name] = value
    return out
def tagged(v):
    depth = 0
    while isinstance(v, list) and len(v) == 1 and isinstance(v[0], list):
        depth, v = depth + 1, v[0]
    if depth: return ["nested", depth, tagged(v)]
    if isinstance(v, bool) or v is None: return ["c", v]
    if isinstance(v, int): return ["i", str(v)]
    if isinstance(v, float): return ["f", struct.pack(">d", v).hex()]
    if isinstance(v, str): return ["s", v]
    if isinstance(v, list): return ["a", [tagged(x) for x in v]]
    return ["o", [[k, tagged(x)] for k, x in v.items()]]
out = []
for text in json.load(sys.stdin):
    try:
        out.append({"value": tagged(json.loads(text, object_pairs_hook=pairs))})
    except json.JSONDecodeError as e:
        out.append({"error": e.msg})
    except KeyError as e:
        out.append({"duplicate": e.args[0]})
json.dump(out, sys.stdout)
`;

test(`json parity: ${COUNT * 4} random texts, nested up to 100,000 deep, read as json.loads reads them`, { timeout: 600_000 }, () => {
  // The reader of configuration files and saved reports (pyjson.ts) against Python's json, as cli._read_json uses it:
  // the value, or the message of the first problem, or the repeated member.
  if (!usable) throw new Error(why);
  const r = random(SEED + 1);
  const tokens = ["[", "]", "{", "}", ",", ",", ":", '"a"', '"b"', '"a"', "1", "-0", "1.5", "1e400", "-1e-400", "12345678901234567890", "true", "false", "null", "NaN", "-Infinity", " ", "\n", '"\\u00e9"', '"\\x"', '"\\ud800"', "x", '"', "\t", "01", "1.", "-", "\u0001", '"\u0001"'];
  const texts = Array.from({ length: COUNT * 4 }, () => {
    let text = "";
    for (let n = r.int(0, 30); n > 0; n--) text += r.pick(tokens);
    return text;
  });
  texts.push("\ufeff{}", "[".repeat(100_000) + "]".repeat(100_000), `{"a": ${"[".repeat(100_000)}1${"]".repeat(100_000)}, "a": 2}`, "[".repeat(100_000) + "]".repeat(99_999));
  const python = JSON.parse(execFileSync(PYTHON, ["-c", JSON_READER], { input: JSON.stringify(texts), maxBuffer: 1 << 28 }).toString()) as unknown[];
  const tagged = (value: PyValue): unknown => {
    // A run of one-item arrays as its depth, so that a value nested 100,000 deep is compared without recursion.
    let v = value;
    let depth = 0;
    while (Array.isArray(v) && v.length === 1 && Array.isArray(v[0])) {
      depth++;
      v = v[0] as PyValue;
    }
    if (depth) return ["nested", depth, tagged(v)];
    if (typeof v === "boolean" || v === null) return ["c", v];
    if (typeof v === "bigint" || (typeof v === "number" && Number.isInteger(v) && !Object.is(v, -0) && Math.abs(v) <= Number.MAX_SAFE_INTEGER && !/[.eE]/.test(String(v)))) return ["i", String(v)];
    if (typeof v === "number") {
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, v);
      return ["f", [...new Uint8Array(view.buffer)].map((b) => b.toString(16).padStart(2, "0")).join("")];
    }
    if (typeof v === "string") return ["s", v];
    if (Array.isArray(v)) return ["a", v.map(tagged)];
    return ["o", Object.entries(v).map(([k, x]) => [k, tagged(x as PyValue)])];
  };
  const differences: string[] = [];
  texts.forEach((text, i) => {
    let ours: unknown;
    try {
      ours = { value: tagged(pyLoads(text)) };
    } catch (e) {
      if (e instanceof DuplicateMember) ours = { duplicate: e.member };
      else if (e instanceof JsonError) ours = { error: e.message };
      else ours = { thrown: String(e) };
    }
    if (JSON.stringify(ours) !== JSON.stringify(python[i])) differences.push(`${JSON.stringify(text).slice(0, 200)}: python ${JSON.stringify(python[i]).slice(0, 200)}, browser ${JSON.stringify(ours).slice(0, 200)}`);
  });
  expect(differences.slice(0, 10)).toEqual([]);
});

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
