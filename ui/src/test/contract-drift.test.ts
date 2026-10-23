/**
 * Drift guard: the wire mirror (src/data/contract/v1.ts) must restate the reviewed OpenAPI exactly.
 * The contract is the Service's pinned copy (./contract/fixtures.ts); if it is missing the suite fails — never skips.
 *
 * Two layers:
 *  1. key lists (SCHEMA_KEYS): property names and required sets — the original check, kept;
 *  2. shapes (./contract/guard.ts): types, nullability, enums, consts, nested objects, array items,
 *     $ref targets, closed objects, schema scope, path/query parameters and response bindings.
 * Its sensitivity is proven by deliberate mutations in contract-drift-mutations.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION, OPTIONAL_KEYS, SCHEMA_KEYS, V1_PATHS } from "../data/contract/v1";
import { BINDING, CONTRACT, MIRROR_SOURCE, UNMIRRORED_SCHEMAS } from "./contract/fixtures";
import { checkContract, type OpenApiDoc } from "./contract/guard";

interface Schema {
  properties?: Record<string, unknown>;
  required?: string[];
}

describe("wire mirror vs reviewed OpenAPI", () => {
  // The contract is JSON-compatible YAML 1.2 by design, so JSON.parse reads it without a YAML package.
  const doc = JSON.parse(readFileSync(CONTRACT, "utf8")) as { info: { version: string }; paths: Record<string, unknown>; components: { schemas: Record<string, Schema> } };

  it("is the same contract version", () => {
    expect(doc!.info.version).toBe(CONTRACT_VERSION);
  });

  it("names the two Phase 1 paths that exist in the contract", () => {
    for (const p of Object.values(V1_PATHS)) expect(Object.keys(doc!.paths)).toContain(p);
  });

  for (const [name, keys] of Object.entries(SCHEMA_KEYS)) {
    it(`${name}: same properties and required set`, () => {
      const schema = doc!.components.schemas[name];
      expect(schema, `schema ${name} missing from contract`).toBeDefined();
      expect(Object.keys(keys).sort()).toEqual(Object.keys(schema!.properties ?? {}).sort());
      const optional = new Set(OPTIONAL_KEYS[name as keyof typeof SCHEMA_KEYS] ?? []);
      const required = Object.keys(keys).filter((k) => !optional.has(k)).sort();
      expect(required).toEqual([...(schema!.required ?? [])].sort());
    });
  }
});

describe("wire mirror vs reviewed OpenAPI — shapes, scope and endpoints", () => {
  const doc = JSON.parse(readFileSync(CONTRACT, "utf8")) as OpenApiDoc;
  const report = checkContract(doc, MIRROR_SOURCE, BINDING);

  it("finds no difference in any material property within the Detail/evidence scope", () => {
    expect(report!.diffs).toEqual([]);
  });

  it("compares exactly the 33 schemas reachable from the two endpoints and the Error envelope", () => {
    expect(report!.compared).toEqual(report!.inScope);
    expect(report!.compared).toHaveLength(33);
    // The scalar schemas and Counts were not compared by the key-list check; they are now.
    for (const s of ["State", "RuleStatus", "Digest", "Timestamp", "RawJSON", "RawTick", "Counts"]) expect(report!.compared).toContain(s);
  });

  it("leaves only the collection and overview schemas unmirrored, by name", () => {
    const all = Object.keys(doc!.components.schemas).sort();
    expect(all.filter((n) => !report!.compared.includes(n))).toEqual([...UNMIRRORED_SCHEMAS].sort());
  });

  it("binds the mirrored key lists to the same schemas the shape check compares", () => {
    for (const name of Object.keys(SCHEMA_KEYS)) expect(report!.compared).toContain(name);
  });
});
