/**
 * ID-addressability remediation-03: the local API gate's two additive exact-ID routes
 * (GET /api/v1/verification-lookup, GET /api/v1/verification-evidence).
 *  1. Pure decision: every target the app builds for the identifier matrix is forwarded unchanged; every
 *     malformed, non-canonical, duplicate, unknown, encoded-name, out-of-bounds, adjacent-prefix, traversal,
 *     method, Host or oversize variant is refused — never repaired.
 *  2. Real loopback sockets: forwarded byte-for-byte to a stub upstream with fixed Host; refusals never reach it;
 *     an upstream redirect is neither followed nor passed on.
 * The real Service and real browsers are covered by e2e-lookup/.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decide, gateMiddleware, MAX_TARGET } from "../../server/localApiGate.ts";
import { lookupEvidenceUrl, lookupUrl } from "../data/local/provider";
import { LAB, MATRIX } from "./local/idMatrix";

const own = ["127.0.0.1:5183", "localhost:5183"];
const d = (rawTarget: string, method = "GET", host = "127.0.0.1:5183", hasBody = false) => decide({ method, rawTarget, host, ownHosts: own, hasBody });
const D = "/api/v1/verification-lookup";
const E = "/api/v1/verification-evidence";

describe("decision table — lookup routes", () => {
  for (const [label, id] of MATRIX) {
    it(`forwards the app's Detail target for ${label}`, () => {
      const t = lookupUrl(id, "snapshot-abc");
      expect(d(t)).toEqual({ forward: true, route: "verification-lookup", target: t });
    });
    it(`forwards the app's Evidence target for ${label}`, () => {
      const t = lookupEvidenceUrl(id, { snapshotId: "snapshot-abc", limit: 1, includePayload: false, cursor: "v2.eyJhIjoxfQ.0f_-" });
      expect(d(t)).toEqual({ forward: true, route: "verification-lookup-evidence", target: t });
    });
  }

  const ALLOWED = [
    `${D}?verification_id=SPEC-005`,
    `${E}?verification_id=SPEC-005`,
    `${E}?limit=100&verification_id=SPEC-005&include_payload=true`,
    `${E}?verification_id=SPEC-005&cursor=`, // empty cursor: the Service answers 400 invalid_cursor itself
    `${E}?verification_id=${"%F0%9F%A7%AA".repeat(128)}&snapshot_id=${"s".repeat(128)}&limit=1&include_payload=true&cursor=${"A".repeat(2048)}`,
  ];
  for (const t of ALLOWED) it(`forwards ${t.slice(0, 80)}`, () => expect(d(t)).toMatchObject({ forward: true, target: t }));

  const REFUSED: [string, number, string, string?][] = [
    [D, 400, "query_not_allowed", "missing verification_id"],
    [`${D}?`, 400, "query_not_allowed", "empty query"],
    [`${D}?snapshot_id=s`, 400, "query_not_allowed", "missing verification_id"],
    [`${D}?verification_id=a&verification_id=b`, 400, "query_not_allowed", "duplicate"],
    [`${D}?verification_id=a&verification%5Fid=b`, 400, "query_not_allowed", "encoded duplicate name"],
    [`${D}?verification%5Fid=a`, 400, "query_not_allowed", "encoded name"],
    [`${D}?verification_id=%ZZ`, 400, "query_not_allowed", "malformed escape"],
    [`${D}?verification_id=a%`, 400, "query_not_allowed", "lone percent"],
    [`${D}?verification_id=%FF`, 400, "query_not_allowed", "invalid UTF-8"],
    [`${D}?verification_id=%C0%AF`, 400, "query_not_allowed", "overlong UTF-8"],
    [`${D}?verification_id=%ED%A0%80`, 400, "query_not_allowed", "encoded surrogate"],
    [`${D}?verification_id=%e4%b8%ad`, 400, "query_not_allowed", "lower-case hex"],
    [`${D}?verification_id=%41`, 400, "query_not_allowed", "needless escape"],
    [`${D}?verification_id=a%20b`, 400, "query_not_allowed", "%20 for space"],
    [`${D}?verification_id=`, 400, "query_not_allowed", "empty ID"],
    [`${D}?verification_id=${"a".repeat(129)}`, 400, "query_not_allowed", "129 code points"],
    [`${D}?verification_id=${"%F0%9F%A7%AA".repeat(129)}`, 400, "query_not_allowed", "129 emoji"],
    [`${D}?verification_id=a&limit=2`, 400, "query_not_allowed", "evidence key on Detail"],
    [`${D}?verification_id=a&evil=1`, 400, "query_not_allowed", "unknown key"],
    [`${D}?verification_id=a&snapshot_id=`, 400, "query_not_allowed", "empty snapshot"],
    [`${D}?verification_id=a&snapshot_id=${"s".repeat(129)}`, 400, "query_not_allowed", "long snapshot"],
    [`${E}?verification_id=a&limit=0`, 400, "query_not_allowed", "limit 0"],
    [`${E}?verification_id=a&limit=101`, 400, "query_not_allowed", "limit 101"],
    [`${E}?verification_id=a&limit=0001`, 400, "query_not_allowed", "limit 4 digits"],
    [`${E}?verification_id=a&limit=%31`, 400, "query_not_allowed", "encoded digit"],
    [`${E}?verification_id=a&include_payload=1`, 400, "query_not_allowed", "payload flag"],
    [`${E}?verification_id=a&include_payload=True`, 400, "query_not_allowed", "payload flag case"],
    [`${E}?verification_id=a&cursor=${"A".repeat(2049)}`, 400, "query_not_allowed", "cursor > 2048"],
    [`${E}?verification_id=a&page=2`, 400, "query_not_allowed", "unknown key"],
    [`${D}?verification_id=a;b`, 400, "query_not_allowed", "raw ; (not the canonical spelling)"],
    [`${D}?verification_id=a#b`, 400, "request_target_refused", "raw fragment"],
    [`${D}/`, 400, "path_refused", "trailing slash"],
    [`${D}/x`, 404, "route_not_allowed", "suffix"],
    [`${D}/..`, 400, "path_refused", "dot segment"],
    [`${D}/../verifications/SPEC-001`, 400, "path_refused", "traversal"],
    [`${D}x?verification_id=a`, 404, "route_not_allowed", "adjacent prefix"],
    [`${E}x?verification_id=a`, 404, "route_not_allowed", "adjacent prefix"],
    [`/api/v1/verification-lookups?verification_id=a`, 404, "route_not_allowed", "adjacent prefix"],
    [`/api/v1/verification%2Dlookup?verification_id=a`, 400, "encoded_path_refused", "encoded path"],
    [`/api/v1/verification-lookup%2Fx?verification_id=a`, 400, "encoded_path_refused", "encoded slash"],
    [`/API/v1/verification-lookup?verification_id=a`, 404, "route_not_allowed", "case"],
    [`/api/v2/verification-lookup?verification_id=a`, 404, "route_not_allowed", "other version"],
    [`/api/v1/id-addressability-openapi.json`, 404, "route_not_allowed", "not a forwarded operation"],
    ["/api/v1/verifications/x%2Fevidence", 400, "encoded_path_refused", "legacy path still refuses a decoded slash"],
    [`${D}?verification_id=${"%F0%9F%A7%AA".repeat(128)}&snapshot_id=${"s".repeat(128)}&x=${"A".repeat(2400)}`, 400, "request_target_refused", "over 4096"],
  ];
  for (const [t, status, code, why] of REFUSED)
    it(`refuses ${why}: ${t.slice(0, 70)}`, () => {
      expect(d(t)).toMatchObject({ forward: false, status, code });
    });

  it("refuses every non-GET method and a foreign Host on the lookup routes", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"]) expect(d(`${D}?verification_id=a`, m)).toMatchObject({ forward: false, status: 405 });
    for (const h of ["evil.example", "127.0.0.1:8765", "localhost", "127.0.0.1", "[::1]:5183"]) expect(d(`${D}?verification_id=a`, "GET", h)).toMatchObject({ forward: false, status: 403 });
    expect(d(`${D}?verification_id=a`, "GET", "127.0.0.1:5183", true)).toMatchObject({ forward: false, code: "body_not_allowed" });
  });

  it("the cap is unchanged: 4096", () => expect(MAX_TARGET).toBe(4096));
});

/* ---------- Real sockets ---------- */

const seen: { method: string; url: string; headers: http.IncomingHttpHeaders }[] = [];
let upstream: http.Server;
let gate: http.Server;
let gatePort = 0;
let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_q, res) => {
  res.writeHead(200, { "content-type": "application/json", "set-cookie": "a=b", "cache-control": "no-store" });
  res.end('{"ok":true}');
};
const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    seen.push({ method: req.method!, url: req.url!, headers: req.headers });
    respond(req, res);
  });
  const mw = gateMiddleware({ host: "127.0.0.1", port: await listen(upstream) });
  gate = http.createServer((req, res) => mw(req, res, () => res.end("app")));
  gatePort = await listen(gate);
});
afterAll(async () => {
  await new Promise((r) => gate.close(r));
  await new Promise((r) => upstream.close(r));
});

function raw(target: string, opts: { method?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: gatePort, method: opts.method ?? "GET", path: target, headers: { host: `127.0.0.1:${gatePort}`, ...opts.headers }, agent: false });
    req.on("response", (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: b }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("lookup routes over real loopback sockets", () => {
  const FORWARD = [lookupUrl("x/evidence"), lookupUrl(".."), lookupUrl("a?b#c", "snapshot-1"), lookupEvidenceUrl(LAB.repeat(128), { snapshotId: "snapshot-1", limit: 1, includePayload: true, cursor: "v2.abc" })];
  for (const t of FORWARD)
    it(`forwards ${t.slice(0, 64)} byte-for-byte with the fixed Host`, async () => {
      seen.length = 0;
      const r = await raw(t, { headers: { cookie: "s=1", authorization: "Bearer x", "x-test-receipt": "t", origin: `http://127.0.0.1:${gatePort}` } });
      expect(r.status).toBe(200);
      expect(seen.map((s) => s.url)).toEqual([t]);
      expect(seen[0]!.headers.host).toBe("127.0.0.1:8765");
      for (const h of ["cookie", "authorization", "x-test-receipt"]) expect(seen[0]!.headers[h], h).toBeUndefined();
      expect(r.headers["set-cookie"]).toBeUndefined();
    });

  for (const t of [`${D}?verification_id=%FF`, `${D}?verification_id=a&verification_id=b`, `${D}/../verifications/SPEC-001`, `${D}x?verification_id=a`, `${E}?verification_id=a&cursor=${"A".repeat(2049)}`, `/api/v1/verification%2Dlookup?verification_id=a`])
    it(`never forwards ${t.slice(0, 64)}`, async () => {
      seen.length = 0;
      const r = await raw(t);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.headers["x-flowassert-gate"]).toBe("refused");
      expect(seen).toEqual([]);
    });

  it("never forwards a non-GET or a spoofed Host", async () => {
    seen.length = 0;
    expect((await raw(`${D}?verification_id=a`, { method: "POST" })).status).toBe(405);
    expect((await raw(`${D}?verification_id=a`, { headers: { host: "evil.example" } })).status).toBe(403);
    expect(seen).toEqual([]);
  });

  it("an upstream redirect is neither followed nor passed on", async () => {
    seen.length = 0;
    respond = (_q, res) => {
      res.writeHead(307, { location: "http://evil.example/x" });
      res.end();
    };
    const r = await raw(lookupUrl("x/evidence"));
    expect(r.status).toBe(502);
    expect(r.headers.location).toBeUndefined();
    expect(JSON.parse(r.body).gate.code).toBe("upstream_redirect_refused");
    expect(seen).toHaveLength(1);
  });
});
