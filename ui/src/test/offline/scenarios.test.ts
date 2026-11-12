/**
 * The scenarios of offline/examples/scenarios/ (pages/scenarios.ts): every expectation in scenarios.json is a golden
 * case with the result it names, as the command line gives it (golden.test.ts runs the same cases as the page does);
 * each scenario's config.json is the configuration the page uses, byte for byte; and the files are synthetic. The
 * workbook scenario (1.1.0) has its cases in offline/golden-xlsx/, with its workbook as the source.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { canonicalConfig } from "../../offline/check";
import { readXlsx } from "../../offline/xlsx";
import { SCENARIOS, chosenOf } from "../../pages/scenarios";
import { REPO_ROOT } from "../fixtures/sources";

const DIR = join(REPO_ROOT, "offline/examples/scenarios");
const GOLDEN_CSV = join(REPO_ROOT, "offline/golden");
const GOLDEN_XLSX = join(REPO_ROOT, "offline/golden-xlsx");
const goldenOf = (s: { source_format?: string }) => (s.source_format === "xlsx" ? GOLDEN_XLSX : GOLDEN_CSV);
const EXIT = { Verified: "0", Mismatch: "1", Unverified: "3" } as Record<string, string>;
const SUFFIX = (p: { source_complete: boolean; destination_complete: boolean }) =>
  p.source_complete ? (p.destination_complete ? "both-statements" : "source-statement") : p.destination_complete ? "destination-statement" : "no-statements";

const expectations = SCENARIOS.flatMap((s) => s.expect.map((e) => [`scenario-${s.id}-${SUFFIX(e.premises)}`, s, e] as const));

describe("scenarios", () => {
  test("four CSV scenarios and one workbook scenario, each with at least two sets of premises", () => {
    expect(SCENARIOS.filter((s) => s.source_format === undefined)).toHaveLength(4);
    expect(SCENARIOS.filter((s) => s.source_format === "xlsx")).toHaveLength(1);
    for (const s of SCENARIOS) expect(s.expect.length).toBeGreaterThanOrEqual(2);
    // Between them they show each result.
    expect(new Set(SCENARIOS.flatMap((s) => s.expect.map((e) => e.result)))).toEqual(new Set(["Verified", "Mismatch", "Unverified"]));
  });

  test.each(expectations)("%s is the golden case of that expectation, with its result", (name, s, e) => {
    const folder = join(goldenOf(s), name);
    expect(existsSync(folder)).toBe(true);
    expect(readFileSync(join(folder, "exit_status.txt"), "utf-8").trim()).toBe(EXIT[e.result]);
    expect(readFileSync(join(folder, "stdout.txt"), "utf-8").split(":")[0]).toBe(e.result);
    // The case runs the scenario's own files, with exactly the premises named, as the page runs it.
    expect(readFileSync(join(folder, "destination.csv"), "utf-8")).toBe(s.destination);
    if (s.source_format === "xlsx") {
      expect(new Uint8Array(readFileSync(join(folder, "source.xlsx")))).toEqual(s.source);
      const args = (JSON.parse(readFileSync(join(folder, "case.json"), "utf-8")) as { args: string[] }).args;
      expect(args.includes("--source-complete")).toBe(e.premises.source_complete);
      expect(args.includes("--destination-complete")).toBe(e.premises.destination_complete);
      expect(args.join(" ")).toContain(`--source-format xlsx --source-worksheet ${s.source_worksheet}`);
      return;
    }
    expect(readFileSync(join(folder, "source.csv"), "utf-8")).toBe(s.source);
    const page = (JSON.parse(readFileSync(join(folder, "case.json"), "utf-8")) as { page: Record<string, unknown> }).page;
    expect(page).toMatchObject({ source_complete: e.premises.source_complete, destination_complete: e.premises.destination_complete, source_count: null, destination_count: null, allow_identical_content: false });
  });

  test("every scenario case in the golden folder belongs to an expectation", () => {
    const cases = [GOLDEN_CSV, GOLDEN_XLSX].flatMap((g) => readdirSync(g).filter((n) => n.startsWith("scenario-")));
    expect(cases.sort()).toEqual(expectations.map(([name]) => name).sort());
  });

  test.each(SCENARIOS.map((s) => [s.id, s] as const))("%s: config.json is the configuration the page uses, byte for byte", (id, s) => {
    expect(readFileSync(join(DIR, id, "config.json"), "utf-8")).toBe(canonicalConfig(chosenOf(s)));
    expect(readFileSync(join(goldenOf(s), `scenario-${id}-${SUFFIX(s.expect[0]!.premises)}`, "config.json"), "utf-8")).toBe(canonicalConfig(chosenOf(s)));
  });

  test("the files are synthetic: every address is at example.test, and no file names a person", async () => {
    for (const s of SCENARIOS) {
      let source = s.source;
      if (typeof source !== "string") {
        const rows: string[][] = [];
        const read = await readXlsx({ name: "source.xlsx", blob: new Blob([source as Uint8Array<ArrayBuffer>]) }, null, (r) => void rows.push(r), { worksheet: s.source_worksheet });
        source = [read.header, ...rows].map((r) => r.join(",")).join("\n");
      }
      for (const text of [source, s.destination]) {
        for (const address of text.match(/[^\s,@]+@[^\s,]+/g) ?? []) expect(address.toLowerCase()).toMatch(/@example\.test$/);
        expect(text).not.toMatch(/\bname\b/i);
      }
    }
  });
});
