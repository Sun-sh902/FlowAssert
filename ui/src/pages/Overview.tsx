import { ArrowRight } from "lucide-react";
import { DailyRegister } from "../components/charts/DailyRegister";
import { Trace } from "../components/runs/Trace";
import { Panel } from "../components/ui/primitives";
import { STATE_COPY, StatusGlyph, stateTone } from "../components/ui/status";
import { STATES, type RunView, type VerificationState } from "../domain/view";
import { cohortCounts, lastEvaluatedAt, latestRuns, sumCounts, trend, workflowSummaries } from "../data/store";
import { cn } from "../lib/cn";
import { formatDateTime, formatTime, plural, relativeToDemoNow } from "../lib/format";
import { href } from "../lib/router";

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const word = (n: number, lower = false) => {
  const w = WORDS[n] ?? String(n);
  return lower ? w.toLowerCase() : w;
};

/** The day's finding, from cohort counts only. Leads with what contradicts the source. */
function Verdict() {
  const c = cohortCounts(latestRuns);
  const lead =
    c.Mismatch > 0 ? `${word(c.Mismatch)} ${c.Mismatch === 1 ? "workflow contradicts its" : "workflows contradict their"} source.` : null;
  const rest: string[] = [];
  if (c.Unverified) rest.push(`${word(c.Unverified, true)} cannot be concluded`);
  if (c.Pending) rest.push(`${word(c.Pending, true)} ${c.Pending === 1 ? "is" : "are"} still waiting`);
  if (c.Verified) rest.push(`${word(c.Verified, true)} ${c.Verified === 1 ? "is" : "are"} verified`);
  let tail = rest.join(", ");
  if (tail) tail = `${tail[0]!.toUpperCase()}${tail.slice(1)}.`;
  return (
    <h1 className="display mt-3 text-[34px] leading-[1.05] text-ink sm:text-[40px]">
      {lead && <em className="text-mismatch-ink">{lead}</em>} <span className="text-ink-3">{tail || "Every workflow is verified at its latest observation."}</span>
    </h1>
  );
}

function RecordLedger() {
  const r = sumCounts(latestRuns);
  const total = STATES.reduce((n, s) => n + r[s], 0);
  return (
    <section aria-labelledby="ledger-h">
      <h2 id="ledger-h" className="kicker mb-2">
        Record results · {total} records
      </h2>
      <dl className="fa-ledger">
        {(["Mismatch", "Unverified", "Pending", "Verified"] as VerificationState[]).map((s) => (
          <div key={s} className="flex items-baseline justify-between py-[7px]">
            <dt className="flex items-center gap-2 text-sm text-ink-2">
              <StatusGlyph state={s} size={11} />
              {s}
            </dt>
            <dd className="metric">
              {r[s]}
              <small className="ml-2 font-mono text-[10.5px] tracking-normal text-ink-3">{Math.round((r[s] / total) * 100)}%</small>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-ink-3">Across the latest run of {plural(latestRuns.length, "workflow")}. A cohort can stay Unverified while every one of its records is Verified.</p>
    </section>
  );
}

/* ---------- Exhibits ---------- */

const MISMATCH_ISSUES = new Set(["Phone differs", "Email differs", "Phone & Email differs", "Missing after deadline", "Duplicate contacts"]);
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

function exhibitCopy(run: RunView): { title: string; detail: string } {
  if (run.state === "Mismatch") return { title: `${plural(run.counts.Mismatch, "record")} contradict the source`, detail: "A required rule is shown false." };
  if (run.state === "Pending")
    return { title: `${plural(run.counts.Pending, "record")} not observed yet`, detail: `Window closes ${formatTime(run.deadline)}, ${relativeToDemoNow(run.deadline)}. No action needed yet.` };
  if (run.accessDenied) return { title: "HubSpot read access denied", detail: `No destination evidence for ${plural(run.recordsEvaluated, "record")}. Not a confirmed failure.` };
  if (!run.populationKnown) return { title: "Source total unconfirmed", detail: `All ${run.counts.Verified} visible records passed; no independent inventory confirms the cohort is complete.` };
  return { title: `${plural(run.counts.Unverified, "record")} lack evidence`, detail: run.nextStep };
}

function Exhibits() {
  const groups: { state: "Mismatch" | "Unverified" | "Pending"; title: string; hint: string }[] = [
    { state: "Mismatch", title: "Contradicted by evidence", hint: "investigate" },
    { state: "Unverified", title: "Inconclusive", hint: "restore evidence" },
    { state: "Pending", title: "Within the sync window", hint: "wait" },
  ];
  let n = 0;
  const any = latestRuns.some((r) => r.state !== "Verified");
  return (
    <Panel title="Exhibits" description="Latest result per workflow, ordered by what to do." className="lg:col-span-7">
      {!any && <p className="px-5 py-6 text-sm text-ink-3">Nothing requires attention at the latest observations.</p>}
      {groups.map((g) => {
        const runs = latestRuns.filter((r) => r.state === g.state);
        if (!runs.length) return null;
        return (
          <section key={g.state} aria-label={g.title}>
            <h3 className="kicker flex justify-between border-b border-line-subtle px-4 pt-3 pb-2 sm:px-5">
              <span>
                {g.title} · {runs.length}
              </span>
              <span>{g.hint}</span>
            </h3>
            <ul>
              {runs.map((run) => {
                const copy = exhibitCopy(run);
                const t = stateTone(run.state);
                return (
                  <li key={run.id} className="border-b border-line-subtle last:border-0">
                    <a
                      href={href(`/verifications/${run.id}`, { state: run.state === "Unverified" ? null : run.state })}
                      className="grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3 px-4 py-4 transition-colors duration-(--fa-dur-fast) hover:bg-hover sm:grid-cols-[48px_minmax(0,1fr)_auto] sm:px-5"
                    >
                      <span className="font-display text-[28px] leading-[0.9] text-ink-4 italic" aria-hidden data-ornament>
                        {ROMAN[n++]}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-md leading-5 font-semibold text-ink">{copy.title}</span>
                        <span className="mt-0.5 block text-xs text-ink-2">
                          {run.workflow.name} · <span className="mono-id">{run.id}</span> — {copy.detail}
                        </span>
                        {run.state === "Mismatch" && (
                          <span className="mt-2.5 flex flex-wrap gap-1.5">
                            {run.issueBreakdown
                              .filter((b) => MISMATCH_ISSUES.has(b.label))
                              .map((b) => (
                                <span key={b.label} className="inline-flex items-center gap-1.5 rounded-xs border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2">
                                  <StatusGlyph state="Mismatch" size={9} />
                                  {b.label} {b.count}
                                </span>
                              ))}
                            {run.counts.Unverified > 0 && (
                              <span className="inline-flex items-center gap-1.5 rounded-xs border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2">
                                <StatusGlyph state="Unverified" size={9} />
                                not fully assessed {run.counts.Unverified}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                      <span className={cn("inline-flex items-center gap-1.5 self-start text-xs font-medium", t.ink)}>
                        <StatusGlyph state={run.state} size={11} />
                        <span className="hidden sm:inline">{run.state}</span>
                      </span>
                    </a>
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

/* ---------- Page ---------- */

export function Overview() {
  return (
    <div>
      <header className="grid gap-x-14 gap-y-8 pb-2 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
        <div>
          <p className="kicker">Latest result per workflow · evaluated {formatDateTime(lastEvaluatedAt)}</p>
          <Verdict />
          <p className="mt-4 max-w-[620px] text-md leading-[1.55] text-ink-2">
            Each workflow’s HubSpot contacts are compared with a source cohort captured independently of n8n. Every square below is one record;
            hatching marks where the evidence runs out.
          </p>
        </div>
        <RecordLedger />
      </header>

      <div className="mt-11 mb-3.5 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <h2 className="display text-2xl text-ink">Traces</h2>
        <a href="#/verifications" className="fa-hit inline-flex items-center gap-1 rounded-xs text-xs font-medium text-ink-2 hover:text-ink">
          All verifications <ArrowRight size={13} aria-hidden />
        </a>
      </div>
      <section aria-label="Workflow traces — source cohort, records compared, HubSpot" className="surface rounded-lg">
        <ul className="px-4 sm:px-6">
          {workflowSummaries.map((w) => (
            <Trace key={w.workflow.id} run={w.latest} />
          ))}
        </ul>
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line-subtle px-4 py-3 text-xs text-ink-2 sm:px-6" aria-label="Key">
          <span className="inline-flex items-center gap-2">
            <i className="fa-cell" data-s="Verified" /> Verified record
          </span>
          <span className="inline-flex items-center gap-2">
            <i className="fa-cell" data-s="Mismatch" /> Mismatch
          </span>
          <span className="inline-flex items-center gap-2">
            <i className="fa-cell" data-s="Pending" /> Pending
          </span>
          <span className="inline-flex items-center gap-2">
            <i className="fa-cell" data-s="Unverified" /> Unverified — evidence insufficient
          </span>
          <span className="inline-flex items-center gap-2">
            <i className="fa-cell" data-s="unknown" /> Expected total unknown
          </span>
          <span className="text-ink-3 sm:ml-auto">Seal = cohort result · squares = record results</span>
        </div>
      </section>

      <h2 className="display mt-11 mb-3.5 text-2xl text-ink">Requires attention</h2>
      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <Exhibits />
        <Panel title="Daily register" description="Records evaluated per UTC day, across all runs." className="lg:col-span-5" bodyClassName="px-4 pt-2 pb-4 sm:px-5">
          <DailyRegister days={trend} />
        </Panel>
      </div>

      <section aria-labelledby="states-h" className="mt-10 border-t-[1.5px] border-rule pt-4">
        <h2 id="states-h" className="kicker mb-3">
          How to read the four states
        </h2>
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATES.map((s) => (
            <div key={s}>
              <dt className="flex items-center gap-2 font-display text-xl text-ink">
                <StatusGlyph state={s} size={12} />
                {s}
              </dt>
              <dd className="mt-1 text-xs leading-[1.55] text-ink-2">{STATE_COPY[s].meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-xs text-ink-3">Verified means consistent with the supplied evidence records — not authenticated, and not proof that n8n ran.</p>
      </section>
    </div>
  );
}
