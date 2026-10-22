/**
 * ID-addressability remediation-03 — negative security probes against the REAL gate (vite preview :5183) and the
 * REAL Service (:8765, isolated copy at the handoff identity).
 *  - raw HTTP (exact target bytes, no client-side normalization), once (browser-independent; "chrome" project);
 *  - in-browser fetch probes, in every browser (what a page could send through the gate).
 * Every refusal is recorded with the status and code actually returned. The Service's outbound-connection audit
 * must show loopback only.
 */
import { expect, test } from "@playwright/test";
import { APP_PORT, code, rawRequest, SERVICE_PORT, startService, stopService, wireReceipts, writeEvidence, type ServiceProcess } from "./support.ts";

let svc: ServiceProcess;
test.beforeAll(async ({ browserName }, info) => {
  svc = await startService(`security-${info.project.name}-${browserName}`);
});
test.afterAll(async () => {
  const audit = await stopService(svc);
  expect(audit?.connects.every((c) => ["127.0.0.1", "::1", "localhost"].includes(c.host)) ?? true).toBe(true);
});

const D = "/api/v1/verification-lookup";
const E = "/api/v1/verification-evidence";
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
const EMOJI = "%F0%9F%A7%AA";

/** `html`: answered by the app's own static/SPA handler (the gate does not own non-/api targets), not forwarded. */
type Probe = { name: string; port: number; target: string; method?: string; headers?: Record<string, string>; body?: string; status: number; code?: string | null; html?: true };

async function run(probes: Probe[]) {
  const out = [];
  for (const p of probes) {
    const before = wireReceipts(svc).length;
    const r = await rawRequest(p.port, p.target, { method: p.method, headers: p.headers, body: p.body });
    await new Promise((res) => setTimeout(res, 20));
    const reachedService = wireReceipts(svc).length > before;
    out.push({
      ...p,
      target: p.target.length > 300 ? `${p.target.slice(0, 300)}… (${p.target.length} chars)` : p.target,
      actualStatus: r.status,
      actualCode: code(r.body),
      bodyStart: r.body.slice(0, 120),
      reachedService,
      location: r.headers.location ?? null,
    });
  }
  return out;
}

test("raw HTTP probes: query grammar, IDs, paths, methods, Host, size — gate and Service", async ({ browserName }, info) => {
  test.skip(browserName !== "chromium" || info.project.name !== "chrome", "raw HTTP probes are browser-independent; run once");
  const G = APP_PORT;
  const S = SERVICE_PORT;
  const long = `${D}?${q({ verification_id: "a" })}&snapshot_id=${"s".repeat(4100)}`;
  const probes: Probe[] = [
    // Missing / duplicate / malformed / unknown / length
    { name: "missing verification_id (gate)", port: G, target: D, status: 400, code: "gate:query_not_allowed" },
    { name: "missing verification_id (Service)", port: S, target: D, status: 422, code: "invalid_parameter" },
    { name: "duplicate verification_id (gate)", port: G, target: `${D}?verification_id=a&verification_id=b`, status: 400, code: "gate:query_not_allowed" },
    { name: "duplicate verification_id (Service)", port: S, target: `${D}?verification_id=a&verification_id=b`, status: 400, code: "invalid_query" },
    { name: "encoded duplicate name (gate)", port: G, target: `${D}?verification_id=a&verification%5Fid=b`, status: 400, code: "gate:query_not_allowed" },
    { name: "encoded duplicate name (Service)", port: S, target: `${D}?verification_id=a&verification%5Fid=b`, status: 400, code: "invalid_query" },
    { name: "invalid percent-encoding (gate)", port: G, target: `${D}?verification_id=%ZZ`, status: 400, code: "gate:query_not_allowed" },
    { name: "invalid percent-encoding (Service)", port: S, target: `${D}?verification_id=%ZZ`, status: 400, code: "invalid_query" },
    { name: "invalid UTF-8 (gate)", port: G, target: `${D}?verification_id=%FF`, status: 400, code: "gate:query_not_allowed" },
    { name: "invalid UTF-8 (Service)", port: S, target: `${D}?verification_id=%FF`, status: 400, code: "invalid_query" },
    { name: "encoded surrogate (gate)", port: G, target: `${D}?verification_id=%ED%A0%80`, status: 400, code: "gate:query_not_allowed" },
    { name: "encoded surrogate (Service)", port: S, target: `${D}?verification_id=%ED%A0%80`, status: 400, code: "invalid_query" },
    { name: "unknown key (gate)", port: G, target: `${D}?verification_id=a&evil=1`, status: 400, code: "gate:query_not_allowed" },
    { name: "unknown key (Service)", port: S, target: `${D}?verification_id=a&evil=1`, status: 400, code: "invalid_query" },
    { name: "129 code points (gate)", port: G, target: `${D}?verification_id=${EMOJI.repeat(129)}`, status: 400, code: "gate:query_not_allowed" },
    { name: "129 code points (Service)", port: S, target: `${D}?verification_id=${EMOJI.repeat(129)}`, status: 422, code: "invalid_parameter" },
    { name: "empty ID (Service)", port: S, target: `${D}?verification_id=`, status: 422, code: "invalid_parameter" },
    { name: "128 code points, unknown ID (gate → Service)", port: G, target: `${D}?verification_id=${"%E4%B8%80".repeat(128)}`, status: 404, code: "run_not_found" },
    { name: "an ID that looks like a URL is only data (gate → Service)", port: G, target: `${D}?${q({ verification_id: "http://evil.example/x" })}`, status: 404, code: "run_not_found" },
    { name: "non-canonical spelling refused by the gate only", port: G, target: `${D}?verification_id=%53PEC-005`, status: 400, code: "gate:query_not_allowed" },
    { name: "non-canonical spelling accepted by the Service (decoded once)", port: S, target: `${D}?verification_id=%53PEC-005`, status: 200 },
    // Paths: traversal, encoded separators, unknown, adjacent prefixes
    { name: "dot-segment traversal (gate)", port: G, target: `${D}/../verifications/SPEC-001`, status: 400, code: "gate:path_refused" },
    { name: "dot-segment traversal (Service)", port: S, target: `${D}/../verifications/SPEC-001`, status: 404, code: "lookup_route_not_found" },
    { name: "encoded slash traversal (gate)", port: G, target: `${D}%2F..%2Fverifications%2FSPEC-001`, status: 400, code: "gate:encoded_path_refused" },
    { name: "encoded slash traversal (Service)", port: S, target: `${D}%2F..%2Fverifications%2FSPEC-001`, status: 404, code: "lookup_route_not_found" },
    { name: "encoded dots (gate)", port: G, target: `/api/v1/%2e%2e/verification-lookup?verification_id=a`, status: 400, code: "gate:encoded_path_refused" },
    { name: "trailing slash (gate)", port: G, target: `${D}/?verification_id=a`, status: 400, code: "gate:path_refused" },
    { name: "trailing slash: no redirect (Service)", port: S, target: `${D}/?verification_id=a`, status: 404, code: "lookup_route_not_found" },
    { name: "suffix (gate)", port: G, target: `${D}/x?verification_id=a`, status: 404, code: "gate:route_not_allowed" },
    { name: "suffix (Service)", port: S, target: `${D}/x?verification_id=a`, status: 404, code: "lookup_route_not_found" },
    { name: "adjacent prefix (gate)", port: G, target: `${D}x?verification_id=a`, status: 404, code: "gate:route_not_allowed" },
    { name: "adjacent prefix (gate, evidence)", port: G, target: `${E}s?verification_id=a`, status: 404, code: "gate:route_not_allowed" },
    { name: "unknown API path (gate)", port: G, target: "/api/v1/verification-search?verification_id=a", status: 404, code: "gate:route_not_allowed" },
    { name: "Service docs not reachable (gate)", port: G, target: "/api/v1/../../docs", status: 400, code: "gate:path_refused" },
    { name: "case variant (gate)", port: G, target: `/API/v1/verification-lookup?verification_id=a`, status: 404, code: "gate:route_not_allowed" },
    { name: "legacy path x%2Fevidence still refused (gate)", port: G, target: "/api/v1/verifications/x%2Fevidence", status: 400, code: "gate:encoded_path_refused" },
    // Methods
    ...["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].flatMap((m): Probe[] => [
      { name: `${m} (gate)`, port: G, target: `${D}?verification_id=a`, method: m, status: 405, code: m === "HEAD" ? null : "gate:method_not_allowed" },
      { name: `${m} (Service)`, port: S, target: `${D}?verification_id=a`, method: m, status: 405, code: m === "HEAD" ? null : "method_not_allowed" },
    ]),
    { name: "GET with body (gate)", port: G, target: `${D}?verification_id=a`, body: "{}", headers: { "content-type": "application/json", "content-length": "2" }, status: 400, code: "gate:body_not_allowed" },
    { name: "GET with body (Service)", port: S, target: `${D}?verification_id=a`, body: "{}", headers: { "content-type": "application/json", "content-length": "2" }, status: 400, code: "unexpected_request_body" },
    // Host / Origin / destination
    // Vite's own host check answers a foreign Host with a plain-text 403 before the gate runs (as in the accepted suite).
    { name: "foreign Host (Vite host check, before the gate)", port: G, target: `${D}?verification_id=a`, headers: { host: "evil.example" }, status: 403 },
    { name: "Service authority sent to the gate", port: G, target: `${D}?verification_id=a`, headers: { host: "127.0.0.1:8765" }, status: 403, code: "gate:host_not_allowed" },
    { name: "foreign Host (Service)", port: S, target: `${D}?verification_id=a`, headers: { host: "evil.example" }, status: 403, code: "host_not_allowed" },
    { name: "localhost Host (Service)", port: S, target: `${D}?verification_id=a`, headers: { host: "localhost:8765" }, status: 403, code: "host_not_allowed" },
    { name: "foreign Origin through the gate (Service decides)", port: G, target: `${D}?verification_id=SPEC-005`, headers: { origin: "http://evil.example" }, status: 403, code: "origin_not_allowed" },
    // Not /api-prefixed, so not owned by the gate: the app's static/SPA handler answers with its own HTML. Never forwarded.
    { name: "absolute-form target to an external host (not forwarded)", port: G, target: `http://evil.example${D}?verification_id=a`, status: 200, html: true },
    { name: "scheme-relative target (not forwarded)", port: G, target: `//evil.example${D}?verification_id=a`, status: 200, html: true },
    // Size
    { name: "over 4096 (gate)", port: G, target: long, status: 400, code: "gate:request_target_refused" },
    { name: "over 4096 (Service)", port: S, target: long, status: 414, code: "request_target_too_long" },
  ];
  const results = await run(probes);
  writeEvidence(`security/raw-probes`, { project: info.project.name, results });
  for (const r of results) {
    expect.soft(r.actualStatus, r.name).toBe(r.status);
    if (r.code !== undefined) expect.soft(r.actualCode, r.name).toBe(r.code);
    expect.soft(r.location, `${r.name}: no redirect`).toBeNull();
    // Every gate refusal, the Vite host refusal and the static answers never reach the Service.
    if (r.port === G && (r.code?.startsWith("gate:") || r.html || r.status === 403 && r.code === undefined)) expect.soft(r.reachedService, `${r.name}: not forwarded`).toBe(false);
    if (r.html) expect.soft(r.bodyStart.toLowerCase(), `${r.name}: the app's HTML`).toContain("<!doctype html");
  }
});

test("cursor and snapshot probes through the gate: wrong ID, wrong snapshot, tampered, malformed, cross-family", async ({ browserName }, info) => {
  test.skip(browserName !== "chromium" || info.project.name !== "chrome", "raw HTTP probes are browser-independent; run once");
  const G = APP_PORT;
  const get = async (t: string) => {
    const r = await rawRequest(G, t);
    return { status: r.status, code: code(r.body), json: (() => { try { return JSON.parse(r.body); } catch { return null; } })() };
  };
  const detail = await get(`${D}?${q({ verification_id: "x/evidence" })}`);
  expect(detail.status).toBe(200);
  const snap: string = detail.json.snapshot_id;
  const first = await get(`${E}?${q({ verification_id: "x/evidence", snapshot_id: snap, limit: "1", include_payload: "true" })}`);
  expect(first.status).toBe(200);
  const c1: string = first.json.page.next_cursor;
  const flip = (s: string) => s.slice(0, -3) + (s.at(-3) === "A" ? "B" : "A") + s.slice(-2);
  const aEnc = await get(`${E}?${q({ verification_id: "a%2Fb", limit: "1", include_payload: "true" })}`);
  const legacy = await get(`/api/v1/verifications/SPEC-005/evidence?${q({ snapshot_id: snap, limit: "1", include_payload: "true" })}`);
  const history = await get(`/api/v1/history?limit=1`);
  const hid: string | undefined = history.json?.items?.[0]?.history_id;

  const cases: { name: string; target: string; status: number; code?: string }[] = [
    { name: "valid continuation, exact ID", target: `${E}?${q({ verification_id: "x/evidence", snapshot_id: snap, limit: "1", include_payload: "true", cursor: c1 })}`, status: 200 },
    { name: "wrong-ID cursor (x/evidence → x)", target: `${E}?${q({ verification_id: "x", snapshot_id: snap, limit: "1", include_payload: "true", cursor: c1 })}`, status: 400, code: "cursor_query_conflict" },
    { name: "wrong-ID cursor (a%2Fb → a/b)", target: `${E}?${q({ verification_id: "a/b", limit: "1", include_payload: "true", cursor: aEnc.json.page.next_cursor })}`, status: 400, code: "cursor_query_conflict" },
    { name: "changed limit", target: `${E}?${q({ verification_id: "x/evidence", snapshot_id: snap, limit: "2", include_payload: "true", cursor: c1 })}`, status: 400, code: "cursor_query_conflict" },
    { name: "changed payload flag", target: `${E}?${q({ verification_id: "x/evidence", snapshot_id: snap, limit: "1", include_payload: "false", cursor: c1 })}`, status: 400, code: "cursor_query_conflict" },
    { name: "wrong-snapshot cursor", target: `${E}?${q({ verification_id: "x/evidence", snapshot_id: flip(snap), limit: "1", include_payload: "true", cursor: c1 })}`, status: 409, code: "snapshot_conflict" },
    { name: "tampered cursor", target: `${E}?${q({ verification_id: "x/evidence", snapshot_id: snap, limit: "1", include_payload: "true", cursor: flip(c1) })}`, status: 400, code: "invalid_cursor" },
    { name: "malformed cursor", target: `${E}?${q({ verification_id: "x/evidence", limit: "1", include_payload: "true", cursor: "!!not-a-cursor!!" })}`, status: 400, code: "invalid_cursor" },
    { name: "empty cursor", target: `${E}?${q({ verification_id: "x/evidence", limit: "1", include_payload: "true", cursor: "" })}`, status: 400, code: "invalid_cursor" },
    { name: "path-issued cursor on the query route, same exact ID + snapshot (documented interoperable)", target: `${E}?${q({ verification_id: "SPEC-005", snapshot_id: snap, limit: "1", include_payload: "true", cursor: legacy.json.page.next_cursor })}`, status: 200 },
    ...(hid ? [{ name: "query-issued cursor on a History route (separate namespace)", target: `/api/v1/history/${hid}/evidence?${q({ limit: "1", include_payload: "true", cursor: c1 })}`, status: 400, code: "invalid_cursor" }] : []),
  ];
  const out = [];
  for (const c of cases) {
    const r = await get(c.target);
    out.push({ ...c, actualStatus: r.status, actualCode: r.code, nextCursorNull: r.json?.page ? r.json.page.next_cursor === null : null });
  }
  writeEvidence(`security/cursor-probes`, { project: info.project.name, snapshot: snap, firstCursorLength: c1.length, results: out });
  for (const r of out) {
    expect.soft(r.actualStatus, r.name).toBe(r.status);
    if (r.code) expect.soft(r.actualCode, r.name).toBe(r.code);
  }
});

test("in-browser probes through the gate", async ({ page }, info) => {
  await page.goto("/");
  const probes: [string, string, string | undefined][] = [
    ["invalid UTF-8", `${D}?verification_id=%FF`, undefined],
    ["duplicate", `${D}?verification_id=a&verification_id=b`, undefined],
    ["unknown key", `${D}?verification_id=a&evil=1`, undefined],
    ["POST", `${D}?verification_id=a`, "POST"],
    ["adjacent prefix", `${D}x?verification_id=a`, undefined],
    ["exact ID x/evidence", `${D}?verification_id=x%2Fevidence`, undefined],
    ["raw # is a fragment: only 'a' is sent", `${D}?verification_id=a#b`, undefined],
    ["dot segments are resolved by the browser before sending", `${D}/../verifications/SPEC-001`, undefined],
  ];
  const results = await page.evaluate(async (list) => {
    const out = [];
    for (const [name, url, method] of list) {
      const r = await fetch(url, { method: method ?? "GET", cache: "no-store", redirect: "manual" });
      const text = await r.text();
      let codeOut: string | null = null;
      let identity: string | null = null;
      try {
        const j = JSON.parse(text);
        codeOut = j.error?.code ?? (j.gate ? `gate:${j.gate.code}` : null);
        identity = j.identity?.id ?? null;
      } catch {
        /* not JSON */
      }
      out.push({ name, requested: url, finalUrl: r.url, status: r.status, code: codeOut, identity });
    }
    return out;
  }, probes);
  writeEvidence(`security/browser-probes-${info.project.name}`, results);
  const by = Object.fromEntries(results.map((r) => [r.name, r]));
  expect(by["invalid UTF-8"]).toMatchObject({ status: 400, code: "gate:query_not_allowed" });
  expect(by["duplicate"]).toMatchObject({ status: 400, code: "gate:query_not_allowed" });
  expect(by["unknown key"]).toMatchObject({ status: 400, code: "gate:query_not_allowed" });
  expect(by["POST"]).toMatchObject({ status: 405, code: "gate:method_not_allowed" });
  expect(by["adjacent prefix"]).toMatchObject({ status: 404, code: "gate:route_not_allowed" });
  expect(by["exact ID x/evidence"]).toMatchObject({ status: 200, identity: "x/evidence" });
  expect(by["raw # is a fragment: only 'a' is sent"]).toMatchObject({ status: 404, code: "run_not_found" });
  // The browser itself resolved the dot segments; the result is the ordinary allowed legacy read of SPEC-001.
  expect(by["dot segments are resolved by the browser before sending"]).toMatchObject({ finalUrl: "http://127.0.0.1:5183/api/v1/verifications/SPEC-001", status: 200, identity: "SPEC-001" });
});
