/**
 * Phase 3A · P2-AUD-002: the browser canonicalizer against a Python oracle corpus.
 *
 * The corpus (src/test/fixtures/phase3a/canonical-corpus.json) is produced by the backend's own Python
 * from the accepted rule (scripts/phase3a/canonical_corpus.py), never from the UI under test. Each case
 * is the value as the Service's JSON response would carry it, plus the accepted canonical bytes and their
 * SHA-256. Categories include astral / U+E000–U+FFFF key ordering, every control character, lone
 * surrogates, huge integers, -0, random IEEE-754 bit patterns, exponent boundaries and integral floats.
 * Negative cases prove a contradiction is "mismatch" and an unreliable reproduction is "not_checkable".
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, canonicalJsonLossless, checkPayloadDigest, compareCodePoints, losslessAt, losslessParse, pythonFloatRepr } from "../data/local/canonical";
import corpus from "./fixtures/phase3a/canonical-corpus.json";

interface Case {
  category: string;
  text: string;
  canonical: string;
  sha256: string;
}
const cases = corpus.cases as Case[];
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("Python oracle corpus", () => {
  it("is the generated corpus, not a hand-picked list", () => {
    expect(corpus.rule).toBe("json.dumps(v, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)");
    expect(cases.length).toBeGreaterThanOrEqual(1800);
    const categories = new Set(cases.map((c) => c.category));
    for (const c of ["float-random-bits", "float-special", "int", "mixed-astral-high-bmp-keys", "utf16-vs-codepoint", "control-char", "lone-surrogate", "nested-random", "empty"]) expect(categories).toContain(c);
  });

  it("reproduces Python's canonical bytes and SHA-256 for every case from the response text", () => {
    const wrong: string[] = [];
    for (const c of cases) {
      const tree = losslessParse(c.text);
      // A top-level JSON null is a value (null), not a parse failure (undefined).
      const out = tree === undefined ? null : canonicalJsonLossless(tree);
      if (out !== c.canonical || sha(out) !== c.sha256) wrong.push(`${c.category}: ${c.text.slice(0, 80)} → ${out?.slice(0, 80)}`);
    }
    expect(wrong).toEqual([]);
  });

  it("checkPayloadDigest reports every corpus value 'reproduced' (lossless path)", async () => {
    const results = await Promise.all(cases.map((c) => checkPayloadDigest(JSON.parse(c.text), c.sha256, losslessParse(c.text)!)));
    expect(results.filter((r) => r !== "reproduced")).toEqual([]);
  });

  it("the parsed-value path is never wrong without saying so: equal, or not_checkable, for every float-free case", () => {
    for (const c of cases) {
      if (/[.eE]/.test(c.text.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) continue; // a float lexeme: parsed values lose it
      expect(canonicalJson(JSON.parse(c.text)) ?? c.canonical, c.text.slice(0, 60)).toBe(c.canonical);
    }
  });
});

describe("code point key order (the astral-key case P2-AUD-002 found)", () => {
  it("orders an astral key after a U+FFFF key, as Python does", () => {
    expect(canonicalJson({ "￿": 2, "😀": 1 })).toBe('{"\\uffff":2,"\\ud83d\\ude00":1}');
    expect(compareCodePoints("￿", "😀")).toBe(-1);
    expect(compareCodePoints("😀", "")).toBe(1);
    expect(compareCodePoints("a", "ab")).toBe(-1);
    expect(compareCodePoints("", "")).toBe(0);
  });
});

describe("numbers", () => {
  it("formats doubles exactly like Python repr at the notation boundaries", () => {
    const table: [number, string][] = [
      [1, "1.0"],
      [-0, "-0.0"],
      [0, "0.0"],
      [1e-4, "0.0001"],
      [1e-5, "1e-05"],
      [1e15, "1000000000000000.0"],
      [1e16, "1e+16"],
      [1.5e300, "1.5e+300"],
      [5e-324, "5e-324"],
      [0.1 + 0.2, "0.30000000000000004"],
      [123.456, "123.456"],
      [-2.5e-7, "-2.5e-07"],
    ];
    for (const [x, want] of table) expect(pythonFloatRepr(x), String(x)).toBe(want);
    expect(pythonFloatRepr(Infinity)).toBeNull();
    expect(pythonFloatRepr(NaN)).toBeNull();
  });

  it("reproduces integers of any size digit for digit, and -0 as 0", () => {
    expect(canonicalJsonLossless(losslessParse('{"n":123456789012345678901234567890}')!)).toBe('{"n":123456789012345678901234567890}');
    expect(canonicalJsonLossless(losslessParse("[-0]")!)).toBe("[0]");
  });

  it("is not_checkable — never a mismatch — when the response does not spell a float as Python's repr", async () => {
    for (const text of ['{"x":1.50}', '{"x":1E5}', '{"x":1e5}', '{"x":1.0e0}', '{"x":0.10}', '{"x":1e400}', '{"x":-1e400}', '{"x":2.0000000000000001}']) {
      expect(canonicalJsonLossless(losslessParse(text)!), text).toBeNull();
      expect(await checkPayloadDigest(JSON.parse(text), "a".repeat(64), losslessParse(text)!), text).toBe("not_checkable");
    }
  });
});

describe("negative cases", () => {
  it("a changed value is a mismatch, for a broad sample of corpus cases", async () => {
    const sample = cases.filter((c) => c.text.startsWith("{") && c.text !== "{}").slice(0, 300);
    for (const c of sample) {
      const changed = `{"phase3a_tamper":1,${c.text.slice(1)}`;
      expect(await checkPayloadDigest(JSON.parse(changed), c.sha256, losslessParse(changed)!), c.text.slice(0, 40)).toBe("mismatch");
    }
  });

  it("a duplicate key is not_checkable (JSON.parse would silently keep the last)", async () => {
    const text = '{"a":1,"a":2}';
    expect(canonicalJsonLossless(losslessParse(text)!)).toBeNull();
    expect(await checkPayloadDigest(JSON.parse(text), sha('{"a":2}'), losslessParse(text)!)).toBe("not_checkable");
  });

  it("invalid JSON and excessive nesting do not parse", () => {
    for (const t of ["{", "[1,]", '{"a" 1}', "01", "1.", ".5", "+1", "NaN", "Infinity", '"\u0001"', '"\\x"', "tru", "[1] 2", "\"\\ud83d", "{'a':1}", ""]) expect(losslessParse(t), t).toBeUndefined();
    expect(losslessParse("[".repeat(300) + "]".repeat(300))).toBeUndefined();
    // JSON null is a value, distinct from a parse failure.
    expect(losslessParse("null")).toBeNull();
    expect(canonicalJsonLossless(losslessParse(" null ")!)).toBe("null");
  });

  it("no digest, or a payload missing from the lossless tree, is not_checkable", async () => {
    expect(await checkPayloadDigest({ x: 1 }, null)).toBe("not_checkable");
    expect(losslessAt(losslessParse('{"items":[{"payload":{"a":1}}]}'), ["items", 1, "payload"])).toBeUndefined();
    expect(losslessAt(losslessParse('{"items":[{"payload":{"a":1}}]}'), ["items", 0, "payload"])).toEqual({ k: "obj", entries: [["a", { k: "num", lex: "1" }]], duplicate: false });
  });
});
