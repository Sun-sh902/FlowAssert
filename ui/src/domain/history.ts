/**
 * Phase 3A view models for archived evaluations (LOCAL_RESEARCH history). Produced by
 * src/adapters/historyToView.ts from admitted HistoryList / HistoryDetail bodies; components read only these.
 *
 * Two clocks are kept apart on purpose:
 *   archivedAt          when the Service wrote the archive row (HistorySummary.archive_created_at);
 *   run.local.serviceExecutedAt  when the original evaluation ran (run.evaluation_context.service_executed_at).
 * Research ticks stay synthetic ticks (run.evaluation_context.time_mapping). None of them is the browser clock.
 *
 * Two snapshot namespaces are kept apart on purpose:
 *   snapshotId          the persistent history snapshot (history-snapshot_…) every history read is pinned to;
 *   originalSnapshotId  the ephemeral catalog snapshot of the original evaluation (= run.local.snapshotId).
 */
import type { RunView, StateCounts, VerificationState } from "./view";

/** The Service's own integrity statement, copied (HistoryIntegrity). */
export interface ServiceIntegrityView {
  status: "INTEGRITY_VERIFIED" | "INTEGRITY_FAILED" | "INTEGRITY_UNVERIFIABLE";
  checkedSha256: string | null;
  scope: "archive_candidate_and_relationships" | "evidence_canonical_bytes";
}

export interface HistorySummaryView {
  contractVersion: "phase3a-1.0.0";
  historyId: string;
  archiveId: string;
  snapshotId: string;
  originalSnapshotId: string;
  verificationId: string;
  workspaceId: string;
  archivedAt: string;
  evaluator: { versionLabel: string; sourceCommit: string; modelSha256: string; workspaceDirty: boolean };
  originalContractSha256: string;
  inputEvidenceSha256: string;
  provenance: {
    kind: "synthetic_local";
    researchAuthorization: "research_only";
    acquisitionAuthenticity: "not_authenticated";
    serviceBaselineSha256: string;
    implementationSha256: string;
    sourceSetSha256: string;
    reviewedCase: string;
    reviewedFixtureSha256: string;
    researchSourceCommit: string;
  };
  /** Copied from result_summary. For the list only; the Detail reads records and rules from the archived run. */
  result: { cohort: VerificationState; counts: StateCounts; expectedTotal: number | null; populationKnown: boolean };
  /** The archive record's integrity statement (scope archive_candidate_and_relationships). */
  integrity: ServiceIntegrityView;
  /**
   * Capture and admission of this archived evaluation, as the Service reported them; only
   * src/adapters/phase3bToView.ts sets this, after admission. Null or absent means no statement was read.
   */
  phase3b?: import("./statusAxes").Phase3BView | null;
  workflow_label?: string | null;
}

export interface HistoryDetailView extends HistorySummaryView {
  /** The archived evaluation, through the accepted Phase 2 adapter. Never recomputed. */
  run: RunView;
}

export interface HistoryListPageView {
  items: HistorySummaryView[];
  /** The list view's pinned identity (page.snapshot_id), constant across its continuation pages. */
  listSnapshotId: string;
  nextCursor: string | null;
  /** Archive entries at the pinned boundary — never a source population. */
  total: number;
}
