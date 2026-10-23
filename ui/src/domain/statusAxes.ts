/**
 * The four status axes of one verification (product round 01). They answer four different questions
 * and are never collapsed into one another:
 *
 *   Capture            — was the evidence acquired by a capture run, and how did that run end?
 *   Evidence admission — did an admission record bind that evidence to an evaluator input, or refuse it?
 *   Archive            — is an evaluation stored in the local SQLite archive, and did the Service's
 *                        integrity check pass when it answered?
 *   Evaluator verdict  — the business result: Verified, Mismatch, Pending or Unverified, produced ONLY by the
 *                        pinned Python evaluator and copied here unchanged.
 *
 * Phase 3A implements only the last two. Capture and admission are proposals in the accepted Phase 3B
 * planning package (DRAFT, not implemented, Phase 3B-1 not authorized), so in this build they are always
 * NOT_IMPLEMENTED — a fixed fact about the build, not a reading of any record.
 *
 * Rules enforced by these types:
 *   - a verdict exists only with a source that names the Service response it was copied from;
 *   - when no verdict was read (service unavailable, not archived, read refused) the axis is NO_VERDICT —
 *     never "Unverified", which is a business result the evaluator alone may produce;
 *   - an archive or read failure is reported on the archive axis and never becomes a verdict.
 */
import type { HistorySummaryView, ServiceIntegrityView } from "./history";
import type { VerificationState } from "./view";

export type CaptureAxis = {
  axis: "capture";
  kind: "NOT_IMPLEMENTED";
  /** What actually supplied the evidence instead. */
  basis: string;
};

export type AdmissionAxis = {
  axis: "admission";
  kind: "NOT_IMPLEMENTED";
  basis: string;
};

export type ArchiveAxis =
  | { axis: "archive"; kind: "READING" }
  | {
      axis: "archive";
      kind: "ARCHIVED";
      /** Archived evaluations of this case, newest archive entry first (archive order, never re-sorted). */
      entries: number;
      latest: { historyId: string; archivedAt: string; integrity: ServiceIntegrityView["status"] };
    }
  /** One archived evaluation, read by its history ID (the History entry page). */
  | { axis: "archive"; kind: "THIS_ENTRY"; historyId: string; archivedAt: string; integrity: ServiceIntegrityView["status"] }
  /** The archive was read completely and holds no evaluation of this case. */
  | { axis: "archive"; kind: "NOT_ARCHIVED" }
  /**
   * The archive could not be read (transport, gate, Service error, refused page). Nothing is known. `integrity` is the
   * integrity outcome the Service reported, if any — FAILED and UNVERIFIABLE are kept apart.
   */
  | { axis: "archive"; kind: "UNAVAILABLE"; code: string; integrity: "INTEGRITY_FAILED" | "INTEGRITY_UNVERIFIABLE" | null }
  /** The archive list answered 404 history_not_found. Not a read failure, and not an empty archive. */
  | { axis: "archive"; kind: "NOT_FOUND" }
  /** The archive contract cannot address this ID (its filter admits only the reviewed case IDs); no request was sent. */
  | { axis: "archive"; kind: "NOT_ADDRESSABLE"; reason: string };

export type VerdictSource =
  | { kind: "live"; request: string }
  | { kind: "archived"; historyId: string; archivedAt: string };

export type VerdictAxis =
  | { axis: "verdict"; kind: "VERDICT"; state: VerificationState; source: VerdictSource }
  | { axis: "verdict"; kind: "NO_VERDICT"; reason: string };

export interface StatusAxes {
  capture: CaptureAxis;
  admission: AdmissionAxis;
  archive: ArchiveAxis;
  verdict: VerdictAxis;
}

/** Phase 3A fact: the five reviewed synthetic fixtures are the only evidence; nothing is captured. */
export const CAPTURE_NOT_IMPLEMENTED: CaptureAxis = {
  axis: "capture",
  kind: "NOT_IMPLEMENTED",
  basis: "Evidence is a reviewed synthetic fixture shipped with the Service. No capture run exists in this build.",
};

/** Phase 3A fact: the Service evaluates its reviewed fixtures directly; no admission record is produced. */
export const ADMISSION_NOT_IMPLEMENTED: AdmissionAxis = {
  axis: "admission",
  kind: "NOT_IMPLEMENTED",
  basis: "No admission record is produced. The evaluator receives the reviewed fixture directly; the admission boundary is a Phase 3B draft.",
};

/** The archive axis for one case from a complete archive read (entries already filtered to the case, in archive order). */
export function archiveAxisOf(entries: readonly HistorySummaryView[]): ArchiveAxis {
  const latest = entries[0];
  if (!latest) return { axis: "archive", kind: "NOT_ARCHIVED" };
  return {
    axis: "archive",
    kind: "ARCHIVED",
    entries: entries.length,
    latest: { historyId: latest.historyId, archivedAt: latest.archivedAt, integrity: latest.integrity.status },
  };
}

/** The verdict copied from one archived evaluation's result_summary — the evaluator's own cohort result. */
export function archivedVerdict(entry: HistorySummaryView): VerdictAxis {
  return { axis: "verdict", kind: "VERDICT", state: entry.result.cohort, source: { kind: "archived", historyId: entry.historyId, archivedAt: entry.archivedAt } };
}

export const noVerdict = (reason: string): VerdictAxis => ({ axis: "verdict", kind: "NO_VERDICT", reason });
