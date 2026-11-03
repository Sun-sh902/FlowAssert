/**
 * Minimal hash router. Hash routing keeps the demo working from any static host
 * without server rewrites. Routes:
 *   #/                         LOCAL_RESEARCH workspace Overview, read from the local Service's archive (product round 01);
 *                              in the GitHub Pages build, the CSV check (#/overview is the Overview in both builds)
 *   #/check                    CSV check: two files compared in this browser (v0.3.0); nothing is sent
 *   #/verifications            LOCAL_RESEARCH Verifications: the five reviewed cases with their four status axes
 *                              (#/local/verifications is the same page, kept so earlier links keep working)
 *   #/capture                  Capture runs — not implemented in this build; states so and offers no action
 *   #/demo                     MOCK demo Overview (synthetic fixtures, nothing read from any service)
 *   #/demo/verifications       MOCK demo runs list
 *   #/demo/verifications/:id   MOCK demo Verification detail (?record=KEY&state=STATE)
 *   #/connections | #/rules | #/settings   Demo configuration pages (synthetic, nothing connected)
 *   #/states                   Interface-state specimens (simulated data-access states; linked from Settings §4)
 *   #/local/verifications/:id  LOCAL_RESEARCH Detail, read over HTTP from the local Python service
 *   #/local/history            LOCAL_RESEARCH (Phase 3A): archived evaluations listed from the local SQLite archive (?case=SPEC-00N)
 *   #/local/history/:historyId LOCAL_RESEARCH (Phase 3A): one archived evaluation and its archived evidence
 *   #/local/verification-lookup?verification_id=ID[&state=STATE][&record=KEY]
 *                              LOCAL_RESEARCH Detail addressed by exact ID (ID-addressability remediation-03),
 *                              read through the additive query API. The path is static; the ID is only ever
 *                              query DATA, so ".", "..", "x/evidence", "a?b#c", "a+b", "a%2Fb" are IDs, not routes.
 *
 * Path segments are percent-decoded once. A segment that is not valid percent-encoding is kept as
 * written and decoding never throws. For #/local/verifications/:id such a segment is marked
 * `malformed` (P3A-AUD-001): "%" is a legitimate Verification ID character, so "100%" in the address is
 * refused as malformed route encoding (the ID 100% is written 100%25), never read as a literal ID.
 * IDs are not validated here — src/data/local/ids.ts does that before any request is built.
 *
 * The lookup route's query is decoded strictly, once (decodeStrictQuery, src/data/local/ids.ts): form encoding
 * ("+" is space, %XX is UTF-8), only the keys verification_id (required), state and record, none repeated. A
 * malformed escape, non-UTF-8 bytes, an unknown or repeated key, or a missing verification_id makes the route
 * `malformed` — shown as such, never repaired or replaced with U+FFFD. Links to it are built only by lookupHref.
 * Everything after the FIRST "?" of the hash is the query (a later "?" is query data, as in RFC 3986).
 */
import { useCallback, useEffect, useState } from "react";
import { decodeStrictQuery } from "../data/local/ids";
import { PAGES_BUILD } from "./build";

export type Route =
  | { name: "check" }
  | { name: "workspace" }
  | { name: "capture" }
  | { name: "demo-overview" }
  | { name: "demo-verifications" }
  | { name: "demo-verification"; id: string }
  | { name: "connections" }
  | { name: "rules" }
  | { name: "settings" }
  | { name: "states" }
  | { name: "local-verifications" }
  | { name: "local-verification"; id: string; malformed?: true }
  | { name: "local-lookup"; id: string; malformed?: string }
  | { name: "local-history" }
  | { name: "local-history-entry"; id: string }
  | { name: "not-found" };

/** The Phase 3A archive routes (LOCAL_RESEARCH). */
export const isHistoryRoute = (r: Route) => r.name === "local-history" || r.name === "local-history-entry";

/** Routes whose data comes from LOCAL_RESEARCH. Every other route is the MOCK demo. */
export const isLocalRoute = (r: Route) =>
  r.name === "workspace" || r.name === "capture" || r.name === "local-verifications" || r.name === "local-verification" || r.name === "local-lookup" || isHistoryRoute(r);

/** The MOCK demo routes (synthetic fixtures; nothing is read from any service). */
export const isDemoRunRoute = (r: Route) => r.name === "demo-overview" || r.name === "demo-verifications" || r.name === "demo-verification";

/** Where the MOCK demo lives. */
export const DEMO_RUNS_PATH = "/demo/verifications";

/** The exact-ID lookup route's static path and its only query keys. */
export const LOOKUP_PATH = "/local/verification-lookup";
const LOOKUP_KEYS = ["verification_id", "state", "record"] as const;

/** Link to the exact-ID lookup Detail: the ID is one URLSearchParams value, encoded once — never a path segment. */
export function lookupHref(id: string, params?: Record<string, string | null | undefined>): string {
  return href(LOOKUP_PATH, { verification_id: id, ...params });
}

/** Decode one path segment once; malformed percent-encoding is returned unchanged instead of throwing. */
export function decodeSegment(segment: string): string {
  return tryDecodeSegment(segment) ?? segment;
}

/** Decode one path segment once, or null when it is not valid (UTF-8) percent-encoding. */
export function tryDecodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export interface Location {
  route: Route;
  params: URLSearchParams;
  path: string;
}

function parse(hash: string): Location {
  const raw = hash.replace(/^#/, "") || "/";
  const qi = raw.indexOf("?");
  const path = qi === -1 ? raw : raw.slice(0, qi);
  const query = qi === -1 ? "" : raw.slice(qi + 1);
  const params = new URLSearchParams(query);
  const parts = path.split("/").filter(Boolean);
  let route: Route = { name: "not-found" };
  if (parts.length === 0) route = PAGES_BUILD ? { name: "check" } : { name: "workspace" };
  else if (parts[0] === "overview" && parts.length === 1) route = { name: "workspace" };
  else if (parts[0] === "check" && parts.length === 1) route = { name: "check" };
  else if (parts[0] === "verifications" && parts.length === 1) route = { name: "local-verifications" };
  else if (parts[0] === "capture" && parts.length === 1) route = { name: "capture" };
  else if (parts[0] === "demo" && parts.length === 1) route = { name: "demo-overview" };
  else if (parts[0] === "demo" && parts[1] === "verifications" && parts.length === 2) route = { name: "demo-verifications" };
  else if (parts[0] === "demo" && parts[1] === "verifications" && parts[2] && parts.length === 3)
    route = { name: "demo-verification", id: decodeSegment(parts[2]) };
  else if (parts.length === 1 && (parts[0] === "connections" || parts[0] === "rules" || parts[0] === "settings" || parts[0] === "states"))
    route = { name: parts[0] };
  else if (parts[0] === "local" && (parts.length === 1 || (parts.length === 2 && parts[1] === "verifications"))) route = { name: "local-verifications" };
  else if (parts[0] === "local" && parts[1] === "verifications" && parts[2] && parts.length === 3) {
    const id = tryDecodeSegment(parts[2]);
    route = id === null ? { name: "local-verification", id: parts[2], malformed: true } : { name: "local-verification", id };
  }
  else if (path === LOOKUP_PATH) {
    const strict = decodeStrictQuery(query, LOOKUP_KEYS, false);
    const id = strict.ok ? strict.params.get("verification_id") : undefined;
    route = !strict.ok
      ? { name: "local-lookup", id: query, malformed: strict.reason }
      : id === undefined
        ? { name: "local-lookup", id: query, malformed: "the address has no verification_id" }
        : { name: "local-lookup", id };
  }
  else if (parts[0] === "local" && parts[1] === "history" && parts.length === 2) route = { name: "local-history" };
  else if (parts[0] === "local" && parts[1] === "history" && parts[2] && parts.length === 3) route = { name: "local-history-entry", id: decodeSegment(parts[2]) };
  return { route, params, path };
}

/** The pure hash parser (exported for tests; the app reads it through useLocation). */
export const parseHash = (hash: string): Location => parse(hash);

export function href(path: string, params?: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v) q.set(k, v);
  const qs = q.toString();
  return `#${path}${qs ? `?${qs}` : ""}`;
}

export function useLocation(): Location {
  const [loc, setLoc] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setLoc(parse(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return loc;
}

/**
 * Update query params without adding a history entry (filters, selection). `fixed` params (the lookup route's
 * verification_id) are always written first and are never dropped by a selection change.
 */
export function useReplaceParams(path: string, fixed?: Record<string, string>) {
  const fixedKey = fixed ? JSON.stringify(fixed) : "";
  return useCallback(
    (params: Record<string, string | null | undefined>) => {
      const next = href(path, { ...(fixedKey ? (JSON.parse(fixedKey) as Record<string, string>) : {}), ...params });
      window.history.replaceState(null, "", next);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    },
    [path, fixedKey],
  );
}
