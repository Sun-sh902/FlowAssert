/**
 * LOCAL_RESEARCH configuration — exact values from the reviewed Phase 2 handoff
 * (FlowAssert-Phase2-Support: FROZEN_API_HANDOFF.md, ACCEPTED_SOURCE_IDENTITY.md, SYNTHETIC_CASES.md).
 * Nothing here is a credential. Nothing here is invented: each value is cited where it is used.
 */

/**
 * Same-origin path prefix. The browser requests relative `/api/v1/...`; the Vite dev/preview server
 * forwards that prefix unchanged to the accepted loopback listener (vite.config.ts). There is no
 * configurable base URL, so no arbitrary external origin can be reached through this provider.
 */
export const LOCAL_API_PREFIX = "/api/v1";

/** Where the dev proxy forwards. Fixed by the accepted launcher `run.py` (host 127.0.0.1, port 8765). */
export const LOCAL_SERVICE_TARGET = "http://127.0.0.1:8765";

/** Configured server scope (FROZEN_API_HANDOFF.md: mode, workspace and synthetic are server-configured). */
export const LOCAL_SCOPE = {
  providerMode: "LOCAL_RESEARCH",
  workspaceId: "ws-synthetic-01",
  synthetic: true,
  apiVersion: "v1",
  contractVersion: "0.1.1-proposed",
} as const;

/**
 * The pinned evaluator the accepted Service serves (research-lock.json; ACCEPTED_SOURCE_IDENTITY.md).
 * A response naming any other evaluator is not from the accepted source and is refused.
 */
export const ACCEPTED_EVALUATOR = {
  version_label: "Round03.5 research — unapproved",
  source_commit: "4deddb323ad0f1f00b2c369a7b141dc04c95f8fa",
  model_sha256: "b61779e198dd0213b67f8319b77a2daf9feb502dc553784df6d6600e8e3a842d",
  workspace_dirty: true,
} as const;

/**
 * The five reviewed synthetic cases (SYNTHETIC_CASES.md). IDs and fixture names only: no verdict is
 * stored here — every result is read from the service when a case is opened. No list endpoint exists.
 */
export const KNOWN_LOCAL_CASES = [
  { id: "SPEC-001", fixture: "A-verified" },
  { id: "SPEC-002", fixture: "B-mismatch" },
  { id: "SPEC-003", fixture: "C-pending" },
  { id: "SPEC-004", fixture: "D-unverified" },
  { id: "SPEC-005", fixture: "E-row-verified-cohort-unverified" },
] as const;

/** Bounds for one finite read (handoff: "Use bounded pages/bytes/time and AbortSignal"). */
export const LOCAL_LIMITS = {
  /** Per-request time limit. Exceeding it is SERVICE_UNAVAILABLE (timeout), not a cancellation. */
  timeoutMs: 15_000,
  /** Largest response body accepted. Detail is capped at 200 records and 32 references by the contract. */
  maxBodyChars: 2_000_000,
  /** Evidence page size. Constant for a whole acquisition; 4 references → 2 pages, so continuation is exercised. */
  evidencePageLimit: 2,
  /** Hard stop for one evidence acquisition (32 references max ÷ 1 per page, plus margin). */
  maxEvidencePages: 40,
} as const;
