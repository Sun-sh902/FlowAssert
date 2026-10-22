/**
 * CONTROLLED ACCESS SCENARIOS — synthetic, frontend-only, for the interface-state specimens.
 *
 * Each scenario is a MOCK provider whose read settles in a chosen way after a short delay. Nothing
 * is fetched. Ready results are the existing demo runs, unchanged; no scenario edits a verdict,
 * a count or a record. Snapshot IDs and evidence references below are illustrative labels only.
 */
import type { ProviderResult } from "../data/access";
import { MOCK_CONTEXT, settleLater, type FlowAssertReadProvider } from "../data/provider";
import { getRun } from "../data/store";
import type { EvidencePageView, EvidenceReferenceView } from "../domain/evidence";
import type { RunView } from "../domain/view";

export const SCENARIOS = ["ready", "not_found", "request_error", "service_unavailable", "stale_snapshot"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const SCENARIO_LABEL: Record<Scenario, string> = {
  ready: "Ready",
  not_found: "Not found",
  request_error: "Request error",
  service_unavailable: "Service down",
  stale_snapshot: "Stale snapshot",
};

/** Snapshot the specimen view is pinned to, and the different one a stale response carries. */
export const PINNED_SNAPSHOT = "snap-demo-0007";
export const OTHER_SNAPSHOT = "snap-demo-0009";

export function scenarioProvider(scenario: Scenario, delayMs = 900): FlowAssertReadProvider {
  const settle = <T>(r: () => ProviderResult<T>, signal?: AbortSignal) => settleLater(r, signal, delayMs);
  return {
    mode: "MOCK",
    capabilities: { readRuns: true, readEvidence: true, liveAcquisition: false, requestRecheck: false },
    getVerification(id, _q, signal) {
      return settle<RunView>(() => {
        const run = getRun(id);
        switch (scenario) {
          case "ready":
            return run ? { kind: "ready", data: run, context: { ...MOCK_CONTEXT, snapshotId: PINNED_SNAPSHOT } } : { kind: "not_found", requestId: "req-demo-404" };
          case "stale_snapshot":
            return run ? { kind: "ready", data: run, context: { ...MOCK_CONTEXT, snapshotId: OTHER_SNAPSHOT } } : { kind: "not_found", requestId: "req-demo-404" };
          case "not_found":
            return { kind: "not_found", requestId: "req-demo-404" };
          case "request_error":
            return { kind: "error", access: "REQUEST_ERROR", code: "internal_error", message: "Unexpected sanitized service failure (500).", requestId: "req-demo-500", retryable: true };
          case "service_unavailable":
            return { kind: "error", access: "SERVICE_UNAVAILABLE", code: "no_response", message: "No response from the local service.", requestId: null, retryable: true };
        }
      }, signal);
    },
    getEvidence(id, _q, signal) {
      return settle<EvidencePageView>(() => ({ kind: "partial", data: evidenceFor(id), context: { ...MOCK_CONTEXT, snapshotId: PINNED_SNAPSHOT }, unavailableIds: ["ref-dst-0002"] }), signal);
    },
  };
}

/** Illustrative inventory: one reference per role, with every availability the contract allows represented. */
export function evidenceFor(runId: string): EvidencePageView {
  const items: EvidenceReferenceView[] = [
    {
      id: "ref-src-0001",
      role: "source",
      availability: "available",
      reason: null,
      sha256: "5f1c0a9be2d4473e8a61b0c7d9f2e3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0",
      acquisitionKind: "synthetic_local",
      externalAuthenticity: "not_authenticated",
      payload: { state: "loaded" },
    },
    {
      id: "ref-dst-0002",
      role: "destination",
      availability: "available",
      reason: null,
      sha256: "a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1",
      acquisitionKind: "synthetic_local",
      externalAuthenticity: "not_authenticated",
      payload: { state: "unavailable", reason: "read failed (503)" },
    },
    {
      id: "ref-pol-0003",
      role: "policy",
      availability: "available",
      reason: null,
      sha256: "c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3",
      acquisitionKind: "synthetic_local",
      externalAuthenticity: "not_authenticated",
      payload: { state: "omitted", reason: "omitted_by_request" },
    },
    {
      id: "ref-wfc-0004",
      role: "evaluation_input",
      availability: "not_collected",
      reason: "workflow context is not evidence in this policy",
      sha256: null,
      acquisitionKind: "workflow_context",
      externalAuthenticity: "not_assessed",
      payload: { state: "unavailable", reason: "nothing stored" },
    },
    {
      id: "ref-src-0005",
      role: "source",
      availability: "redacted",
      reason: "contact fields withheld from this workspace",
      sha256: null,
      acquisitionKind: "independent_source_read",
      externalAuthenticity: "not_authenticated",
      payload: { state: "unavailable", reason: "redacted at rest" },
    },
    {
      id: "ref-dst-0006",
      role: "destination",
      availability: "expired",
      reason: "retention window elapsed",
      sha256: null,
      acquisitionKind: "destination_read",
      externalAuthenticity: "not_authenticated",
      payload: { state: "unavailable", reason: "expired" },
    },
  ];
  return { runId, snapshotId: PINNED_SNAPSHOT, items, nextCursor: null, total: items.length };
}
