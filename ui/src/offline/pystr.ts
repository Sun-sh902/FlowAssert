/**
 * Python string behaviour the CSV check depends on, so the browser gives the same answer as the command-line
 * checker (offline/flowassert_offline). The Unicode facts come from ./unicodeTables.ts, generated from Python itself,
 * so casefold, strip, repr and the regular expressions follow Python's Unicode version, not this browser's.
 *
 * Strings are compared and sorted by code point, as Python does; JavaScript's own `<` compares UTF-16 code units,
 * which differs for characters outside the Basic Multilingual Plane.
 */
import { CASEFOLD, CASE_GROUPS, DECIMAL_ZEROS, NOT_PRINTABLE, WHITESPACE } from "./unicodeTables";

const SPACE = new Set(WHITESPACE);

/** str.isspace for one character. */
export const isPySpace = (ch: string) => SPACE.has(ch);

/** str.strip(): leading and trailing whitespace as Python defines it (which includes U+001C–U+001F and U+0085). */
export function pyStrip(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && SPACE.has(s[start]!)) start++;
  while (end > start && SPACE.has(s[end - 1]!)) end--;
  return s.slice(start, end);
}

let folds: Map<number, string> | null = null;

/** str.casefold: full Unicode case folding, including ß → ss and final sigma → σ. */
export function pyCasefold(s: string): string {
  folds ??= new Map(CASEFOLD);
  let out = "";
  for (const ch of s) out += folds.get(ch.codePointAt(0)!) ?? ch;
  return out;
}

let groups: Map<string, string> | null = null;

/** The characters a literal character matches in a Python regular expression compiled with re.IGNORECASE. */
export function caseGroup(ch: string): string {
  if (!groups) {
    groups = new Map();
    for (const group of CASE_GROUPS) for (const member of group) groups.set(member, group);
  }
  return groups.get(ch) ?? ch;
}

function inRanges(cp: number, ranges: readonly (readonly [number, number])[]): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = ranges[mid]!;
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/** str.isprintable for one code point. Surrogates are not printable. */
export const isPyPrintable = (cp: number) => !(cp >= 0xd800 && cp <= 0xdfff) && !inRanges(cp, NOT_PRINTABLE);

/** The value of a decimal digit (any script, as int() and re's \d accept), or -1. */
export function decimalValue(cp: number): number {
  let lo = 0;
  let hi = DECIMAL_ZEROS.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const zero = DECIMAL_ZEROS[mid]!;
    if (cp < zero) hi = mid - 1;
    else if (cp > zero + 9) lo = mid + 1;
    else return cp - zero;
  }
  return -1;
}

const hex = (n: number, width: number) => n.toString(16).padStart(width, "0");

/** repr() of a str, None, bool or int, character for character as CPython writes it. */
export function pyRepr(value: string | number | bigint | boolean | null | undefined): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value !== "string") return String(value);
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let out = quote;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    let cp = unit;
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = (unit - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        i++;
      }
    }
    const ch = String.fromCodePoint(cp);
    if (ch === quote || ch === "\\") out += "\\" + ch;
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (cp < 0x20 || cp === 0x7f) out += "\\x" + hex(cp, 2);
    else if (cp < 0x7f || isPyPrintable(cp)) out += ch;
    else if (cp <= 0xff) out += "\\x" + hex(cp, 2);
    else if (cp <= 0xffff) out += "\\u" + hex(cp, 4);
    else out += "\\U" + hex(cp, 8);
  }
  return out + quote;
}

/** Compare two strings by code point, as Python's < and sorted() do. */
export function compareCodePoints(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    // A surrogate (a character above U+FFFF) sorts after every other UTF-16 code unit.
    const sx = x >= 0xd800 && x <= 0xdfff;
    const sy = y >= 0xd800 && y <= 0xdfff;
    if (sx !== sy) return sx ? 1 : -1;
    return x - y;
  }
  return a.length - b.length;
}

/** The number of code points in a string, as Python's len(). */
export function pyLen(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const unit = s.charCodeAt(i);
    if (unit >= 0xdc00 && unit <= 0xdfff && i > 0) {
      const prev = s.charCodeAt(i - 1);
      if (prev >= 0xd800 && prev <= 0xdbff) n--;
    }
  }
  return n;
}

/** html.escape(s, quote=True). */
export function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]!);
}
