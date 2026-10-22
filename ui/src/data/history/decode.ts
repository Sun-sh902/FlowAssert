/**
 * Admission of Phase 3A history response bodies: additive-schema validation (verbatim copy,
 * src/data/contract/history.schemas.json), then cross-field checks the backend handoff states as the
 * reviewed relationships. A body that fails any check is refused as a whole; nothing is repaired,
 * defaulted or re-derived, and no verdict is computed — cohort, record and rule states are copied.
 *
 * Identity relationships (handoff "history_id and archive_id bind exact candidate bytes"):
 *   history_id = hist_<d>, archive_id = archive_<d>, snapshot_id = history-snapshot_<d>,
 *   integrity.checked_sha256 = <d> with scope archive_candidate_and_relationships.
 * Integrity in a 200 (handoff "Integrity failure blocks 200"; ARCHIVE_INTEGRITY_MODEL.md):
 *   the archive record must be INTEGRITY_VERIFIED; an evidence item is INTEGRITY_VERIFIED only for an
 *   available reference whose checked_sha256 equals the reference sha256, or INTEGRITY_UNVERIFIABLE with
 *   nothing hashed. A 200 that reports INTEGRITY_FAILED, or any integrity field that contradicts these
 *   rules, is refused and carries the reported integrity outcome, so it is shown as an integrity
 *   failure — never as success and never as a verdict.
 * The archived run is admitted with the accepted Phase 2 decoder (decodeVerificationRun) against the
 * original verification ID and the ORIGINAL snapshot (run.snapshot_id), the two namespaces kept apart.
 */
import contract from "../contract/history.schemas.json";
import type { HistoryDetailDTO, HistoryEvidencePageDTO, HistoryIntegrityDTO, HistoryListDTO, HistorySummaryDTO } from "../contract/history";
import type { ErrorDTO } from "../contract/v1";
import { ACCEPTED_EVALUATOR } from "../local/config";
import { decodeVerificationRun } from "../local/decode";
import { createSchemaValidator, stableJson } from "../local/schema";
import { HISTORY_SCOPE } from "./config";

export const validateHistorySchema = createSchemaValidator(contract.schemas as unknown as Record<string, Record<string, unknown>>, "the Phase 3A history slice");

export const HISTORY_SCHEMA_SOURCE = { file: contract.source, sha256: contract.source_sha256, contractVersion: contract.contract_version, count: Object.keys(contract.schemas).length };

export type IntegrityOutcome = "INTEGRITY_FAILED" | "INTEGRITY_UNVERIFIABLE";
export type HistoryDecoded<T> = { ok: true; value: T } | { ok: false; code: string; problems: string[]; integrity?: IntegrityOutcome };

const refuse = <T>(code: string, problems: string[], integrity?: IntegrityOutcome): HistoryDecoded<T> => ({ ok: false, code, problems, ...(integrity ? { integrity } : {}) });

function schemaOrRefuse<T>(name: string, json: unknown): HistoryDecoded<T> | null {
  const errors = validateHistorySchema(name, json);
  return errors.length ? refuse<T>("schema_invalid", errors.map((e) => `${name}${e.path === "$" ? "" : e.path}: ${e.message}`)) : null;
}

/** The integrity outcome a contradictory integrity statement represents (FAILED wins over UNVERIFIABLE). */
const outcomeOf = (status: HistoryIntegrityDTO["status"]): IntegrityOutcome => (status === "INTEGRITY_FAILED" ? "INTEGRITY_FAILED" : "INTEGRITY_UNVERIFIABLE");

/** Archive-record integrity and identity bindings shared by list items, Detail and evidence pages. */
function recordBinding(x: { history_id: string; archive_id: string; snapshot_id: string; integrity: HistoryIntegrityDTO }, at: string): HistoryDecoded<never> | null {
  const i = x.integrity;
  if (i.status !== "INTEGRITY_VERIFIED")
    return refuse("integrity_status_conflict", [`${at}${x.history_id} reports ${i.status} in a successful response; the reviewed contract blocks 200 on integrity failure`], outcomeOf(i.status));
  const d = x.history_id.slice("hist_".length);
  const p: string[] = [];
  if (x.archive_id !== `archive_${d}`) p.push(`${at}archive_id ${x.archive_id} is not bound to ${x.history_id}`);
  if (x.snapshot_id !== `history-snapshot_${d}`) p.push(`${at}snapshot_id ${x.snapshot_id} is not bound to ${x.history_id}`);
  if (i.content_scope !== "archive_candidate_and_relationships") p.push(`${at}archive integrity scope is ${i.content_scope}`);
  if (i.checked_sha256 !== d) p.push(`${at}archive integrity checked ${i.checked_sha256 ?? "null"}, not the candidate digest named by ${x.history_id}`);
  return p.length ? refuse("integrity_binding_conflict", p, "INTEGRITY_UNVERIFIABLE") : null;
}

/** Evaluator, provenance, contract and population consistency of one summary. */
function summaryProblems(s: HistorySummaryDTO, at: string): HistoryDecoded<never> | null {
  if (stableJson(s.evaluator) !== stableJson(ACCEPTED_EVALUATOR)) return refuse("evaluator_identity_conflict", [`${at}evaluator is not the accepted pinned evaluator`]);
  if (s.provenance.research_source_commit !== s.evaluator.source_commit) return refuse("provenance_conflict", [`${at}provenance.research_source_commit differs from evaluator.source_commit`]);
  if (s.original_contract_sha256 !== HISTORY_SCOPE.originalContractSha256) return refuse("contract_identity_conflict", [`${at}original_contract_sha256 is not the frozen Phase 0 contract`]);
  const r = s.result_summary;
  if (!r.source_population_known && r.expected_total !== null) return refuse("population_conflict", [`${at}expected_total is set although source_population_known is false`]);
  return null;
}

/** Decode a 200 body of GET /api/v1/history for one exact request. */
export function decodeHistoryList(json: unknown, request: { limit: number; verificationId?: string }): HistoryDecoded<HistoryListDTO> {
  const bad = schemaOrRefuse<HistoryListDTO>("HistoryList", json);
  if (bad) return bad;
  const list = json as HistoryListDTO;
  if (list.items.length > request.limit) return refuse("page_conflict", [`${list.items.length} items exceed limit ${request.limit}`]);
  if (list.page.next_cursor === "") return refuse("page_conflict", ["next_cursor is an empty string"]);
  if (list.page.total < list.items.length) return refuse("page_conflict", [`page.total ${list.page.total} is smaller than the ${list.items.length} entries returned`]);
  const seen = new Set<string>();
  for (const [i, item] of list.items.entries()) {
    const at = `items[${i}] `;
    if (seen.has(item.history_id)) return refuse("duplicate_entry", [`${at}${item.history_id} appears twice in one page`]);
    seen.add(item.history_id);
    if (request.verificationId !== undefined && item.original_verification_id !== request.verificationId)
      return refuse("scope_conflict", [`${at}${item.history_id} is ${item.original_verification_id}; the list was filtered to ${request.verificationId}`]);
    const binding = recordBinding(item, at);
    if (binding) return binding;
    const other = summaryProblems(item, at);
    if (other) return other;
  }
  return { ok: true, value: list };
}

/** Decode a 200 body of GET /api/v1/history/{history_id}. */
export function decodeHistoryDetail(json: unknown, request: { historyId: string; snapshotId?: string }): HistoryDecoded<HistoryDetailDTO> {
  const bad = schemaOrRefuse<HistoryDetailDTO>("HistoryDetail", json);
  if (bad) return bad;
  const d = json as HistoryDetailDTO;
  if (d.history_id !== request.historyId) return refuse("identity_conflict", [`history_id is ${d.history_id}, requested ${request.historyId}`]);
  if (request.snapshotId !== undefined && d.snapshot_id !== request.snapshotId) return refuse("snapshot_conflict", [`snapshot_id is ${d.snapshot_id}, pinned ${request.snapshotId}`]);
  const binding = recordBinding(d, "");
  if (binding) return binding;
  const other = summaryProblems(d, "");
  if (other) return other;

  const run = d.run;
  const p: string[] = [];
  if (d.original_verification_id !== run.identity.id) p.push(`original_verification_id ${d.original_verification_id} differs from run.identity.id ${run.identity.id}`);
  if (d.original_snapshot_id !== run.snapshot_id) p.push(`original_snapshot_id differs from run.snapshot_id`);
  if (d.workspace_id !== run.meta.workspace_id) p.push(`workspace_id differs from run.meta.workspace_id`);
  if (stableJson(d.evaluator) !== stableJson(run.evaluation_context.evaluator)) p.push("evaluator differs from run.evaluation_context.evaluator");
  if (d.input_evidence_sha256 !== run.evaluation_context.input_evidence_sha256) p.push("input_evidence_sha256 differs from run.evaluation_context.input_evidence_sha256");
  if (p.length) return refuse("archive_binding_conflict", p);

  // The archived run passes every accepted Phase 2 admission check, against its ORIGINAL identity and snapshot.
  const inner = decodeVerificationRun(run, { id: d.original_verification_id, snapshotId: d.original_snapshot_id });
  if (!inner.ok) return refuse(inner.code, inner.problems.map((x) => `run: ${x}`));

  // result_summary is a copy of the archived result; a disagreement is refused, never reconciled.
  const r = run.result;
  const fromRun = { cohort_state: r.cohort_state, counts: r.counts, expected_total: r.expected_total, source_population_known: r.source_population_known };
  if (stableJson(fromRun) !== stableJson(d.result_summary)) return refuse("summary_conflict", [`result_summary ${stableJson(d.result_summary)} differs from the archived run.result ${stableJson(fromRun)}`]);
  return { ok: true, value: d };
}

/** The identity an archived evidence page must carry: the hydrated Detail's. */
export interface EvidenceBinding {
  historyId: string;
  /** The Detail's persistent history snapshot (never run.snapshot_id). */
  snapshotId: string;
  archiveId: string;
  originalSnapshotId: string;
  originalVerificationId: string;
}

/** Decode a 200 body of GET /api/v1/history/{history_id}/evidence for one exact request. */
export function decodeHistoryEvidencePage(json: unknown, request: EvidenceBinding & { includePayload: boolean; limit: number }): HistoryDecoded<HistoryEvidencePageDTO> {
  const bad = schemaOrRefuse<HistoryEvidencePageDTO>("HistoryEvidencePage", json);
  if (bad) return bad;
  const page = json as HistoryEvidencePageDTO;
  if (page.history_id !== request.historyId) return refuse("identity_conflict", [`history_id is ${page.history_id}, requested ${request.historyId}`]);
  const binding = recordBinding(page, "");
  if (binding) return binding;
  const ids: string[] = [];
  if (page.snapshot_id !== request.snapshotId) ids.push(`snapshot_id is ${page.snapshot_id}, the Detail's is ${request.snapshotId}`);
  if (page.page.snapshot_id !== page.snapshot_id) ids.push(`page.snapshot_id ${page.page.snapshot_id} differs from snapshot_id ${page.snapshot_id}`);
  if (ids.length) return refuse("snapshot_conflict", ids);
  if (page.archive_id !== request.archiveId) ids.push("archive_id differs from the Detail's");
  if (page.original_snapshot_id !== request.originalSnapshotId) ids.push("original_snapshot_id differs from the Detail's");
  if (page.original_verification_id !== request.originalVerificationId) ids.push("original_verification_id differs from the Detail's");
  if (ids.length) return refuse("identity_conflict", ids);
  if (page.items.length > request.limit) return refuse("page_conflict", [`${page.items.length} items exceed limit ${request.limit}`]);
  if (page.page.next_cursor === "") return refuse("page_conflict", ["next_cursor is an empty string"]);

  const payload: string[] = [];
  page.items.forEach((item, i) => {
    const avail = item.reference.availability;
    if (avail !== "available") {
      if (item.payload !== null || !item.payload_reason) payload.push(`items[${i}] is ${avail} but carries a payload or no reason`);
    } else if (!request.includePayload) {
      if (item.payload !== null || item.payload_reason !== "omitted_by_request") payload.push(`items[${i}] payload was not omitted as requested`);
    } else if (item.payload === null || item.payload_reason !== null) payload.push(`items[${i}] is available but its payload is missing`);
  });
  if (payload.length) return refuse("payload_binding_conflict", payload);

  for (const [i, item] of page.items.entries()) {
    const it = item.integrity;
    const ref = item.reference;
    const at = `items[${i}] ${ref.id}: `;
    if (it.status === "INTEGRITY_FAILED") return refuse("integrity_status_conflict", [`${at}the Service reports INTEGRITY_FAILED in a successful response`], "INTEGRITY_FAILED");
    if (it.content_scope !== "evidence_canonical_bytes") return refuse("integrity_binding_conflict", [`${at}integrity scope is ${it.content_scope}`], "INTEGRITY_UNVERIFIABLE");
    if (it.status === "INTEGRITY_VERIFIED") {
      if (ref.availability !== "available" || ref.sha256 === null || it.checked_sha256 !== ref.sha256)
        return refuse("integrity_binding_conflict", [`${at}INTEGRITY_VERIFIED does not name the reference's own sha256 (${ref.sha256 ?? "none"})`], "INTEGRITY_UNVERIFIABLE");
    } else if (it.checked_sha256 !== null || (ref.availability === "available" && ref.sha256 !== null))
      return refuse("integrity_binding_conflict", [`${at}INTEGRITY_UNVERIFIABLE for an available, hashed reference`], "INTEGRITY_UNVERIFIABLE");
  }
  return { ok: true, value: page };
}

/** The Error envelope (shared schema), or null when the body is not one. */
export function decodeHistoryError(json: unknown): ErrorDTO | null {
  return validateHistorySchema("Error", json).length ? null : (json as ErrorDTO);
}

/** The integrity outcome named by an Error envelope's details, if any (FAILED takes precedence). */
export function integrityFromDetails(e: ErrorDTO): IntegrityOutcome | null {
  const codes = e.error.details.map((x) => x.code);
  if (codes.includes("INTEGRITY_FAILED")) return "INTEGRITY_FAILED";
  if (codes.includes("INTEGRITY_UNVERIFIABLE")) return "INTEGRITY_UNVERIFIABLE";
  return null;
}
