#!/usr/bin/env node
/**
 * The cases the app's engine test (ios/FlowAssertTests/EngineParityTests.swift) runs in WebKit, and what each must give.
 *
 *   node ios/scripts/engine-cases.mjs [--python PATH] [--large]
 *
 * Writes ios/build/engine-cases/: manifest.json and, for each case, the checkCsv request and the expected results.
 * Every request is run here twice, as references:
 *
 * - **node**: the packaged checker (ui/dist-lib/flowassert-check.js, which must be the app's copy) in a node:vm context
 *   with TextDecoder, TextEncoder, Blob, DecompressionStream and ReadableStream and nothing else, as bundle.test.ts runs
 *   it (the last three for workbooks);
 * - **python**: the command line, `offline/verify.py`, with the arguments the CSV check page is equivalent to
 *   (pageCheck.ts): --config, both encodings or formats, the premises and the options. For the golden cases the page can
 *   run, the files in offline/golden/ themselves. A case the command line cannot express (an option the packaged checker
 *   refuses in its own words) has the node reference only, and the manifest says why.
 *
 * In both, the premises' origin is the app's, "iPhone and iPad app"; for the command line it is written in place of
 * "command-line option", as golden-cases.ts does. Nothing here changes a file outside ios/build/.
 *
 * Groups: golden (offline/golden/, every case marked `page`), xlsx (every case of offline/golden-xlsx/), conformance
 * (every offline/conformance/*.json, its rows written as CSV), hostile (the workbooks of hostile-workbooks.ts) and, with
 * --large, large (two CSV files of 1,000,000 rows, a workbook of about 3 MB and one of about 50 MB).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(REPO, "ios/build/engine-cases");
const ORIGIN = "iPhone and iPad app";
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const PYTHON = arg("--python") ?? "python3";
const LARGE = process.argv.includes("--large");

const bundlePath = join(REPO, "ui/dist-lib/flowassert-check.js");
const appCopy = join(REPO, "ios/FlowAssert/Engine/Page/flowassert-check.js");
if (!existsSync(bundlePath) || !readFileSync(bundlePath).equals(readFileSync(appCopy))) {
  console.error("ui/dist-lib/flowassert-check.js must be built and be the app's copy (node ios/scripts/checker.mjs --check)");
  process.exit(2);
}
const context = createContext({ TextDecoder, TextEncoder, Blob, DecompressionStream, ReadableStream });
runInContext(readFileSync(bundlePath, "utf-8"), context, { filename: "flowassert-check.js" });
const { FlowAssert } = context;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const cases = [];

const rel = (path) => relative(REPO, path);
const text = (folder, file) => (existsSync(join(folder, file)) ? readFileSync(join(folder, file), "utf-8") : null);

/** Writes one reference's result for a case; returns where it is. */
function writeResult(dir, result) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "exit.txt"), String(result.exit));
  writeFileSync(join(dir, "summary.txt"), result.summary);
  writeFileSync(join(dir, "message.txt"), result.message);
  if (result.json !== null) writeFileSync(join(dir, "report.json"), result.json);
  if (result.html !== null) writeFileSync(join(dir, "report.html"), result.html);
  return rel(dir);
}

/** The request as checkCsv takes it, with each file's bytes read from its path. */
function apiInput(request) {
  const side = (s) => ({
    name: s.name,
    content: readFileSync(join(REPO, s.path)),
    ...(s.encoding !== undefined ? { encoding: s.encoding } : {}),
    ...(s.format !== undefined ? { format: s.format } : {}),
    ...(s.worksheet !== undefined ? { worksheet: s.worksheet } : {}),
  });
  const c = request.config;
  return {
    source: side(request.source),
    destination: side(request.destination),
    config: c.path !== undefined ? readFileSync(join(REPO, c.path)) : { key: [c.chosen.key[0], c.chosen.key[1]], fields: c.chosen.fields.map(([source, destination, rule]) => ({ source, destination, rule })), scope: c.chosen.scope },
    sourceComplete: request.sourceComplete,
    destinationComplete: request.destinationComplete,
    sourceCount: request.sourceCount,
    destinationCount: request.destinationCount,
    allowIdenticalContent: request.allowIdenticalContent,
    origin: ORIGIN,
    ...Object.fromEntries(["exports", "details", "redactValues", "maxBytes", "maxRows"].filter((k) => request[k] !== undefined).map((k) => [k, request[k]])),
  };
}

/** The configuration file the page writes for chosen columns (canonicalConfig): json.dumps(indent=2, ensure_ascii=False). */
function canonicalBytes(chosen) {
  const value = { key: chosen.key, fields: chosen.fields.map(([source, destination, rule]) => ({ source, destination, rule })), scope: chosen.scope };
  return Buffer.from(JSON.stringify(value, null, 2) + "\n");
}

/** The command line's result for a request, run as the page's equivalent command in a folder of its own. */
function pythonResult(request) {
  const work = mkdtempSync(join(tmpdir(), "fa-ios-case-"));
  try {
    const place = (s) => writeFileSync(join(work, s.name), readFileSync(join(REPO, s.path)));
    place(request.source);
    place(request.destination);
    writeFileSync(join(work, "configuration"), request.config.path !== undefined ? readFileSync(join(REPO, request.config.path)) : canonicalBytes(request.config.chosen));
    const args = [join(REPO, "offline/verify.py"), "--source", request.source.name, "--destination", request.destination.name, "--config", "configuration"];
    for (const [side, s] of [["source", request.source], ["destination", request.destination]]) {
      if (s.format === "xlsx") {
        args.push(`--${side}-format`, "xlsx");
        if (s.worksheet !== undefined) args.push(`--${side}-worksheet`, s.worksheet);
      } else args.push(`--${side}-encoding`, s.encoding ?? "utf-8");
    }
    if (request.sourceComplete) args.push("--source-complete");
    if (request.destinationComplete) args.push("--destination-complete");
    if (request.sourceCount !== null) args.push("--source-count", request.sourceCount);
    if (request.destinationCount !== null) args.push("--destination-count", request.destinationCount);
    if (request.allowIdenticalContent) args.push("--allow-identical-content");
    if (request.details !== undefined) args.push("--details", request.details);
    if (request.redactValues) args.push("--redact-values");
    if (request.maxBytes !== undefined) args.push("--max-bytes", request.maxBytes);
    if (request.maxRows !== undefined) args.push("--max-rows", request.maxRows);
    args.push("--json", "report.json", "--html", "report.html");
    const run = spawnSync(PYTHON, args, { cwd: work, encoding: "utf-8", maxBuffer: 1 << 30 });
    if (run.error) throw run.error;
    return asApp({ exit: run.status, summary: run.stdout, message: run.stderr, json: text(work, "report.json"), html: text(work, "report.html") });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** A command-line result with the app's origin in place of "command-line option", as golden-cases.ts writes it. */
const asApp = (r) => ({
  ...r,
  json: r.json?.replaceAll('"origin": "command-line option"', `"origin": ${JSON.stringify(ORIGIN)}`) ?? null,
  html: r.html?.replaceAll("· origin: command-line option", `· origin: ${ORIGIN}`) ?? null,
});

async function add(group, name, request, { python = true, golden = null, why = null } = {}) {
  const dir = join(OUT, group, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "request.json"), JSON.stringify(request, null, 2) + "\n");
  const result = await FlowAssert.checkCsv(apiInput(request));
  const references = { node: writeResult(join(dir, "node"), { ...result }) };
  if (golden) references.python = writeResult(join(dir, "python"), golden);
  else if (python) references.python = writeResult(join(dir, "python"), pythonResult(request));
  cases.push({ group, name, request: rel(join(dir, "request.json")), references, ...(why ? { pythonNotRun: why } : {}) });
}

const premises = { sourceComplete: false, destinationComplete: false, sourceCount: null, destinationCount: null, allowIdenticalContent: false };

// ---------- golden: every case the CSV check page can run, against the files in offline/golden/ ----------

const GOLDEN = join(REPO, "offline/golden");
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
for (const name of readdirSync(GOLDEN).sort(byCodePoint)) {
  const folder = join(GOLDEN, name);
  const c = JSON.parse(readFileSync(join(folder, "case.json"), "utf-8"));
  if (!c.page) continue;
  const p = c.page;
  const config = p.config === "loaded" ? null : JSON.parse(readFileSync(join(folder, "config.json"), "utf-8"));
  const request = {
    source: { name: "source.csv", path: rel(join(folder, "source.csv")), encoding: p.source_encoding },
    destination: { name: "destination.csv", path: rel(join(folder, "destination.csv")), encoding: p.destination_encoding },
    config: p.config === "loaded" ? { path: rel(join(folder, "config.json")) } : { chosen: { key: config.key, fields: config.fields.map((f) => [f.source, f.destination, f.rule]), scope: config.scope } },
    sourceComplete: p.source_complete,
    destinationComplete: p.destination_complete,
    sourceCount: p.source_count,
    destinationCount: p.destination_count,
    allowIdenticalContent: p.allow_identical_content,
  };
  const exit = Number(text(folder, "exit_status.txt"));
  await add("golden", name, request, { golden: asApp({ exit, summary: text(folder, "stdout.txt"), message: text(folder, "stderr.txt"), json: text(folder, "report.json"), html: text(folder, "report.html") }) });
}

// ---------- xlsx: every case of offline/golden-xlsx/, as the page would run its arguments ----------

const XLSX = join(REPO, "offline/golden-xlsx");
const pair = (spec) => {
  const i = spec.indexOf(":");
  return i < 0 ? [spec, spec] : [spec.slice(0, i), spec.slice(i + 1)];
};
for (const name of readdirSync(XLSX).sort(byCodePoint)) {
  const folder = join(XLSX, name);
  const args = JSON.parse(readFileSync(join(folder, "case.json"), "utf-8")).args;
  const o = { fields: [] };
  const flags = new Set();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (["--source-complete", "--destination-complete", "--allow-identical-content", "--redact-values"].includes(a)) flags.add(a);
    else if (a === "--field") o.fields.push(args[++i]);
    else o[a] = args[++i];
  }
  const side = (which) => {
    const path = o[`--${which}`];
    const s = { name: path, path: rel(join(folder, path)) };
    const format = o[`--${which}-format`];
    if (format !== undefined) s.format = format;
    if (o[`--${which}-worksheet`] !== undefined) s.worksheet = o[`--${which}-worksheet`];
    if (o[`--${which}-encoding`] !== undefined) s.encoding = o[`--${which}-encoding`];
    else if (format !== "xlsx") s.encoding = "utf-8";
    return s;
  };
  const request = {
    source: side("source"),
    destination: side("destination"),
    config: o["--config"] !== undefined ? { path: rel(join(folder, o["--config"])) } : { chosen: { key: pair(o["--key"]), fields: o.fields.map((f) => [...pair(f), "exact"]), scope: o["--scope"] ?? "source" } },
    ...premises,
    sourceComplete: flags.has("--source-complete"),
    destinationComplete: flags.has("--destination-complete"),
    sourceCount: o["--source-count"] ?? null,
    destinationCount: o["--destination-count"] ?? null,
    allowIdenticalContent: flags.has("--allow-identical-content"),
    ...(o["--details"] !== undefined ? { details: o["--details"] } : {}),
    ...(flags.has("--redact-values") ? { redactValues: true } : {}),
    ...(o["--max-bytes"] !== undefined ? { maxBytes: o["--max-bytes"] } : {}),
    ...(o["--max-rows"] !== undefined ? { maxRows: o["--max-rows"] } : {}),
  };
  // Combinations of options the app never sends, which checkCsv refuses in its own words before reading anything.
  const unknownFormat = (s) => s.format !== undefined && !["csv", "xlsx"].includes(s.format);
  const apiOnly = unknownFormat(request.source) || unknownFormat(request.destination) ||
    (request.source.format === "xlsx" && o["--source-encoding"] !== undefined) || (request.destination.format === "xlsx" && o["--destination-encoding"] !== undefined) ||
    (request.source.worksheet !== undefined && request.source.format !== "xlsx") || (request.destination.worksheet !== undefined && request.destination.format !== "xlsx");
  await add("xlsx", name, request, apiOnly ? { python: false, why: "an option combination the command line refuses with its own option names, and checkCsv with its own; the app never sends it" } : {});
}

// ---------- conformance: every case, its rows written as CSV files ----------

const CONFORMANCE = join(REPO, "offline/conformance");
const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
const csvText = (columns, rows) => [columns, ...rows.map((r) => columns.map((c) => r[c] ?? ""))].map((cells) => (cells.length === 1 && cells[0] === "" ? '""' : cells.map(csvCell).join(","))).join("\n") + "\n";
for (const file of readdirSync(CONFORMANCE).filter((n) => n.endsWith(".json")).sort(byCodePoint)) {
  const c = JSON.parse(readFileSync(join(CONFORMANCE, file), "utf-8"));
  const ob = c.obligation;
  const dir = join(OUT, "conformance", c.name, "files");
  mkdirSync(dir, { recursive: true });
  const columns = (rows, own) => [...new Set([...own, ...rows.flatMap((r) => Object.keys(r))])];
  const fields = ob.fields.map((f) => [f[0], f[1], f[2] ?? "exact"]);
  writeFileSync(join(dir, "source.csv"), csvText(columns(c.source_rows, [ob.key[0], ...fields.map((f) => f[0])]), c.source_rows));
  writeFileSync(join(dir, "destination.csv"), csvText(columns(c.destination_rows, [ob.key[1], ...fields.map((f) => f[1])]), c.destination_rows));
  const p = c.premises;
  const count = (v) => (v === undefined || v === null ? null : String(v));
  const request = {
    source: { name: "source.csv", path: rel(join(dir, "source.csv")), encoding: "utf-8" },
    destination: { name: "destination.csv", path: rel(join(dir, "destination.csv")), encoding: "utf-8" },
    config: { chosen: { key: ob.key, fields, scope: ob.scope ?? "source" } },
    ...premises,
    sourceComplete: p.source_complete === true,
    destinationComplete: p.destination_complete === true,
    sourceCount: count(p.source_count),
    destinationCount: count(p.destination_count),
    // Two cases with the same rows on both sides are identical files; they are still two systems' rows.
    allowIdenticalContent: true,
    details: "all",
  };
  await add("conformance", c.name, request);
  writeFileSync(join(OUT, "conformance", c.name, "expected.json"), JSON.stringify(c.expected, null, 2) + "\n");
  cases[cases.length - 1].conformance = rel(join(OUT, "conformance", c.name, "expected.json"));
}

// ---------- hostile: the workbooks found by fuzzing, each as the source of a check ----------

const require = createRequire(join(REPO, "ui/package.json"));
const { createJiti } = require("jiti");
const jiti = createJiti(join(REPO, "ui/package.json"));
const { hostileWorkbooks } = await jiti.import(join(REPO, "ui/src/test/offline/hostile-workbooks.ts"));
const hostileDir = join(OUT, "hostile", "files");
mkdirSync(hostileDir, { recursive: true });
writeFileSync(join(hostileDir, "destination.csv"), "id,phone\nK1,1\n");
for (const { name, bytes } of await hostileWorkbooks()) {
  writeFileSync(join(hostileDir, name), bytes);
  // Each workbook's own second column; identical content allowed, so that a readable workbook is checked, not refused.
  const column = name.startsWith("inline-string-without-text") ? "n" : "phone";
  await add("hostile", name, {
    source: { name, path: rel(join(hostileDir, name)), format: "xlsx" },
    destination: { name: "destination.csv", path: rel(join(hostileDir, "destination.csv")), encoding: "utf-8" },
    config: { chosen: { key: ["id", "id"], fields: [[column, "phone", "exact"]], scope: "source" } },
    ...premises,
    sourceComplete: true,
    destinationComplete: true,
    allowIdenticalContent: true,
  });
}

// ---------- large: two CSV files of 1,000,000 rows, a workbook of about 3 MB and one of about 50 MB ----------

if (LARGE) {
  const dir = join(OUT, "large", "files");
  mkdirSync(dir, { recursive: true });
  const id = (i) => String(i).padStart(7, "0");
  const DIFFERENT = new Set([17, 500_000, 999_999]);
  const writeCsv = (path, line) => {
    const parts = ["id,phone,email\n"];
    for (let i = 0; i < 1_000_000; i++) parts.push(line(i));
    writeFileSync(path, parts.join(""));
  };
  writeCsv(join(dir, "source.csv"), (i) => `SYN-${id(i)},+1 555 ${id(i)},u${id(i)}@ex.test\n`);
  writeCsv(join(dir, "destination.csv"), (i) => `SYN-${id(i)},${DIFFERENT.has(i) ? "+1 555 0000000x" : `+1 555 ${id(i)}`},u${id(i)}@ex.test\n`);
  const chosen = { key: ["id", "id"], fields: [["phone", "phone", "exact"], ["email", "email", "exact"]], scope: "source" };
  await add("large", "csv-1000000-rows", {
    source: { name: "source.csv", path: rel(join(dir, "source.csv")), encoding: "utf-8" },
    destination: { name: "destination.csv", path: rel(join(dir, "destination.csv")), encoding: "utf-8" },
    config: { chosen },
    ...premises,
    sourceComplete: true,
    destinationComplete: true,
  });
  for (const [label, rows, noise] of [["workbook-3mb", 192_000, 0], ["workbook-50mb", 500_000, 100]]) {
    const path = join(dir, `${label}.xlsx`);
    execFileSync(PYTHON, [join(REPO, "ios/scripts/large_workbook.py"), path, String(rows), String(noise)]);
    await add("large", label, {
      source: { name: `${label}.xlsx`, path: rel(path), format: "xlsx" },
      destination: { name: "destination.csv", path: rel(join(dir, "destination.csv")), encoding: "utf-8" },
      config: { chosen },
      ...premises,
      sourceComplete: true,
      destinationComplete: true,
    });
    cases[cases.length - 1].bytes = statSync(path).size;
  }
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ origin: ORIGIN, version: FlowAssert.VERSION, cases }, null, 2) + "\n");
const counts = {};
for (const c of cases) counts[c.group] = (counts[c.group] ?? 0) + 1;
console.log(`${cases.length} cases in ${rel(OUT)}:`, counts);
