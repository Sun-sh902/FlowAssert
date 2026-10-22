/**
 * Sensitivity of the contract drift guard (UIA-003).
 *
 * Each case applies one deliberate, incompatible change to an in-memory copy of the reviewed
 * contract — or to an in-memory copy of the mirror source — and requires the guard to report it.
 * Neither real file is written. Expectations name the category of difference the change must
 * produce, so a guard that fails for an unrelated reason does not count as a detection.
 *
 * The independent audit's own 12 mutant files are also replayed when that read-only review folder
 * is present (FLOWASSERT_DRIFT_MUTANTS overrides the location).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BINDING, CONTRACT, MIRROR_SOURCE } from "./contract/fixtures";
import { checkContract, type OpenApiDoc } from "./contract/guard";

const present = existsSync(CONTRACT);
const AUDIT_MUTANTS = process.env.FLOWASSERT_DRIFT_MUTANTS ?? "/Users/zhangshenghe/Documents/FlowAssert-UI-Review/evidence/contract/mutants";

type Doc = OpenApiDoc & { components: { schemas: Record<string, any> }; paths: Record<string, any> };
const original = present ? readFileSync(CONTRACT, "utf8") : "{}";
const fresh = () => JSON.parse(original) as Doc;
const S = (d: Doc) => d.components.schemas;
const params = (d: Doc, path: string) => d.paths[path].get.parameters as { name: string; in: string; required?: boolean; schema: any }[];
const DETAIL = "/api/v1/verifications/{id}";
const EVIDENCE = "/api/v1/verifications/{id}/evidence";

interface ContractMutation {
  id: string;
  category: string;
  mutate: (d: Doc) => void;
  /** Every one of these must appear in at least one reported difference. */
  expect: RegExp[];
}

const CONTRACT_MUTATIONS: ContractMutation[] = [
  { id: "C01", category: "enum value removed", mutate: (d) => (S(d).DestinationObservation.properties.access.enum = ["ok", "denied", "unknown"]), expect: [/DestinationObservation\.access: enum value "timeout" in mirror, not in contract/] },
  { id: "C02", category: "enum value added", mutate: (d) => S(d).EvidenceReference.properties.availability.enum.push("archived"), expect: [/EvidenceReference\.availability: enum value "archived" in contract/] },
  { id: "C03", category: "nullability removed", mutate: (d) => (S(d).Workflow.properties.n8n_label.type = "string"), expect: [/Workflow\.n8n_label: nullability/] },
  { id: "C04", category: "nullability added", mutate: (d) => (S(d).Identity.properties.created_at.type = ["string", "null"]), expect: [/Identity\.created_at: nullability/] },
  { id: "C05", category: "field type changed", mutate: (d) => (S(d).Page.properties.total.type = ["string", "null"]), expect: [/Page\.total: union member string in contract/] },
  { id: "C06", category: "field type changed (scalar → array)", mutate: (d) => (S(d).Assurance.properties.release_approval_reference = { type: "array", items: { type: "string" } }), expect: [/Assurance\.release_approval_reference: type/] },
  { id: "C07", category: "scalar schema enum extended", mutate: (d) => S(d).State.enum.push("Unknown"), expect: [/^State: enum value "Unknown" in contract/] },
  { id: "C08", category: "scalar schema nullability removed", mutate: (d) => (S(d).Timestamp.type = "string"), expect: [/^Timestamp: nullability/] },
  { id: "C09", category: "scalar schema type changed", mutate: (d) => (S(d).Digest.type = "integer"), expect: [/^Digest: type/] },
  { id: "C10", category: "Counts key removed", mutate: (d) => { delete S(d).Counts.properties.Pending; S(d).Counts.required = S(d).Counts.required.filter((k: string) => k !== "Pending"); }, expect: [/Counts\.Pending: property in mirror, not in contract/] },
  { id: "C11", category: "nested required removed", mutate: (d) => (S(d).Error.properties.error.required = S(d).Error.properties.error.required.filter((k: string) => k !== "request_id")), expect: [/Error\.error\.request_id: required — mirror required, contract optional/] },
  { id: "C12", category: "nested inline object type changed", mutate: (d) => (S(d).Error.properties.error.properties.details.items.properties.path.type = "integer"), expect: [/Error\.error\.details\[\]\.path: type/] },
  { id: "C13", category: "nested inline object closed → open", mutate: (d) => delete S(d).Error.properties.error.properties.details.items.additionalProperties, expect: [/Error\.error\.details\[\]: additionalProperties/] },
  { id: "C14", category: "$ref retargeted (object schema)", mutate: (d) => (S(d).VerificationRun.properties.retry_context.$ref = "#/components/schemas/PolicyContext"), expect: [/VerificationRun\.retry_context: \$ref target — mirror RetryContext, contract PolicyContext/] },
  { id: "C15", category: "$ref retargeted (scalar, different shape)", mutate: (d) => (S(d).ResearchResult.properties.cohort_state.$ref = "#/components/schemas/RuleStatus"), expect: [/ResearchResult\.cohort_state: \$ref target — mirror State, contract RuleStatus/] },
  { id: "C16", category: "$ref retargeted (scalar, same shape)", mutate: (d) => (S(d).ResearchResult.properties.observed_at.$ref = "#/components/schemas/RawJSON"), expect: [/ResearchResult\.observed_at: \$ref target — mirror RawTick, contract RawJSON/] },
  { id: "C17", category: "$ref replaced by inline type", mutate: (d) => (S(d).RecordResult.properties.rules = { type: "object", additionalProperties: false, properties: {} }), expect: [/RecordResult\.rules: type/] },
  { id: "C18", category: "const changed", mutate: (d) => (S(d).Meta.properties.contract_version.const = "0.2.0-proposed"), expect: [/Meta\.contract_version: const/] },
  { id: "C19", category: "const removed", mutate: (d) => delete S(d).RetryContext.properties.automatic_retry_enabled.const, expect: [/RetryContext\.automatic_retry_enabled: type — mirror false, contract boolean/] },
  { id: "C20", category: "required key removed", mutate: (d) => (S(d).Workflow.required = S(d).Workflow.required.filter((k: string) => k !== "name")), expect: [/Workflow\.name: required — mirror required, contract optional/] },
  { id: "C21", category: "optional key made required", mutate: (d) => S(d).RuleResult.required.push("expected"), expect: [/RuleResult\.expected: required — mirror optional, contract required/] },
  { id: "C22", category: "property added", mutate: (d) => { S(d).Meta.properties.region = { type: "string" }; S(d).Meta.required.push("region"); }, expect: [/Meta\.region: property in contract, not in mirror/] },
  { id: "C23", category: "property removed", mutate: (d) => { delete S(d).Diagnostic.properties.message; S(d).Diagnostic.required = ["path", "code"]; }, expect: [/Diagnostic\.message: property in mirror, not in contract/] },
  { id: "C24", category: "array item type changed", mutate: (d) => (S(d).RecordResult.properties.candidate_ids.items = { type: "integer" }), expect: [/RecordResult\.candidate_ids\[\]: type/] },
  { id: "C25", category: "array item $ref retargeted", mutate: (d) => (S(d).EvidencePage.properties.items.items.$ref = "#/components/schemas/EvidenceReference"), expect: [/EvidencePage\.items\[\]: \$ref target — mirror EvidenceItem, contract EvidenceReference/] },
  { id: "C26", category: "array → scalar", mutate: (d) => (S(d).Assurance.properties.limitations = { type: "string" }), expect: [/Assurance\.limitations: type/] },
  { id: "C27", category: "additionalProperties relaxed", mutate: (d) => (S(d).EvidenceItem.additionalProperties = true), expect: [/EvidenceItem: additionalProperties — mirror is closed, contract is open/] },
  { id: "C28", category: "referenced schema deleted", mutate: (d) => delete S(d).PremiseEvidence, expect: [/dangling \$ref PremiseEvidence/, /PremiseEvidence: mirrored \(PremiseEvidenceDTO\), but absent from the contract/] },
  { id: "C29", category: "new referenced schema", mutate: (d) => { S(d).Provenance = { type: "object", properties: { channel: { type: "string" } }, required: ["channel"], additionalProperties: false }; S(d).VerificationRun.properties.provenance = { $ref: "#/components/schemas/Provenance" }; S(d).VerificationRun.required.push("provenance"); }, expect: [/Provenance: schema in scope of the contract, not mirrored/, /VerificationRun\.provenance: property in contract/] },
  { id: "C30", category: "unsupported composition keyword", mutate: (d) => (S(d).Page.properties.total = { oneOf: [{ type: "integer" }, { type: "null" }] }), expect: [/Page\.total: unsupported JSON Schema keyword "oneOf"/] },
  { id: "C31", category: "contract version changed", mutate: (d) => (d.info.version = "0.2.0-proposed"), expect: [/info\.version/] },
  { id: "C32", category: "query parameter renamed", mutate: (d) => (params(d, EVIDENCE).find((p) => p.name === "include_payload")!.name = "include_payloads"), expect: [/include_payload: property in mirror, not in contract/, /include_payloads: property in contract, not in mirror/] },
  { id: "C33", category: "query parameter made required", mutate: (d) => (params(d, DETAIL).find((p) => p.name === "snapshot_id")!.required = true), expect: [/query \(DetailQueryDTO\)\.snapshot_id: required — mirror optional, contract required/] },
  { id: "C34", category: "query parameter type changed", mutate: (d) => (params(d, EVIDENCE).find((p) => p.name === "limit")!.schema = { type: "string" }), expect: [/query \(EvidenceQueryDTO\)\.limit: type/] },
  { id: "C35", category: "query parameter added", mutate: (d) => params(d, EVIDENCE).push({ name: "role", in: "query", required: false, schema: { type: "string" } }), expect: [/query \(EvidenceQueryDTO\)\.role: property in contract, not in mirror/] },
  { id: "C36", category: "query parameter removed", mutate: (d) => (d.paths[EVIDENCE].get.parameters = params(d, EVIDENCE).filter((p) => p.name !== "cursor")), expect: [/query \(EvidenceQueryDTO\)\.cursor: property in mirror, not in contract/] },
  { id: "C37", category: "query parameter enum introduced", mutate: (d) => (params(d, EVIDENCE).find((p) => p.name === "cursor")!.schema = { type: "string", enum: ["first", "next"] }), expect: [/query \(EvidenceQueryDTO\)\.cursor: type/] },
  { id: "C38", category: "path parameter renamed", mutate: (d) => (params(d, DETAIL).find((p) => p.in === "path")!.name = "run_id"), expect: [/GET \/api\/v1\/verifications\/\{id\}: path parameters — template \{id\}, contract run_id/] },
  { id: "C39", category: "header parameter added", mutate: (d) => params(d, DETAIL).push({ name: "X-Workspace", in: "header", required: true, schema: { type: "string" } }), expect: [/header parameter X-Workspace is not mirrored/] },
  { id: "C40", category: "200 response retargeted", mutate: (d) => (d.paths[EVIDENCE].get.responses["200"].content["application/json"].schema.$ref = "#/components/schemas/VerificationRun"), expect: [/evidence 200: body — mirror EvidencePage/] },
  { id: "C41", category: "error response no longer the Error envelope", mutate: (d) => (d.paths[DETAIL].get.responses["409"].content["application/json"].schema = { type: "object" }), expect: [/\{id\} 409: body is not the Error envelope/] },
  { id: "C42", category: "endpoint removed", mutate: (d) => delete d.paths[EVIDENCE], expect: [/GET \/api\/v1\/verifications\/\{id\}\/evidence: path not in contract/] },
];

interface MirrorMutation {
  id: string;
  category: string;
  from: string;
  to: string;
  expect: RegExp[];
}

/** Drift on the other side: the mirror changes and the contract does not. */
const MIRROR_MUTATIONS: MirrorMutation[] = [
  { id: "M01", category: "nullability dropped in mirror", from: "  n8n_label: string | null;", to: "  n8n_label: string;", expect: [/Workflow\.n8n_label: nullability/] },
  { id: "M02", category: "enum value dropped in mirror", from: 'access: "ok" | "denied" | "timeout" | "unknown";', to: 'access: "ok" | "denied" | "unknown";', expect: [/DestinationObservation\.access: enum value "timeout" in contract, not in mirror/] },
  { id: "M03", category: "optional field made required in mirror", from: "  expected?: string;", to: "  expected: string;", expect: [/RuleResult\.expected: required/] },
  { id: "M04", category: "$ref retargeted in mirror", from: "  cohort_state: StateDTO;", to: "  cohort_state: RuleStatusDTO;", expect: [/ResearchResult\.cohort_state: \$ref target — mirror RuleStatus, contract State/] },
  { id: "M05", category: "const changed in mirror", from: '  automatic_retry_enabled: false;', to: "  automatic_retry_enabled: boolean;", expect: [/RetryContext\.automatic_retry_enabled: type — mirror boolean, contract false/] },
  { id: "M06", category: "array item type changed in mirror", from: "  pending_source_rows: number[];", to: "  pending_source_rows: string[];", expect: [/RetryContext\.pending_source_rows\[\]: type/] },
  { id: "M07", category: "nested inline field removed in mirror", from: "    retryable: boolean;\n    details", to: "    details", expect: [/Error\.error\.retryable: property in contract, not in mirror/] },
  { id: "M08", category: "query parameter type changed in mirror", from: "  include_payload?: boolean;", to: "  include_payload?: string;", expect: [/query \(EvidenceQueryDTO\)\.include_payload: type/] },
  { id: "M09", category: "query parameter dropped in mirror", from: "  cursor?: string;\n", to: "", expect: [/query \(EvidenceQueryDTO\)\.cursor: property in contract, not in mirror/] },
  { id: "M10", category: "scalar schema widened in mirror", from: 'export type StateDTO = "Verified" | "Mismatch" | "Pending" | "Unverified";', to: 'export type StateDTO = "Verified" | "Mismatch" | "Pending" | "Unverified" | "Unknown";', expect: [/^State: enum value "Unknown" in mirror/] },
  { id: "M11", category: "unsupported TypeScript form in mirror", from: "export interface DiagnosticDTO {", to: "export interface DiagnosticDTO extends Record<string, unknown> {", expect: [/unsupported interface form/] },
];

describe.skipIf(!present)("drift guard sensitivity — contract mutations", () => {
  it("reports nothing for the unmodified contract (control)", () => {
    expect(checkContract(fresh(), MIRROR_SOURCE, BINDING).diffs).toEqual([]);
  });

  for (const m of CONTRACT_MUTATIONS) {
    it(`${m.id} ${m.category}`, () => {
      const d = fresh();
      m.mutate(d);
      expect(JSON.stringify(d), "the mutation changed the document").not.toBe(JSON.stringify(fresh()));
      const { diffs } = checkContract(d, MIRROR_SOURCE, BINDING);
      for (const re of m.expect) expect(diffs.some((x) => re.test(x)), `${re} not in:\n${diffs.join("\n")}`).toBe(true);
    });
  }

  it("never touched the real contract file", () => {
    expect(readFileSync(CONTRACT, "utf8")).toBe(original);
  });
});

describe.skipIf(!present)("drift guard sensitivity — mirror mutations", () => {
  for (const m of MIRROR_MUTATIONS) {
    it(`${m.id} ${m.category}`, () => {
      expect(MIRROR_SOURCE.split(m.from).length - 1, `"${m.from}" must occur exactly once in v1.ts`).toBe(1);
      const { diffs } = checkContract(fresh(), MIRROR_SOURCE.replace(m.from, m.to), BINDING);
      for (const re of m.expect) expect(diffs.some((x) => re.test(x)), `${re} not in:\n${diffs.join("\n")}`).toBe(true);
    });
  }
});

/**
 * Keywords combined on one schema (independent reassessment R-01). A schema's keywords all apply at
 * once: a `$ref` with siblings is narrowed by them, and an enum or const is limited by `type`. The
 * guard must not judge a schema by one keyword and drop the rest — in response bodies as anywhere else.
 * Expectations follow from JSON Schema 2020-12 semantics, not from the guard's output.
 */
const BODY = (d: Doc, path: string, status: string) => d.paths[path].get.responses[status].content["application/json"];
const COMBINED_MUTATIONS: ContractMutation[] = [
  { id: "K01", category: "200 body $ref narrowed by sibling properties (enum)", mutate: (d) => (BODY(d, DETAIL, "200").schema.properties = { snapshot_id: { type: "string", enum: ["snapshot-a"] } }), expect: [/\{id\} 200: \$ref with sibling keywords \(properties\)/] },
  { id: "K02", category: "200 body $ref narrowed by sibling type", mutate: (d) => (BODY(d, EVIDENCE, "200").schema.type = "array"), expect: [/evidence 200: \$ref with sibling keywords \(type\)/] },
  { id: "K03", category: "200 body $ref narrowed by sibling required", mutate: (d) => (BODY(d, EVIDENCE, "200").schema.required = ["next_cursor"]), expect: [/evidence 200: \$ref with sibling keywords \(required\)/] },
  { id: "K04", category: "error body $ref narrowed by sibling properties", mutate: (d) => (BODY(d, DETAIL, "404").schema.properties = { error: { type: "object", properties: { code: { const: "NOT_FOUND" } } } }), expect: [/\{id\} 404: \$ref with sibling keywords \(properties\)/] },
  { id: "K05", category: "property $ref narrowed by sibling enum", mutate: (d) => (S(d).ResearchResult.properties.cohort_state.enum = ["Verified"]), expect: [/ResearchResult\.cohort_state: \$ref with sibling keywords \(enum\)/] },
  { id: "K06", category: "scalar schema type excludes every enum value", mutate: (d) => (S(d).State.type = "number"), expect: [/^State: no value satisfies/, /^State: enum value "Verified" in mirror, not in contract/] },
  { id: "K07", category: "enum value outside the declared type", mutate: (d) => S(d).Meta.properties.provider_mode.enum.push(null), expect: [/Meta\.provider_mode: enum value null is not of type string/] },
  { id: "K08", category: "nullable type and null enum value add nullability", mutate: (d) => { const p = S(d).Meta.properties.provider_mode; p.type = ["string", "null"]; p.enum.push(null); }, expect: [/Meta\.provider_mode: nullability null in contract, not in mirror/] },
  { id: "K09", category: "const outside the declared type", mutate: (d) => (S(d).RetryContext.properties.automatic_retry_enabled.type = "string"), expect: [/RetryContext\.automatic_retry_enabled: const false is not of type string/, /RetryContext\.automatic_retry_enabled: type/] },
  { id: "K10", category: "const outside the enum", mutate: (d) => (S(d).Meta.properties.api_version.enum = ["v2"]), expect: [/Meta\.api_version: const "v1" is not in enum/] },
  { id: "K11", category: "enum narrowed by integer type", mutate: (d) => (S(d).Meta.properties.provider_mode = { type: "integer", enum: [1, 1.5] }), expect: [/Meta\.provider_mode: enum value 1\.5 is not of type integer/, /Meta\.provider_mode: type/] },
  { id: "K12", category: "unmirrored success status", mutate: (d) => (d.paths[EVIDENCE].get.responses["206"] = structuredClone(d.paths[EVIDENCE].get.responses["200"])), expect: [/evidence 206: response is not mirrored/] },
  { id: "K13", category: "default response", mutate: (d) => (d.paths[DETAIL].get.responses.default = structuredClone(d.paths[DETAIL].get.responses["500"])), expect: [/\{id\} default: response is not mirrored/] },
  { id: "K14", category: "non-JSON media type on the 200 body", mutate: (d) => (d.paths[DETAIL].get.responses["200"].content["application/xml"] = { schema: { type: "string" } }), expect: [/\{id\} 200: media type application\/xml is not mirrored/] },
];

describe.skipIf(!present)("drift guard sensitivity — combined keywords and response bodies", () => {
  for (const m of COMBINED_MUTATIONS) {
    it(`${m.id} ${m.category}`, () => {
      const d = fresh();
      m.mutate(d);
      expect(JSON.stringify(d), "the mutation changed the document").not.toBe(JSON.stringify(fresh()));
      const { diffs } = checkContract(d, MIRROR_SOURCE, BINDING);
      for (const re of m.expect) expect(diffs.some((x) => re.test(x)), `${re} not in:\n${diffs.join("\n")}`).toBe(true);
    });
  }

  // Equivalent rewrites of supported forms: same permitted values, so no difference may be reported.
  const equivalent: [string, (d: Doc) => void][] = [
    ["annotation beside a response $ref", (d) => (BODY(d, DETAIL, "200").schema.description = "independent annotation")],
    ["nullable type with an enum that omits null (null still excluded)", (d) => (S(d).Meta.properties.provider_mode.type = ["string", "null"])],
    ["const repeated in an enum", (d) => (S(d).Meta.properties.api_version.enum = ["v1"])],
    ["enum without type", (d) => delete S(d).EvidenceReference.properties.role.type],
    ["type list in another order", (d) => (S(d).Timestamp.type = [...S(d).Timestamp.type].reverse())],
  ];
  for (const [what, mutate] of equivalent)
    it(`reports nothing for an equivalent rewrite: ${what}`, () => {
      const d = fresh();
      mutate(d);
      expect(JSON.stringify(d), "the rewrite changed the document").not.toBe(JSON.stringify(fresh()));
      expect(checkContract(d, MIRROR_SOURCE, BINDING).diffs).toEqual([]);
    });
});

describe.skipIf(!present)("drift guard scope — value constraints are outside the TypeScript mirror", () => {
  // Stated, not hidden: these keywords cannot be expressed in v1.ts. The Phase 2 decoder must enforce them.
  const outOfScope: [string, (d: Doc) => void][] = [
    ["pattern", (d) => (S(d).Digest.pattern = "^[a-f0-9]{40}$")],
    ["minimum", (d) => (S(d).Page.properties.total.minimum = 1)],
    ["maxItems", (d) => (S(d).EvidencePage.properties.items.maxItems = 10)],
    ["integer → number", (d) => (S(d).RecordResult.properties.source_row.type = "number")],
    ["query default", (d) => (params(d, EVIDENCE).find((p) => p.name === "limit")!.schema.default = 50)],
  ];
  for (const [what, mutate] of outOfScope)
    it(`does not claim to detect a ${what} change`, () => {
      const d = fresh();
      mutate(d);
      expect(checkContract(d, MIRROR_SOURCE, BINDING).diffs).toEqual([]);
    });
});

const auditMutants = existsSync(AUDIT_MUTANTS) ? readdirSync(AUDIT_MUTANTS).filter((f) => f.endsWith(".json")).sort() : [];

describe.skipIf(!auditMutants.length)("drift guard sensitivity — independent audit mutants (read-only replay)", () => {
  it("finds the audit's 12 mutants", () => {
    expect(auditMutants).toHaveLength(12);
  });
  for (const f of auditMutants)
    it(`detects ${f.replace(/\.json$/, "")}`, () => {
      const d = JSON.parse(readFileSync(join(AUDIT_MUTANTS, f), "utf8")) as Doc;
      expect(checkContract(d, MIRROR_SOURCE, BINDING).diffs.length).toBeGreaterThan(0);
    });
});
