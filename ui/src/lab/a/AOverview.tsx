import { STACK_ORDER, type RunView, type VerificationState } from "../../domain/view";
import { formatDay, formatTime, plural, relativeToDemoNow } from "../../lib/format";
import { attention, cohortCounts, latestRuns, mismatchIssues, rowOrder, sumCounts, trend, unverifiedReason, workflowSummaries } from "../data";
import { AShell, AState, lamp } from "./AShell";

function Scale({ total, counts }: { total: number; counts: Record<VerificationState, number> }) {
  const step = 10;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  return (
    <div className="a-scale">
      <div className="a-scale-bar" role="img" aria-label={STACK_ORDER.map((s) => `${counts[s]} ${s}`).join(", ")}>
        {STACK_ORDER.filter((s) => counts[s]).map((s) => (
          <span key={s} data-s={s} style={{ flexGrow: counts[s], flexBasis: 0 }} />
        ))}
      </div>
      <div className="a-ticks" aria-hidden>
        {ticks.map((t) => (
          <i key={t} data-major={t % 50 === 0 || undefined} style={{ left: `${(t / total) * 100}%` }} />
        ))}
        {[0, 50, 100, total].map((t) => (
          <em key={t} style={{ left: `${(t / total) * 100}%` }}>
            {t}
          </em>
        ))}
      </div>
    </div>
  );
}

function Channel({ run, n }: { run: RunView; n: number }) {
  const records = rowOrder(run);
  return (
    <li className="a-ch">
      <span className="a-ch-id">CH{String(n).padStart(2, "0")}</span>
      <div>
        <p className="a-ch-name">{run.workflow.name}</p>
        <p className="a-ch-src">{run.workflow.sourceNamespace} → hubspot</p>
      </div>
      <div className="a-scope a-graticule" role="img" aria-label={`${run.recordsEvaluated} records${run.expectedTotal === null ? ", expected total unknown" : ""}`}>
        <div className="a-pulses">
          {records.map((r) => (
            <i key={r.key} className="a-pulse" data-s={r.state} />
          ))}
          {run.expectedTotal === null && [0, 1, 2, 3].map((i) => <i key={i} className="a-pulse" data-s="unknown" />)}
        </div>
        <i className="a-baseline" />
        <div className="a-scope-scale" aria-hidden>
          {[0, 10, 20, 30, 40, 50].map((t) => (
            <span key={t} style={{ left: `${(t / 50) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="a-ch-out">
        <AState state={run.state} />
        <span className="a-mono">
          {run.recordsEvaluated}/{run.expectedTotal ?? "?"} · {run.id}
        </span>
        <span className="a-mono">{relativeToDemoNow(run.evaluatedAt)}</span>
      </div>
    </li>
  );
}

function Log() {
  const group = (title: string, runs: RunView[], render: (r: RunView) => { h: string; p: string }) =>
    runs.length > 0 && (
      <>
        <li className="a-log-group a-cap">
          <span>{title}</span>
          <span>{runs.length}</span>
        </li>
        {runs.map((r) => {
          const t = render(r);
          return (
            <li key={r.id}>
              {lamp(r.state)}
              <div>
                <h3>{t.h}</h3>
                <p>
                  {r.workflow.name} · <span className="a-mono">{r.id}</span> · {t.p}
                </p>
                {r.state === "Mismatch" && (
                  <div className="a-chips">
                    {mismatchIssues(r).map((i) => (
                      <span key={i.label} className="a-chip">
                        {i.label}
                        <b>{i.count}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="a-mono" style={{ color: "var(--ink-3)" }}>
                {formatTime(r.evaluatedAt)}
              </span>
            </li>
          );
        })}
      </>
    );
  return (
    <section className="a-panel" aria-labelledby="a-log">
      <div className="a-panel-head">
        <h2 id="a-log">Annunciations</h2>
        <span className="a-cap">latest run per workflow</span>
      </div>
      <ul className="a-log">
        {group("Contradicted — investigate", attention.mismatch, (r) => ({ h: `${plural(r.counts.Mismatch, "record")} contradict the source`, p: "required rule shown false" }))}
        {group("Inconclusive — restore evidence", attention.unverified, (r) => ({
          h: unverifiedReason(r),
          p: r.accessDenied ? "not a confirmed failure" : `all ${r.counts.Verified} visible records passed`,
        }))}
        {group("Within window — wait", attention.pending, (r) => ({ h: `${plural(r.counts.Pending, "record")} not observed yet`, p: `closes ${formatTime(r.deadline)}` }))}
      </ul>
    </section>
  );
}

function History() {
  const max = Math.max(...trend.map((d) => STACK_ORDER.reduce((n, s) => n + d.counts[s], 0)));
  return (
    <section className="a-panel" aria-labelledby="a-hist">
      <div className="a-panel-head">
        <h2 id="a-hist">Signal history</h2>
        <span className="a-cap">records per UTC day</span>
      </div>
      <div className="a-history">
        <div className="a-hist a-graticule">
          {trend.map((d) => {
            const total = STACK_ORDER.reduce((n, s) => n + d.counts[s], 0);
            return (
              <div key={d.iso} className="a-hist-col" style={{ height: `${(total / max) * 100}%` }} role="img" aria-label={`${formatDay(d.iso)}: ${total} records`}>
                {STACK_ORDER.filter((s) => d.counts[s]).map((s) => (
                  <span key={s} data-s={s} style={{ flexGrow: d.counts[s], flexBasis: 0, minHeight: 2 }} />
                ))}
              </div>
            );
          })}
        </div>
        <div className="a-hist-labels">
          {trend.map((d) => (
            <span key={d.iso}>
              <b>{STACK_ORDER.reduce((n, s) => n + d.counts[s], 0)}</b>
              {formatDay(d.iso)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AOverview() {
  const c = cohortCounts(latestRuns);
  const r = sumCounts(latestRuns);
  const total = STACK_ORDER.reduce((n, s) => n + r[s], 0);
  return (
    <AShell page="overview">
      <div className="a-band">
        <section className="a-panel a-statement" aria-labelledby="a-st">
          <p className="a-cap">Cohort status · latest run per workflow</p>
          <h1 id="a-st">
            <b>{c.Mismatch} contradicted.</b> {c.Unverified} inconclusive, {c.Pending} within window, <span>{c.Verified} verified.</span>
          </h1>
          <div className="a-annunciator">
            {(["Mismatch", "Unverified", "Pending", "Verified"] as VerificationState[]).map((s) => (
              <div key={s} className="a-ann" data-lit={c[s] > 0 || undefined}>
                <span className="a-cap">
                  {lamp(s, c[s] === 0)}
                  {s}
                </span>
                <b>{c[s]}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="a-panel a-readout" aria-labelledby="a-rd">
          <div className="a-readout-top">
            <div>
              <p id="a-rd" className="a-cap">
                Record readout
              </p>
              <p className="a-big" style={{ marginTop: 12 }}>
                {total}
                <small>records · 5 latest runs</small>
              </p>
            </div>
            <p className="a-mono" style={{ color: "var(--ink-3)", textAlign: "right", lineHeight: 1.7 }}>
              last evaluation 14:22 UTC
              <br />
              rows ≠ cohorts
            </p>
          </div>
          <Scale total={total} counts={r} />
          <div className="a-legend">
            {(["Verified", "Mismatch", "Pending", "Unverified"] as VerificationState[]).map((s) => (
              <span key={s}>
                {lamp(s)}
                {s} <b>{r[s]}</b>
              </span>
            ))}
          </div>
        </section>
      </div>

      <section className="a-panel a-channels" aria-labelledby="a-ch">
        <div className="a-panel-head">
          <h2 id="a-ch">Channels</h2>
          <span className="a-cap">one pulse per record · lamp = cohort result · dashed = expected total unknown</span>
        </div>
        <ul>
          {workflowSummaries.map((w, i) => (
            <Channel key={w.workflow.id} run={w.latest} n={i + 1} />
          ))}
        </ul>
      </section>

      <div className="a-grid-2">
        <Log />
        <History />
      </div>

      <p className="a-foot">
        <span>Verified = consistent with supplied evidence records. Not authenticated; not proof of workflow execution.</span>
        <span className="a-mono">Direction A · Precision Instrument · concept</span>
      </p>
    </AShell>
  );
}
