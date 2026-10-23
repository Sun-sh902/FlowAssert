/**
 * Phase 3A — Verification History (LOCAL_RESEARCH). Two routes:
 *   #/local/history             archived evaluations, listed from the local SQLite archive (?case=SPEC-00N filter)
 *   #/local/history/:historyId  one archived evaluation, drawn with the accepted Detail composition, and its
 *                               archived evidence with separate retrieval and integrity status
 * Every value comes from the Phase 3A history API (src/data/history/provider.ts). Nothing here reads the
 * demo store, the ephemeral verification routes or MOCK data, and nothing recomputes a verdict.
 */
import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArchiveIntegrityFailure, ArchivedEvidencePanel, HistoryProvenance, HistoryReadState } from "../components/history/HistoryEntry";
import { HistoryRows, HistoryRowsSkeleton, shortHistoryId } from "../components/history/HistoryRows";
import { InvalidIdNotice } from "../components/local/InvalidId";
import { LocalModeStamp } from "../components/local/LocalResearch";
import { AccessNotice, CancelledNotice, RetryButton } from "../components/states/AccessStates";
import { PageHead } from "../components/ui/atelier";
import { FilterChips, Panel, buttonClass } from "../components/ui/primitives";
import { ACCESS_COPY } from "../data/access";
import { HISTORY_CONTRACT_VERSION } from "../data/contract/history";
import { HISTORY_CASE_FILTERS, HISTORY_LIMITS, HISTORY_SCOPE, isHistoryCaseFilter } from "../data/history/config";
import { ledgerItems } from "../data/local/evidenceChain";
import { ACCEPTED_EVALUATOR, LOCAL_SERVICE_TARGET } from "../data/local/config";
import { checkHistoryId } from "../data/local/ids";
import { getHistoryProvider, type FlowAssertHistoryProvider } from "../data/provider";
import type { HistoryDetailView } from "../domain/history";
import { assessItem, summarizeIntegrity, type IntegrityState } from "../domain/integrity";
import { formatDateTime, plural, shortDigest } from "../lib/format";
import { href, useReplaceParams, type Location } from "../lib/router";
import { useEvidenceAcquisition } from "../lib/useEvidenceAcquisition";
import { useHistoryList } from "../lib/useHistoryList";
import { useProviderRead } from "../lib/useProviderRead";
import { DetailBody } from "./VerificationDetail";
import { StatusAxesLedger } from "../components/workspace/StatusAxes";
import { ADMISSION_NOT_IMPLEMENTED, CAPTURE_NOT_IMPLEMENTED, archivedVerdict } from "../domain/statusAxes";

type CaseFilter = "all" | (typeof HISTORY_CASE_FILTERS)[number];

/* ======================================================================================
 * List
 * ====================================================================================== */

export function HistoryList({ location, provider = getHistoryProvider("LOCAL_RESEARCH") }: { location: Location; provider?: FlowAssertHistoryProvider }) {
  const setParams = useReplaceParams("/local/history");
  const raw = location.params.get("case");
  const [generation, setGeneration] = useState(0);
  // An unknown filter value is refused, never mapped to another case or silently dropped.
  const invalidFilter = raw !== null && !isHistoryCaseFilter(raw);
  const filter: CaseFilter = raw !== null && isHistoryCaseFilter(raw) ? raw : "all";
  return (
    <div className="space-y-7">
      <PageHead
        kicker={<LocalModeStamp inline />}
        title="Archived evaluations, read from the local archive."
        lede={
          <>
            Every entry is an evaluation the local Python service stored in its SQLite archive, read over HTTP from{" "}
            <span className="mono-id">{LOCAL_SERVICE_TARGET.replace("http://", "")}</span> through this app’s same-origin gate. Verdicts are the archived ones,
            copied unchanged — opening an entry never re-runs the evaluator. Nothing on the demo pages comes from this archive.
          </>
        }
        aside={
          <dl className="fa-ledger text-[12.5px]" aria-label="Archive scope">
            {(
              [
                ["Provider", "LOCAL_RESEARCH · SQLite"],
                ["Workspace", HISTORY_SCOPE.workspaceId],
                ["Contract", HISTORY_CONTRACT_VERSION],
                ["Evaluator", `${shortDigest(ACCEPTED_EVALUATOR.model_sha256)}`],
                ["Authorization", "research_only"],
                ["Order", "newest archive entry first"],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 py-[7px]">
                <dt className="text-ink-3">{k}</dt>
                <dd className="text-right font-mono text-[11.5px] text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        }
      />
      {invalidFilter ? (
        <AccessNotice
          state="REQUEST_ERROR"
          title="This address names an unknown case filter"
          body={`The case filter ${JSON.stringify(raw)} is not one the archive contract accepts (SPEC-001 … SPEC-005). It was refused before any request was built; nothing was sent and no other filter was substituted.`}
          facts={[
            ["Filter as written", JSON.stringify(raw)],
            ["Request", "none sent"],
          ]}
          actions={
            <a className={buttonClass("default", "sm")} href="#/local/history">
              Show all archive entries
            </a>
          }
        />
      ) : (
        <HistoryListView
          key={`${filter}|${generation}`}
          provider={provider}
          filter={filter}
          onFilter={(v) => setParams({ case: v === "all" ? null : v })}
          onReread={() => setGeneration((g) => g + 1)}
        />
      )}
      <p className="max-w-[760px] text-xs leading-[1.55] text-ink-3">
        <b className="font-semibold text-ink-2">Archive time is not evaluation time.</b> “Archived” is when the service wrote the entry; each entry’s page also
        shows when its evaluation ran, on synthetic research ticks. The entry count is the number of archive entries at the moment this list was first read — new
        entries appear only after a re-read — and never a source population. One case can have several archived evaluations; the history ID identifies each.
        If the local service is not running, this page shows <b className="font-semibold text-ink-2">Service unavailable</b> — never demo data in its place.
      </p>
    </div>
  );
}

function HistoryListView({
  provider,
  filter,
  onFilter,
  onReread,
}: {
  provider: FlowAssertHistoryProvider;
  filter: CaseFilter;
  onFilter: (v: CaseFilter) => void;
  onReread: () => void;
}) {
  const list = useHistoryList(provider, filter === "all" ? undefined : filter);
  const { chain } = list;
  const shown = chain.items.length;

  useEffect(() => {
    document.title = "History — Local research — FlowAssert";
  }, []);

  const filters = (
    <FilterChips<CaseFilter>
      label="Filter archive entries by case"
      value={filter}
      onChange={onFilter}
      options={[{ value: "all", label: "All cases" }, ...HISTORY_CASE_FILTERS.map((c) => ({ value: c as CaseFilter, label: c }))]}
    />
  );
  const reread = (
    <button type="button" className={buttonClass("ghost", "sm")} onClick={onReread}>
      <RotateCcw size={12} aria-hidden /> Re-read from newest
    </button>
  );

  let body: ReactNode;
  const f = list.failure;
  if (list.firstPage && (list.status === "reading" || list.status === "more" || list.status === "complete")) {
    body = (
      <>
        <HistoryRowsSkeleton />
        <div className="border-t border-line-subtle px-4 py-3 sm:px-5">
          <button type="button" className={buttonClass("ghost", "sm")} onClick={list.cancel}>
            Cancel read
          </button>
        </div>
      </>
    );
  } else if (list.firstPage && list.status === "cancelled") {
    body = (
      <div className="p-4 sm:p-5">
        <CancelledNotice what="the archive list" onRetry={onReread} />
      </div>
    );
  } else if (list.firstPage && (list.status === "failed" || list.status === "refused")) {
    body = <div className="p-4 sm:p-5">{listFailure(f, list.refusal, onReread, true)}</div>;
  } else if (chain.total === 0) {
    body = (
      <div className="p-4 sm:p-5">
        <AccessNotice
          state="EMPTY"
          title={filter === "all" ? "The local archive holds no evaluations" : `No archived evaluation of ${filter}`}
          body={`The read succeeded and the archive returned no entries (total 0${filter === "all" ? "" : ` for ${filter}`}). An empty archive is not Verified and is not a failed verification — nothing has been archived${filter === "all" ? " yet" : " for this case"}.`}
          facts={[
            ["Entries", "0"],
            ["List view", chain.listSnapshotId ?? "—"],
          ]}
          actions={reread}
        />
      </div>
    );
  } else {
    const more = typeof chain.next === "string";
    let status: string;
    if (list.status === "reading") status = `Reading older entries · ${shown} of ${chain.total} archive entries shown`;
    else if (list.status === "more") status = `${shown} of ${chain.total} archive entries shown · ${plural(chain.pages, "page")} · older entries remain`;
    else if (list.status === "complete") status = `All ${chain.total} archive entries shown · ${plural(chain.pages, "page")}, in archive order`;
    else if (list.status === "cancelled") status = `${shown} of ${chain.total} archive entries shown · reading older entries was cancelled`;
    else status = `${shown} of ${chain.total} archive entries shown · older entries could not be read`;
    body = (
      <>
        <HistoryRows entries={chain.items} caption={`Archived evaluations, newest archive entry first${filter === "all" ? "" : ` · ${filter}`}`} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-subtle px-4 py-3 sm:px-5">
          <p role="status" aria-live="polite" className="min-w-0 flex-1 font-mono text-[11px] text-ink-2" data-list-status={list.status}>
            {status}
            <span className="block text-ink-3" title={chain.listSnapshotId ?? undefined}>
              list view {chain.listSnapshotId ? `${chain.listSnapshotId.slice(0, 13)}…${chain.listSnapshotId.slice(-4)}` : "—"} · {HISTORY_LIMITS.listPageLimit} per page
            </span>
          </p>
          {list.status === "reading" && (
            <button type="button" className={buttonClass("ghost", "sm")} onClick={list.cancel}>
              Cancel
            </button>
          )}
          {list.status === "more" && more && (
            <button type="button" className={buttonClass("default", "sm")} onClick={list.loadMore}>
              Load older entries
            </button>
          )}
          {list.status === "failed" && f?.kind === "error" && f.access === "SERVICE_UNAVAILABLE" && !f.integrity && <RetryButton onRetry={list.retry} label="Retry older entries" />}
          {reread}
        </div>
        {(list.status === "failed" || list.status === "refused") && <div className="border-t border-line-subtle p-4 sm:p-5">{listFailure(f, list.refusal, onReread, false)}</div>}
      </>
    );
  }

  return (
    <Panel
      title={
        chain.total === null ? (
          "Archive entries"
        ) : (
          <span className="tabular">
            {shown} <span className="text-ink-3">of {plural(chain.total, "archive entry", "archive entries")}</span>
          </span>
        )
      }
      description="In the order the archive returned them — newest archive entry first. Opening an entry reads it again from the archive."
    >
      <div className="border-b border-line-subtle px-3 py-2.5 sm:px-4">{filters}</div>
      {body}
    </Panel>
  );
}

function listFailure(
  f: ReturnType<typeof useHistoryList>["failure"],
  refusal: { code: string; message: string } | null,
  onReread: () => void,
  first: boolean,
): ReactNode {
  const reread = (
    <button type="button" className={buttonClass("default", "sm")} onClick={onReread}>
      <RotateCcw size={12} aria-hidden /> Re-read from newest
    </button>
  );
  if (refusal)
    return (
      <AccessNotice
        state="REQUEST_ERROR"
        title={first ? "The archive list was refused" : "Older archive entries were refused"}
        body={`${refusal.message} ${first ? "Nothing was shown." : "The entries above were admitted page by page and are kept; nothing from the refused page was added."}`}
        facts={[["Code", refusal.code]]}
        actions={reread}
      />
    );
  if (!f) return null;
  if (f.kind === "not_found") return <AccessNotice state="NOT_FOUND" body="The archive list answered 404. No entry is shown." actions={reread} />;
  if (f.integrity)
    return <ArchiveIntegrityFailure failure={f} subject={first ? "archive list" : "older entries"} headingLevel={2} actions={reread} />;
  const facts: [string, string][] = [["Code", f.code]];
  if (f.httpStatus !== undefined) facts.push(["HTTP", String(f.httpStatus)]);
  if (f.requestId) facts.push(["Request ID", f.requestId]);
  facts.push(["MOCK fallback", "none — no other data source is used"]);
  const cursor = f.code === "invalid_cursor" || f.code === "cursor_query_conflict";
  return (
    <AccessNotice
      state={f.access}
      title={first ? undefined : cursor ? "The service rejected the continuation cursor" : "Older archive entries could not be read"}
      body={`${ACCESS_COPY[f.access].body} ${f.message}${first ? "" : " The entries above are kept as read; they are not the whole archive."}`}
      facts={facts}
      actions={reread}
    />
  );
}

/* ======================================================================================
 * Entry
 * ====================================================================================== */

export function HistoryEntry({ id, location, provider = getHistoryProvider("LOCAL_RESEARCH") }: { id: string; location: Location; provider?: FlowAssertHistoryProvider }) {
  // P2-AUD-003: the history ID is admitted before any read exists; a refused ID never reaches the provider.
  const admitted = checkHistoryId(id);
  if (!admitted.ok) return <InvalidIdNotice kind="history" raw={id} reason={admitted.reason} back={{ href: "#/local/history", label: "All history" }} />;
  return <HistoryEntryRead id={id} location={location} provider={provider} />;
}

function HistoryEntryRead({ id, location, provider }: { id: string; location: Location; provider: FlowAssertHistoryProvider }) {
  const [generation, setGeneration] = useState(0);
  const { state, read, cancel } = useProviderRead((signal) => provider.getHistory(id, {}, signal), `${id}#${generation}`, { source: provider });
  const detail = state.status === "settled" && state.result.kind === "ready" ? state.result.data : null;

  useEffect(() => {
    document.title = detail ? `${detail.verificationId} · archived ${shortHistoryId(detail.historyId)} — History — FlowAssert` : `${shortHistoryId(id)} — History — FlowAssert`;
  }, [detail, id]);

  // A Detail that is not the one this route names is never drawn (defence in depth; the decoder already checks).
  if (!detail || detail.historyId !== id || !detail.run.local) return <HistoryReadState id={id} state={state} onRetry={read} onCancel={cancel} />;
  return <HistoryEntryLoaded key={`${detail.snapshotId}#${generation}`} detail={detail} location={location} provider={provider} onReread={() => setGeneration((g) => g + 1)} />;
}

function HistoryEntryLoaded({ detail, location, provider, onReread }: { detail: HistoryDetailView; location: Location; provider: FlowAssertHistoryProvider; onReread: () => void }) {
  const local = detail.run.local!;
  const binding = useMemo(
    () => ({
      historyId: detail.historyId,
      snapshotId: detail.snapshotId,
      archiveId: detail.archiveId,
      originalSnapshotId: detail.originalSnapshotId,
      originalVerificationId: detail.verificationId,
    }),
    [detail],
  );
  // The accepted evidence hook reads through this archive reader: every page is bound to this Detail.
  const reader = useMemo(
    () => ({
      getEvidence: (historyId: string, q: { limit?: number; includePayload?: boolean; cursor?: string }, signal?: AbortSignal) =>
        provider.getHistoryEvidence(historyId, { binding, limit: q.limit ?? HISTORY_LIMITS.evidencePageLimit, includePayload: q.includePayload ?? true, cursor: q.cursor }, signal),
    }),
    [provider, binding],
  );
  // No onSnapshotUnavailable: a 409 history_snapshot_conflict never triggers a read by itself (no falling forward);
  // the panel offers an explicit re-read of the whole entry.
  const acq = useEvidenceAcquisition(reader, detail.historyId, local.evidenceReferences, detail.snapshotId, HISTORY_LIMITS.evidencePageLimit);
  const items = ledgerItems(acq.chain, local.evidenceReferences);
  const integrity = summarizeIntegrity(items.map(assessItem), acq.status === "complete");
  const f = acq.status === "failed" && acq.failure?.kind === "error" ? acq.failure : null;
  const evidenceState: IntegrityState = f?.integrity === "INTEGRITY_FAILED" ? "failed" : f?.integrity === "INTEGRITY_UNVERIFIABLE" ? "unverifiable" : integrity.state;

  return (
    <div data-history-entry={detail.historyId}>
      <HistoryProvenance detail={detail} evidence={evidenceState} onReread={onReread} />
      <DetailBody
        status={
          <StatusAxesLedger
            axes={{
              capture: CAPTURE_NOT_IMPLEMENTED,
              admission: ADMISSION_NOT_IMPLEMENTED,
              archive: { axis: "archive", kind: "THIS_ENTRY", historyId: detail.historyId, archivedAt: detail.archivedAt, integrity: detail.integrity.status },
              verdict: archivedVerdict(detail),
            }}
          />
        }
        run={detail.run}
        location={location}
        basePath={`/local/history/${detail.historyId}`}
        previousRunLink={false}
        evidence={<ArchivedEvidencePanel detail={detail} acq={acq} items={items} integrity={integrity} onReread={onReread} />}
      />
      <p className="mt-6 text-xs leading-[1.5] text-ink-3">
        Archived {formatDateTime(detail.archivedAt)} · <a className="fa-hit underline decoration-line-strong underline-offset-[3px] hover:text-ink" href={href("/local/history", { case: detail.verificationId })}>other archived evaluations of {detail.verificationId}</a>
        {isHistoryCaseFilter(detail.verificationId) && (
          <>
            {" "}
            ·{" "}
            <a className="fa-hit underline decoration-line-strong underline-offset-[3px] hover:text-ink" href={href(`/local/verifications/${detail.verificationId}`)}>
              current result of {detail.verificationId}
            </a>{" "}
            (its page shows whether it matches this entry exactly)
          </>
        )}
      </p>
    </div>
  );
}
