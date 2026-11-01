/**
 * Admission of LOCAL_RESEARCH response bodies: frozen-schema validation, then the F004 cross-field
 * invariants the handoff requires (FROZEN_API_HANDOFF.md "Errors and runtime validation";
 * CLAUDE_INTEGRATION_HANDOFF.md "Admission and mapping").
 *
 * A body that fails any check is refused as a whole. Nothing is repaired, defaulted or re-derived:
 * these checks compare values the service returned with each other and with the accepted scope.
 * None of them computes a verdict — cohort and record states are only ever copied.
 */
import type { Phase3BFieldsDTO, WithPhase3B } from "../contract/phase3b";
import type { CountsDTO, ErrorDTO, EvidencePageDTO, ResearchResultDTO, VerificationRunDTO } from "../contract/v1";
import { ACCEPTED_EVALUATOR, LOCAL_SCOPE } from "./config";
import { phase3bProblems, phase3bSplit } from "./phase3b";
import { stableJson, validateSchema } from "./schema";

export type Decoded<T> = { ok: true; value: T } | { ok: false; code: string; problems: string[] };

const refuse = <T>(code: string, problems: string[]): Decoded<T> => ({ ok: false, code, problems });

function schemaOrRefuse<T>(name: string, json: unknown): Decoded<T> | null {
  const errors = validateSchema(name, json);
  return errors.length ? refuse<T>("schema_invalid", errors.map((e) => `${name}${e.path === "$" ? "" : e.path}: ${e.message}`)) : null;
}

function scopeProblems(meta: VerificationRunDTO["meta"]): string[] {
  const p: string[] = [];
  if (meta.provider_mode !== LOCAL_SCOPE.providerMode) p.push(`meta.provider_mode is ${meta.provider_mode}, not ${LOCAL_SCOPE.providerMode}`);
  if (meta.workspace_id !== LOCAL_SCOPE.workspaceId) p.push(`meta.workspace_id is ${meta.workspace_id}, not ${LOCAL_SCOPE.workspaceId}`);
  if (meta.synthetic !== LOCAL_SCOPE.synthetic) p.push("meta.synthetic is not true");
  return p;
}

const TIME_FIELDS = ["business_obligation_at", "observed_at", "evaluation_at", "deadline"] as const;

/**
 * The event instants the response must carry for its own raw ticks and declared mapping. A display
 * projection only — the same arithmetic the contract defines — so a contradiction is detectable.
 * A tick that is missing or not a safe integer has no instant (and must carry a diagnostic).
 */
export function expectedEventTimes(result: ResearchResultDTO, mapping: VerificationRunDTO["evaluation_context"]["time_mapping"]) {
  const out: Record<(typeof TIME_FIELDS)[number], number | null> = { business_obligation_at: null, observed_at: null, evaluation_at: null, deadline: null };
  const diagnostics: { path: string; code: string }[] = [];
  const origin = mapping.kind === "synthetic_affine_v1" && mapping.origin_iso !== null ? Date.parse(mapping.origin_iso) : null;
  for (const f of TIME_FIELDS) {
    const tick = result[f];
    const valid = typeof tick === "number" && Number.isSafeInteger(tick);
    if (!valid) diagnostics.push({ path: `result.${f}`, code: tick === null ? "missing_time_tick" : "invalid_time_tick" });
    else if (origin !== null && mapping.seconds_per_tick !== null) out[f] = origin + tick * mapping.seconds_per_tick * 1000;
  }
  if (mapping.kind === "unmapped") diagnostics.push({ path: "evaluation_context.time_mapping", code: "time_mapping_unavailable" });
  return { instants: out, diagnostics };
}

function tally(states: { state: keyof CountsDTO }[]): CountsDTO {
  const c: CountsDTO = { Verified: 0, Mismatch: 0, Pending: 0, Unverified: 0 };
  for (const r of states) c[r.state] += 1;
  return c;
}

/** Decode a 200 body of GET /api/v1/verifications/{id}. */
export function decodeVerificationRun(json: unknown, request: { id: string; snapshotId?: string }): Decoded<VerificationRunDTO> {
  const bad = schemaOrRefuse<VerificationRunDTO>("VerificationRun", json);
  if (bad) return bad;
  const run = json as VerificationRunDTO;
  const r = run.result;

  const scope = scopeProblems(run.meta);
  if (scope.length) return refuse("scope_conflict", scope);
  if (run.identity.id !== request.id) return refuse("identity_conflict", [`identity.id is ${run.identity.id}, requested ${request.id}`]);
  if (run.identity.workspace_id !== run.meta.workspace_id) return refuse("scope_conflict", ["identity.workspace_id differs from meta.workspace_id"]);
  if (request.snapshotId !== undefined && run.snapshot_id !== request.snapshotId)
    return refuse("snapshot_conflict", [`snapshot_id is ${run.snapshot_id}, requested ${request.snapshotId}`]);

  if (stableJson(run.evaluation_context.evaluator) !== stableJson(ACCEPTED_EVALUATOR))
    return refuse("evaluator_identity_conflict", ["evaluation_context.evaluator is not the accepted pinned evaluator"]);

  // Counts are copied, never recomputed for display; a disagreement with the records is refused.
  const counted = tally(r.records);
  if (stableJson(counted) !== stableJson(r.counts)) return refuse("counts_conflict", [`result.counts ${stableJson(r.counts)} disagree with record states ${stableJson(counted)}`]);

  const rows = run.source_snapshot.rows;
  const inv: string[] = [];
  if (r.records.length !== r.source_rows_observed) inv.push(`${r.records.length} records but source_rows_observed=${r.source_rows_observed}`);
  if (rows.length !== r.records.length) inv.push(`${rows.length} source rows but ${r.records.length} records`);
  r.records.forEach((rec, i) => {
    if (rec.source_row !== i) inv.push(`records[${i}].source_row is ${rec.source_row}; records must be in capture order 0..n-1`);
    const row = rows[i];
    if (row && row.source_row !== i) inv.push(`source_snapshot.rows[${i}].source_row is ${row.source_row}`);
    if (row && stableJson(row.key) !== stableJson(rec.key)) inv.push(`records[${i}].key differs from source_snapshot.rows[${i}].key`);
  });
  for (const [i, row] of rows.entries()) {
    const { state, value } = row.phone;
    if (state === "present" && typeof value !== "string") inv.push(`source_snapshot.rows[${i}].phone is present without a string value`);
    if ((state === "missing" || state === "null" || state === "inaccessible" || state === "redacted") && value !== null)
      inv.push(`source_snapshot.rows[${i}].phone is ${state} but carries a value`);
  }
  if (inv.length) return refuse("row_inventory_conflict", inv);

  if (!r.source_population_known && r.expected_total !== null) return refuse("population_conflict", ["expected_total is set although source_population_known is false"]);

  const refs = run.evidence_references;
  const refProblems: string[] = [];
  const ids = refs.map((x) => x.id);
  if (new Set(ids).size !== ids.length) refProblems.push("duplicate evidence reference IDs");
  const byId = new Map(refs.map((x) => [x.id, x]));
  for (const [field, role] of [
    ["source_snapshot", "source"],
    ["destination_observation", "destination"],
    ["policy_context", "policy"],
  ] as const) {
    const ref = byId.get(run[field].evidence_reference_id);
    if (!ref) refProblems.push(`${field}.evidence_reference_id does not name a returned reference`);
    else if (ref.role !== role) refProblems.push(`${field} references a ${ref.role} reference`);
  }
  const inputs = refs.filter((x) => x.role === "evaluation_input");
  if (inputs.length !== 1) refProblems.push(`${inputs.length} evaluation_input references; exactly one is required`);
  else if (inputs[0]!.sha256 !== run.evaluation_context.input_evidence_sha256) refProblems.push("evaluation_input reference digest differs from input_evidence_sha256");
  const sourceRef = byId.get(run.source_snapshot.evidence_reference_id);
  if (sourceRef?.sha256 != null && sourceRef.sha256 !== r.source_basis_sha256) refProblems.push("source reference digest differs from result.source_basis_sha256");
  const policyRef = byId.get(run.policy_context.evidence_reference_id);
  if (policyRef?.sha256 != null && policyRef.sha256 !== r.rule_basis_sha256) refProblems.push("policy reference digest differs from result.rule_basis_sha256");
  for (const ref of refs)
    if (ref.acquisition_kind !== "synthetic_local" || ref.external_authenticity !== "not_authenticated")
      refProblems.push(`reference ${ref.id} claims ${ref.acquisition_kind}/${ref.external_authenticity} outside the synthetic local scope`);
  if (refProblems.length) return refuse("reference_conflict", refProblems);

  const { instants, diagnostics } = expectedEventTimes(r, run.evaluation_context.time_mapping);
  const timeProblems: string[] = [];
  const m = run.evaluation_context.time_mapping;
  if (m.kind === "unmapped" && (m.origin_iso !== null || m.seconds_per_tick !== null)) timeProblems.push("unmapped time mapping carries parameters");
  if (m.kind === "synthetic_affine_v1" && (m.origin_iso === null || m.seconds_per_tick === null)) timeProblems.push("affine time mapping lacks origin or tick length");
  for (const f of TIME_FIELDS) {
    const got = run.evaluation_context.event_times[f];
    const want = instants[f];
    if ((got === null) !== (want === null) || (got !== null && Date.parse(got) !== want))
      timeProblems.push(`evaluation_context.event_times.${f} is ${got ?? "null"}; its tick and mapping give ${want === null ? "null" : new Date(want).toISOString()}`);
  }
  const returned = new Set(run.diagnostics.map((d) => `${d.path} ${d.code}`));
  for (const d of diagnostics) if (!returned.has(`${d.path} ${d.code}`)) timeProblems.push(`missing diagnostic ${d.code} for ${d.path}`);
  for (const d of run.diagnostics)
    if (TIME_FIELDS.some((f) => d.path === `result.${f}`) && !diagnostics.some((x) => x.path === d.path && x.code === d.code))
      timeProblems.push(`diagnostic ${d.code} for ${d.path}, whose time is mapped`);
  if (timeProblems.length) return refuse("time_mapping_conflict", timeProblems);

  const retry = run.retry_context;
  const pending = r.records.filter((x) => x.state === "Pending").map((x) => x.source_row);
  if (stableJson(retry.pending_source_rows) !== stableJson(pending)) return refuse("retry_conflict", ["retry_context.pending_source_rows differ from the Pending records"]);
  if (retry.policy_retry_viable !== run.policy_context.retry_viable) return refuse("retry_conflict", ["retry_context.policy_retry_viable differs from policy_context.retry_viable"]);

  const a = run.assurance;
  if (a.research_authorization !== "research_only" || a.release_approval_reference !== null || a.acquisition_authenticity !== "not_authenticated")
    return refuse("assurance_conflict", ["assurance claims more than research_only / not_authenticated for the synthetic local scope"]);

  return { ok: true, value: run };
}

/**
 * Decode a 200 body of a live Detail read made with phase3b=true: the frozen body goes through decodeVerificationRun
 * unchanged, and the additive fields are admitted against that run. An archived run (a History Detail's `run`) never
 * comes through here — it is an exact frozen body.
 */
export function decodeLiveVerificationRun(json: unknown, request: { id: string; snapshotId?: string }): Decoded<WithPhase3B<VerificationRunDTO>> {
  const { frozen, fields } = phase3bSplit(json);
  const decoded = decodeVerificationRun(frozen, request);
  if (!decoded.ok) return decoded;
  const problems = phase3bProblems(fields, "", decoded.value.result);
  if (problems.length) return refuse("phase3b_status_conflict", problems);
  return { ok: true, value: { ...decoded.value, ...(fields as Partial<Phase3BFieldsDTO> | null) } };
}

/** Decode a 200 body of GET /api/v1/verifications/{id}/evidence for one exact request. */
export function decodeEvidencePage(
  json: unknown,
  request: { id: string; snapshotId?: string; includePayload: boolean; limit: number },
): Decoded<EvidencePageDTO> {
  const bad = schemaOrRefuse<EvidencePageDTO>("EvidencePage", json);
  if (bad) return bad;
  const page = json as EvidencePageDTO;
  const scope = scopeProblems(page.meta);
  if (scope.length) return refuse("scope_conflict", scope);
  if (page.run_id !== request.id) return refuse("identity_conflict", [`run_id is ${page.run_id}, requested ${request.id}`]);
  if (request.snapshotId !== undefined && page.page.snapshot_id !== request.snapshotId)
    return refuse("snapshot_conflict", [`page.snapshot_id is ${page.page.snapshot_id}, pinned ${request.snapshotId}`]);
  if (page.items.length > request.limit) return refuse("page_conflict", [`${page.items.length} items exceed limit ${request.limit}`]);
  if (page.page.next_cursor === "") return refuse("page_conflict", ["next_cursor is an empty string"]);
  const p: string[] = [];
  page.items.forEach((item, i) => {
    const avail = item.reference.availability;
    if (avail !== "available") {
      if (item.payload !== null || !item.payload_reason) p.push(`items[${i}] is ${avail} but carries a payload or no reason`);
    } else if (!request.includePayload) {
      if (item.payload !== null || item.payload_reason !== "omitted_by_request") p.push(`items[${i}] payload was not omitted as requested`);
    } else if (item.payload === null || item.payload_reason !== null) p.push(`items[${i}] is available but its payload is missing`);
  });
  if (p.length) return refuse("payload_binding_conflict", p);
  return { ok: true, value: page };
}

/** The frozen Error envelope, or null when the body is not one (e.g. a proxy's own failure page). */
export function decodeErrorEnvelope(json: unknown): ErrorDTO | null {
  return validateSchema("Error", json).length ? null : (json as ErrorDTO);
}
