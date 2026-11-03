/**
 * The shared conformance cases (offline/conformance/*.json) against the TypeScript evaluator, loaded with the same
 * validation as load_conformance_cases in scripts/dev/tests/test_offline_verify.py. An empty folder or an invalid case
 * fails, so the suite cannot pass by running nothing.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { evaluate, type Obligation, type RowObject } from "../../offline/evaluator";
import { compareCodePoints } from "../../offline/pystr";
import { REPO_ROOT } from "../fixtures/sources";

const CONFORMANCE = join(REPO_ROOT, "offline/conformance");
const CASE_KEYS = ["description", "destination_rows", "expected", "name", "obligation", "premises", "source_rows"];
const EXPECTED_KEYS = ["cohort_state", "expected_total", "record_states"];
const PREMISES = ["source_complete", "destination_complete", "source_count", "destination_count"];

interface Case {
  name: string;
  obligation: Obligation;
  source_rows: RowObject[];
  destination_rows: RowObject[];
  premises: Record<string, unknown>;
  expected: { cohort_state: string; record_states: string[]; expected_total: number | null };
}

const sameKeys = (value: object, keys: string[]) => JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** load_conformance_cases: every *.json in the folder, in name order, each with exactly the case members. */
export function loadConformanceCases(directory: string): Case[] {
  const names = readdirSync(directory).filter((n) => n.endsWith(".json")).sort(compareCodePoints);
  if (!names.length) throw new Error(`no conformance cases found in ${directory}`);
  const seen = new Set<string>();
  return names.map((file) => {
    const data: unknown = JSON.parse(readFileSync(join(directory, file), "utf-8"));
    if (!isObject(data) || !sameKeys(data, CASE_KEYS)) throw new Error(`${file}: must contain exactly ${JSON.stringify(CASE_KEYS)}`);
    if (!isObject(data.expected) || !sameKeys(data.expected, EXPECTED_KEYS)) throw new Error(`${file}: expected must contain ${JSON.stringify(EXPECTED_KEYS)}`);
    if (typeof data.name !== "string" || !data.name.trim() || seen.has(data.name)) throw new Error(`${file}: missing or duplicate case name`);
    // Python passes the premises as keyword arguments, so an unknown one is an error there too.
    if (!isObject(data.premises) || Object.keys(data.premises).some((k) => !PREMISES.includes(k))) throw new Error(`${file}: premises may only state ${PREMISES.join(", ")}`);
    seen.add(data.name);
    return data as unknown as Case;
  });
}

describe("conformance cases", () => {
  const cases = loadConformanceCases(CONFORMANCE);

  test("the folder holds the cases", () => {
    expect(cases.length).toBe(readdirSync(CONFORMANCE).filter((n) => n.endsWith(".json")).length);
    expect(cases.length).toBeGreaterThan(30);
  });

  test.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const result = evaluate(c.obligation, c.source_rows, c.destination_rows, c.premises);
    expect({
      cohort_state: result.cohort_state,
      record_states: [...result.records].map((r) => r.state),
      expected_total: result.expected_total,
    }).toEqual(c.expected);
  });

  test("the loader refuses an empty folder and invalid cases", () => {
    const dir = mkdtempSync(join(tmpdir(), "fa-conformance-"));
    try {
      expect(() => loadConformanceCases(dir)).toThrow("no conformance cases");
      writeFileSync(join(dir, "bad.json"), '{"name": "only-name"}');
      expect(() => loadConformanceCases(dir)).toThrow("must contain exactly");
      const valid = JSON.parse(readFileSync(join(CONFORMANCE, "no-rows.json"), "utf-8")) as Record<string, unknown>;
      writeFileSync(join(dir, "bad.json"), JSON.stringify({ ...valid, expected: { cohort_state: "Unverified" } }));
      expect(() => loadConformanceCases(dir)).toThrow("expected must contain");
      writeFileSync(join(dir, "bad.json"), JSON.stringify(valid));
      writeFileSync(join(dir, "dup.json"), JSON.stringify(valid));
      expect(() => loadConformanceCases(dir)).toThrow("duplicate case name");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
