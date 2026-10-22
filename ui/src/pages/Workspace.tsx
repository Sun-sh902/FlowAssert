/**
 * Product round 01 — the LOCAL_RESEARCH workspace pages, read from the local Python Service:
 *   #/               Overview       the newest archived result of each reviewed case, and the workspace register
 *   #/verifications  Verifications  each reviewed case with its four status axes kept apart
 *   #/capture        Capture runs   not implemented in this build; says so and offers no action
 *
 * Every result comes from ONE complete read of the Phase 3A archive list (useArchiveIndex): all pages under
 * one pinned list snapshot, admitted page by page. Nothing is read from the MOCK demo store, nothing is
 * evaluated, and a case without an archived evaluation has no verdict — never Unverified.
 */
import { ArrowRight, RotateCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ArchiveIntegrityFailure } from "../components/history/HistoryEntry";
import { ArchivedRecordResults, shortHistoryId } from "../components/history/HistoryRows";
import { LocalModeStamp } from "../components/local/LocalResearch";
import { AccessNotice, CancelledNotice } from "../components/states/AccessStates";
import { PageHead } from "../components/ui/atelier";
import { Panel, buttonClass } from "../components/ui/primitives";
import { StatusGlyph } from "../components/ui/status";
import { AXIS_LABEL, ArchiveValue, CaptureValue, NoVerdictMark, VerdictValue, verdictSourceText } from "../components/workspace/StatusAxes";
import { ACCESS_COPY } from "../data/access";
import { HISTORY_CONTRACT_VERSION } from "../data/contract/history";
import { HISTORY_SCOPE } from "../data/history/config";
import { ACCEPTED_EVALUATOR, KNOWN_LOCAL_CASES, LOCAL_SERVICE_TARGET } from "../data/local/config";
import { getHistoryProvider, type FlowAssertHistoryProvider } from "../data/provider";
import type { ArchiveIndex, CaseIndexEntry } from "../data/workspace/archiveIndex";
import type { VerificationState } from "../domain/view";
import { cn } from "../lib/cn";
import { formatDateTime, plural, shortDigest } from "../lib/format";
import { href } from "../lib/router";
import { useArchiveIndex, type ArchiveIndexState } from "../lib/useArchiveIndex";

const SERVICE = LOCAL_SERVICE_TARGET.replace("http://", "");
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const word = (n: number, lower = false) => {
  const w = WORDS[n] ?? String(n);
  return lower ? w.toLowerCase() : w;
};
/** Attention order: what contradicts the source first, then what cannot be concluded, then what waits. */
const ATTENTION: VerificationState[] = ["Mismatch", "Unverified", "Pending", "Verified"];

/* ======================================================================================
 * The archive read, with its loading / unavailable / refused / cancelled states
 * ====================================================================================== */

function useWorkspaceRead(provider: FlowAssertHistoryProvider) {
  const [generation, setGeneration] = useState(0);
  return { generation, reread: () => setGeneration((g) => g + 1), provider };
}

/** Reads the archive (one instance per generation) and renders `ready` only for a complete, admitted list. */
function ArchiveRead({ provider, onReread, children }: { provider: FlowAssertHistoryProvider; onReread: () => void; children: (index: ArchiveIndex, pages: number) => ReactNode }) {
  const state = useArchiveIndex(provider);
  if (state.status === "ready") return <>{children(state.index, state.pages)}</>;
  return <ArchiveReadState state={state} onReread={onReread} />;
}

export function ArchiveReadState({ state, onReread }: { state: Exclude<ArchiveIndexState, { status: "ready" }>; onReread: () => void }) {
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
        title="The archive list was refused"
        body={`${state.refusal.message} No per-case result is shown: a partly admitted archive cannot say which cases are archived.`}
        facts={[
          ["Code", state.refusal.code],
          ["Pages admitted before the refusal", String(state.pagesRead)],
        ]}
        actions={reread}
      />
    );
  const f = state.failure;
  if (f?.kind === "error" && f.integrity) return <ArchiveIntegrityFailure failure={f} subject="archive list" headingLevel={2} actions={reread} />;
  if (f?.kind === "not_found") return <AccessNotice state="NOT_FOUND" body="The archive list answered 404. No result is shown." actions={reread} />;
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
      title={access === "SERVICE_UNAVAILABLE" ? "The local Service is unavailable" : undefined}
      body={`${ACCESS_COPY[access].body} ${f?.kind === "error" ? f.message : ""}${access === "SERVICE_UNAVAILABLE" ? " Start it with scripts/dev/service.sh, then read again." : ""}`}
      facts={facts}
      actions={reread}
    />
  );
}

/* ======================================================================================
 * Overview
 * ====================================================================================== */

export function WorkspaceOverview({ provider = getHistoryProvider("LOCAL_RESEARCH") }: { provider?: FlowAssertHistoryProvider }) {
  const w = useWorkspaceRead(provider);
  useEffect(() => {
    document.title = "Overview — FlowAssert";
  }, []);
  return (
    <ArchiveRead key={w.generation} provider={provider} onReread={w.reread}>
      {(index, pages) => <OverviewBody index={index} pages={pages} onReread={w.reread} />}
    </ArchiveRead>
  );
}

function Statement({ index }: { index: ArchiveIndex }) {
  const c = index.latestByState;
  const archived = KNOWN_LOCAL_CASES.length - index.notArchived;
  if (archived === 0)
    return <h1 className="display mt-3 text-[34px] leading-[1.05] text-ink sm:text-[40px]">No case has an archived evaluation yet.</h1>;
  const lead = c.Mismatch > 0 ? `${word(c.Mismatch)} ${c.Mismatch === 1 ? "case contradicts its" : "cases contradict their"} source.` : null;
  const rest: string[] = [];
  if (c.Unverified) rest.push(`${word(c.Unverified, true)} cannot be concluded`);
  if (c.Pending) rest.push(`${word(c.Pending, true)} ${c.Pending === 1 ? "is" : "are"} still waiting`);
  if (c.Verified) rest.push(`${word(c.Verified, true)} ${c.Verified === 1 ? "is" : "are"} verified`);
  if (index.notArchived) rest.push(`${word(index.notArchived, true)} ${index.notArchived === 1 ? "has" : "have"} no archived result`);
  let tail = rest.join(", ");
  if (tail) tail = `${tail[0]!.toUpperCase()}${tail.slice(1)}.`;
  return (
    <h1 className="display mt-3 text-[34px] leading-[1.05] text-ink sm:text-[40px]">
      {lead && <em className="text-mismatch-ink">{lead}</em>} <span className="text-ink-3">{tail}</span>
    </h1>
  );
}

function LatestLedger({ index }: { index: ArchiveIndex }) {
  return (
    <section aria-labelledby="latest-h">
      <h2 id="latest-h" className="kicker mb-2">
        Newest archived result · {plural(KNOWN_LOCAL_CASES.length, "case")}
      </h2>
      <dl className="fa-ledger">
        {ATTENTION.map((s) => (
          <div key={s} className="flex items-baseline justify-between py-[7px]">
            <dt className="flex items-center gap-2 text-sm text-ink-2">
              <StatusGlyph state={s} size={11} />
              {s}
            </dt>
            <dd className="metric">{index.latestByState[s]}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between py-[7px]">
          <dt className="flex items-center gap-2 text-sm text-ink-3">
            <span aria-hidden className="inline-block h-px w-[11px] bg-ink-4" />
            No archived result
          </dt>
          <dd className="metric text-ink-3">{index.notArchived}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-ink-3">Cohort results copied from each case’s newest archived evaluation. Tallies of copied results — not a population and not a new verdict.</p>
    </section>
  );
}

function Register({ index, pages }: { index: ArchiveIndex; pages: number }) {
  const rows: [string, ReactNode][] = [
    ["Service", <span key="s">answered · {SERVICE}</span>],
    ["Archive", `${plural(index.totalEntries, "entry", "entries")} · ${plural(pages, "page")} · one list view`],
    [
      "Record checks",
      index.integrityExceptions === 0 ? `${index.totalEntries} of ${index.totalEntries} INTEGRITY_VERIFIED by the Service` : `${index.integrityExceptions} not INTEGRITY_VERIFIED`,
    ],
    ["Evaluator", `${shortDigest(ACCEPTED_EVALUATOR.model_sha256)} · ${ACCEPTED_EVALUATOR.version_label}`],
    ["Contract", HISTORY_CONTRACT_VERSION],
    ["Workspace", `${HISTORY_SCOPE.workspaceId} · research_only`],
  ];
  return (
    <Panel title="Workspace register" description="What answered, and what this build cannot do." className="lg:col-span-5">
      <dl className="px-4 py-2 text-[12.5px] sm:px-5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line-subtle py-[9px] last:border-0">
            <dt className="text-ink-3">{k}</dt>
            <dd className="min-w-0 text-right font-mono text-[11.5px] break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-line px-4 py-3 sm:px-5">
        <p className="kicker mb-2">Not implemented in this build</p>
        <ul className="grid gap-2 text-xs text-ink-2">
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span>{AXIS_LABEL.capture}</span>
            <a href="#/capture" className="fa-hit rounded-xs">
              <CaptureValue axis={index.cases[0]!.axes.capture} />
            </a>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span>{AXIS_LABEL.admission}</span>
            <CaptureValue axis={index.cases[0]!.axes.admission} />
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span>Live n8n · HubSpot</span>
            <span className="font-mono text-[10.5px] text-ink-3">not connected · no credentials</span>
          </li>
        </ul>
      </div>
    </Panel>
  );
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

function caseLine(c: CaseIndexEntry): string {
  const e = c.latest;
  if (!e) return "No archived evaluation. Opening the case reads its live result from the Service.";
  const n = e.result.counts.Verified + e.result.counts.Mismatch + e.result.counts.Pending + e.result.counts.Unverified;
  switch (e.result.cohort) {
    case "Mismatch":
      return `${plural(e.result.counts.Mismatch, "record")} of ${n} ${e.result.counts.Mismatch === 1 ? "contradicts" : "contradict"} the source.`;
    case "Pending":
      return `${plural(e.result.counts.Pending, "record")} of ${n} not observed yet, inside the retry window.`;
    case "Unverified":
      return e.result.populationKnown
        ? `${plural(e.result.counts.Unverified, "record")} of ${n} ${e.result.counts.Unverified === 1 ? "lacks" : "lack"} evidence for a conclusion.`
        : `All ${n} visible records match — but the source total is unknown.`;
    case "Verified":
      return `Every required rule holds for all ${plural(n, "record")}.`;
  }
}

function CaseExhibits({ index }: { index: ArchiveIndex }) {
  const groups: { key: VerificationState | "none"; title: string; hint: string }[] = [
    { key: "Mismatch", title: "Contradicted by evidence", hint: "investigate" },
    { key: "Unverified", title: "Inconclusive", hint: "restore evidence" },
    { key: "Pending", title: "Within the retry window", hint: "wait" },
    { key: "Verified", title: "Verified at the archived observation", hint: "no action" },
    { key: "none", title: "No archived result", hint: "open to read live" },
  ];
  let n = 0;
  return (
    <Panel title="Cases" description="Newest archived evaluation per reviewed case, ordered by what to do." className="lg:col-span-7">
      {groups.map((g) => {
        const cases = index.cases.filter((c) => (g.key === "none" ? c.latest === null : c.latest?.result.cohort === g.key));
        if (!cases.length) return null;
        return (
          <section key={g.key} aria-label={g.title}>
            <h3 className="kicker flex justify-between border-b border-line-subtle px-4 pt-3 pb-2 sm:px-5">
              <span>
                {g.title} · {cases.length}
              </span>
              <span>{g.hint}</span>
            </h3>
            <ul>
              {cases.map((c) => {
                const numeral = ROMAN[n++] ?? String(n);
                return (
                  <li key={c.id} data-case={c.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-4 border-b border-line-subtle px-4 py-4 last:border-0 sm:grid-cols-[44px_minmax(0,1fr)_auto] sm:px-5">
                    <span aria-hidden data-ornament className="serif pt-0.5 text-[26px] leading-none text-ink-4 italic">
                      {numeral}
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-baseline gap-x-2.5">
                        <a href={href(`/local/verifications/${c.id}`)} className="mono-id fa-hit rounded-xs text-[15px] font-semibold text-ink hover:text-brand">
                          {c.id}
                        </a>
                        <span className="mono-id text-[10.5px] text-ink-3">fixture {c.fixture}</span>
                      </p>
                      <p className="mt-1 text-sm text-ink-2">{caseLine(c)}</p>
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
                    <span className="col-start-2 mt-3 sm:col-start-3 sm:mt-0">{c.latest ? <VerdictValue axis={c.axes.verdict} /> : <NoVerdictMark />}</span>
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

function OverviewBody({ index, pages, onReread }: { index: ArchiveIndex; pages: number; onReread: () => void }) {
  return (
    <div className="space-y-12">
      <header className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
        <div className="min-w-0">
          <p className="kicker flex flex-wrap items-center gap-x-3 gap-y-1">
            <LocalModeStamp inline />
            <span>Newest archived result per case{index.newestArchivedAt ? ` · archived ${formatDateTime(index.newestArchivedAt)}` : ""}</span>
          </p>
          <Statement index={index} />
          <p className="mt-4 max-w-[62ch] text-md leading-[1.6] text-ink-2">
            Read just now from the local Python Service at <span className="mono-id">{SERVICE}</span>: {plural(index.totalEntries, "archived evaluation")} of the five reviewed synthetic
            cases. Verdicts are the pinned evaluator’s, copied unchanged. The input is synthetic; nothing was captured from n8n or HubSpot.
          </p>
          <p className="mt-4">
            <button type="button" className={buttonClass("ghost", "sm")} onClick={onReread}>
              <RotateCcw size={12} aria-hidden /> Read the archive again
            </button>
          </p>
        </div>
        <LatestLedger index={index} />
      </header>

      {index.unexpected.length > 0 && (
        <AccessNotice
          state="REQUEST_ERROR"
          title="The archive holds entries for unknown cases"
          body={`${plural(index.unexpected.length, "entry", "entries")} name a case outside the five reviewed IDs. They are listed in History and not counted here.`}
          facts={index.unexpected.slice(0, 3).map((e) => [e.verificationId, shortHistoryId(e.historyId)] as [string, string])}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <CaseExhibits index={index} />
        <Register index={index} pages={pages} />
      </div>

      <AxesExplainer />
    </div>
  );
}

function AxesExplainer() {
  const items: { key: keyof typeof AXIS_LABEL; body: string }[] = [
    { key: "capture", body: "Whether the evidence was acquired by a capture run, and how that run ended. Not implemented: the evidence is a reviewed synthetic fixture." },
    { key: "admission", body: "Whether an admission record bound the evidence to an evaluator input — or refused it. Not implemented: a Phase 3B draft only." },
    { key: "archive", body: "Whether an evaluation is stored in the local SQLite archive, with the Service’s integrity check. Storage, not a result." },
    { key: "verdict", body: "Verified, Mismatch, Pending or Unverified — from the pinned Python evaluator only. Where no result was read, there is no verdict." },
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

export function WorkspaceVerifications({ provider = getHistoryProvider("LOCAL_RESEARCH") }: { provider?: FlowAssertHistoryProvider }) {
  const w = useWorkspaceRead(provider);
  useEffect(() => {
    document.title = "Verifications — FlowAssert";
  }, []);
  return (
    <div className="space-y-7">
      <PageHead
        kicker={<LocalModeStamp inline />}
        title="Five reviewed synthetic cases, every status kept apart."
        lede={
          <>
            Each row answers four separate questions. Only the last is a business verdict, and it comes only from the pinned Python evaluator, read from the local
            Service at <span className="mono-id">{SERVICE}</span>. Opening a case reads its live evaluation and evidence.
          </>
        }
      />
      <ArchiveRead key={w.generation} provider={provider} onReread={w.reread}>
        {(index) => <CaseTable index={index} onReread={w.reread} />}
      </ArchiveRead>
      <p className="max-w-[760px] text-xs leading-[1.55] text-ink-3">
        <b className="font-semibold text-ink-2">The verdict column is the newest archived result.</b> The frozen v1 API has no collection endpoint, so this list is built
        from the archive; a case’s page reads the live result through <span className="mono-id">GET /api/v1/verifications/:id</span>. If the Service is not running,
        this page shows <b className="font-semibold text-ink-2">Service unavailable</b> — never demo data. The MOCK demo runs are under{" "}
        <a href="#/demo/verifications" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
          Demo
        </a>
        .
      </p>
    </div>
  );
}

function CaseTable({ index, onReread }: { index: ArchiveIndex; onReread: () => void }) {
  const caption = "Reviewed cases with capture, admission, archive and evaluator verdict status";
  return (
    <Panel
      title={
        <span className="tabular">
          {index.cases.length} <span className="text-ink-3">cases · {plural(index.totalEntries, "archive entry", "archive entries")}</span>
        </span>
      }
      description="In reviewed-case order. Archive entries were read completely under one list view."
      actions={
        <button type="button" className={buttonClass("ghost", "sm")} onClick={onReread}>
          <RotateCcw size={12} aria-hidden /> Read again
        </button>
      }
    >
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm" data-case-table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="kicker py-2.5 pr-4 pl-5 font-normal">
                Case
              </th>
              <th scope="col" className="kicker py-2.5 pr-4 font-normal">
                <span aria-hidden data-ornament className="text-ink-4">01</span> Capture
              </th>
              <th scope="col" className="kicker py-2.5 pr-4 font-normal">
                <span aria-hidden data-ornament className="text-ink-4">02</span> Admission
              </th>
              <th scope="col" className="kicker py-2.5 pr-4 font-normal">
                <span aria-hidden data-ornament className="text-ink-4">03</span> Archive
              </th>
              <th scope="col" className="kicker py-2.5 pr-5 font-normal">
                <span aria-hidden data-ornament className="text-brand">04</span> Evaluator verdict
              </th>
            </tr>
          </thead>
          <tbody>
            {index.cases.map((c) => (
              <tr key={c.id} data-case={c.id} className="fa-row group relative border-b border-line-subtle align-top transition-colors duration-(--fa-dur-fast) last:border-0 hover:bg-hover">
                <td className="py-3.5 pr-4 pl-5">
                  <a
                    href={href(`/local/verifications/${c.id}`)}
                    className="mono-id block font-semibold text-ink after:absolute after:inset-0 after:content-[''] focus-visible:shadow-none focus-visible:after:shadow-(--fa-ring-inset)"
                    aria-label={`${c.id}. ${c.latest ? `Newest archived verdict ${c.latest.result.cohort}` : "No archived verdict"}. Capture and admission not implemented.`}
                  >
                    {c.id}
                  </a>
                  <span className="mono-id block text-[10.5px] text-ink-3">fixture {c.fixture}</span>
                </td>
                <td className="py-3.5 pr-4">
                  <CaptureValue axis={c.axes.capture} />
                </td>
                <td className="py-3.5 pr-4">
                  <CaptureValue axis={c.axes.admission} />
                </td>
                <td className="relative z-10 py-3.5 pr-4">
                  <ArchiveValue axis={c.axes.archive} />
                </td>
                <td className="py-3.5 pr-5">
                  <VerdictValue axis={c.axes.verdict} />
                  {c.latest && <ArchivedRecordResults entry={c.latest} className="mt-1.5 block" />}
                  <span className="mt-1 block text-[10.5px] leading-[1.45] text-ink-3">
                    {c.latest ? "pinned Python evaluator · newest archived evaluation" : verdictSourceText(c.axes.verdict)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line-subtle md:hidden" aria-label={caption}>
        {index.cases.map((c) => (
          <li key={c.id} data-case={c.id} className="px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <a href={href(`/local/verifications/${c.id}`)} className="min-w-0">
                <span className="mono-id block font-semibold text-ink">{c.id}</span>
                <span className="mono-id block truncate text-[10.5px] text-ink-3">fixture {c.fixture}</span>
              </a>
              <VerdictValue axis={c.axes.verdict} />
            </div>
            <dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-xs">
              <dt className="text-ink-3">{AXIS_LABEL.capture}</dt>
              <dd>
                <CaptureValue axis={c.axes.capture} />
              </dd>
              <dt className="text-ink-3">{AXIS_LABEL.admission}</dt>
              <dd>
                <CaptureValue axis={c.axes.admission} />
              </dd>
              <dt className="text-ink-3">{AXIS_LABEL.archive}</dt>
              <dd>
                <ArchiveValue axis={c.axes.archive} compact />
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </Panel>
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
    [AXIS_LABEL.capture, "Not implemented in this build"],
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
          Capture status, evidence admission status, archive status and the evaluator verdict are separate questions. Only the last two exist in this build — see
          the archive and the evaluator results on the Verifications page.
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
