/**
 * Loading and partial-data compositions for the data-access states. They reuse the production
 * layouts (Detail, Overview traces) with values withheld; no record cell is drawn for an unread run.
 */
import type { RunView } from "../../domain/view";
import { cn } from "../../lib/cn";
import { Trace } from "../runs/Trace";
import { AccessMark, AccessStamp, RetryButton } from "./AccessStates";

function Bar({ w, size, className }: { w: string; size?: "display" | "title" | "text"; className?: string }) {
  return <span className={cn("fa-skel fa-breathe", className)} data-size={size} style={{ width: w }} />;
}

const LEDGER_LABELS = ["Case", "Source", "Destination", "Rule version", "Expected total", "Not fully assessed", "Sync window"];
const STEP_LABELS = ["Source", "Observation", "Comparison", "Evidence", "Verdict"];

/**
 * Verification Detail while its run is being read. The composition is the real page — verdict
 * header, procession, record bench — with the values withheld. No record cells are drawn: the
 * number of records is not known until the run arrives.
 */
export function DetailSkeleton({ runId, label }: { runId: string; label?: string }) {
  return (
    <div aria-busy="true" data-access="LOADING">
      <p role="status" className="sr-only">
        {label ?? `Reading verification run ${runId}. No result is shown until the read completes.`}
      </p>
      <div aria-hidden>
        <header className="grid gap-x-12 gap-y-7 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="fa-seal" data-s="reading" data-size="lg">
                <AccessMark kind="LOADING" size={20} />
                reading
              </span>
              <span className="text-xs text-ink-3">
                Cohort result · <span className="mono-id">{runId}</span> not read yet
              </span>
            </div>
            <div className="mt-5 grid gap-3">
              <Bar w="min(92%, 620px)" size="display" />
              <Bar w="min(64%, 430px)" size="display" />
            </div>
            <div className="mt-6 grid max-w-[640px] gap-2">
              <Bar w="100%" size="text" />
              <Bar w="94%" size="text" />
              <Bar w="58%" size="text" />
            </div>
          </div>
          <dl className="fa-ledger text-[12.5px]">
            {LEDGER_LABELS.map((k, i) => (
              <div key={k} className="flex items-center justify-between gap-3 py-[7px]">
                <dt className="text-ink-3">{k}</dt>
                <dd>
                  <Bar w={`${[78, 112, 96, 104, 28, 44, 86][i]}px`} size="text" />
                </dd>
              </div>
            ))}
          </dl>
        </header>

        <ol className="fa-procession mt-9">
          {STEP_LABELS.map((k, i) => (
            <li key={k} className="fa-step">
              {i < STEP_LABELS.length - 1 && <span className="fa-step-arrow">→</span>}
              <p className="kicker">
                0{i + 1} · {k}
              </p>
              <Bar w={i === 4 ? "48%" : "72%"} size="title" className="mt-2 mb-3" />
              <div className="grid gap-1.5">
                <Bar w="100%" size="text" />
                <Bar w="80%" size="text" />
              </div>
            </li>
          ))}
        </ol>

        <section className="mt-9 grid gap-6 lg:grid-cols-12 lg:items-start">
          <div className="rounded-lg border border-line bg-surface lg:col-span-5 xl:col-span-4">
            <div className="border-b border-line px-4 pt-4 pb-4">
              <p className="kicker">Record index · count not known yet</p>
              <div className="fa-trace-line mt-4">
                <i className="fa-node-src" />
                <div className="fa-void-track">
                  <span>records not read</span>
                </div>
                <i className="fa-node-dst opacity-40" />
              </div>
            </div>
            <ul className="divide-y divide-line-subtle">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="grid h-10 grid-cols-[14px_72px_minmax(0,1fr)] items-center gap-2.5 px-4">
                  <span className="size-[9px] rounded-full border border-dashed border-line-strong" />
                  <Bar w="64px" size="text" />
                  <Bar w={`${[60, 48, 70, 52, 40][i]}%`} size="text" />
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-line bg-surface lg:col-span-7 xl:col-span-8">
            <div className="border-b border-line px-6 pt-5 pb-4">
              <p className="kicker">Comparison sheet</p>
              <Bar w="160px" size="title" className="mt-2" />
            </div>
            {["Record exists", "One per key", "Phone"].map((r) => (
              <div key={r} className="grid grid-cols-[112px_minmax(0,1fr)_52px_minmax(0,1fr)] items-center border-b border-line-subtle px-6 py-4 last:border-0">
                <span className="text-sm font-semibold text-ink-3">{r}</span>
                <Bar w="70%" size="text" />
                <span className="fa-spine">
                  <span className="relative z-[1] grid size-7 place-items-center rounded-full border-[1.5px] border-dashed border-line-strong bg-surface" />
                </span>
                <Bar w="62%" size="text" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------- Partial traces (Overview presentation; no hydration logic) ---------- */

export type TraceSlot =
  | { kind: "ready"; run: RunView }
  | { kind: "loading"; runId: string; workflowName: string; sourceNamespace: string }
  | { kind: "error"; runId: string; workflowName: string; sourceNamespace: string; explanation: string; onRetry?: () => void };

function SlotRow({ slot }: { slot: Exclude<TraceSlot, { kind: "ready" }> }) {
  const loading = slot.kind === "loading";
  return (
    <li
      data-slot={slot.kind}
      className="fa-row grid gap-x-6 gap-y-3 border-b border-line-subtle py-[18px] last:border-0 lg:grid-cols-[200px_minmax(0,1fr)_150px] lg:items-center"
    >
      <div className="min-w-0">
        <p className="text-md leading-5 font-semibold tracking-[-0.005em] text-ink">{slot.workflowName}</p>
        <p className="mono-id mt-0.5 truncate text-[11px] text-ink-3">{slot.sourceNamespace}</p>
      </div>
      <div className="min-w-0">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="fa-trace-line">
            <i className="fa-node-src" aria-hidden />
            <div className="fa-void-track" data-kind={loading ? undefined : "broken"}>
              <span>{loading ? "reading run detail" : "run detail unavailable"}</span>
            </div>
            <i className={cn("fa-node-dst", "opacity-40")} aria-hidden />
          </div>
          <p className="mono-id text-[11px] leading-tight text-ink-3">
            HubSpot
            <span className="block text-ink-3">contacts</span>
          </p>
        </div>
        <p className="mt-1.5 font-mono text-[10.5px] text-ink-3">
          {loading ? "No cells until the run is read — counts are not drawn as records." : slot.explanation}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 lg:grid lg:justify-items-end">
        <span className="fa-seal" data-s="reading">
          {loading ? "reading" : "no result read"}
        </span>
        {slot.kind === "error" && slot.onRetry ? (
          <RetryButton onRetry={slot.onRetry} label={`Retry ${slot.runId}`} />
        ) : (
          <span className="mono-id text-[11px] text-ink-3">{slot.runId}</span>
        )}
      </div>
    </li>
  );
}

/**
 * Traces where some runs have been read and some have not. Ready runs use the production Trace.
 * Unread runs get a slot with no cells and no seal: a summary is never cast to a run, and no
 * "nothing requires attention" claim is made from the loaded subset.
 */
export function PartialTraces({ slots, label = "Workflow traces — partially loaded" }: { slots: TraceSlot[]; label?: string }) {
  const ready = slots.filter((s) => s.kind === "ready").length;
  return (
    <section aria-label={label} className="surface rounded-lg" data-access={ready < slots.length ? "PARTIAL_DATA" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-subtle px-4 py-3 sm:px-6">
        <p className="flex items-center gap-3 text-sm text-ink-2">
          <AccessMark kind="PARTIAL_DATA" size={32} />
          <span>
            <b className="font-semibold text-ink tabular">
              {ready} of {slots.length}
            </b>{" "}
            traces read. The set is incomplete — do not read it as a whole.
          </span>
        </p>
        <AccessStamp>Partial · not a verdict</AccessStamp>
      </div>
      <ul className="px-4 sm:px-6">
        {slots.map((s) => (s.kind === "ready" ? <Trace key={s.run.id} run={s.run} /> : <SlotRow key={s.runId} slot={s} />))}
      </ul>
    </section>
  );
}
