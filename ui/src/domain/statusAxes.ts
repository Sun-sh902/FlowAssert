/**
 * The four status axes of one verification (product round 01 + Phase 3B Sprint 1). They answer four different
 * questions and are never collapsed into one another:
 *
 *   Capture            — was the evidence acquired by a capture run, and how did that run end?
 *   Evidence admission — did an admission record bind that evidence to an evaluator input, or refuse it?
 *   Archive            — is an evaluation stored in the local SQLite archive, and did the Service's
 *                        integrity check pass when it answered?
 *   Evaluator verdict  — the business result: Verified, Mismatch, Pending or Unverified, produced ONLY by the
 *                        pinned Python evaluator and copied here unchanged.
 *
 * Rules enforced by these types:
 *   - capture and admission come only from a Phase3BView, which only the admitted read of a Service response produces
 *     (src/data/local/phase3b.ts → src/adapters/phase3bToView.ts). Raw status fields and caller-built axis objects
 *     establish nothing: an axis is one of the canonical objects below, and anything else is drawn as not implemented;
 *   - those two statuses are the Service's report. They authenticate nothing outside it and are never a verdict;
 *   - a verdict exists only with a source that names the Service response it was copied from;
 *   - when no verdict was read (service unavailable, not archived, read refused) the axis is NO_VERDICT —
 *     never "Unverified", which is a business result the evaluator alone may produce;
 *   - an archive, capture, or admission failure is reported on its own axis and never becomes a verdict.
 */
import type { HistorySummaryView, ServiceIntegrityView } from "./history";
import type { RunView, VerificationState } from "./view";

export type CaptureStatusCode =
  | "CAPTURED_COMPLETE"
  | "CAPTURE_INCOMPLETE"
  | "CAPTURE_STALE_REJECTED"
  | "CAPTURE_SUBPROCESS_FAILED"
  | "CAPTURE_NOT_IMPLEMENTED";

export type AdmissionStatusCode =
  | "ADMITTED_RUN_BOUND"
  | "REJECTED_STALE_RECEIPT"
  | "REJECTED_INCOMPLETE_EXECUTION"
  | "REJECTED_BINDING_MISMATCH"
  | "ADMISSION_NOT_IMPLEMENTED";

export type CaptureAxisKind =
  | "NOT_IMPLEMENTED"
  | "CAPTURED_COMPLETE"
  | "CAPTURE_INCOMPLETE"
  | "CAPTURE_STALE_REJECTED"
  | "CAPTURE_SUBPROCESS_FAILED";

export type AdmissionAxisKind =
  | "NOT_IMPLEMENTED"
  | "ADMITTED_RUN_BOUND"
  | "REJECTED_STALE_RECEIPT"
  | "REJECTED_INCOMPLETE_EXECUTION"
  | "REJECTED_BINDING_MISMATCH";

export type StatusAxisTone = "positive" | "warning" | "refused" | "neutral";

export type CaptureAxis = {
  axis: "capture";
  kind: CaptureAxisKind;
  status?: CaptureStatusCode;
  label?: string;
  /** Human-readable description of what supplied the evidence or how the capture run ended. */
  basis: string;
  description?: string;
  tone?: StatusAxisTone;
};

export type AdmissionAxis = {
  axis: "admission";
  kind: AdmissionAxisKind;
  status?: AdmissionStatusCode;
  label?: string;
  /** Human-readable description of the admission boundary outcome. */
  basis: string;
  description?: string;
  tone?: StatusAxisTone;
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

/** `run_bound_metadata` as reported. Monotonic readings are exact decimal text: they can exceed a JS safe integer. */
export interface RunBoundMetadataView {
  runId: string;
  executionCwdSha256: string;
  sourceBasisSha256: string;
  ruleBasisSha256: string;
  /** Null when the reading could not be stated exactly. */
  startedMonoNs: string | null;
  completedMonoNs: string | null;
  /** completed − started, as exact decimal text; null when either reading is. Negative is shown as reported. */
  elapsedNs: string | null;
  verifierWorkCompleted: boolean;
  /** Null means no exit status was reported — never zero. */
  outerExitStatus: number | null;
  subprocessFailures: number;
}

/** Capture and admission of one evaluation, as admitted from a Service response. */
export interface Phase3BView {
  captureStatus: CaptureStatusCode;
  admissionStatus: AdmissionStatusCode;
  runBound: RunBoundMetadataView | null;
}

const captureAxis = (kind: CaptureAxisKind, status: CaptureStatusCode, label: string, tone: StatusAxisTone, basis: string): CaptureAxis =>
  Object.freeze({ axis: "capture", kind, status, label, basis, description: basis, tone });
const admissionAxis = (kind: AdmissionAxisKind, status: AdmissionStatusCode, label: string, tone: StatusAxisTone, basis: string): AdmissionAxis =>
  Object.freeze({ axis: "admission", kind, status, label, basis, description: basis, tone });

/** The only capture axes that exist. Labels are product copy, chosen from the status code — never read from a response. */
export const CAPTURE_AXES: Readonly<Record<CaptureStatusCode, CaptureAxis>> = Object.freeze({
  CAPTURE_NOT_IMPLEMENTED: captureAxis(
    "NOT_IMPLEMENTED",
    "CAPTURE_NOT_IMPLEMENTED",
    "Not implemented",
    "neutral",
    "Evidence is a reviewed synthetic fixture shipped with the Service. No capture run is recorded for this evaluation.",
  ),
  CAPTURED_COMPLETE: captureAxis("CAPTURED_COMPLETE", "CAPTURED_COMPLETE", "Captured · complete", "positive", "The Service reports a complete capture run bound to this evaluation. Not a verdict, and it authenticates nothing outside this Service."),
  CAPTURE_INCOMPLETE: captureAxis("CAPTURE_INCOMPLETE", "CAPTURE_INCOMPLETE", "Incomplete", "warning", "The Service reports that the capture run did not finish, or did not bind to this evaluation. Not a verdict."),
  CAPTURE_STALE_REJECTED: captureAxis("CAPTURE_STALE_REJECTED", "CAPTURE_STALE_REJECTED", "Stale · rejected", "refused", "The Service rejected this capture: its receipt belongs to a different run or working directory. Not a verdict."),
  CAPTURE_SUBPROCESS_FAILED: captureAxis("CAPTURE_SUBPROCESS_FAILED", "CAPTURE_SUBPROCESS_FAILED", "Subprocess failed", "refused", "The Service reports that a subprocess of the capture run failed. Not a verdict."),
});

/** The only admission axes that exist. REJECTED_BINDING_MISMATCH is deliberately not labelled "Mismatch": that word is the evaluator's. */
export const ADMISSION_AXES: Readonly<Record<AdmissionStatusCode, AdmissionAxis>> = Object.freeze({
  ADMISSION_NOT_IMPLEMENTED: admissionAxis(
    "NOT_IMPLEMENTED",
    "ADMISSION_NOT_IMPLEMENTED",
    "Not implemented",
    "neutral",
    "No admission record exists for this evaluation. The evaluator received the reviewed fixture directly.",
  ),
  ADMITTED_RUN_BOUND: admissionAxis("ADMITTED_RUN_BOUND", "ADMITTED_RUN_BOUND", "Admitted · run-bound", "positive", "The Service admitted this evaluation against its execution receipt. Not a verdict, and it authenticates nothing outside this Service."),
  REJECTED_STALE_RECEIPT: admissionAxis("REJECTED_STALE_RECEIPT", "REJECTED_STALE_RECEIPT", "Rejected · stale receipt", "refused", "The Service refused the receipt: it does not belong to the current run. A refusal, not a verdict."),
  REJECTED_INCOMPLETE_EXECUTION: admissionAxis("REJECTED_INCOMPLETE_EXECUTION", "REJECTED_INCOMPLETE_EXECUTION", "Rejected · incomplete", "refused", "The Service refused the evidence: the execution did not complete cleanly. A refusal, not a verdict."),
  REJECTED_BINDING_MISMATCH: admissionAxis("REJECTED_BINDING_MISMATCH", "REJECTED_BINDING_MISMATCH", "Rejected · binding", "refused", "The Service refused the receipt: it does not bind to this evaluation’s inputs (REJECTED_BINDING_MISMATCH). A refused binding, not the evaluator’s Mismatch verdict."),
});

export const CAPTURE_NOT_IMPLEMENTED: CaptureAxis = CAPTURE_AXES.CAPTURE_NOT_IMPLEMENTED;
export const ADMISSION_NOT_IMPLEMENTED: AdmissionAxis = ADMISSION_AXES.ADMISSION_NOT_IMPLEMENTED;

/** The axis for an admitted statement. No statement read means nothing is established. */
export function deriveCaptureAxis(facts?: Phase3BView | null): CaptureAxis {
  return facts && Object.hasOwn(CAPTURE_AXES, facts.captureStatus) ? CAPTURE_AXES[facts.captureStatus] : CAPTURE_NOT_IMPLEMENTED;
}

export function deriveAdmissionAxis(facts?: Phase3BView | null): AdmissionAxis {
  return facts && Object.hasOwn(ADMISSION_AXES, facts.admissionStatus) ? ADMISSION_AXES[facts.admissionStatus] : ADMISSION_NOT_IMPLEMENTED;
}

/** Whether this axis is one of the canonical objects. Everything drawn goes through this, so a forged axis fails closed. */
export function isCanonicalAxis(axis: CaptureAxis | AdmissionAxis): boolean {
  const table: Readonly<Record<string, CaptureAxis | AdmissionAxis>> = axis.axis === "capture" ? CAPTURE_AXES : ADMISSION_AXES;
  return axis.status !== undefined && Object.hasOwn(table, axis.status) && table[axis.status] === axis;
}

/** True when the Service reported an outcome, not "not implemented", on either axis. */
export function hasReportedOutcome(facts?: Phase3BView | null): boolean {
  return deriveCaptureAxis(facts) !== CAPTURE_NOT_IMPLEMENTED || deriveAdmissionAxis(facts) !== ADMISSION_NOT_IMPLEMENTED;
}

export interface DeriveWorkspaceStatusAxesInput {
  live?: RunView | null;
  latest?: HistorySummaryView | null;
  entries?: readonly HistorySummaryView[];
  archive?: ArchiveAxis;
  verdict?: VerdictAxis;
  /** Only `archive` and `verdict` are read: a capture or admission axis cannot be supplied. */
  axes?: Partial<StatusAxes>;
}

/**
 * Derives all four workspace status axes (`capture`, `admission`, `archive`, `verdict`). Capture and admission belong to
 * the same evaluation as the verdict shown; with no admitted statement from it they stay not implemented.
 */
export function deriveWorkspaceStatusAxes(input?: DeriveWorkspaceStatusAxesInput | null): StatusAxes {
  const latestEntry = input?.latest ?? input?.entries?.[0] ?? null;

  const archive: ArchiveAxis =
    input?.archive ??
    input?.axes?.archive ??
    (input?.entries ? archiveAxisOf(input.entries) : { axis: "archive", kind: "NOT_ARCHIVED" });

  let verdict: VerdictAxis;
  if (input?.verdict) {
    verdict = input.verdict;
  } else if (input?.axes?.verdict) {
    verdict = input.axes.verdict;
  } else if (latestEntry) {
    verdict = archivedVerdict(latestEntry);
  } else if (input?.live) {
    verdict = {
      axis: "verdict",
      kind: "VERDICT",
      state: input.live.state,
      source: { kind: "live", request: `GET /api/v1/verifications/${input.live.id} (live read)` },
    };
  } else {
    verdict = noVerdict("The archive holds no evaluation of this case. Nothing was evaluated for this page.");
  }

  const facts = verdict.kind === "VERDICT" && verdict.source.kind === "live" ? input?.live?.phase3b : (latestEntry?.phase3b ?? input?.live?.phase3b);
  return { capture: deriveCaptureAxis(facts), admission: deriveAdmissionAxis(facts), archive, verdict };
}

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
