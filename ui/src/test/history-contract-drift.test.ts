/**
 * Phase 3A drift guard for the ADDITIVE history contract (FlowAssert-Phase3A-Service/contracts/openapi-history-v1.yaml).
 *
 *  1. The additive contract still has the reviewed digest, declares the reviewed frozen digest, and every
 *     schema it shares with the frozen Phase 0 contract is exactly that frozen schema (additive only).
 *  2. The runtime copy (src/data/contract/history.schemas.json) equals the additive schemas object for
 *     object, and is exactly the $ref closure of the three history 200 bodies and the Error envelope.
 *  3. The wire mirror (src/data/contract/history.ts, which imports the shared DTOs from the unchanged
 *     frozen mirror v1.ts) is compared with the existing shape guard (./contract/guard.ts): types,
 *     nullability, enums, consts, $ref targets, closed objects, path/query parameters, response bindings.
 *     The frozen mirror's three evidence-page declarations and two frozen query declarations are outside
 *     the additive endpoints; exactly those five, by name, are the only differences allowed.
 * Skipped (never passed) when the read-only contract files are absent.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import copy from "../data/contract/history.schemas.json";
import frozenCopy from "../data/contract/v1.schemas.json";
import { HISTORY_CONTRACT_SHA256, HISTORY_CONTRACT_VERSION, HISTORY_PATHS } from "../data/contract/history";
import historySource from "../data/contract/history.ts?raw";
import { CONTRACT, MIRROR_SOURCE } from "./contract/fixtures";
import { checkContract, type Binding, type OpenApiDoc } from "./contract/guard";

export const HISTORY_CONTRACT = process.env.FLOWASSERT_HISTORY_OPENAPI ?? "/Users/zhangshenghe/Documents/FlowAssert-Phase3A-Service/contracts/openapi-history-v1.yaml";
const FROZEN_SHA256 = "0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230";
const present = existsSync(HISTORY_CONTRACT) && existsSync(CONTRACT);

type Doc = OpenApiDoc & { "x-frozen-contract-sha256": string; components: { schemas: Record<string, unknown> } };

const BINDING: Binding = {
  version: HISTORY_CONTRACT_VERSION,
  paths: HISTORY_PATHS,
  roots: { list: "HistoryList", detail: "HistoryDetail", evidence: "HistoryEvidencePage" },
  queries: { list: "HistoryListQueryDTO", detail: "HistoryDetailQueryDTO", evidence: "HistoryEvidenceQueryDTO" },
  error: "Error",
};

/** The only differences permitted: frozen-mirror declarations that belong to the frozen evidence endpoint, not to history. */
const OUTSIDE_ADDITIVE_SCOPE = [
  "DetailQuery: mirrored (DetailQueryDTO), but absent from the contract",
  "EvidenceItem: mirrored, but not reachable from the Phase 1 endpoints in the contract",
  "EvidencePage: mirrored, but not reachable from the Phase 1 endpoints in the contract",
  "EvidenceQuery: mirrored (EvidenceQueryDTO), but absent from the contract",
  "Page: mirrored, but not reachable from the Phase 1 endpoints in the contract",
];

describe.skipIf(!present)("additive history contract vs frozen contract and runtime copy", () => {
  const raw = present ? readFileSync(HISTORY_CONTRACT) : Buffer.from("");
  const doc = present ? (JSON.parse(raw.toString("utf8")) as Doc) : null;
  const frozen = present ? (JSON.parse(readFileSync(CONTRACT, "utf8")) as Doc) : null;

  it("has the reviewed digest, version and frozen-contract binding, and the copy records them", () => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(HISTORY_CONTRACT_SHA256);
    expect(doc!.info.version).toBe(HISTORY_CONTRACT_VERSION);
    expect(doc!["x-frozen-contract-sha256"]).toBe(FROZEN_SHA256);
    expect(createHash("sha256").update(readFileSync(CONTRACT)).digest("hex")).toBe(FROZEN_SHA256);
    expect(copy.source_sha256).toBe(HISTORY_CONTRACT_SHA256);
    expect(copy.contract_version).toBe(HISTORY_CONTRACT_VERSION);
    expect(copy.frozen_contract_sha256).toBe(FROZEN_SHA256);
  });

  it("is additive: every frozen schema is present unchanged, and only History* schemas are new", () => {
    const f = frozen!.components.schemas;
    const a = doc!.components.schemas;
    for (const [name, schema] of Object.entries(f)) expect(a[name], name).toEqual(schema);
    expect(Object.keys(a).filter((n) => !(n in f)).sort()).toEqual(
      ["HistoryDetail", "HistoryEvidencePage", "HistoryIntegrity", "HistoryItem", "HistoryList", "HistoryPage", "HistoryProvenance", "HistoryResultSummary", "HistorySummary"].sort(),
    );
  });

  it("declares exactly the three read-only GET operations and no write method", () => {
    expect(Object.keys(doc!.paths).sort()).toEqual(Object.values(HISTORY_PATHS).sort());
    for (const ops of Object.values(doc!.paths)) expect(Object.keys(ops)).toEqual(["get"]);
  });

  it("every copied schema equals the additive schema exactly", () => {
    for (const [name, schema] of Object.entries(copy.schemas)) expect(schema, name).toEqual(doc!.components.schemas[name]);
  });

  it("copies exactly the $ref closure of HistoryList, HistoryDetail, HistoryEvidencePage and Error", () => {
    const seen = new Set<string>();
    const todo = ["HistoryList", "HistoryDetail", "HistoryEvidencePage", "Error"];
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (x && typeof x === "object")
        for (const [k, v] of Object.entries(x)) {
          if (k === "$ref" && typeof v === "string") todo.push(v.split("/").pop()!);
          else walk(v);
        }
    };
    while (todo.length) {
      const n = todo.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      walk(doc!.components.schemas[n]);
    }
    expect(Object.keys(copy.schemas).sort()).toEqual([...seen].sort());
    expect(seen.size).toBe(39);
  });

  it("shared schemas in the history copy are identical to the frozen runtime copy", () => {
    const frozenSchemas = frozenCopy.schemas as Record<string, unknown>;
    for (const [name, schema] of Object.entries(copy.schemas)) if (name in frozenSchemas) expect(schema, name).toEqual(frozenSchemas[name]);
  });
});

describe.skipIf(!present)("history wire mirror vs additive OpenAPI — shapes, scope and endpoints", () => {
  const doc = present ? (JSON.parse(readFileSync(HISTORY_CONTRACT, "utf8")) as OpenApiDoc) : null;
  // The history mirror imports the shared DTOs from the frozen mirror; the guard reads both sources as one.
  const report = present ? checkContract(doc!, `${MIRROR_SOURCE}\n${historySource}`, BINDING) : null;

  it("finds no difference within the additive scope; only the five named frozen evidence declarations fall outside it", () => {
    expect(report!.diffs.sort()).toEqual([...OUTSIDE_ADDITIVE_SCOPE].sort());
  });

  it("compares every schema reachable from the three history endpoints and the Error envelope", () => {
    expect(report!.compared.filter((n) => report!.inScope.includes(n))).toEqual(report!.inScope);
    expect(report!.inScope).toHaveLength(39);
    for (const s of ["HistoryIntegrity", "HistoryProvenance", "HistoryResultSummary", "HistorySummary", "HistoryDetail", "HistoryItem", "HistoryPage", "HistoryList", "HistoryEvidencePage", "VerificationRun", "EvidenceReference"])
      expect(report!.compared).toContain(s);
  });
});

/* ---------- Sensitivity: the guard detects deliberate incompatible changes ---------- */

describe.skipIf(!present)("history drift guard sensitivity", () => {
  const original = present ? readFileSync(HISTORY_CONTRACT, "utf8") : "{}";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type D = OpenApiDoc & { components: { schemas: Record<string, any> }; paths: Record<string, any> };
  const fresh = () => JSON.parse(original) as D;
  const S = (d: D) => d.components.schemas;
  const MUTATIONS: [string, (d: D) => void, RegExp][] = [
    ["integrity status enum extended", (d) => S(d).HistoryIntegrity.properties.status.enum.push("INTEGRITY_SKIPPED"), /HistoryIntegrity\.status: enum value "INTEGRITY_SKIPPED" in contract/],
    ["checked digest made non-nullable", (d) => (S(d).HistoryIntegrity.properties.checked_sha256.type = "string"), /HistoryIntegrity\.checked_sha256: nullability/],
    ["expected total made non-nullable", (d) => (S(d).HistoryResultSummary.properties.expected_total.type = "integer"), /HistoryResultSummary\.expected_total: nullability/],
    ["summary property added", (d) => ((S(d).HistorySummary.properties.region = { type: "string" }), S(d).HistorySummary.required.push("region")), /HistorySummary\.region: property in contract, not in mirror/],
    ["detail run retargeted", (d) => (S(d).HistoryDetail.properties.run.$ref = "#/components/schemas/RunSummary"), /HistoryDetail\.run: \$ref target/],
    ["provenance const changed", (d) => (S(d).HistoryProvenance.properties.acquisition_authenticity.const = "authenticated"), /HistoryProvenance\.acquisition_authenticity: const/],
    ["page total made nullable", (d) => (S(d).HistoryPage.properties.total.type = ["integer", "null"]), /HistoryPage\.total: nullability/],
    ["list query parameter added", (d) => d.paths["/api/v1/history"].get.parameters.push({ name: "sort", in: "query", schema: { type: "string" } }), /GET \/api\/v1\/history query \(HistoryListQueryDTO\)\.sort: property in contract/],
    ["evidence item required key dropped", (d) => (S(d).HistoryItem.required = S(d).HistoryItem.required.filter((k: string) => k !== "integrity")), /HistoryItem\.integrity: required — mirror required, contract optional/],
    ["path renamed", (d) => ((d.paths["/api/v1/archive"] = d.paths["/api/v1/history"]), delete d.paths["/api/v1/history"]), /GET \/api\/v1\/history: path not in contract/],
  ];
  for (const [name, mutate, expected] of MUTATIONS)
    it(`reports: ${name}`, () => {
      const d = fresh();
      mutate(d);
      const r = checkContract(d, `${MIRROR_SOURCE}\n${historySource}`, BINDING);
      expect(r.diffs.some((x) => expected.test(x)), r.diffs.join("\n")).toBe(true);
    });
  it("reports a field removed from the history mirror", () => {
    const r = checkContract(fresh(), `${MIRROR_SOURCE}\n${historySource.replace("  archive_created_at: string;\n", "")}`, BINDING);
    expect(r.diffs.some((x) => /HistorySummary\.archive_created_at: property in contract, not in mirror/.test(x)), r.diffs.join("\n")).toBe(true);
  });
});
