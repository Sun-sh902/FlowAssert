/**
 * Local API gate for the Vite dev and preview servers (Phase 3A, P2-AUD-004).
 *
 * Replaces the Phase 2 `/api/v1` prefix proxy, which forwarded every method, matched a raw string
 * prefix (`/api/v1x`), and let non-browser clients resolve dot segments to other Service paths
 * (`/api/v1/../../docs`). This gate forwards ONLY these exact GET operations to the fixed loopback
 * Service at 127.0.0.1:8765, byte-for-byte as requested (no rewriting, no normalization, no re-encoding):
 *
 *   GET /api/v1/verifications/{id}                   ?snapshot_id                                (frozen, Phase 2)
 *   GET /api/v1/verifications/{id}/evidence          ?snapshot_id &limit &include_payload &cursor (frozen, Phase 2)
 *   GET /api/v1/history                              ?limit &cursor &verification_id              (additive, Phase 3A)
 *   GET /api/v1/history/{history_id}                 ?snapshot_id                                (additive, Phase 3A)
 *   GET /api/v1/history/{history_id}/evidence        ?limit &cursor &snapshot_id &include_payload (additive, Phase 3A)
 *   GET /api/v1/verification-lookup                  ?verification_id &snapshot_id               (additive, remediation-03)
 *   GET /api/v1/verification-evidence                ?verification_id &snapshot_id &limit &include_payload &cursor
 *                                                                                                 (additive, remediation-03)
 * The two remediation-03 routes are the additive contract phase3a-id-addressability-1.0.0
 * (FlowAssert-Phase3A-Service/contracts/openapi-id-addressability-v1.yaml, SHA-256 59ac3863…d8ae). Their paths are
 * static; the Verification ID is query DATA. Their query is judged with the backend's own grammar, narrowed to the
 * one spelling the app produces (src/data/local/ids.ts decodeStrictQuery, canonical): RFC 3986 query characters
 * only, "&"-separated name=value pairs, plain names from that route's list, none repeated, verification_id
 * required, every value valid UTF-8 form encoding written exactly as URLSearchParams writes it; then the value
 * bounds the backend applies (ID 1–128 code points, snapshot_id 1–128, cursor ≤ 2048, limit 1–100 in 1–3 ASCII
 * digits, include_payload true|false). Everything admitted is decoded by the Service exactly as here — once — and
 * the target is still forwarded unchanged; query data never becomes a path. Cursor meaning stays the Service's.
 *
 * Every request whose path begins with `/api` (any case) is decided here and never reaches Vite's
 * own handlers; everything else is the app's static/SPA traffic and is never forwarded anywhere.
 * Refused, with a gate envelope `{ "gate": { code, reason } }` (deliberately NOT the FlowAssert Error
 * envelope, so a gate answer can never be mistaken for the Service's):
 *   403 host_not_allowed      Host header is not this server's own loopback authority
 *   405 method_not_allowed    any method but GET (POST, PUT, PATCH, DELETE, HEAD, OPTIONS, …)
 *   400 request_target_refused  the target is not origin-form, or is longer than 4096 characters
 *   400 path_refused          backslash, empty segment ("//") or a dot segment ("." / "..") in the raw path
 *   400 encoded_path_refused  "%" anywhere in the path except inside the {id} segment of the two verification
 *                             routes; and an {id} segment that is not exactly the canonical encoding of an
 *                             admitted Verification ID (P3A-AUD-001; src/data/local/ids.ts
 *                             verificationIdFromSegment): malformed, non-UTF-8, lower-case or needless escapes,
 *                             raw reserved/non-ASCII bytes, or a decoded "/", "." or ".." are all refused
 *   404 route_not_allowed     any other path, including adjacent prefixes (/api/v1x, /api/v2, /API/v1)
 *   400 query_not_allowed     a query key outside that route's list, a repeated key, or a malformed pair; on the two
 *                             lookup routes also a missing verification_id, an encoded/non-canonical/non-UTF-8 value
 *                             or a value outside the bounds above
 *   400 body_not_allowed      a GET with a body
 *   502 upstream_redirect_refused  the Service answered 3xx — never followed, Location never passed on
 *   502 service_unreachable / 504 service_timeout   transport failure towards the Service
 * Upstream requests carry only Accept, the fixed Host 127.0.0.1:8765 and — when the browser sent one —
 * its Origin, so the Service's own exact-Origin allowlist still applies. No cookie, credential,
 * Referer or other client header is forwarded. Responses pass only content-type, content-length,
 * cache-control, date and server. Nothing here is a production server; it binds where Vite binds (loopback).
 */
import http from "node:http";
import type { Plugin } from "vite";
import { checkLookupVerificationId, decodeStrictQuery, verificationIdFromSegment } from "../src/data/local/ids.ts";

export const SERVICE = { host: "127.0.0.1", port: 8765 } as const;
export const MAX_TARGET = 4096;
const TIMEOUT_MS = 15_000;

/** Structure of a verification {id} segment; its meaning is decided by verificationIdFromSegment (frozen contract 1–128). */
const VERIFICATION_ID = "(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+";
/** Both frozen verification routes, with the raw {id} segment captured exactly as the backend routes it. */
const VERIFICATION_PATH = /^\/api\/v1\/verifications\/([^/]+)(?:\/evidence)?$/;
const HISTORY_ID = "hist_[a-f0-9]{64}";

export interface GateRoute {
  name: string;
  pattern: RegExp;
  query: readonly string[];
  /** The remediation-03 exact-ID lookup routes: strict canonical query grammar and value bounds (lookupQueryProblem). */
  lookup?: true;
}

export const ROUTES: readonly GateRoute[] = [
  { name: "verification", pattern: new RegExp(`^/api/v1/verifications/${VERIFICATION_ID}$`), query: ["snapshot_id"] },
  { name: "verification-evidence", pattern: new RegExp(`^/api/v1/verifications/${VERIFICATION_ID}/evidence$`), query: ["snapshot_id", "limit", "include_payload", "cursor"] },
  { name: "history-list", pattern: /^\/api\/v1\/history$/, query: ["limit", "cursor", "verification_id"] },
  { name: "history-detail", pattern: new RegExp(`^/api/v1/history/${HISTORY_ID}$`), query: ["snapshot_id"] },
  { name: "history-evidence", pattern: new RegExp(`^/api/v1/history/${HISTORY_ID}/evidence$`), query: ["limit", "cursor", "snapshot_id", "include_payload"] },
  { name: "verification-lookup", pattern: /^\/api\/v1\/verification-lookup$/, query: ["verification_id", "snapshot_id"], lookup: true },
  { name: "verification-lookup-evidence", pattern: /^\/api\/v1\/verification-evidence$/, query: ["verification_id", "snapshot_id", "limit", "include_payload", "cursor"], lookup: true },
];

const codePoints = (s: string) => [...s].length;

/** Why a lookup route's query is refused, or null. Bounds are the backend's own (app/verification_lookup.py lookup_query). */
export function lookupQueryProblem(route: GateRoute, query: string): string | null {
  const strict = decodeStrictQuery(query, route.query, true);
  if (!strict.ok) return strict.reason;
  const p = strict.params;
  const id = p.get("verification_id");
  if (id === undefined) return "verification_id is required";
  const admitted = checkLookupVerificationId(id);
  if (!admitted.ok) return `verification_id refused: ${admitted.reason}`;
  const snapshot = p.get("snapshot_id");
  if (snapshot !== undefined && (snapshot === "" || codePoints(snapshot) > 128)) return "snapshot_id must be 1–128 characters";
  const cursor = p.get("cursor");
  if (cursor !== undefined && codePoints(cursor) > 2048) return "cursor exceeds 2048 characters";
  const limit = p.get("limit");
  if (limit !== undefined && (!/^[0-9]{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100)) return "limit must be 1–100 written as 1–3 ASCII digits";
  const payload = p.get("include_payload");
  if (payload !== undefined && payload !== "true" && payload !== "false") return "include_payload must be exactly true or false";
  return null;
}

export type Decision = { forward: true; route: string; target: string } | { forward: false; status: number; code: string; reason: string };

const refuse = (status: number, code: string, reason: string): Decision => ({ forward: false, status, code, reason });

/** Whether this gate owns the request at all. Anything else is the app's own static/SPA traffic. */
export const isGated = (rawTarget: string | undefined) => typeof rawTarget === "string" && /^\/api/i.test(rawTarget);

/**
 * The whole decision, as a pure function of what arrived on the socket. `rawTarget` is the request
 * target exactly as sent (Node's req.url, before any normalization).
 */
export function decide(input: { method: string | undefined; rawTarget: string; host: string | undefined; ownHosts: readonly string[]; hasBody: boolean }): Decision {
  const { method, rawTarget, host, ownHosts, hasBody } = input;
  if (!host || !ownHosts.includes(host.toLowerCase())) return refuse(403, "host_not_allowed", `Host ${JSON.stringify(host ?? null)} is not this server's own loopback authority.`);
  if (method !== "GET") return refuse(405, "method_not_allowed", `${method ?? "(none)"} is not forwarded; the local API is read-only GET.`);
  if (!rawTarget.startsWith("/") || rawTarget.length > MAX_TARGET || rawTarget.includes("#")) return refuse(400, "request_target_refused", "Only an origin-form request target of at most 4096 characters is accepted.");
  const q = rawTarget.indexOf("?");
  const path = q === -1 ? rawTarget : rawTarget.slice(0, q);
  const query = q === -1 ? "" : rawTarget.slice(q + 1);
  const segments = path.split("/").slice(1);
  if (path.includes("\\") || segments.some((s) => s === "" || s === "." || s === "..")) return refuse(400, "path_refused", "Backslashes, empty segments and dot segments are refused, never resolved.");
  // P3A-AUD-001: percent-encoding is meaningful only as a Verification ID's canonical segment; the gate decodes
  // that one segment once, to judge it, and still forwards the target unchanged.
  const verification = VERIFICATION_PATH.exec(path);
  if (verification) {
    const carried = verificationIdFromSegment(verification[1]!);
    if (!carried.ok) return refuse(400, "encoded_path_refused", `Verification ID segment refused: ${carried.reason}.`);
  } else if (path.includes("%")) return refuse(400, "encoded_path_refused", "Percent-encoding outside a verification ID segment is refused (no encoded separator, dot or malformed escape is ever decoded here).");
  const route = ROUTES.find((r) => r.pattern.test(path));
  if (!route) return refuse(404, "route_not_allowed", "Only the documented local read routes are forwarded.");
  if (route.lookup) {
    const problem = lookupQueryProblem(route, query);
    if (problem) return refuse(400, "query_not_allowed", `Lookup query refused on ${route.name}: ${problem}.`);
  } else if (query !== "") {
    const seen = new Set<string>();
    for (const pair of query.split("&")) {
      const eq = pair.indexOf("=");
      const key = eq === -1 ? pair : pair.slice(0, eq);
      if (eq === -1 || !/^[a-z_]+$/.test(key)) return refuse(400, "query_not_allowed", `Malformed query pair ${JSON.stringify(pair.slice(0, 64))}.`);
      if (!route.query.includes(key)) return refuse(400, "query_not_allowed", `Query key ${key} is not accepted on ${route.name}.`);
      if (seen.has(key)) return refuse(400, "query_not_allowed", `Query key ${key} is repeated.`);
      seen.add(key);
    }
  }
  if (hasBody) return refuse(400, "body_not_allowed", "A GET with a body is refused.");
  return { forward: true, route: route.name, target: rawTarget };
}

const PASS_HEADERS = ["content-type", "content-length", "cache-control", "date", "server"] as const;

function answer(res: http.ServerResponse, status: number, code: string, reason: string, extra: Record<string, string> = {}) {
  const body = JSON.stringify({ gate: { code, reason } });
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-flowassert-gate": "refused", "content-length": Buffer.byteLength(body), ...extra });
  res.end(body);
}

/** Connect-style middleware. `upstream` is overridable for tests only. */
export function gateMiddleware(upstream: { host: string; port: number } = SERVICE) {
  return (req: http.IncomingMessage, res: http.ServerResponse, next: (err?: unknown) => void) => {
    const rawTarget = req.url ?? "";
    if (!isGated(rawTarget)) return next();
    const port = req.socket.localPort;
    const ownHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const hasBody = (req.headers["content-length"] !== undefined && req.headers["content-length"] !== "0") || req.headers["transfer-encoding"] !== undefined;
    const d = decide({ method: req.method, rawTarget, host: req.headers.host, ownHosts, hasBody });
    if (!d.forward) return answer(res, d.status, d.code, d.reason, d.status === 405 ? { allow: "GET" } : {});
    const headers: Record<string, string> = { host: `${SERVICE.host}:${SERVICE.port}`, accept: typeof req.headers.accept === "string" ? req.headers.accept : "application/json" };
    if (typeof req.headers.origin === "string") headers.origin = req.headers.origin;
    const up = http.request({ host: upstream.host, port: upstream.port, method: "GET", path: d.target, headers, agent: false, timeout: TIMEOUT_MS });
    up.on("response", (r) => {
      const status = r.statusCode ?? 502;
      if (status >= 300 && status < 400) {
        r.resume();
        return answer(res, 502, "upstream_redirect_refused", `The local service answered ${status}; redirects are never followed or passed on.`);
      }
      const out: Record<string, string> = {};
      for (const h of PASS_HEADERS) {
        const v = r.headers[h];
        if (typeof v === "string") out[h] = v;
      }
      res.writeHead(status, out);
      r.pipe(res);
    });
    up.on("timeout", () => up.destroy(new Error("timeout")));
    up.on("error", (e) => {
      if (res.headersSent) return res.destroy();
      if (e.message === "timeout") answer(res, 504, "service_timeout", "The local service did not answer in time.");
      else answer(res, 502, "service_unreachable", "The local service could not be reached.");
    });
    req.on("aborted", () => up.destroy());
    up.end();
  };
}

/** The Vite plugin: the gate sits in front of Vite's own middlewares on both the dev and the preview server. */
export function localApiGate(): Plugin {
  return {
    name: "flowassert-local-api-gate",
    configureServer(server) {
      server.middlewares.use(gateMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(gateMiddleware());
    },
  };
}
