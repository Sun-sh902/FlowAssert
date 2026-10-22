/**
 * Evidence integrity — a separate dimension from retrieval and from the business verdict (P2-AUD-001).
 *
 *   RETRIEVAL   how far the evidence pages were read: reading · partial · all pages retrieved · stopped.
 *               Reaching the last page proves only that every reference was retrieved, in order.
 *   INTEGRITY   whether the stored content is internally consistent with its digests:
 *                 verified      the Service reports INTEGRITY_VERIFIED for the item's stored canonical bytes
 *                               AND this browser rebuilt Python's canonical bytes from the payload it received
 *                               and reproduced the same SHA-256 (archive). For Phase 2 ephemeral evidence,
 *                               whose Service sends no integrity statement, only the browser re-check exists.
 *                 failed        a definite contradiction: the browser computed a different SHA-256 for a payload
 *                               it can canonicalize exactly, or the Service reported INTEGRITY_FAILED.
 *                 unverifiable  no supported comparison succeeded: payload omitted by request, reference not
 *                               available, no digest, or bytes this browser cannot reproduce reliably.
 *                 pending       not read yet.
 *   VERDICT     Verified · Mismatch · Pending · Unverified — the archived evaluation, untouched by either.
 * A digest match is internal consistency of values the same service supplied. It is never a claim of
 * authentic external acquisition, independent collection or business truth.
 */
import type { DigestCheck, EvidenceReferenceView } from "./evidence";
import type { ServiceIntegrityView } from "./history";

export type IntegrityState = "verified" | "failed" | "unverifiable" | "pending";

export interface ItemIntegrity {
  id: string;
  state: IntegrityState;
  /** The Service's statement (archived evidence), or null where the Service sends none (Phase 2). */
  service: ServiceIntegrityView["status"] | null;
  /** What this browser could do with the payload it received. */
  browser: DigestCheck | "omitted" | "not_available" | "not_read";
  /** One plain phrase saying why. */
  reason: string;
}

function browserOf(ref: EvidenceReferenceView): ItemIntegrity["browser"] {
  switch (ref.payload.state) {
    case "loaded":
      return ref.payload.digest ?? "not_checkable";
    case "omitted":
      return "omitted";
    case "unavailable":
      return "not_available";
    case "not_loaded":
      return "not_read";
  }
}

export function assessItem(ref: EvidenceReferenceView): ItemIntegrity {
  const service = ref.serviceIntegrity?.status ?? null;
  const browser = browserOf(ref);
  const at = (state: IntegrityState, reason: string): ItemIntegrity => ({ id: ref.id, state, service, browser, reason });
  if (browser === "not_read") return at("pending", "not read yet");
  if (browser === "mismatch") return at("failed", "sha256 not reproduced in this browser — the payload received does not match its reference digest");
  if (service === "INTEGRITY_FAILED") return at("failed", "the Service reports INTEGRITY_FAILED for the stored content");
  if (browser === "omitted") return at("unverifiable", "payload omitted by request — this browser cannot repeat the check");
  if (browser === "not_available") return at("unverifiable", `reference ${ref.availability.replace("_", " ")} — no content to check`);
  if (browser === "not_checkable") return at("unverifiable", "this browser cannot reproduce Python’s canonical bytes for this payload reliably");
  // browser reproduced
  if (ref.serviceIntegrity === undefined) return at("verified", "sha256 reproduced in this browser");
  if (service === "INTEGRITY_VERIFIED") return at("verified", "stored bytes verified by the Service and sha256 reproduced in this browser");
  return at("unverifiable", "the Service could not verify the stored content");
}

export interface IntegritySummary {
  state: IntegrityState;
  total: number;
  verified: number;
  failed: ItemIntegrity[];
  unverifiable: ItemIntegrity[];
  pending: number;
}

/**
 * The whole evidence set. A failure anywhere wins and is reported at once; otherwise the set is pending
 * until every reference has been retrieved and checked; then unverifiable if any item is; else verified.
 */
export function summarizeIntegrity(items: ItemIntegrity[], retrievalComplete: boolean): IntegritySummary {
  const failed = items.filter((i) => i.state === "failed");
  const unverifiable = items.filter((i) => i.state === "unverifiable");
  const pending = items.filter((i) => i.state === "pending").length;
  const verified = items.filter((i) => i.state === "verified").length;
  const state: IntegrityState = failed.length ? "failed" : !retrievalComplete || pending ? "pending" : unverifiable.length ? "unverifiable" : items.length ? "verified" : "unverifiable";
  return { state, total: items.length, verified, failed, unverifiable, pending };
}
