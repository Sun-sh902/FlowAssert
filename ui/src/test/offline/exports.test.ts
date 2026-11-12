/**
 * The records to resend in TypeScript (offline/exports.ts, docs/design/1.1-exports.md) against the command line's:
 * every golden case of offline/golden/ and offline/golden-xlsx/, and generated cases of hostile values, run with
 * --export-dir must give the same exit status, summary, refusal and files, byte for byte. Python runs them through
 * offline/bench/exports_parity.py.
 *
 * As random-parity.test.ts: FA_PYTHON names the interpreter; without Python 3.15 the parity tests are skipped, saying
 * so, unless FA_PARITY_REQUIRED=1, when they fail.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { checkCsv } from "../../offline/api";
import { check } from "../../offline/check";
import { BOM, FILES, MEANING, formulaLike, rowText } from "../../offline/exports";
import { compareCodePoints } from "../../offline/pystr";
import { REPO_ROOT } from "../fixtures/sources";
import { parseArgs } from "./cli-args";
import { random } from "./random-cases";

const PYTHON = process.env.FA_PYTHON ?? "python3";
const REQUIRED = process.env.FA_PARITY_REQUIRED === "1";
const SCRIPT = join(REPO_ROOT, "offline/bench/exports_parity.py");
const EXPORT = "records-to-resend";

function pythonVersion(): [number, number] | null {
  try {
    const [major, minor] = execFileSync(PYTHON, ["-c", "import sys; print(sys.version_info[0], sys.version_info[1])"], { encoding: "utf-8" }).trim().split(" ").map(Number);
    return [major!, minor!];
  } catch {
    return null;
  }
}
const version = pythonVersion();
const usable = version !== null && (version[0] > 3 || (version[0] === 3 && version[1] >= 15));
const skip = !usable && !REQUIRED;
const why = `export parity needs Python 3.15 or later as ${PYTHON}; found ${version ? version.join(".") : "none"}`;

interface PythonRun {
  exit: number;
  stdout: string;
  stderr: string;
  files: Record<string, string> | null;
}

// ---------- Generated cases: hostile values in every file ----------

const HOSTILE = ['say "hi"', "two\nlines", "cr\rhere", "a,b", "\ufeffbom", "=1+1", "@SUM(A1)", "-2+3", "+44", "-5", "\tTab", "Zoë 名字", "", " ", "1.5", "-", "x"];
const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;
const line = (values: string[]) => values.map(quote).join(",") + "\r\n";

function generated(seed: number): { files: Record<string, string>; args: string[] } {
  const r = random(seed);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(r.next() * items.length)]!;
  const n = 1 + Math.floor(r.next() * 8);
  const keys = Array.from({ length: n }, (_, i) => (r.next() < 0.1 ? pick(["", " ", "K1"]) : `K${i}`));
  const source = [line(["id", "v", "note"])];
  for (const k of keys) source.push(line([k, pick(HOSTILE), pick(HOSTILE)]));
  const destination = [line(["v", "id"])];
  for (const k of keys) {
    const copies = r.next() < 0.3 ? 0 : r.next() < 0.15 ? 2 : 1;
    for (let c = 0; c < copies; c++) destination.push(line([pick(HOSTILE), k]));
  }
  for (let extra = 0; r.next() < 0.3 && extra < 3; extra++) destination.push(line([pick(HOSTILE), `X${seed}-${extra}`]));
  const args = ["--source", "source.csv", "--destination", "destination.csv", "--key", "id", "--field", "v"];
  if (r.next() < 0.6) args.push("--source-complete");
  if (r.next() < 0.6) args.push("--destination-complete");
  if (r.next() < 0.5) args.push("--scope", "exact");
  if (r.next() < 0.2) args.push("--details", "all");
  return { files: { "source.csv": source.join(""), "destination.csv": destination.join("") }, args };
}

const COUNT = Number(process.env.FA_EXPORT_PARITY_COUNT ?? 200);
const root = mkdtempSync(join(tmpdir(), "fa-exports-"));
const GENERATED = join(root, "generated");
mkdirSync(GENERATED);
for (let i = 0; i < COUNT; i++) {
  const c = generated(20261112 + i);
  const folder = join(GENERATED, `case-${String(i).padStart(4, "0")}`);
  mkdirSync(folder);
  for (const [name, text] of Object.entries(c.files)) writeFileSync(join(folder, name), text);
  writeFileSync(join(folder, "case.json"), JSON.stringify({ args: c.args }));
}
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ROOTS = [join(REPO_ROOT, "offline/golden"), join(REPO_ROOT, "offline/golden-xlsx"), GENERATED];
const python: Record<string, PythonRun> = skip ? {} : JSON.parse(execFileSync(PYTHON, [SCRIPT, ...ROOTS], { maxBuffer: 1 << 28 }).toString());
const cases = Object.keys(python).sort(compareCodePoints);
const folderOf = (name: string) => join(name.startsWith("generated/") ? root : join(REPO_ROOT, "offline"), name);
const hex = (text: string) => Buffer.from(new TextEncoder().encode(text)).toString("hex");

describe("the records to resend, as the command line writes them", () => {
  test.skipIf(skip)(`every case is run (${why})`, () => {
    expect(cases.filter((c) => c.startsWith("golden/")).length).toBeGreaterThanOrEqual(90);
    expect(cases.filter((c) => c.startsWith("golden-xlsx/")).length).toBeGreaterThanOrEqual(60);
    expect(cases.filter((c) => c.startsWith("generated/")).length).toBe(COUNT);
    // Every file is written by some case.
    const written = new Set(Object.values(python).flatMap((r) => Object.keys(r.files ?? {})));
    expect([...written].sort()).toEqual([...FILES].sort());
  });

  test.skipIf(skip).each(skip ? ["(skipped)"] : cases)("%s", async (name) => {
    const folder = folderOf(name);
    const c = JSON.parse(readFileSync(join(folder, "case.json"), "utf-8")) as { args: string[] };
    const outcome = await check({ ...parseArgs(c.args, folder), now: () => "2000-01-01T00:00:00Z", exportDir: EXPORT });
    const files = outcome.exit === 2 ? null : Object.fromEntries((outcome.exports?.files ?? []).map((f) => [f.file, hex(f.text)]).sort(([a], [b]) => compareCodePoints(a!, b!)));
    expect({ exit: outcome.exit, stdout: outcome.stdout, stderr: outcome.stderr, files }).toEqual(python[name]);
  });
});

describe("the bytes of a file", () => {
  test("a field is quoted only when it must be, and a lone empty field always", () => {
    expect(rowText([""])).toBe('""\r\n');
    expect(rowText(["", ""])).toBe(",\r\n");
    expect(rowText(['a"b', "c,d", "e\nf", "g\rh", "plain"])).toBe('"a""b","c,d","e\nf","g\rh",plain\r\n');
  });

  test("formula-like text is counted, and a plain number is not", () => {
    expect(["-5", "+44", "1.5", "-1.5", "-", "=", "-x", "", "a=b", "\tx", "\rx", "@x"].map(formulaLike)).toEqual([false, false, false, false, true, true, true, false, false, true, true, true]);
  });
});

describe("the packaged checker", () => {
  const input = (exports?: boolean) => ({
    source: { name: "source.csv", content: "id,v,note\r\nK1,a,=x\r\nK2,b,y\r\n" },
    destination: { name: "destination.csv", content: "v,id\r\nb,K2\r\n" },
    config: { key: ["id", "id"], fields: [{ source: "v", destination: "v", rule: "exact" }], scope: "source" },
    sourceComplete: true,
    destinationComplete: true,
    ...(exports === undefined ? {} : { exports }),
  });

  /** A result without the time it was evaluated, which differs from call to call. */
  const timeless = (r: object) => JSON.parse(JSON.stringify(r).replace(/\d{4}-\d\d-\d\dT[0-9:.]+Z/g, "T"));

  test("without exports, the result is as before", async () => {
    const result = await checkCsv(input());
    expect("exports" in result).toBe(false);
    const off = await checkCsv(input(false));
    expect("exports" in off).toBe(false);
    expect(timeless(off)).toEqual(timeless(result));
  });

  test("with exports, each file that has rows, its meaning and its text; the summary is unchanged", async () => {
    const plain = await checkCsv(input());
    const result = await checkCsv(input(true));
    expect(timeless({ ...result, exports: undefined })).toEqual(timeless(plain));
    expect(result.exports).toEqual([
      { file: "missing-from-destination.csv", rows: 1, meaning: MEANING["missing-from-destination.csv"], formulaFields: 1, text: `${BOM}id,v,note\r\nK1,a,=x\r\n` },
    ]);
  });

  test("a refused check has no exports, and exports must be true or false", async () => {
    expect((await checkCsv({ ...input(true), source: { name: "s.csv", content: "" } })).exports).toBeNull();
    const wrong = await checkCsv({ ...input(), exports: "yes" as unknown as boolean });
    expect(wrong.message).toBe("refused: exports must be true or false\n");
    expect(wrong.exports).toBeNull();
  });
});
