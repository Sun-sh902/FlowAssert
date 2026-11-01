/**
 * WIRE MIRROR of the Phase 3B additive read fields — local synthetic, read-only.
 *
 * Source (read-only): service/app/admission_models.py and service/app/admission_serialization.py;
 * src/test/phase3b-contract-drift.test.ts compares every value below with those files.
 *
 * The frozen Phase 0 and Phase 3A shapes are NOT changed: ./v1.ts and ./history.ts stay exact mirrors, and their
 * schemas stay closed. These fields are additive and exist only on four reads:
 *   GET /api/v1/verifications/{id}?phase3b=true                 (the frozen shape without the flag)
 *   GET /api/v1/verification-lookup?…&phase3b=true              (the frozen shape without the flag)
 *   GET /api/v1/history/verifications                           (each item; GET /api/v1/history strips them)
 *   GET /api/v1/history/verifications/{history_id}              (top level; GET /api/v1/history/{id} strips them)
 * The flag is refused on every other route, so it is never sent to History or to an Evidence read.
 *
 * Wire names stay snake_case. Only src/data/local/phase3b.ts and src/adapters/phase3bToView.ts read these types.
 */
export const PHASE3B_FLAG = { name: "phase3b", value: "true" } as const;

/** The History reads that carry the Phase 3B fields. Templates only — no base URL exists. */
export const PHASE3B_HISTORY_PATHS = {
  list: "/api/v1/history/verifications",
  detail: "/api/v1/history/verifications/{history_id}",
} as const;

export const CAPTURE_STATUSES = ["CAPTURED_COMPLETE", "CAPTURE_INCOMPLETE", "CAPTURE_STALE_REJECTED", "CAPTURE_SUBPROCESS_FAILED", "CAPTURE_NOT_IMPLEMENTED"] as const;
export const ADMISSION_STATUSES = ["ADMITTED_RUN_BOUND", "REJECTED_STALE_RECEIPT", "REJECTED_INCOMPLETE_EXECUTION", "REJECTED_BINDING_MISMATCH", "ADMISSION_NOT_IMPLEMENTED"] as const;

export type CaptureStatusDTO = (typeof CAPTURE_STATUSES)[number];
export type AdmissionStatusDTO = (typeof ADMISSION_STATUSES)[number];

/** The members of `run_bound_metadata`, in the Service's order. The object is closed: receipt tokens never appear here. */
export const RUN_BOUND_FIELDS = [
  "run_id",
  "execution_cwd_sha256",
  "source_basis_sha256",
  "rule_basis_sha256",
  "started_mono_ns",
  "completed_mono_ns",
  "verifier_work_completed",
  "outer_exit_status",
  "subprocess_failures",
] as const;

export interface RunBoundMetadataDTO {
  run_id: string;
  execution_cwd_sha256: string;
  source_basis_sha256: string;
  rule_basis_sha256: string;
  /**
   * Python time.monotonic_ns(). Exceeds Number.MAX_SAFE_INTEGER on a host up for about 104 days, so JSON.parse may
   * round it: exact values come from the response's own lexemes (src/adapters/phase3bToView.ts).
   */
  started_mono_ns: number;
  completed_mono_ns: number;
  verifier_work_completed: boolean;
  /** Nullable in the Service's model. Null means no exit status was reported — never zero. */
  outer_exit_status: number | null;
  subprocess_failures: number;
}

export interface Phase3BFieldsDTO {
  capture_status: CaptureStatusDTO;
  admission_status: AdmissionStatusDTO;
  run_bound_metadata?: RunBoundMetadataDTO;
}

/** A frozen body as admitted from a read that may carry the additive fields. */
export type WithPhase3B<T> = T & Partial<Phase3BFieldsDTO>;
