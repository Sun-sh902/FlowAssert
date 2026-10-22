import { ArrowRight } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { RecordCells } from "../components/records/RecordCells";
import { AccessMark, AccessNotice, CancelledNotice, RetryButton } from "../components/states/AccessStates";
import { EvidenceLedger } from "../components/states/EvidenceLedger";
import { DetailSkeleton, PartialTraces, type TraceSlot } from "../components/states/Skeletons";
import { DemoStamp, PageHead, Segmented } from "../components/ui/atelier";
import { buttonClass } from "../components/ui/primitives";
import { Seal, StatusGlyph } from "../components/ui/status";
import { ACCESS_COPY, ACCESS_STATES, accessStateOf } from "../data/access";
import { latestRuns, workflowSummaries } from "../data/store";
import { STATES, type RunView } from "../domain/view";
import { href } from "../lib/router";
import { useProviderRead } from "../lib/useProviderRead";
import { OTHER_SNAPSHOT, PINNED_SNAPSHOT, SCENARIO_LABEL, SCENARIOS, evidenceFor, scenarioProvider, type Scenario } from "../mocks/scenarios";

const SAMPLE: RunView = latestRuns.find((r) => r.state === "Mismatch") ?? latestRuns[0]!;
const detailPath = (id: string) => `GET /api/v1/verifications/${id}`;

/* ---------- Two vocabularies ---------- */

function Vocabularies() {
  return (
    <section aria-labelledby="vocab-h">
      <h2 id="vocab-h" className="kicker mb-2">
        Two vocabularies · never mixed
      </h2>
      <div className="fa-ledger">
        <div className="py-2.5">
          <p className="label mb-2">Verdicts · from the evaluator</p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-ink-2">
            {STATES.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <StatusGlyph state={s} size={11} />
                {s}
              </li>
            ))}
          </ul>
        </div>
        <div className="py-2.5">
          <p className="label mb-2">Access · how the read went</p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2">
            {ACCESS_STATES.map((s) => (
              <li key={s} className="flex min-w-0 items-center gap-2">
                <AccessMark kind={s} size={22} />
                <span className="truncate">{ACCESS_COPY[s].label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-3">A failed read is never Unverified. Missing evidence is never Mismatch.</p>
    </section>
  );
}

/* ---------- Plate: one simulated specimen ---------- */

function Plate({ id, n, title, rule, children }: { id: string; n: string; title: string; rule: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b-[1.5px] border-rule pb-2.5">
        <h2 id={`${id}-h`} className="serif flex items-baseline gap-3 text-2xl leading-8 text-ink">
          <span aria-hidden data-ornament className="font-mono text-[11px] tracking-normal text-ink-4">
            {n}
          </span>
          {title}
        </h2>
        <DemoStamp>Simulated · no request is made</DemoStamp>
      </div>
      <p className="mt-3 mb-5 max-w-[78ch] text-sm leading-[1.6] text-ink-2">{rule}</p>
      {children}
    </section>
  );
}

/* ---------- Live read ---------- */

function ReadyCase({ run, snapshot }: { run: RunView; snapshot: string | null }) {
  return (
    <article aria-labelledby="live-ready-h" className="surface fade-in rounded-lg px-5 py-5 sm:px-7">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Seal state={run.state} size="lg" />
        <span className="text-xs text-ink-3">
          Cohort result · copied from the stored run · snapshot <span className="mono-id">{snapshot ?? "—"}</span>
        </span>
      </div>
      <h3 id="live-ready-h" className="display mt-4 text-[30px] leading-[1.08] text-ink">
        {run.headline}
      </h3>
      <div className="mt-4 max-w-[520px]">
        <RecordCells run={run} />
      </div>
      <a href={href(`/verifications/${run.id}`)} className="fa-hit mt-4 inline-flex items-center gap-1 rounded-xs text-xs font-medium text-ink-2 hover:text-ink">
        Open <span className="mono-id">{run.id}</span> <ArrowRight size={12} aria-hidden />
      </a>
    </article>
  );
}

type Read = ReturnType<typeof useProviderRead<RunView>>;

function LiveRead({ scenario, choose, live, liveRef }: { scenario: Scenario; choose: (s: Scenario) => void; live: Read; liveRef: React.RefObject<HTMLDivElement | null> }) {
  const { state, read, cancel } = live;
  const access = state.status === "idle" ? null : accessStateOf(state);

  let view: ReactNode;
  if (state.status === "idle")
    view = (
      <div className="rounded-lg border border-dashed border-line-strong px-5 py-8 text-center text-sm text-ink-3">
        Choose an outcome and read <span className="mono-id">{SAMPLE.id}</span>. The simulated read takes about a second.
      </div>
    );
  else if (state.status === "loading") view = <DetailSkeleton runId={SAMPLE.id} />;
  else if (state.status === "cancelled") view = <CancelledNotice onRetry={read} what={SAMPLE.id} />;
  else {
    const r = state.result;
    if (r.kind === "ready" || r.kind === "partial") view = <ReadyCase run={r.data} snapshot={r.context.snapshotId} />;
    else if (r.kind === "not_found")
      view = <AccessNotice state="NOT_FOUND" headingLevel={3} facts={[["Request", detailPath(SAMPLE.id)], ["Request ID", r.requestId ?? "—"]]} />;
    else
      view = (
        <AccessNotice
          state={r.access}
          headingLevel={3}
          facts={[
            ["Request", detailPath(SAMPLE.id)],
            ["Code", r.code],
            ["Detail", r.message],
            ["Request ID", r.requestId ?? "—"],
            ["Retryable", r.retryable ? "yes" : "no"],
          ]}
          actions={
            r.access === "STALE_SNAPSHOT" ? (
              <RetryButton
                onRetry={() => {
                  choose("ready");
                  read();
                }}
                label="Refresh the whole view"
              />
            ) : r.retryable ? (
              <RetryButton onRetry={read} />
            ) : null
          }
        />
      );
  }

  return (
    <div className="grid gap-5">
      <div className="surface flex flex-wrap items-end gap-x-6 gap-y-3 rounded-lg px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <p className="label mb-1.5">Outcome of the next read</p>
          <Segmented<Scenario> label="Outcome of the next read" value={scenario} onChange={choose} options={SCENARIOS.map((s) => ({ value: s, label: SCENARIO_LABEL[s] }))} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass("primary")} onClick={read}>
            Read {SAMPLE.id}
          </button>
          <button type="button" className={buttonClass("default")} onClick={cancel} disabled={state.status !== "loading"}>
            Cancel read
          </button>
        </div>
        <p className="font-mono text-[11px] text-ink-3 sm:ml-auto" aria-live="polite">
          {state.status === "idle" ? "no read yet" : state.status === "loading" ? "reading" : `settled · ${access ? ACCESS_COPY[access].label.toLowerCase() : state.status === "cancelled" ? "cancelled" : "ready"}`}
        </p>
      </div>
      <div ref={liveRef} tabIndex={-1} className="outline-none" data-live-result>
        {view}
      </div>
    </div>
  );
}

/* ---------- Page ---------- */

export function States() {
  const [scenario, setScenario] = useState<Scenario>("ready");
  // The provider is read through a ref so that choosing an outcome and reading can happen in one handler.
  const scenarioRef = useRef<Scenario>(scenario);
  const choose = (s: Scenario) => {
    scenarioRef.current = s;
    setScenario(s);
  };
  const live = useProviderRead((signal) => scenarioProvider(scenarioRef.current).getVerification(SAMPLE.id, { snapshotId: PINNED_SNAPSHOT }, signal), "live", {
    auto: false,
    pinnedSnapshotId: PINNED_SNAPSHOT,
  });
  const liveRef = useRef<HTMLDivElement>(null);
  /** Specimen actions run a real simulated read in §1 and move focus there. */
  const toLive = (s: Scenario) => {
    choose(s);
    live.read();
    document.getElementById("st-live")?.scrollIntoView({ behavior: "smooth", block: "start" });
    liveRef.current?.focus({ preventScroll: true });
  };

  const slots: TraceSlot[] = workflowSummaries.map((w, i): TraceSlot => {
    if (i === 1) return { kind: "loading", runId: w.latest.id, workflowName: w.workflow.name, sourceNamespace: w.workflow.sourceNamespace };
    if (i === 3)
      return {
        kind: "error",
        runId: w.latest.id,
        workflowName: w.workflow.name,
        sourceNamespace: w.workflow.sourceNamespace,
        explanation: "Detail read failed (503). Its summary counts are not drawn as records.",
        onRetry: () => toLive("ready"),
      };
    return { kind: "ready", run: w.latest };
  });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-14">
      <PageHead
        kicker="Interface states · data access · simulated in this browser"
        title={
          <>
            When a read fails, there is no verdict. <span className="text-ink-3">Only an honest account of the read.</span>
          </>
        }
        lede={
          <>
            These are the states a future provider can put a screen in while it reads a stored result. They describe the request, not the evidence. Every
            specimen is simulated here — nothing is requested, and ready results are the unchanged demo runs.
          </>
        }
        aside={<Vocabularies />}
      />

      <Plate
        id="st-live"
        n="§1"
        title="A read, start to finish"
        rule={
          <>
            Each read cancels the one before it, and a late answer to an older read is dropped. A response from a snapshot other than the pinned{" "}
            <span className="mono-id">{PINNED_SNAPSHOT}</span> is refused, not merged.
          </>
        }
      >
        <LiveRead scenario={scenario} choose={choose} live={live} liveRef={liveRef} />
      </Plate>

      <Plate id="st-loading" n="§2" title="Loading" rule="The real Detail composition with its values withheld. No record cells are drawn: how many records exist is not known until the run arrives, and nothing animates towards a result.">
        <div className="rounded-lg border border-line-subtle bg-canvas px-3 py-5 sm:px-5">
          <DetailSkeleton runId={SAMPLE.id} label={`Specimen: reading verification run ${SAMPLE.id}.`} />
        </div>
      </Plate>

      <Plate id="st-empty" n="§3" title="Empty" rule="The read succeeded and returned nothing. An empty catalogue is not a clean bill of health — the Overview must not say “nothing requires attention”.">
        <AccessNotice state="EMPTY" facts={[["Snapshot", PINNED_SNAPSHOT], ["Runs in snapshot", "0"], ["Total", "0 · computed"]]} />
      </Plate>

      <Plate id="st-error" n="§4" title="Request error" rule="No usable answer. The screen says so and offers a retry; it does not substitute Unverified, an empty success, or another provider's data.">
        <AccessNotice
          state="REQUEST_ERROR"
          facts={[
            ["Request", detailPath(SAMPLE.id)],
            ["Status", "500 · sanitized service failure"],
            ["Request ID", "req-demo-500"],
            ["Retryable", "yes"],
          ]}
          actions={<RetryButton onRetry={() => toLive("ready")} />}
        />
      </Plate>

      <Plate id="st-notfound" n="§5" title="Not found" rule="A true 404 in the configured scope. Shown as an unread destination — never as a missing record or a Mismatch.">
        <AccessNotice
          state="NOT_FOUND"
          title={
            <>
              No run <span className="mono-id text-[22px]">VR-9999</span> in this workspace
            </>
          }
          facts={[
            ["Request", detailPath("VR-9999")],
            ["Status", "404"],
            ["Scope", "MOCK · demo workspace"],
          ]}
          actions={
            <a className={buttonClass("default", "sm")} href="#/verifications">
              All verifications
            </a>
          }
        />
      </Plate>

      <Plate
        id="st-partial"
        n="§6"
        title="Partial data"
        rule="Overview traces while some run details are still being read or failed. Read runs use the production trace. The others get no cells and no seal: a summary is never cast to a run, and counts are never redrawn as records."
      >
        <PartialTraces slots={slots} />
      </Plate>

      <Plate id="st-stale" n="§7" title="Stale snapshot" rule="The view is pinned to one immutable snapshot. A response from another snapshot is not merged into it; a newer catalogue needs a deliberate refresh of the whole view.">
        <AccessNotice
          state="STALE_SNAPSHOT"
          facts={[
            ["Pinned snapshot", PINNED_SNAPSHOT],
            ["Response snapshot", OTHER_SNAPSHOT],
            ["Merged", "no"],
            ["Status", "409 · or snapshot echo mismatch"],
          ]}
          actions={
            <>
              <RetryButton onRetry={() => toLive("ready")} label="Refresh the whole view" />
              <span className="text-xs text-ink-3">The pinned content stays labelled until then.</span>
            </>
          }
        />
      </Plate>

      <Plate
        id="st-evidence"
        n="§8"
        title="Evidence unavailable"
        rule="Payload inspection has its own state. The stored verdict is shown unchanged, and each reference keeps its stored availability next to what this read managed — missing payloads are not failures of the rule."
      >
        <div className="grid gap-5">
          <AccessNotice
            state="EVIDENCE_UNAVAILABLE"
            title="One available payload could not be read"
            facts={[
              ["Request", `GET /api/v1/verifications/${SAMPLE.id}/evidence`],
              ["Status", "503 on ref-dst-0002"],
              ["Unavailable by storage", "3 · not collected, redacted, expired"],
              [
                "Stored verdict",
                <span key="v" className="inline-flex items-center gap-2">
                  <Seal state={SAMPLE.state} /> unchanged
                </span>,
              ],
            ]}
          />
          <div className="surface rounded-lg px-4 pt-3 pb-2 sm:px-6">
            <EvidenceLedger items={evidenceFor(SAMPLE.id).items} caption={`Evidence references for ${SAMPLE.id} — illustrative`} />
          </div>
        </div>
      </Plate>

      <Plate id="st-service" n="§9" title="Service unavailable" rule="No provider answered, or the chosen mode is not implemented. Nothing stands in for the result, and the UI never falls back to MOCK data.">
        <AccessNotice
          state="SERVICE_UNAVAILABLE"
          facts={[
            ["Provider mode", "LOCAL_RESEARCH"],
            ["Status", "no response"],
            ["Fallback", "none · by contract"],
          ]}
          actions={<RetryButton onRetry={() => toLive("ready")} />}
        />
      </Plate>

      <Plate id="st-cancelled" n="§10" title="Cancelled" rule="Leaving a view or starting a newer read cancels the current one. A cancelled read publishes nothing, so an older selection can never reappear.">
        <CancelledNotice onRetry={() => toLive("ready")} what={SAMPLE.id} />
      </Plate>
    </div>
  );
}
