/**
 * The readers of the iPhone and iPad app (`npm run build:app`, dist-app/flowassert-app.js; docs/design/1.2-ios-app.md),
 * built from this checkout and run in a node:vm context with only what WebKit gives the app's engine page and the
 * bundle needs: TextDecoder, TextEncoder, Blob, ReadableStream and DecompressionStream. They check nothing: they read a
 * file before a check, or a report after one, as the browser does. Each must give, for every golden report, what the
 * report holds.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { beforeAll, describe, expect, test } from "vitest";
import { VERSION } from "../../offline/api";
import { compareCodePoints } from "../../offline/pystr";
import { REPO_ROOT } from "../fixtures/sources";
import { DIST_APP, buildBundle } from "./bundle";
import { pageCases } from "./golden-cases";

interface App {
  VERSION: string;
  profile(file: object): Promise<{ ok: boolean; profile?: { rows: number; columns: { name: string }[] }; message?: string }>;
  sheets(file: object): Promise<{ ok: boolean; sheets?: { name: string; state: string }[] }>;
  configuration(key: [string, string], fields: [string, string, string][], scope: string): string;
  open(bytes: Uint8Array, name: string): { ok: true; id: number; cohort: string; counts: Record<string, number>; total: number; schemaVersion: number } | { ok: false; check: string; message: string };
  query(id: number, q: object): { matches: number; of: number };
  window(id: number, start: number, count: number): { kind: string; record: { key: string | null; state: string } }[];
  release(id: number): void;
  diff(a: string, b: string): { notes: string[] };
}

let bundle = "";
let app: App;

beforeAll(() => {
  bundle = buildBundle(true);
  const context = createContext({ TextDecoder, TextEncoder, Blob, ReadableStream, DecompressionStream });
  runInContext(bundle, context, { filename: "flowassert-app.js" });
  app = (context as unknown as { FlowAssertApp: App }).FlowAssertApp;
}, 120_000);

const reports = ["golden", "golden-xlsx", "golden-sheets", "golden-hubspot"].flatMap((folder) =>
  readdirSync(join(REPO_ROOT, "offline", folder))
    .sort(compareCodePoints)
    .filter((name) => existsSync(join(REPO_ROOT, "offline", folder, name, "report.json")))
    .map((name) => `${folder}/${name}`),
);

describe("the app's readers", () => {
  test("are one script that defines one global, imports nothing and makes no request", () => {
    expect(bundle.startsWith("var FlowAssertApp=")).toBe(true);
    for (const pattern of [/\bimport\s*[({"'`*]/, /\bimport\./, /\brequire\s*\(/, /\bfetch\b/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /importScripts/, /\bprocess\./]) {
      expect(bundle, String(pattern)).not.toMatch(pattern);
    }
    expect(Object.keys(app).sort()).toEqual(["VERSION", "codePoint", "configuration", "diff", "open", "profile", "query", "release", "sheets", "window"]);
    expect(app.VERSION).toBe(VERSION);
  });

  test("dist-app, when it has been built, is this build", () => {
    if (existsSync(DIST_APP)) expect(readFileSync(DIST_APP, "utf-8")).toBe(bundle);
  });

  test("the reports are found", () => {
    expect(reports.length).toBe(93);
  });

  test.each(reports)("%s is opened as the report it is, and its records are listed in its order", (path) => {
    const bytes = readFileSync(join(REPO_ROOT, "offline", path, "report.json"));
    const report = JSON.parse(bytes.toString("utf-8")) as { cohort_state: string; counts: Record<string, number>; records: { key: string | null; state: string }[]; schema_version: number };
    const opened = app.open(bytes, "report.json");
    if (!opened.ok) throw new Error(opened.message);
    expect({ cohort: opened.cohort, counts: opened.counts, total: opened.total, schemaVersion: opened.schemaVersion }).toEqual({
      cohort: report.cohort_state,
      counts: report.counts,
      total: report.records.length,
      schemaVersion: report.schema_version,
    });
    expect(app.query(opened.id, {})).toEqual({ matches: report.records.length, of: report.records.length, untestable: 0 });
    expect(app.window(opened.id, 0, report.records.length).map((i) => [i.record.key, i.record.state])).toEqual(report.records.map((r) => [r.key, r.state]));
    app.release(opened.id);
  });

  test("a file that is not a report is refused with its name, and nothing is opened", () => {
    expect(app.open(new TextEncoder().encode("not json"), "a.json")).toMatchObject({ ok: false, check: "json", message: expect.stringMatching(/^a\.json: invalid JSON/) });
    expect(app.open(new TextEncoder().encode('{"schema_version": 9}'), "b.json")).toMatchObject({ ok: false, check: "schema-version" });
    expect(app.open(Uint8Array.from([0xff]), "c.json")).toMatchObject({ ok: false, check: "encoding", message: "c.json: not UTF-8" });
  });

  test.each(pageCases)("%s: the profile counts the rows the check counts, and the chosen configuration has the page's bytes", async (name) => {
    const folder = join(REPO_ROOT, "offline/golden", name);
    const page = (JSON.parse(readFileSync(join(folder, "case.json"), "utf-8")) as { page: { source_encoding: string; config: string } }).page;
    const profile = await app.profile({ name: "source.csv", bytes: readFileSync(join(folder, "source.csv")), encoding: page.source_encoding });
    if (existsSync(join(folder, "report.json"))) {
      const report = JSON.parse(readFileSync(join(folder, "report.json"), "utf-8")) as { source_rows_observed: number };
      expect(profile.profile?.rows).toBe(report.source_rows_observed);
    }
    if (page.config === "canonical") {
      const config = JSON.parse(readFileSync(join(folder, "config.json"), "utf-8")) as { key: [string, string]; fields: { source: string; destination: string; rule: string }[]; scope: string };
      expect(app.configuration(config.key, config.fields.map((f) => [f.source, f.destination, f.rule]), config.scope)).toBe(readFileSync(join(folder, "config.json"), "utf-8"));
    }
  });

  test("a workbook's sheets are listed with their states, before any is read", async () => {
    const listed = await app.sheets({ name: "source.xlsx", bytes: readFileSync(join(REPO_ROOT, "offline/golden-xlsx/xlsx-refused-several-sheets/source.xlsx")) });
    expect(listed.sheets?.map((s) => [s.name, s.state])).toEqual([["Summary", "visible"], ["Contacts", "hidden"], ["Notes", "visible"]]);
  });
});
