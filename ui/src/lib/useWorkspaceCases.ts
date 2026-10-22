/**
 * The workspace's known cases, each with its live result, its archived evaluations and their comparison
 * (product round 02). Two read paths, both bounded: ONE archive list view read to its end (useArchiveIndex), and one
 * live Detail read per known case with at most LIVE_CONCURRENCY in flight (useLiveCases). Each case settles on its
 * own; a failed side is reported on that side and in the comparison, never turned into a verdict.
 */
import { useMemo } from "react";
import { KNOWN_LOCAL_CASES } from "../data/local/config";
import type { FlowAssertHistoryProvider, FlowAssertReadProvider } from "../data/provider";
import type { ArchiveIndex } from "../data/workspace/archiveIndex";
import { compareCase, type ArchiveSide, type CaseComparison, type LiveSide, type SideFailure } from "../data/workspace/comparison";
import type { HistorySummaryView } from "../domain/history";
import { useArchiveIndex, type ArchiveIndexState } from "./useArchiveIndex";
import { useLiveCases } from "./useLiveCases";

export interface WorkspaceCase {
  id: string;
  fixture: string;
  live: LiveSide;
  archive: ArchiveSide;
  entries: HistorySummaryView[];
  comparison: CaseComparison;
}

const IDS = KNOWN_LOCAL_CASES.map((c) => c.id);

function archiveFailure(s: Extract<ArchiveIndexState, { status: "failed" }>): SideFailure {
  if (s.refusal) return { code: s.refusal.code, message: s.refusal.message, transport: false, integrity: false };
  const f = s.failure;
  if (f?.kind === "error") return { code: f.code, message: f.message, transport: f.access === "SERVICE_UNAVAILABLE" && !f.integrity, integrity: !!f.integrity };
  return { code: "not_found", message: "The archive list answered 404.", transport: false, integrity: false };
}

export function useWorkspaceCases(history: FlowAssertHistoryProvider, live: Pick<FlowAssertReadProvider, "getVerification">, generation: number) {
  const archiveState = useArchiveIndex(history);
  const { sides, cancel: cancelLive } = useLiveCases(live, IDS, generation);

  const index: ArchiveIndex | null = archiveState.status === "ready" ? archiveState.index : null;
  const cases = useMemo(
    () =>
      KNOWN_LOCAL_CASES.map((c): WorkspaceCase => {
        const entries = index?.cases.find((x) => x.id === c.id)?.entries ?? [];
        const archive: ArchiveSide =
          archiveState.status === "ready"
            ? { kind: "ready", entries }
            : archiveState.status === "failed"
              ? { kind: "failed", failure: archiveFailure(archiveState) }
              : archiveState.status === "cancelled"
                ? { kind: "cancelled" }
                : { kind: "reading" };
        const l = sides[c.id] ?? { kind: "reading" };
        return { id: c.id, fixture: c.fixture, live: l, archive, entries, comparison: compareCase(l, archive) };
      }),
    [archiveState, index, sides],
  );

  const reading = archiveState.status === "reading" || cases.some((c) => c.live.kind === "reading");
  const allUnreachable =
    !reading &&
    archiveState.status === "failed" &&
    archiveFailure(archiveState).transport &&
    cases.every((c) => c.live.kind === "failed" && c.live.failure.transport);
  const cancel = () => {
    if (archiveState.status === "reading") archiveState.cancel();
    cancelLive();
  };
  return { cases, archiveState, index, reading, allUnreachable, cancel };
}
