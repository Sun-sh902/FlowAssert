/**
 * The whole archive list, read to its end and indexed by case (product round 01).
 *
 * Drives the accepted list hook (useHistoryList: ordered, cancellable, pinned list snapshot, refused pages
 * add nothing) and requests each continuation as soon as the previous page is admitted. The index exists
 * only once the view is COMPLETE: a partially read archive never produces per-case results, because a case
 * missing from the pages read so far is unknown, not "not archived".
 */
import { useEffect, useMemo } from "react";
import { indexArchive, type ArchiveIndex } from "../data/workspace/archiveIndex";
import type { FlowAssertHistoryProvider } from "../data/provider";
import { useHistoryList } from "./useHistoryList";

export type ArchiveIndexState =
  | { status: "reading"; pagesRead: number; entriesRead: number; total: number | null; cancel: () => void }
  | { status: "ready"; index: ArchiveIndex; pages: number }
  | { status: "cancelled" }
  | { status: "failed"; failure: NonNullable<ReturnType<typeof useHistoryList>["failure"]> | null; refusal: { code: string; message: string } | null; pagesRead: number };

export function useArchiveIndex(provider: Pick<FlowAssertHistoryProvider, "listHistory">): ArchiveIndexState {
  const list = useHistoryList(provider, undefined);
  const { status, chain, loadMore } = list;

  useEffect(() => {
    if (status === "more") loadMore();
  }, [status, loadMore]);

  const index = useMemo(
    () => (status === "complete" && chain.listSnapshotId !== null ? indexArchive(chain.items, chain.listSnapshotId) : null),
    [status, chain.items, chain.listSnapshotId],
  );

  if (index) return { status: "ready", index, pages: chain.pages };
  if (status === "cancelled") return { status: "cancelled" };
  if (status === "failed" || status === "refused") return { status: "failed", failure: list.failure, refusal: list.refusal, pagesRead: chain.pages };
  return { status: "reading", pagesRead: chain.pages, entriesRead: chain.items.length, total: chain.total, cancel: list.cancel };
}
