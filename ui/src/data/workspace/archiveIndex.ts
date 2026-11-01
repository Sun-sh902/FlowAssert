/**
 * Workspace index over one COMPLETE archive list view (product round 01). Pure.
 *
 * Input: every entry of one list view, admitted page by page under one pinned list snapshot
 * (src/data/history/listChain.ts) and in the Service's order — newest archive entry first.
 * Output: per reviewed case, its archived evaluations in that same order, and the four status axes.
 *
 * Nothing is evaluated here. A case's verdict is the cohort result of its newest archived evaluation,
 * copied from result_summary; counts are tallies of those copied results — never a population, never a
 * new verdict. A case the archive does not hold has NO_VERDICT, not Unverified.
 */
import type { HistorySummaryView } from "../../domain/history";
import { archiveAxisOf, archivedVerdict, deriveAdmissionAxis, deriveCaptureAxis, noVerdict, type StatusAxes } from "../../domain/statusAxes";
import { STATES, type StateCounts } from "../../domain/view";
import { KNOWN_LOCAL_CASES } from "../local/config";

export interface CaseIndexEntry {
  id: string;
  fixture: string;
  /** This case's archived evaluations, newest archive entry first. */
  entries: HistorySummaryView[];
  latest: HistorySummaryView | null;
  axes: StatusAxes;
}

export interface ArchiveIndex {
  cases: CaseIndexEntry[];
  /** Entries in the list view (page.total), all of them read. */
  totalEntries: number;
  listSnapshotId: string;
  /** Tally of the newest archived cohort result per case (copied results). */
  latestByState: StateCounts;
  /** Cases with no archived evaluation. */
  notArchived: number;
  /** Entries whose archive record check the Service did not report as INTEGRITY_VERIFIED. */
  integrityExceptions: number;
  /**
   * Entries for case IDs outside the reviewed five, kept in the index rather than dropped. Not rendered: under the
   * accepted history contract (original_verification_id ^SPEC-00[1-5]$) the decoder refuses such a list page as a
   * whole, so a decoded archive never contains one.
   */
  unexpected: HistorySummaryView[];
  /** Newest archive time in the view, or null when empty. */
  newestArchivedAt: string | null;
}

export function indexArchive(items: readonly HistorySummaryView[], listSnapshotId: string): ArchiveIndex {
  const known = new Set<string>(KNOWN_LOCAL_CASES.map((c) => c.id));
  const latestByState = Object.fromEntries(STATES.map((s) => [s, 0])) as StateCounts;
  let notArchived = 0;
  const cases = KNOWN_LOCAL_CASES.map((c): CaseIndexEntry => {
    const entries = items.filter((e) => e.verificationId === c.id);
    const latest = entries[0] ?? null;
    if (latest) latestByState[latest.result.cohort] += 1;
    else notArchived += 1;
    return {
      id: c.id,
      fixture: c.fixture,
      entries,
      latest,
      // Of the same evaluation as the verdict: the newest archived one, as the Service reported it.
      axes: {
        capture: deriveCaptureAxis(latest?.phase3b),
        admission: deriveAdmissionAxis(latest?.phase3b),
        archive: archiveAxisOf(entries),
        verdict: latest ? archivedVerdict(latest) : noVerdict("The archive holds no evaluation of this case. Nothing was evaluated for this page."),
      },
    };
  });
  return {
    cases,
    totalEntries: items.length,
    listSnapshotId,
    latestByState,
    notArchived,
    integrityExceptions: items.filter((e) => e.integrity.status !== "INTEGRITY_VERIFIED").length,
    unexpected: items.filter((e) => !known.has(e.verificationId)),
    newestArchivedAt: items[0]?.archivedAt ?? null,
  };
}
