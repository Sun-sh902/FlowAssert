/**
 * Phase 3A adapter: admitted history bodies (src/data/history/decode.ts) → view models.
 *
 * Copies, never derives: cohort state, counts, expected total and population flag come from the
 * archive; the archived run goes through the accepted Phase 2 adapter (wireToRunView) unchanged, so
 * records, rule outcomes, record order, evidence references and times are exactly the archived ones.
 * Nothing here imports the demo fixtures, the demo clock, the demo store or the MOCK adapter.
 */
import type { HistoryDetailDTO, HistoryIntegrityDTO, HistoryItemDTO, HistoryListDTO, HistorySummaryDTO } from "../data/contract/history";
import type { EvidenceReferenceView } from "../domain/evidence";
import type { HistoryDetailView, HistoryListPageView, HistorySummaryView, ServiceIntegrityView } from "../domain/history";
import { toEvidenceReferenceView, wireToRunView } from "./wireToView";

export const toServiceIntegrity = (i: HistoryIntegrityDTO): ServiceIntegrityView => ({ status: i.status, checkedSha256: i.checked_sha256, scope: i.content_scope });

export function toHistorySummaryView(s: HistorySummaryDTO): HistorySummaryView {
  return {
    contractVersion: s.contract_version,
    historyId: s.history_id,
    archiveId: s.archive_id,
    snapshotId: s.snapshot_id,
    originalSnapshotId: s.original_snapshot_id,
    verificationId: s.original_verification_id,
    workspaceId: s.workspace_id,
    archivedAt: s.archive_created_at,
    evaluator: { versionLabel: s.evaluator.version_label, sourceCommit: s.evaluator.source_commit, modelSha256: s.evaluator.model_sha256, workspaceDirty: s.evaluator.workspace_dirty },
    originalContractSha256: s.original_contract_sha256,
    inputEvidenceSha256: s.input_evidence_sha256,
    provenance: {
      kind: s.provenance.kind,
      researchAuthorization: s.provenance.research_authorization,
      acquisitionAuthenticity: s.provenance.acquisition_authenticity,
      serviceBaselineSha256: s.provenance.service_baseline_sha256,
      implementationSha256: s.provenance.implementation_sha256,
      sourceSetSha256: s.provenance.source_set_sha256,
      reviewedCase: s.provenance.reviewed_case,
      reviewedFixtureSha256: s.provenance.reviewed_fixture_sha256,
      researchSourceCommit: s.provenance.research_source_commit,
    },
    result: {
      cohort: s.result_summary.cohort_state,
      counts: { ...s.result_summary.counts },
      expectedTotal: s.result_summary.expected_total,
      populationKnown: s.result_summary.source_population_known,
    },
    integrity: toServiceIntegrity(s.integrity),
  };
}

export function toHistoryListPageView(list: HistoryListDTO): HistoryListPageView {
  return { items: list.items.map(toHistorySummaryView), listSnapshotId: list.page.snapshot_id, nextCursor: list.page.next_cursor, total: list.page.total };
}

export function toHistoryDetailView(d: HistoryDetailDTO): HistoryDetailView {
  const { run, ...summary } = d;
  return { ...toHistorySummaryView(summary), run: wireToRunView(run) };
}

/** One archived evidence item, with its payload outcome supplied by the provider. */
export function toArchivedEvidenceView(item: HistoryItemDTO, payload: EvidenceReferenceView["payload"]): EvidenceReferenceView {
  return { ...toEvidenceReferenceView(item.reference), payload, serviceIntegrity: toServiceIntegrity(item.integrity) };
}
