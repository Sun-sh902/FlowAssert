/**
 * Phase 3A presentation of one archived evaluation: its read states, the archive provenance band
 * and the archived-evidence panel. Built from the existing Evidence Atelier parts (AccessNotice,
 * DetailSkeleton, EvidenceLedger, Panel, Segmented, the dashed register frame) plus the integrity
 * vocabulary (components/integrity). The verdict itself is drawn by the accepted DetailBody.
 */
import { ArrowLeft, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { ACCESS_COPY, type ProviderResult, type ReadState } from "../../data/access";
import { chainComplete } from "../../data/local/evidenceChain";
import { LOCAL_SERVICE_TARGET } from "../../data/local/config";
import type { EvidenceReferenceView } from "../../domain/evidence";
import type { HistoryDetailView } from "../../domain/history";
import type { IntegrityState, IntegritySummary } from "../../domain/integrity";
import { cn } from "../../lib/cn";
import { formatDateTime, plural, shortDigest } from "../../lib/format";
import type { useEvidenceAcquisition } from "../../lib/useEvidenceAcquisition";
import { EvidenceStatus, IntegrityGlyph, IntegrityNotice, IntegritySeal, IntegrityTag, integrityText } from "../integrity/Integrity";
import { LocalModeStamp } from "../local/LocalResearch";
import { AccessNotice, CancelledNotice, RetryButton } from "../states/AccessStates";
import { EvidenceLedger } from "../states/EvidenceLedger";
import { DetailSkeleton } from "../states/Skeletons";
import { Segmented } from "../ui/atelier";
import { Disclosure, Panel, Tag, buttonClass } from "../ui/primitives";
import { shortHistoryId } from "./HistoryRows";

const PROVIDER_FACT = `LOCAL_RESEARCH · SQLite archive · ${LOCAL_SERVICE_TARGET.replace("http://", "")} via same-origin gate`;
const ALL_HISTORY = "#/local/history";

const short = (id: string, keep = 18) => (id.length > keep + 8 ? `${id.slice(0, keep)}…${id.slice(-4)}` : id);

/** The mode, always, plus the archive register. */
export function HistoryStamp({ className }: { className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1", className)}>
      <LocalModeStamp inline />
      <Tag tone="neutral">archived evaluation</Tag>
    </p>
  );
}

/* ---------- Read states (no archived entry yet) ---------- */

export type Failure = Extract<ProviderResult<never>, { kind: "error" }>;

/** An integrity failure reported by the Service (503 details) or by this frontend's admission of a 200. */
export function ArchiveIntegrityFailure({ failure, subject, headingLevel = 1, actions }: { failure: Failure; subject: ReactNode; headingLevel?: 1 | 2 | 3; actions?: ReactNode }) {
  const failed = failure.integrity === "INTEGRITY_FAILED";
  const facts: [string, ReactNode][] = [
    ["Integrity", failure.integrity!],
    ["Code", failure.code],
    ["HTTP", failure.httpStatus === undefined ? "—" : String(failure.httpStatus)],
  ];
  if (failure.requestId) facts.push(["Request ID", failure.requestId]);
  facts.push(["MOCK fallback", "none — no other data source is used"]);
  return (
    <IntegrityNotice
      outcome={failed ? "failed" : "unverifiable"}
      headingLevel={headingLevel}
      title={failed ? <>Stored content failed internal consistency verification · {subject}</> : <>Stored content could not be verified · {subject}</>}
      body={
        failed ? (
          <>
            The local service compared the archive’s stored canonical bytes with their recorded digests and relationships, and they do not agree (
            <span className="mono-id">{failure.code}</span>). Nothing from this archive is shown as a result: an integrity failure is not a Mismatch, not
            Unverified and not a fresh evaluation. The archive is not repaired or re-read from anywhere else.
          </>
        ) : (
          <>
            The local service could not complete its stored-content check (<span className="mono-id">{failure.code}</span>) — required bytes or state could not be
            read. Nothing is shown as verified, and nothing is shown as a result. This is not a Mismatch and not Unverified.
          </>
        )
      }
      facts={facts}
      actions={actions}
      verdictLine="verdict · none shown — integrity describes stored evidence, not the evaluation."
    />
  );
}

export function HistoryReadState({ id, state, onRetry, onCancel }: { id: string; state: ReadState<HistoryDetailView>; onRetry: () => void; onCancel: () => void }) {
  if (state.status === "idle" || state.status === "loading")
    return (
      <div>
        <HistoryStamp className="mb-5" />
        <DetailSkeleton runId={shortHistoryId(id)} label={`Reading archived evaluation ${id} from the local archive. No result is shown until the read completes.`} />
        <div className="mt-4">
          <button type="button" className={buttonClass("ghost", "sm")} onClick={onCancel}>
            Cancel read
          </button>
        </div>
      </div>
    );
  if (state.status === "cancelled")
    return (
      <div>
        <HistoryStamp className="mb-5" />
        <CancelledNotice what={`archived entry ${shortHistoryId(id)}`} onRetry={onRetry} />
      </div>
    );
  const r = state.result as Exclude<ProviderResult<HistoryDetailView>, { kind: "ready" | "partial" }> | Extract<ProviderResult<HistoryDetailView>, { kind: "ready" | "partial" }>;
  const back = (
    <a className={buttonClass("default", "sm")} href={ALL_HISTORY}>
      All history
    </a>
  );
  const facts: [string, ReactNode][] = [
    ["History ID", id],
    ["Provider", PROVIDER_FACT],
  ];
  if (r.kind === "not_found") {
    if (r.requestId) facts.push(["Request ID", r.requestId]);
    return (
      <div>
        <HistoryStamp className="mb-5" />
        <AccessNotice
          state="NOT_FOUND"
          headingLevel={1}
          title={
            <>
              No archived entry <span className="mono-id text-[22px]">{shortHistoryId(id)}</span>
            </>
          }
          body="The local service answered 404 history_not_found. No archive entry has this identity; nothing was evaluated and no record is missing because of it."
          facts={facts}
          actions={back}
        />
      </div>
    );
  }
  if (r.kind === "error") {
    if (r.integrity)
      return (
        <div>
          <HistoryStamp className="mb-5" />
          <ArchiveIntegrityFailure
            failure={r}
            subject={<span className="mono-id text-[20px]">{shortHistoryId(id)}</span>}
            actions={
              <>
                <RetryButton onRetry={onRetry} label="Read again" />
                {back}
              </>
            }
          />
        </div>
      );
    facts.push(["Code", r.code]);
    if (r.httpStatus !== undefined) facts.push(["HTTP", String(r.httpStatus)]);
    if (r.requestId) facts.push(["Request ID", r.requestId]);
    facts.push(["MOCK fallback", "none — no other data source is used"]);
    return (
      <div>
        <HistoryStamp className="mb-5" />
        <AccessNotice
          state={r.access}
          headingLevel={1}
          body={`${ACCESS_COPY[r.access].body} ${r.message}`}
          facts={facts}
          actions={
            <>
              <RetryButton onRetry={onRetry} label="Read again" />
              {back}
            </>
          }
        />
      </div>
    );
  }
  return null;
}

/* ---------- Provenance band ---------- */

const INTEGRITY_SENTENCE: Record<IntegrityState, string> = {
  verified: "Every archived evidence reference was retrieved; the Service’s stored-byte check and this browser’s SHA-256 agree for each.",
  failed: "At least one archived evidence item failed internal consistency verification. See Archived evidence.",
  unverifiable: "Not every archived evidence item could be verified. See Archived evidence for the reason.",
  pending: "Evidence integrity is established only once every archived evidence page has been retrieved and checked.",
};

export function HistoryProvenance({ detail, evidence, onReread }: { detail: HistoryDetailView; evidence: IntegrityState; onReread: () => void }) {
  const p = detail.provenance;
  const local = detail.run.local!;
  const bound = detail.integrity.status === "INTEGRITY_VERIFIED" && detail.integrity.checkedSha256 === detail.historyId.slice(5);
  const facts: [string, ReactNode, string?][] = [
    ["History ID", <span title={detail.historyId}>{shortHistoryId(detail.historyId)}</span>, "history_id — route key; binds the archive candidate bytes"],
    ["Archive", <span title={detail.archiveId}>{short(detail.archiveId, 16)}</span>, "archive_id"],
    ["History snapshot", <span title={detail.snapshotId}>{short(detail.snapshotId, 22)}</span>, "snapshot_id — persistent; every history read is pinned to it"],
    ["Verification", detail.verificationId, "original_verification_id — not unique across evaluations; the history ID is"],
    ["Original snapshot", <span title={detail.originalSnapshotId}>{short(detail.originalSnapshotId, 18)}</span>, "original_snapshot_id = run.snapshot_id — the original catalog snapshot, a different namespace"],
    ["Archived at", formatDateTime(detail.archivedAt), "archive_created_at — when the archive row was written"],
    ["Evaluated at", formatDateTime(local.serviceExecutedAt), "run.evaluation_context.service_executed_at — when the original evaluation ran"],
    ["Evaluator", detail.evaluator.versionLabel, "evaluator.version_label"],
    ["Evaluator source", `${detail.evaluator.sourceCommit.slice(0, 12)}${detail.evaluator.workspaceDirty ? " · dirty" : ""}`],
    ["Model sha256", <span title={detail.evaluator.modelSha256}>{shortDigest(detail.evaluator.modelSha256)}</span>],
    ["Provenance", `${p.kind} · ${p.researchAuthorization}`],
    ["Acquisition", p.acquisitionAuthenticity.replace("_", " ")],
    ["Reviewed case", p.reviewedCase],
    ["Fixture sha256", <span title={p.reviewedFixtureSha256}>{shortDigest(p.reviewedFixtureSha256)}</span>],
    ["Implementation", <span title={p.implementationSha256}>{shortDigest(p.implementationSha256)}</span>, "provenance.implementation_sha256"],
    ["Source set", <span title={p.sourceSetSha256}>{shortDigest(p.sourceSetSha256)}</span>, "provenance.source_set_sha256"],
    ["Contract", `${detail.contractVersion} · run v1 ${local.contractVersion}`],
  ];
  return (
    <section aria-label="Archive provenance" className="mb-7">
      <div className="rounded-sm border border-dashed border-line-strong px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <HistoryStamp />
          <span className="flex flex-wrap items-center gap-2">
            <a className={buttonClass("ghost", "sm")} href={ALL_HISTORY}>
              <ArrowLeft size={12} aria-hidden /> All history
            </a>
            <button type="button" className={buttonClass("ghost", "sm")} onClick={onReread}>
              <RotateCcw size={12} aria-hidden /> Re-read entry
            </button>
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] sm:gap-x-6 lg:grid-cols-3 xl:grid-cols-4">
          {facts.map(([k, v, hint]) => (
            <div key={k} className="min-w-0">
              <dt className="text-ink-3" title={hint}>
                {k}
              </dt>
              <dd className="truncate font-mono text-[11px] text-ink" title={typeof v === "string" ? v : undefined}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 grid gap-4 border-t border-line-subtle pt-3 md:grid-cols-2" aria-label="Archive integrity" role="group">
          <div className="min-w-0">
            <p className="kicker mb-1.5">Archive record · Service check</p>
            <IntegrityTag state={bound ? "verified" : "unverifiable"}>{detail.integrity.status}</IntegrityTag>
            <span className="mt-0.5 block font-mono text-[10.5px] text-ink-3">scope · {detail.integrity.scope.replaceAll("_", " ")}</span>
            <p className="mt-1.5 text-xs leading-[1.5] text-ink-3">
              The Service re-verified the stored candidate bytes and relationships before answering; checked sha256{" "}
              <span className="mono-id" title={detail.integrity.checkedSha256 ?? undefined}>
                {detail.integrity.checkedSha256 ? shortDigest(detail.integrity.checkedSha256) : "none"}
              </span>{" "}
              {bound ? "is the digest this history ID names." : "is not bound to this history ID."}
            </p>
          </div>
          <div className="min-w-0" data-archive-evidence-integrity={evidence}>
            <p className="kicker mb-1.5">Archived evidence · this browser</p>
            <IntegritySeal state={evidence} />
            <p className="mt-1.5 text-xs leading-[1.5] text-ink-3">{INTEGRITY_SENTENCE[evidence]}</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-[1.5] text-ink-3">
          Read over HTTP from the local service’s SQLite archive: the evaluation as it was stored, not a fresh run — verdicts are copied, never recomputed. It was
          archived {formatDateTime(detail.archivedAt)}; the evaluation itself ran {formatDateTime(local.serviceExecutedAt)}, on synthetic research ticks. Synthetic
          input only; internal digest consistency does not authenticate any source, and nothing here is a real customer verification or release approval.
        </p>
        <Disclosure summary="Assurance limitations, verbatim" meta={plural(local.assurance.limitations.length, "statement")} className="mt-1">
          <ul className="mb-2 list-disc space-y-1 pl-5 text-xs leading-[1.5] text-ink-2">
            {local.assurance.limitations.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Disclosure>
      </div>
    </section>
  );
}

/* ---------- Archived evidence ---------- */

type PayloadMode = "included" | "omitted";
type Acquisition = ReturnType<typeof useEvidenceAcquisition>;

function retrievalText(acq: Acquisition, read: number, total: number): string {
  switch (acq.status) {
    case "reading":
      return `Reading page ${acq.pagesRead + 1} · ${read} of ${total} references retrieved`;
    case "partial":
      return `${plural(acq.pagesRead, "page")} retrieved · ${read} of ${total} references · more pages remain`;
    case "complete":
      return `All evidence pages retrieved · ${plural(acq.pagesRead, "page")} · all ${total} references, in the archive’s order`;
    case "cancelled":
      return "Evidence retrieval cancelled · nothing kept";
    default:
      return "Evidence retrieval stopped · nothing kept";
  }
}

export function ArchivedEvidencePanel({
  detail,
  acq,
  items,
  integrity,
  onReread,
}: {
  detail: HistoryDetailView;
  acq: Acquisition;
  items: EvidenceReferenceView[];
  integrity: IntegritySummary;
  onReread: () => void;
}) {
  const total = items.length;
  const read = acq.chain.read.length;
  const loaded = acq.chain.read.filter((r) => r.payload.state === "loaded");
  const mode: PayloadMode = acq.includePayload ? "included" : "omitted";
  const more = typeof acq.chain.next === "string";
  const stopped = acq.status === "cancelled" || acq.status === "failed" || acq.status === "refused";
  const f = acq.failure?.kind === "error" ? acq.failure : null;
  return (
    <Panel
      title="Archived evidence"
      description={`Bound to ${shortHistoryId(detail.historyId)} · history snapshot ${short(detail.snapshotId, 22)} · ${acq.chain.limit} per page · payloads ${mode}`}
      actions={
        <Segmented<PayloadMode>
          label="Archived evidence payloads"
          value={mode}
          onChange={(v) => acq.restart(v === "included")}
          options={[
            { value: "included", label: "Payloads", hint: "include_payload=true" },
            { value: "omitted", label: "References only", hint: "include_payload=false — omission by request; the Service still checks stored content" },
          ]}
        />
      }
      bodyClassName="px-4 pt-2 pb-4 sm:px-5"
    >
      <EvidenceLedger items={items} caption="Archived evidence references for this entry" integrity />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-subtle pt-3">
        <EvidenceStatus retrieval={retrievalText(acq, read, total)} integrity={integrityText(integrity, "archive", stopped)} integrityState={integrity.state} />
        {acq.status === "reading" && (
          <button type="button" className={buttonClass("ghost", "sm")} onClick={acq.cancel}>
            Cancel
          </button>
        )}
        {acq.status === "partial" && more && (
          <>
            <button type="button" className={buttonClass("default", "sm")} onClick={acq.readNext}>
              Read next page
            </button>
            <button type="button" className={buttonClass("ghost", "sm")} onClick={acq.readAll}>
              Read all remaining
            </button>
          </>
        )}
        {(acq.status === "cancelled" || acq.status === "refused" || (acq.status === "failed" && f && f.access !== "STALE_SNAPSHOT")) && (
          <button type="button" className={buttonClass("default", "sm")} onClick={() => acq.restart()}>
            <RotateCcw size={12} aria-hidden /> Restart evidence retrieval
          </button>
        )}
      </div>

      {integrity.state === "failed" && (
        <IntegrityNotice
          outcome="failed"
          className="mt-4"
          headingLevel={3}
          title={`${plural(integrity.failed.length, "archived evidence item")} failed internal consistency verification`}
          body={
            <>
              For {integrity.failed.map((x) => x.id).join(", ")}, this browser rebuilt Python’s canonical bytes from the payload it received and computed a different
              SHA-256 than the archived reference states. No integrity success is shown for this entry. The archived verdict above is shown as stored and is not
              re-evaluated — an integrity failure is not a Mismatch.
            </>
          }
          facts={integrity.failed.map((x) => [x.id, x.reason] as [string, string])}
          verdictLine="verdict · unchanged — integrity describes the archived evidence content, not the evaluation."
        />
      )}
      {acq.status === "refused" && acq.refusal && (
        <AccessNotice
          state="REQUEST_ERROR"
          className="mt-4"
          title="The archived evidence sequence was refused"
          body={`${acq.refusal.message} The pages retrieved so far were discarded; the archived verdict is unchanged.`}
          facts={[["Code", acq.refusal.code]]}
        />
      )}
      {acq.status === "failed" && f?.integrity && (
        <div className="mt-4">
          <ArchiveIntegrityFailure failure={f} subject="archived evidence" headingLevel={3} />
        </div>
      )}
      {acq.status === "failed" && f && !f.integrity && (
        <AccessNotice
          state={f.access}
          className="mt-4"
          body={
            f.access === "STALE_SNAPSHOT"
              ? `${f.message} The pages retrieved so far were discarded and nothing from another snapshot was merged.`
              : f.code === "invalid_cursor" || f.code === "cursor_query_conflict"
                ? `${f.message} The service rejected the continuation cursor for this archive. The pages retrieved so far were discarded; restart from the first page.`
                : `${f.message} The pages retrieved so far were discarded; the archived verdict is unchanged.`
          }
          facts={[["Code", f.code], ...(f.httpStatus !== undefined ? ([["HTTP", String(f.httpStatus)]] as [string, string][]) : []), ...(f.requestId ? ([["Request ID", f.requestId]] as [string, string][]) : [])]}
          actions={
            f.access === "STALE_SNAPSHOT" ? (
              <button type="button" className={buttonClass("default", "sm")} onClick={onReread}>
                <RotateCcw size={12} aria-hidden /> Re-read the whole entry
              </button>
            ) : undefined
          }
        />
      )}
      {acq.status === "failed" && acq.failure?.kind === "not_found" && (
        <AccessNotice state="NOT_FOUND" className="mt-4" body="The archived evidence read answered 404 for this history ID. The archived verdict is unchanged." />
      )}

      {loaded.length > 0 && (
        <Disclosure summary="Archived payloads read in this browser" meta={plural(loaded.length, "payload")} className="mt-2">
          <ul className="mb-2 space-y-3">
            {loaded.map((r) => (
              <li key={r.id}>
                <p className="flex flex-wrap items-baseline gap-x-3 font-mono text-[11px]">
                  <span className="text-ink">{r.id}</span>
                  <span className="text-ink-3">
                    {r.payload.state === "loaded" && r.payload.digest === "reproduced"
                      ? "sha256 reproduced in this browser"
                      : r.payload.state === "loaded" && r.payload.digest === "mismatch"
                        ? "sha256 NOT reproduced in this browser"
                        : "sha256 not checkable in this browser"}
                  </span>
                </p>
                <pre className="mt-1 max-h-64 overflow-auto rounded-sm bg-sunken p-3 font-mono text-[11px] leading-[1.5] text-ink-2" tabIndex={0} aria-label={`Archived payload of ${r.id}`}>
                  {JSON.stringify(r.payload.state === "loaded" ? r.payload.value : null, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      <p className="mt-2 flex gap-2 text-xs leading-[1.5] text-ink-3">
        <IntegrityGlyph state="verified" size={18} className="mt-0.5 text-ink-4" />
        <span>
          {chainComplete(acq.chain) ? "Every archived reference was retrieved and matches the archived run’s inventory (identity, order, metadata). " : ""}
          Retrieval and integrity are separate: retrieving every page shows the inventory is complete and in order; integrity verified means the Service’s
          stored-byte check and this browser’s own SHA-256 of the received payload agree. Neither changes the archived verdict, and neither authenticates the
          original source.
        </span>
      </p>
    </Panel>
  );
}
