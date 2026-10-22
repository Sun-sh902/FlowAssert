/**
 * Data provider seam.
 *
 * Pages consume view models (src/domain/view.ts). A provider supplies them.
 *
 * Two surfaces live here:
 *  1. `VerificationProvider` (synchronous, v1.1). What the demo pages use, through store.ts — MOCK only.
 *  2. `FlowAssertReadProvider` (asynchronous). The two reads of the reviewed provider contract —
 *     getVerification and getEvidence — returning `ProviderResult` (src/data/access.ts).
 *       MOCK            wraps the demo store (used by the interface-state specimens).
 *       LOCAL_RESEARCH  Phase 2: real HTTP to the accepted local Python Service (src/data/local/provider.ts),
 *                       used only by the Local research routes (#/local/…). Frozen-schema + F004 admission.
 *       LIVE            not implemented: an explicit unavailable-provider error.
 *  3. `FlowAssertHistoryProvider` (asynchronous, Phase 3A). The three additive archive reads —
 *     listHistory, getHistory, getHistoryEvidence — returning `ProviderResult` like (2).
 *       LOCAL_RESEARCH  real HTTP to the Service's SQLite-backed history routes (src/data/history/provider.ts),
 *                       used only by the History routes (#/local/history…).
 *       MOCK            no archive exists in the demo: an explicit unavailable error, never synthetic history.
 *       LIVE            not implemented: an explicit unavailable-provider error.
 *
 * No mode falls back to another. A LOCAL_RESEARCH failure is an access state, never MOCK data, and
 * no provider derives a verdict in TypeScript: the evaluator's states are copied.
 */
import type { EvidencePageView } from "../domain/evidence";
import type { HistoryDetailView, HistoryListPageView } from "../domain/history";
import type { RunView } from "../domain/view";
import { abortError, type ProviderContext, type ProviderResult } from "./access";
import type { EvidenceBinding } from "./history/decode";
import { localHistoryProvider } from "./history/provider";
import { localResearchProvider } from "./local/provider";
import { getRun, runs } from "./store";

export type ProviderMode = "MOCK" | "LOCAL_RESEARCH" | "LIVE";

/** active: serves the demo pages · local-routes: implemented, used only on its own routes · not-implemented. */
export type ProviderStatus = "active" | "local-routes" | "not-implemented";

export interface ProviderDescriptor {
  mode: ProviderMode;
  title: string;
  body: string;
  status: ProviderStatus;
  /** What has to exist before this mode can be implemented. */
  dependsOn: string;
}

/** Read access the pages need, expressed in view models only. */
export interface VerificationProvider {
  mode: ProviderMode;
  listRuns(): RunView[];
  getRun(id: string): RunView | undefined;
}

export const PROVIDERS: ProviderDescriptor[] = [
  {
    mode: "MOCK",
    title: "Synthetic fixtures",
    body: "Hand-built runs checked for consistency against the research precedence. What you are looking at.",
    status: "active",
    dependsOn: "Nothing — bundled with the UI.",
  },
  {
    mode: "LOCAL_RESEARCH",
    title: "Local research output",
    body: "Pinned Python evaluator results read over HTTP from the local service at 127.0.0.1:8765 — synthetic, unapproved research version. Used only by the Local research pages; the demo pages stay on MOCK.",
    status: "local-routes",
    dependsOn: "The accepted local Python Service running on 127.0.0.1:8765, reached through the dev/preview proxy.",
  },
  {
    mode: "LIVE",
    title: "Live connectors",
    body: "Independent source and HubSpot reads. Requires authorisation decisions not yet made.",
    status: "not-implemented",
    dependsOn: "Owner decisions on source provider, tenancy and authentication; connector phases.",
  },
];

const mockProvider: VerificationProvider = {
  mode: "MOCK",
  listRuns: () => runs,
  getRun,
};

/** The only implemented provider. Existing pages still import store.ts directly; both serve the same data. */
export const activeProvider: VerificationProvider = mockProvider;

/* ---------- Asynchronous read surface (Phase 2.5 extension point) ---------- */

export interface ProviderCapabilities {
  readRuns: boolean;
  readEvidence: boolean;
  liveAcquisition: false;
  requestRecheck: false;
}

export interface DetailQuery {
  snapshotId?: string;
}

export interface EvidenceQuery {
  snapshotId?: string;
  limit?: number;
  cursor?: string;
  includePayload?: boolean;
}

export interface FlowAssertReadProvider {
  readonly mode: ProviderMode;
  readonly capabilities: ProviderCapabilities;
  getVerification(id: string, query?: DetailQuery, signal?: AbortSignal): Promise<ProviderResult<RunView>>;
  getEvidence(id: string, query: EvidenceQuery, signal?: AbortSignal): Promise<ProviderResult<EvidencePageView>>;
}

export const MOCK_CONTEXT: ProviderContext = {
  mode: "MOCK",
  synthetic: true,
  workspaceId: null,
  contractVersion: null,
  snapshotId: null,
  requestId: null,
  researchAuthorization: "demo",
  acquisitionAuthenticity: "not_authenticated",
  clockBasis: "Fixed demo clock",
};

export { abortError };

/** Resolve on a later task unless the signal aborts first. Cancellation rejects with AbortError. */
export function settleLater<T>(value: () => T, signal?: AbortSignal, delayMs = 0): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(value());
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** MOCK wraps the existing synthetic store. Evidence references are not modelled by the fixtures. */
export const mockReadProvider: FlowAssertReadProvider = {
  mode: "MOCK",
  capabilities: { readRuns: true, readEvidence: false, liveAcquisition: false, requestRecheck: false },
  getVerification(id, _query, signal) {
    return settleLater<ProviderResult<RunView>>(() => {
      const run = getRun(id);
      return run ? { kind: "ready", data: run, context: MOCK_CONTEXT } : { kind: "not_found", requestId: null };
    }, signal);
  },
  getEvidence(_id, _query, signal) {
    return settleLater<ProviderResult<EvidencePageView>>(
      () => ({
        kind: "error",
        access: "EVIDENCE_UNAVAILABLE",
        code: "mock_evidence_not_modelled",
        message: "The demo fixtures carry no evidence payloads.",
        requestId: null,
        retryable: false,
      }),
      signal,
    );
  },
};

/** An explicit unavailable-provider error — never a MOCK fallback. LIVE uses it; LOCAL_RESEARCH did before Phase 2. */
export function unavailableReadProvider(mode: Exclude<ProviderMode, "MOCK">): FlowAssertReadProvider {
  const fail = <T,>(signal?: AbortSignal) =>
    settleLater<ProviderResult<T>>(
      () => ({
        kind: "error",
        access: "SERVICE_UNAVAILABLE",
        code: "provider_mode_unavailable",
        message: mode === "LIVE" ? "LIVE is not implemented or enabled." : "LOCAL_RESEARCH awaits Phase 2 authorization; no service is called.",
        requestId: null,
        retryable: false,
      }),
      signal,
    );
  return {
    mode,
    capabilities: { readRuns: false, readEvidence: false, liveAcquisition: false, requestRecheck: false },
    getVerification: (_id, _q, signal) => fail<RunView>(signal),
    getEvidence: (_id, _q, signal) => fail<EvidencePageView>(signal),
  };
}

export function getReadProvider(mode: ProviderMode): FlowAssertReadProvider {
  if (mode === "MOCK") return mockReadProvider;
  if (mode === "LOCAL_RESEARCH") return localResearchProvider();
  return unavailableReadProvider(mode);
}

/* ---------- Phase 3A: archived history (additive read surface) ---------- */

export interface HistoryListQuery {
  limit: number;
  cursor?: string;
  /** One of the contract's filter values (^SPEC-00[1-5]$); omitted for the whole archive. */
  verificationId?: string;
}

export interface HistoryDetailQuery {
  snapshotId?: string;
}

export interface HistoryEvidenceQuery {
  /** The hydrated Detail this evidence belongs to; every page must carry exactly these identities. */
  binding: EvidenceBinding;
  limit: number;
  includePayload: boolean;
  cursor?: string;
}

export interface FlowAssertHistoryProvider {
  readonly mode: ProviderMode;
  listHistory(query: HistoryListQuery, signal?: AbortSignal): Promise<ProviderResult<HistoryListPageView>>;
  getHistory(historyId: string, query?: HistoryDetailQuery, signal?: AbortSignal): Promise<ProviderResult<HistoryDetailView>>;
  getHistoryEvidence(historyId: string, query: HistoryEvidenceQuery, signal?: AbortSignal): Promise<ProviderResult<EvidencePageView>>;
}

/** History outside LOCAL_RESEARCH: an explicit unavailable error. MOCK has no archive and never invents one. */
export function unavailableHistoryProvider(mode: Exclude<ProviderMode, "LOCAL_RESEARCH">): FlowAssertHistoryProvider {
  const fail = <T,>(signal?: AbortSignal) =>
    settleLater<ProviderResult<T>>(
      () => ({
        kind: "error",
        access: "SERVICE_UNAVAILABLE",
        code: mode === "MOCK" ? "mock_history_not_modelled" : "provider_mode_unavailable",
        message: mode === "MOCK" ? "The demo has no archive. History is read only from the LOCAL_RESEARCH archive; no demo history exists." : "LIVE is not implemented or enabled.",
        requestId: null,
        retryable: false,
      }),
      signal,
    );
  return {
    mode,
    listHistory: (_q, signal) => fail<HistoryListPageView>(signal),
    getHistory: (_id, _q, signal) => fail<HistoryDetailView>(signal),
    getHistoryEvidence: (_id, _q, signal) => fail<EvidencePageView>(signal),
  };
}

export function getHistoryProvider(mode: ProviderMode): FlowAssertHistoryProvider {
  return mode === "LOCAL_RESEARCH" ? localHistoryProvider() : unavailableHistoryProvider(mode);
}
