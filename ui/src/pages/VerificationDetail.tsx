import { ArrowLeft, Check, CircleAlert, Copy, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ComparisonSheet } from "../components/detail/ComparisonSheet";
import { InvalidIdNotice } from "../components/local/InvalidId";
import { LocalEvidencePanel, LocalProvenance, LocalReadState } from "../components/local/LocalResearch";
import { AccessNotice } from "../components/states/AccessStates";
import { Disclosure, EmptyState, FilterChips, Panel, SearchField, buttonClass } from "../components/ui/primitives";
import { STATE_COPY, Seal, StatusGlyph, stateTone } from "../components/ui/status";
import { CaseStatusAxes } from "../components/workspace/StatusAxes";
import { STATES, type RecordView, type RunView, type VerificationState } from "../domain/view";
import { checkLookupVerificationId, checkVerificationId, encodeIdSegment } from "../data/local/ids";
import { localLookupProvider, localResearchProvider, type LocalAddressing } from "../data/local/provider";
import type { FlowAssertReadProvider } from "../data/provider";
import { getRun } from "../data/store";
import { cn } from "../lib/cn";
import { formatDateTime, formatTime, plural, relativeTo, relativeToDemoNow, shortDigest } from "../lib/format";
import { href, LOOKUP_PATH, lookupHref, useReplaceParams, type Location } from "../lib/router";
import { matchesSearch } from "../lib/search";
import { useProviderRead } from "../lib/useProviderRead";

const PRIORITY: Record<VerificationState, number> = { Mismatch: 0, Unverified: 1, Pending: 2, Verified: 3 };
type Filter = "all" | VerificationState;

const tech = (run: RunView, group: string, label: string) =>
  run.technical.find((g) => g.group === group)?.entries.find((e) => e.label === label)?.value ?? "—";

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard unavailable — no false confirmation */
        }
      }}
      className="fa-hit inline-flex items-center gap-1.5 rounded-xs font-mono text-xs text-ink-2 hover:text-ink"
      aria-label={copied ? `Copied ${id}` : `Copy run ID ${id}`}
    >
      {id}
      {copied ? <Check size={12} aria-hidden className="text-verified" /> : <Copy size={12} aria-hidden className="text-ink-4" />}
    </button>
  );
}

/* ---------- Verdict ---------- */

/**
 * MOCK measures against the fixed demo clock. LOCAL_RESEARCH copies `window_open_at_evaluation` and
 * measures against the evaluation instant (the snapshot's declared clock), never the browser clock.
 */
function syncWindow(run: RunView): ReactNode {
  if (run.windowOpen === null) return <span className="text-unverified-ink">not stated</span>;
  if (!run.local) return run.windowOpen ? `open · closes ${relativeToDemoNow(run.deadline)}` : "closed";
  return run.windowOpen ? `open at evaluation · closes ${relativeTo(run.deadline, run.evaluatedAt, "evaluation")}` : "closed at evaluation";
}

const ACCESS_STEP: Record<RunView["destinationAccess"], { h: string; p: string }> = {
  ok: { h: "HubSpot read", p: "" },
  denied: { h: "HubSpot read denied", p: "No contacts returned, so no destination evidence exists." },
  timeout: { h: "HubSpot read timed out", p: "The read did not complete, so no usable destination evidence exists." },
  unknown: { h: "HubSpot access unknown", p: "Access was not established, so no usable destination evidence exists." },
};

function observedVsDeadline(run: RunView): string {
  if (run.observedAt === null || run.deadline === null) return `observation relative to the ${formatTime(run.deadline)} deadline unknown`;
  return `${Date.parse(run.observedAt) >= Date.parse(run.deadline) ? "after" : "before"} the ${formatTime(run.deadline)} deadline`;
}

function Headline({ run }: { run: RunView }) {
  if (run.state === "Mismatch")
    return (
      <>
        <em className="text-mismatch-ink">
          {run.counts.Mismatch} of {run.recordsEvaluated}
        </em>{" "}
        records contradict the captured source cohort.
      </>
    );
  return <>{run.headline}</>;
}

function Verdict({ run }: { run: RunView }) {
  const facts: [string, ReactNode][] = [
    ["Case", <CopyId key="id" id={run.id} />],
    ["Source", run.workflow.sourceNamespace],
    ["Destination", "HubSpot · contacts"],
    ["Rule version", tech(run, "Policy", "version")],
    ["Expected total", run.expectedTotal ?? <span className="text-unverified-ink">unknown</span>],
    [
      "Not fully assessed",
      run.recordsNotFullyAssessed ? <span className="text-unverified-ink">{plural(run.recordsNotFullyAssessed, "record")}</span> : "none",
    ],
    ["Sync window", syncWindow(run)],
  ];
  return (
    <header className="grid gap-x-12 gap-y-7 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Seal state={run.state} size="lg" />
          <span className="text-xs text-ink-3">Cohort result · {STATE_COPY[run.state].short}</span>
        </div>
        <h1 className="display mt-4 text-[34px] leading-[1.04] text-ink sm:text-[44px]">
          <Headline run={run} />
        </h1>
        <p className="mt-4 max-w-[640px] text-md leading-[1.55] text-ink-2">{run.explanation}</p>
        {run.state !== "Verified" && run.counts.Verified === run.recordsEvaluated && (
          <p className="mt-3 max-w-[640px] text-sm text-unverified-ink">
            Every record passed, yet the cohort is not Verified — row results do not establish that the source population is complete.
          </p>
        )}
      </div>
      <dl className="fa-ledger text-[12.5px]" aria-label="Case facts">
        {facts.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 py-[7px]">
            <dt className="text-ink-3">{k}</dt>
            <dd className="text-right font-mono text-[11.5px] text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

/* ---------- Procession: Source → Observation → Comparison → Evidence → Verdict ---------- */

function Procession({ run }: { run: RunView }) {
  const consistent = run.premises.filter((p) => p.support === "supported").length;
  const provenance = run.premises.find((p) => p.id === "provenance")?.support === "supported";
  const coverage = run.premises.find((p) => p.id === "coverage")?.support === "supported";
  const rulesPerRecord = run.records[0]?.rulesTotal ?? 0;
  const access = ACCESS_STEP[run.destinationAccess];
  const steps = [
    {
      k: "Source",
      // LOCAL_RESEARCH rows come from a reviewed fixture: no capture run exists (Capture status: not implemented).
      h: run.local ? `${plural(run.recordsEvaluated, "row")} supplied` : `${run.recordsEvaluated} rows captured`,
      p: provenance
        ? run.local
          ? "Supplied as an independent source read, not workflow output — synthetic, not authenticated."
          : "Read independently of n8n, not from the workflow’s own output."
        : "No consistent provenance record for the source read.",
      m: `${formatTime(run.capturedAt)} · ${run.workflow.sourceNamespace}`,
    },
    {
      k: "Observation",
      h: access.h,
      p:
        run.destinationAccess !== "ok"
          ? access.p
          : `${tech(run, "Destination", "distinct ids returned")} distinct contacts over ${tech(run, "Destination", "pages")} pages; provider total ${coverage ? "consistent" : "inconsistent — a match may be hidden"}.`,
      m: `${formatTime(run.observedAt)} · ${observedVsDeadline(run)}`,
    },
    {
      k: "Comparison",
      h: `${rulesPerRecord} rules × ${run.recordsEvaluated} records`,
      p: "Existence, uniqueness and field values, compared exactly. No hidden normalisation.",
      m: `${tech(run, "Policy", "comparison")} · ${tech(run, "Policy", "version")}`,
    },
    {
      k: "Evidence",
      h: `${consistent} of ${run.premises.length} premises hold`,
      p: "Provenance, inventory, approval, coverage and clock records are consistent — not authenticated.",
      m: run.populationKnown ? `population confirmed · ${run.expectedTotal ?? "count not stated"} eligible` : "population unknown · no inventory",
    },
    {
      k: "Verdict",
      h: run.state,
      p: `${STATE_COPY[run.state].short}.${run.recordsNotFullyAssessed ? ` ${plural(run.recordsNotFullyAssessed, "record")} carry unassessed rules.` : ""}`,
      m: `evaluated ${formatTime(run.evaluatedAt)}`,
    },
  ];
  return (
    <ol className="fa-procession mt-9" aria-label="From source to verdict">
      {steps.map((s, i) => (
        <li key={s.k} className="fa-step">
          {i < steps.length - 1 && (
            <span className="fa-step-arrow" aria-hidden>
              →
            </span>
          )}
          <p className="kicker">
            0{i + 1} · {s.k}
          </p>
          <h2 className={cn("serif mt-1 mb-2 text-xl", i === 4 && cn("italic", stateTone(run.state).ink))}>{s.h}</h2>
          <p className="text-xs leading-[1.5] text-ink-2">{s.p}</p>
          <p className="mt-1.5 font-mono text-[10.5px] text-ink-3">{s.m}</p>
        </li>
      ))}
    </ol>
  );
}

/* ---------- Record index + comparison sheet ---------- */

function RecordRow({ record, selected, onSelect }: { record: RecordView; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        data-key={record.key}
        data-row-id={record.rowId}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "fa-row relative grid h-10 w-full grid-cols-[14px_auto_minmax(0,1fr)_auto] items-center gap-2.5 px-4 text-left transition-colors duration-(--fa-dur-fast) focus-visible:shadow-(--fa-ring-inset)",
          selected ? "bg-brand-soft" : "hover:bg-hover",
        )}
      >
        {selected && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-brand" aria-hidden />}
        <StatusGlyph state={record.state} size={11} />
        <span className={cn("mono-id font-medium text-ink", record.keyMalformed && "italic")} title={record.keyMalformed ? "Raw key is not a string; shown as JSON" : undefined}>
          {record.key}
        </span>
        <span className={cn("truncate text-xs", selected ? "text-ink-2" : "text-ink-3", record.displayName === null && "italic")}>
          {record.displayName ?? "no name supplied"}
        </span>
        {/* On the selected (brand-tinted) row the counter steps up one ink, like the name, to keep 4.5:1 contrast. */}
        <span className={cn("text-xs", record.issue ? stateTone(record.state).ink : cn("font-mono text-[10.5px]", selected ? "text-ink-2" : "text-ink-3"))}>
          {record.issue ?? `${record.rulesPassed}/${record.rulesTotal}`}
        </span>
      </button>
    </li>
  );
}

/**
 * The selected record. `?record=` carries the row identity (`runId:sourceRow`, gap G3). A legacy deep
 * link that names a record key is still honoured when exactly one record has that key.
 */
function findSelected(visible: RecordView[], param: string | null): RecordView | null {
  if (param === null) return visible[0] ?? null;
  const byRow = visible.find((r) => r.rowId === param);
  if (byRow) return byRow;
  const byKey = visible.filter((r) => r.key === param);
  return (byKey.length === 1 ? byKey[0] : visible[0]) ?? null;
}

function Bench({ run, location, basePath, baseParams }: { run: RunView; location: Location; basePath: string; baseParams?: Record<string, string> }) {
  const setParams = useReplaceParams(basePath, baseParams);
  const stateParam = location.params.get("state");
  const filter: Filter = STATES.includes(stateParam as VerificationState) ? (stateParam as VerificationState) : "all";
  const [q, setQ] = useState("");
  const sheetRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const focusAfterRender = useRef(false);

  const ordered = useMemo(() => [...run.records].sort((a, b) => PRIORITY[a.state] - PRIORITY[b.state] || a.sourceRow - b.sourceRow), [run.records]);
  const captureOrder = useMemo(() => [...run.records].sort((a, b) => a.sourceRow - b.sourceRow), [run.records]);
  const searched = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return ordered;
    // Null name/company are skipped, never searched as their fallback text (UIA-009).
    return ordered.filter((r) => matchesSearch(n, [r.key, r.displayName, r.company, ...r.candidateIds]));
  }, [ordered, q]);
  const visible = filter === "all" ? searched : searched.filter((r) => r.state === filter);
  const visibleRows = new Set(visible.map((r) => r.rowId));

  const selected = findSelected(visible, location.params.get("record"));

  const select = (rowId: string | null, nextFilter: Filter = filter, scroll = false) => {
    setParams({ state: nextFilter === "all" ? null : nextFilter, record: rowId });
    if (scroll && window.matchMedia("(max-width: 1023px)").matches) {
      window.requestAnimationFrame(() => sheetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const idx = visible.findIndex((r) => r.rowId === selected?.rowId);
    const next = visible[Math.min(visible.length - 1, Math.max(0, idx + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    focusAfterRender.current = true;
    select(next.rowId);
  };

  useEffect(() => {
    if (!focusAfterRender.current || !selected) return;
    focusAfterRender.current = false;
    const el = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-row-id]") ?? [])].find((b) => b.dataset.rowId === selected.rowId);
    el?.focus();
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <section aria-labelledby="index-title" className="mt-9 grid gap-6 lg:grid-cols-12 lg:items-start">
      <div className="surface flex flex-col rounded-lg lg:sticky lg:top-6 lg:col-span-5 lg:max-h-[min(calc(100dvh-3rem),760px)] xl:col-span-4">
        <div className="border-b border-line px-4 pt-4 pb-3">
          <h2 id="index-title" className="kicker">
            Record index · {run.recordsEvaluated} in capture order
          </h2>
          <div className="mt-3 flex flex-wrap gap-1" aria-hidden>
            {captureOrder.map((r) => (
              <button
                key={r.rowId}
                type="button"
                tabIndex={-1}
                title={`${r.key} · ${r.state}`}
                onClick={() => select(r.rowId, visibleRows.has(r.rowId) ? filter : "all", true)}
                className={cn(
                  "fa-cell size-[15px]! rounded-[2px] transition-[opacity,transform] duration-(--fa-dur-fast) hover:-translate-y-px",
                  !visibleRows.has(r.rowId) && "opacity-25",
                  r.rowId === selected?.rowId && "shadow-[0_0_0_2px_var(--fa-surface),0_0_0_3.5px_var(--fa-brand)]!",
                )}
                data-s={r.state}
              />
            ))}
            {run.expectedTotal === null && [0, 1, 2].map((i) => <i key={i} className="fa-cell size-[15px]!" data-s="unknown" />)}
          </div>
        </div>
        <div className="space-y-2 border-b border-line-subtle px-4 py-3">
          <SearchField value={q} onChange={setQ} label="Search records" placeholder="Key, name, company or contact ID" />
          <FilterChips<Filter>
            label="Filter records by state"
            value={filter}
            onChange={(v) => select(null, v)}
            options={[
              { value: "all", label: "All", count: searched.length },
              ...STATES.filter((s) => run.counts[s] > 0).map((s) => ({
                value: s as Filter,
                label: s,
                count: searched.filter((r) => r.state === s).length,
                icon: <StatusGlyph state={s} size={10} />,
              })),
            ]}
          />
        </div>
        {visible.length ? (
          <ul ref={listRef} onKeyDown={onListKey} aria-label="Records — use arrow keys to move" className="max-h-[360px] min-h-0 flex-1 divide-y divide-line-subtle overflow-y-auto lg:max-h-none">
            {visible.map((r) => (
              <RecordRow key={r.rowId} record={r} selected={r.rowId === selected?.rowId} onSelect={() => select(r.rowId, filter, true)} />
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No records match"
            body={q ? `Nothing in this run matches “${q}”.` : `No ${filter} records in this run.`}
            action={
              <button
                type="button"
                className={buttonClass()}
                onClick={() => {
                  setQ("");
                  select(null, "all");
                }}
              >
                Clear filters
              </button>
            }
          />
        )}
      </div>

      <div ref={sheetRef} className="surface scroll-mt-16 overflow-hidden rounded-lg lg:col-span-7 xl:col-span-8">
        {selected ? <ComparisonSheet record={selected} run={run} /> : <EmptyState title="No record selected" body="Adjust the search or filter to select a record." />}
      </div>
    </section>
  );
}

/* ---------- Supports / unknown ---------- */

function Supports({ run }: { run: RunView }) {
  const consistent = run.premises.filter((p) => p.support === "supported").length;
  return (
    <Panel
      title="What the evidence supports"
      actions={
        <span className={cn("kicker", consistent < run.premises.length && "text-unverified-ink")}>
          {consistent}/{run.premises.length} consistent
        </span>
      }
    >
      <ul className="divide-y divide-line-subtle">
        {run.premises.map((p) => {
          const ok = p.support === "supported";
          return (
            <li key={p.id} className={cn("grid grid-cols-[18px_1fr] gap-2.5 px-4 py-3 sm:px-5", !ok && "hatch-soft")}>
              {ok ? <Check size={15} aria-hidden className="mt-0.5 text-verified" /> : <CircleAlert size={15} aria-hidden className="mt-0.5 text-unverified" />}
              <div>
                <p className="text-sm font-semibold text-ink">
                  {p.label}
                  {!ok && <span className="ml-2 font-mono text-[10.5px] font-normal text-unverified-ink">not established</span>}
                </p>
                <p className="mt-0.5 text-xs leading-[1.5] text-ink-2">{p.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="flex gap-2.5 border-t border-dashed border-line-strong px-4 py-3 text-xs leading-[1.5] text-ink-3 sm:px-5">
        <ShieldAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
        <span>
          <b className="font-semibold text-ink-2">Consistent is not authenticated.</b> These checks catch omissions, substitutions and version drift that the
          records reveal; they cannot detect evidence fabricated to be internally consistent.
        </span>
      </p>
    </Panel>
  );
}

function Unknowns({ run }: { run: RunView }) {
  return (
    <section aria-labelledby="unk-h" className="surface fa-unknown rounded-lg">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-line bg-surface px-4 pt-3.5 pb-3 sm:px-5">
        <h2 id="unk-h" className="serif text-xl text-ink">
          What remains unknown
        </h2>
        <span className="kicker">hatched = no conclusion</span>
      </header>
      <ul className="divide-y divide-line-subtle">
        {run.recordsNotFullyAssessed > 0 && (
          <li className="grid grid-cols-[1fr_auto] gap-3 bg-surface/85 px-4 py-3 sm:px-5">
            <div>
              <p className="text-sm font-semibold text-ink">Unassessed rules on {plural(run.recordsNotFullyAssessed, "record")}</p>
              <p className="mt-0.5 text-xs leading-[1.5] text-ink-2">
                {run.state === "Mismatch"
                  ? "Mismatch is established by the failing rule; the remaining rules on those records were not assessed."
                  : "These records have at least one rule the evidence could not assess."}
              </p>
            </div>
            <span className="font-mono text-[10.5px] text-unverified-ink">open</span>
          </li>
        )}
        {run.notEstablished.map((n) => (
          <li key={n.label} className="grid grid-cols-[1fr_auto] gap-3 bg-surface/85 px-4 py-3 sm:px-5">
            <div>
              <p className="text-sm font-semibold text-ink">{n.label}</p>
              <p className="mt-0.5 text-xs leading-[1.5] text-ink-2">{n.detail}</p>
            </div>
            <span className="text-right font-mono text-[10.5px] text-unverified-ink">{n.value.toLowerCase()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Evidence in time ---------- */

function TimeAxis({ run, previousRunLink = true }: { run: RunView; previousRunLink?: boolean }) {
  const LETTERS = ["A", "B", "C", "D"];
  // The proportional axis needs its three anchors. Without them no event gets a position: an
  // unavailable time is listed as unavailable, never drawn at tick zero (gap G1).
  const anchored = run.capturedAt !== null && run.evaluatedAt !== null && run.deadline !== null;
  const start = run.capturedAt === null ? 0 : Date.parse(run.capturedAt);
  const end = anchored ? Math.max(Date.parse(run.evaluatedAt!), Date.parse(run.deadline!)) : 0;
  const pos = (iso: string) => `${Math.min(100, Math.max(0, ((Date.parse(iso) - start) / Math.max(60000, end - start)) * 100))}%`;
  return (
    <Panel
      title="Evidence in time"
      actions={<span className="kicker">{run.local ? "proportional · UTC · synthetic tick mapping" : "proportional · UTC"}</span>}
      bodyClassName="px-4 pt-5 pb-5 sm:px-6"
    >
      {anchored ? (
        <div className="fa-axis hidden sm:block" aria-hidden>
          <span className="fa-axis-window" style={{ left: 0, width: pos(run.deadline!) }} />
          {run.timeline.map((e, i) =>
            e.at === null ? null : (
              <span key={e.id} className="fa-axis-ev" data-kind={e.id === "deadline" ? "deadline" : undefined} style={{ left: pos(e.at) }}>
                <i />
                <b>{LETTERS[i]}</b>
              </span>
            ),
          )}
        </div>
      ) : (
        <p className="hidden font-mono text-[11px] text-ink-3 sm:block">No proportional axis: capture, evaluation or deadline time is unavailable.</p>
      )}
      <ol className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        {run.timeline.map((e, i) => (
          <li key={e.id}>
            <p className={cn("font-mono text-[11px] text-ink-3", e.at === null && "text-unverified-ink")}>
              {LETTERS[i]} · {formatDateTime(e.at)}
              {e.future && <span className="ml-1.5 text-pending-ink">{run.local ? "after evaluation" : "upcoming"}</span>}
            </p>
            <p className={cn("mt-0.5 text-sm font-semibold", e.id === "deadline" ? "text-mismatch-ink" : "text-ink")}>{e.label}</p>
            <p className="mt-0.5 text-xs leading-[1.5] text-ink-2">{e.detail}</p>
          </li>
        ))}
      </ol>
      {previousRunLink && run.previousRunId && (
        <a href={href(`${run.local ? "/local" : "/demo"}/verifications/${run.previousRunId}`)} className="fa-hit mt-5 inline-flex items-center gap-1.5 rounded-xs text-xs font-medium text-ink-2 hover:text-ink">
          <ArrowLeft size={13} aria-hidden /> Previous run for this workflow <span className="mono-id text-ink-3">{run.previousRunId}</span>
        </a>
      )}
    </Panel>
  );
}

function Technical({ run }: { run: RunView }) {
  return (
    <Panel
      title="Technical metadata"
      description={
        run.local
          ? "Copied from the local service response. Digests identify supplied values and code; they do not authenticate origin."
          : "Evaluator inputs and outputs behind this result. Digests in this demo are placeholders."
      }
      bodyClassName="px-4 sm:px-5"
    >
      <div className="divide-y divide-line-subtle">
        {run.technical.map((g) => (
          <Disclosure key={g.group} summary={g.group} meta={plural(g.entries.length, "field")}>
            <dl className="mb-3 grid gap-px overflow-hidden rounded-sm border border-line bg-line sm:grid-cols-2">
              {g.entries.map((e) => (
                <div key={e.label} className="min-w-0 bg-surface px-3 py-2">
                  <dt className="font-mono text-[10.5px] text-ink-3">{e.label}</dt>
                  <dd className={cn("mt-0.5 text-xs break-all text-ink", e.mono && "font-mono")} title={e.value}>
                    {e.label.endsWith("sha256") ? shortDigest(e.value) : e.value}
                    {e.hint && <span className="ml-2 font-sans text-[10.5px] text-ink-3">{e.hint}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </Disclosure>
        ))}
      </div>
    </Panel>
  );
}

/* ---------- Page ---------- */

/**
 * The accepted Evidence Atelier composition, shared by MOCK, LOCAL_RESEARCH and (Phase 3A) archived history.
 * `previousRunLink={false}` hides the link to a previous run: from an archived entry it would open the
 * current ephemeral run, which is not part of the archive.
 */
export function DetailBody({
  run,
  location,
  basePath,
  baseParams,
  evidence,
  status,
  previousRunLink = true,
}: {
  run: RunView;
  location: Location;
  basePath: string;
  /** Params every selection keeps (the lookup route's verification_id). */
  baseParams?: Record<string, string>;
  evidence?: ReactNode;
  /** Status axes and archive match (product round 02): after the conclusion and its trace, before the records. */
  status?: ReactNode;
  previousRunLink?: boolean;
}) {
  const t = stateTone(run.state);
  return (
    <div>
      <Verdict run={run} />
      <Procession run={run} />
      {status && <div className="mt-10">{status}</div>}
      <Bench run={run} location={location} basePath={basePath} baseParams={baseParams} />
      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        <Supports run={run} />
        <Unknowns run={run} />
      </div>
      <div className="mt-6">
        <TimeAxis run={run} previousRunLink={previousRunLink} />
      </div>
      <p className={cn("mt-6 border-t-[1.5px] border-rule pt-3 text-sm text-ink-2")}>
        <span className={cn("font-semibold", t.ink)}>Next step. </span>
        {run.nextStep}
      </p>
      {evidence && <div className="mt-6">{evidence}</div>}
      <div className="mt-6">
        <Technical run={run} />
      </div>
    </div>
  );
}

/**
 * LOCAL_RESEARCH Detail: one real HTTP read of the accepted local service, then its evidence pages,
 * pinned to the snapshot that read returned. A failed read is an access state — never MOCK data and
 * never a verdict. "Re-read case" is the only way to a newer snapshot, and it replaces everything.
 */
/**
 * `addressing` is fixed by the route, never by the ID or by an error: #/local/verifications/:id reads through the
 * frozen path routes ("path"), #/local/verification-lookup?verification_id= through the additive exact-ID query
 * routes ("query", ID-addressability remediation-03). A contract-valid ID the path cannot carry is offered the
 * lookup route as a link; nothing is requested until that link is followed.
 */
export function LocalVerificationDetail({
  id,
  malformed,
  location,
  addressing = "path",
  provider = addressing === "query" ? localLookupProvider() : localResearchProvider(),
}: {
  id: string;
  /** true: the path segment is not valid percent-encoding; a string: why the lookup address's query was refused. */
  malformed?: boolean | string;
  location: Location;
  addressing?: LocalAddressing;
  provider?: FlowAssertReadProvider;
}) {
  // P2-AUD-003 / P3A-AUD-001: the route ID is admitted before any read exists; a refused ID never reaches the provider.
  const back = { href: "#/verifications", label: "Verifications" };
  if (addressing === "query") {
    if (malformed) return <InvalidIdNotice kind="verification" raw={id} reason={`the address query is refused: ${String(malformed)}`} back={back} addressing="query" />;
    const admitted = checkLookupVerificationId(id);
    if (!admitted.ok) return <InvalidIdNotice kind="verification" raw={id} reason={admitted.reason} transportable={admitted.code !== "verification_id_not_transportable"} back={back} addressing="query" />;
    return <LocalVerificationRead id={id} location={location} provider={provider} basePath={LOOKUP_PATH} baseParams={{ verification_id: id }} />;
  }
  if (malformed) return <InvalidIdNotice kind="verification" raw={id} reason={`the address segment is not valid percent-encoding (a literal "%" is written %25)`} back={back} />;
  const admitted = checkVerificationId(id);
  if (!admitted.ok) {
    const lookup = admitted.code === "verification_id_not_transportable" && checkLookupVerificationId(id).ok ? lookupHref(id) : undefined;
    return <InvalidIdNotice kind="verification" raw={id} reason={admitted.reason} transportable={admitted.code !== "verification_id_not_transportable"} back={back} lookup={lookup} />;
  }
  return <LocalVerificationRead id={id} location={location} provider={provider} basePath={`/local/verifications/${encodeIdSegment(id)}`} />;
}

function LocalVerificationRead({ id, location, provider, basePath, baseParams }: { id: string; location: Location; provider: FlowAssertReadProvider; basePath: string; baseParams?: Record<string, string> }) {
  const [generation, setGeneration] = useState(0);
  const [snapshotGone, setSnapshotGone] = useState<string | null>(null);
  const { state, read, cancel } = useProviderRead((signal) => provider.getVerification(id, {}, signal), `${id}#${generation}`);
  const reread = () => {
    setSnapshotGone(null);
    setGeneration((g) => g + 1);
  };
  const run = state.status === "settled" && state.result.kind === "ready" ? state.result.data : null;

  useEffect(() => {
    document.title = run ? `${run.id} · ${run.workflow.name} — Local research — FlowAssert` : `${id} — Local research — FlowAssert`;
  }, [run, id]);

  if (!run || !run.local) return <LocalReadState id={id} state={state} onRetry={read} onCancel={cancel} />;
  const local = run.local;
  return (
    <div>
      <LocalProvenance run={run} snapshotGone={snapshotGone} onReread={reread} />
      <DetailBody
        status={
          <CaseStatusAxes
            id={id}
            live={run}
            verdict={{
              axis: "verdict",
              kind: "VERDICT",
              state: run.state,
              source: { kind: "live", request: basePath === LOOKUP_PATH ? "GET /api/v1/verification-lookup (live read)" : `GET /api/v1/verifications/${id} (live read)` },
            }}
          />
        }
        run={run}
        location={location}
        basePath={basePath}
        baseParams={baseParams}
        evidence={
          <LocalEvidencePanel
            key={local.snapshotId}
            provider={provider}
            run={run}
            onSnapshotUnavailable={() => setSnapshotGone(local.snapshotId)}
            onReread={reread}
          />
        }
      />
    </div>
  );
}

export function VerificationDetail({ id, location }: { id: string; location: Location }) {
  const run = getRun(id);
  useEffect(() => {
    document.title = run ? `${run.id} · ${run.workflow.name} — FlowAssert` : "Not found — FlowAssert";
  }, [run]);

  if (!run) {
    return (
      <AccessNotice
        state="NOT_FOUND"
        headingLevel={1}
        title={
          <>
            No verification run <span className="mono-id text-[22px]">{id}</span>
          </>
        }
        body="This ID does not exist in the demo data. Nothing was evaluated, and no record is missing because of it."
        facts={[
          ["Run ID", id],
          ["Provider", "MOCK · synthetic fixtures"],
        ]}
        actions={
          <a className={buttonClass("default", "sm")} href="#/demo/verifications">
            All verifications
          </a>
        }
      />
    );
  }

  return <DetailBody run={run} location={location} basePath={`/demo/verifications/${run.id}`} />;
}
