/**
 * The JSON Schemas of the report (docs/schema/, written by offline/bench/schemas.py) against every report the tests
 * hold: each golden report, each report of a comparison case, and the reports the packaged checker writes for the
 * golden cases the page can run. The validator is ./json-schema.ts, the TypeScript twin of
 * offline/bench/json_schema.py; both run the shared cases of offline/bench/json_schema_cases.json first.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { checkCsv } from "../../offline/api";
import { compareCodePoints } from "../../offline/pystr";
import { REPO_ROOT } from "../fixtures/sources";
import { apiInput, pageCases } from "./golden-cases";
import { SchemaError, undeclared, validate, type Json, type Schema } from "./json-schema";

const SCHEMAS = join(REPO_ROOT, "docs/schema");
const read = (path: string) => JSON.parse(readFileSync(path, "utf-8")) as Json;
const schemaFiles = readdirSync(SCHEMAS).filter((n) => n.endsWith(".schema.json")).sort(compareCodePoints);
const schemas = new Map(schemaFiles.map((name) => [Number(/report-v(\d+)\./.exec(name)![1]), read(join(SCHEMAS, name)) as Schema]));
const schemaOf = (report: Json) => schemas.get((report as { schema_version: number }).schema_version);

interface ValidatorCases {
  cases: { description: string; schema: Schema; valid: Json[]; invalid: Json[] }[];
  unsupported: { description: string; schema: Schema; instance?: Json }[];
  undeclared: { description: string; schema: Schema; instance: Json; undeclared: string[] }[];
}
const shared = read(join(REPO_ROOT, "offline/bench/json_schema_cases.json")) as unknown as ValidatorCases;

describe("the schema validator of the tests", () => {
  test.each(shared.cases.map((c) => [c.description, c] as const))("%s", (_, c) => {
    for (const instance of c.valid) expect(validate(c.schema, instance)).toEqual([]);
    for (const instance of c.invalid) expect(validate(c.schema, instance).length, JSON.stringify(instance)).toBeGreaterThan(0);
  });

  test.each(shared.unsupported.map((c) => [c.description, c] as const))("refuses a schema with %s", (_, c) => {
    expect(() => validate(c.schema, c.instance ?? { a: 1 })).toThrow(SchemaError);
  });

  test.each(shared.undeclared.map((c) => [c.description, c] as const))("undeclared members: %s", (_, c) => {
    expect(undeclared(c.schema, c.instance)).toEqual(c.undeclared);
  });
});

function reports(): [string, Json][] {
  const found: [string, Json][] = [];
  for (const kind of ["golden", "golden-sheets", "golden-hubspot"]) {
    const root = join(REPO_ROOT, "offline", kind);
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root).sort(compareCodePoints)) {
      const path = join(root, name, "report.json");
      if (existsSync(path)) found.push([`${kind}/${name}`, read(path)]);
    }
  }
  const comparisons = join(REPO_ROOT, "ui/src/test/offline/comparison-cases");
  for (const file of readdirSync(comparisons).sort(compareCodePoints)) {
    const c = read(join(comparisons, file)) as Record<"earlier" | "later", { report?: Json }>;
    for (const side of ["earlier", "later"] as const) if (c[side].report) found.push([`comparison/${file.replace(".json", "")}/${side}`, c[side].report]);
  }
  return found;
}

describe("the report schemas", () => {
  const all = reports();

  test("there is a schema for every schema_version a report has", () => {
    expect(all.length).toBeGreaterThan(90);
    expect([...new Set(all.map(([, r]) => (r as { schema_version: number }).schema_version))].sort()).toEqual([...schemas.keys()].sort());
  });

  test.each(all)("%s is valid, and the schema describes every member", (_, report) => {
    const schema = schemaOf(report)!;
    expect(validate(schema, report)).toEqual([]);
    expect(undeclared(schema, report)).toEqual([]);
  });

  test("every report the TypeScript check writes for a page case is valid", async () => {
    let checked = 0;
    for (const name of pageCases) {
      const result = await checkCsv(apiInput(name));
      if (result.json === null) continue;
      const report = JSON.parse(result.json) as Json;
      expect(validate(schemaOf(report)!, report), name).toEqual([]);
      expect(undeclared(schemaOf(report)!, report), name).toEqual([]);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(40);
  });

  test("a schema refuses a report that is not one, and allows a member it does not know", () => {
    const report = read(join(REPO_ROOT, "offline/golden/rules-fail/report.json")) as Record<string, Json>;
    const schema = schemas.get(1)!;
    expect(validate(schema, { ...report, claim: "It is fine." }).length).toBeGreaterThan(0);
    expect(validate(schema, { ...report, schema_version: 2 }).length).toBeGreaterThan(0);
    expect(validate(schema, { ...report, counts: { ...(report.counts as object), Pending: 1 } as Json }).length).toBeGreaterThan(0);
    expect(validate(schema, { ...report, added_in_a_later_release: 1 })).toEqual([]);
  });
});
