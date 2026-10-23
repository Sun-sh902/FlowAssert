/**
 * Paged history list for one view, on the accepted read lifecycle (useProviderRead: ordered,
 * cancellable, late answers dropped, other snapshots refused) and the pure list rules in
 * src/data/history/listChain.ts. No new state system: one read in flight at a time.
 *
 *  - One hook instance is one list view. A new view (another filter, or an explicit re-read) is a new
 *    instance: the page remounts it with a React key, so nothing from the previous view is carried over.
 *  - The first page is read on mount; older pages only on request (loadMore), each pinned to the first
 *    page's list snapshot.
 *  - A failed or refused FIRST page shows no entries. A failed or refused CONTINUATION keeps the pages
 *    already admitted — each was validated on its own — and says that older entries were not read;
 *    they are never presented as the whole archive.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderResult } from "../data/access";
import { HISTORY_LIMITS } from "../data/history/config";
import { admitListPage, startListChain, type HistoryListChain } from "../data/history/listChain";
import type { FlowAssertHistoryProvider } from "../data/provider";
import type { HistoryListPageView } from "../domain/history";
import { useProviderRead } from "./useProviderRead";

export type HistoryListStatus = "reading" | "more" | "complete" | "failed" | "refused" | "cancelled";

export function useHistoryList(provider: Pick<FlowAssertHistoryProvider, "listHistory">, verificationId: string | undefined) {
  const limit = HISTORY_LIMITS.listPageLimit;
  const [plan, setPlan] = useState<{ cursor: string | null; index: number }>({ cursor: null, index: 0 });
  const [chain, setChain] = useState<HistoryListChain>(() => startListChain(limit, verificationId));
  const [refusal, setRefusal] = useState<{ code: string; message: string } | null>(null);
  // Another provider is another list view: start again from its first page, keeping nothing of the previous one.
  const [listSource, setListSource] = useState(provider);
  if (listSource !== provider) {
    setListSource(provider);
    setPlan({ cursor: null, index: 0 });
    setChain(startListChain(limit, verificationId));
    setRefusal(null);
  }

  const key = String(plan.index);
  // The request (key) the newest read was issued for. Right after the plan changes, the previous
  // page's result is still in state and must not be admitted under the new cursor.
  const issued = useRef<string | null>(null);
  const { state, read, cancel } = useProviderRead<HistoryListPageView>(
    (signal) => {
      issued.current = key;
      return provider.listHistory({ limit, verificationId, cursor: plan.cursor ?? undefined }, signal);
    },
    key,
    { pinnedSnapshotId: plan.index === 0 ? null : chain.listSnapshotId, source: provider },
  );
  const forThisRequest = state.status === "settled" && issued.current === key;
  const handled = useRef<number | null>(null);

  useEffect(() => {
    if (state.status !== "settled" || issued.current !== key) return;
    if (handled.current === state.seq) return;
    handled.current = state.seq;
    const r: ProviderResult<HistoryListPageView> = state.result;
    if (r.kind !== "ready" && r.kind !== "partial") return;
    const step = admitListPage(chain, plan.cursor, r.data);
    if (!step.ok) {
      setRefusal({ code: step.code, message: step.message });
      return;
    }
    setChain(step.chain);
  }, [state, key, chain, plan.cursor]);

  const loadMore = useCallback(() => {
    if (typeof chain.next !== "string" || refusal) return;
    const next = chain.next;
    setPlan((p) => ({ cursor: next, index: p.index + 1 }));
  }, [chain.next, refusal]);

  let status: HistoryListStatus;
  if (refusal) status = "refused";
  else if (state.status === "idle" || state.status === "loading") status = "reading";
  else if (state.status === "cancelled") status = "cancelled";
  else if (!forThisRequest) status = "reading";
  else if (state.result.kind === "error" || state.result.kind === "not_found") status = "failed";
  else if (handled.current !== state.seq) status = "reading";
  else status = chain.next === null ? "complete" : "more";

  const failure = forThisRequest && state.status === "settled" && (state.result.kind === "error" || state.result.kind === "not_found") ? state.result : null;
  return {
    status,
    chain,
    /** True while no page of this view has been admitted. */
    firstPage: chain.pages === 0,
    failure,
    refusal,
    loadMore,
    cancel,
    /** Re-issue the current request (same cursor; a cursor replay returns the same pinned page). */
    retry: read,
  };
}
