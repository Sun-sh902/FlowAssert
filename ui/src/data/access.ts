/**
 * Data-access vocabulary — how a READ went, never what the evidence says.
 *
 * Two vocabularies exist and must never be mixed:
 *   Verdicts (src/domain/view.ts)  Verified · Mismatch · Pending · Unverified — copied from the evaluator
 *   Access states (this file)      LOADING · EMPTY · REQUEST_ERROR · NOT_FOUND · PARTIAL_DATA ·
 *                                  STALE_SNAPSHOT · EVIDENCE_UNAVAILABLE · SERVICE_UNAVAILABLE
 *
 * A failed request has no verdict. Missing evidence is not a Mismatch. A stale snapshot never
 * replaces a newer admitted result. A partial set is never presented as complete.
 *
 * `ProviderResult` follows the documentation sketch in
 * FlowAssert-Integration-Planning/contracts/frontend-provider-contract.md ("Typed provider surface").
 * One addition is flagged there for review: the error variant carries `access`, the frontend's
 * classification of the failure, because the sketch has no field that separates a snapshot conflict
 * from an outage. See docs/PHASE2_5_FRONTEND_READINESS.md §E.
 */
import type { ProviderMode } from "./provider";

export const ACCESS_STATES = [
  "LOADING",
  "EMPTY",
  "REQUEST_ERROR",
  "NOT_FOUND",
  "PARTIAL_DATA",
  "STALE_SNAPSHOT",
  "EVIDENCE_UNAVAILABLE",
  "SERVICE_UNAVAILABLE",
] as const;
export type AccessState = (typeof ACCESS_STATES)[number];

/** Failure classes a provider may report. NOT_FOUND has its own result kind. */
export type AccessFailure = "REQUEST_ERROR" | "STALE_SNAPSHOT" | "EVIDENCE_UNAVAILABLE" | "SERVICE_UNAVAILABLE";

/** Who supplied a result and under which declared limits. Mirrors the sketch's ProviderContext. */
export interface ProviderContext {
  mode: ProviderMode;
  synthetic: boolean;
  workspaceId: string | null;
  contractVersion: string | null;
  /** Catalog snapshot the response belongs to. MOCK has none. */
  snapshotId: string | null;
  requestId: string | null;
  researchAuthorization: "research_only" | "approved_for_product_use" | "demo";
  acquisitionAuthenticity: "not_authenticated" | "not_assessed";
  /** What relative times are measured against. */
  clockBasis: string;
}

export type ProviderResult<T> =
  | { kind: "ready"; data: T; context: ProviderContext }
  | { kind: "partial"; data: T; context: ProviderContext; unavailableIds: string[] }
  | { kind: "not_found"; requestId: string | null }
  | {
      kind: "error";
      access: AccessFailure;
      code: string;
      message: string;
      requestId: string | null;
      retryable: boolean;
      /**
       * Phase 3A (additive, optional): the archive integrity outcome a history failure carries — from the
       * Service's `error.details[].code` on a 503, or from a 200 body this frontend refused because its
       * integrity fields contradict the reviewed contract. Never set for a read that merely failed.
       * An integrity outcome is not an access state and never a verdict.
       */
      integrity?: "INTEGRITY_FAILED" | "INTEGRITY_UNVERIFIABLE";
      /** HTTP status of the Service's answer, when there was one (Phase 3A history reads). */
      httpStatus?: number;
    };

/**
 * Proposed mapping from an HTTP outcome to an access failure (contract "Errors are operational").
 * For a future LOCAL_RESEARCH adapter; nothing calls a server in this phase.
 *   no response / network failure / timeout / provider mode unavailable → SERVICE_UNAVAILABLE
 *   409 expired or conflicting snapshot, mode or version                 → STALE_SNAPSHOT
 *   503 on an evidence read (bound evidence missing or hash failure)     → EVIDENCE_UNAVAILABLE
 *   503 on a run read (integrity or version lock unavailable)            → SERVICE_UNAVAILABLE
 *   400 / 422 / 429 / 500 / unexpected status / undecodable body          → REQUEST_ERROR
 * 404 is not here: it is the `not_found` result kind.
 */
export function classifyHttpFailure(status: number | null, resource: "verification" | "evidence"): AccessFailure {
  if (status === null) return "SERVICE_UNAVAILABLE";
  if (status === 409) return "STALE_SNAPSHOT";
  if (status === 503) return resource === "evidence" ? "EVIDENCE_UNAVAILABLE" : "SERVICE_UNAVAILABLE";
  return "REQUEST_ERROR";
}

/** The rejection every provider uses for a cancelled read. Cancellation is not a result. */
export function abortError(): DOMException {
  return new DOMException("The read was cancelled.", "AbortError");
}

/* ---------- Read lifecycle (hook state; separate from the settled result union) ---------- */

export type ReadState<T> =
  | { status: "idle" }
  | { status: "loading"; seq: number }
  | { status: "cancelled"; seq: number }
  | { status: "settled"; seq: number; result: ProviderResult<T> };

/** The access state to present, or null when ready data should render normally. */
export function accessStateOf<T>(read: ReadState<T>, isEmpty: (data: T) => boolean = () => false): AccessState | null {
  switch (read.status) {
    case "idle":
    case "loading":
      return "LOADING";
    case "cancelled":
      return null;
    case "settled": {
      const r = read.result;
      if (r.kind === "not_found") return "NOT_FOUND";
      if (r.kind === "error") return r.access;
      if (r.kind === "partial") return "PARTIAL_DATA";
      return isEmpty(r.data) ? "EMPTY" : null;
    }
  }
}

/* ---------- Admission: which response may replace what is on screen ---------- */

export interface Admitted {
  seq: number;
  /** Snapshot echoed by a result that carries data; `undefined` for results with no data (errors, not found). */
  snapshotId: string | null | undefined;
}

export type Admission = { admit: true } | { admit: false; reason: "superseded" | "snapshot_mismatch" };

/**
 * A response is admitted only if it answers the newest request and, when the view is pinned to a
 * snapshot, any data it carries belongs to that same snapshot (a missing echo is a mismatch). Snapshot IDs are opaque — they are compared, never ordered,
 * so "newer" is decided by request order, not by the ID.
 */
export function admitResponse(latestSeq: number, pinnedSnapshotId: string | null, incoming: Admitted): Admission {
  if (incoming.seq !== latestSeq) return { admit: false, reason: "superseded" };
  if (pinnedSnapshotId !== null && incoming.snapshotId !== undefined && incoming.snapshotId !== pinnedSnapshotId)
    return { admit: false, reason: "snapshot_mismatch" };
  return { admit: true };
}

/* ---------- Copy ---------- */

export const ACCESS_COPY: Record<AccessState, { title: string; body: string; label: string }> = {
  LOADING: {
    label: "Reading",
    title: "Reading the stored result",
    body: "The result is being read, not computed. Nothing on this screen is a conclusion until the read settles.",
  },
  EMPTY: {
    label: "Empty",
    title: "Nothing in this snapshot",
    body: "The read succeeded and returned no runs. An empty catalogue is not Verified — there is simply nothing to show.",
  },
  REQUEST_ERROR: {
    label: "Request error",
    title: "The request failed",
    body: "No result was received, so there is no verdict to show. This is not Unverified: the evidence was never read.",
  },
  NOT_FOUND: {
    label: "Not found",
    title: "No run with this ID",
    body: "The provider has no run with this identity in the current scope. Nothing was evaluated.",
  },
  PARTIAL_DATA: {
    label: "Partial",
    title: "Only part of this view has loaded",
    body: "What is drawn was read in full. What is missing is marked, not filled in — counts are not turned into records.",
  },
  STALE_SNAPSHOT: {
    label: "Stale snapshot",
    title: "This view is pinned to an older snapshot",
    body: "A response from a different snapshot arrived and was not merged. Refresh the whole view to read the newer snapshot.",
  },
  EVIDENCE_UNAVAILABLE: {
    label: "Evidence unavailable",
    title: "Evidence payloads could not be read",
    body: "The stored verdict is unchanged. Missing payloads are shown as unavailable — never as a Mismatch.",
  },
  SERVICE_UNAVAILABLE: {
    label: "Service unavailable",
    title: "The verification service is not reachable",
    body: "No provider answered. Nothing is shown in place of a result, and no other data source is used instead.",
  },
};
