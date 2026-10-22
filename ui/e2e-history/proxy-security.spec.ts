/**
 * PHASE 3A · F22 / F23 · P2-AUD-004 — the local API gate in front of the REAL Service.
 *
 * Two kinds of client, because browser URL normalization alone proves nothing for other clients:
 *  - raw, non-browser requests (exact target bytes, like `curl --path-as-is`) to the preview server;
 *  - requests issued from the page itself (fetch), which the browser normalizes first.
 * The same raw targets sent DIRECTLY to 127.0.0.1:8765 show what the gate keeps out (FastAPI /docs,
 * /openapi.json …). A stub upstream on 8765 (the real Service stopped) proves a redirect is neither
 * followed nor passed on. Every probe and answer is recorded in docs/phase3a/evidence/proxy/.
 */
import http from "node:http";
import { expect, test } from "@playwright/test";
import { APP_HOST, FIRST, captureNetwork, rawRequest, startService, stopService, writeEvidence, type ServiceProcess } from "./support.ts";

test.describe.configure({ mode: "serial" });

const APP = 5183;
const H = FIRST["SPEC-001"];
let service: ServiceProcess | null = null;
const probes: Record<string, unknown>[] = [];

test.beforeAll(async ({ browserName }) => {
  service = await startService(`${browserName}:proxy`, "ui-main");
});
test.afterAll(async ({ browserName }) => {
  if (service) await stopService(service, `${browserName}:proxy`);
  writeEvidence(`../proxy/${browserName}-probes`, probes);
});

async function probe(label: string, target: string, opts: { method?: string; headers?: Record<string, string>; body?: string; port?: number } = {}) {
  const r = await rawRequest(opts.port ?? APP, target, opts);
  const rec = {
    label,
    port: opts.port ?? APP,
    method: opts.method ?? "GET",
    target,
    host: opts.headers?.host ?? `127.0.0.1:${opts.port ?? APP}`,
    status: r.status,
    server: r.headers.server ?? null,
    gate: r.headers["x-flowassert-gate"] ?? null,
    location: r.headers.location ?? null,
    body: r.body.length > 400 ? `${r.body.slice(0, 400)}…(${r.body.length} chars)` : r.body,
  };
  probes.push(rec);
  return { ...r, rec };
}
const gateCode = (body: string) => {
  try {
    return (JSON.parse(body) as { gate?: { code: string } }).gate?.code ?? null;
  } catch {
    return null;
  }
};

test("F23 · exact documented GET routes are forwarded unchanged to the real Service", async () => {
  for (const t of [
    "/api/v1/verifications/SPEC-001",
    "/api/v1/verifications/SPEC-001/evidence?limit=2&include_payload=true",
    "/api/v1/history?limit=2",
    "/api/v1/history?limit=2&verification_id=SPEC-005",
    `/api/v1/history/${H}`,
    `/api/v1/history/${H}/evidence?limit=2&include_payload=false`,
  ]) {
    const r = await probe("allowed", t);
    expect(r.status, t).toBe(200);
    expect(r.headers.server, t).toBe("uvicorn");
    expect(r.headers["x-flowassert-gate"], t).toBeUndefined();
    // Byte-identical to the Service's own answer (history bodies are deterministic).
    if (t.startsWith("/api/v1/history/")) expect(r.body).toBe((await rawRequest(8765, t)).body);
  }
});

test("F23 · adjacent prefixes, other API paths, raw and encoded dot segments never reach the Service", async () => {
  const cases: [string, number, string][] = [
    ["/api/v1x", 404, "route_not_allowed"],
    ["/api/v1xyz/verifications/SPEC-001", 404, "route_not_allowed"],
    ["/api/v2/history", 404, "route_not_allowed"],
    ["/API/v1/history", 404, "route_not_allowed"],
    ["/api/v1/historyx", 404, "route_not_allowed"],
    ["/api/v1/overview", 404, "route_not_allowed"],
    ["/api/v1/verifications", 404, "route_not_allowed"],
    ["/api/v1/workflows", 404, "route_not_allowed"],
    ["/api/v1/../../docs", 400, "path_refused"],
    ["/api/v1/../../openapi.json", 400, "path_refused"],
    ["/api/v1/../../history-openapi.json", 400, "path_refused"],
    ["/api/v1/history/../verifications/SPEC-001", 400, "path_refused"],
    ["/api/v1/verifications/..", 400, "path_refused"],
    ["/api/v1/%2e%2e/%2e%2e/docs", 400, "encoded_path_refused"],
    ["/api/v1/verifications/%2E%2E", 400, "encoded_path_refused"],
    ["/api/v1/verifications/SPEC-001%2Fevidence", 400, "encoded_path_refused"],
    ["/api/v1/verifications/%2e%2e", 400, "encoded_path_refused"],
    ["/api/v1/verifications/.%2E/evidence", 400, "encoded_path_refused"],
    ["/api/v1/verifications/SPEC:006", 400, "encoded_path_refused"],
    ["/api/v1/verifications/SPEC%3a006", 400, "encoded_path_refused"],
    ["/api/v1/verifications/%C0%AF", 400, "encoded_path_refused"],
    ["/api/v1/history/%2e%2e", 400, "encoded_path_refused"],
    ["/api//v1/history", 400, "path_refused"],
  ];
  for (const [t, status, code] of cases) {
    const r = await probe("refused-path", t);
    expect([r.status, gateCode(r.body)], t).toEqual([status, code]);
    expect(r.headers["x-flowassert-gate"], t).toBe("refused");
    expect(r.headers.server, t).toBeUndefined();
  }
  // What the gate keeps out: the Service itself serves FastAPI's /docs and /openapi.json on loopback. The Phase 2
  // prefix proxy resolved `/api/v1/../../docs` to `/docs` before forwarding (P2-AUD-004); the gate never forwards it.
  for (const t of ["/docs", "/openapi.json"]) {
    const exposed = await probe("direct-to-service (contrast)", t, { port: 8765 });
    expect(exposed.status, t).toBe(200);
  }
});

test("F23 · /docs, /openapi.json and /history-openapi.json on the app origin are the app's own pages, never the Service's", async () => {
  for (const t of ["/docs", "/openapi.json", "/history-openapi.json", "http://127.0.0.1:8765/docs"]) {
    const r = await probe("not-gated", t);
    expect(r.headers.server, t).toBeUndefined();
    expect(r.body.toLowerCase(), t).not.toContain("swagger");
    expect(r.body, t).not.toContain('"openapi"');
  }
});

test("F22 · only GET is forwarded; every other method is refused by the gate", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "TRACE"])
    for (const t of ["/api/v1/history", `/api/v1/history/${H}`, "/api/v1/verifications/SPEC-001"]) {
      const r = await probe("method", t, { method, body: ["POST", "PUT", "PATCH"].includes(method) ? "{}" : undefined, headers: ["POST", "PUT", "PATCH"].includes(method) ? { "content-type": "application/json" } : {} });
      expect(r.status, `${method} ${t}`).toBe(405);
      expect(r.headers.allow, `${method} ${t}`).toBe("GET");
      expect(r.headers.server, `${method} ${t}`).toBeUndefined();
    }
  // Node's client does not frame a GET body by itself; a real client sends Content-Length.
  const withBody = await probe("get-with-body", "/api/v1/history", { body: "x", headers: { "content-type": "text/plain", "content-length": "1" } });
  expect([withBody.status, gateCode(withBody.body)]).toEqual([400, "body_not_allowed"]);
});

test("F23 · Host header manipulation is refused; query strings cannot change the path or smuggle parameters", async () => {
  for (const host of ["evil.example", "127.0.0.1:8765", "127.0.0.1", "localhost:9999", "127.0.0.1:5183.evil.example"]) {
    const r = await probe("host", "/api/v1/history?limit=1", { headers: { host } });
    expect(r.status, host).toBe(403);
    expect(r.headers.server, host).toBeUndefined();
  }
  const local = await probe("host-localhost", "/api/v1/history?limit=1", { headers: { host: `localhost:${APP}` } });
  expect(local.status).toBe(200);
  for (const [t, status, code] of [
    ["/api/v1/history?x=1", 400, "query_not_allowed"],
    ["/api/v1/history?limit=1&limit=2", 400, "query_not_allowed"],
    [`/api/v1/history/${H}?cursor=abc`, 400, "query_not_allowed"],
    ["/api/v1/verifications/SPEC-001?path=../../docs", 400, "query_not_allowed"],
  ] as const) {
    const r = await probe("query", t);
    expect([r.status, gateCode(r.body)], t).toEqual([status, code]);
  }
  // An allowed key carrying path-like or encoded content stays a value: the Service judges it, the path never changes.
  const cursor = await probe("query-value", "/api/v1/history?limit=1&cursor=..%2F..%2Fdocs");
  expect([cursor.status, cursor.headers.server, JSON.parse(cursor.body).error.code]).toEqual([400, "uvicorn", "invalid_cursor"]);
  const smuggle = await probe("query-value", "/api/v1/history?verification_id=SPEC-005%26limit%3D100");
  expect([smuggle.status, smuggle.headers.server, JSON.parse(smuggle.body).error.code]).toEqual([422, "uvicorn", "invalid_parameter"]);
});

test("F22 F23 · from inside the page: other methods and paths are refused, the browser contacts only the app origin", async ({ page }) => {
  const net = captureNetwork(page);
  await page.goto("/#/local/history");
  await page.locator("tr[data-history-id]").first().waitFor({ timeout: 20_000 });
  const results = await page.evaluate(async (h) => {
    const out: Record<string, { status: number; gate: string | null; server: string | null }> = {};
    const go = async (k: string, url: string, init?: RequestInit) => {
      const r = await fetch(url, { cache: "no-store", ...init });
      await r.text(); // consume the body so the response completes
      out[k] = { status: r.status, gate: r.headers.get("x-flowassert-gate"), server: r.headers.get("server") };
    };
    await go("POST history", "/api/v1/history", { method: "POST", body: "{}" });
    await go("DELETE entry", `/api/v1/history/${h}`, { method: "DELETE" });
    await go("adjacent /api/v1x", "/api/v1x");
    await go("dot docs (browser-normalized)", "/api/v1/../../docs");
    await go("encoded dots", "/api/v1/%2e%2e/%2e%2e/openapi.json");
    // P3A-AUD-001: the browser normalizes an encoded dot-segment ID away before sending (so the frontend never builds
    // one), while a canonical colon ID is sent and routed by the Service unchanged.
    await go("encoded dot-segment ID (browser-normalized)", "/api/v1/verifications/%2E%2E");
    await go("canonical colon ID", "/api/v1/verifications/SPEC%3A006");
    return out;
  }, H);
  expect(results["POST history"]).toMatchObject({ status: 405, gate: "refused", server: null });
  expect(results["DELETE entry"]).toMatchObject({ status: 405, gate: "refused", server: null });
  expect(results["adjacent /api/v1x"]).toMatchObject({ status: 404, gate: "refused", server: null });
  expect(results["dot docs (browser-normalized)"]!.server).toBeNull(); // the browser sent /docs: the app's own page
  expect(results["encoded dots"]!.server).toBeNull();
  expect(results["encoded dot-segment ID (browser-normalized)"]).toMatchObject({ gate: "refused", server: null });
  expect(results["canonical colon ID"]).toMatchObject({ status: 404, gate: null, server: "uvicorn" });
  await net.settle();
  expect(net.all.find((x) => x.url.includes("SPEC%3A006"))?.pathAndQuery).toBe("/api/v1/verifications/SPEC%3A006");
  expect(net.all.some((x) => x.pathAndQuery.includes("%2E%2E"))).toBe(false);
  expect([...net.hosts].filter((x) => x !== "")).toEqual([APP_HOST]);
  probes.push({ label: "browser-context", results });
});

test("F23 · an upstream redirect is neither followed nor passed on (stub upstream on 8765, real Service stopped)", async ({ page, browserName }) => {
  await stopService(service!, `${browserName}:proxy-redirect`);
  service = null;
  const seen: string[] = [];
  const stub = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(302, { location: "http://evil.example/steal", server: "uvicorn" });
    res.end();
  });
  await new Promise<void>((r) => stub.listen(8765, "127.0.0.1", () => r()));
  try {
    const r = await probe("redirect", "/api/v1/history?limit=1");
    expect([r.status, gateCode(r.body)]).toEqual([502, "upstream_redirect_refused"]);
    expect(r.headers.location).toBeUndefined();
    const net = captureNetwork(page);
    await page.goto("/#/local/history");
    await expect(page.locator('[data-access="SERVICE_UNAVAILABLE"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("tr[data-history-id]")).toHaveCount(0);
    await net.settle();
    expect([...net.hosts].filter((x) => x !== "")).toEqual([APP_HOST]); // evil.example was never contacted
    expect(seen.every((x) => x.startsWith("GET /api/v1/history"))).toBe(true);
    probes.push({ label: "redirect-stub-requests", seen });
  } finally {
    await new Promise((r) => stub.close(r));
    service = await startService(`${browserName}:proxy-after-redirect`, "ui-main");
  }
});
