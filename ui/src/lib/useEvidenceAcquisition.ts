/**
 * Paged evidence read for one Detail, pinned to the Detail's snapshot.
 *
 * Built on useProviderRead — so each page read is ordered, cancellable, rejects late answers and
 * refuses another snapshot's data — and on the pure chain rules in src/data/local/evidenceChain.ts.
 * No new state system: one read in flight, one acquisition at a time.
 *
 *  - The first page is read on mount. Further pages only on request ("next" / "all").
 *  - limit and include_payload are fixed per acquisition; changing the payload mode restarts it.
 *  - Any failure, refusal or cancellation ends the acquisition and discards its pages: nothing from
 *    an unfinished or refused sequence is shown as read. Restart begins again at page 1, same snapshot.
 *  - A 409 (STALE_SNAPSHOT) also tells the page, which offers a full re-read of the case.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderResult } from "../data/access";
import { admitPage, startChain, type EvidenceChain } from "../data/local/evidenceChain";
import type { FlowAssertReadProvider } from "../data/provider";
import type { EvidencePageView, EvidenceReferenceView } from "../domain/evidence";
import { useProviderRead } from "./useProviderRead";

export type AcquisitionStatus = "reading" | "partial" | "complete" | "refused" | "failed" | "cancelled";

interface Plan {
  generation: number;
  includePayload: boolean;
  cursor: string | null;
  index: number;
  auto: boolean;
}

export function useEvidenceAcquisition(
  // Only getEvidence is used, so the Phase 3A archive reader (src/pages/History.tsx) can share this hook unchanged.
  provider: Pick<FlowAssertReadProvider, "getEvidence">,
  runId: string,
  expected: EvidenceReferenceView[],
  snapshotId: string,
  limit: number,
  onSnapshotUnavailable?: () => void,
) {
  const [plan, setPlan] = useState<Plan>({ generation: 0, includePayload: true, cursor: null, index: 0, auto: false });
  const [chain, setChain] = useState<EvidenceChain>(() => startChain(expected, snapshotId, limit, true));
  const [refusal, setRefusal] = useState<{ code: string; message: string } | null>(null);

  const key = `${snapshotId}|${plan.generation}|${plan.index}`;
  // The request (key) the newest read was issued for, and that read's sequence number, recorded when the read
  // is issued. Right after the plan changes, the previous page's result is still in state and must not be
  // admitted under the new cursor or payload mode. The key alone does not tell them apart: when that result and
  // the plan change are rendered together, the new read is issued (useProviderRead's effect) before the
  // admission effect below runs. So a settled result is this request's only if its sequence number matches too.
  const issued = useRef<{ key: string; seq: number } | null>(null);
  const { state, read, cancel } = useProviderRead<EvidencePageView>(
    (signal, seq) => {
      issued.current = { key, seq };
      return provider.getEvidence(runId, { snapshotId, limit, includePayload: plan.includePayload, cursor: plan.cursor ?? undefined }, signal);
    },
    key,
    { pinnedSnapshotId: snapshotId },
  );
  const forThisRequest = state.status === "settled" && issued.current?.key === key && issued.current.seq === state.seq;
  const handled = useRef<number | null>(null);
  const notify = useRef(onSnapshotUnavailable);
  notify.current = onSnapshotUnavailable;

  useEffect(() => {
    if (state.status !== "settled" || issued.current?.key !== key || issued.current.seq !== state.seq) return;
    if (handled.current === state.seq) return;
    handled.current = state.seq;
    const r: ProviderResult<EvidencePageView> = state.result;
    if (r.kind !== "ready" && r.kind !== "partial") {
      if (r.kind === "error" && r.access === "STALE_SNAPSHOT") notify.current?.();
      return;
    }
    const step = admitPage(chain, plan.cursor, r.data);
    if (!step.ok) {
      setRefusal({ code: step.code, message: step.message });
      return;
    }
    setChain(step.chain);
    if (plan.auto && typeof step.chain.next === "string") {
      const next = step.chain.next;
      setPlan((p) => ({ ...p, cursor: next, index: p.index + 1 }));
    }
  }, [state, key, chain, plan]);

  const restart = useCallback(
    (includePayload: boolean = plan.includePayload) => {
      setRefusal(null);
      setChain(startChain(expected, snapshotId, limit, includePayload));
      setPlan((p) => ({ generation: p.generation + 1, includePayload, cursor: null, index: 0, auto: false }));
    },
    [expected, snapshotId, limit, plan.includePayload],
  );

  const advance = useCallback(
    (auto: boolean) => {
      if (typeof chain.next !== "string" || refusal) return;
      const next = chain.next;
      setPlan((p) => ({ ...p, cursor: next, index: p.index + 1, auto }));
    },
    [chain.next, refusal],
  );

  let status: AcquisitionStatus;
  if (refusal) status = "refused";
  else if (state.status === "idle" || state.status === "loading") status = "reading";
  else if (state.status === "cancelled") status = "cancelled";
  else if (!forThisRequest) status = "reading"; // the previous request's result; this request is being issued
  else if (state.result.kind === "error" || state.result.kind === "not_found") status = "failed";
  else if (handled.current !== state.seq) status = "reading"; // settled, admission pending this render
  else status = chain.next === null ? "complete" : "partial";

  const failure = forThisRequest && state.status === "settled" && (state.result.kind === "error" || state.result.kind === "not_found") ? state.result : null;
  // Pages of an acquisition that did not finish cleanly are not shown as read.
  const shown = status === "failed" || status === "refused" || status === "cancelled" ? startChain(expected, snapshotId, limit, plan.includePayload) : chain;

  return {
    status,
    chain: shown,
    includePayload: plan.includePayload,
    pagesRead: shown.pages,
    failure,
    refusal,
    readNext: () => advance(false),
    readAll: () => advance(true),
    restart,
    cancel,
    /** Exposed for the read lifecycle tests; the page uses restart(). */
    retryCurrent: read,
  };
}
