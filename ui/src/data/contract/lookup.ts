/**
 * Pinned identity of the ADDITIVE exact-ID query contract (ID-addressability remediation-03):
 * FlowAssert-Phase3A-Service/contracts/openapi-id-addressability-v1.yaml, as handed off in
 * FlowAssert-Phase3A-Service/docs/phase3a/id-addressability-remediation-03/FRONTEND_HANDOFF.md.
 *
 * The two operations return the frozen VerificationRun / EvidencePage DTOs (the contract's components.schemas
 * equal the frozen Phase 0 schemas), so no new wire type is mirrored here — only the addressing: paths, the
 * exact query keys and their bounds. src/test/lookup-contract-drift.test.ts compares every value below with
 * the contract file itself.
 */
export const LOOKUP_CONTRACT_VERSION = "phase3a-id-addressability-1.0.0" as const;
export const LOOKUP_CONTRACT_SHA256 = "59ac38631982147b547ed2dae57ab4e8b2d218e3fa718861eb0c5828befcd8ae" as const;
/** Backend source identity the handoff names for this contract (evidence/source-identities.json). */
export const LOOKUP_BACKEND_SOURCE_SHA256 = "a5d68b75d67624e22223fa8ee9328447d96e639001dfac8cea271e4331b34b45" as const;

export const LOOKUP_PATHS = {
  detail: "/api/v1/verification-lookup",
  evidence: "/api/v1/verification-evidence",
} as const;

/** The exact query keys of each operation, in the contract's order; verification_id is the only required one. */
export const LOOKUP_QUERY = {
  detail: ["verification_id", "snapshot_id"],
  evidence: ["verification_id", "snapshot_id", "limit", "cursor", "include_payload"],
} as const;

export const LOOKUP_BOUNDS = {
  verificationIdCodePoints: { min: 1, max: 128 },
  snapshotIdMax: 128,
  cursorMax: 2048,
  limit: { min: 1, max: 100, default: 25 },
  requestTargetMaxBytes: 4096,
} as const;
