/**
 * The LOCAL_RESEARCH workspace pages, read from the local Python Service:
 *   #/               Overview       current (live) and newest archived result of each known case, their comparison,
 *                                   and the workspace register
 *   #/verifications  Verifications  each known case: capture · admission as the Service reports them, live verdict, newest
 *                                   archived verdict, and a diagnostic comparison
 *   #/capture        Capture runs   nothing can be started from this build; says so and offers no action
 *
 * Reads (round 02): ONE archive list view read to its end, plus ONE live Detail read per known case with at most two
 * in flight (src/lib/useWorkspaceCases.ts). The five IDs are the reviewed handoff inventory, never a source population.
 * Nothing is read from the MOCK demo store and nothing is evaluated: verdicts are the pinned evaluator's, copied;
 * a comparison is a diagnostic about two Service outputs; a missing result has no verdict — never Unverified.
 */
import { ArrowRight, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArchiveIntegrityFailure } from "../components/history/HistoryEntry";
import { LocalModeStamp } from "../components/local/LocalResearch";
import { AccessNotice, CancelledNotice } from "../components/states/AccessStates";
import { scrollByKey, useScrollsHorizontally } from "../components/states/EvidenceLedger";
import { PageHead } from "../components/ui/atelier";
import { Panel, buttonClass } from "../components/ui/primitives";
import { StatusGlyph } from "../components/ui/status";
import { ArchivedVerdict, COMPARISON_COPY, ComparisonChip, LiveVerdict, SummaryCounts } from "../components/workspace/Comparison";
import { CaptureValue } from "../components/workspace/AxisMarks";
import { AXIS_LABEL } from "../components/workspace/StatusAxes";
import { ACCESS_COPY } from "../data/access";
import { HISTORY_CONTRACT_VERSION } from "../data/contract/history";
import { HISTORY_LIMITS, HISTORY_SCOPE } from "../data/history/config";
import { ACCEPTED_EVALUATOR, KNOWN_LOCAL_CASES, LOCAL_SCOPE, LOCAL_SERVICE_TARGET } from "../data/local/config";
import { localResearchProvider } from "../data/local/provider";
import { getHistoryProvider, type FlowAssertHistoryProvider, type FlowAssertReadProvider } from "../data/provider";
import { ADMISSION_NOT_IMPLEMENTED, CAPTURE_NOT_IMPLEMENTED, deriveAdmissionAxis, deriveCaptureAxis, hasReportedOutcome } from "../domain/statusAxes";
import { archivedSummary, liveSummary, type ComparisonState, type ResultSummary } from "../data/workspace/comparison";
import type { VerificationState } from "../domain/view";
import { cn } from "../lib/cn";
import { plural, shortDigest, workflowLabelText } from "../lib/format";
import { href } from "../lib/router";
import { type ArchiveIndexState } from "../lib/useArchiveIndex";
import { LIVE_CONCURRENCY } from "../lib/useLiveCases";
import { useWorkspaceCases, type WorkspaceCase } from "../lib/useWorkspaceCases";

const SERVICE = LOCAL_SERVICE_TARGET.replace("http://", "");
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const word = (n: number, lower = false) => {
  const w = WORDS[n] ?? String(n);
  return lower ? w.toLowerCase() : w;
};
/** Attention order: what contradicts the source first, then what cannot be concluded, then what waits. */
const ATTENTION: VerificationState[] = ["Mismatch", "Unverified", "Pending", "Verified"];
const COMPARISON_ORDER: ComparisonState[] = ["SAME_INPUT_AGREE", "SAME_INPUT_DIFFER", "DIFFERENT_INPUT", "LIVE_MISSING", "ARCHIVE_MISSING", "SERVICE_UNAVAILABLE", "INCONCLUSIVE"];

/** The archive side as the verdict cells name it. */
const archState = (c: WorkspaceCase) => (c.archive.kind === "ready" ? "ready" : c.archive.kind === "failed" ? "failed" : c.archive.kind === "cancelled" ? "cancelled" : "reading");
const liveState = (c: WorkspaceCase) => (c.live.kind === "ready" ? c.live.run.state : null);

/** One sentence about a result summary — selected from copied values, never derived into a verdict. */
function summaryLine(r: ResultSummary): string {
  const n = r.counts.Verified + r.counts.Mismatch + r.counts.Pending + r.counts.Unverified;
  switch (r.cohort) {
    case "Mismatch":
      return `${plural(r.counts.Mismatch, "record")} of ${n} ${r.counts.Mismatch === 1 ? "contradicts" : "contradict"} the source.`;
    case "Pending":
      return `${plural(r.counts.Pending, "record")} of ${n} not observed yet, inside the retry window.`;
    case "Unverified":
      return r.populationKnown
        ? `${plural(r.counts.Unverified, "record")} of ${n} ${r.counts.Unverified === 1 ? "lacks" : "lack"} evidence for a conclusion.`
        : `All ${n} visible records match — but the source total is unknown.`;
    case "Verified":
      return `Every required rule holds for all ${plural(n, "record")}.`;
  }
}

function caseLine(c: WorkspaceCase): string {
  if (c.live.kind === "ready") return summaryLine(liveSummary(c.live.run));
  if (c.comparison.archived) return `No current result was read. Newest archived: ${summaryLine(archivedSummary(c.comparison.archived)).toLowerCase()}`;
  return "No current result was read, and the archive holds none.";
}

/**
 * The row's capture and admission: the live evaluation's, as the Service reported them. With no live result, the newest
 * archived evaluation's. An archived outcome beside a live result is shown with that archived verdict.
 */
function caseAxes(c: WorkspaceCase) {
  const facts = c.live.kind === "ready" ? c.live.run.phase3b : c.comparison.archived?.phase3b;
  return { capture: deriveCaptureAxis(facts), admission: deriveAdmissionAxis(facts) };
}

const caseReportsOutcome = (c: WorkspaceCase) => (c.live.kind === "ready" && hasReportedOutcome(c.live.run.phase3b)) || c.entries.some((e) => hasReportedOutcome(e.phase3b));

function caseWorkflowLabel(c: WorkspaceCase): { text: string; fallback: boolean } | null {
  const anyCase = c as WorkspaceCase & { workflow_label?: string | null; workflowLabel?: string | null };
  if ("workflow_label" in anyCase) return workflowLabelText(anyCase.workflow_label ?? null);
  if ("workflowLabel" in anyCase) return workflowLabelText(anyCase.workflowLabel ?? null);
  if (c.live.kind === "ready") {
    const runAny = c.live.run as typeof c.live.run & { workflow_label?: string | null };
    if ("workflow_label" in runAny) return workflowLabelText(runAny.workflow_label ?? null);
    const w = c.live.run.workflow as { n8nLabel?: string | null; workflow_label?: string | null } | undefined;
    const raw = w && "workflow_label" in w ? w.workflow_label : w?.n8nLabel;
    return workflowLabelText(raw ?? null);
  }
  const latestAny = (c.comparison.archived ?? c.entries[0] ?? null) as { workflow_label?: string | null; workflowLabel?: string | null } | null;
  if (latestAny && ("workflow_label" in latestAny || "workflowLabel" in latestAny)) {
    return workflowLabelText(latestAny.workflow_label ?? latestAny.workflowLabel ?? null);
  }
  return null;
}

function WorkflowLabelBadge({ label }: { label: { text: string; fallback: boolean } | null }) {
  if (!label) return null;
  return (
    <span
      data-workflow-label={label.fallback ? "fallback" : "present"}
      className={cn(
        "mono-id inline-flex max-w-[220px] items-center truncate rounded-xs border border-line-subtle bg-sunken/50 px-1.5 py-0.5 text-[10.5px]",
        label.fallback ? "italic text-ink-3" : "text-ink-2",
      )}
      title={label.text}
    >
      {label.text}
    </span>
  );
}

/* ======================================================================================
 * Shared: the read, and a page-level Service-unavailable state
 * ====================================================================================== */

function useGeneration() {
  const [generation, setGeneration] = useState(0);
  return { generation, reread: () => setGeneration((g) => g + 1) };
}

function ReadAgain({ onReread, label = "Read again" }: { onReread: () => void; label?: string }) {
  return (
    <button type="button" className={buttonClass("ghost", "sm")} onClick={onReread}>
      <RotateCcw size={12} aria-hidden /> {label}
    </button>
  );
}

function ReadingLine({ w }: { w: ReturnType<typeof useWorkspaceCases> }) {
  if (!w.reading) return null;
  const liveDone = w.cases.filter((c) => c.live.kind !== "reading").length;
  const a = w.archiveState;
  return (
    <p role="status" aria-live="polite" data-read-progress className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ink-3">
      <span>
        live {liveDone} of {w.cases.length} read · at most {LIVE_CONCURRENCY} at a time
      </span>
      <span>
        archive{" "}
        {a.status === "reading" ? `${plural(a.pagesRead, "page")} · ${a.entriesRead}${a.total === null ? "" : ` of ${a.total}`} entries` : a.status}
      </span>
      <button type="button" className={buttonClass("ghost", "sm")} onClick={w.cancel}>
        Cancel read
      </button>
    </p>
  );
}

/** The archive side failed on its own (refused, integrity, request error) while live reads may have succeeded. */
function ArchiveSideNotice({ w, onReread }: { w: ReturnType<typeof useWorkspaceCases>; onReread: () => void }) {
  if (w.archiveState.status !== "failed" && w.archiveState.status !== "cancelled") return null;
  return <ArchiveReadState state={w.archiveState} onReread={onReread} />;
}

/* ======================================================================================
 * Overview
 * ====================================================================================== */

export function WorkspaceOverview({ history = getHistoryProvider("LOCAL_RESEARCH"), live = localResearchProvider() }: { history?: FlowAssertHistoryProvider; live?: FlowAssertReadProvider }) {
  const g = useGeneration();
  useEffect(() => {
    document.title = "Overview — FlowAssert";
  }, []);
  return <OverviewBody key={g.generation} history={history} live={live} onReread={g.reread} />;
}

function Statement({ cases }: { cases: WorkspaceCase[] }) {
  const read = cases.filter((c) => c.live.kind === "ready");
  const reading = cases.filter((c) => c.live.kind === "reading").length;
  // A Service 404 is an answer — the Service holds no current result for the case — not a failed read.
  const notFound = cases.filter((c) => c.live.kind === "not_found").length;
  const unreachable = cases.filter((c) => c.live.kind === "failed" && c.live.failure.transport).length;
  const notRead = cases.length - read.length - reading - notFound - unreachable;
  if (read.length === 0 && (reading || !notFound))
    return <h1 className="display mt-4 text-[36px] leading-[1.04] text-ink sm:text-[44px]">{reading ? "No current result has been read yet." : "No current result could be read."}</h1>;
  if (notFound === cases.length) return <h1 className="display mt-4 text-[36px] leading-[1.04] text-ink sm:text-[44px]">The Service holds no current result for these cases.</h1>;
  const count = (s: VerificationState) => read.filter((c) => liveState(c) === s).length;
  const lead = count("Mismatch") > 0 ? `${word(count("Mismatch"))} ${count("Mismatch") === 1 ? "case contradicts its" : "cases contradict their"} source.` : null;
  const rest: string[] = [];
  if (count("Unverified")) rest.push(`${word(count("Unverified"), true)} cannot be concluded`);
  if (count("Pending")) rest.push(`${word(count("Pending"), true)} ${count("Pending") === 1 ? "is" : "are"} still waiting`);
  if (count("Verified")) rest.push(`${word(count("Verified"), true)} ${count("Verified") === 1 ? "is" : "are"} verified`);
  if (notFound) rest.push(`${word(notFound, true)} ${notFound === 1 ? "has" : "have"} no current result at the Service`);
  if (notRead) rest.push(`${word(notRead, true)} could not be read`);
  if (unreachable) rest.push(`${word(unreachable, true)} could not reach the Service`);
  if (reading) rest.push(`${word(reading, true)} ${reading === 1 ? "is" : "are"} still being read`);
  let tail = rest.join(", ");
  if (tail) tail = `${tail[0]!.toUpperCase()}${tail.slice(1)}.`;
  return (
    <h1 className="display mt-4 max-w-[19ch] text-[36px] leading-[1.04] text-ink sm:text-[46px]">
      {lead && <em className="text-mismatch-ink">{lead}</em>}
      {read.length === 0 && "No current result was read."} <span className="text-ink-3">{tail}</span>
    </h1>
  );
}

function ResultLedger({ w }: { w: ReturnType<typeof useWorkspaceCases> }) {
  const live = (s: VerificationState) => w.cases.filter((c) => liveState(c) === s).length;
  const arch = (s: VerificationState) => (w.index ? w.cases.filter((c) => c.entries[0]?.result.cohort === s).length : null);
  // A case still being read has no result yet — it is not counted as "No result".
  const liveNone = w.cases.filter((c) => c.live.kind !== "ready" && c.live.kind !== "reading").length;
  const archNone = w.index ? w.cases.filter((c) => c.entries.length === 0).length : null;
  return (
    <section aria-labelledby="ledger-h" className="min-w-0">
      <h2 id="ledger-h" className="kicker mb-2">
        Results · {plural(KNOWN_LOCAL_CASES.length, "known case")}
      </h2>
      <table className="fa-ledger w-full text-sm" data-result-ledger>
        <caption className="sr-only">Cohort results of the known cases, live and newest archived</caption>
        <thead>
          <tr className="text-left">
            <th scope="col" className="py-[7px] font-normal">
              <span className="sr-only">Result</span>
            </th>
            <th scope="col" className="kicker py-[7px] text-right font-normal">
              Live
            </th>
            <th scope="col" className="kicker py-[7px] pl-5 text-right font-normal">
              Archived
            </th>
          </tr>
        </thead>
        <tbody>
          {ATTENTION.map((s) => (
            <tr key={s} className="border-t border-line-subtle">
              <th scope="row" className="py-[7px] text-left font-normal">
                <span className="flex items-center gap-2 text-ink-2">
                  <StatusGlyph state={s} size={11} />
                  {s}
                </span>
              </th>
              <td className="metric py-[5px] text-right">{w.reading && live(s) === 0 ? "·" : live(s)}</td>
              <td className="metric py-[5px] pl-5 text-right text-ink-3">{arch(s) ?? "·"}</td>
            </tr>
          ))}
          <tr className="border-t border-line-subtle">
            <th scope="row" className="py-[7px] text-left font-normal">
              <span className="flex items-center gap-2 text-ink-3">
                <span aria-hidden className="inline-block h-px w-[11px] bg-ink-4" />
                No result
              </span>
            </th>
            <td className="metric py-[5px] text-right text-ink-3">{w.reading && liveNone === 0 ? "·" : liveNone}</td>
            <td className="metric py-[5px] pl-5 text-right text-ink-3">{archNone ?? "·"}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs leading-[1.5] text-ink-3">
        Live: the Service’s current result for each known ID. Archived: each case’s newest archived evaluation. Tallies of copied results — not a population.
      </p>
    </section>
  );
}

/** Counts of each comparison state across the known cases — the diagnostic layer, set apart from verdicts. */
function ComparisonStrip({ cases }: { cases: WorkspaceCase[] }) {
  const counts = COMPARISON_ORDER.map((s) => [s, cases.filter((c) => c.comparison.state === s).length] as const).filter(([s, n]) => n > 0 || s === "SAME_INPUT_AGREE" || s === "SAME_INPUT_DIFFER" || s === "DIFFERENT_INPUT");
  const reading = cases.filter((c) => c.comparison.state === "READING").length;
  return (
    <section aria-labelledby="cmp-h" className="border-y-[1.5px] border-rule py-4" data-comparison-strip>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="cmp-h" className="serif text-[22px] leading-7 text-ink">
          Live against archive
        </h2>
        <p className="kicker text-ink-3">diagnostic · not a verdict · identity = input, evaluator, contract</p>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {counts.map(([s, n]) => (
          <li key={s} className="grid gap-1">
            <span className={cn("metric text-[30px] leading-none", n === 0 && "text-ink-3")}>{reading > 0 && n === 0 ? "·" : n}</span>
            <ComparisonChip state={s} muted={n === 0} className="w-fit" />
          </li>
        ))}
      </ul>
    </section>
  );
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

function CaseExhibits({ cases }: { cases: WorkspaceCase[] }) {
  const groups: { key: VerificationState | "none" | "reading"; title: string; hint: string }[] = [
    { key: "Mismatch", title: "Contradicted by evidence", hint: "investigate" },
    { key: "Unverified", title: "Inconclusive", hint: "restore evidence" },
    { key: "Pending", title: "Within the retry window", hint: "wait" },
    { key: "Verified", title: "Verified at the current observation", hint: "no action" },
    { key: "reading", title: "Current result being read", hint: "reading" },
    { key: "none", title: "No current result", hint: "see why" },
  ];
  let n = 0;
  return (
    <Panel title="Cases" description="Current Service result per known case, ordered by what to do; the newest archived result beside it." className="lg:col-span-8">
      {groups.map((g) => {
        const list = cases.filter((c) =>
          g.key === "reading" ? c.live.kind === "reading" : g.key === "none" ? c.live.kind !== "ready" && c.live.kind !== "reading" : liveState(c) === g.key,
        );
        if (!list.length) return null;
        return (
          <section key={g.key} aria-label={g.title}>
            <h3 className="kicker flex justify-between border-b border-line-subtle bg-sunken/40 px-4 pt-3 pb-2 sm:px-5">
              <span>
                {g.title} · {list.length}
              </span>
              <span>{g.hint}</span>
            </h3>
            <ul>
              {list.map((c) => {
                const numeral = ROMAN[n++] ?? String(n);
                return (
                  <li
                    key={c.id}
                    data-case={c.id}
                    className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-4 gap-y-3 border-b border-line-subtle px-4 py-4 last:border-0 sm:grid-cols-[40px_minmax(0,1fr)_minmax(0,250px)] sm:px-5"
                  >
                    <span aria-hidden data-ornament className="serif pt-0.5 text-[26px] leading-none text-ink-4 italic">
                      {numeral}
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <a href={href(`/local/verifications/${c.id}`)} className="mono-id fa-hit rounded-xs text-[15px] font-semibold text-ink hover:text-brand">
                          {c.id}
                        </a>
                        <span className="mono-id text-[10.5px] text-ink-3">fixture {c.fixture}</span>
                        <WorkflowLabelBadge label={caseWorkflowLabel(c)} />
                      </p>
                      <p className="mt-1 text-sm leading-[1.5] text-ink-2">{caseLine(c)}</p>
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <ComparisonChip state={c.comparison.state} />
                        {c.comparison.state !== "SAME_INPUT_AGREE" && <span className="text-xs text-ink-3">{c.comparison.reason}</span>}
                      </p>
                      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <a href={href(`/local/verifications/${c.id}`)} className="fa-hit inline-flex items-center gap-1 rounded-xs font-medium text-ink-2 hover:text-ink">
                          Open detail <ArrowRight size={12} aria-hidden />
                        </a>
                        {c.entries.length > 0 && (
                          <a href={href("/local/history", { case: c.id })} className="fa-hit rounded-xs text-ink-3 hover:text-ink">
                            {plural(c.entries.length, "archived evaluation")}
                          </a>
                        )}
                      </p>
                    </div>
                    {/* Each term is grouped with its own description, so "Live" and "Archived" each name only their value. */}
                    <dl className="col-start-2 grid grid-cols-2 gap-x-4 sm:col-start-3" aria-label={`${c.id} results`}>
                      <div className="grid content-start gap-y-1">
                        <dt className="kicker text-ink-3">Live</dt>
                        <dd>
                          <LiveVerdict side={c.live} compact />
                        </dd>
                      </div>
                      <div className="grid content-start gap-y-1">
                        <dt className="kicker text-ink-3">Archived</dt>
                        <dd>
                          <ArchivedVerdict entry={c.comparison.archived} state={archState(c)} compact />
                        </dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </Panel>
  );
}

function Register({ w }: { w: ReturnType<typeof useWorkspaceCases> }) {
  const liveOk = w.cases.filter((c) => c.live.kind === "ready").length;
  const liveNotFound = w.cases.filter((c) => c.live.kind === "not_found").length;
  const a = w.archiveState;
  const reported = w.cases.filter(caseReportsOutcome).length;
  const rows: [string, ReactNode][] = [
    ["Live reads", `${liveOk + liveNotFound} of ${w.cases.length} answered${liveNotFound ? ` (${liveNotFound} not found)` : ""} · ≤${LIVE_CONCURRENCY} at a time`],
    ["Archive", a.status === "ready" ? `${plural(a.index.totalEntries, "entry", "entries")} · ${plural(a.pages, "page")} · ${HISTORY_LIMITS.listPageLimit} per page` : a.status === "reading" ? "reading…" : `not read (${a.status})`],
    [
      "Record checks",
      a.status === "ready" ? (a.index.integrityExceptions === 0 ? `${a.index.totalEntries} of ${a.index.totalEntries} INTEGRITY_VERIFIED` : `${a.index.integrityExceptions} not INTEGRITY_VERIFIED`) : "—",
    ],
    ["Evaluator", `${shortDigest(ACCEPTED_EVALUATOR.model_sha256)} · ${ACCEPTED_EVALUATOR.version_label}`],
    ["Contracts", `v1 ${LOCAL_SCOPE.contractVersion} · ${HISTORY_CONTRACT_VERSION}`],
    ["Workspace", `${HISTORY_SCOPE.workspaceId} · research_only`],
  ];
  return (
    <Panel title="Workspace register" description="What answered on this read, and what this build cannot do." className="lg:col-span-4">
      {/* From lg to xl this column is too narrow for a 110px label beside mono identifiers (they split mid-token),
          so each label sits above its value there. */}
      <dl className="px-4 py-2 text-[12.5px] sm:px-5">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[110px_minmax(0,1fr)] items-baseline gap-3 border-b border-line-subtle py-[9px] last:border-0 lg:grid-cols-1 lg:gap-0.5 xl:grid-cols-[110px_minmax(0,1fr)] xl:gap-3">
            <dt className="text-ink-3">{k}</dt>
            <dd className="min-w-0 text-right font-mono text-[11px] break-words text-ink lg:text-left xl:text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-line px-4 py-3 sm:px-5">
        <p className="kicker mb-2">{reported ? "Capture · admission · connections" : "Not implemented in this build"}</p>
        <ul className="grid gap-2 text-xs text-ink-2">
          {reported ? (
            <li className="flex flex-wrap items-center justify-between gap-2" data-reported-outcomes={reported}>
              <span>
                {AXIS_LABEL.capture} · {AXIS_LABEL.admission.toLowerCase()}
              </span>
              <span className="font-mono text-[10.5px] text-ink-3">
                {reported} of {w.cases.length} cases report an outcome
              </span>
            </li>
          ) : (
            <>
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span>{AXIS_LABEL.capture}</span>
                <a href="#/capture" className="fa-hit rounded-xs">
                  <CaptureValue axis={CAPTURE_NOT_IMPLEMENTED} />
                </a>
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span>{AXIS_LABEL.admission}</span>
                <CaptureValue axis={ADMISSION_NOT_IMPLEMENTED} />
              </li>
            </>
          )}
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span>Live n8n · HubSpot</span>
            <span className="font-mono text-[10.5px] text-ink-3">not connected · no credentials</span>
          </li>
        </ul>
      </div>
    </Panel>
  );
}

function OverviewBody({ history, live, onReread }: { history: FlowAssertHistoryProvider; live: FlowAssertReadProvider; onReread: () => void }) {
  const w = useWorkspaceCases(history, live, 0);
  // The notice is the whole page here, so its title is the page's H1 (Verifications keeps its own PageHead).
  if (w.allUnreachable && w.archiveState.status === "failed") return <ArchiveReadState state={w.archiveState} onReread={onReread} headingLevel={1} />;
  return (
    <div className="space-y-10">
      <header className="grid gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
        <div className="min-w-0">
          <p className="kicker flex flex-wrap items-center gap-x-3 gap-y-1">
            <LocalModeStamp inline />
            <span>Current Service result per known case</span>
          </p>
          {w.cases.every((c) => c.live.kind === "reading") ? (
            <h1 className="display mt-4 text-[36px] leading-[1.04] text-ink-3 sm:text-[44px]" aria-busy="true">
              Reading five known cases…
            </h1>
          ) : (
            <Statement cases={w.cases} />
          )}
          <p className="mt-4 max-w-[60ch] text-md leading-[1.6] text-ink-2">
            Read just now from the local Python Service at <span className="mono-id">{SERVICE}</span>: the current result of each of the five reviewed synthetic
            cases, beside its newest archived evaluation. Verdicts are the pinned evaluator’s, copied unchanged; the input is synthetic and nothing was captured.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ReadAgain onReread={onReread} label="Read everything again" />
            <ReadingLine w={w} />
          </div>
        </div>
        <ResultLedger w={w} />
      </header>

      <ArchiveSideNotice w={w} onReread={onReread} />
      <ComparisonStrip cases={w.cases} />

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <CaseExhibits cases={w.cases} />
        <Register w={w} />
      </div>

      <AxesExplainer />
    </div>
  );
}

function AxesExplainer() {
  const items: { key: keyof typeof AXIS_LABEL; body: string }[] = [
    { key: "capture", body: "Whether the evidence was acquired by a capture run, and how that run ended, as the Service reports it. A reviewed synthetic fixture has none: not implemented." },
    { key: "admission", body: "Whether an admission record bound the evidence to an evaluator input — or refused it, as the Service reports it. Never a verdict; with no record: not implemented." },
    { key: "archive", body: "Whether an evaluation is stored in the local SQLite archive, with the Service’s integrity check. Storage, not a result." },
    { key: "verdict", body: "Verified, Mismatch, Pending or Unverified — from the pinned Python evaluator only, live or archived. Where no result was read, there is no verdict." },
  ];
  return (
    <section aria-labelledby="axes-explainer" className="border-t-[1.5px] border-rule pt-5">
      <h2 id="axes-explainer" className="kicker mb-4">
        How to read the four status axes
      </h2>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((it, i) => (
          <div key={it.key}>
            <h3 className="serif flex items-baseline gap-2 text-[22px] text-ink">
              <span aria-hidden data-ornament className={cn("font-mono text-[11px]", i === 3 ? "text-brand" : "text-ink-4")}>
                0{i + 1}
              </span>
              {AXIS_LABEL[it.key]}
            </h3>
            <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-2">{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ======================================================================================
 * Verifications
 * ====================================================================================== */

export function WorkspaceVerifications({ history = getHistoryProvider("LOCAL_RESEARCH"), live = localResearchProvider() }: { history?: FlowAssertHistoryProvider; live?: FlowAssertReadProvider }) {
  const g = useGeneration();
  useEffect(() => {
    document.title = "Verifications — FlowAssert";
  }, []);
  return (
    <div className="space-y-7">
      <PageHead
        kicker={<LocalModeStamp inline />}
        title="Five known cases, live beside archived."
        lede={
          <>
            Each row keeps four questions apart — capture, admission, archive and verdict — and sets the Service’s current result beside its newest archived
            evaluation. Only the pinned Python evaluator produces a verdict; the comparison column is a diagnostic. Read from{" "}
            <span className="mono-id">{SERVICE}</span>.
          </>
        }
      />
      <VerificationsBody key={g.generation} history={history} live={live} onReread={g.reread} />
      <p className="max-w-[780px] text-xs leading-[1.55] text-ink-3">
        <b className="font-semibold text-ink-2">Five known IDs, not a population.</b> The frozen v1 API has no collection endpoint, so this list is the reviewed
        handoff inventory: one live read per case through <span className="mono-id">GET /api/v1/verifications/:id</span> (at most {LIVE_CONCURRENCY} at a time) and one
        archive list read. A comparison matches results only on input, evaluator and contract identity — never on times or labels. If the Service is not running,
        this page shows <b className="font-semibold text-ink-2">Service unavailable</b> — never demo data. The MOCK demo runs are under{" "}
        <a href="#/demo/verifications" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
          Demo
        </a>
        .
      </p>
    </div>
  );
}

/** The case table's scroller: when the table is wider than its column it is a named, focusable region (as HistoryRows does). */
function CaseTableScroller({ children }: { children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const scrollable = useScrollsHorizontally(scroller);
  return (
    <div ref={scroller} className="hidden overflow-x-auto lg:block" {...(scrollable ? { tabIndex: 0, role: "region", "aria-label": "Known cases table", onKeyDown: scrollByKey } : {})}>
      {children}
    </div>
  );
}

function VerificationsBody({ history, live, onReread }: { history: FlowAssertHistoryProvider; live: FlowAssertReadProvider; onReread: () => void }) {
  const w = useWorkspaceCases(history, live, 0);
  if (w.allUnreachable && w.archiveState.status === "failed") return <ArchiveReadState state={w.archiveState} onReread={onReread} />;
  const caption = "Known cases: capture and admission status, live verdict, newest archived verdict and their comparison";
  return (
    <>
      <ArchiveSideNotice w={w} onReread={onReread} />
      <Panel
        title={
          <span className="tabular">
            {w.cases.length} <span className="text-ink-3">known cases{w.index ? ` · ${plural(w.index.totalEntries, "archive entry", "archive entries")}` : ""}</span>
          </span>
        }
        description="In reviewed-case order. Live results and the archive were read just now."
        actions={<ReadAgain onReread={onReread} />}
      >
        {w.reading && (
          <div className="border-b border-line-subtle px-4 py-2.5 sm:px-5">
            <ReadingLine w={w} />
          </div>
        )}
        <CaseTableScroller>
          <table className="w-full text-sm" data-case-table>
            <caption className="sr-only">{caption}</caption>
            <colgroup>
              <col className="w-[190px]" />
              <col className="w-[230px]" />
              <col className="w-[170px]" />
              <col className="w-[190px]" />
              <col />
            </colgroup>
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="kicker py-2.5 pr-4 pl-5 font-normal">
                  Case
                </th>
                <th scope="col" className="kicker py-2.5 pr-4 font-normal">
                  <span aria-hidden data-ornament className="text-ink-4">
                    01–02{" "}
                  </span>
                  Capture · Admission
                </th>
                <th scope="col" className="kicker py-2.5 pr-4 font-normal">
                  <span aria-hidden data-ornament className="text-brand">
                    04{" "}
                  </span>
                  Live verdict
                </th>
                <th scope="col" className="kicker py-2.5 pr-4 font-normal">
                  <span aria-hidden data-ornament className="text-ink-4">
                    03{" "}
                  </span>
                  Newest archived
                </th>
                <th scope="col" className="kicker py-2.5 pr-5 font-normal">
                  Comparison · diagnostic
                </th>
              </tr>
            </thead>
            <tbody>
              {w.cases.map((c) => {
                const axes = caseAxes(c);
                const wfLabel = caseWorkflowLabel(c);
                return (
                  <tr key={c.id} data-case={c.id} className="fa-row group relative border-b border-line-subtle align-top transition-colors duration-(--fa-dur-fast) last:border-0 hover:bg-hover">
                    <td className="py-4 pr-4 pl-5">
                      <a
                        href={href(`/local/verifications/${c.id}`)}
                        className="mono-id block text-[14px] font-semibold text-ink after:absolute after:inset-0 after:content-[''] focus-visible:shadow-none focus-visible:after:shadow-(--fa-ring-inset)"
                        aria-label={`${c.id}. Live ${c.live.kind === "ready" ? c.live.run.state : "no verdict"}; newest archived ${c.comparison.archived ? c.comparison.archived.result.cohort : "none"}; comparison ${COMPARISON_COPY[c.comparison.state].label}.`}
                      >
                        {c.id}
                      </a>
                      <span className="mono-id mt-0.5 block text-[10.5px] text-ink-3">fixture {c.fixture}</span>
                      {wfLabel && (
                        <span className="mt-1 block">
                          <WorkflowLabelBadge label={wfLabel} />
                        </span>
                      )}
                      {c.live.kind === "ready" && <SummaryCounts summary={liveSummary(c.live.run)} className="mt-2 block" />}
                    </td>
                    <td className="py-4 pr-4">
                      <dl className="grid grid-cols-[max-content_max-content] items-center gap-x-2 gap-y-1.5">
                        <dt className="font-mono text-[10px] tracking-[0.06em] text-ink-3 uppercase">capture</dt>
                        <dd>
                          <CaptureValue axis={axes.capture} />
                        </dd>
                        <dt className="font-mono text-[10px] tracking-[0.06em] text-ink-3 uppercase">admission</dt>
                        <dd>
                          <CaptureValue axis={axes.admission} />
                        </dd>
                      </dl>
                    </td>
                    <td className="py-4 pr-4">
                      <LiveVerdict side={c.live} />
                    </td>
                    <td className="relative z-10 py-4 pr-4">
                      <ArchivedVerdict entry={c.comparison.archived} state={archState(c)} />
                      {c.entries.length > 1 && <span className="mt-1 block font-mono text-[10.5px] text-ink-3">{plural(c.entries.length, "evaluation")} archived</span>}
                    </td>
                    <td className="py-4 pr-5">
                      <ComparisonChip state={c.comparison.state} />
                      <span className="mt-1.5 block max-w-[34ch] text-xs leading-[1.45] text-ink-3">{c.comparison.reason}</span>
                      {c.comparison.sameSnapshot === false && (
                        <span className="mt-1 block font-mono text-[10.5px] text-ink-3">snapshot: different Service publication</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CaseTableScroller>
        <ul className="divide-y divide-line-subtle lg:hidden" aria-label={caption}>
          {w.cases.map((c) => {
            const axes = caseAxes(c);
            const wfLabel = caseWorkflowLabel(c);
            return (
              <li key={c.id} data-case={c.id} className="grid grid-cols-[minmax(0,1fr)] gap-3 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a href={href(`/local/verifications/${c.id}`)} className="min-w-0">
                      <span className="mono-id block font-semibold text-ink">{c.id}</span>
                      <span className="mono-id block truncate text-[10.5px] text-ink-3">fixture {c.fixture}</span>
                    </a>
                    {wfLabel && (
                      <span className="mt-1 block">
                        <WorkflowLabelBadge label={wfLabel} />
                      </span>
                    )}
                  </div>
                  <ComparisonChip state={c.comparison.state} />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <span className="kicker text-ink-3">Live</span>
                  <span className="kicker text-ink-3">Newest archived</span>
                  <LiveVerdict side={c.live} compact />
                  <ArchivedVerdict entry={c.comparison.archived} state={archState(c)} compact />
                </div>
                <p className="text-xs leading-[1.45] text-ink-3">{c.comparison.reason}</p>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-[10px] tracking-[0.06em] text-ink-3 uppercase">
                  <span className="inline-flex items-center gap-2">
                    capture <CaptureValue axis={axes.capture} />
                  </span>
                  <span className="inline-flex items-center gap-2">
                    admission <CaptureValue axis={axes.admission} />
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
}

/* ======================================================================================
 * Archive read failures (shared)
 * ====================================================================================== */

export function ArchiveReadState({
  state,
  onReread,
  headingLevel = 2,
}: {
  state: Exclude<ArchiveIndexState, { status: "ready" }>;
  onReread: () => void;
  headingLevel?: 1 | 2;
}) {
  const reread = (
    <button type="button" className={buttonClass("default", "sm")} onClick={onReread}>
      <RotateCcw size={12} aria-hidden /> Read the archive again
    </button>
  );
  if (state.status === "reading")
    return (
      <div aria-busy="true" data-access="LOADING" className="surface rounded-lg px-5 py-6 sm:px-7">
        <p role="status" className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="kicker">Reading</span>
          <span className="serif text-xl text-ink">Reading the local archive…</span>
        </p>
        <p className="mt-2 max-w-[64ch] text-sm text-ink-2">
          Every page of the archive list is read under one pinned list view before any result is shown. A partly read archive shows no per-case result.
        </p>
        <p className="mt-3 font-mono text-[11px] text-ink-3" data-read-progress>
          {plural(state.pagesRead, "page")} · {state.entriesRead}
          {state.total === null ? "" : ` of ${state.total}`} archive entries admitted
        </p>
        <ul aria-hidden className="mt-4 grid gap-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="fa-skel fa-breathe" data-size="text" style={{ width: `${[64, 48, 56][i]}%` }} />
          ))}
        </ul>
        <button type="button" className={cn(buttonClass("ghost", "sm"), "mt-4")} onClick={state.cancel}>
          Cancel read
        </button>
      </div>
    );
  if (state.status === "cancelled") return <CancelledNotice what="the archive" onRetry={onReread} />;
  if (state.refusal)
    return (
      <AccessNotice
        state="REQUEST_ERROR"
        headingLevel={headingLevel}
        title="The archive list was refused"
        body={`${state.refusal.message} No archived result is shown: a partly admitted archive cannot say which cases are archived.`}
        facts={[
          ["Code", state.refusal.code],
          ["Pages admitted before the refusal", String(state.pagesRead)],
        ]}
        actions={reread}
      />
    );
  const f = state.failure;
  if (f?.kind === "error" && f.integrity) return <ArchiveIntegrityFailure failure={f} subject="archive list" headingLevel={headingLevel} actions={reread} />;
  if (f?.kind === "not_found") return <AccessNotice state="NOT_FOUND" headingLevel={headingLevel} body="The archive list answered 404. No result is shown." actions={reread} />;
  const access = f?.kind === "error" ? f.access : "SERVICE_UNAVAILABLE";
  const facts: [string, string][] = [];
  if (f?.kind === "error") {
    facts.push(["Code", f.code]);
    if (f.httpStatus !== undefined) facts.push(["HTTP", String(f.httpStatus)]);
    if (f.requestId) facts.push(["Request ID", f.requestId]);
  }
  facts.push(["Service", SERVICE]);
  facts.push(["MOCK fallback", "none — no other data source is used"]);
  return (
    <AccessNotice
      state={access}
      headingLevel={headingLevel}
      title={access === "SERVICE_UNAVAILABLE" ? "The local Service is unavailable" : undefined}
      body={`${ACCESS_COPY[access].body} ${f?.kind === "error" ? f.message : ""}${access === "SERVICE_UNAVAILABLE" ? " Start it with scripts/dev/service.sh, then read again." : ""}`}
      facts={facts}
      actions={reread}
    />
  );
}

/* ======================================================================================
 * Capture runs — not implemented
 * ====================================================================================== */

export function CaptureRuns() {
  useEffect(() => {
    document.title = "Capture runs — FlowAssert";
  }, []);
  const facts: [string, string][] = [
    [AXIS_LABEL.capture, "Reported by the Service per evaluation · read-only here"],
    ["Evidence in use", "Five reviewed synthetic fixtures, shipped with the Service"],
    ["Live n8n · HubSpot", "Not connected · no credentials held"],
    ["Capture contract", "Phase 3B planning · DRAFT · not frozen"],
    ["Phase 3B-1 implementation", "Not authorized"],
  ];
  return (
    <div className="space-y-7">
      <PageHead
        kicker={<LocalModeStamp inline />}
        title="Capture runs are not implemented."
        lede="A capture run would acquire source and destination observations and record how that acquisition ended. This build has no capture pipeline: every verification is evaluated from a reviewed synthetic fixture. Nothing can be started, scheduled or connected from this page."
      />
      <section aria-labelledby="capture-h" data-capture-unavailable className="rounded-lg border border-dashed border-line-strong px-5 py-6 sm:px-7">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CaptureValue axis={{ axis: "capture", kind: "NOT_IMPLEMENTED", basis: "" }} />
          <span className="fa-accessstamp">No action offered · not a verdict</span>
        </div>
        <h2 id="capture-h" className="serif mt-3 text-[26px] leading-[1.15] text-ink">
          Nothing here is operational.
        </h2>
        <p className="mt-2 max-w-[64ch] text-sm leading-[1.6] text-ink-2">
          Capture status, evidence admission status, archive status and the evaluator verdict are separate questions. A capture or admission outcome is shown
          only when the Service reports one — see the Verifications page and each archived entry.
        </p>
        <dl className="fa-ledger mt-4 max-w-[620px] text-[12.5px]">
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 py-[6px]">
              <dt className="text-ink-3">{k}</dt>
              <dd className="min-w-0 text-right font-mono text-[11.5px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 flex flex-wrap gap-2">
          <a className={buttonClass("default", "sm")} href="#/verifications">
            Verifications
          </a>
          <a className={buttonClass("ghost", "sm")} href="#/local/history">
            History
          </a>
        </p>
      </section>
    </div>
  );
}
