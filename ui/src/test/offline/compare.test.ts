/**
 * Comparing two reports (ui/src/offline/compare.ts) against the shared cases in comparison-cases/, written by
 * ui/scripts/offline/comparison_cases.py from reports of the command-line checker, with expectations written by hand:
 * every class, every refusal and every kind of premise difference. compareReports never changes its inputs.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLASSES, DESTINATION_ONLY_CLASSES, compareReports, type ComparisonResult } from "../../offline/compare";
import { readReport, type SavedReport } from "../../offline/savedReport";
import { GOLDEN } from "./golden-cases";

const FOLDER = join(__dirname, "comparison-cases");

interface Case {
  name: string;
  about: string;
  earlier: { golden: string } | { report: unknown };
  later: { golden: string } | { report: unknown };
  expected: Record<string, unknown>;
}

const cases = readdirSync(FOLDER)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(FOLDER, f), "utf-8")) as Case);

function load(source: Case["earlier"]): SavedReport {
  const bytes = "golden" in source ? new Uint8Array(readFileSync(join(GOLDEN, source.golden, "report.json"))) : new TextEncoder().encode(JSON.stringify(source.report));
  return readReport(bytes, "report.json").report;
}

/** The comparison in the shape of a case's `expected`. */
function project(result: ComparisonResult): Record<string, unknown> {
  if (!result.comparable) return { comparable: false, reasons: result.reasons.map((r) => r.code) };
  const ruleChanges: Record<string, unknown> = {};
  for (const c of ["became-problem", "stopped-problem", "still-problem", "still-verified"] as const) {
    for (const r of result.records[c]) ruleChanges[r.key] = r.rules === null ? "not available" : r.rules.map((x) => x.rule);
  }
  return {
    comparable: true,
    order: result.order,
    same_files_same_premises: result.sameFilesSamePremises,
    premise_differences: result.premiseDifferences.map((d) => [d.name, d.stated, d.origin]),
    digests_changed: { source: result.digests.source.changed, destination: result.digests.destination.changed },
    source_population_known: [result.sourcePopulationKnown.earlier, result.sourcePopulationKnown.later],
    destination_coverage_sufficient: [result.destinationCoverageSufficient.earlier, result.destinationCoverageSufficient.later],
    cohort_state: [result.cohortState.earlier, result.cohortState.later],
    records: Object.fromEntries(CLASSES.map((c) => [c, result.records[c].map((r) => [r.key, r.earlier?.state ?? null, r.later?.state ?? null])])),
    rule_changes: ruleChanges,
    rule_level_unavailable: result.ruleLevelUnavailable,
    destination_only: result.destinationOnly && Object.fromEntries(DESTINATION_ONLY_CLASSES.map((c) => [c, result.destinationOnly![c].map((r) => [r.key, r.earlier?.state ?? null, r.later?.state ?? null])])),
    unmatched: result.unmatched.map((u) => (u.records ? [u.report, u.key, u.source_row, u.reason, u.records.earlier, u.records.later] : [u.report, u.key, u.source_row, u.reason])),
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

describe("comparing two reports", () => {
  it("has the shared cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(19);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    expect(project(compareReports(load(c.earlier), load(c.later)))).toEqual(c.expected);
  });

  it("covers every class, every refusal and every kind of premise difference", () => {
    const expected = cases.map((c) => c.expected as { comparable: boolean; reasons?: string[]; records?: Record<string, unknown[]>; destination_only?: Record<string, unknown[]> | null; premise_differences?: [string, boolean, boolean][]; unmatched?: unknown[][] });
    for (const cls of CLASSES) expect(expected.some((e) => (e.records?.[cls]?.length ?? 0) > 0), cls).toBe(true);
    for (const cls of DESTINATION_ONLY_CLASSES) expect(expected.some((e) => (e.destination_only?.[cls]?.length ?? 0) > 0), cls).toBe(true);
    const reasons = new Set(expected.flatMap((e) => e.reasons ?? []));
    expect([...reasons].sort()).toEqual(["different-comparison", "different-fields", "different-key", "different-rules", "different-scope", "redacted", "same-report"]);
    const differences = expected.flatMap((e) => e.premise_differences ?? []);
    expect(differences.some(([, stated, origin]) => stated && !origin)).toBe(true);
    expect(differences.some(([, stated, origin]) => !stated && origin)).toBe(true);
    // A premise present in one report only differs in both.
    expect(differences.some(([name, stated, origin]) => name === "allow_identical_content" && stated && origin)).toBe(true);
    for (const name of ["source_complete", "destination_complete", "source_count", "destination_count", "allow_identical_content"]) {
      expect(differences.some(([n, stated]) => n === name && stated), name).toBe(true);
    }
    const unmatched = new Set(expected.flatMap((e) => (e.unmatched ?? []).map((u) => u[3])));
    expect([...unmatched].sort()).toEqual(["no-key", "repeated-key"]);
  });

  it.each(cases.map((c) => [c.name, c] as const))("never changes its inputs · %s", (_, c) => {
    const earlier = load(c.earlier);
    const later = load(c.later);
    const before = [structuredClone(earlier), structuredClone(later)];
    deepFreeze(earlier);
    deepFreeze(later);
    // Frozen inputs: any write would throw in strict mode.
    const result = compareReports(earlier, later);
    expect([earlier, later]).toEqual(before);
    expect(project(result)).toEqual(c.expected);
  });

  it("refuses with every reason and gives nothing else", () => {
    const c = cases.find((x) => x.name === "refused-different-key")!;
    const result = compareReports(load(c.earlier), load(c.later));
    expect(Object.keys(result).sort()).toEqual(["comparable", "reasons"]);
    expect(result.comparable).toBe(false);
    if (!result.comparable) expect(result.reasons.map((r) => r.message)).toEqual([
      'the key differs: ["key","key"] in the earlier report, ["phone","phone"] in the later one',
      'the compared fields differ: [["phone","phone"]] in the earlier report, [["key","key"]] in the later one',
    ]);
  });

  it("gives each changed rule result with both sides, never a new state", () => {
    const c = cases.find((x) => x.name === "classes-details-all")!;
    const earlier = load(c.earlier);
    const later = load(c.later);
    const result = compareReports(earlier, later);
    if (!result.comparable) throw new Error("not comparable");
    const k5 = result.records["still-problem"].find((r) => r.key === "K5")!;
    expect([k5.earlier?.state, k5.later?.state]).toEqual(["Mismatch", "Unverified"]);
    expect(k5.rules!.map((r) => [r.rule, r.earlier.status, r.later.status, r.changed])).toEqual([["field:phone", "fail", "unknown", ["status", "reason", "actual"]]]);
    // Every state in the comparison is the state one of the reports gives.
    for (const cls of CLASSES) {
      for (const r of result.records[cls]) {
        if (r.earlier) expect(earlier.records[r.earlier.source_row]!.state).toBe(r.earlier.state);
        if (r.later) expect(later.records[r.later.source_row]!.state).toBe(r.later.state);
      }
    }
  });
});
