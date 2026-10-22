/**
 * One history list view: the ordered pages read under one list snapshot (handoff "List continuation
 * retains its original high-water snapshot even across new inserts/restart").
 *
 * Rules:
 *  - the first page fixes the view's page.snapshot_id and page.total; every continuation must echo both;
 *  - each continuation sends the previous page's opaque next_cursor unchanged (the first sends none),
 *    with the same limit and filter;
 *  - entries keep the Service's order — newest archive sequence first. Nothing is re-sorted, merged or
 *    de-duplicated: a repeated history_id, a cycle, an empty page asking to continue, or a chain that
 *    ends with fewer or more entries than page.total is refused;
 *  - only a null next_cursor ends the view; page.total counts archive entries, never a population.
 * A refused page adds nothing. These are pure functions; src/lib/useHistoryList.ts drives them.
 */
import type { HistoryListPageView, HistorySummaryView } from "../../domain/history";
import { HISTORY_LIMITS } from "./config";

export interface HistoryListChain {
  limit: number;
  verificationId: string | undefined;
  /** Fixed by the first page. */
  listSnapshotId: string | null;
  total: number | null;
  items: HistorySummaryView[];
  sent: (string | null)[];
  /** Cursor for the next request: undefined before the first page, null once the view is complete. */
  next: string | null | undefined;
  pages: number;
}

export type ListStep = { ok: true; chain: HistoryListChain } | { ok: false; code: string; message: string };

export function startListChain(limit: number, verificationId?: string): HistoryListChain {
  return { limit, verificationId, listSnapshotId: null, total: null, items: [], sent: [], next: undefined, pages: 0 };
}

const stop = (code: string, message: string): ListStep => ({ ok: false, code, message });

export function admitListPage(chain: HistoryListChain, cursor: string | null, page: HistoryListPageView): ListStep {
  if (chain.next === null) return stop("chain_complete", "The list had already ended; a further page was refused.");
  const expectedCursor = chain.next === undefined ? null : chain.next;
  if (cursor !== expectedCursor) return stop("cursor_out_of_sequence", "A page answered a cursor other than the one this list view sent next.");
  const first = chain.pages === 0;
  if (!first && page.listSnapshotId !== chain.listSnapshotId)
    return stop("snapshot_mismatch", `A continuation belongs to list view ${page.listSnapshotId}, not ${chain.listSnapshotId}. Nothing was merged.`);
  if (!first && page.total !== chain.total) return stop("total_conflict", `page.total changed from ${chain.total} to ${page.total} within one list view.`);
  if (chain.pages + 1 > HISTORY_LIMITS.maxListPages) return stop("page_limit_exceeded", `More than ${HISTORY_LIMITS.maxListPages} pages for one list view.`);
  if (page.items.length > chain.limit) return stop("page_too_large", `${page.items.length} entries exceed the requested limit ${chain.limit}.`);
  if (page.nextCursor !== null && (page.nextCursor === cursor || chain.sent.includes(page.nextCursor)))
    return stop("cursor_cycle", "The service returned a cursor this list view already followed.");
  if (page.items.length === 0 && page.nextCursor !== null) return stop("no_progress", "An empty page asked to continue.");
  const seen = new Set(chain.items.map((x) => x.historyId));
  for (const item of page.items) {
    if (seen.has(item.historyId)) return stop("duplicate_entry", `Archive entry ${item.historyId} was already listed in this view.`);
    seen.add(item.historyId);
    if (chain.verificationId !== undefined && item.verificationId !== chain.verificationId)
      return stop("scope_conflict", `Entry ${item.historyId} is ${item.verificationId}; this view is filtered to ${chain.verificationId}.`);
  }
  const items = [...chain.items, ...page.items];
  const total = first ? page.total : chain.total!;
  if (items.length > total) return stop("extra_entries", `${items.length} entries listed, but page.total is ${total}.`);
  if (page.nextCursor === null && items.length !== total) return stop("omitted_entries", `The list ended after ${items.length} of ${total} archive entries.`);
  return {
    ok: true,
    chain: { ...chain, listSnapshotId: first ? page.listSnapshotId : chain.listSnapshotId, total, items, sent: [...chain.sent, cursor], next: page.nextCursor, pages: chain.pages + 1 },
  };
}
