/**
 * Reports with a side read from an .xlsx workbook (schema_version 4, 1.1.0), as offline/bench/golden.py writes them into
 * offline/golden-xlsx/: the browser opens each one, explains the workbook side from the report alone, compares two of
 * them, and refuses one that does not hold together. And the file profile the page shows before a check gives, for
 * every workbook in those cases, exactly the counts the report records (docs/design/1.1-excel.md).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compareReports } from "../../offline/compare";
import { explain, textsOf } from "../../offline/explain";
import { profileXlsx } from "../../offline/profile";
import { compareCodePoints } from "../../offline/pystr";
import { NotAReport, readReport, viewOf } from "../../offline/savedReport";
import { REPO_ROOT } from "../fixtures/sources";

const GOLDEN = join(REPO_ROOT, "offline/golden-xlsx");
const names = readdirSync(GOLDEN).sort(compareCodePoints);
const has = (name: string, file: string) => readdirSync(join(GOLDEN, name)).includes(file);
const withReport = names.filter((name) => has(name, "report.json"));
const bytes = (name: string) => new Uint8Array(readFileSync(join(GOLDEN, name, "report.json")));
const read = (name: string) => readReport(bytes(name), `${name}.json`).report;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const altered = (name: string, change: (r: Json) => void) => {
  const value = JSON.parse(new TextDecoder().decode(bytes(name))) as Json;
  change(value);
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
};
const refusal = (name: string, change: (r: Json) => void) => {
  try {
    readReport(altered(name, change), "r.json");
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(NotAReport);
    return (e as NotAReport).message;
  }
};

describe("workbook reports in the browser", () => {
  test("the golden folder holds workbook results", () => {
    expect(withReport.length).toBeGreaterThanOrEqual(15);
  });

  test.each(withReport)("%s is read, viewed and explained", (name) => {
    const report = read(name);
    expect(report.schema_version).toBe(4);
    expect(viewOf(report).cohort).toBe(report.cohort_state);
    const e = explain(report);
    for (const side of ["source", "destination"] as const) {
      const book = report.inputs[`${side}_workbook`];
      expect(e.points.some((p) => p.id === `${side}-workbook`)).toBe(book !== undefined);
    }
    // Reading stored values is never offered as evidence of anything more.
    for (const text of textsOf(e)) expect(text).not.toMatch(/workbook (shows|proves)/);
  });

  test("two checks of the same worksheet are compared, and a worksheet and a file are not", () => {
    const comparable = compareReports(read("xlsx-unverified"), read("xlsx-mismatch"));
    expect(comparable.comparable).toBe(true);
    const csv = readReport(new Uint8Array(readFileSync(join(REPO_ROOT, "offline/golden/example/report.json"))), "example.json").report;
    const different = compareReports(csv, read("xlsx-mismatch"));
    expect(different.comparable).toBe(false);
    if (!different.comparable) expect(different.reasons.map((r) => r.code)).toContain("different-source");
  });

  test("a version 4 report that does not hold together is refused, with the member named", () => {
    expect(refusal("xlsx-mismatch", (r) => (r.inputs.source_workbook.rows = 9))).toContain("the worksheet had 9 data rows");
    expect(refusal("xlsx-mismatch", (r) => (r.inputs.source_encoding = "utf-8"))).toContain("inputs.source_encoding is present");
    expect(refusal("xlsx-mismatch", (r) => (r.inputs.source_workbook.values = "displayed"))).toContain("values");
    expect(refusal("xlsx-mismatch", (r) => (r.inputs.source_workbook.password = "x"))).toContain("unknown member");
    expect(refusal("xlsx-mismatch", (r) => (r.inputs.source_workbook.cells.formulas = 1))).toContain("unknown member");
    expect(refusal("xlsx-mismatch", (r) => delete r.inputs.source_workbook)).toContain("neither");
    expect(refusal("xlsx-both-workbooks-scope-exact", (r) => (r.inputs.destination_workbook.rows = 1))).toContain("the worksheet had 1 data rows");
  });
});

/** The workbook sides of a case: the file, and the worksheet its arguments name. */
function workbooksOf(name: string): { file: string; worksheet?: string; side: "source" | "destination" }[] {
  const args = (JSON.parse(readFileSync(join(GOLDEN, name, "case.json"), "utf-8")) as { args: string[] }).args;
  const value = (option: string) => {
    const i = args.indexOf(option);
    return i < 0 ? undefined : args[i + 1];
  };
  return (["source", "destination"] as const).filter((side) => value(`--${side}-format`) === "xlsx").map((side) => ({ side, file: value(`--${side}`)!, worksheet: value(`--${side}-worksheet`) }));
}

describe("the profile's counts are the report's", () => {
  const cases = withReport.flatMap((name) => workbooksOf(name).map((w) => [`${name} ${w.side}`, name, w] as const));

  test("every workbook golden case is profiled", () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });

  test.each(cases)("%s", async (_, name, w) => {
    const data = new Uint8Array(readFileSync(join(GOLDEN, name, w.file)));
    const result = await profileXlsx({ name: w.file, size: data.length, blob: new Blob([data]), worksheet: w.worksheet });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.profile;
    const member = (JSON.parse(readFileSync(join(GOLDEN, name, "report.json"), "utf-8")) as Json).inputs[`${w.side}_workbook`];
    expect({
      rows: p.rows,
      columns: p.columns.length,
      worksheet: p.workbook!.worksheet,
      state: p.workbook!.state,
      cells: p.workbook!.cells,
      hidden_rows: p.workbook!.hiddenRows,
      hidden_columns: p.workbook!.hiddenColumns,
      merged_ranges: p.workbook!.mergedRanges,
      date_system: p.workbook!.dateSystem,
      sheets: p.workbook!.sheets.length,
    }).toEqual({
      rows: member.rows,
      columns: member.columns,
      worksheet: member.worksheet,
      state: member.worksheet_state,
      cells: member.cells,
      hidden_rows: member.hidden_rows,
      hidden_columns: member.hidden_columns,
      merged_ranges: member.merged_ranges,
      date_system: member.date_system,
      sheets: member.sheets,
    });
  });
});
