/** 21 · Existing fixture consistency — the startup validator, run as a test, plus negative controls. */
import { describe, expect, it } from "vitest";
import { latestRuns, runs } from "../data/store";
import { DEMO_RUNS } from "../mocks/fixtures";
import type { DemoRunEnvelope } from "../mocks/types";
import { validateDemoRuns } from "../mocks/validate";

const clone = (r: DemoRunEnvelope): DemoRunEnvelope => structuredClone(r);

describe("demo fixtures", () => {
  it("are internally consistent with the research precedence", () => {
    expect(validateDemoRuns(DEMO_RUNS)).toEqual([]);
  });

  it("cover all four cohort states and the documented edge cases", () => {
    const states = new Set(DEMO_RUNS.map((r) => r.result.cohort_state));
    expect([...states].sort()).toEqual(["Mismatch", "Pending", "Unverified", "Verified"]);
    expect(DEMO_RUNS.some((r) => !r.result.source_population_known)).toBe(true);
    expect(DEMO_RUNS.some((r) => r.destination.access === "denied")).toBe(true);
    expect(DEMO_RUNS.some((r) => !r.result.destination_coverage_sufficient)).toBe(true);
  });

  it("serves the same number of runs through the store, newest first", () => {
    expect(runs).toHaveLength(DEMO_RUNS.length);
    expect(runs[0]!.id).toBe(DEMO_RUNS.at(-1)!.run_id);
    expect(latestRuns).toHaveLength(5);
  });

  it("copies every cohort and record state from the fixture without change", () => {
    for (const env of DEMO_RUNS) {
      const view = runs.find((r) => r.id === env.run_id)!;
      expect(view.state).toBe(env.result.cohort_state);
      expect(view.counts).toEqual(env.result.counts);
      expect(view.records.map((r) => [r.key, r.state])).toEqual(env.result.records.map((r) => [r.key, r.state]));
    }
  });

  describe("negative controls — the validator catches", () => {
    const base = DEMO_RUNS.find((r) => r.result.cohort_state === "Mismatch")!;

    it("a count that disagrees with the records", () => {
      const r = clone(base);
      r.result.counts.Verified += 1;
      expect(validateDemoRuns([r]).join("\n")).toMatch(/count Verified/);
    });

    it("a cohort state the records do not imply", () => {
      const r = clone(base);
      r.result.cohort_state = "Verified";
      expect(validateDemoRuns([r]).join("\n")).toMatch(/cohort Verified but records imply Mismatch/);
    });

    it("a record state its rules do not imply", () => {
      const r = clone(base);
      const rec = r.result.records.find((x) => x.state === "Mismatch")!;
      rec.state = "Verified";
      r.result.counts.Mismatch -= 1;
      r.result.counts.Verified += 1;
      expect(validateDemoRuns([r]).join("\n")).toMatch(/state Verified but rules imply Mismatch/);
    });

    it("a known expected total when the population is unknown", () => {
      const r = clone(DEMO_RUNS.find((x) => !x.result.source_population_known)!);
      r.result.expected_total = r.result.records.length;
      expect(validateDemoRuns([r]).join("\n")).toMatch(/expected_total inconsistent/);
    });
  });
});
