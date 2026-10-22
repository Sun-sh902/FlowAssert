/**
 * Evidence-reference view models (presentation). Produced by a provider adapter; components read
 * only these. Field meaning follows EvidenceReference / EvidenceItem in the reviewed contract.
 *
 * Availability is a stored property of the reference. Whether this browser managed to load the
 * payload is a separate, data-access fact (`payload`). Neither one changes the verdict.
 */
export type EvidenceRole = "source" | "destination" | "policy" | "evaluation_input";
export type EvidenceAvailabilityView = "available" | "not_collected" | "unavailable" | "redacted" | "expired";

/** Whether this browser reproduced the reference's SHA-256 from the payload it received. Internal consistency only. */
export type DigestCheck = "reproduced" | "mismatch" | "not_checkable";

export type EvidencePayloadView =
  | { state: "loaded"; value?: unknown; digest?: DigestCheck }
  | { state: "omitted"; reason: string }
  | { state: "not_loaded" }
  | { state: "unavailable"; reason: string };

export interface EvidenceReferenceView {
  id: string;
  role: EvidenceRole;
  availability: EvidenceAvailabilityView;
  /** Stored reason for a non-available reference, verbatim. */
  reason: string | null;
  sha256: string | null;
  acquisitionKind: "synthetic_local" | "independent_source_read" | "destination_read" | "workflow_context";
  externalAuthenticity: "not_authenticated" | "not_assessed";
  /** Copied verbatim when read from the service (always application/json and python-json-sortkeys-ascii-v1 in v1). */
  mediaType?: string;
  canonicalization?: string;
  payload: EvidencePayloadView;
  /**
   * Phase 3A archived evidence only: the Service's stored-byte integrity statement for this item
   * (HistoryItem.integrity), copied. Absent for Phase 2 ephemeral evidence, whose Service sends none.
   * Not part of the reference identity the evidence chain compares.
   */
  serviceIntegrity?: import("./history").ServiceIntegrityView;
}

export interface EvidencePageView {
  runId: string;
  snapshotId: string | null;
  items: EvidenceReferenceView[];
  nextCursor: string | null;
  /** null = not computed, never zero. */
  total: number | null;
}
