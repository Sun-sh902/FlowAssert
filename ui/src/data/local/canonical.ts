/**
 * `python-json-sortkeys-ascii-v1` — the canonicalization the contract names for evidence payloads:
 * Python `json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)`
 * (FlowAssert-Phase3A-Service/docs/phase3a/ARCHIVE_INTEGRITY_MODEL.md; app/identity.py `canonical`).
 *
 * Used only to check, inside this browser, that a received payload reproduces its reference's
 * SHA-256. Matching proves internal consistency between two values the same service supplied — not
 * authentic origin, independent collection or completeness.
 *
 * Phase 3A (P2-AUD-002): the bytes are rebuilt from a LOSSLESS parse of the response text, because
 * JSON.parse cannot tell `1.0` from `1` and drops duplicate keys silently. Rules, each matching Python:
 *  - object keys are ordered by Unicode code point (Python str ordering), not by UTF-16 code unit —
 *    the two differ when an astral-plane key meets a U+E000–U+FFFF key;
 *  - strings escape `"` `\` and the five short escapes, and every other character outside U+0020–U+007E
 *    as \uXXXX per UTF-16 unit (so astral characters become surrogate pairs), lowercase hex;
 *  - an integer lexeme is reproduced digit for digit at any size (Python ints are exact); `-0` is `0`;
 *  - a non-integer number is reproduced only when the response lexeme is itself Python's `repr` of the
 *    value, re-derived here from this engine's shortest round-trip digits. Any disagreement between the
 *    two, a non-finite value or an unusual spelling makes the payload `not_checkable` — never a mismatch;
 *  - a duplicate key, invalid JSON or nesting deeper than MAX_DEPTH makes the payload `not_checkable`.
 * Nothing is repaired: when the browser cannot reproduce Python's bytes reliably it says so
 * (`not_checkable`), and the integrity view treats that as unverifiable, never as verified.
 *
 * `canonicalJson` (parsed values, no lexemes) is kept for callers without the raw text: there any
 * number that is not a safe integer is `not_checkable`, as before; it also sorts by code point now.
 */
import type { DigestCheck } from "../../domain/evidence";

class NotCanonicalizable extends Error {}

const MAX_DEPTH = 256;

/** Python `str` ordering: compare by code point. A lone surrogate counts as its own code point, as in Python. */
export function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(j)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  return i < a.length ? 1 : j < b.length ? -1 : 0;
}

function str(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i]!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    // Python escapes everything outside " "–"~" (including DEL), one \uXXXX per UTF-16 unit.
    else if (c < 0x20 || c > 0x7e) out += `\\u${c.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return out + '"';
}

/* ---------- Parsed values (no lexemes) ---------- */

function canon(v: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) throw new NotCanonicalizable();
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new NotCanonicalizable();
    return String(v);
  }
  if (typeof v === "string") return str(v);
  if (Array.isArray(v)) return `[${v.map((x) => canon(x, depth + 1)).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort(compareCodePoints);
    return `{${keys.map((k) => `${str(k)}:${canon(o[k], depth + 1)}`).join(",")}}`;
  }
  throw new NotCanonicalizable();
}

/** Canonical text of a parsed value, or null when this browser cannot reproduce the Python bytes for it. */
export function canonicalJson(v: unknown): string | null {
  try {
    return canon(v);
  } catch (e) {
    if (e instanceof NotCanonicalizable) return null;
    throw e;
  }
}

/* ---------- Lossless parse: numbers keep their lexeme, objects keep every key ---------- */

export type Lossless =
  | null
  | boolean
  | string
  | { readonly k: "num"; readonly lex: string }
  | { readonly k: "arr"; readonly items: Lossless[] }
  | { readonly k: "obj"; readonly entries: [string, Lossless][]; readonly duplicate: boolean };

class Invalid extends Error {}

/**
 * Strict RFC 8259 JSON. Returns undefined (never null, which is a JSON value) for anything JSON.parse
 * would reject, or nesting beyond MAX_DEPTH.
 */
export function losslessParse(text: string): Lossless | undefined {
  let i = 0;
  const ws = () => {
    while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++;
  };
  const string = (): string => {
    if (text[i] !== '"') throw new Invalid();
    i++;
    let out = "";
    for (;;) {
      if (i >= text.length) throw new Invalid();
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        i++;
        return out;
      }
      if (c < 0x20) throw new Invalid();
      if (c !== 0x5c) {
        out += text[i];
        i++;
        continue;
      }
      const e = text[i + 1];
      i += 2;
      if (e === '"' || e === "\\" || e === "/") out += e;
      else if (e === "b") out += "\b";
      else if (e === "f") out += "\f";
      else if (e === "n") out += "\n";
      else if (e === "r") out += "\r";
      else if (e === "t") out += "\t";
      else if (e === "u") {
        const hex = text.slice(i, i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Invalid();
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else throw new Invalid();
    }
  };
  const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const value = (depth: number): Lossless => {
    if (depth > MAX_DEPTH) throw new Invalid();
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const entries: [string, Lossless][] = [];
      const seen = new Set<string>();
      let duplicate = false;
      ws();
      if (text[i] === "}") {
        i++;
        return { k: "obj", entries, duplicate };
      }
      for (;;) {
        ws();
        const key = string();
        if (seen.has(key)) duplicate = true;
        seen.add(key);
        ws();
        if (text[i] !== ":") throw new Invalid();
        i++;
        entries.push([key, value(depth + 1)]);
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return { k: "obj", entries, duplicate };
        }
        throw new Invalid();
      }
    }
    if (c === "[") {
      i++;
      const items: Lossless[] = [];
      ws();
      if (text[i] === "]") {
        i++;
        return { k: "arr", items };
      }
      for (;;) {
        items.push(value(depth + 1));
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return { k: "arr", items };
        }
        throw new Invalid();
      }
    }
    if (c === '"') return string();
    if (text.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (text.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (text.startsWith("null", i)) {
      i += 4;
      return null;
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (!m || m[0].length === 0) throw new Invalid();
    i += m[0].length;
    return { k: "num", lex: m[0] };
  };
  try {
    const v = value(0);
    ws();
    if (i !== text.length) return undefined;
    return v;
  } catch (e) {
    if (e instanceof Invalid || e instanceof RangeError) return undefined;
    throw e;
  }
}

/** The node at a path of object keys / array indexes, or undefined. With duplicate keys the last wins, as in JSON.parse. */
export function losslessAt(root: Lossless | undefined, path: (string | number)[]): Lossless | undefined {
  let node: Lossless | undefined = root;
  for (const step of path) {
    if (node === undefined || node === null || typeof node !== "object") return undefined;
    if (node.k === "arr" && typeof step === "number") node = node.items[step];
    else if (node.k === "obj" && typeof step === "string") {
      const hit: [string, Lossless] | undefined = [...node.entries].reverse().find(([key]) => key === step);
      node = hit ? hit[1] : undefined;
    } else return undefined;
  }
  return node;
}

/**
 * Python `repr(float)` (float_repr_style "short") for a finite double, from this engine's shortest
 * round-trip digits: fixed notation for decimal exponents -4 … 15 (always with a fractional part),
 * scientific otherwise with a signed exponent of at least two digits.
 */
export function pythonFloatRepr(x: number): string | null {
  if (!Number.isFinite(x)) return null;
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const sign = x < 0 ? "-" : "";
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(Math.abs(x).toExponential());
  if (!m) return null;
  const digits = (m[1]! + (m[2] ?? "")).replace(/0+$/, "") || "0";
  const exp = Number(m[3]);
  const decpt = exp + 1;
  if (exp < -4 || exp >= 16) {
    const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${mant}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  if (decpt <= 0) return `${sign}0.${"0".repeat(-decpt)}${digits}`;
  if (decpt >= digits.length) return `${sign}${digits}${"0".repeat(decpt - digits.length)}.0`;
  return `${sign}${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
}

function number(lex: string): string {
  if (/^-?(?:0|[1-9]\d*)$/.test(lex)) return lex === "-0" ? "0" : lex;
  const py = pythonFloatRepr(Number(lex));
  // Reproducible only when the response already spells the value exactly as Python's repr would.
  if (py === null || py !== lex) throw new NotCanonicalizable();
  return py;
}

function canonLossless(v: Lossless, depth = 0): string {
  if (depth > MAX_DEPTH) throw new NotCanonicalizable();
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "string") return str(v);
  if (v.k === "num") return number(v.lex);
  if (v.k === "arr") return `[${v.items.map((x) => canonLossless(x, depth + 1)).join(",")}]`;
  if (v.duplicate) throw new NotCanonicalizable();
  const entries = [...v.entries].sort(([a], [b]) => compareCodePoints(a, b));
  return `{${entries.map(([k, x]) => `${str(k)}:${canonLossless(x, depth + 1)}`).join(",")}}`;
}

/** Canonical text of a lossless node, or null when Python's bytes cannot be reproduced reliably. */
export function canonicalJsonLossless(v: Lossless): string | null {
  try {
    return canonLossless(v);
  } catch (e) {
    if (e instanceof NotCanonicalizable) return null;
    throw e;
  }
}

export async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compare a payload with its reference digest. Never throws; never changes the payload.
 * With `lossless` (the payload's node from losslessParse of the response text) the exact lexemes are
 * used; without it, the parsed value is used under the stricter parsed-value rules.
 */
export async function checkPayloadDigest(payload: unknown, expected: string | null, lossless?: Lossless): Promise<DigestCheck> {
  if (expected === null) return "not_checkable";
  const text = lossless !== undefined ? canonicalJsonLossless(lossless) : canonicalJson(payload);
  if (text === null) return "not_checkable";
  const got = await sha256Hex(text);
  if (got === null) return "not_checkable";
  return got === expected ? "reproduced" : "mismatch";
}
