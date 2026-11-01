/**
 * The four status axes (src/domain/statusAxes.ts), drawn so they cannot be mistaken for one another:
 *   Capture / Admission  — a dashed empty frame when nothing is recorded; a ruled mark (AxisMarks.tsx) for an outcome the
 *                          Service reported, with no verdict colour
 *   Archive              — the integrity vocabulary (linked evidence squares), never a verdict colour
 *   Evaluator verdict    — the verdict Seal, only when a Python result was copied; otherwise "No verdict"
 *                          in plain mono — never the Unverified hatch.
 */
import { useEffect, type ReactNode } from "react";
import { isHistoryCaseFilter } from "../../data/history/config";
import { getHistoryProvider, type FlowAssertHistoryProvider } from "../../data/provider";
import { archiveAxisOf, deriveAdmissionAxis, deriveCaptureAxis, type ArchiveAxis, type Phase3BView, type RunBoundMetadataView, type StatusAxes, type VerdictAxis } from "../../domain/statusAxes";
import { cn } from "../../lib/cn";
import { formatDateTime, plural } from "../../lib/format";
import { href } from "../../lib/router";
import { useHistoryList } from "../../lib/useHistoryList";
import type { RunView } from "../../domain/view";
import { Panel } from "../ui/primitives";
import { ArchiveMatchPanel } from "./ArchiveMatch";
import { CaptureValue, axisNote } from "./AxisMarks";
import { shortHistoryId } from "../history/HistoryRows";
import { serviceIntegrityState } from "../../domain/integrity";
import { IntegrityTag } from "../integrity/Integrity";
import { Seal } from "../ui/status";

export const AXIS_LABEL = {
  capture: "Capture status",
  admission: "Evidence admission status",
  archive: "Archive status",
  verdict: "Evaluator verdict",
} as const;

/** "No verdict": deliberately not a seal, not a state colour, not the Unverified hatch. */
export function NoVerdictMark() {
  return (
    <span data-axis-noverdict className="inline-flex h-[22px] items-center gap-1.5 font-mono text-[11px] text-ink-3">
      <span aria-hidden className="inline-block h-px w-3 bg-ink-4" />
      No verdict
    </span>
  );
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
          <IntegrityTag state={serviceIntegrityState(axis.latest.integrity)}>{ok ? "record check · service" : axis.latest.integrity}</IntegrityTag>
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
          <IntegrityTag state={serviceIntegrityState(axis.integrity)}>{ok ? "record check · service" : axis.integrity}</IntegrityTag>
        </span>
      );
    }
    case "NOT_ARCHIVED":
      return <span className="font-mono text-[11px] text-ink-2">Not archived</span>;
    case "NOT_FOUND":
      return <span className="font-mono text-[11px] text-ink-2">Archive list not found</span>;
    case "UNAVAILABLE":
      return (
        <span className="grid justify-items-start gap-1">
          <span className="text-[13px] font-medium text-ink">Archive unavailable</span>
          {axis.integrity && <IntegrityTag state={serviceIntegrityState(axis.integrity)}>{axis.integrity}</IntegrityTag>}
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
    case "NOT_FOUND":
      return "The archive list answered 404 history_not_found. Nothing is shown — not a verdict, and not an empty archive.";
    case "UNAVAILABLE":
      return axis.integrity === "INTEGRITY_FAILED"
        ? "The Service reported an archive integrity failure. Nothing from the archive is shown as a result."
        : axis.integrity === "INTEGRITY_UNVERIFIABLE"
          ? "The Service could not verify the stored archive (INTEGRITY_UNVERIFIABLE) — not a failed check. Nothing from the archive is shown as a result."
          : "The archive could not be read. This is a read failure — not a verdict and not an empty archive.";
    case "NOT_ADDRESSABLE":
      return axis.reason;
  }
}

/** Two reported monotonic readings apart. Never wall time; a negative span is shown, not corrected. */
function elapsedText(ns: string | null): string {
  if (ns === null) return "not stated exactly";
  return ns.startsWith("-") ? `${ns} ns · completed before started` : `${ns} ns (${(Number(ns) / 1e6).toFixed(3)} ms)`;
}

/** The reported execution context of a run-bound evaluation. Copied; the digests are stated, not recomputed here. */
function RunBoundFacts({ meta }: { meta: RunBoundMetadataView }) {
  const rows: [string, string][] = [
    ["run_id", meta.runId],
    ["execution_cwd_sha256", meta.executionCwdSha256],
    ["source_basis_sha256", meta.sourceBasisSha256],
    ["rule_basis_sha256", meta.ruleBasisSha256],
    ["started_mono_ns", meta.startedMonoNs ?? "not stated exactly"],
    ["completed_mono_ns", meta.completedMonoNs ?? "not stated exactly"],
    ["elapsed · monotonic", elapsedText(meta.elapsedNs)],
    ["verifier_work_completed", String(meta.verifierWorkCompleted)],
    ["outer_exit_status", meta.outerExitStatus === null ? "null" : String(meta.outerExitStatus)],
    ["subprocess_failures", String(meta.subprocessFailures)],
  ];
  return (
    <section aria-labelledby="run-bound-h" className="mt-5" data-run-bound>
      <h3 id="run-bound-h" className="kicker mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span>Run-bound execution</span>
        <span className="text-ink-3">reported by the Service · monotonic clock, not wall time</span>
      </h3>
      <dl className="fa-ledger grid gap-x-8 text-[12.5px] md:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-w-0 items-baseline justify-between gap-4 border-b border-line-subtle py-[6px]">
            <dt className="shrink-0 font-mono text-[10.5px] text-ink-3">{k}</dt>
            <dd className="min-w-0 text-right font-mono text-[11px] break-all text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The four axes as a ruled strip: one column per question, each answering only its own. */
export function StatusAxesLedger({ axes, runBound = null, className }: { axes: StatusAxes; runBound?: RunBoundMetadataView | null; className?: string }) {
  const cols: { key: keyof StatusAxes; n: string; value: ReactNode; note: string }[] = [
    { key: "capture", n: "01", value: <CaptureValue axis={axes.capture} />, note: axisNote(axes.capture) },
    { key: "admission", n: "02", value: <CaptureValue axis={axes.admission} />, note: axisNote(axes.admission) },
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
      {runBound && <RunBoundFacts meta={runBound} />}
    </section>
  );
}

/* ---------- The four axes of one case, with its archive axis read from the Service ---------- */

/**
 * For a Verification Detail: the verdict, capture and admission all belong to the live result the page already read
 * (an archived evaluation states its own on its History entry), and the archive axis is read here — this case's archive entries, every page under one list view. The same
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
  const facts: Phase3BView | null = live?.phase3b ?? null;
  const axes = (archive: ArchiveAxis): StatusAxes => ({ capture: deriveCaptureAxis(facts), admission: deriveAdmissionAxis(facts), archive, verdict });
  if (!isHistoryCaseFilter(id)) {
    const reason = "The archive contract addresses only the five reviewed case IDs. No archive request was sent for this ID.";
    return (
      <div className={cn("grid gap-6", className)} data-archive-list="settled">
        <StatusAxesLedger axes={axes({ axis: "archive", kind: "NOT_ADDRESSABLE", reason })} runBound={facts?.runBound} />
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
  else if (status === "failed" && !list.refusal && list.failure?.kind === "not_found") archive = { axis: "archive", kind: "NOT_FOUND" };
  else if (status === "failed" || status === "refused" || status === "cancelled")
    archive = {
      axis: "archive",
      kind: "UNAVAILABLE",
      code: list.refusal?.code ?? (list.failure?.kind === "error" ? list.failure.code : "cancelled"),
      integrity: (list.failure?.kind === "error" && list.failure.integrity) || null,
    };
  else archive = { axis: "archive", kind: "READING" };
  let match: ReactNode = null;
  if (live) {
    if (status === "complete") match = <ArchiveMatchPanel live={live} entries={list.chain.items} provider={provider} />;
    else if (archive.kind === "NOT_FOUND")
      match = <MatchUnavailable title="Archive not read" body="The archive list answered 404 history_not_found. No match is claimed and none is ruled out." />;
    else if (archive.kind === "UNAVAILABLE")
      match = (
        <MatchUnavailable
          title="Archive not read"
          body={`This case's archive entries could not be read (${archive.code}${
            archive.integrity === "INTEGRITY_FAILED" ? ", integrity failure reported by the Service" : archive.integrity === "INTEGRITY_UNVERIFIABLE" ? ", the Service could not verify the stored archive" : ""
          }). No match is claimed and none is ruled out.`}
        />
      );
    else match = <MatchUnavailable reading title="Reading the archive" body="Matching starts once every archive page for this case has been read." />;
  }
  const listSettled = status === "complete" || status === "failed" || status === "refused" || status === "cancelled";
  return (
    <div className={cn("grid gap-6", className)} data-archive-list={listSettled ? "settled" : "pending"}>
      <StatusAxesLedger axes={axes(archive)} runBound={live?.phase3b?.runBound} />
      {match}
    </div>
  );
}
