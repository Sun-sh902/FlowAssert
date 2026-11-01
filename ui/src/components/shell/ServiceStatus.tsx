/**
 * Local Service status in the top bar (product round 02). Shows the newest observation recorded by the shared
 * transport (src/data/serviceStatus.ts) — it sends nothing by itself. "Check" issues one existing permitted read
 * (GET /api/v1/history?limit=1). The only timer re-renders the age while mounted; it never requests anything.
 * It answers one question — did the local Service answer a read — and nothing about acquisition health.
 */
import { RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { HISTORY_API } from "../../data/history/config";
import { LOCAL_LIMITS, LOCAL_SERVICE_TARGET } from "../../data/local/config";
import { exchange } from "../../data/local/provider";
import { STALE_AFTER_MS, useServiceStatus, type ServiceObservation } from "../../data/serviceStatus";
import { cn } from "../../lib/cn";

const HOST = LOCAL_SERVICE_TARGET.replace("http://", "");
export const SERVICE_STATUS_SCOPE =
  "Reports only whether the local Service answered a read from this page. It says nothing about evidence acquisition, capture, n8n or HubSpot.";

export type StatusKind = "CHECKING" | "REACHABLE" | "REQUEST_FAILURE" | "UNAVAILABLE" | "UNKNOWN" | "STALE";

function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

const REASON: Record<Extract<ServiceObservation, { kind: "UNAVAILABLE" }>["reason"], string> = {
  transport: "no response",
  timeout: `no response within ${LOCAL_LIMITS.timeoutMs / 1000} s`,
  gate_service_unreachable: "gate: service unreachable",
  gate_service_timeout: "gate: service timeout",
};

/** Pure: the indicator's state and wording for an observation at `now`. */
export function describeStatus(last: ServiceObservation | null, inFlight: number, now: number): { kind: StatusKind; label: string; detail: string } {
  if (!last) return inFlight > 0 ? { kind: "CHECKING", label: "Checking", detail: `reading ${HOST}` } : { kind: "UNKNOWN", label: "Not checked", detail: "no read on this page yet" };
  const ago = age(now - last.at);
  if (now - last.at > STALE_AFTER_MS && inFlight === 0) {
    const was = last.kind === "REACHABLE" ? "answered" : last.kind === "UNAVAILABLE" ? "unavailable" : "request failed";
    return { kind: "STALE", label: "Stale", detail: `last read ${ago} · ${was}` };
  }
  switch (last.kind) {
    case "REACHABLE":
      return { kind: "REACHABLE", label: "Service reachable", detail: `${HOST} answered ${ago}` };
    case "UNAVAILABLE":
      return { kind: "UNAVAILABLE", label: "Service unavailable", detail: `${REASON[last.reason]} · ${ago}` };
    case "REQUEST_FAILURE":
      return {
        kind: "REQUEST_FAILURE",
        label: last.answeredBy === "gate" ? "Request refused" : "Request failed",
        detail: `HTTP ${last.status} · ${last.code} · ${last.answeredBy === "service" ? "Service answered" : last.answeredBy === "gate" ? "local gate answered" : "unrecognized answer"} · ${ago}`,
      };
  }
}

function Mark({ kind }: { kind: StatusKind }) {
  // Deliberately not verdict colours or verdict shapes: brand for an answer, outlines for everything else.
  const common = { width: 10, height: 10, viewBox: "0 0 10 10", "aria-hidden": true as const, className: "shrink-0" };
  switch (kind) {
    case "REACHABLE":
      return (
        <svg {...common} className="shrink-0 text-brand">
          <rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor" />
        </svg>
      );
    case "CHECKING":
      return (
        <svg {...common} className="shrink-0 animate-pulse text-ink-3">
          <rect x="1" y="1" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case "REQUEST_FAILURE":
      return (
        <svg {...common} className="shrink-0 text-ink-2">
          <rect x="1" y="1" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5 3v2.6M5 7.2v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "UNAVAILABLE":
      return (
        <svg {...common} className="shrink-0 text-ink-2">
          <rect x="1" y="1" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.6 1.4" />
          <path d="M3 7 7 3" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    default:
      return (
        <svg {...common} className="shrink-0 text-ink-3">
          <rect x="1" y="1" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.1" strokeDasharray="0.1 1.9" strokeLinecap="round" />
        </svg>
      );
  }
}

export function ServiceStatus() {
  const { last, inFlight } = useServiceStatus();
  const [now, setNow] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);

  // Re-render the age while an observation is shown. One interval, cleared on unmount; it requests nothing.
  useEffect(() => {
    setNow(Date.now());
    if (!last) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [last]);

  const check = async () => {
    setChecking(true);
    try {
      await exchange((input, init) => globalThis.fetch(input, init), `${HISTORY_API}?limit=1`, LOCAL_LIMITS.timeoutMs);
    } finally {
      setChecking(false);
    }
  };

  const d = describeStatus(last, inFlight, now);
  return (
    <span className="flex min-w-0 items-center gap-2.5" data-service-status={d.kind}>
      {/* Only the state is announced. The age sits outside the live region: it changes every 15 s on an idle page. */}
      <span title={SERVICE_STATUS_SCOPE} className="flex min-w-0 items-center gap-1.5 font-mono text-[11px]">
        <span role="status" aria-live="polite" className="flex items-center gap-1.5">
          <Mark kind={d.kind} />
          <span className={cn("whitespace-nowrap", d.kind === "REACHABLE" ? "text-ink" : "text-ink-2")}>{d.label}</span>
          <span className="sr-only">. {SERVICE_STATUS_SCOPE}</span>
        </span>
        <span className="hidden truncate text-ink-3 md:inline">· {d.detail}</span>
      </span>
      <button
        type="button"
        onClick={check}
        disabled={checking}
        aria-label="Check the local Service now"
        className="fa-hit inline-flex items-center gap-1 rounded-xs text-[11px] text-ink-3 hover:text-ink disabled:opacity-50"
      >
        <RotateCw size={11} aria-hidden className={checking ? "animate-spin" : undefined} />
        <span className="hidden sm:inline">Check</span>
      </button>
    </span>
  );
}
