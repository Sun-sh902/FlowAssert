/**
 * WIRE MIRROR of the Phase 3A ADDITIVE history contract — local synthetic, read-only.
 *
 * Source (read-only): FlowAssert-Phase3A-Service/contracts/openapi-history-v1.yaml
 *   info.version = phase3a-1.0.0, SHA-256 f341d8d5…bd69f, x-frozen-contract-sha256 = 0688d55d…1c230.
 *   Backend handoff: FlowAssert-Phase3A-Service/docs/phase3a/FRONTEND_HANDOFF.md.
 *
 * Scope: exactly the three additive read operations
 *   GET /api/v1/history                               -> HistoryListDTO
 *   GET /api/v1/history/{history_id}                  -> HistoryDetailDTO
 *   GET /api/v1/history/{history_id}/evidence         -> HistoryEvidencePageDTO
 * plus the shared Error envelope. Everything these bodies share with the frozen Phase 0 contract
 * (VerificationRun, EvidenceReference, EvaluatorIdentity, Counts, RawJSON, Error …) is imported from the
 * frozen mirror (./v1.ts), which this phase does not change.
 *
 * Rules for this file (the same as ./v1.ts):
 *  - It restates the additive contract. Never add, rename or relax a field here.
 *    `src/test/history-contract-drift.test.ts` parses these declarations with the existing guard
 *    (src/test/contract/guard.ts) and compares them with the additive OpenAPI file when it is present.
 *  - Wire names stay snake_case. Only the history adapter (src/data/history/) reads these types; UI
 *    components consume view models (src/domain/history.ts, src/domain/view.ts).
 *  - Nothing here decodes, validates or fetches.
 */
import type { CountsDTO, EvaluatorIdentityDTO, EvidenceReferenceDTO, RawJSON, VerificationRunDTO } from "./v1";

export const HISTORY_CONTRACT_VERSION = "phase3a-1.0.0" as const;
/** SHA-256 of the reviewed additive contract file (FRONTEND_HANDOFF.md). */
export const HISTORY_CONTRACT_SHA256 = "f341d8d5ec9da1b933b06efe998c07a1045226500a6b5837e9c8a9ead74bd69f" as const;

/** The three additive read paths. Templates only — no base URL exists. */
export const HISTORY_PATHS = {
  list: "/api/v1/history",
  detail: "/api/v1/history/{history_id}",
  evidence: "/api/v1/history/{history_id}/evidence",
} as const;

export interface HistoryIntegrityDTO {
  status: "INTEGRITY_VERIFIED" | "INTEGRITY_FAILED" | "INTEGRITY_UNVERIFIABLE";
  algorithm: "sha256";
  canonicalization: "python-json-sortkeys-ascii-v1";
  /** Root: the archive candidate's SHA-256. Item: the canonical payload bytes' SHA-256. Null when nothing was hashed. */
  checked_sha256: string | null;
  content_scope: "archive_candidate_and_relationships" | "evidence_canonical_bytes";
}

export interface HistoryProvenanceDTO {
  kind: "synthetic_local";
  research_authorization: "research_only";
  acquisition_authenticity: "not_authenticated";
  service_baseline_sha256: string;
  implementation_sha256: string;
  source_set_sha256: string;
  reviewed_case: string;
  reviewed_fixture_sha256: string;
  research_source_commit: string;
}

export interface HistoryResultSummaryDTO {
  cohort_state: "Verified" | "Mismatch" | "Pending" | "Unverified";
  counts: CountsDTO;
  /** null = not known, never zero. */
  expected_total: number | null;
  source_population_known: boolean;
}

export interface HistorySummaryDTO {
  contract_version: "phase3a-1.0.0";
  history_id: string;
  archive_id: string;
  /** Persistent history snapshot (`history-snapshot_…`); a different namespace from run.snapshot_id. */
  snapshot_id: string;
  /** The original ephemeral catalog snapshot the evaluation belonged to. */
  original_snapshot_id: string;
  original_verification_id: string;
  workspace_id: "ws-synthetic-01";
  /** When the archive row was written — not when the evaluation ran (run.evaluation_context.service_executed_at). */
  archive_created_at: string;
  evaluator: EvaluatorIdentityDTO;
  original_contract_sha256: string;
  input_evidence_sha256: string;
  provenance: HistoryProvenanceDTO;
  result_summary: HistoryResultSummaryDTO;
  integrity: HistoryIntegrityDTO;
}

export interface HistoryDetailDTO {
  contract_version: "phase3a-1.0.0";
  history_id: string;
  archive_id: string;
  snapshot_id: string;
  original_snapshot_id: string;
  original_verification_id: string;
  workspace_id: "ws-synthetic-01";
  archive_created_at: string;
  evaluator: EvaluatorIdentityDTO;
  original_contract_sha256: string;
  input_evidence_sha256: string;
  provenance: HistoryProvenanceDTO;
  result_summary: HistoryResultSummaryDTO;
  integrity: HistoryIntegrityDTO;
  /** The complete original immutable evaluation. Records and rules are read from here, never from result_summary. */
  run: VerificationRunDTO;
}

export interface HistoryItemDTO {
  reference: EvidenceReferenceDTO;
  payload: RawJSON;
  payload_reason: string | null;
  integrity: HistoryIntegrityDTO;
}

export interface HistoryPageDTO {
  snapshot_id: string;
  next_cursor: string | null;
  /** Archive entries (list) or references (evidence) at the pinned boundary. Never a source population. */
  total: number;
}

export interface HistoryListDTO {
  contract_version: "phase3a-1.0.0";
  workspace_id: "ws-synthetic-01";
  items: HistorySummaryDTO[];
  page: HistoryPageDTO;
}

export interface HistoryEvidencePageDTO {
  contract_version: "phase3a-1.0.0";
  history_id: string;
  archive_id: string;
  snapshot_id: string;
  original_snapshot_id: string;
  original_verification_id: string;
  workspace_id: "ws-synthetic-01";
  integrity: HistoryIntegrityDTO;
  items: HistoryItemDTO[];
  page: HistoryPageDTO;
}

/* ---------- Query parameters (snake_case wire names) ---------- */

export interface HistoryListQueryDTO {
  limit?: number;
  cursor?: string;
  verification_id?: string;
}

export interface HistoryDetailQueryDTO {
  snapshot_id?: string;
}

export interface HistoryEvidenceQueryDTO {
  limit?: number;
  cursor?: string;
  snapshot_id?: string;
  include_payload?: boolean;
}
