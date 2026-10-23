/**
 * Live results for a fixed, known list of case IDs (product round 02), read with BOUNDED concurrency.
 *
 * The frozen v1 API has no collection endpoint, so a list of live results is one Detail read per known case. To keep
 * that fan-out controlled: at most `concurrency` reads are in flight, every read shares one AbortController that is
 * aborted on unmount or on a new generation, each case settles on its own (one failure never hides the others), and
 * no read is retried, cached or polled. The IDs are the reviewed handoff inventory — never a source population.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderResult } from "../data/access";
import type { FlowAssertReadProvider } from "../data/provider";
import type { LiveSide } from "../data/workspace/comparison";
import type { RunView } from "../domain/view";

export const LIVE_CONCURRENCY = 2;

export function liveSideOf(r: ProviderResult<RunView>): LiveSide {
  if (r.kind === "ready" || r.kind === "partial") return { kind: "ready", run: r.data };
  if (r.kind === "not_found") return { kind: "not_found" };
  return {
    kind: "failed",
    failure: { code: r.code, message: r.message, transport: r.access === "SERVICE_UNAVAILABLE" && !r.integrity, integrity: !!r.integrity },
  };
}

/** Run `task` over `items` with at most `limit` in flight; stops starting new work once `signal` aborts. */
export async function boundedEach<T>(items: readonly T[], limit: number, signal: AbortSignal, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < items.length) {
      const item = items[next++]!;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export function useLiveCases(provider: Pick<FlowAssertReadProvider, "getVerification">, ids: readonly string[], generation: number, concurrency = LIVE_CONCURRENCY) {
  const key = ids.join("\u0000");
  const [sides, setSides] = useState<Record<string, LiveSide>>(() => Object.fromEntries(ids.map((id) => [id, { kind: "reading" } as LiveSide])));
  const current = useRef<AbortController | null>(null);

  useEffect(() => {
    const list = key.split("\u0000");
    const ctrl = new AbortController();
    current.current = ctrl;
    setSides(Object.fromEntries(list.map((id) => [id, { kind: "reading" } as LiveSide])));
    void boundedEach(list, concurrency, ctrl.signal, async (id) => {
      try {
        const r = await provider.getVerification(id, {}, ctrl.signal);
        if (!ctrl.signal.aborted) setSides((s) => ({ ...s, [id]: liveSideOf(r) }));
      } catch {
        // AbortError: the view is gone or re-read; nothing from this read is kept. Any other rejection breaks the
        // provider contract — it is a failure of this read, not a cancellation.
        if (!ctrl.signal.aborted)
          setSides((s) => ({
            ...s,
            [id]: { kind: "failed", failure: { code: "client_error", message: "The read ended with an unexpected error in this browser. No result was received.", transport: false, integrity: false } },
          }));
      }
    });
    return () => ctrl.abort();
  }, [provider, key, generation, concurrency]);

  /** Stop every unfinished read; cases already settled keep their outcome, the rest become cancelled. */
  const cancel = useCallback(() => {
    current.current?.abort();
    setSides((s) => Object.fromEntries(Object.entries(s).map(([id, side]) => [id, side.kind === "reading" ? ({ kind: "cancelled" } as LiveSide) : side])));
  }, []);

  return { sides, cancel };
}
