/**
 * Paged evidence read for one Detail, pinned to the Detail's snapshot.
 *
 * Built on useProviderRead — so each page read is ordered, cancellable, rejects late answers and
 * refuses another snapshot's data — and on the pure chain rules in src/data/local/evidenceChain.ts.
 * No new state system: one read in flight, one acquisition at a time.
 *
 *  - Every evidence fetch/pagination request is strictly bound to the tuple
 *    (provider.mode, verificationId, snapshotId, requestSeq).
 *  - No synchronous render-time ref mutations (providerRef / notify).
 *  - When an HTTP 409 Conflict response is received during pagination or refresh, `.error.request_id`
 *    (or `requestId`) is extracted when present, further pagination appends for the invalidated snapshot
 *    epoch are atomically frozen, and a clear epoch-conflict state is surfaced without corrupting
 *    already-rendered rows.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderResult } from "../data/access";
import { admitPage, startChain, type EvidenceChain } from "../data/local/evidenceChain";
import type { FlowAssertReadProvider, ProviderMode } from "../data/provider";
import type { EvidencePageView, EvidenceReferenceView } from "../domain/evidence";
import { useProviderRead } from "./useProviderRead";

export type AcquisitionStatus = "reading" | "partial" | "complete" | "refused" | "failed" | "cancelled";

export interface EvidenceRequestBinding {
  readonly mode: ProviderMode;
  readonly verificationId: string;
  readonly snapshotId: string;
  readonly requestSeq: number;
  readonly key: string;
}

export interface EpochConflictState {
  readonly mode: ProviderMode;
  readonly verificationId: string;
  readonly snapshotId: string;
  readonly requestSeq: number;
  readonly requestId: string | null;
  readonly code: string;
  readonly message: string;
  readonly httpStatus: 409;
  readonly frozen: true;
  /** Admitted rows preserved without corruption at the instant the 409 invalidated the snapshot epoch. */
  readonly preservedRows: readonly EvidenceReferenceView[];
  readonly pagesAdmittedBeforeConflict: number;
}

interface Plan {
  generation: number;
  includePayload: boolean;
  cursor: string | null;
  index: number;
  auto: boolean;
}

type EvidenceProviderInput = Pick<FlowAssertReadProvider, "getEvidence"> &
  Partial<Pick<FlowAssertReadProvider, "mode">>;

function extractConflictRequestId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const nestedError =
    obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : null;
  if (nestedError && typeof nestedError.request_id === "string" && nestedError.request_id.length > 0) {
    return nestedError.request_id;
  }
  if (nestedError && typeof nestedError.requestId === "string" && nestedError.requestId.length > 0) {
    return nestedError.requestId;
  }
  if (typeof obj.requestId === "string" && obj.requestId.length > 0) {
    return obj.requestId;
  }
  if (typeof obj.request_id === "string" && obj.request_id.length > 0) {
    return obj.request_id;
  }
  return null;
}

function normalizeConflictResult(raw: unknown): Extract<ProviderResult<EvidencePageView>, { kind: "error" }> | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === "ready" || obj.kind === "partial" || obj.kind === "not_found") return null;
  const nestedError =
    obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : null;
  const httpStatus =
    typeof obj.httpStatus === "number"
      ? obj.httpStatus
      : typeof obj.status === "number"
        ? obj.status
        : nestedError && typeof nestedError.status === "number"
          ? nestedError.status
          : undefined;
  const rawCode =
    typeof obj.code === "string"
      ? obj.code
      : nestedError && typeof nestedError.code === "string"
        ? nestedError.code
        : null;
  const isConflictCode =
    rawCode === "snapshot_conflict" ||
    rawCode === "snapshot_unavailable" ||
    rawCode === "history_snapshot_conflict" ||
    rawCode === "stale_snapshot";
  const isConflict = httpStatus === 409 || obj.access === "STALE_SNAPSHOT" || isConflictCode;
  if (!isConflict) return null;

  const code = rawCode ?? "snapshot_conflict";
  const message =
    typeof obj.message === "string"
      ? obj.message
      : nestedError && typeof nestedError.message === "string"
        ? nestedError.message
        : "Snapshot epoch conflict (HTTP 409).";

  return {
    kind: "error",
    access: "STALE_SNAPSHOT",
    code,
    message,
    requestId: extractConflictRequestId(raw),
    retryable: false,
    httpStatus: 409,
  };
}

export function useEvidenceAcquisition(
  // Only getEvidence is required, so the Phase 3A archive reader (src/pages/History.tsx) can share this hook unchanged.
  provider: EvidenceProviderInput,
  runId: string,
  expected: EvidenceReferenceView[],
  snapshotId: string,
  limit: number,
  onSnapshotUnavailable?: (conflict?: EpochConflictState) => void,
) {
  const mode: ProviderMode = provider.mode ?? "LOCAL_RESEARCH";
  const verificationId = runId;

  const [plan, setPlan] = useState<Plan>({ generation: 0, includePayload: true, cursor: null, index: 0, auto: false });
  const [chain, setChain] = useState<EvidenceChain>(() => startChain(expected, snapshotId, limit, true));
  const [refusal, setRefusal] = useState<{ code: string; message: string } | null>(null);
  const [epochConflict, setEpochConflict] = useState<EpochConflictState | null>(null);

  // Reset state cleanly if the bound identity (provider, provider.mode, verificationId, or snapshotId) changes.
  const [boundScope, setBoundScope] = useState({ provider, mode, verificationId, snapshotId });
  if (
    boundScope.provider !== provider ||
    boundScope.mode !== mode ||
    boundScope.verificationId !== verificationId ||
    boundScope.snapshotId !== snapshotId
  ) {
    setBoundScope({ provider, mode, verificationId, snapshotId });
    setPlan({ generation: 0, includePayload: true, cursor: null, index: 0, auto: false });
    setChain(startChain(expected, snapshotId, limit, true));
    setRefusal(null);
    setEpochConflict(null);
  }

  const key = `${mode}|${verificationId}|${snapshotId}|${plan.generation}|${plan.index}|${plan.includePayload ? "1" : "0"}|${plan.cursor ?? ""}`;

  // Every request is bound strictly to (mode, verificationId, snapshotId, requestSeq) when issued.
  const issued = useRef<EvidenceRequestBinding | null>(null);
  // Tracks which snapshot epoch has been atomically frozen by an HTTP 409 Conflict.
  const frozenEpochRef = useRef<{ mode: ProviderMode; verificationId: string; snapshotId: string } | null>(null);
  const handled = useRef<number | null>(null);
  const notify = useRef(onSnapshotUnavailable);

  useEffect(() => {
    notify.current = onSnapshotUnavailable;
  }, [onSnapshotUnavailable]);

  useEffect(() => {
    if (
      frozenEpochRef.current &&
      (frozenEpochRef.current.mode !== mode ||
        frozenEpochRef.current.verificationId !== verificationId ||
        frozenEpochRef.current.snapshotId !== snapshotId)
    ) {
      frozenEpochRef.current = null;
    }
  }, [mode, verificationId, snapshotId]);

  const isEpochFrozenForCurrent = useCallback(
    () =>
      (frozenEpochRef.current !== null &&
        frozenEpochRef.current.mode === mode &&
        frozenEpochRef.current.verificationId === verificationId &&
        frozenEpochRef.current.snapshotId === snapshotId) ||
      (epochConflict !== null &&
        epochConflict.mode === mode &&
        epochConflict.verificationId === verificationId &&
        epochConflict.snapshotId === snapshotId),
    [mode, verificationId, snapshotId, epochConflict],
  );

  const { state, read, cancel } = useProviderRead<EvidencePageView>(
    (signal, seq) => {
      const binding: EvidenceRequestBinding = {
        mode,
        verificationId,
        snapshotId,
        requestSeq: seq,
        key,
      };
      issued.current = binding;
      return Promise.resolve(
        provider.getEvidence(
          verificationId,
          { snapshotId, limit, includePayload: plan.includePayload, cursor: plan.cursor ?? undefined },
          signal,
        ),
      ).then(
        (res) => {
          const conflict = normalizeConflictResult(res);
          if (conflict) {
            if (
              issued.current &&
              issued.current.mode === binding.mode &&
              issued.current.verificationId === binding.verificationId &&
              issued.current.snapshotId === binding.snapshotId &&
              issued.current.requestSeq === binding.requestSeq
            ) {
              frozenEpochRef.current = {
                mode: binding.mode,
                verificationId: binding.verificationId,
                snapshotId: binding.snapshotId,
              };
            }
            return conflict;
          }
          return res;
        },
        (err: unknown) => {
          const conflict = normalizeConflictResult(err);
          if (conflict) {
            if (
              issued.current &&
              issued.current.mode === binding.mode &&
              issued.current.verificationId === binding.verificationId &&
              issued.current.snapshotId === binding.snapshotId &&
              issued.current.requestSeq === binding.requestSeq
            ) {
              frozenEpochRef.current = {
                mode: binding.mode,
                verificationId: binding.verificationId,
                snapshotId: binding.snapshotId,
              };
            }
            return conflict;
          }
          throw err;
        },
      );
    },
    key,
    { pinnedSnapshotId: snapshotId, source: provider },
  );

  const matchesActiveBinding =
    state.status === "settled" &&
    issued.current !== null &&
    issued.current.mode === mode &&
    issued.current.verificationId === verificationId &&
    issued.current.snapshotId === snapshotId &&
    issued.current.requestSeq === state.seq &&
    issued.current.key === key;

  useEffect(() => {
    if (!matchesActiveBinding || state.status !== "settled") return;
    if (handled.current === state.seq) return;
    handled.current = state.seq;

    const r: ProviderResult<EvidencePageView> = state.result;
    if (r.kind !== "ready" && r.kind !== "partial") {
      const conflict = normalizeConflictResult(r);
      if (conflict) {
        frozenEpochRef.current = { mode, verificationId, snapshotId };
        const preservedRows = [...chain.read];
        const pagesAdmittedBeforeConflict = chain.pages;
        // Atomically freeze chain continuation so no further pagination append can occur for this snapshot epoch.
        setChain((prev) => (prev.next === null ? prev : { ...prev, next: null }));
        setPlan((prev) => (prev.auto ? { ...prev, auto: false } : prev));
        const conflictState: EpochConflictState = {
          mode,
          verificationId,
          snapshotId,
          requestSeq: state.seq,
          requestId: conflict.requestId,
          code: conflict.code,
          message: conflict.message,
          httpStatus: 409,
          frozen: true,
          preservedRows,
          pagesAdmittedBeforeConflict,
        };
        setEpochConflict(conflictState);
        notify.current?.(conflictState);
      }
      return;
    }

    // Never append to an invalidated snapshot epoch.
    if (
      frozenEpochRef.current &&
      frozenEpochRef.current.mode === mode &&
      frozenEpochRef.current.verificationId === verificationId &&
      frozenEpochRef.current.snapshotId === snapshotId
    ) {
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
  }, [matchesActiveBinding, state, key, chain, plan, mode, verificationId, snapshotId]);

  const restart = useCallback(
    (includePayload: boolean = plan.includePayload) => {
      // If this snapshot epoch was invalidated by HTTP 409, keep pagination frozen for this epoch
      // unless a full case re-read supplies a new snapshotId.
      if (isEpochFrozenForCurrent()) return;
      setRefusal(null);
      setEpochConflict(null);
      setChain(startChain(expected, snapshotId, limit, includePayload));
      setPlan((p) => ({ generation: p.generation + 1, includePayload, cursor: null, index: 0, auto: false }));
    },
    [expected, snapshotId, limit, plan.includePayload, isEpochFrozenForCurrent],
  );

  const advance = useCallback(
    (auto: boolean) => {
      if (isEpochFrozenForCurrent() || typeof chain.next !== "string" || refusal) return;
      const next = chain.next;
      setPlan((p) => ({ ...p, cursor: next, index: p.index + 1, auto }));
    },
    [chain.next, refusal, isEpochFrozenForCurrent],
  );

  const retryCurrent = useCallback(() => {
    if (isEpochFrozenForCurrent()) return;
    read();
  }, [read, isEpochFrozenForCurrent]);

  let status: AcquisitionStatus;
  if (epochConflict) status = "failed";
  else if (refusal) status = "refused";
  else if (state.status === "idle" || state.status === "loading") status = "reading";
  else if (state.status === "cancelled") status = "cancelled";
  else if (!matchesActiveBinding) status = "reading"; // the previous request's result; this request is being issued
  else if (state.result.kind === "error" || state.result.kind === "not_found") status = "failed";
  else if (handled.current !== state.seq) status = "reading"; // settled, admission pending this render
  else status = chain.next === null ? "complete" : "partial";

  const rawFailure =
    matchesActiveBinding && state.status === "settled" && (state.result.kind === "error" || state.result.kind === "not_found")
      ? state.result
      : null;

  const failure: ProviderResult<EvidencePageView> | null = epochConflict
    ? {
        kind: "error",
        access: "STALE_SNAPSHOT",
        code: epochConflict.code,
        message: epochConflict.message,
        requestId: epochConflict.requestId,
        retryable: false,
        httpStatus: 409,
      }
    : rawFailure;

  // Pages of an acquisition that did not finish cleanly are not shown as complete/merged in the active ledger,
  // while already-admitted rows before an HTTP 409 epoch conflict are preserved uncorrupted in `preservedRows` / `admittedChain`.
  const shown =
    status === "failed" || status === "refused" || status === "cancelled"
      ? startChain(expected, snapshotId, limit, plan.includePayload)
      : chain;

  const preservedRows: readonly EvidenceReferenceView[] = epochConflict ? epochConflict.preservedRows : chain.read;

  return {
    status,
    chain: shown,
    /** The chain of already-admitted pages, with `next: null` frozen on HTTP 409 so already-rendered rows are never corrupted. */
    admittedChain: chain,
    /** Rows admitted prior to any HTTP 409 conflict, preserved without corruption. */
    preservedRows,
    includePayload: plan.includePayload,
    pagesRead: shown.pages,
    failure,
    refusal,
    epochConflict,
    isEpochFrozen: isEpochFrozenForCurrent(),
    requestId: epochConflict?.requestId ?? (failure?.kind === "error" || failure?.kind === "not_found" ? failure.requestId : null),
    lastBinding: issued.current,
    readNext: () => advance(false),
    readAll: () => advance(true),
    restart,
    cancel,
    /** Exposed for the read lifecycle tests; the page uses restart(). */
    retryCurrent,
  };
}
