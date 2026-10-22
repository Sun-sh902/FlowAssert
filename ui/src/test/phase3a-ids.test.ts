/**
 * Phase 3A · P2-AUD-003, corrected by P3A-AUD-001: route identifiers are judged BEFORE any request URL
 * exists, against the frozen contract's own language (path `id`: string, 1–128 code points, no pattern).
 *  - contract-valid IDs are admitted unchanged, including every counterexample of the independent audit
 *    (FlowAssert-Phase3A-Review/FINDINGS.md P3A-AUD-001) and the entries of the earlier hostile list that
 *    the contract in fact permits (marked "was refused");
 *  - "." / ".." / "/" / lone surrogates are contract-valid but cannot be carried by one path segment:
 *    refused as verification_id_not_transportable (the audit's own ".", "..", %2E%2E stay refused);
 *  - empty and over-long IDs are outside the contract: invalid_verification_id.
 */
import { describe, expect, it } from "vitest";
import { checkHistoryId, checkVerificationId, encodeIdSegment, verificationIdFromSegment } from "../data/local/ids";
import { createLocalResearchProvider } from "../data/local/provider";
import { createLocalHistoryProvider } from "../data/history/provider";
import { decodeSegment, tryDecodeSegment } from "../lib/router";

const HIST = `hist_${"0123456789abcdef".repeat(4)}`;
const LAB = "\u{1F9EA}";

/** What the router hands a page for a given address (decoded once, never throwing). */
const fromAddress = (segment: string) => decodeSegment(segment);

/** Contract-valid, transportable IDs. */
const VALID: [string, string][] = [
  ...["SPEC-001", "SPEC-002", "SPEC-003", "SPEC-004", "SPEC-005", "SPEC-404", "a", "A".repeat(128), "v1.2_x~y", "...", ".a", "a..b"].map((id): [string, string] => [id, "reviewed / unreserved"]),
  ...["SPEC:006", "中文", LAB, "SPEC 006", "SPEC@006", "SPEC+006"].map((id): [string, string] => [id, "independent audit counterexample"]),
  ["SPEC:001", "audit alias (HTTP 200 on the unmodified backend)"],
  ["SPEC 001", "audit alias (HTTP 200 on the unmodified backend)"],
  [fromAddress("%252E%252E"), "was refused: literal \"%2E%2E\", decoded once by every hop"],
  ["SPEC\\001", "was refused: backslash is data, not a separator, inside an encoded segment"],
  [fromAddress("SPEC%5C001"), "was refused"],
  [fromAddress("SPEC%00"), "was refused: control characters are contract-valid"],
  [fromAddress("SPEC%0A001"), "was refused"],
  [fromAddress("SPEC%7F"), "was refused"],
  [fromAddress("SPEC%C2%85"), "was refused"],
  ["SPEC?x=1", "was refused: '?' is encoded as %3F"],
  ["SPEC#x", "was refused: '#' is encoded as %23"],
  ["SPEC-é", "was refused"],
  ["@evil.example", "was refused: '@' is encoded, cannot become userinfo in a path"],
  ["%", "was refused: a literal percent sign travels as %25"],
  ["%zz", "was refused: literal text, travels as %25zz"],
  ["%E0%A4%A", "was refused: literal text"],
  [" ", "whitespace-only, not trimmed"],
  [" lead", "leading space kept"],
  ["trail ", "trailing space kept"],
  ["SPEC'(*)!", "sub-delimiters"],
  ["Ünïcödé-ß", "not normalized or case-folded"],
  ["e\u0301", "decomposed form kept as written (no NFC)"],
  [LAB.repeat(128), "128 code points (256 UTF-16 units)"],
  ["\ud83e\uddea", "a well-formed surrogate PAIR is one code point"],
];

const NOT_TRANSPORTABLE: [string, string][] = [
  [".", "dot segment"],
  ["..", "dot segment"],
  [fromAddress("%2E"), "dot segment"],
  [fromAddress("%2E%2E"), "dot segment"],
  [fromAddress("%2e%2E"), "dot segment"],
  ["SPEC/001", "\"/\""],
  [fromAddress("SPEC%2F001"), "\"/\""],
  [fromAddress("..%2F..%2Fdocs"), "\"/\""],
  ["x/evidence", "\"/\""],
  ["//evil.example", "\"/\""],
  ["http://evil.example", "\"/\""],
  ["\ud800", "unpaired UTF-16 surrogate"],
  ["\udc00", "unpaired UTF-16 surrogate"],
  ["a\ud800b", "unpaired UTF-16 surrogate"],
  ["\udc00\ud800", "unpaired UTF-16 surrogate"],
];

const INVALID: [string, string][] = [
  ["", "empty"],
  ["A".repeat(129), "at most 128"],
  [LAB.repeat(129), "at most 128"],
];

/** The previous hostile list, kept for the history-ID checks (whose language is unchanged). */
const HOSTILE = [
  ".", "..", fromAddress("%2E"), fromAddress("%2E%2E"), fromAddress("%252E%252E"), "SPEC/001", fromAddress("SPEC%2F001"), fromAddress("..%2F..%2Fdocs"),
  "SPEC\\001", fromAddress("%E0%A4%A"), "%", fromAddress("SPEC%00"), fromAddress("SPEC%0A001"), "", "SPEC 001", "SPEC?x=1", "SPEC#x", "\ud800", "A".repeat(129), "SPEC-é", "//evil.example", "@evil.example",
];

const label = (id: string) => JSON.stringify([...id].length > 20 ? `${id.slice(0, 8)}…(${[...id].length})` : id);

describe("verification IDs: the frozen contract language (1–128 code points, no pattern)", () => {
  for (const [id, why] of VALID)
    it(`accepts ${label(id)} unchanged (${why})`, () => {
      expect(checkVerificationId(id)).toEqual({ ok: true, id });
    });
  for (const [id, why] of NOT_TRANSPORTABLE)
    it(`refuses ${label(id)} as not transportable (${why})`, () => {
      const r = checkVerificationId(id);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("verification_id_not_transportable");
        expect(r.reason).toContain(why);
      }
    });
  for (const [id, why] of INVALID)
    it(`refuses ${label(id)} as outside the contract (${why})`, () => {
      const r = checkVerificationId(id);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("invalid_verification_id");
        expect(r.reason).toContain(why);
      }
    });
});

describe("canonical single-segment encoding (client) and its exact inverse (gate)", () => {
  it("encodes RFC 3986 unreserved as written and every other UTF-8 byte as uppercase %XX", () => {
    expect(encodeIdSegment("SPEC-001")).toBe("SPEC-001");
    expect(encodeIdSegment("v1.2_x~y")).toBe("v1.2_x~y");
    expect(encodeIdSegment("SPEC:006")).toBe("SPEC%3A006");
    expect(encodeIdSegment("中文")).toBe("%E4%B8%AD%E6%96%87");
    expect(encodeIdSegment(LAB)).toBe("%F0%9F%A7%AA");
    expect(encodeIdSegment("SPEC 006")).toBe("SPEC%20006");
    expect(encodeIdSegment("SPEC'(*)!")).toBe("SPEC%27%28%2A%29%21");
    expect(encodeIdSegment("100%")).toBe("100%25");
    expect(encodeIdSegment("%2E%2E")).toBe("%252E%252E");
    expect(encodeIdSegment("SPEC\\001")).toBe("SPEC%5C001");
    expect(encodeIdSegment("a?b=1#c")).toBe("a%3Fb%3D1%23c");
  });
  for (const [id] of VALID)
    it(`${label(id)}: segment decodes exactly once back to the same ID, and the gate reads the same ID`, () => {
      const seg = encodeIdSegment(id);
      expect(seg).toMatch(/^(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$/);
      expect(decodeURIComponent(seg)).toBe(id);
      expect(verificationIdFromSegment(seg)).toEqual({ ok: true, id });
      // WHATWG URL parsing (what fetch does) leaves the segment byte-for-byte unchanged.
      expect(new URL(`/api/v1/verifications/${seg}`, "http://127.0.0.1:5183").pathname).toBe(`/api/v1/verifications/${seg}`);
    });
  const NON_CANONICAL: [string, string][] = [
    ["SPEC:006", "raw reserved character"],
    ["SPEC@006", "raw reserved character"],
    ["SPEC%3a006", "lower-case hex"],
    ["%41", "needless escape of an unreserved character"],
    ["SPEC%2D001", "needless escape of an unreserved character"],
    ["\u4e2d", "raw non-ASCII"],
    ["SPEC\\001", "raw backslash"],
    ["%", "lone percent"],
    ["%zz", "bad hex"],
    ["%E0%A4%A", "truncated escape"],
    ["%ED%A0%80", "UTF-8 of a surrogate"],
    ["%C0%AF", "overlong UTF-8"],
    ["%FF", "invalid UTF-8"],
    ["%2E", "decodes to a dot segment"],
    ["%2E%2E", "decodes to a dot segment"],
    [".%2E", "decodes to a dot segment"],
    ["SPEC%2F001", "decodes to a separator"],
    ["x%2Fevidence", "decodes to a separator"],
    ["A".repeat(129), "longer than 128"],
    [encodeIdSegment(LAB.repeat(129)), "longer than 128"],
    ["", "empty"],
  ];
  for (const [seg, why] of NON_CANONICAL) it(`the gate refuses segment ${label(seg)} (${why})`, () => expect(verificationIdFromSegment(seg).ok).toBe(false));
});

describe("history IDs (additive contract ^hist_[a-f0-9]{64}$)", () => {
  it("accepts a well-formed history ID unchanged", () => expect(checkHistoryId(HIST)).toEqual({ ok: true, id: HIST }));
  for (const id of [`${HIST}0`, HIST.slice(0, -1), HIST.toUpperCase(), `hist_${"g".repeat(64)}`, `HIST_${"a".repeat(64)}`, `hist-${"a".repeat(64)}`, "SPEC-001", `${HIST}/evidence`, ` ${HIST}`])
    it(`refuses ${JSON.stringify(id.slice(0, 16))}…`, () => expect(checkHistoryId(id).ok).toBe(false));
  for (const id of HOSTILE) it(`refuses hostile ${JSON.stringify(id.slice(0, 12))}`, () => expect(checkHistoryId(id).ok).toBe(false));
});

describe("router decoding: once, never throwing, malformed encoding distinguished", () => {
  it("decodes once; double encoding stays literal", () => {
    expect(decodeSegment("SPEC%2D001")).toBe("SPEC-001");
    expect(decodeSegment("%252E")).toBe("%2E");
    expect(decodeSegment("SPEC%3A006")).toBe("SPEC:006");
  });
  it("malformed escapes are reported as such (tryDecodeSegment → null), and decodeSegment returns them as written", () => {
    for (const seg of ["%E0%A4%A", "%", "%zz", "100%", "%ED%A0%80"]) {
      expect(tryDecodeSegment(seg), seg).toBeNull();
      expect(decodeSegment(seg)).toBe(seg);
    }
  });
});

describe("providers send nothing for a refused ID", () => {
  const counting = () => {
    const sent: string[] = [];
    const f = (async (url: string) => {
      sent.push(url);
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    return { sent, f };
  };
  for (const [id, , code] of [...NOT_TRANSPORTABLE.map(([i, w]) => [i, w, "verification_id_not_transportable"]), ...INVALID.map(([i, w]) => [i, w, "invalid_verification_id"])])
    it(`verification + evidence reads of ${label(id!)} make no request (${code})`, async () => {
      const { sent, f } = counting();
      const local = createLocalResearchProvider({ fetch: f });
      const r1 = await local.getVerification(id!);
      const r2 = await local.getEvidence(id!, { limit: 2 });
      for (const r of [r1, r2]) expect(r).toMatchObject({ kind: "error", access: "REQUEST_ERROR", code });
      expect(sent).toEqual([]);
    });
  for (const id of HOSTILE)
    it(`a history read of ${label(id)} makes no request`, async () => {
      const { sent, f } = counting();
      const r = await createLocalHistoryProvider({ fetch: f }).getHistory(id);
      expect(r).toMatchObject({ kind: "error", access: "REQUEST_ERROR", code: "invalid_history_id" });
      expect(sent).toEqual([]);
    });
});

describe("providers request exactly the canonical segment for a contract-valid ID", () => {
  for (const [id] of VALID)
    it(`${label(id)}: one Detail and one evidence request, path segment = encodeIdSegment(id)`, async () => {
      const sent: string[] = [];
      const f = (async (url: string) => {
        sent.push(url);
        return new Response(JSON.stringify({ error: { code: "run_not_found", message: "m", request_id: "r", retryable: false, details: [] } }), { status: 404, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch;
      const local = createLocalResearchProvider({ fetch: f });
      expect(await local.getVerification(id)).toMatchObject({ kind: "not_found" });
      expect(await local.getEvidence(id, { limit: 2 })).toMatchObject({ kind: "not_found" });
      const seg = encodeIdSegment(id);
      expect(sent).toEqual([`/api/v1/verifications/${seg}`, `/api/v1/verifications/${seg}/evidence?limit=2&include_payload=true`]);
    });
});
