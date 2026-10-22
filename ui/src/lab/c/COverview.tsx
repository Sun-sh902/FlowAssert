import { STACK_ORDER, type RunView, type VerificationState } from "../../domain/view";
import { formatDay, formatTime, plural, relativeToDemoNow } from "../../lib/format";
import { attention, cohortCounts, latestRuns, mismatchIssues, rowOrder, sumCounts, trend, unverifiedReason, workflowSummaries } from "../data";
import { CShell, Seal, glyph, word } from "./CShell";

function Cells({ run }: { run: RunView }) {
  return (
    <div className="c-cells" role="img" aria-label={`${run.recordsEvaluated} records: ${STACK_ORDER.filter((s) => run.counts[s]).map((s) => `${run.counts[s]} ${s}`).join(", ")}${run.expectedTotal === null ? "; expected total unknown" : ""}`}>
      {rowOrder(run).map((r) => (
        <i key={r.key} className="c-cell" data-s={r.state} />
      ))}
      {run.expectedTotal === null && [0, 1, 2].map((i) => <i key={`u${i}`} className="c-cell" data-s="unknown" />)}
    </div>
  );
}

function Trace({ run }: { run: RunView }) {
  return (
    <li className="c-trace">
      <div>
        <p className="c-trace-name">{run.workflow.name}</p>
        <p className="c-trace-src">{run.workflow.sourceNamespace}</p>
      </div>
      <div>
        <div className="c-trace-line">
          <i className="c-node-src" aria-hidden />
          <div className="c-trace-track">
            <Cells run={run} />
          </div>
          <i className="c-node-dst" aria-hidden />
          <p className="c-trace-dst">
            HubSpot
            <small>contacts</small>
          </p>
        </div>
        <div className="c-trace-meta">
          <span>
            {run.recordsEvaluated} captured {formatTime(run.capturedAt)}
            {run.expectedTotal === null ? <span className="c-unknown"> · expected total unknown</span> : ` · of ${run.expectedTotal} expected`}
          </span>
          <span>{run.accessDenied ? "read denied" : "observed"} {formatTime(run.observedAt)}</span>
        </div>
      </div>
      <div className="c-trace-verdict">
        <Seal state={run.state} />
        <br />
        <a href="#/c/detail">
          Open case <span className="c-mono">{run.id}</span> →
        </a>
      </div>
    </li>
  );
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

function Exhibits() {
  let n = 0;
  const groups: { title: string; hint: string; runs: RunView[]; state: VerificationState }[] = [
    { title: "Contradicted by evidence", hint: "investigate", runs: attention.mismatch, state: "Mismatch" },
    { title: "Inconclusive", hint: "restore evidence", runs: attention.unverified, state: "Unverified" },
    { title: "Within the sync window", hint: "wait", runs: attention.pending, state: "Pending" },
  ];
  return (
    <section className="c-sheet" aria-labelledby="c-ex">
      <h2 id="c-ex" className="c-kicker" style={{ padding: "16px 22px 0" }}>
        Exhibits · latest result per workflow
      </h2>
      {groups.map((g) =>
        g.runs.length ? (
          <div key={g.title}>
            <p className="c-exhibit-group" style={{ marginTop: 10 }}>
              <span>
                {g.title} · {g.runs.length}
              </span>
              <span>{g.hint}</span>
            </p>
            <ul className="c-exhibits">
              {g.runs.map((run) => (
                <li key={run.id}>
                  <a className="c-exhibit" href="#/c/detail">
                    <span className="c-exhibit-no">{ROMAN[n++]}</span>
                    <span>
                      <h3>
                        {run.state === "Mismatch"
                          ? `${plural(run.counts.Mismatch, "record")} contradict the source`
                          : run.state === "Unverified"
                            ? unverifiedReason(run)
                            : `${plural(run.counts.Pending, "record")} not observed yet`}
                      </h3>
                      <p>
                        {run.workflow.name} · <span className="c-mono">{run.id}</span>
                        {run.state === "Pending" && ` · window closes ${formatTime(run.deadline)}, ${relativeToDemoNow(run.deadline)}`}
                        {run.state === "Unverified" && !run.populationKnown && ` · all ${run.counts.Verified} visible records passed`}
                        {run.accessDenied && " · not a confirmed failure"}
                      </p>
                      {run.state === "Mismatch" && (
                        <span className="c-exhibit-tags">
                          {mismatchIssues(run).map((i) => (
                            <span key={i.label} className="c-tag">
                              {glyph("Mismatch")}
                              {i.label} {i.count}
                            </span>
                          ))}
                          {run.counts.Unverified > 0 && (
                            <span className="c-tag">
                              {glyph("Unverified")}
                              not fully assessed {run.counts.Unverified}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <span className="c-state" data-s={g.state}>
                      {glyph(g.state)}
                      {g.state}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </section>
  );
}

function DailyRegister() {
  return (
    <section className="c-sheet" aria-labelledby="c-days">
      <h2 id="c-days" className="c-kicker" style={{ padding: "16px 22px 0" }}>
        Daily register · records evaluated per UTC day
      </h2>
      <ul className="c-days">
        {trend.map((d) => {
          const total = STACK_ORDER.reduce((n, s) => n + d.counts[s], 0);
          return (
            <li key={d.iso} className="c-day">
              <span className="c-day-label">{formatDay(d.iso)}</span>
              <span className="c-strip" role="img" aria-label={`${total} records: ${STACK_ORDER.map((s) => `${d.counts[s]} ${s}`).join(", ")}`}>
                {STACK_ORDER.filter((s) => d.counts[s]).map((s) => (
                  <span key={s} data-s={s} style={{ flexGrow: d.counts[s], flexBasis: 0, minWidth: 3 }} />
                ))}
              </span>
              <span className="c-day-total">{total}</span>
            </li>
          );
        })}
      </ul>
      <p className="c-ledger-note" style={{ padding: "0 22px 18px" }}>
        Each day is a newly captured cohort; a record is counted once per run that evaluated it.
      </p>
    </section>
  );
}

export function COverview() {
  const c = cohortCounts(latestRuns);
  const r = sumCounts(latestRuns);
  const total = STACK_ORDER.reduce((n, s) => n + r[s], 0);
  return (
    <CShell
      page="overview"
      crumbs={
        <>
          <b>Register</b>
          <span>Lead synchronisation · n8n → HubSpot</span>
        </>
      }
    >
      <header className="c-hero">
        <div>
          <p className="c-kicker">Latest result per workflow · evaluated 16 Oct, 14:22 UTC</p>
          <h1 style={{ marginTop: 14 }}>
            <em>{word(c.Mismatch)} workflow contradicts its source.</em>{" "}
            <span className="c-h1-soft">
              {word(c.Unverified)} cannot be concluded, {word(c.Pending, true)} is still waiting, {word(c.Verified, true)} is verified.
            </span>
          </h1>
          <p className="c-lede">
            Each workflow’s HubSpot contacts are compared with a source cohort captured independently of n8n. Every square
            below is one record; hatching marks where the evidence runs out.
          </p>
        </div>
        <div>
          <p className="c-kicker" style={{ marginBottom: 8 }}>
            Record results · {total} records
          </p>
          <dl className="c-ledger">
            {(["Mismatch", "Unverified", "Pending", "Verified"] as VerificationState[]).map((s) => (
              <div key={s} className="c-ledger-row">
                <dt>
                  {glyph(s)}
                  {s}
                </dt>
                <dd className="c-num">
                  {r[s]}
                  <small>{Math.round((r[s] / total) * 100)}%</small>
                </dd>
              </div>
            ))}
          </dl>
          <p className="c-ledger-note">A cohort can stay Unverified while every one of its records is Verified.</p>
        </div>
      </header>

      <div className="c-section-head">
        <h2>Traces</h2>
        <p>Source cohort → records compared → HubSpot. The seal is the cohort result; squares are record results.</p>
      </div>
      <section className="c-sheet" aria-label="Workflow traces">
        <ul className="c-traces">
          {workflowSummaries.map((w) => (
            <Trace key={w.workflow.id} run={w.latest} />
          ))}
        </ul>
        <div className="c-key" aria-label="Key">
          <span>
            <i className="c-cell" data-s="Verified" /> Verified record
          </span>
          <span>
            <i className="c-cell" data-s="Mismatch" /> Mismatch
          </span>
          <span>
            <i className="c-cell" data-s="Pending" /> Pending
          </span>
          <span>
            <i className="c-cell" data-s="Unverified" /> Unverified — evidence insufficient
          </span>
          <span>
            <i className="c-cell" data-s="unknown" /> Expected total unknown
          </span>
        </div>
      </section>

      <div className="c-section-head">
        <h2>Requires attention</h2>
        <p>Exhibits are ordered by what to do: investigate, restore, wait.</p>
      </div>
      <div className="c-two">
        <Exhibits />
        <DailyRegister />
      </div>

      <p className="c-footnote">
        <span>Verified means consistent with the supplied evidence records — not authenticated, and not proof that n8n ran.</span>
        <span className="c-mono">Direction C · Evidence Atelier · concept</span>
      </p>
    </CShell>
  );
}
