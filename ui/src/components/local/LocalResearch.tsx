/**
 * LOCAL_RESEARCH presentation: read states, provenance band and the paged evidence panel.
 *
 * Built from the existing Evidence Atelier parts (AccessNotice, DetailSkeleton, EvidenceLedger,
 * Panel, Segmented, the dashed demo-register frame). The provenance band keeps the mode visible on
 * every local case — including Verified — so a local synthetic result is never mistaken for the
 * demo, for authenticated evidence or for a product release.
 */
import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { ACCESS_COPY, type ProviderResult, type ReadState } from "../../data/access";
import { chainComplete, ledgerItems } from "../../data/local/evidenceChain";
import { LOCAL_LIMITS, LOCAL_SERVICE_TARGET } from "../../data/local/config";
import type { FlowAssertReadProvider } from "../../data/provider";
import type { EvidenceReferenceView } from "../../domain/evidence";
import type { RunView } from "../../domain/view";
import { cn } from "../../lib/cn";
import { assessItem, summarizeIntegrity } from "../../domain/integrity";
import { formatDateTime, plural, shortDigest, workflowLabelText } from "../../lib/format";
import { useEvidenceAcquisition } from "../../lib/useEvidenceAcquisition";
import { EvidenceStatus, IntegrityNotice, integrityText } from "../integrity/Integrity";
import { AccessNotice, CancelledNotice, RetryButton } from "../states/AccessStates";
import { EvidenceLedger } from "../states/EvidenceLedger";
import { DetailSkeleton } from "../states/Skeletons";
import { Segmented } from "../ui/atelier";
import { Disclosure, Panel, Tag, buttonClass } from "../ui/primitives";

export const LOCAL_MODE_LINE = "Local research · synthetic · unapproved research version";
const PROVIDER_FACT = `LOCAL_RESEARCH · ${LOCAL_SERVICE_TARGET.replace("http://", "")} via same-origin proxy`;

/** The mode, always: a dashed register like the demo one, so the two never look alike by accident. */
export function LocalModeStamp({ className, inline = false }: { className?: string; inline?: boolean }) {
  const El = inline ? "span" : "p";
  return (
    <El className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1", className)}>
      <Tag tone="brand">LOCAL_RESEARCH</Tag>
      <span className="kicker text-ink-2">{LOCAL_MODE_LINE}</span>
    </El>
  );
}

/* ---------- Read states (no run yet) ---------- */

export function LocalReadState({ id, state, onRetry, onCancel }: { id: string; state: ReadState<RunView>; onRetry: () => void; onCancel: () => void }) {
  if (state.status === "idle" || state.status === "loading")
    return (
      <div>
        <LocalModeStamp className="mb-5" />
        <DetailSkeleton runId={id} label={`Reading verification run ${id} from the local research service. No result is shown until the read completes.`} />
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
        <LocalModeStamp className="mb-5" />
        <CancelledNotice what={`run ${id}`} onRetry={onRetry} />
      </div>
    );
  const r = state.result as Exclude<ProviderResult<RunView>, { kind: "ready" | "partial" }> | Extract<ProviderResult<RunView>, { kind: "ready" | "partial" }>;
  const facts: [string, ReactNode][] = [
    ["Run ID", id],
    ["Provider", PROVIDER_FACT],
  ];
  if (r.kind === "not_found") {
    if (r.requestId) facts.push(["Request ID", r.requestId]);
    return (
      <div>
        <LocalModeStamp className="mb-5" />
        <AccessNotice
          state="NOT_FOUND"
          headingLevel={1}
          title={
            <>
              No local research run <span className="mono-id text-[22px]">{id}</span>
            </>
          }
          body="The local service answered 404 run_not_found. Nothing was evaluated, and no record is missing because of it."
          facts={facts}
          actions={
            <a className={buttonClass("default", "sm")} href="#/local/verifications">
              Local research cases
            </a>
          }
        />
      </div>
    );
  }
  if (r.kind === "error") {
    facts.push(["Code", r.code]);
    if (r.requestId) facts.push(["Request ID", r.requestId]);
    facts.push(["MOCK fallback", "none — no other data source is used"]);
    const body =
      r.access === "SERVICE_UNAVAILABLE"
        ? `${ACCESS_COPY.SERVICE_UNAVAILABLE.body} ${r.message}`
        : r.access === "REQUEST_ERROR"
          ? `${ACCESS_COPY.REQUEST_ERROR.body} ${r.message}`
          : `${ACCESS_COPY[r.access].body} ${r.message}`;
    return (
      <div>
        <LocalModeStamp className="mb-5" />
        <AccessNotice state={r.access} headingLevel={1} body={body} facts={facts} actions={<RetryButton onRetry={onRetry} label="Read again" />} />
      </div>
    );
  }
  return null;
}

/* ---------- Provenance band ---------- */

export function LocalProvenance({ run, snapshotGone, onReread }: { run: RunView; snapshotGone: string | null; onReread: () => void }) {
  const l = run.local!;
  const label = workflowLabelText(run.workflow.n8nLabel); // null/empty kept in the view model; fallback is display only
  const facts: [string, ReactNode, string?][] = [
    ["Provider", "LOCAL_RESEARCH · synthetic", "provider_mode · synthetic"],
    ["Workflow", <span className={cn(label.fallback && "italic text-ink-3")}>{label.text}</span>, "workflow.n8n_label — a proposed label; no n8n execution is evidenced"],
    ["Workspace", l.workspaceId],
    ["Contract", `v1 · ${l.contractVersion}`],
    ["Snapshot", <span title={l.snapshotId}>{l.snapshotId.length > 26 ? `${l.snapshotId.slice(0, 18)}…${l.snapshotId.slice(-6)}` : l.snapshotId}</span>],
    ["Evaluator", l.evaluator.versionLabel, "evaluation_context.evaluator.version_label"],
    ["Evaluator source", `${l.evaluator.sourceCommit.slice(0, 12)}${l.evaluator.workspaceDirty ? " · dirty" : ""}`],
    ["Model sha256", <span title={l.evaluator.modelSha256}>{shortDigest(l.evaluator.modelSha256)}</span>],
    ["Service run", formatDateTime(l.serviceExecutedAt)],
    ["Authorization", l.assurance.researchAuthorization],
    ["Acquisition", l.assurance.acquisitionAuthenticity.replace("_", " ")],
  ];
  return (
    <section aria-label="Data provenance" className="mb-7">
      {snapshotGone && (
        <AccessNotice
          state="STALE_SNAPSHOT"
          className="mb-5"
          title="This case was read from a snapshot the service no longer serves"
          body="The local service answered 409 for this snapshot — it has restarted or republished. The case below is kept exactly as it was read; nothing from a newer snapshot is merged into it. Re-read the whole case to see the current snapshot."
          facts={[["Snapshot", snapshotGone]]}
          actions={
            <button type="button" className={buttonClass("default", "sm")} onClick={onReread}>
              <RotateCcw size={12} aria-hidden /> Re-read the whole case
            </button>
          }
        />
      )}
      <div className="rounded-sm border border-dashed border-line-strong px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <LocalModeStamp />
          <button type="button" className={buttonClass("ghost", "sm")} onClick={onReread}>
            <RotateCcw size={12} aria-hidden /> Re-read case
          </button>
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-[12px] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
        <p className="mt-3 text-xs leading-[1.5] text-ink-3">
          Read over HTTP from the local Python service; verdicts are the pinned evaluator’s, copied unchanged. Synthetic input only: no live source, n8n or
          HubSpot was contacted, and nothing here is authenticated evidence, a real customer verification or release approval.
        </p>
        <Disclosure summary="Assurance limitations, verbatim" meta={plural(l.assurance.limitations.length, "statement")} className="mt-1">
          <ul className="mb-2 list-disc space-y-1 pl-5 text-xs leading-[1.5] text-ink-2">
            {l.assurance.limitations.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Disclosure>
      </div>
    </section>
  );
}

/* ---------- Evidence ---------- */

type PayloadMode = "included" | "omitted";

function digestWord(r: EvidenceReferenceView): string | null {
  if (r.payload.state !== "loaded" || !r.payload.digest) return null;
  return r.payload.digest === "reproduced"
    ? "sha256 reproduced in this browser"
    : r.payload.digest === "mismatch"
      ? "sha256 not reproduced in this browser"
      : "sha256 not checkable in this browser";
}

export function LocalEvidencePanel({
  provider,
  run,
  onSnapshotUnavailable,
  onReread,
}: {
  provider: FlowAssertReadProvider;
  run: RunView;
  onSnapshotUnavailable: () => void;
  onReread: () => void;
}) {
  const l = run.local!;
  const acq = useEvidenceAcquisition(provider, run.id, l.evidenceReferences, l.snapshotId, LOCAL_LIMITS.evidencePageLimit, onSnapshotUnavailable);
  const items = ledgerItems(acq.chain, l.evidenceReferences);
  const read = acq.chain.read.length;
  const total = l.evidenceReferences.length;
  const loaded = acq.chain.read.filter((r) => r.payload.state === "loaded");
  const mode: PayloadMode = acq.includePayload ? "included" : "omitted";
  const more = typeof acq.chain.next === "string";

  // Retrieval and integrity are reported separately (Phase 3A, P2-AUD-001): reaching the last page proves
  // the inventory was retrieved in order, not that any payload is consistent with its digest.
  let status: string;
  switch (acq.status) {
    case "reading":
      status = `Reading page ${acq.pagesRead + 1} · ${read} of ${total} references read`;
      break;
    case "partial":
      status = `${plural(acq.pagesRead, "page")} read · ${read} of ${total} references · more pages remain`;
      break;
    case "complete":
      status = `All evidence pages retrieved · ${plural(acq.pagesRead, "page")} · all ${total} references, in the Detail’s order`;
      break;
    case "cancelled":
      status = "Evidence read cancelled · nothing kept";
      break;
    default:
      status = "Evidence read stopped · nothing kept";
  }
  const stopped = acq.status === "cancelled" || acq.status === "failed" || acq.status === "refused";
  const integrity = summarizeIntegrity(items.map(assessItem), acq.status === "complete");

  return (
    <Panel
      title="Evidence references"
      description={`Pinned to snapshot ${l.snapshotId.slice(0, 18)}… · ${LOCAL_LIMITS.evidencePageLimit} per page · payloads ${mode}`}
      actions={
        <Segmented<PayloadMode>
          label="Evidence payloads"
          value={mode}
          onChange={(v) => acq.restart(v === "included")}
          options={[
            { value: "included", label: "Payloads", hint: "include_payload=true" },
            { value: "omitted", label: "References only", hint: "include_payload=false — omission by request, not unavailability" },
          ]}
        />
      }
      bodyClassName="px-4 pt-2 pb-4 sm:px-5"
    >
      <EvidenceLedger items={items} caption="Evidence references for this case" />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-subtle pt-3">
        <EvidenceStatus retrieval={status} integrity={integrityText(integrity, "ephemeral", stopped)} integrityState={integrity.state} />
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
        {(acq.status === "cancelled" || acq.status === "refused" || (acq.status === "failed" && acq.failure?.kind === "error" && acq.failure.access !== "STALE_SNAPSHOT")) && (
          <button type="button" className={buttonClass("default", "sm")} onClick={() => acq.restart()}>
            <RotateCcw size={12} aria-hidden /> Restart evidence read
          </button>
        )}
      </div>

      {integrity.state === "failed" && (
        <IntegrityNotice
          outcome="failed"
          className="mt-4"
          headingLevel={3}
          title={`${plural(integrity.failed.length, "payload")} ${integrity.failed.length === 1 ? "does" : "do"} not reproduce ${integrity.failed.length === 1 ? "its" : "their"} SHA-256`}
          body="This browser rebuilt Python’s canonical bytes from the payload it received and computed a different SHA-256 than the reference states. The content failed internal consistency verification here; it is shown below for inspection only. The stored verdict is unchanged — an integrity failure is not a Mismatch."
          facts={integrity.failed.map((f) => [f.id, "sha256 not reproduced in this browser"] as [string, string])}
          verdictLine="verdict · unchanged — integrity describes the evidence content, not the evaluation."
        />
      )}
      {acq.status === "refused" && acq.refusal && (
        <AccessNotice
          state="REQUEST_ERROR"
          className="mt-4"
          title="The evidence sequence was refused"
          body={`${acq.refusal.message} The pages read so far were discarded; the stored verdict is unchanged.`}
          facts={[["Code", acq.refusal.code]]}
        />
      )}
      {acq.status === "failed" && acq.failure?.kind === "error" && (
        <AccessNotice
          state={acq.failure.access}
          className="mt-4"
          body={
            acq.failure.access === "STALE_SNAPSHOT"
              ? `${acq.failure.message} The pages read so far were discarded and nothing from another snapshot was merged. A cursor issued before a service restart is no longer valid.`
              : acq.failure.code === "invalid_cursor"
                ? `${acq.failure.message} The service rejected the continuation cursor. The pages read so far were discarded; restart from the first page.`
                : `${acq.failure.message} The pages read so far were discarded; the stored verdict is unchanged.`
          }
          facts={[["Code", acq.failure.code], ...(acq.failure.requestId ? ([["Request ID", acq.failure.requestId]] as [string, string][]) : [])]}
          actions={
            acq.failure.access === "STALE_SNAPSHOT" ? (
              <button type="button" className={buttonClass("default", "sm")} onClick={onReread}>
                <RotateCcw size={12} aria-hidden /> Re-read the whole case
              </button>
            ) : undefined
          }
        />
      )}
      {acq.status === "failed" && acq.failure?.kind === "not_found" && (
        <AccessNotice state="NOT_FOUND" className="mt-4" body="The evidence read answered 404 for this run. The stored verdict is unchanged." />
      )}

      {loaded.length > 0 && (
        <Disclosure summary="Payloads read in this browser" meta={plural(loaded.length, "payload")} className="mt-2">
          <ul className="mb-2 space-y-3">
            {loaded.map((r) => (
              <li key={r.id}>
                <p className="flex flex-wrap items-baseline gap-x-3 font-mono text-[11px]">
                  <span className="text-ink">{r.id}</span>
                  <span className={cn(r.payload.state === "loaded" && r.payload.digest === "mismatch" ? "text-mismatch-ink" : "text-ink-3")}>{digestWord(r)}</span>
                </p>
                <pre className="mt-1 max-h-64 overflow-auto rounded-sm bg-sunken p-3 font-mono text-[11px] leading-[1.5] text-ink-2" tabIndex={0} aria-label={`Payload of ${r.id}`}>
                  {JSON.stringify(r.payload.state === "loaded" ? r.payload.value : null, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      <p className="mt-2 text-xs leading-[1.5] text-ink-3">
        {chainComplete(acq.chain) ? "Every reference was retrieved and matches the Detail’s inventory (identity, order, metadata) — a retrieval fact, not an integrity check. " : ""}A
        reproduced SHA-256 shows a payload agrees with its reference — internal consistency of values the same service supplied, not authentic origin, independent
        collection or completeness.
      </p>
    </Panel>
  );
}
