import { useState } from "react";
import { splitDiff } from "../../components/detail/FieldDiff";
import type { RecordView, RuleStatus, RunView } from "../../domain/view";
import { formatTime, plural } from "../../lib/format";
import { detailRun, orderedRecords, rowOrder, timeFraction } from "../data";
import { CShell, Seal, glyph } from "./CShell";

const tech = (run: RunView, group: string, label: string) =>
  run.technical.find((g) => g.group === group)?.entries.find((e) => e.label === label)?.value ?? "—";

function Diff({ value, other, side }: { value: string | null; other: string | null; side: "src" | "dst" }) {
  if (value === null) return <span className="c-val-none">no value observed</span>;
  if (value === "") return <span className="c-val-none">empty string</span>;
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

const OP: Record<RuleStatus, { sym: string; label: string }> = {
  pass: { sym: "=", label: "holds" },
  fail: { sym: "≠", label: "is contradicted" },
  unknown: { sym: "?", label: "not assessed" },
};

function Op({ status }: { status: RuleStatus }) {
  return (
    <span className="c-op" data-s={status}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        {status === "pass" && <path d="M2.5 5h9M2.5 9h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
        {status === "fail" && <path d="M2.5 5h9M2.5 9h9M9.5 2 4.5 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
        {status === "unknown" && <path d="M4.6 5a2.4 2.4 0 1 1 3.4 2.2c-.6.3-1 .8-1 1.4v.4M7 11.6v.1" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />}
      </svg>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{OP[status].label}</span>
    </span>
  );
}

function Comparison({ record }: { record: RecordView }) {
  const rule = (id: string) => record.rules.find((r) => r.id === id);
  const field = (id: string) => record.fields.find((f) => f.field === id);
  const exists = rule("existence");
  const unique = rule("uniqueness");
  const rows = [
    {
      label: "Record exists",
      sub: "key lookup",
      status: exists?.status ?? "unknown",
      src: <>{record.key}</>,
      dst: record.candidateIds.length ? <>{record.candidateIds.join(", ")}</> : <span className="c-val-none">no contact with this key</span>,
      note: exists?.explanation,
    },
    {
      label: "One per key",
      sub: "uniqueness",
      status: unique?.status ?? "unknown",
      src: <>unique key</>,
      dst: <>{plural(record.candidateIds.length, "contact")}</>,
      note: unique?.explanation,
    },
    ...(["phone", "email"] as const).map((f) => {
      const fv = field(f)!;
      const rl = rule(f)!;
      return {
        label: fv.label,
        sub: rl.proposed ? "proposed rule" : "exact string",
        status: fv.status,
        src: <Diff value={fv.source} other={fv.destination} side="src" />,
        dst: <Diff value={fv.destination} other={fv.source} side="dst" />,
        note: rl.explanation,
      };
    }),
  ];
  return (
    <section className="c-sheet" aria-labelledby="c-cmp">
      <div className="c-compare-head">
        <div>
          <p className="c-kicker">Comparison sheet · source row {record.sourceRow + 1}</p>
          <h2 id="c-cmp" style={{ marginTop: 6 }}>
            {record.key}
          </h2>
          <p>
            {record.displayName} · {record.company}
          </p>
        </div>
        <span className="c-state" data-s={record.state}>
          {glyph(record.state)}
          {record.state}
        </span>
      </div>
      <p className="c-compare-sum">{record.summary}</p>
      <div className="c-cols c-cols-head">
        <span>Assertion</span>
        <span>Source cohort · expected</span>
        <span />
        <span>HubSpot · observed</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="c-row c-cols" data-fail={r.status === "fail" || undefined} data-unknown={r.status === "unknown" || undefined}>
          <p className="c-row-label">
            {r.label}
            <small>{r.sub}</small>
          </p>
          <p className="c-val" data-side="src">
            {r.src}
          </p>
          <div className="c-spine">
            <Op status={r.status} />
          </div>
          <p className="c-val" data-side="dst">
            {r.dst}
          </p>
          <p className="c-rule-note">{r.note}</p>
        </div>
      ))}
    </section>
  );
}

function Axis({ run }: { run: RunView }) {
  const LETTERS = ["A", "B", "C", "D"];
  const pos = (iso: string | null) => `${Math.min(100, Math.max(0, timeFraction(run, iso) * 100))}%`;
  return (
    <section className="c-sheet c-axis" aria-labelledby="c-axis">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 id="c-axis" className="c-serif" style={{ fontSize: 23 }}>
          Evidence in time
        </h2>
        <span className="c-kicker">proportional · UTC</span>
      </div>
      <div className="c-axis-track" style={{ marginTop: 20 }}>
        <span className="c-axis-window" style={{ left: 0, width: pos(run.deadline) }} title="Sync window" />
        {run.timeline.map((e, i) => (
          <span key={e.id} className="c-axis-ev" data-kind={e.id === "deadline" ? "deadline" : undefined} style={{ left: pos(e.at) }}>
            <i />
            <b>{LETTERS[i]}</b>
          </span>
        ))}
      </div>
      <ol style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18, marginTop: 6 }}>
        {run.timeline.map((e, i) => (
          <li key={e.id}>
            <p className="c-mono" style={{ color: "var(--ink-3)" }}>
              {LETTERS[i]} · {formatTime(e.at)}
            </p>
            <p style={{ fontWeight: 560, marginTop: 2, color: e.id === "deadline" ? "var(--mis)" : undefined }}>{e.label}</p>
            <p style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>{e.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CDetail() {
  const run = detailRun;
  const [selected, setSelected] = useState(orderedRecords(run)[0]!.key);
  const record = run.records.find((r) => r.key === selected)!;
  const exceptions = orderedRecords(run).filter((r) => r.state !== "Verified");
  const consistent = run.premises.filter((p) => p.support === "supported").length;
  return (
    <CShell
      page="detail"
      crumbs={
        <>
          <span>Cases</span>
          <b className="c-mono">{run.id}</b>
          <span>{run.workflow.name}</span>
        </>
      }
    >
      <header className="c-case">
        <div>
          <Seal state={run.state} />
          <h1>
            <em>
              {run.counts.Mismatch} of {run.recordsEvaluated}
            </em>{" "}
            records contradict the captured source cohort.
          </h1>
          <p className="c-lede">{run.explanation}</p>
        </div>
        <dl className="c-case-meta" aria-label="Case facts">
          <div>
            <dt>Case</dt>
            <dd>{run.id}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{run.workflow.sourceNamespace}</dd>
          </div>
          <div>
            <dt>Destination</dt>
            <dd>HubSpot · contacts</dd>
          </div>
          <div>
            <dt>Rule version</dt>
            <dd>{tech(run, "Policy", "version")}</dd>
          </div>
          <div>
            <dt>Expected total</dt>
            <dd>{run.expectedTotal ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Not fully assessed</dt>
            <dd>{plural(run.recordsNotFullyAssessed, "record")}</dd>
          </div>
        </dl>
      </header>

      <ol className="c-procession" aria-label="From source to verdict">
        <li className="c-step">
          <span className="c-step-arrow" aria-hidden>→</span>
          <p className="c-step-no">01 · SOURCE</p>
          <h3>{run.recordsEvaluated} rows captured</h3>
          <p>Read independently of n8n, not from the workflow’s own output.</p>
          <span className="c-mono">{formatTime(run.capturedAt)} · {run.workflow.sourceNamespace}</span>
        </li>
        <li className="c-step">
          <span className="c-step-arrow" aria-hidden>→</span>
          <p className="c-step-no">02 · OBSERVATION</p>
          <h3>HubSpot read</h3>
          <p>
            {tech(run, "Destination", "distinct ids returned")} distinct contacts over {tech(run, "Destination", "pages")} pages; provider total
            consistent.
          </p>
          <span className="c-mono">{formatTime(run.observedAt)} · after the {formatTime(run.deadline)} deadline</span>
        </li>
        <li className="c-step">
          <span className="c-step-arrow" aria-hidden>→</span>
          <p className="c-step-no">03 · COMPARISON</p>
          <h3>4 rules × {run.recordsEvaluated} records</h3>
          <p>Existence, uniqueness and field values, compared exactly. No hidden normalisation.</p>
          <span className="c-mono">exact-string · {tech(run, "Policy", "version")}</span>
        </li>
        <li className="c-step">
          <span className="c-step-arrow" aria-hidden>→</span>
          <p className="c-step-no">04 · EVIDENCE</p>
          <h3>
            {consistent} of {run.premises.length} premises hold
          </h3>
          <p>Provenance, inventory, approval, coverage and clock records are consistent — not authenticated.</p>
          <span className="c-mono">population confirmed · {run.expectedTotal} eligible</span>
        </li>
        <li className="c-step" data-final>
          <p className="c-step-no">05 · VERDICT</p>
          <h3>{run.state}</h3>
          <p>A required rule is shown false. {plural(run.recordsNotFullyAssessed, "record")} still carry unassessed rules.</p>
          <span className="c-mono">evaluated {formatTime(run.evaluatedAt)}</span>
        </li>
      </ol>

      <div className="c-bench">
        <section className="c-sheet c-index" aria-labelledby="c-idx">
          <p id="c-idx" className="c-kicker" style={{ marginBottom: 12 }}>
            Record index · {run.recordsEvaluated} in capture order
          </p>
          <div className="c-cells">
            {rowOrder(run).map((r) => (
              <button
                key={r.key}
                className="c-cell"
                data-s={r.state}
                aria-pressed={r.key === selected}
                aria-label={`${r.key}, ${r.state}`}
                title={`${r.key} · ${r.state}`}
                onClick={() => setSelected(r.key)}
              />
            ))}
          </div>
          <div className="c-index-list">
            {exceptions.map((r) => (
              <button key={r.key} aria-pressed={r.key === selected} onClick={() => setSelected(r.key)}>
                {glyph(r.state)}
                <span className="c-mono">{r.key}</span>
                <span className="c-issue">{r.issue}</span>
              </button>
            ))}
          </div>
          <p className="c-ledger-note">
            {run.counts.Verified} other records passed all {record.rulesTotal} rules. Select any square to open its sheet.
          </p>
        </section>
        <Comparison record={record} />
      </div>

      <div className="c-two-even">
        <section className="c-sheet" aria-labelledby="c-sup">
          <div className="c-panel-head">
            <h2 id="c-sup">What the evidence supports</h2>
            <span className="c-kicker">
              {consistent}/{run.premises.length} consistent
            </span>
          </div>
          <ul>
            {run.premises.map((p) => (
              <li key={p.id} className="c-premise">
                <svg className="c-tick" viewBox="0 0 16 16" aria-hidden>
                  {p.support === "supported" ? (
                    <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="var(--ver)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <circle cx="8" cy="8" r="6" fill="none" stroke="var(--unv)" strokeDasharray="2 2" />
                  )}
                </svg>
                <div>
                  <b>{p.label}</b>
                  <p>{p.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="c-sheet c-unknowns" aria-labelledby="c-unk">
          <div className="c-panel-head" style={{ background: "var(--sheet)" }}>
            <h2 id="c-unk">What remains unknown</h2>
            <span className="c-kicker">hatched = no conclusion</span>
          </div>
          <ul>
            <li className="c-unknown-row">
              <div>
                <b>Unassessed rules on {plural(run.recordsNotFullyAssessed, "record")}</b>
                <p>Mismatch is established by the failing rule; the remaining rules on those records were not assessed.</p>
              </div>
              <span>open</span>
            </li>
            {run.notEstablished.map((n) => (
              <li key={n.label} className="c-unknown-row">
                <div>
                  <b>{n.label}</b>
                  <p>{n.detail}</p>
                </div>
                <span>{n.value.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div style={{ marginTop: 28 }}>
        <Axis run={run} />
      </div>

      <p className="c-footnote">
        <span>Next: {run.nextStep}</span>
        <span className="c-mono">Direction C · Evidence Atelier · concept</span>
      </p>
    </CShell>
  );
}
