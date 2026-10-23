/**
 * One provider read with the lifecycle the provider contract asks for:
 *  - every read gets a sequence number (passed to `load`) and its own AbortController;
 *  - starting a new read cancels the previous one, and a late answer to an older read is dropped
 *    (`admitResponse`), so a stale response can never overwrite a newer one;
 *  - when pinned to a snapshot, a response from another snapshot is not merged — it settles as
 *    STALE_SNAPSHOT with no data;
 *  - cancellation is a hook state ("cancelled"), not a provider result, and publishes nothing — it
 *    invalidates the read's sequence number, so a provider that ignores the signal still cannot publish;
 *  - an exception thrown by a provider, before or after it returns a promise, is a REQUEST_ERROR,
 *    never a verdict.
 * No caching, retries or polling.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { admitResponse, type ProviderResult, type ReadState } from "../data/access";

export interface ReadOptions {
  /** Start reading on mount and whenever `key` changes. Default true. */
  auto?: boolean;
  /** Snapshot the view is pinned to; responses from another snapshot are refused. */
  pinnedSnapshotId?: string | null;
  /**
   * The provider `load` reads from. Replacing it is a new read even under the same key: the previous provider's
   * read is cancelled and its result is never shown as the new provider's. A stable provider never re-reads.
   */
  source?: object;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** The snapshot a data-bearing result belongs to; undefined when the result carries no data. */
const snapshotOf = <T>(r: ProviderResult<T>) => (r.kind === "ready" || r.kind === "partial" ? r.context.snapshotId : undefined);

export function useProviderRead<T>(load: (signal: AbortSignal, seq: number) => Promise<ProviderResult<T>>, key: string, options: ReadOptions = {}) {
  const { auto = true, pinnedSnapshotId = null, source } = options;
  const [state, setState] = useState<ReadState<T>>({ status: "idle" });
  // A replaced provider: drop the previous provider's state before this render commits (the effect below then
  // cancels its read and starts the new one).
  const [stateSource, setStateSource] = useState(source);
  if (stateSource !== source) {
    setStateSource(source);
    setState({ status: "idle" });
  }
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  /** Sequence number of the read in flight, or null once it has settled or been cancelled. */
  const inFlight = useRef<number | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const pinnedRef = useRef(pinnedSnapshotId);
  pinnedRef.current = pinnedSnapshotId;

  const read = useCallback(() => {
    controller.current?.abort();
    const mine = ++seq.current;
    const ctrl = new AbortController();
    controller.current = ctrl;
    inFlight.current = mine;
    setState({ status: "loading", seq: mine });
    // A provider that throws before returning a promise is handled exactly like one that rejects.
    let pending: Promise<ProviderResult<T>>;
    try {
      pending = Promise.resolve(loadRef.current(ctrl.signal, mine));
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (result) => {
        if (mine === seq.current) inFlight.current = null;
        const admission = admitResponse(seq.current, pinnedRef.current, { seq: mine, snapshotId: snapshotOf(result) });
        if (!admission.admit) {
          if (admission.reason === "snapshot_mismatch")
            setState({
              status: "settled",
              seq: mine,
              result: {
                kind: "error",
                access: "STALE_SNAPSHOT",
                code: "snapshot_mismatch",
                message: `Response belongs to snapshot ${snapshotOf(result) ?? "none"}, not the pinned ${pinnedRef.current}.`,
                requestId: null,
                retryable: false,
              },
            });
          return; // superseded: a newer read owns the screen
        }
        setState({ status: "settled", seq: mine, result });
      },
      (error: unknown) => {
        if (mine !== seq.current) return;
        inFlight.current = null;
        if (isAbort(error)) {
          setState({ status: "cancelled", seq: mine });
          return;
        }
        setState({
          status: "settled",
          seq: mine,
          result: {
            kind: "error",
            access: "REQUEST_ERROR",
            code: "provider_exception",
            message: error instanceof Error ? error.message : "The provider failed.",
            requestId: null,
            retryable: true,
          },
        });
      },
    );
  }, []);

  // Cancelling invalidates the read itself, not just its signal: whatever the provider does next,
  // `admitResponse` sees a newer sequence number and the answer is dropped.
  const cancel = useCallback(() => {
    const mine = inFlight.current;
    if (mine === null || mine !== seq.current) return;
    inFlight.current = null;
    seq.current++;
    controller.current?.abort();
    setState({ status: "cancelled", seq: mine });
  }, []);

  useEffect(() => {
    if (auto) read();
    return () => {
      // Leaving the view cancels the read; bump the sequence so nothing settles afterwards.
      seq.current++;
      inFlight.current = null;
      controller.current?.abort();
    };
  }, [auto, key, read, source]);

  return { state, read, cancel };
}
