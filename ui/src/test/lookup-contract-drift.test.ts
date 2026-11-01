/**
 * ID-addressability remediation-03 drift guard for the ADDITIVE exact-ID query contract
 * (FlowAssert-Phase3A-Service/contracts/openapi-id-addressability-v1.yaml, read-only).
 *  1. Identity: the reviewed SHA-256 and version, and its declared frozen / history contract bindings.
 *  2. Scope: exactly the two read-only GET operations, with exactly the query keys, required flags and bounds the
 *     frontend pins (src/data/contract/lookup.ts) and the gate allows (server/localApiGate.ts ROUTES).
 *  3. DTOs: the 200 bodies are the frozen VerificationRun / EvidencePage, every component schema equals the frozen
 *     contract's and the frontend's runtime copy (src/data/contract/v1.schemas.json) — so the existing validators,
 *     decoders and prototype-safe checks apply unchanged.
 *  4. Transport extension facts the frontend relies on (single decode, "&", 4096-byte cap, + is space).
 *  5. Sensitivity: deliberate incompatible edits are detected.
 * Fails (never skips) when a contract file is missing; all are the Service's pinned copies (./fixtures/sources.ts).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTES } from "../../server/localApiGate.ts";
import { PHASE3B_FLAG } from "../data/contract/phase3b";
import frozenCopy from "../data/contract/v1.schemas.json";
import { LOOKUP_BOUNDS, LOOKUP_CONTRACT_SHA256, LOOKUP_CONTRACT_VERSION, LOOKUP_PATHS, LOOKUP_QUERY } from "../data/contract/lookup";
import { lookupEvidenceUrl, lookupUrl } from "../data/local/provider";
import { CONTRACT, HISTORY_CONTRACT, LOOKUP_CONTRACT } from "./contract/fixtures";

const FROZEN_SHA256 = "0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230";
const HISTORY_SHA256 = "f341d8d5ec9da1b933b06efe998c07a1045226500a6b5837e9c8a9ead74bd69f";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;

interface Param {
  name: string;
  in: string;
  required: boolean;
  style: string;
  explode: boolean;
  allowReserved: boolean;
  schema: Record<string, unknown>;
}

/** Every incompatibility between a contract document and the frontend's pinned addressing, as readable strings. */
export function lookupDrift(doc: Doc, frozen: Doc): string[] {
  const p: string[] = [];
  if (doc.info?.version !== LOOKUP_CONTRACT_VERSION) p.push(`info.version is ${doc.info?.version}`);
  if (doc["x-frozen-contract-sha256"] !== FROZEN_SHA256) p.push("x-frozen-contract-sha256 changed");
  if (doc["x-history-contract-sha256"] !== HISTORY_SHA256) p.push("x-history-contract-sha256 changed");
  const paths = Object.keys(doc.paths ?? {}).sort();
  if (JSON.stringify(paths) !== JSON.stringify(Object.values(LOOKUP_PATHS).sort())) p.push(`paths are ${paths.join(", ")}`);
  for (const [op, path] of Object.entries(LOOKUP_PATHS) as ["detail" | "evidence", string][]) {
    const ops = doc.paths?.[path] ?? {};
    if (JSON.stringify(Object.keys(ops)) !== '["get"]') p.push(`${path}: methods ${Object.keys(ops).join(",")}`);
    const params: Param[] = ops.get?.parameters ?? [];
    const names = params.map((x) => x.name);
    if (JSON.stringify(names) !== JSON.stringify(LOOKUP_QUERY[op])) p.push(`${path}: query keys ${names.join(",")}`);
    const gate = ROUTES.find((r) => r.pattern.test(path));
    // The Phase 3B flag is additive to this frozen contract, on the Detail read only (src/data/contract/phase3b.ts).
    const gateKeys = gate?.query.filter((k) => !(op === "detail" && k === PHASE3B_FLAG.name)) ?? [];
    if (!gate || JSON.stringify([...gateKeys].sort()) !== JSON.stringify([...names].sort())) p.push(`${path}: gate query keys differ`);
    for (const x of params) {
      if (x.in !== "query" || x.style !== "form" || x.explode !== true || x.allowReserved !== false) p.push(`${path} ${x.name}: not a plain form query parameter`);
      if (x.required !== (x.name === "verification_id")) p.push(`${path} ${x.name}: required is ${x.required}`);
      const s = x.schema;
      if (x.name === "verification_id" && (s.type !== "string" || s.minLength !== LOOKUP_BOUNDS.verificationIdCodePoints.min || s.maxLength !== LOOKUP_BOUNDS.verificationIdCodePoints.max || "pattern" in s))
        p.push(`${path} verification_id schema changed`);
      if (x.name === "snapshot_id" && (s.minLength !== 1 || s.maxLength !== LOOKUP_BOUNDS.snapshotIdMax)) p.push(`${path} snapshot_id schema changed`);
      if (x.name === "cursor" && (s.type !== "string" || s.maxLength !== LOOKUP_BOUNDS.cursorMax)) p.push(`${path} cursor schema changed`);
      if (x.name === "limit" && (s.type !== "integer" || s.minimum !== LOOKUP_BOUNDS.limit.min || s.maximum !== LOOKUP_BOUNDS.limit.max || s.default !== LOOKUP_BOUNDS.limit.default)) p.push(`${path} limit schema changed`);
      if (x.name === "include_payload" && (s.type !== "boolean" || s.default !== true)) p.push(`${path} include_payload schema changed`);
    }
    const root = op === "detail" ? "VerificationRun" : "EvidencePage";
    const ok = ops.get?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref;
    if (ok !== `#/components/schemas/${root}`) p.push(`${path}: 200 body is ${ok}`);
    for (const [status, r] of Object.entries(ops.get?.responses ?? {}) as [string, Doc][])
      if (status !== "200" && r.content?.["application/json"]?.schema?.$ref !== "#/components/schemas/Error") p.push(`${path}: ${status} body is not the Error envelope`);
  }
  const a = doc.components?.schemas ?? {};
  const f = frozen.components.schemas;
  if (JSON.stringify(Object.keys(a).sort()) !== JSON.stringify(Object.keys(f).sort())) p.push("component schema names differ from the frozen contract");
  for (const [name, schema] of Object.entries(f)) if (JSON.stringify(a[name]) !== JSON.stringify(schema)) p.push(`schema ${name} differs from the frozen contract`);
  const t = doc["x-transport"] ?? {};
  if (t.decode_count !== 1) p.push("x-transport.decode_count is not 1");
  if (t.separator !== "&") p.push("x-transport.separator is not &");
  if (t.requires_equals !== true) p.push("x-transport.requires_equals is not true");
  if (t.request_target_max_bytes !== LOOKUP_BOUNDS.requestTargetMaxBytes) p.push("x-transport.request_target_max_bytes changed");
  if (!/\+ decodes to space/.test(t.query_encoding ?? "")) p.push("x-transport.query_encoding no longer form semantics");
  if (JSON.stringify(t.origins) !== JSON.stringify(["http://127.0.0.1:5183", "http://127.0.0.1:8765"])) p.push("x-transport.origins changed");
  return p;
}

describe("additive exact-ID query contract vs frontend addressing", () => {
  const raw = readFileSync(LOOKUP_CONTRACT);
  const doc = JSON.parse(raw.toString("utf8")) as Doc;
  const frozen = JSON.parse(readFileSync(CONTRACT, "utf8")) as Doc;

  it("has the reviewed digest and declares the reviewed frozen and history digests", () => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(LOOKUP_CONTRACT_SHA256);
    expect(createHash("sha256").update(readFileSync(CONTRACT)).digest("hex")).toBe(FROZEN_SHA256);
    expect(createHash("sha256").update(readFileSync(HISTORY_CONTRACT)).digest("hex")).toBe(HISTORY_SHA256);
  });

  it("finds no drift between the contract and the frontend's pinned addressing", () => expect(lookupDrift(doc, frozen)).toEqual([]));

  it("every component schema also equals the frontend's runtime frozen copy (same validators apply)", () => {
    const copy = frozenCopy.schemas as Record<string, unknown>;
    for (const [name, schema] of Object.entries(copy)) expect(doc.components.schemas[name], name).toEqual(schema);
  });

  it("the provider's targets use exactly the contract paths and keys", () => {
    const d = new URL(lookupUrl("x", "s"), "http://h");
    const e = new URL(lookupEvidenceUrl("x", { snapshotId: "s", limit: 1, includePayload: true, cursor: "c" }), "http://h");
    expect(d.pathname).toBe(LOOKUP_PATHS.detail);
    expect(e.pathname).toBe(LOOKUP_PATHS.evidence);
    expect([...d.searchParams.keys()].sort()).toEqual([...LOOKUP_QUERY.detail, PHASE3B_FLAG.name].sort());
    expect([...e.searchParams.keys()].sort()).toEqual([...LOOKUP_QUERY.evidence].sort());
  });

  const MUTATIONS: [string, (d: Doc) => void, RegExp][] = [
    ["query key renamed", (d) => (d.paths["/api/v1/verification-lookup"].get.parameters[0].name = "id"), /query keys id/],
    ["query key added", (d) => d.paths["/api/v1/verification-evidence"].get.parameters.push({ name: "page", in: "query", required: false, style: "form", explode: true, allowReserved: false, schema: { type: "string" } }), /query keys/],
    ["ID made optional", (d) => (d.paths["/api/v1/verification-lookup"].get.parameters[0].required = false), /verification_id: required is false/],
    ["ID pattern added", (d) => (d.paths["/api/v1/verification-lookup"].get.parameters[0].schema.pattern = "^[A-Z]"), /verification_id schema changed/],
    ["ID cap widened", (d) => (d.paths["/api/v1/verification-evidence"].get.parameters[0].schema.maxLength = 256), /verification_id schema changed/],
    ["cursor cap changed", (d) => (d.paths["/api/v1/verification-evidence"].get.parameters[3].schema.maxLength = 4096), /cursor schema changed/],
    ["allowReserved", (d) => (d.paths["/api/v1/verification-lookup"].get.parameters[0].allowReserved = true), /not a plain form query parameter/],
    ["write method added", (d) => (d.paths["/api/v1/verification-lookup"].post = {}), /methods get,post/],
    ["path added", (d) => (d.paths["/api/v1/verification-lookup/{id}"] = { get: {} }), /paths are/],
    ["200 retargeted", (d) => (d.paths["/api/v1/verification-lookup"].get.responses["200"].content["application/json"].schema.$ref = "#/components/schemas/RunSummary"), /200 body is/],
    ["frozen schema edited", (d) => (d.components.schemas.State.enum = ["Verified", "Mismatch", "Pending"]), /schema State differs/],
    ["new wrapper schema", (d) => (d.components.schemas.LookupEnvelope = { type: "object" }), /component schema names differ/],
    ["double decode", (d) => (d["x-transport"].decode_count = 2), /decode_count/],
    ["cap changed", (d) => (d["x-transport"].request_target_max_bytes = 8192), /request_target_max_bytes/],
    ["version bumped", (d) => (d.info.version = "phase3a-id-addressability-2.0.0"), /info.version/],
  ];
  for (const [what, mutate, expected] of MUTATIONS)
    it(`detects: ${what}`, () => {
      const copy = JSON.parse(raw.toString("utf8")) as Doc;
      mutate(copy);
      const drift = lookupDrift(copy, frozen);
      expect(drift.some((x) => expected.test(x)), drift.join(" | ")).toBe(true);
    });
});
