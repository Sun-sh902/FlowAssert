/**
 * LOCAL_RESEARCH history configuration — exact values from the Phase 3A backend handoff
 * (FlowAssert-Phase3A-Service/docs/phase3a/FRONTEND_HANDOFF.md, contracts/openapi-history-v1.yaml).
 * Nothing here is a credential, and nothing here is a history record: every entry is read from the
 * Service's SQLite archive when a page opens.
 */
import { LOCAL_API_PREFIX } from "../local/config";

/** Same-origin prefix, reached through the dev/preview gate (vite.config.ts → server/localApiGate.ts). */
export const HISTORY_API = `${LOCAL_API_PREFIX}/history` as const;

/** Configured archive scope: one synthetic workspace, LOCAL_RESEARCH, research_only (handoff). */
export const HISTORY_SCOPE = {
  workspaceId: "ws-synthetic-01",
  /** The frozen Phase 0 contract every archived evaluation was produced under. */
  originalContractSha256: "0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230",
} as const;

/**
 * The only values the list filter accepts: the additive contract's `verification_id` pattern
 * ^SPEC-00[1-5]$. They are filter values, not data: no entry, verdict or count is implied by them.
 */
export const HISTORY_CASE_FILTERS = ["SPEC-001", "SPEC-002", "SPEC-003", "SPEC-004", "SPEC-005"] as const;
export type HistoryCaseFilter = (typeof HISTORY_CASE_FILTERS)[number];
export const isHistoryCaseFilter = (v: string | null): v is HistoryCaseFilter => v !== null && (HISTORY_CASE_FILTERS as readonly string[]).includes(v);

export const HISTORY_LIMITS = {
  /** List page size, constant for one list view (contract 1–100). Small, so continuation is exercised by the 10-entry archive. */
  listPageLimit: 4,
  /** Hard stop for one list view. */
  maxListPages: 100,
  /** Evidence page size, constant for one acquisition (4 references → 2 pages, as in Phase 2). */
  evidencePageLimit: 2,
} as const;
