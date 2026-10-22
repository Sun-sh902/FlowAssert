import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { DemoStamp, PageHead, ProvenanceMark, SectionHead, Segmented, Switch, provenanceCopy } from "../components/ui/atelier";
import { buttonClass } from "../components/ui/primitives";
import { Operator, RuleStatusIcon } from "../components/ui/status";
import { DEMO_POLICY, RULES, type RuleEntry, type RuleProvenance } from "../data/demoConfig";
import {
  checkDraft,
  clearRuleDraft,
  DRAFT_COMPARISON_LABEL,
  DRAFT_FIELD_LABEL,
  draftIssues,
  sameDraft,
  saveRuleDraft,
  SEED_DRAFT,
  useSavedDraft,
  type DraftComparison,
  type DraftField,
  type RuleDraft,
} from "../data/ruleDraft";
import type { RuleStatus } from "../domain/view";
import { cn } from "../lib/cn";
import { useReplaceParams, type Location } from "../lib/router";

const DRAFT_ID = "draft";

/** The saved draft, described as a register entry. It has no outcomes: it never runs. */
function draftEntry(d: RuleDraft): RuleEntry & { issues: number } {
  const issues = draftIssues(d);
  const f = d.field;
  const wrap = (x: string) => (d.comparison === "case-insensitive" ? `lower(${x})` : d.comparison === "trimmed" ? `trim(${x})` : x);
  const how = { "exact-string": "character for character", "case-insensitive": "ignoring case", trimmed: "ignoring surrounding spaces" }[d.comparison];
  return {
    id: DRAFT_ID,
    label: DRAFT_FIELD_LABEL[f],
    provenance: "draft",
    kind: `field · ${DRAFT_COMPARISON_LABEL[d.comparison]}`,
    assertion: `The HubSpot ${f === "company" ? "company" : f} matches the source ${f === "company" ? "company" : f}, ${how}.`,
    expr: { left: wrap(`source.${f}`), op: "=", right: wrap(`hubspot.${f}`) },
    required: "Draft — never evaluated",
    outcomes: [],
    note: issues
      ? `Saved only in this browser. ${issues === 1 ? "One check fails" : `${issues} checks fail`}: ${checkDraft(d)
          .filter((c) => c.status === "fail")
          .map((c) => c.label.toLowerCase())
          .join("; ")}.`
      : "Saved only in this browser. Well-formed, but no approval record binds it, so it cannot run.",
    issues,
  };
}

type Entry = RuleEntry & { issues?: number };

const GROUPS: { p: RuleProvenance; title: string; hint: string }[] = [
  { p: "research", title: "Research-supported", hint: "model.py" },
  { p: "proposed", title: "Proposed", hint: "not evaluated" },
  { p: "draft", title: "Demo-only drafts", hint: "this browser" },
];

function Census({ entries }: { entries: Entry[] }) {
  const n = (p: RuleProvenance) => entries.filter((r) => r.provenance === p).length;
  return (
    <section aria-labelledby="census-h">
      <h2 id="census-h" className="kicker mb-2">
        Rule register · {entries.length} entries
      </h2>
      <dl className="fa-ledger">
        {GROUPS.map((g) => (
          <div key={g.p} className="flex items-baseline justify-between py-[7px]">
            <dt>
              <ProvenanceMark p={g.p} long />
            </dt>
            <dd className="metric">{n(g.p)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-ink-3">Editing a draft here never changes the Python evaluator or any verification result.</p>
    </section>
  );
}

/* ---------- Rule list ---------- */

function OutcomeMarks({ rule }: { rule: RuleEntry }) {
  if (!rule.outcomes.length) return <span className="font-mono text-[10px] text-ink-3">never runs</span>;
  return (
    <span className="flex items-center gap-1" aria-label={`Possible outcomes: ${rule.outcomes.map((o) => o.status).join(", ")}`}>
      {(["pass", "fail", "unknown"] as RuleStatus[]).map((s) =>
        rule.outcomes.some((o) => o.status === s) ? (
          <Operator key={s} status={s} size={18} />
        ) : (
          <span key={s} aria-hidden className="size-[18px] rounded-full border border-line-subtle" />
        ),
      )}
    </span>
  );
}

function RuleList({ entries, selected, onSelect }: { entries: Entry[]; selected: string; onSelect: (id: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const focusAfterChange = useRef(false);
  useEffect(() => {
    if (!focusAfterChange.current) return;
    focusAfterChange.current = false;
    ref.current?.querySelector<HTMLButtonElement>(`[data-rule="${selected}"]`)?.focus();
  }, [selected]);
  // ↑/↓ move the selection through the whole register, and focus follows it.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const i = entries.findIndex((r) => r.id === selected);
    const next = entries[Math.min(entries.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    e.preventDefault();
    focusAfterChange.current = true;
    onSelect(next.id);
  };
  return (
    <nav ref={ref} aria-label="Rules" onKeyDown={onKey} className="surface min-w-0 self-start rounded-lg lg:col-span-5">
      {GROUPS.map((g) => (
        <section key={g.p} aria-label={g.title}>
          <h3 className="kicker flex justify-between border-b border-line-subtle px-4 pt-3.5 pb-2 sm:px-5">
            <span>{g.title}</span>
            <span className="text-ink-3">{g.hint}</span>
          </h3>
          <ul>
            {g.p === "draft" && !entries.some((r) => r.provenance === "draft") && (
              <li className="flex items-start gap-3 border-b border-line-subtle px-4 py-3.5 sm:px-5">
                <span aria-hidden className="mt-0.5 size-3 shrink-0 rounded-[2px] border-[1.25px] border-dotted border-ink-3" />
                <span className="min-w-0 text-sm">
                  <span className="block font-medium text-ink">No draft in this browser</span>
                  <span className="mt-0.5 block text-xs text-ink-3">
                    Write one in the{" "}
                    <button
                      type="button"
                      onClick={() => {
                        document.getElementById("draft-h")?.scrollIntoView({ behavior: "smooth", block: "start" });
                        document.getElementById("draft-field")?.focus({ preventScroll: true });
                      }}
                      className="fa-hit rounded-xs text-ink-2 underline decoration-line-strong underline-offset-[3px] hover:text-ink"
                    >
                      draft editor
                    </button>
                    . Drafts are never evaluated.
                  </span>
                </span>
              </li>
            )}
            {entries.filter((r) => r.provenance === g.p).map((r) => {
              const on = r.id === selected;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    data-rule={r.id}
                    aria-current={on ? "true" : undefined}
                    tabIndex={on ? 0 : -1}
                    onClick={() => onSelect(r.id)}
                    className={cn(
                      "fa-row-pad relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line-subtle px-4 py-3 text-left transition-colors duration-(--fa-dur-fast) focus-visible:shadow-(--fa-ring-inset) sm:px-5",
                      on ? "bg-brand-soft" : "hover:bg-hover",
                    )}
                  >
                    {on && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-brand" />}
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="text-md font-semibold text-ink">{r.label}</span>
                        {r.issues ? <span className="font-mono text-[10px] text-mismatch-ink">{r.issues === 1 ? "1 issue" : `${r.issues} issues`}</span> : null}
                      </span>
                      <span className={cn("mt-0.5 block truncate font-mono text-[11px]", on ? "text-ink-2" : "text-ink-3")}>{r.kind}</span>
                    </span>
                    <OutcomeMarks rule={r} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="px-4 py-3 text-[11.5px] leading-[1.5] text-ink-3 sm:px-5">
        ↑ ↓ move through the register. Marks show which outcomes a rule can produce: <b className="font-medium text-ink-2">=</b> holds, <b className="font-medium text-ink-2">≠</b> contradicted, <b className="font-medium text-ink-2">?</b> not assessed.
      </p>
    </nav>
  );
}

/* ---------- Rule detail ---------- */

const OUTCOME_WORD: Record<RuleStatus, string> = { pass: "Holds", fail: "Contradicted", unknown: "Not assessed" };

function RuleDetail({ rule }: { rule: RuleEntry }) {
  return (
    <article aria-labelledby="rule-h" className="surface min-w-0 rounded-lg lg:col-span-7">
      <header className="border-b border-line px-4 pt-4 pb-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ProvenanceMark p={rule.provenance} long />
          <span className="font-mono text-[10.5px] text-ink-3">rule · {rule.id}</span>
        </div>
        <h2 id="rule-h" className="display mt-3 text-[28px] leading-[1.15] text-ink">
          {rule.assertion}
        </h2>
      </header>

      {/* The assertion on the operator spine */}
      <div className={cn("grid grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)] items-center gap-2 border-b border-line px-4 py-5 sm:px-6", rule.provenance === "draft" && "opacity-80")}>
        <div className="min-w-0 text-right">
          <p className="kicker">Source cohort</p>
          <p className="mt-1 truncate font-mono text-[14px] text-brand-ink">{rule.expr.left}</p>
        </div>
        <div className="fa-spine h-full py-1">
          {rule.expr.op === "=" && rule.provenance !== "draft" ? (
            <Operator status="pass" size={32} />
          ) : (
            <span className="fa-op font-mono text-[12px] text-ink-2" style={{ width: 32, height: 32 }}>
              {rule.expr.op === "≤ 1" ? "≤1" : rule.expr.op}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="kicker">{rule.expr.right ? "HubSpot observation" : "Constraint"}</p>
          <p className="mt-1 truncate font-mono text-[14px] text-ink">{rule.expr.right || (rule.expr.op === "≤ 1" ? "at most one contact" : "no evidence source")}</p>
        </div>
      </div>

      <dl className="grid border-b border-line sm:grid-cols-2">
        <div className="px-4 py-3.5 sm:px-6">
          <dt className="label">Required</dt>
          <dd className="mt-0.5 text-sm text-ink">{rule.required}</dd>
        </div>
        <div className="border-line px-4 py-3.5 max-sm:border-t sm:border-l sm:px-6">
          <dt className="label">Bound by</dt>
          <dd className="mt-0.5 font-mono text-[12px] text-ink">
            {rule.provenance === "draft" ? "no approval record" : `${DEMO_POLICY.version} · exact-string`}
          </dd>
        </div>
      </dl>

      {rule.outcomes.length > 0 ? (
        <div className="px-4 pt-4 pb-2 sm:px-6">
          <p className="kicker mb-2">{rule.provenance === "research" ? "Outcomes · evaluator reason strings verbatim" : "Outcomes · illustrative"}</p>
          <ul className="border-t-[1.5px] border-rule">
            {rule.outcomes.map((o, i) => (
              <li key={i} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-line-subtle py-3 last:border-0 sm:grid-cols-[28px_120px_minmax(0,1fr)]">
                <Operator status={o.status} size={24} />
                <span className="text-sm font-medium text-ink sm:pt-0.5">{OUTCOME_WORD[o.status]}</span>
                <span className="min-w-0 max-sm:col-start-2">
                  <span className="block text-sm text-ink-2">{o.when}</span>
                  {o.reason !== "—" && <span className="mt-1 block font-mono text-[11.5px] text-ink-3">“{o.reason}”</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="px-4 py-5 sm:px-6">
          <p className="text-sm text-ink-2">A draft has no outcomes. It is never sent to the evaluator.</p>
        </div>
      )}

      {rule.note && (
        <p className={cn("mx-4 mb-4 border-l-2 pl-3 text-xs leading-[1.55] text-ink-2 sm:mx-6", rule.provenance === "draft" ? "border-mismatch" : "border-line-strong")}>{rule.note}</p>
      )}
    </article>
  );
}

/* ---------- Deadline & retry policy preview ---------- */

function PolicyPreview() {
  const p = DEMO_POLICY;
  const span = p.deadlineMin + 60; // axis runs one hour past the deadline
  const pct = (m: number) => `${(m / span) * 100}%`;
  const exampleObs = span - p.maxAgeMin - 5; // an observation evaluated near the end of the axis
  return (
    <section aria-labelledby="policy-h">
      <SectionHead id="policy-h" title="Deadline and retry policy" aside={`${p.version} · ${p.workflow}`} />
      <div className="surface rounded-lg">
        <div className="px-4 pt-5 pb-2 sm:px-6">
          <div className="relative mx-2 h-[96px]" role="img" aria-label={`Capture at 0, deadline after ${p.deadlineMin} minutes, observation must be at most ${p.maxAgeMin} minutes old at evaluation`}>
            {/* zones */}
            <div className="absolute top-[30px] h-[22px] rounded-l-xs border border-pending-line bg-pending-soft" style={{ left: 0, width: pct(p.deadlineMin) }} />
            <div className="absolute top-[30px] h-[22px] rounded-r-xs border border-line bg-sunken" style={{ left: pct(p.deadlineMin), right: 0 }} />
            <span className="absolute top-[34px] left-2 font-mono text-[10.5px] text-pending-ink">retry window<span className="max-sm:hidden"> · absent records wait</span></span>
            <span className="absolute top-[34px] font-mono text-[10.5px] text-ink-2 max-lg:hidden" style={{ left: `calc(${pct(p.deadlineMin)} + 8px)` }}>
              after the deadline
            </span>
            {/* axis */}
            <div className="absolute top-[64px] right-0 left-0 border-t-[1.5px] border-rule" />
            {[
              { m: 0, l: "A", t: "capture", kind: "ink" },
              { m: p.deadlineMin, l: "B", t: `deadline +${p.deadlineMin} min`, kind: "deadline" },
              { m: exampleObs, l: "C", t: "observation", kind: "ink" },
              { m: exampleObs + p.maxAgeMin, l: "D", t: "latest evaluation", kind: "brand" },
            ].map((e) => (
              <div key={e.l} className="absolute top-[22px] grid -translate-x-1/2 justify-items-center gap-1" style={{ left: pct(e.m) }}>
                <i className={cn("block h-[48px] w-[1.5px]", e.kind === "deadline" ? "bg-mismatch" : e.kind === "brand" ? "bg-brand" : "bg-ink")} />
                <b className="font-mono text-[10.5px] font-medium text-ink-2">{e.l}</b>
              </div>
            ))}
            {/* freshness bracket */}
            <div className="absolute top-[6px] h-[10px] border-x-[1.5px] border-t-[1.5px] border-brand" style={{ left: pct(exampleObs), width: pct(p.maxAgeMin) }} />
            <span className="absolute top-[-12px] right-0 font-mono text-[10px] whitespace-nowrap text-brand-ink">C → evaluation · ≤ {p.maxAgeMin} min</span>
          </div>
        </div>

        <div className="grid border-t border-line md:grid-cols-3">
          {[
            { l: "A → B", t: "Before the deadline", b: p.retryViable ? "A record not yet in HubSpot stays Pending while a retry is viable. Pending is never success." : "Retry is not viable, so an absent record is Unverified, not Pending." },
            { l: "B →", t: "At or after the deadline", b: "A complete, fresh read with no candidate shows the record absent — the existence rule is contradicted." },
            { l: "C", t: "Observation freshness", b: `The HubSpot read must be at most ${p.maxAgeMin} min old when evaluated, with a trusted clock. Otherwise nothing is concluded.` },
          ].map((z, i) => (
            <div key={z.l} className={cn("px-4 py-4 sm:px-6", i > 0 && "border-line max-md:border-t md:border-l")}>
              <p className="font-mono text-[10.5px] text-ink-3">{z.l}</p>
              <p className="mt-0.5 text-sm font-semibold text-ink">{z.t}</p>
              <p className="mt-1 text-xs leading-[1.55] text-ink-2">{z.b}</p>
            </div>
          ))}
        </div>

        <dl className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
          {[
            ["comparison", "exact-string"],
            ["retry_viable", String(p.retryViable)],
            ["settling_allowed", String(p.settlingAllowed)],
            ["max_age", `${p.maxAgeMin} min`],
            ["require_historical_deadline", String(p.requireHistorical)],
            ["require_execution", String(p.requireExecution)],
            ["account", p.account],
            ["object", p.object],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0 bg-surface px-4 py-3 sm:px-6">
              <dt className="truncate font-mono text-[10.5px] text-ink-3">{k}</dt>
              <dd className="mt-0.5 truncate font-mono text-[12.5px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="rounded-b-lg border-t border-line px-4 py-3 text-[11.5px] text-ink-3 sm:px-6">
          An illustration of what this policy means, drawn from the demo fixtures. It is not an evaluation; verdicts come only from the Python evaluator.
        </p>
      </div>
    </section>
  );
}

/* ---------- Draft rule editor ---------- */

type SaveState = { kind: "idle" } | { kind: "saved"; persisted: boolean } | { kind: "discarded" };

function DraftEditor({ onSaved, onDiscarded }: { onSaved: () => void; onDiscarded: () => void }) {
  const saved = useSavedDraft();
  const [draft, setDraft] = useState<RuleDraft>(() => saved ?? SEED_DRAFT);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSave({ kind: "idle" });
  };

  const checks = useMemo(() => checkDraft(draft), [draft]);
  const failures = checks.filter((c) => c.status === "fail").length;
  const invalid = (id: string) => checks.some((c) => c.id === id && c.status === "fail");
  const dirty = !sameDraft(saved, draft);

  const status =
    save.kind === "saved"
      ? save.persisted
        ? "Saved in this browser. Nothing was sent to the evaluator."
        : "Browser storage is unavailable — the draft is kept until you reload. Nothing was sent."
      : save.kind === "discarded"
        ? "Draft discarded from this browser."
        : saved
          ? dirty
            ? "Unsaved changes."
            : "Matches the draft saved in this browser."
          : "Not saved yet.";

  return (
    <section aria-labelledby="draft-h">
      <SectionHead id="draft-h" title="Draft rule editor" aside="saved in this browser only" />
      <div className="surface grid rounded-lg lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form
          className="min-w-0 border-line px-4 pt-4 pb-5 max-lg:border-b sm:px-6 lg:border-r"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setSave({ kind: "saved", persisted: saveRuleDraft(draft) });
            onSaved();
          }}
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <ProvenanceMark p="draft" long />
            <DemoStamp>Demo · not sent to the evaluator</DemoStamp>
          </div>

          <label className="fa-field">
            <span className="label">Compared field</span>
            <select id="draft-field" value={draft.field} onChange={(e) => set("field", e.target.value as DraftField)}>
              <option value="company">company</option>
              <option value="email">email</option>
              <option value="phone">phone</option>
            </select>
          </label>

          <div className="fa-field" data-invalid={invalid("comparison") || undefined}>
            <span className="label">Comparison</span>
            <Segmented<DraftComparison>
              label="Comparison"
              value={draft.comparison}
              onChange={(v) => set("comparison", v)}
              className="mt-1 w-fit"
              options={[
                { value: "exact-string", label: "Exact string" },
                { value: "case-insensitive", label: "Ignore case" },
                { value: "trimmed", label: "Trim spaces" },
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-x-6">
            <label className="fa-field" data-invalid={invalid("deadline") || undefined}>
              <span className="label">Deadline after capture</span>
              <span className="flex items-baseline gap-2">
                <input inputMode="numeric" value={draft.deadline} onChange={(e) => set("deadline", e.target.value)} aria-invalid={invalid("deadline")} aria-describedby="chk-deadline" />
                <span className="font-mono text-[11px] text-ink-3">min</span>
              </span>
            </label>
            <label className="fa-field" data-invalid={invalid("maxAge") || undefined}>
              <span className="label">Max observation age</span>
              <span className="flex items-baseline gap-2">
                <input inputMode="numeric" value={draft.maxAge} onChange={(e) => set("maxAge", e.target.value)} aria-invalid={invalid("maxAge")} aria-describedby="chk-maxAge" />
                <span className="font-mono text-[11px] text-ink-3">min</span>
              </span>
            </label>
          </div>

          <div className="fa-field">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-ink-2">Retry viable before deadline</span>
              <Switch checked={draft.retry} onChange={(v) => set("retry", v)} label="Retry viable before deadline" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-ink-2">Settling allowed</span>
              <Switch checked={draft.settling} onChange={(v) => set("settling", v)} label="Settling allowed" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={!dirty && !!saved} className={buttonClass("default")}>
              Save draft locally
            </button>
            {saved && (
              <button
                type="button"
                className={buttonClass("ghost")}
                onClick={() => {
                  clearRuleDraft();
                  setDraft(SEED_DRAFT);
                  setSave({ kind: "discarded" });
                  onDiscarded();
                }}
              >
                Discard draft
              </button>
            )}
            <button type="button" disabled className={buttonClass("ghost")} aria-describedby="approve-why">
              Submit for approval
            </button>
          </div>
          <p role="status" className={cn("mt-2 text-xs", save.kind === "saved" ? "text-ink" : "text-ink-3")}>
            {status}
          </p>
          <p id="approve-why" className="mt-1 text-[11.5px] text-ink-3">
            Approval is not implemented in this preview.
          </p>
        </form>

        <div className="min-w-0 px-4 pt-4 pb-5 sm:px-6">
          <div className="flex items-baseline justify-between gap-3">
            <p className="kicker">Validation</p>
            <p className={cn("font-mono text-[11px]", failures ? "text-mismatch-ink" : "text-ink-3")}>
              {failures ? `${failures} issue${failures > 1 ? "s" : ""}` : "shape valid"} · never usable
            </p>
          </div>
          <p className="serif mt-2 text-[22px] leading-[1.2] text-ink">
            {failures ? (
              <>
                This draft <em className="text-mismatch-ink">would be rejected</em> before evaluation.
              </>
            ) : (
              <>
                Well-formed, <span className="text-ink-3">but unapproved — it still cannot run.</span>
              </>
            )}
          </p>
          <ul className="mt-4 border-t-[1.5px] border-rule" aria-live="polite">
            {checks.map((c) => (
              <li key={c.id} id={`chk-${c.id}`} className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-3 border-b border-line-subtle py-2.5 last:border-0">
                <span className="pt-0.5">
                  <RuleStatusIcon status={c.status} />
                </span>
                <span>
                  <span className={cn("block text-sm font-medium", c.status === "fail" ? "text-mismatch-ink" : "text-ink")}>
                    {c.label}
                    <span className="sr-only">: {c.status === "pass" ? "passes" : c.status === "fail" ? "fails" : "cannot be satisfied by a draft"}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-3">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] leading-[1.5] text-ink-3">
            These checks restate the evaluator’s prerequisites for display. They do not run it and do not change the {provenanceCopy.research.long.toLowerCase()} rules.
          </p>
        </div>
      </div>
    </section>
  );
}

export function Rules({ location }: { location: Location }) {
  const saved = useSavedDraft();
  const entries: Entry[] = useMemo(() => (saved ? [...RULES, draftEntry(saved)] : RULES), [saved]);
  const replace = useReplaceParams("/rules");
  const requested = location.params.get("rule");
  const rule = entries.find((r) => r.id === requested) ?? entries.find((r) => r.id === "phone")!;
  const select = (id: string) => replace({ rule: id === "phone" ? null : id });
  const research = RULES.filter((r) => r.provenance === "research").length;
  return (
    <div className="grid gap-12">
      <PageHead
        kicker="Rules · register of assertions"
        title={
          <>
            {research === 5 ? "Five" : research} rules come from the research model. <span className="text-ink-3">One is proposed. Drafts never run.</span>
          </>
        }
        lede="Each rule is a claim about one record that the evidence can hold, contradict or leave unassessed. Only research-supported rules are evaluated, and only when an approval record binds that exact version and comparison."
        aside={<Census entries={entries} />}
      />
      <div className="grid gap-5 lg:grid-cols-12 lg:items-start">
        <RuleList entries={entries} selected={rule.id} onSelect={select} />
        <RuleDetail key={`${rule.id}-${rule.kind}`} rule={rule} />
      </div>
      <PolicyPreview />
      <DraftEditor onSaved={() => select(DRAFT_ID)} onDiscarded={() => select("phone")} />
    </div>
  );
}
