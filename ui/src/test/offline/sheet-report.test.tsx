/**
 * Reports whose source the command line read from a Google Sheets range (schema_version 2, 0.7.0): the browser opens
 * and imports them as written by offline/bench/golden.py into offline/golden-sheets/, shows where the rows came from,
 * explains the new members from the report alone, compares two of them, and refuses to compare
 * reports whose sources differ. Nothing here, or in the modules it tests, makes a request to Google.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { ReportStoreContext, memoryStore, type ReportStore } from "../../lib/savedReports";
import { compareReports, type Comparison } from "../../offline/compare";
import { explain, textsOf } from "../../offline/explain";
import { NotAReport, readReport, viewOf, type SavedReport } from "../../offline/savedReport";
import { compareCodePoints } from "../../offline/pystr";
import { CompareReportsPage } from "../../pages/CompareReports";
import { SavedReportPage } from "../../pages/SavedReports";
import { REPO_ROOT } from "../fixtures/sources";

const SHEETS = join(REPO_ROOT, "offline/golden-sheets");
const names = readdirSync(SHEETS).sort(compareCodePoints);
const withReport = names.filter((name) => {
  try {
    readFileSync(join(SHEETS, name, "report.json"));
    return true;
  } catch {
    return false;
  }
});
const bytes = (name: string) => new Uint8Array(readFileSync(join(SHEETS, name, "report.json")));
const read = (name: string) => readReport(bytes(name), `${name}.json`).report;
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const altered = (name: string, change: (r: Json) => void) => {
  const value = JSON.parse(new TextDecoder().decode(bytes(name))) as Json;
  change(value);
  return encode(value);
};

describe("opening a report from a sheet source", () => {
  test("the golden folder holds results and refusals", () => {
    expect(withReport.length).toBeGreaterThanOrEqual(10);
    expect(names.length).toBeGreaterThan(withReport.length);
  });

  test.each(withReport)("%s is read, with where its rows were read", (name) => {
    const report = read(name);
    expect(report.schema_version).toBe(2);
    const sheet = report.inputs.source_sheet!;
    expect(sheet.read_by).toBe("FlowAssert");
    expect(sheet.spreadsheet_id).toBe("1SyntheticSpreadsheet-FlowAssert_0001");
    expect(sheet.range_returned.length).toBeGreaterThan(0);
    expect(report.inputs.source_encoding).toBeUndefined();
    // The page's list of inputs keeps the plain members; the sheet is shown on its own.
    expect(viewOf(report).inputs.map(([k]) => k)).not.toContain("source_sheet");
  });

  test("the revision as the report records it", () => {
    expect(read("sheet-verified").inputs.source_sheet!.revision).toEqual({
      available: true,
      before: { version: "57", modified_time: "2026-11-01T09:00:00.000Z" },
      after: { version: "57", modified_time: "2026-11-01T09:00:00.000Z" },
    });
    expect(read("sheet-revision-not-requested").inputs.source_sheet!.revision).toEqual({ available: false, reason: "not requested (--skip-source-revision)" });
    expect(read("sheet-revision-not-given").inputs.source_sheet!.revision).toEqual({ available: false, reason: "Google Drive returned no version" });
  });

  test.each<[string, (r: Json) => void, string]>([
    ["a revision that changed", (r) => (r.inputs.source_sheet.revision.after.version = "58"), "inputs.source_sheet.revision differs before and after the values"],
    ["a version that is not digits", (r) => (r.inputs.source_sheet.revision.before.version = "v57"), "inputs.source_sheet.revision.before.version must be a whole number"],
    ["an unknown reason", (r) => (r.inputs.source_sheet.revision = { available: false, reason: "lost" }), "inputs.source_sheet.revision.reason must be one of"],
    ["a source encoding", (r) => ((r.inputs.source_encoding = "utf-8"), (r.inputs.destination_encoding = "utf-8")), "inputs.source_encoding is present, but the source is a Google Sheets range"],
    ["another reader", (r) => (r.inputs.source_sheet.read_by = "person"), "inputs.source_sheet.read_by must be 'FlowAssert'"],
    ["another render option", (r) => (r.inputs.source_sheet.value_render_option = "UNFORMATTED_VALUE"), "inputs.source_sheet.value_render_option must be 'FORMATTED_VALUE'"],
    ["a spreadsheet ID with a path in it", (r) => (r.inputs.source_sheet.spreadsheet_id = "../x"), "inputs.source_sheet.spreadsheet_id must be letters, digits, - and _"],
    ["no read time", (r) => delete r.inputs.source_sheet.read_at, "inputs.source_sheet.read_at is missing"],
  ])("a report with %s is refused", (_, change, message) => {
    expect(() => readReport(altered("sheet-verified", change), "r.json")).toThrow(NotAReport);
    expect(() => readReport(altered("sheet-verified", change), "r.json")).toThrow(message);
  });

  test("a version 1 report ignores a member it does not know, as the format asks", () => {
    const value = JSON.parse(new TextDecoder().decode(bytes("sheet-verified"))) as Json;
    value.schema_version = 1;
    const report = readReport(encode(value), "r.json").report;
    expect(report.schema_version).toBe(1);
    expect(report.inputs.source_sheet).toBeUndefined();
  });
});

describe("what a sheet-sourced result means", () => {
  test.each(withReport)("%s: where the rows were read, and the revision, from the report alone", (name) => {
    const report = read(name);
    const e = explain(report, { redacted: report.records.some((r) => r.key === "[redacted]") });
    const ids = e.points.map((p) => p.id);
    expect(ids).toContain("source-sheet");
    expect(ids.filter((id) => id.startsWith("source-sheet-")).length).toBe(1);
    for (const text of textsOf(e)) {
      // Reading the sheet is never offered as evidence of completeness, or as making a result more certain.
      expect(text).not.toMatch(/\b(proves?|confirms?|guarantees?) (that )?(the )?(range|sheet|source) (is|holds)/i);
      expect(text).not.toMatch(/more (certain|Verified|reliable)/);
    }
  });

  test("a premise left unstated is worded for the range", () => {
    const e = explain(read("sheet-unverified"));
    const point = e.points.find((p) => p.id === "source-not-stated")!;
    expect(point.text).toEqual(["It was not stated that the sheet range is the whole batch."]);
    expect(String(point.detail)).toContain("Reading the sheet does not show that.");
    expect(String(point.detail)).toContain("FlowAssert cannot check the statement, and a wrong statement gives a wrong result.");
  });

  test("a Verified result still rests on the statement that the range is the whole batch", () => {
    const e = explain(read("sheet-verified"));
    expect(e.points.find((p) => p.id === "verified-premises")!.text[0]).toContain("Reading the sheet does not show the first.");
    expect(e.points.find((p) => p.id === "source-sheet")!.detail![0]).toContain("the same rows in a CSV file would give the same result");
  });
});

describe("comparing reports from a sheet source", () => {
  test("two reads of the same range are compared like two files", () => {
    const c = compareReports(read("sheet-verified"), read("sheet-mismatch")) as Comparison;
    expect(c.comparable).toBe(true);
    expect(c.sheetSource).toBe(true);
    // LEAD-002 differs in the later export, and LEAD-003 is missing from it.
    expect(c.records["became-problem"].map((r) => r.key)).toEqual(["LEAD-002", "LEAD-003"]);
    expect(c.records["only-earlier"].map((r) => r.key)).toEqual([]);
    expect(c.records["still-verified"].map((r) => r.key)).toEqual(["LEAD-001"]);
  });

  test("a sheet and a file are different sources, so the two are not compared", () => {
    const sheet = read("sheet-verified");
    const value = JSON.parse(new TextDecoder().decode(bytes("sheet-verified"))) as Json;
    value.schema_version = 1;
    value.evaluated_at = "2000-01-02T00:00:00Z";
    delete value.inputs.source_sheet;
    const file = readReport(encode(value), "file.json").report;
    const result = compareReports(file, sheet);
    expect(result.comparable).toBe(false);
    expect(result.comparable === false && result.reasons).toEqual([
      {
        code: "different-source",
        message: "the source differs: a CSV file in the earlier report, Google Sheets range Leads!A1:C of spreadsheet 1SyntheticSpreadsheet-FlowAssert_0001 (FORMATTED_VALUE, FORMATTED_STRING) in the later one",
      },
    ]);
  });

  test("two spreadsheets or two ranges are different sources", () => {
    const other = (change: (r: Json) => void) => readReport(altered("sheet-mismatch", change), "b.json").report;
    for (const later of [other((r) => (r.inputs.source_sheet.range_requested = "Leads!A1:C500")), other((r) => (r.inputs.source_sheet.spreadsheet_id = "1AnotherSyntheticSpreadsheet"))]) {
      const result = compareReports(read("sheet-verified"), later);
      expect(result.comparable === false && result.reasons.map((r) => r.code)).toEqual(["different-source"]);
    }
    // The returned range can grow as rows are added: that is a change in the data, not in what is checked.
    const grown = other((r) => (r.inputs.source_sheet.range_returned = "Leads!A1:C2000"));
    expect(compareReports(read("sheet-verified"), grown).comparable).toBe(true);
  });
});

describe("the pages", () => {
  const withStore = (store: ReportStore, ui: ReactNode) => <ReportStoreContext.Provider value={store}>{ui}</ReportStoreContext.Provider>;
  const add = (store: ReportStore, report: Uint8Array) => store.add(readReport(report, "r.json"), { kind: "imported", fileName: "r.json" });

  test("an opened report says where its rows were read and the revision", async () => {
    const store = memoryStore();
    const entry = await add(store, bytes("sheet-verified"));
    const { unmount } = render(withStore(store, <SavedReportPage id={entry.id} />));
    const sheet = await screen.findByTestId("saved-source-sheet");
    expect(sheet.textContent).toBe("Read by FlowAssert from Google Sheets, read-only: range Leads!A1:C1000 of spreadsheet 1SyntheticSpreadsheet-FlowAssert_0001");
    expect(screen.getByTestId("saved-source-revision").textContent).toBe("Drive version, the same before and after the values were read: 57");
    unmount();
    const none = await add(store, bytes("sheet-revision-not-requested"));
    render(withStore(store, <SavedReportPage id={none.id} />));
    expect((await screen.findByTestId("saved-source-revision")).textContent).toBe("The read cannot be tied to a revision: not requested (--skip-source-revision)");
  });

  test("the comparison page refuses a sheet and a file with the reason, and compares two sheet reads", async () => {
    const store = memoryStore();
    const value = JSON.parse(new TextDecoder().decode(bytes("sheet-verified"))) as Json;
    value.schema_version = 1;
    delete value.inputs.source_sheet;
    const file = await add(store, encode(value));
    const sheet = await add(store, bytes("sheet-mismatch"));
    const earlier = await add(store, bytes("sheet-verified"));
    const ready = () => expect(document.querySelector('[data-testid="before-counts"], [data-testid="not-comparable"]')).not.toBeNull();
    const { unmount } = render(withStore(store, <CompareReportsPage earlier={file.id} later={sheet.id} />));
    await waitFor(ready);
    expect(document.querySelector('[data-reason="different-source"]')!.textContent).toContain("The source differs: a CSV file in one report and a Google Sheets range in the other");
    expect(document.querySelector("[data-class-count]")).toBeNull();
    unmount();
    render(withStore(store, <CompareReportsPage earlier={earlier.id} later={sheet.id} />));
    await waitFor(ready);
    expect(screen.getAllByText("Source rows (Google Sheets range)").length).toBeGreaterThan(0);
  });
});

describe("the browser makes no request to Google", () => {
  test("the modules that read, compare and explain a report have no network call and no Google address", () => {
    for (const file of ["savedReport.ts", "compare.ts", "explain.ts", "api.ts", "check.ts"]) {
      const source = readFileSync(join(REPO_ROOT, "ui/src/offline", file), "utf-8");
      expect(source, file).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|googleapis\.com/);
    }
  });

  test("a report is read from its bytes, never from the address it names", () => {
    const report: SavedReport = read("sheet-api-key");
    expect(JSON.stringify(report)).not.toContain("http");
  });
});
