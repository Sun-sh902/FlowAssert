/**
 * Phase 3A · P2-AUD-004: the local API gate (server/localApiGate.ts); P3A-AUD-001: contract-valid
 * Verification IDs in their one canonical segment are forwarded unchanged, every other spelling refused.
 *  1. The pure decision for exact paths, adjacent prefixes, dot segments (raw and encoded), /docs and
 *     /openapi.json, every non-GET method, Host manipulation and query boundaries.
 *  2. Real loopback sockets: the gate in front of a stub upstream that records what arrives, so
 *     forwarding is proven byte-for-byte, refusals are proven never to reach the upstream, headers are
 *     proven filtered, and an upstream redirect is proven neither followed nor passed on.
 * The real Service and real browsers are covered by e2e-history/ (proxy-security.spec.ts).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decide, gateMiddleware, isGated, ROUTES } from "../../server/localApiGate.ts";

const H = `hist_${"ab".repeat(32)}`;
const own = ["127.0.0.1:5183", "localhost:5183"];
const d = (rawTarget: string, method = "GET", host = "127.0.0.1:5183", hasBody = false) => decide({ method, rawTarget, host, ownHosts: own, hasBody });

describe("decision table", () => {
  const ALLOWED = [
    "/api/v1/verifications/SPEC-001",
    "/api/v1/verifications/SPEC-001?snapshot_id=snapshot-abc",
    "/api/v1/verifications/SPEC-001/evidence?snapshot_id=s&limit=2&include_payload=true&cursor=abc.def",
    "/api/v1/history",
    "/api/v1/history?limit=4",
    "/api/v1/history?limit=4&verification_id=SPEC-005&cursor=eyJ.0f",
    `/api/v1/history/${H}`,
    `/api/v1/history/${H}?snapshot_id=history-snapshot_x`,
    `/api/v1/history/${H}/evidence?snapshot_id=x&limit=2&include_payload=false&cursor=y`,
    // P3A-AUD-001: contract-valid Verification IDs in their one canonical segment (src/data/local/ids.ts encodeIdSegment).
    "/api/v1/verifications/SPEC%3A006",
    "/api/v1/verifications/%E4%B8%AD%E6%96%87",
    "/api/v1/verifications/%F0%9F%A7%AA",
    "/api/v1/verifications/SPEC%20006",
    "/api/v1/verifications/SPEC%40006",
    "/api/v1/verifications/SPEC%2B006",
    "/api/v1/verifications/SPEC%5C001",
    "/api/v1/verifications/%252E%252E",
    "/api/v1/verifications/100%25",
    "/api/v1/verifications/a%3Fb%3D1%23c",
    "/api/v1/verifications/SPEC%27%28%2A%29%21",
    "/api/v1/verifications/SPEC%00",
    "/api/v1/verifications/...",
    "/api/v1/verifications/evidence",
    `/api/v1/verifications/${"%F0%9F%A7%AA".repeat(128)}`,
    "/api/v1/verifications/SPEC%3A006?snapshot_id=snapshot-abc",
    "/api/v1/verifications/%E4%B8%AD%E6%96%87/evidence?snapshot_id=s&limit=2&include_payload=true&cursor=abc.def",
  ];
  for (const t of ALLOWED) it(`forwards GET ${t.slice(0, 70)}`, () => expect(d(t)).toEqual({ forward: true, route: expect.any(String), target: t }));

  const REFUSED: [string, number, string][] = [
    ["/api/v1x", 404, "route_not_allowed"],
    ["/api/v1xyz/verifications/SPEC-001", 404, "route_not_allowed"],
    ["/api/v2/history", 404, "route_not_allowed"],
    ["/API/v1/history", 404, "route_not_allowed"],
    ["/api/v1", 404, "route_not_allowed"],
    ["/api/v1/", 400, "path_refused"],
    ["/api/v1/verifications", 404, "route_not_allowed"],
    ["/api/v1/verifications/", 400, "path_refused"],
    ["/api/v1/overview", 404, "route_not_allowed"],
    ["/api/v1/workflows", 404, "route_not_allowed"],
    ["/api/v1/historyx", 404, "route_not_allowed"],
    ["/api/v1/history/", 400, "path_refused"],
    ["/api/v1/history/x/y/z", 404, "route_not_allowed"],
    [`/api/v1/history/${H}/evidence/x`, 404, "route_not_allowed"],
    [`/api/v1/history/${H.toUpperCase()}`, 404, "route_not_allowed"],
    ["/api/v1/../../docs", 400, "path_refused"],
    ["/api/v1/../../openapi.json", 400, "path_refused"],
    ["/api/v1/../../history-openapi.json", 400, "path_refused"],
    ["/api/v1/verifications/..", 400, "path_refused"],
    ["/api/v1/verifications/.", 400, "path_refused"],
    ["/api/v1/history/../verifications/SPEC-001", 400, "path_refused"],
    ["/api/v1/verifications/%2E%2E", 400, "encoded_path_refused"],
    ["/api/v1/verifications/%2e%2e/%2e%2e/docs", 400, "encoded_path_refused"],
    ["/api/v1/verifications/SPEC-001%2Fevidence", 400, "encoded_path_refused"],
    ["/api/v1/verifications/SPEC-001%3Fx=1", 400, "encoded_path_refused"],
    ["/api/v1/verifications/%E0%A4%A", 400, "encoded_path_refused"],
    // P3A-AUD-001: an ID segment that is not exactly the canonical encoding of an admitted, transportable ID.
    ["/api/v1/verifications/%2E", 400, "encoded_path_refused"],
    ["/api/v1/verifications/%2e%2e", 400, "encoded_path_refused"],
    ["/api/v1/verifications/.%2E", 400, "encoded_path_refused"],
    ["/api/v1/verifications/%2E%2E/evidence", 400, "encoded_path_refused"],
    ["/api/v1/verifications/x%2Fevidence", 400, "encoded_path_refused"],
    ["/api/v1/verifications/SPEC-001%2F..%2F..%2Fdocs", 400, "encoded_path_refused"],
    ["/api/v1/verifications/SPEC:006", 400, "encoded_path_refused"],
    ["/api/v1/verifications/SPEC@006", 400, "encoded_path_refused"],
    ["/api/v1/verifications/SPEC%3a006", 400, "encoded_path_refused"],
    ["/api/v1/verifications/%41", 400, "encoded_path_refused"],
    ["/api/v1/verifications/SPEC%2D001", 400, "encoded_path_refused"],
    ["/api/v1/verifications/\u4e2d", 400, "encoded_path_refused"],
    ["/api/v1/verifications/%ED%A0%80", 400, "encoded_path_refused"],
    ["/api/v1/verifications/%C0%AF", 400, "encoded_path_refused"],
    ["/api/v1/verifications/%", 400, "encoded_path_refused"],
    ["/api/v1/verifications/%zz", 400, "encoded_path_refused"],
    [`/api/v1/verifications/${"A".repeat(129)}`, 400, "encoded_path_refused"],
    [`/api/v1/verifications/${"%F0%9F%A7%AA".repeat(129)}`, 400, "encoded_path_refused"],
    ["/api/v1/verificationsx/SPEC%3A006", 400, "encoded_path_refused"],
    ["/api/v1/verifications/SPEC%3A006/evidence/x", 400, "encoded_path_refused"],
    ["/api/v1/verifications/SPEC%3A006?evil=1", 400, "query_not_allowed"],
    ["/api/v1/history/%2e%2e", 400, "encoded_path_refused"],
    [`/api/v1/history/hist_%61${"a".repeat(63)}`, 400, "encoded_path_refused"],
    ["/api/v1/hist%6Fry", 400, "encoded_path_refused"],
    ["/api/v1/verifications/SPEC\\001", 400, "path_refused"],
    ["/api//v1/history", 400, "path_refused"],
    ["/api/v1/history?limit=4&limit=5", 400, "query_not_allowed"],
    ["/api/v1/history?snapshot_id=x", 400, "query_not_allowed"],
    ["/api/v1/history?limit", 400, "query_not_allowed"],
    ["/api/v1/history?LIMIT=4", 400, "query_not_allowed"],
    ["/api/v1/history?%6Cimit=4", 400, "query_not_allowed"],
    [`/api/v1/history/${H}?cursor=x`, 400, "query_not_allowed"],
    ["/api/v1/verifications/SPEC-001?path=../../docs", 400, "query_not_allowed"],
    ["/api/v1/history#frag", 400, "request_target_refused"],
    [`/api/v1/history?cursor=${"a".repeat(4100)}`, 400, "request_target_refused"],
  ];
  for (const [t, status, code] of REFUSED) it(`refuses ${t.slice(0, 60)} → ${status} ${code}`, () => expect(d(t)).toMatchObject({ forward: false, status, code }));

  for (const m of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT", undefined])
    it(`refuses method ${m} with 405`, () =>
      expect(decide({ method: m, rawTarget: "/api/v1/history", host: "127.0.0.1:5183", ownHosts: own, hasBody: false })).toMatchObject({ forward: false, status: 405, code: "method_not_allowed" }));

  for (const host of ["evil.example", "127.0.0.1:8765", "127.0.0.1", "127.0.0.1:5183.evil.example", "localhost:9999", "", undefined])
    it(`refuses Host ${JSON.stringify(host)} with 403`, () => expect(decide({ method: "GET", rawTarget: "/api/v1/history", host, ownHosts: own, hasBody: false })).toMatchObject({ forward: false, status: 403 }));

  it("refuses a GET with a body", () => expect(d("/api/v1/history", "GET", "127.0.0.1:5183", true)).toMatchObject({ status: 400, code: "body_not_allowed" }));

  it("owns every /api… path and nothing else", () => {
    for (const t of ["/api", "/api/", "/apix", "/API/v1", "/api/v1/docs"]) expect(isGated(t), t).toBe(true);
    for (const t of ["/", "/docs", "/openapi.json", "/history-openapi.json", "/index.html", "/assets/x.js", "/%61pi/v1/history", "http://127.0.0.1:8765/docs", undefined]) expect(isGated(t), String(t)).toBe(false);
  });

  // ID-addressability remediation-03: the Owner-authorized allowlist is the five accepted operations plus exactly the
  // two additive exact-ID lookup operations (still an exact list; see src/test/lookup-gate.test.ts).
  it("forwards exactly the seven documented operations", () =>
    expect(ROUTES.map((r) => r.name)).toEqual(["verification", "verification-evidence", "history-list", "history-detail", "history-evidence", "verification-lookup", "verification-lookup-evidence"]));
});

/* ---------- Real sockets: gate + stub upstream ---------- */

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
}

let upstream: http.Server;
let gate: http.Server;
let gatePort = 0;
const seen: Seen[] = [];
let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_req, res) => {
  res.writeHead(200, { "content-type": "application/json", server: "uvicorn", "set-cookie": "a=b", "x-secret": "no", "cache-control": "no-store" });
  res.end('{"ok":true}');
};

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    seen.push({ method: req.method!, url: req.url!, headers: req.headers });
    respond(req, res);
  });
  const upPort = await listen(upstream);
  const mw = gateMiddleware({ host: "127.0.0.1", port: upPort });
  gate = http.createServer((req, res) => mw(req, res, () => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>app</title>");
  }));
  gatePort = await listen(gate);
});
afterAll(async () => {
  await new Promise((r) => gate.close(r));
  await new Promise((r) => upstream.close(r));
});

/** A raw request: exact target bytes, chosen method and headers — like curl --path-as-is, not a browser. */
function raw(target: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: gatePort, method: opts.method ?? "GET", path: target, headers: { host: `127.0.0.1:${gatePort}`, ...opts.headers }, agent: false });
    req.on("response", (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: b }));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe("over real loopback sockets", () => {
  it("forwards an allowed GET byte-for-byte, with only Accept, fixed Host and Origin", async () => {
    seen.length = 0;
    const target = `/api/v1/history/${H}/evidence?snapshot_id=history-snapshot_${"ab".repeat(32)}&limit=2&include_payload=true&cursor=eyJh.0f`;
    const r = await raw(target, { headers: { accept: "application/json", origin: `http://127.0.0.1:${gatePort}`, cookie: "session=1", authorization: "Bearer x", referer: "http://x/" } });
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(target);
    expect(seen[0]!.method).toBe("GET");
    expect(seen[0]!.headers.host).toBe("127.0.0.1:8765");
    expect(seen[0]!.headers.origin).toBe(`http://127.0.0.1:${gatePort}`);
    for (const h of ["cookie", "authorization", "referer"]) expect(seen[0]!.headers[h], h).toBeUndefined();
    // Response headers are filtered: no cookie, no unknown header; server/content-type/cache-control pass.
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect(r.headers["x-secret"]).toBeUndefined();
    expect(r.headers.server).toBe("uvicorn");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.body).toBe('{"ok":true}');
  });

  for (const target of ["/api/v1/verifications/SPEC%3A006", "/api/v1/verifications/%E4%B8%AD%E6%96%87/evidence?limit=2&include_payload=true", "/api/v1/verifications/SPEC%5C001", "/api/v1/verifications/%252E%252E"])
    it(`forwards the contract-valid ID target ${target} unchanged (P3A-AUD-001)`, async () => {
      seen.length = 0;
      const r = await raw(target);
      expect(r.status).toBe(200);
      expect(seen.map((x) => x.url)).toEqual([target]);
    });

  for (const target of ["/api/v1/../../docs", "/api/v1/../../openapi.json", "/api/v1/%2e%2e/%2e%2e/docs", "/api/v1x", "/api/v1/history/x/y", "/API/v1/history", "/api/v1/verifications/SPEC-001?evil=1", "/api/v1/verifications/%2E%2E", "/api/v1/verifications/x%2Fevidence", "/api/v1/verifications/SPEC%3a006"])
    it(`never forwards ${target}`, async () => {
      seen.length = 0;
      const r = await raw(target);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(JSON.parse(r.body).gate.code).toBeTruthy();
      expect(r.headers["x-flowassert-gate"]).toBe("refused");
      expect(seen).toEqual([]);
    });

  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    it(`never forwards ${method}`, async () => {
      seen.length = 0;
      const r = await raw("/api/v1/history", { method, body: method === "OPTIONS" ? undefined : "{}", headers: method === "OPTIONS" ? {} : { "content-type": "application/json" } });
      expect(r.status).toBe(405);
      expect(r.headers.allow).toBe("GET");
      expect(seen).toEqual([]);
    });

  it("refuses a spoofed Host and never forwards it", async () => {
    seen.length = 0;
    const r = await raw("/api/v1/history", { headers: { host: "evil.example" } });
    expect(r.status).toBe(403);
    expect(seen).toEqual([]);
  });

  it("does not own /docs or /openapi.json: they are the app's own (static) traffic, never the Service's", async () => {
    seen.length = 0;
    for (const t of ["/docs", "/openapi.json", "/history-openapi.json"]) {
      const r = await raw(t);
      expect(r.body).toContain("<title>app</title>");
    }
    expect(seen).toEqual([]);
  });

  it("an upstream redirect is neither followed nor passed on", async () => {
    seen.length = 0;
    respond = (_req, res) => {
      res.writeHead(302, { location: "http://evil.example/steal", server: "uvicorn" });
      res.end();
    };
    const r = await raw("/api/v1/history");
    expect(r.status).toBe(502);
    expect(r.headers.location).toBeUndefined();
    expect(JSON.parse(r.body).gate.code).toBe("upstream_redirect_refused");
    expect(seen).toHaveLength(1); // the one forwarded GET; nothing followed it
  });

  it("an unreachable Service is a 502 gate answer, not a FlowAssert Error envelope", async () => {
    const mw = gateMiddleware({ host: "127.0.0.1", port: 9 });
    const s = http.createServer((req, res) => mw(req, res, () => res.end()));
    const port = await listen(s);
    const r = await new Promise<{ status: number; body: string }>((resolve) => {
      http.get({ host: "127.0.0.1", port, path: "/api/v1/history", headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode!, body: b }));
      });
    });
    await new Promise((x) => s.close(x));
    expect(r.status).toBe(502);
    expect(JSON.parse(r.body)).toEqual({ gate: { code: "service_unreachable", reason: expect.any(String) } });
    expect(JSON.parse(r.body).error).toBeUndefined();
  });
});
