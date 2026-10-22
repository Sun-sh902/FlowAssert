/**
 * The four status axes (src/domain/statusAxes.ts), drawn so they cannot be mistaken for one another:
 *   Capture / Admission  — a dashed empty frame: "not implemented" is a fact about this build, not a state of a record
 *   Archive              — the integrity vocabulary (linked evidence squares), never a verdict colour
 *   Evaluator verdict    — the verdict Seal, only when a Python result was copied; otherwise "No verdict"
 *                          in plain mono — never the Unverified hatch.
 */
import { useEffect, type ReactNode } from "react";
import { isHistoryCaseFilter } from "../../data/history/config";
import { getHistoryProvider, type FlowAssertHistoryProvider } from "../../data/provider";
import {
  ADMISSION_NOT_IMPLEMENTED,
  CAPTURE_NOT_IMPLEMENTED,
  archiveAxisOf,
  type AdmissionAxis,
  type ArchiveAxis,
  type CaptureAxis,
  type StatusAxes,
  type VerdictAxis,
} from "../../domain/statusAxes";
import { cn } from "../../lib/cn";
import { formatDateTime, plural } from "../../lib/format";
import { href } from "../../lib/router";
import { useHistoryList } from "../../lib/useHistoryList";
import type { RunView } from "../../domain/view";
import { Panel } from "../ui/primitives";
import { ArchiveMatchPanel } from "./ArchiveMatch";
import { shortHistoryId } from "../history/HistoryRows";
import { IntegrityTag } from "../integrity/Integrity";
import { Seal } from "../ui/status";

export const AXIS_LABEL = {
  capture: "Capture status",
  admission: "Evidence admission status",
  archive: "Archive status",
  verdict: "Evaluator verdict",
} as const;

/** A dashed, empty frame: nothing exists to have a state. */
function NotImplementedMark({ children = "Not implemented" }: { children?: ReactNode }) {
  return (
    <span data-axis-na className="inline-flex h-[22px] items-center whitespace-nowrap gap-1.5 rounded-xs border border-dashed border-line-strong px-1.5 font-mono text-[10.5px] tracking-[0.06em] text-ink-3 uppercase">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <rect x="1" y="1" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.6 1.4" />
      </svg>
      {children}
    </span>
  );
}

/** "No verdict": deliberately not a seal, not a state colour, not the Unverified hatch. */
export function NoVerdictMark() {
  return (
    <span data-axis-noverdict className="inline-flex h-[22px] items-center gap-1.5 font-mono text-[11px] text-ink-3">
      <span aria-hidden className="inline-block h-px w-3 bg-ink-4" />
      No verdict
    </span>
  );
}

export function CaptureValue({ axis }: { axis: CaptureAxis | AdmissionAxis }) {
  return axis.kind === "NOT_IMPLEMENTED" ? <NotImplementedMark /> : null;
}

export function ArchiveValue({ axis, compact = false }: { axis: ArchiveAxis; compact?: boolean }) {
  switch (axis.kind) {
    case "READING":
      return <span className="font-mono text-[11px] text-ink-3">reading archive…</span>;
    case "ARCHIVED": {
      const ok = axis.latest.integrity === "INTEGRITY_VERIFIED";
      return (
        <span className="grid justify-items-start gap-1">
          <span className="text-[13px] font-medium text-ink">
            Archived <span className="font-normal text-ink-3">· {plural(axis.entries, "evaluation")}</span>
          </span>
          <IntegrityTag state={ok ? "verified" : "failed"}>{ok ? "record check · service" : axis.latest.integrity}</IntegrityTag>
          {!compact && (
            <a href={href(`/local/history/${axis.latest.historyId}`)} className="mono-id fa-hit rounded-xs text-[10.5px] text-ink-3 underline decoration-line-strong underline-offset-2 hover:text-ink" title={axis.latest.historyId}>
              latest {shortHistoryId(axis.latest.historyId)}
              <span className="block no-underline">{formatDateTime(axis.latest.archivedAt)}</span>
            </a>
          )}
        </span>
      );
    }
    case "THIS_ENTRY": {
      const ok = axis.integrity === "INTEGRITY_VERIFIED";
      return (
        <span className="grid justify-items-start gap-1">
          <span className="text-[13px] font-medium text-ink">
            Archived <span className="font-normal text-ink-3">· {formatDateTime(axis.archivedAt)}</span>
          </span>
          <IntegrityTag state={ok ? "verified" : "failed"}>{ok ? "record check · service" : axis.integrity}</IntegrityTag>
        </span>
      );
    }
    case "NOT_ARCHIVED":
      return <span className="font-mono text-[11px] text-ink-2">Not archived</span>;
    case "UNAVAILABLE":
      return (
        <span className="grid justify-items-start gap-1">
          <span className="text-[13px] font-medium text-ink">Archive unavailable</span>
          <span className="font-mono text-[10.5px] text-ink-3">{axis.code}</span>
        </span>
      );
    case "NOT_ADDRESSABLE":
      return <span className="font-mono text-[11px] text-ink-3">Not addressable</span>;
  }
}

export function verdictSourceText(axis: VerdictAxis): string {
  if (axis.kind === "NO_VERDICT") return axis.reason;
  return axis.source.kind === "live"
    ? `Pinned Python evaluator · copied from ${axis.source.request}`
    : `Pinned Python evaluator · copied from archived evaluation ${shortHistoryId(axis.source.historyId)}, archived ${formatDateTime(axis.source.archivedAt)}`;
}

export function VerdictValue({ axis }: { axis: VerdictAxis }) {
  return axis.kind === "VERDICT" ? <Seal state={axis.state} /> : <NoVerdictMark />;
}

function archiveNote(axis: ArchiveAxis): string {
  switch (axis.kind) {
    case "READING":
      return "Reading the local SQLite archive through the Service.";
    case "ARCHIVED":
    case "THIS_ENTRY":
      return "Stored in the local SQLite archive. The record check is the Service’s own integrity statement, not a business result.";
    case "NOT_ARCHIVED":
      return "The archive was read completely and holds no evaluation of this case.";
    case "UNAVAILABLE":
      return axis.integrity
        ? "The Service reported an archive integrity failure. Nothing from the archive is shown as a result."
        : "The archive could not be read. This is a read failure — not a verdict and not an empty archive.";
    case "NOT_ADDRESSABLE":
      return axis.reason;
  }
}

/** The four axes as a ruled strip: one column per question, each answering only its own. */
export function StatusAxesLedger({ axes, className }: { axes: StatusAxes; className?: string }) {
  const cols: { key: keyof StatusAxes; n: string; value: ReactNode; note: string }[] = [
    { key: "capture", n: "01", value: <CaptureValue axis={axes.capture} />, note: axes.capture.basis },
    { key: "admission", n: "02", value: <CaptureValue axis={axes.admission} />, note: axes.admission.basis },
    { key: "archive", n: "03", value: <ArchiveValue axis={axes.archive} />, note: archiveNote(axes.archive) },
    { key: "verdict", n: "04", value: <VerdictValue axis={axes.verdict} />, note: verdictSourceText(axes.verdict) },
  ];
  return (
    <section aria-labelledby="axes-h" className={cn("min-w-0", className)} data-status-axes>
      <h2 id="axes-h" className="kicker mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span>Status axes · four separate questions</span>
        <span className="text-ink-3">only 04 is a business verdict</span>
      </h2>
      <dl className="fa-ledger grid sm:grid-cols-2 xl:grid-cols-4 [&>*+*]:border-t-0">
        {cols.map((c, i) => (
          <div
            key={c.key}
            data-axis={c.key}
            className={cn(
              "grid content-start gap-2 py-3.5 sm:px-4",
              i > 0 && "max-sm:border-t max-sm:border-line-subtle",
              i % 2 === 1 && "sm:border-l sm:border-line-subtle",
              i >= 2 && "sm:max-xl:border-t sm:max-xl:border-line-subtle",
              i === 2 && "xl:border-l xl:border-line-subtle",
              i % 2 === 0 && "sm:max-xl:pl-0",
              i === 0 && "xl:pl-0",
            )}
          >
            <dt className="font-mono text-[10.5px] tracking-[0.08em] text-ink-3 uppercase">
              <span aria-hidden data-ornament className={cn("mr-1.5", c.key === "verdict" ? "text-brand" : "text-ink-4")}>
                {c.n}
              </span>
              {AXIS_LABEL[c.key]}
            </dt>
            <dd className="min-h-[22px]">{c.value}</dd>
            <dd className="text-xs leading-[1.5] text-ink-3">{c.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ---------- The four axes of one case, with its archive axis read from the Service ---------- */

/**
 * For a Verification Detail: capture and admission are build facts, the verdict is the live result the page already
 * read, and the archive axis is read here — this case's archive entries, every page under one list view. The same
 * read feeds the exact Detail → Archive match (ArchiveMatchPanel) when the live result is given. IDs the archive
 * contract cannot address (it admits only the reviewed case IDs) send no request.
 */
export function CaseStatusAxes({
  id,
  verdict,
  live,
  provider = getHistoryProvider("LOCAL_RESEARCH"),
  className,
}: {
  id: string;
  verdict: VerdictAxis;
  live?: RunView;
  provider?: Pick<FlowAssertHistoryProvider, "listHistory" | "getHistory">;
  className?: string;
}) {
  const axes = (archive: ArchiveAxis): StatusAxes => ({ capture: CAPTURE_NOT_IMPLEMENTED, admission: ADMISSION_NOT_IMPLEMENTED, archive, verdict });
  if (!isHistoryCaseFilter(id)) {
    const reason = "The archive contract addresses only the five reviewed case IDs. No archive request was sent for this ID.";
    return (
      <div className={cn("grid gap-6", className)} data-archive-list="settled">
        <StatusAxesLedger axes={axes({ axis: "archive", kind: "NOT_ADDRESSABLE", reason })} />
        {live && <MatchUnavailable title="Archive matching not available" body={reason} />}
      </div>
    );
  }
  return <ArchivedCaseAxes id={id} provider={provider} className={className} axes={axes} live={live} />;
}

function MatchUnavailable({ title, body, reading = false }: { title: string; body: string; reading?: boolean }) {
  return (
    <Panel title={title} description="Exact identity only — input evidence, evaluator model and source, contract, workspace.">
      <p data-archive-match={reading ? "reading" : "unavailable"} className="px-4 py-4 text-sm text-ink-2 sm:px-5">
        {body}
      </p>
    </Panel>
  );
}

function ArchivedCaseAxes({
  id,
  provider,
  className,
  axes,
  live,
}: {
  id: string;
  provider: Pick<FlowAssertHistoryProvider, "listHistory" | "getHistory">;
  className?: string;
  axes: (a: ArchiveAxis) => StatusAxes;
  live?: RunView;
}) {
  const list = useHistoryList(provider, id);
  const { status, loadMore } = list;
  useEffect(() => {
    if (status === "more") loadMore();
  }, [status, loadMore]);
  let archive: ArchiveAxis;
  if (status === "complete") archive = archiveAxisOf(list.chain.items);
  else if (status === "failed" || status === "refused" || status === "cancelled")
    archive = {
      axis: "archive",
      kind: "UNAVAILABLE",
      code: list.refusal?.code ?? (list.failure?.kind === "error" ? list.failure.code : status === "cancelled" ? "cancelled" : "not_found"),
      integrity: list.failure?.kind === "error" && !!list.failure.integrity,
    };
  else archive = { axis: "archive", kind: "READING" };
  let match: ReactNode = null;
  if (live) {
    if (status === "complete") match = <ArchiveMatchPanel live={live} entries={list.chain.items} provider={provider} />;
    else if (archive.kind === "UNAVAILABLE")
      match = (
        <MatchUnavailable
          title="Archive not read"
          body={`This case's archive entries could not be read (${archive.code}${archive.integrity ? ", integrity failure reported by the Service" : ""}). No match is claimed and none is ruled out.`}
        />
      );
    else match = <MatchUnavailable reading title="Reading the archive" body="Matching starts once every archive page for this case has been read." />;
  }
  const listSettled = status === "complete" || status === "failed" || status === "refused" || status === "cancelled";
  return (
    <div className={cn("grid gap-6", className)} data-archive-list={listSettled ? "settled" : "pending"}>
      <StatusAxesLedger axes={axes(archive)} />
      {match}
    </div>
  );
}
