/**
 * P3A-AUD-002: closed-object admission must use the schema's OWN declared properties, never the
 * JavaScript prototype chain. Bodies are built as RAW JSON TEXT and admitted through JSON.parse, so a
 * "__proto__" member is an ordinary own member exactly as a real response delivers it. Expected verdicts
 * come from the contracts' own `additionalProperties: false` (every object schema in both slices) and
 * were fixed independently by Python jsonschema Draft 2020-12
 * (docs/phase3a/evidence/remediation-01/oracle/schema-oracle.json: all extra-property bodies refused).
 *
 *  A  the auditor's six failing HistoryDetail bodies     F  every Object.prototype name, not a hand list
 *  B  top-level extras (both slices)                    G  several extras at once
 *  C  nested extras (both slices)                       H  schema-DECLARED unusual names still admitted
 *  D  required-property edge cases                      I  objects inside arrays
 *  E  additionalProperties edge cases                   J  malformed schema / unsupported keyword forms
 */
import { describe, expect, it } from "vitest";
import { decodeHistoryDetail, decodeHistoryList, validateHistorySchema } from "../data/history/decode";
import { createLocalHistoryProvider } from "../data/history/provider";
import { decodeEvidencePage, decodeVerificationRun } from "../data/local/decode";
import { createLocalResearchProvider } from "../data/local/provider";
import { createSchemaValidator, validateSchema } from "../data/local/schema";
import { captured } from "./local/fakeService";
import { example } from "./local/fakeHistoryService";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Add one member to a raw JSON object text at a JSON pointer-ish path, keeping the member name verbatim. */
function withMember(body: unknown, at: (string | number)[], key: string, value: unknown = { unreviewed: true }): unknown {
  const copy = JSON.parse(JSON.stringify(body));
  let target = copy;
  for (const step of at) target = target[step];
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  const text = JSON.stringify(copy);
  expect(text).toContain(`${JSON.stringify(key)}:`); // the raw JSON really carries the member
  return JSON.parse(text);
}

const PROTOTYPE_NAMES = Object.getOwnPropertyNames(Object.prototype); // constructor, __proto__, toString, valueOf, hasOwnProperty, …
const NAMES = [...new Set([...PROTOTYPE_NAMES, "prototype", "foreign_field"])];
const protoBefore = Object.getOwnPropertyNames(Object.prototype).sort().join(",");

describe("additive slice (HistoryDetail / HistoryList)", () => {
  const detail = () => example("014-SPEC-005-history-detail");
  const req = (d: Any) => ({ historyId: d.history_id });

  it("control: the genuine SPEC-005 Detail is admitted", () => expect(decodeHistoryDetail(detail(), req(detail())).ok).toBe(true));

  // A — the auditor's exact six (FINDINGS.md P3A-AUD-002), plus the foreign_field control.
  for (const key of ["toString", "constructor", "__proto__", "foreign_field"])
    for (const [where, at] of [
      ["root", []],
      ["integrity", ["integrity"]],
    ] as const)
      it(`A: refuses an extra ${where} member "${key}"`, () => {
        const d = detail();
        const r = decodeHistoryDetail(withMember(d, [...at], key), req(d));
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.code).toBe("schema_invalid");
          expect(r.problems.join("\n")).toContain(`unexpected key "${key}"`);
        }
      });

  // B, C, F — every Object.prototype name, at the root and at nested objects of the additive schema.
  for (const key of NAMES)
    for (const at of [[], ["integrity"], ["provenance"], ["result_summary"], ["run"], ["run", "identity"], ["evaluator"]])
      it(`B/C/F: HistoryDetail${at.map((s) => `.${s}`).join("")} + "${key}" is refused`, () => {
        const errors = validateHistorySchema("HistoryDetail", withMember(detail(), at, key));
        expect(errors.map((e) => e.message)).toContain(`unexpected key "${key}"`);
      });

  // I — objects inside arrays: list items and archived run records.
  for (const key of ["constructor", "__proto__", "toString"]) {
    it(`I: HistoryList items[0] + "${key}" is refused`, () => {
      const list = example("021-list-after-insert");
      const r = decodeHistoryList(withMember(list, ["items", 0], key), { limit: 100 });
      expect(r.ok).toBe(false);
    });
    it(`I: HistoryDetail run.result.records[11] + "${key}" is refused`, () => {
      const d = detail();
      expect(decodeHistoryDetail(withMember(d, ["run", "result", "records", 11], key), req(d)).ok).toBe(false);
    });
  }

  // G — several prohibited members at once are all reported.
  it("G: several prohibited members at the root and nested are each reported", () => {
    let body = detail();
    for (const k of ["constructor", "__proto__", "toString"]) body = withMember(body, [], k);
    for (const k of ["valueOf", "__proto__"]) body = withMember(body, ["integrity"], k);
    const msgs = validateHistorySchema("HistoryDetail", body).map((e) => `${e.path} ${e.message}`);
    for (const m of ['$ unexpected key "constructor"', '$ unexpected key "__proto__"', '$ unexpected key "toString"', '.integrity unexpected key "valueOf"', '.integrity unexpected key "__proto__"']) expect(msgs).toContain(m);
  });

  it("the full provider path refuses the auditor's extra root constructor (was: kind ready)", async () => {
    const d = detail();
    const body = JSON.stringify(withMember(d, [], "constructor"));
    const r = await createLocalHistoryProvider({ fetch: (async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch }).getHistory(d.history_id);
    expect(r).toMatchObject({ kind: "error", access: "REQUEST_ERROR", code: "schema_invalid" });
  });
});

describe("frozen slice (VerificationRun / EvidencePage)", () => {
  const run = () => captured("SPEC-005-detail");
  const runReq = (r: Any) => ({ id: r.identity.id, snapshotId: r.snapshot_id });
  it("control: the genuine SPEC-005 run is admitted", () => expect(decodeVerificationRun(run(), runReq(run())).ok).toBe(true));

  for (const key of NAMES)
    for (const at of [[], ["identity"], ["meta"], ["result"], ["result", "records", 0], ["result", "records", 11]])
      it(`B/C/F/I: VerificationRun${at.map((s) => `.${s}`).join("")} + "${key}" is refused`, () => {
        const r = run();
        const decoded = decodeVerificationRun(withMember(r, at, key), runReq(r));
        expect(decoded.ok).toBe(false);
        if (!decoded.ok) expect(decoded.problems.join("\n")).toContain(`unexpected key "${key}"`);
      });

  for (const key of ["constructor", "__proto__", "toString"]) {
    it(`I: EvidencePage items[0] + "${key}" and page + "${key}" are refused`, () => {
      const page = captured("SPEC-001-evidence");
      const request = { id: page.run_id, includePayload: true, limit: 25 };
      expect(decodeEvidencePage(page, request).ok).toBe(true);
      expect(decodeEvidencePage(withMember(page, ["items", 0], key), request).ok).toBe(false);
      expect(decodeEvidencePage(withMember(page, ["page"], key), request).ok).toBe(false);
    });
  }

  it("the full provider path refuses a run with an extra __proto__ member", async () => {
    const r = run();
    const body = JSON.stringify(withMember(r, [], "__proto__"));
    const result = await createLocalResearchProvider({ fetch: (async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch }).getVerification(r.identity.id);
    expect(result).toMatchObject({ kind: "error", access: "REQUEST_ERROR" });
  });
});

describe("validator semantics on synthetic schema maps (D, E, H, J)", () => {
  const S = (schemas: Record<string, unknown>) => createSchemaValidator(schemas as Record<string, Record<string, unknown>>, "the test slice");
  const parse = (text: string) => JSON.parse(text) as unknown;

  // H — names the schema itself declares are admitted and validated by their own schemas. The map is
  // parsed from JSON text: in a JS object literal `__proto__: …` would set the prototype, not declare a member.
  const declared = S(
    JSON.parse(`{
      "Odd": { "type": "object", "additionalProperties": false, "required": ["constructor", "__proto__"],
               "properties": { "constructor": { "type": "string" }, "__proto__": { "type": "integer" }, "toString": { "type": "boolean" }, "hasOwnProperty": { "$ref": "#/components/schemas/Leaf" } } },
      "Leaf": { "type": "object", "additionalProperties": false, "properties": { "valueOf": { "type": "null" } } }
    }`),
  );
  it("H: schema-declared prototype names are admitted when valid", () =>
    expect(declared("Odd", parse('{"constructor":"c","__proto__":7,"toString":true,"hasOwnProperty":{"valueOf":null}}'))).toEqual([]));
  it("H: …and validated against their declared schemas when invalid", () => {
    const msgs = declared("Odd", parse('{"constructor":1,"__proto__":"x","toString":"no","hasOwnProperty":{"valueOf":0,"isPrototypeOf":1}}')).map((e) => `${e.path} ${e.message}`);
    expect(msgs).toEqual(
      expect.arrayContaining([".constructor expected string, got number", ".__proto__ expected integer, got string", ".toString expected boolean, got string", ".hasOwnProperty.valueOf expected null, got number", '.hasOwnProperty unexpected key "isPrototypeOf"']),
    );
  });

  // D — required keys are satisfied only by OWN members.
  it('D: a required "constructor" / "__proto__" is missing from {} although {} inherits constructor', () => {
    const msgs = declared("Odd", parse("{}")).map((e) => e.message);
    expect(msgs).toEqual(expect.arrayContaining(['missing required key "constructor"', 'missing required key "__proto__"']));
  });
  it("D: a required key present as an own member with value null is present", () => {
    const v = S({ R: { type: "object", required: ["toString"], properties: { toString: { type: "null" } } } });
    expect(v("R", parse('{"toString":null}'))).toEqual([]);
  });

  // E — additionalProperties: absent / true admit extras (JSON Schema default), false refuses, other forms fail closed.
  const open = S({ O: { type: "object", properties: { a: { type: "string" } } }, T: { type: "object", additionalProperties: true, properties: {} } });
  it("E: absent or true additionalProperties admits prototype-named extras (the contract never does this)", () => {
    expect(open("O", parse('{"a":"x","constructor":1,"__proto__":{"b":2}}'))).toEqual([]);
    expect(open("T", parse('{"toString":1}'))).toEqual([]);
  });
  it("E: an object-valued additionalProperties is an unsupported form and fails closed", () =>
    expect(S({ X: { type: "object", additionalProperties: { type: "string" } } })("X", parse('{"a":"x"}'))[0]!.message).toContain("unsupported schema keyword form"));

  // J — malformed schemas and prototype-named schema names / $refs never resolve through the prototype chain.
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    it(`J: $ref to "${name}" is unresolvable`, () => expect(S({ A: { $ref: `#/components/schemas/${name}` } })("A", parse("{}"))[0]!.message).toContain("unresolvable $ref"));
    it(`J: schema name "${name}" is not part of the slice`, () => expect(S({})(name, parse("{}"))[0]!.message).toContain("is not part of the test slice"));
  }
  it("J: properties that is not an object, required that is not a name list, a property that is not a schema", () => {
    expect(S({ P: { type: "object", properties: [] } })("P", parse("{}"))[0]!.message).toContain("properties is not an object");
    expect(S({ Q: { type: "object", required: "a" } })("Q", parse("{}"))[0]!.message).toContain("required is not a list");
    expect(S({ Z: { type: "object", properties: { a: true } } })("Z", parse('{"a":1}'))[0]!.message).toContain('property "a" is not a schema');
  });
  it("J: an unsupported keyword still fails closed", () => expect(S({ K: { type: "object", patternProperties: {} } })("K", parse("{}"))[0]!.message).toContain('unsupported schema keyword "patternProperties"'));

  it("the frozen and additive slices still resolve only their own names", () => {
    expect(validateSchema("HistoryDetail", {})[0]!.message).toContain("is not part of");
    expect(validateHistorySchema("constructor", {})[0]!.message).toContain("is not part of");
  });

  it("no validation mutates Object.prototype", () => {
    expect(Object.getOwnPropertyNames(Object.prototype).sort().join(",")).toBe(protoBefore);
    expect(({} as Record<string, unknown>).unreviewed).toBeUndefined();
  });
});
