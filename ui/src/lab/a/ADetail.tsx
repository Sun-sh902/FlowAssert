import { useState } from "react";
import { splitDiff } from "../../components/detail/FieldDiff";
import type { RecordView, RuleStatus, RunView } from "../../domain/view";
import { formatTime, plural } from "../../lib/format";
import { detailRun, labTime, orderedRecords, rowOrder, timeFraction } from "../data";
import { AShell, AState, lamp } from "./AShell";

const tech = (run: RunView, group: string, label: string) =>
  run.technical.find((g) => g.group === group)?.entries.find((e) => e.label === label)?.value ?? "—";

const PULSE_H: Record<string, string> = { Verified: "60%", Mismatch: "100%", Pending: "35%", Unverified: "60%" };
const PULSE_BG: Record<string, string> = { Verified: "var(--ver)", Mismatch: "var(--mis)", Pending: "var(--pen)", Unverified: "var(--unv)" };

function Diff({ value, other, side }: { value: string | null; other: string | null; side: "src" | "dst" }) {
  if (value === null) return <span className="a-none">— no value observed</span>;
  if (value === "") return <span className="a-none">empty string</span>;
  if (other === null || other === value) return <>{value}</>;
  const d = splitDiff(side === "src" ? value : other, side === "src" ? other : value);
  const mid = side === "src" ? d.a : d.b;
  return (
    <>
      {d.pre}
      {mid && <mark>{mid}</mark>}
      {d.post}
    </>
  );
}

function Probe({ status }: { status: RuleStatus }) {
  const label = { pass: "equal", fail: "not equal", unknown: "not assessed" }[status];
  return (
    <div className="a-probe">
      <span data-s={status} role="img" aria-label={label}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
          {status === "pass" && <path d="M3 6h10M3 10h10" />}
          {status === "fail" && <path d="M3 6h10M3 10h10M10.5 2.5l-5 11" />}
          {status === "unknown" && <path d="M5.5 6a2.5 2.5 0 1 1 3.6 2.3c-.6.3-1.1.8-1.1 1.4v.5M8 12.8v.1" />}
        </svg>
      </span>
    </div>
  );
}

function Differential({ record }: { record: RecordView }) {
  const rule = (id: string) => record.rules.find((r) => r.id === id)!;
  const field = (id: string) => record.fields.find((f) => f.field === id)!;
  const rows = [
    { label: "Exists", sub: "key lookup", s: rule("existence").status, src: record.key, dst: record.candidateIds.join(", ") || null, note: rule("existence").explanation },
    { label: "One per key", sub: "uniqueness", s: rule("uniqueness").status, src: "1 expected", dst: plural(record.candidateIds.length, "contact"), note: rule("uniqueness").explanation },
    ...(["phone", "email"] as const).map((f) => ({
      label: field(f).label,
      sub: rule(f).proposed ? "proposed rule" : "exact string",
      s: field(f).status,
      src: field(f).source,
      dst: field(f).destination,
      note: rule(f).explanation,
      diff: true,
    })),
  ];
  return (
    <section className="a-panel" aria-labelledby="a-diff">
      <div className="a-diff-head">
        <div>
          <p className="a-cap">Differential · source row {record.sourceRow + 1}</p>
          <h2 id="a-diff" style={{ marginTop: 6 }}>
            {record.key}
          </h2>
          <p>
            {record.displayName} · {record.company}
          </p>
        </div>
        <AState state={record.state} />
      </div>
      <p className="a-diff-sum">{record.summary}</p>
      <div className="a-dcols a-dcols-head">
        <span className="a-cap">Rule</span>
        <span className="a-cap">Source cohort · expected</span>
        <span className="a-cap" style={{ textAlign: "center" }}>
          Δ
        </span>
        <span className="a-cap">HubSpot · observed</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="a-drow a-dcols" data-fail={r.s === "fail" || undefined}>
          <p className="a-dlabel">
            {r.label}
            <small>{r.sub}</small>
          </p>
          <p className="a-dval" data-side="src">
            {"diff" in r ? <Diff value={r.src} other={r.dst} side="src" /> : r.src}
          </p>
          <Probe status={r.s} />
          <p className="a-dval" data-side="dst">
            {"diff" in r ? <Diff value={r.dst} other={r.src} side="dst" /> : (r.dst ?? <span className="a-none">— none found</span>)}
          </p>
          <p className="a-dnote">{r.note}</p>
        </div>
      ))}
    </section>
  );
}

function TimeScope({ run }: { run: RunView }) {
  const pct = (iso: string | null) => `${Math.min(100, Math.max(0, timeFraction(run, iso) * 100))}%`;
  const ev = (id: string) => run.timeline.find((e) => e.id === id)!;
  return (
    <section className="a-panel a-scopebox" aria-labelledby="a-time">
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2 id="a-time" className="a-cap" style={{ color: "var(--ink-2)" }}>
          Evidence window
        </h2>
        <span className="a-cap">proportional · utc</span>
      </div>
      <div className="a-time a-graticule">
        <span className="a-time-window" style={{ width: pct(run.deadline) }} />
        {run.timeline.map((e) => (
          <i key={e.id} className="a-time-mark" data-kind={e.id} style={{ left: pct(e.at) }} />
        ))}
        <span className="a-time-flag" style={{ left: 8, top: 10 }}>
          <b>{formatTime(run.capturedAt)}</b>source captured
        </span>
        <span className="a-time-flag" style={{ right: `calc(100% - ${pct(run.deadline)} + 8px)`, top: 54, textAlign: "right", color: "var(--mis)" }}>
          <b style={{ color: "var(--mis)" }}>{formatTime(run.deadline)}</b>sync deadline
        </span>
        <span className="a-time-flag" style={{ right: 8, top: 10, textAlign: "right" }}>
          <b>
            {formatTime(ev("observed").at)} → {formatTime(ev("evaluated").at)}
          </b>
          observed → evaluated
        </span>
      </div>
      <div className="a-time-axis">
        <span>T+0</span>
        <span>window {run.windowOpen ? "open" : "closed"}</span>
        <span>T+{Math.round((labTime(run.evaluatedAt) - labTime(run.capturedAt)) / 60000)}m</span>
      </div>
    </section>
  );
}

export function ADetail() {
  const run = detailRun;
  const [selected, setSelected] = useState(orderedRecords(run)[0]!.key);
  const record = run.records.find((r) => r.key === selected)!;
  const exceptions = orderedRecords(run).filter((r) => r.state !== "Verified");
  const consistent = run.premises.filter((p) => p.support === "supported").length;
  const RULES = ["existence", "uniqueness", "phone", "email"];
  return (
    <AShell page="detail">
      <div className="a-head">
        <section className="a-panel a-verdict" aria-labelledby="a-v">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="a-runid">
              {run.id} · {run.workflow.name}
            </span>
            <AState state={run.state} />
          </div>
          <h1 id="a-v">
            <b>
              {run.counts.Mismatch} of {run.recordsEvaluated}
            </b>{" "}
            records contradict the captured source cohort.
          </h1>
          <p>{run.explanation}</p>
          <dl className="a-verdict-facts">
            <div>
              <dt>Records</dt>
              <dd>{run.recordsEvaluated}</dd>
            </div>
            <div>
              <dt>Expected</dt>
              <dd>{run.expectedTotal ?? "?"}</dd>
            </div>
            <div>
              <dt>Not fully assessed</dt>
              <dd data-warn>{run.recordsNotFullyAssessed}</dd>
            </div>
            <div>
              <dt>Premises</dt>
              <dd>
                {consistent}/{run.premises.length}
              </dd>
            </div>
          </dl>
        </section>
        <TimeScope run={run} />
      </div>

      <ol className="a-chain" aria-label="Signal chain from source to verdict">
        <li className="a-link">
          <span className="a-cap">01 Source</span>
          <b>{run.recordsEvaluated} rows captured</b>
          <p>Independent read — not workflow output.</p>
          <span className="a-mono">{run.workflow.sourceNamespace}</span>
        </li>
        <li className="a-link">
          <span className="a-cap">02 Observe</span>
          <b>HubSpot · {tech(run, "Destination", "distinct ids returned")} contacts</b>
          <p>{tech(run, "Destination", "pages")} pages, provider total consistent.</p>
          <span className="a-mono">{formatTime(run.observedAt)}</span>
        </li>
        <li className="a-link">
          <span className="a-cap">03 Compare</span>
          <b>4 rules × {run.recordsEvaluated}</b>
          <p>Exact-string, no hidden normalisation.</p>
          <span className="a-mono">{tech(run, "Policy", "version")}</span>
        </li>
        <li className="a-link">
          <span className="a-cap">04 Evidence</span>
          <b>
            {consistent}/{run.premises.length} premise records
          </b>
          <p>Consistent — not authenticated.</p>
          <span className="a-mono">population {run.populationKnown ? "confirmed" : "unknown"}</span>
        </li>
        <li className="a-link">
          <span className="a-cap" style={{ color: "var(--mis)" }}>
            05 Verdict
          </span>
          <b style={{ color: "var(--mis)" }}>{run.state}</b>
          <p>Required rule shown false.</p>
          <span className="a-mono">{formatTime(run.evaluatedAt)}</span>
        </li>
      </ol>

      <div className="a-bench">
        <section className="a-panel a-strip" aria-labelledby="a-rec">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h2 id="a-rec" className="a-cap" style={{ color: "var(--ink-2)" }}>
              Records · capture order
            </h2>
            <span className="a-cap">{run.recordsEvaluated}</span>
          </div>
          <div className="a-strip-pulses">
            {rowOrder(run).map((r) => (
              <button key={r.key} aria-pressed={r.key === selected} aria-label={`${r.key}, ${r.state}`} title={`${r.key} · ${r.state}`} onClick={() => setSelected(r.key)}>
                <i
                  style={{
                    height: PULSE_H[r.state],
                    background: PULSE_BG[r.state],
                    boxShadow: r.state === "Mismatch" ? "0 0 8px rgb(255 111 97 / 0.8)" : undefined,
                    opacity: r.state === "Verified" ? 0.8 : 1,
                  }}
                />
              </button>
            ))}
          </div>
          <div className="a-exc">
            {exceptions.map((r) => (
              <button key={r.key} aria-pressed={r.key === selected} onClick={() => setSelected(r.key)}>
                {lamp(r.state)}
                <span className="a-mono">{r.key}</span>
                <em>{r.issue}</em>
              </button>
            ))}
          </div>
          <p style={{ marginTop: 12, fontSize: 11.5, color: "var(--ink-3)" }}>{run.counts.Verified} records passed all 4 rules.</p>
        </section>
        <Differential record={record} />
      </div>

      <div className="a-grid-2">
        <section className="a-panel a-matrix" aria-labelledby="a-mx">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 id="a-mx" style={{ fontSize: 13.5, fontWeight: 600 }}>
              Test matrix
            </h2>
            <span className="a-cap">exceptions × required rules</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Record</th>
                <th>Exists</th>
                <th>One/key</th>
                <th>Phone</th>
                <th>Email*</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.map((r) => (
                <tr key={r.key}>
                  <td>{r.key}</td>
                  {RULES.map((id) => {
                    const s = r.rules.find((x) => x.id === id)?.status ?? "unknown";
                    return (
                      <td key={id}>
                        <i className="a-cellmark" data-s={s} title={s} />
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td style={{ color: "var(--ink-3)" }}>+{run.counts.Verified} verified</td>
                {RULES.map((id) => (
                  <td key={id}>
                    <i className="a-cellmark" data-s="pass" style={{ opacity: 0.45 }} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p style={{ marginTop: 10, fontSize: 11, color: "var(--ink-3)" }}>Solid = pass · glowing = fail · dashed = not assessed · *proposed rule</p>
        </section>
        <section className="a-panel a-unknown" aria-labelledby="a-unk">
          <div className="a-panel-head" style={{ borderBottomStyle: "dashed" }}>
            <h2 id="a-unk">Unresolved</h2>
            <span className="a-cap">no signal ≠ failure</span>
          </div>
          <ul>
            <li>
              <div>
                <b>Rules unassessed on {plural(run.recordsNotFullyAssessed, "record")}</b>
                <p>The failing rule settles Mismatch; the others were never assessed.</p>
              </div>
              <span>open</span>
            </li>
            {run.notEstablished.map((n) => (
              <li key={n.label}>
                <div>
                  <b>{n.label}</b>
                  <p>{n.detail}</p>
                </div>
                <span>{n.value}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="a-panel" style={{ marginTop: 18, overflow: "hidden" }} aria-labelledby="a-pr">
        <div className="a-panel-head">
          <h2 id="a-pr">Premise records</h2>
          <span className="a-cap">
            {consistent}/{run.premises.length} consistent · consistent ≠ authenticated
          </span>
        </div>
        <div className="a-seals">
          {run.premises.map((p) => (
            <div key={p.id} className="a-seal">
              <b>
                <i className={p.support === "supported" ? "a-seal-ok" : "a-lamp"} data-s="Unverified" aria-hidden />
                {p.label}
              </b>
              <p>{p.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="a-foot">
        <span>Next: {run.nextStep}</span>
        <span className="a-mono">Direction A · Precision Instrument · concept</span>
      </p>
    </AShell>
  );
}
