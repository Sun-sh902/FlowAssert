/**
 * Local Service status (product round 02) — what the most recent same-origin read observed, nothing more.
 *
 * Every LOCAL_RESEARCH read already goes through one transport (src/data/local/provider.ts `exchange`); it
 * reports each settled exchange here. The indicator therefore adds NO traffic and NO polling: it shows the
 * newest observation, and the person can ask for one explicit check (GET /api/v1/history?limit=1, an existing
 * permitted read). It never infers evidence-acquisition, n8n or HubSpot health from a Service answer.
 *
 *   CHECKING          a read is in flight and nothing has been observed yet
 *   REACHABLE         the Service answered HTTP 200
 *   REQUEST_FAILURE   something answered with an error: the Service (FlowAssert error envelope) or the local gate
 *                     refusing the request (not a Service outage)
 *   UNAVAILABLE       nothing answered: transport failure or timeout, or the gate reports the Service unreachable
 *   UNKNOWN           nothing observed yet on this page load
 * An observation older than STALE_AFTER_MS is shown as stale; it is never silently refreshed.
 */
import { useSyncExternalStore } from "react";

export type ServiceObservation =
  | { kind: "REACHABLE"; at: number; path: string }
  | { kind: "REQUEST_FAILURE"; at: number; path: string; status: number; code: string; answeredBy: "service" | "gate" | "unrecognized" }
  | { kind: "UNAVAILABLE"; at: number; path: string; reason: "transport" | "timeout" | "gate_service_unreachable" | "gate_service_timeout" };

export interface ServiceStatusState {
  last: ServiceObservation | null;
  inFlight: number;
}

export const STALE_AFTER_MS = 120_000;

let state: ServiceStatusState = { last: null, inFlight: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function exchangeStarted() {
  state = { ...state, inFlight: state.inFlight + 1 };
  emit();
}

/** A request that was aborted by its caller observed nothing. */
export function exchangeAborted() {
  state = { ...state, inFlight: Math.max(0, state.inFlight - 1) };
  emit();
}

export function exchangeSettled(obs: ServiceObservation) {
  state = { last: obs, inFlight: Math.max(0, state.inFlight - 1) };
  emit();
}

/** Classify one settled exchange. Pure; `body` is the response text. */
export function classifyExchange(
  path: string,
  at: number,
  ex: { kind: "timeout" } | { kind: "transport" } | { kind: "response"; status: number; contentType: string; text: string },
): ServiceObservation {
  if (ex.kind === "timeout") return { kind: "UNAVAILABLE", at, path, reason: "timeout" };
  if (ex.kind === "transport") return { kind: "UNAVAILABLE", at, path, reason: "transport" };
  if (ex.status === 200) return { kind: "REACHABLE", at, path };
  let body: unknown = null;
  if (ex.contentType.includes("application/json"))
    try {
      body = JSON.parse(ex.text);
    } catch {
      body = null;
    }
  const gate = (body as { gate?: { code?: unknown } } | null)?.gate;
  if (gate && typeof gate.code === "string") {
    if (gate.code === "service_unreachable") return { kind: "UNAVAILABLE", at, path, reason: "gate_service_unreachable" };
    if (gate.code === "service_timeout") return { kind: "UNAVAILABLE", at, path, reason: "gate_service_timeout" };
    return { kind: "REQUEST_FAILURE", at, path, status: ex.status, code: gate.code, answeredBy: "gate" };
  }
  const err = (body as { error?: { code?: unknown } } | null)?.error;
  if (err && typeof err.code === "string") return { kind: "REQUEST_FAILURE", at, path, status: ex.status, code: err.code, answeredBy: "service" };
  return { kind: "REQUEST_FAILURE", at, path, status: ex.status, code: "unrecognized_response", answeredBy: "unrecognized" };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useServiceStatus(): ServiceStatusState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Tests only. */
export function resetServiceStatus() {
  state = { last: null, inFlight: 0 };
  emit();
}
