/**
 * ID-addressability remediation-03: exact-ID query addressing (additive contract phase3a-id-addressability-1.0.0).
 *  1. Admission: every frozen-contract-valid ID with a UTF-8 form is admitted unchanged — counted in code points,
 *     never UTF-16 units — and only lone surrogates are untransportable; 0 and 129 code points are invalid.
 *  2. Encoding: the exact targets the backend handoff tabulates (IDENTIFIER_TRANSPORT_MODEL.md), one encoding pass,
 *     and an exact decode back to the original ID (no trim, normalization, "+"→space confusion or double decode).
 *  3. The strict query decoder shared by the router and the gate: malformed / non-UTF-8 / duplicate / unknown /
 *     encoded names refused, never replaced; canonical mode admits exactly one spelling.
 *  4. Router: #/local/verification-lookup?verification_id=… round-trips every matrix ID; "x/evidence", ".", "..",
 *     "a?b#c" stay IDs; malformed addresses are marked, never repaired; existing routes parse as before.
 *  5. Provider ("query" addressing): exact request URLs, the same frozen decoders (identity / snapshot conflicts
 *     refused), structured 400/404/409 outcomes, no fallback to the path routes, cursors forwarded verbatim.
 */
import { describe, expect, it } from "vitest";
import { checkLookupVerificationId, checkVerificationId, decodeStrictQuery, formEncodeValue } from "../data/local/ids";
import { createLocalResearchProvider, lookupEvidenceUrl, lookupUrl } from "../data/local/provider";
import { LOOKUP_PATHS } from "../data/contract/lookup";
import { lookupHref, parseHash } from "../lib/router";
import { captured, json } from "./local/fakeService";
import { lookupService } from "./local/fakeLookupService";
import { BMP128, LAB, MATRIX, NFC, NFD } from "./local/idMatrix";


describe("admission (code points, not UTF-16 units)", () => {
  for (const [label, id] of MATRIX)
    it(`admits ${label} unchanged`, () => {
      const c = checkLookupVerificationId(id);
      expect(c).toEqual({ ok: true, id });
    });

  it("counts 128 emoji as 128 (256 UTF-16 units) and refuses 129 code points of any width", () => {
    expect(LAB.repeat(128).length).toBe(256);
    expect(checkLookupVerificationId(LAB.repeat(128)).ok).toBe(true);
    expect(checkLookupVerificationId(BMP128).ok).toBe(true);
    for (const over of [LAB.repeat(129), "a".repeat(129), BMP128 + "x"]) expect(checkLookupVerificationId(over)).toMatchObject({ ok: false, code: "invalid_verification_id" });
    expect(checkLookupVerificationId("")).toMatchObject({ ok: false, code: "invalid_verification_id" });
  });

  it("refuses lone surrogates as untransportable (URLSearchParams would substitute U+FFFD)", () => {
    for (const bad of ["\ud800", "a\udc00", "\ud83e", "x\ud83ey"]) expect(checkLookupVerificationId(bad)).toMatchObject({ ok: false, code: "verification_id_not_transportable" });
    expect(new URLSearchParams({ v: "\ud800" }).toString()).toBe("v=%EF%BF%BD"); // why the check must come first
  });

  it("keeps NFC and NFD distinct", () => {
    expect(NFC).not.toBe(NFD);
    expect(NFC.normalize("NFC")).toBe(NFD.normalize("NFC"));
    expect(formEncodeValue(NFC)).toBe("%C3%A9");
    expect(formEncodeValue(NFD)).toBe("e%CC%81");
  });

  it("the path addressing is unchanged: dot / slash IDs are still refused there, without a request", () => {
    for (const id of [".", "..", "x/evidence", "a/b"]) expect(checkVerificationId(id)).toMatchObject({ ok: false, code: "verification_id_not_transportable" });
  });
});

describe("exact request targets (backend IDENTIFIER_TRANSPORT_MODEL.md table)", () => {
  const TABLE: [string, string][] = [
    [".", "."],
    ["..", ".."],
    ["x/evidence", "x%2Fevidence"],
    ["customer/001", "customer%2F001"],
    ["SPEC:006", "SPEC%3A006"],
    ["中文", "%E4%B8%AD%E6%96%87"],
    [LAB.repeat(128), "%F0%9F%A7%AA".repeat(128)],
    ["a?b#c", "a%3Fb%23c"],
    ["a+b", "a%2Bb"],
    ["a%2Fb", "a%252Fb"],
  ];
  for (const [id, value] of TABLE)
    it(`${JSON.stringify(id.slice(0, 12))} → verification_id=${value.slice(0, 36)}`, () => {
      expect(lookupUrl(id)).toBe(`${LOOKUP_PATHS.detail}?verification_id=${value}`);
    });

  it("a space is +, a literal + is %2B; both decode back exactly", () => {
    expect(formEncodeValue("a b")).toBe("a+b");
    expect(formEncodeValue("a+b")).toBe("a%2Bb");
  });

  for (const [label, id] of MATRIX)
    it(`${label}: Detail and Evidence targets decode back to the exact ID, once`, () => {
      for (const target of [lookupUrl(id, "snapshot-1"), lookupEvidenceUrl(id, { snapshotId: "snapshot-1", limit: 2, includePayload: true, cursor: "v2.abc_-~" })]) {
        const q = target.slice(target.indexOf("?") + 1);
        const keys = target.startsWith(LOOKUP_PATHS.detail) ? ["verification_id", "snapshot_id"] : ["verification_id", "snapshot_id", "limit", "include_payload", "cursor"];
        const d = decodeStrictQuery(q, keys, true);
        expect(d.ok).toBe(true);
        if (d.ok) expect(d.params.get("verification_id")).toBe(id);
        expect(target.length).toBeLessThanOrEqual(4096);
      }
    });

  it("the evidence target carries exactly the contract keys and the cursor verbatim", () => {
    const cursor = "v2.Zm9v+/=.%41";
    const u = lookupEvidenceUrl("x/evidence", { snapshotId: "snapshot-abc", limit: 1, includePayload: false, cursor });
    expect(u.startsWith(`${LOOKUP_PATHS.evidence}?`)).toBe(true);
    const d = decodeStrictQuery(u.slice(u.indexOf("?") + 1), ["verification_id", "snapshot_id", "limit", "include_payload", "cursor"], true);
    expect(d.ok && [...d.params.entries()]).toEqual([
      ["verification_id", "x/evidence"],
      ["snapshot_id", "snapshot-abc"],
      ["limit", "1"],
      ["include_payload", "false"],
      ["cursor", cursor],
    ]);
  });

  it("the longest admitted ID with a maximal 2048-character cursor stays within the 4096-byte target cap", () => {
    // A worst-case cursor of the backend's alphabet is ASCII; the compact v2 tokens actually issued are ≤ 480.
    const u = lookupEvidenceUrl(LAB.repeat(128), { snapshotId: "s".repeat(128), limit: 100, includePayload: true, cursor: "A".repeat(2048) });
    expect(u.length).toBeLessThanOrEqual(4096);
  });
});

describe("strict query decoder (shared by router and gate)", () => {
  const K = ["verification_id", "snapshot_id"];
  const REFUSED: [string, string][] = [
    ["verification_id=%ZZ", "malformed escape"],
    ["verification_id=%E4%B8", "truncated UTF-8"],
    ["verification_id=%FF", "invalid UTF-8 byte"],
    ["verification_id=%C0%AF", "overlong UTF-8"],
    ["verification_id=%ED%A0%80", "encoded surrogate"],
    ["verification_id=a%", "lone percent"],
    ["verification_id=a&verification_id=b", "duplicate"],
    ["verification%5Fid=a", "encoded name"],
    ["Verification_id=a", "case-variant name"],
    ["verification_id", "no ="],
    ["verification_id=a&", "empty pair"],
    ["&verification_id=a", "empty pair"],
    ["verification_id=a&evil=1", "unknown key"],
    ["verification_id=中", "raw non-ASCII"],
    ["verification_id=a b", "raw space"],
    ["verification_id=a#b", "raw fragment delimiter"],
    ['verification_id="a"', "raw quote"],
  ];
  for (const [q, why] of REFUSED) it(`refuses ${why}: ${q}`, () => expect(decodeStrictQuery(q, K, false).ok).toBe(false));

  it("canonical mode admits exactly the URLSearchParams spelling", () => {
    expect(decodeStrictQuery("verification_id=%41", K, false)).toMatchObject({ ok: true });
    for (const q of ["verification_id=%41", "verification_id=%e4%b8%ad", "verification_id=a%20b", "verification_id=a~b", "verification_id=a!b", "verification_id=a;b"])
      expect(decodeStrictQuery(q, K, true).ok, q).toBe(false);
    for (const q of ["verification_id=A", "verification_id=%E4%B8%AD", "verification_id=a+b", "verification_id=a*b", "verification_id=.", "verification_id=.."])
      expect(decodeStrictQuery(q, K, true).ok, q).toBe(true);
  });

  it("decodes once: %252F stays %2F; + is space; %2B is +", () => {
    const d = decodeStrictQuery("verification_id=a%252Fb&snapshot_id=x+y%2Bz", K, true);
    expect(d.ok && [...d.params.values()]).toEqual(["a%2Fb", "x y+z"]);
  });
});

describe("router: #/local/verification-lookup", () => {
  for (const [label, id] of MATRIX)
    it(`${label}: lookupHref → parse is the exact ID`, () => {
      const h = lookupHref(id);
      expect(h.startsWith("#/local/verification-lookup?verification_id=")).toBe(true);
      const loc = parseHash(h);
      expect(loc.route).toEqual({ name: "local-lookup", id });
    });

  it("keeps selection params next to the ID", () => {
    const loc = parseHash(lookupHref("x/evidence", { state: "Verified", record: "row-1" }));
    expect(loc.route).toEqual({ name: "local-lookup", id: "x/evidence" });
    expect(loc.params.get("state")).toBe("Verified");
    expect(loc.params.get("record")).toBe("row-1");
  });

  it("x/evidence is never the evidence route of x; dots are never path segments", () => {
    expect(parseHash("#/local/verification-lookup?verification_id=x%2Fevidence").route).toEqual({ name: "local-lookup", id: "x/evidence" });
    expect(parseHash("#/local/verification-lookup?verification_id=.").route).toEqual({ name: "local-lookup", id: "." });
    expect(parseHash("#/local/verification-lookup?verification_id=..").route).toEqual({ name: "local-lookup", id: ".." });
  });

  it("a raw ? after the first one is query data, not lost", () => {
    expect(parseHash("#/local/verification-lookup?verification_id=a?b").route).toEqual({ name: "local-lookup", id: "a?b" });
  });

  it("decodes a direct link leniently in spelling but strictly in meaning (any valid form encoding, once)", () => {
    expect(parseHash("#/local/verification-lookup?verification_id=%e4%b8%ad%e6%96%87").route).toEqual({ name: "local-lookup", id: "中文" });
    expect(parseHash("#/local/verification-lookup?verification_id=a%20b").route).toEqual({ name: "local-lookup", id: "a b" });
  });

  const MALFORMED = [
    "#/local/verification-lookup",
    "#/local/verification-lookup?",
    "#/local/verification-lookup?verification_id=%FF",
    "#/local/verification-lookup?verification_id=%ZZ",
    "#/local/verification-lookup?verification_id=a&verification_id=b",
    "#/local/verification-lookup?id=SPEC-001",
    "#/local/verification-lookup?verification_id=SPEC-001&evil=1",
  ];
  for (const h of MALFORMED)
    it(`marks ${h.slice(28) || "(no query)"} malformed`, () => {
      const r = parseHash(h).route;
      expect(r.name).toBe("local-lookup");
      expect(r.name === "local-lookup" && typeof r.malformed).toBe("string");
    });

  it("existing routes parse as before", () => {
    expect(parseHash("#/local/verifications/SPEC-001").route).toEqual({ name: "local-verification", id: "SPEC-001" });
    expect(parseHash("#/local/verifications/x%2Fevidence").route).toEqual({ name: "local-verification", id: "x/evidence" });
    expect(parseHash("#/local/verifications/100%").route).toEqual({ name: "local-verification", id: "100%", malformed: true });
    expect(parseHash("#/demo/verifications/VR-2025?record=r1").route).toEqual({ name: "demo-verification", id: "VR-2025" });
    expect(parseHash("#/demo/verifications/VR-2025?record=r1").params.get("record")).toBe("r1");
    // Product round 01: the workspace pages are LOCAL_RESEARCH; the MOCK demo moved under #/demo.
    expect(parseHash("#/").route).toEqual({ name: "workspace" });
    expect(parseHash("#/verifications").route).toEqual({ name: "local-verifications" });
    expect(parseHash("#/local/verifications").route).toEqual({ name: "local-verifications" });
    expect(parseHash("#/capture").route).toEqual({ name: "capture" });
    expect(parseHash("#/demo").route).toEqual({ name: "demo-overview" });
    expect(parseHash("#/demo/verifications").route).toEqual({ name: "demo-verifications" });
    expect(parseHash("#/verifications/VR-2025").route).toEqual({ name: "not-found" });
    expect(parseHash("#/local/verification-lookup/x").route).toEqual({ name: "not-found" });
    expect(parseHash("#/local/history?case=SPEC-005").route).toEqual({ name: "local-history" });
  });
});

/* ---------- Provider, query addressing ---------- */


describe("LOCAL_RESEARCH provider with query addressing", () => {
  const aliases = { "x/evidence": "SPEC-005", x: "SPEC-002", ".": "SPEC-001", "..": "SPEC-002", [NFC]: "SPEC-002", [NFD]: "SPEC-003", [LAB.repeat(128)]: "SPEC-001", "a%2Fb": "SPEC-004", "a/b": "SPEC-001" };

  it("reads x/evidence by exact ID: the SPEC-005 alias, never the evidence of x", async () => {
    const svc = lookupService(aliases);
    const p = createLocalResearchProvider({ fetch: svc.fetch, addressing: "query" });
    const r = await p.getVerification("x/evidence");
    expect(svc.log).toEqual(["/api/v1/verification-lookup?verification_id=x%2Fevidence"]);
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.data.id).toBe("x/evidence");
    expect(r.data.records).toHaveLength(12);
    expect(r.data.records.every((x) => x.state === "Verified")).toBe(true);
    expect(r.data.state).toBe("Unverified"); // SPEC-005: 12 record-level Verified, cohort Unverified
    expect(r.data.populationKnown).toBe(false); // population Unknown
    expect(r.data.expectedTotal).toBeNull(); // never 12 as an expected total
  });

  it("follows the evidence chain with the same ID, snapshot, limit and payload, cursors verbatim", async () => {
    const svc = lookupService(aliases);
    const p = createLocalResearchProvider({ fetch: svc.fetch, addressing: "query" });
    const d = await p.getVerification("..");
    if (d.kind !== "ready") throw new Error(d.kind);
    let cursor: string | undefined;
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const page = await p.getEvidence("..", { snapshotId: d.context.snapshotId!, limit: 2, includePayload: true, cursor });
      if (page.kind !== "ready") throw new Error(page.kind);
      ids.push(...page.data.items.map((x) => x.id));
      expect(page.data.snapshotId).toBe(d.context.snapshotId);
      if (page.data.nextCursor === null) break;
      cursor = page.data.nextCursor;
    }
    expect(ids).toEqual(d.data.local!.evidenceReferences.map((x) => x.id));
    for (const u of svc.log.slice(1)) {
      expect(u.startsWith("/api/v1/verification-evidence?verification_id=..&snapshot_id=")).toBe(true);
      expect(u).toContain("&limit=2&include_payload=true");
    }
    expect(svc.log.slice(2).every((u) => u.includes("&cursor="))).toBe(true);
  });

  it("refuses an identity substitution (NFD answered for NFC) instead of showing it", async () => {
    const svc = lookupService(aliases);
    const p = createLocalResearchProvider({
      addressing: "query",
      fetch: (async (u: string, i?: RequestInit) => {
        const r = await svc.fetch(u.replace("verification_id=%C3%A9", "verification_id=e%CC%81"), i);
        return r;
      }) as typeof fetch,
    });
    const r = await p.getVerification(NFC);
    expect(r).toMatchObject({ kind: "error", code: "identity_conflict" });
  });

  it("keeps a%2Fb and a/b distinct", async () => {
    const svc = lookupService(aliases);
    const p = createLocalResearchProvider({ fetch: svc.fetch, addressing: "query" });
    const a = await p.getVerification("a%2Fb");
    const b = await p.getVerification("a/b");
    expect(svc.log).toEqual(["/api/v1/verification-lookup?verification_id=a%252Fb", "/api/v1/verification-lookup?verification_id=a%2Fb"]);
    expect(a.kind === "ready" && a.data.state).toBe("Unverified"); // SPEC-004 basis
    expect(b.kind === "ready" && b.data.state).toBe("Verified"); // SPEC-001 basis
  });

  it("an unknown representable ID is not_found; a refused ID sends nothing", async () => {
    const svc = lookupService(aliases);
    const p = createLocalResearchProvider({ fetch: svc.fetch, addressing: "query" });
    expect(await p.getVerification("SPEC-404")).toMatchObject({ kind: "not_found" });
    expect(await p.getVerification("\ud800")).toMatchObject({ kind: "error", code: "verification_id_not_transportable" });
    expect(await p.getVerification(LAB.repeat(129))).toMatchObject({ kind: "error", code: "invalid_verification_id" });
    expect(svc.log).toEqual(["/api/v1/verification-lookup?verification_id=SPEC-404"]);
  });

  const envelope = (code: string, status: number) => json({ error: { code, message: "m", request_id: `req-${code}`, retryable: status === 503, details: [] } }, status);
  for (const [status, code] of [
    [400, "invalid_cursor"],
    [400, "cursor_query_conflict"],
    [400, "invalid_query"],
    [409, "snapshot_unavailable"],
    [409, "snapshot_conflict"],
    [414, "request_target_too_long"],
    [422, "invalid_parameter"],
    [503, "evidence_unavailable"],
  ] as const)
    it(`evidence ${status} ${code} is a structured error with the Service's code — no retry, no fallback, no verdict`, async () => {
      const log: string[] = [];
      const p = createLocalResearchProvider({
        addressing: "query",
        fetch: (async (u: string) => {
          log.push(u);
          return envelope(code, status);
        }) as typeof fetch,
      });
      const r = await p.getEvidence("x/evidence", { snapshotId: "snapshot-1", limit: 2, includePayload: true, cursor: "tampered" });
      expect(r).toMatchObject({ kind: "error", code });
      expect(log).toEqual(["/api/v1/verification-evidence?verification_id=x%2Fevidence&snapshot_id=snapshot-1&limit=2&include_payload=true&cursor=tampered"]);
    });

  it("a Service that lacks the query routes (Phase 1 run.py) is unavailable — never retried through the path routes", async () => {
    const log: string[] = [];
    const p = createLocalResearchProvider({
      addressing: "query",
      fetch: (async (u: string) => {
        log.push(u);
        return json({ detail: "Not Found" }, 404);
      }) as typeof fetch,
    });
    expect(await p.getVerification("SPEC-001")).toMatchObject({ kind: "error", access: "SERVICE_UNAVAILABLE", code: "no_service_envelope" });
    expect(log).toEqual(["/api/v1/verification-lookup?verification_id=SPEC-001"]);
  });

  it("the default provider still uses the frozen path routes", async () => {
    const log: string[] = [];
    const p = createLocalResearchProvider({
      fetch: (async (u: string) => {
        log.push(u);
        return json(captured("invalid-id"), 404);
      }) as typeof fetch,
    });
    await p.getVerification("SPEC:006");
    expect(log).toEqual(["/api/v1/verifications/SPEC%3A006"]);
  });
});
