/**
 * Design-lab data access. Reuses the production view models unchanged — the concepts
 * visualise exactly the same demo data and semantics as the working app.
 */
import { cohortCounts, getRun, lastEvaluatedAt, latestRuns, runs, sumCounts, trend, workflowSummaries } from "../data/store";
import type { RecordView, RunView, VerificationState } from "../domain/view";

export { cohortCounts, lastEvaluatedAt, latestRuns, runs, sumCounts, trend, workflowSummaries };

export const DETAIL_RUN_ID = "VR-2025";
export const detailRun: RunView = getRun(DETAIL_RUN_ID)!;

const PRIORITY: Record<VerificationState, number> = { Mismatch: 0, Unverified: 1, Pending: 2, Verified: 3 };

export function orderedRecords(run: RunView): RecordView[] {
  return [...run.records].sort((a, b) => PRIORITY[a.state] - PRIORITY[b.state] || a.sourceRow - b.sourceRow);
}

/** Records in source-row order — the order the cohort was captured in. */
export function rowOrder(run: RunView): RecordView[] {
  return [...run.records].sort((a, b) => a.sourceRow - b.sourceRow);
}

export const attention = {
  mismatch: latestRuns.filter((r) => r.state === "Mismatch"),
  unverified: latestRuns.filter((r) => r.state === "Unverified"),
  pending: latestRuns.filter((r) => r.state === "Pending"),
  verified: latestRuns.filter((r) => r.state === "Verified"),
};

const MISMATCH_ISSUES = new Set(["Phone differs", "Email differs", "Phone & Email differs", "Missing after deadline", "Duplicate contacts"]);
export function mismatchIssues(run: RunView) {
  return run.issueBreakdown.filter((b) => MISMATCH_ISSUES.has(b.label));
}

export function unverifiedReason(run: RunView): string {
  if (run.accessDenied) return "HubSpot read access denied";
  if (!run.populationKnown) return "Source total unconfirmed";
  return `${run.counts.Unverified} records lack evidence`;
}

const MS_MIN = 60000;

/** The lab draws MOCK fixtures only, whose times always exist. An unavailable time is refused, never drawn at zero. */
export function labTime(iso: string | null): number {
  if (iso === null) throw new Error("The art-direction lab renders MOCK fixtures only; an unavailable time cannot be placed.");
  return Date.parse(iso);
}

/** Proportional position of an instant inside a run's evidence window (capture → evaluation). */
export function timeFraction(run: RunView, iso: string | null): number {
  const start = labTime(run.capturedAt);
  const end = Math.max(labTime(run.evaluatedAt), labTime(run.deadline));
  return (labTime(iso) - start) / Math.max(MS_MIN, end - start);
}
