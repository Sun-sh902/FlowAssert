/**
 * json.dumps as CPython writes it, for the reports: ensure_ascii (every character outside printable ASCII as a
 * lower-case \uXXXX escape, a surrogate pair above U+FFFF), separators ", " and ": " without indent, "," and ": "
 * with it, and sort_keys by code point.
 *
 * Objects are plain objects whose keys are never integer-like (report members, rule names that start with "field:"),
 * so their insertion order is the order Python would keep.
 */
import { compareCodePoints } from "./pystr";

export type PyValue = null | boolean | number | bigint | string | readonly PyValue[] | { readonly [key: string]: PyValue | undefined };

const SHORT: Record<string, string> = { "\\": "\\\\", '"': '\\"', "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t" };

/** A JSON string literal with ensure_ascii, as json.dumps writes it. */
export function jsonString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const unit = s.charCodeAt(i);
    if (unit >= 0x20 && unit <= 0x7e && ch !== "\\" && ch !== '"') out += ch;
    else out += SHORT[ch] ?? "\\u" + unit.toString(16).padStart(4, "0");
  }
  return out + '"';
}

export interface DumpOptions {
  indent?: number;
  sortKeys?: boolean;
}

/** json.dumps(value, indent=..., sort_keys=...). */
export function pyDumps(value: PyValue, options: DumpOptions = {}): string {
  const { indent, sortKeys = false } = options;
  const write = (v: PyValue, level: number): string => {
    if (v === null) return "null";
    if (v === true) return "true";
    if (v === false) return "false";
    if (typeof v === "number") {
      if (!Number.isSafeInteger(v)) throw new TypeError(`not an integer: ${v}`);
      return String(v);
    }
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "string") return jsonString(v);
    const inner = indent === undefined ? "" : "\n" + " ".repeat(indent * (level + 1));
    const outer = indent === undefined ? "" : "\n" + " ".repeat(indent * level);
    const comma = indent === undefined ? ", " : ",";
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      return "[" + inner + v.map((item: PyValue) => write(item, level + 1)).join(comma + inner) + outer + "]";
    }
    const entries = Object.entries(v as Record<string, PyValue | undefined>).filter((e): e is [string, PyValue] => e[1] !== undefined);
    if (entries.length === 0) return "{}";
    if (sortKeys) entries.sort((a, b) => compareCodePoints(a[0], b[0]));
    return "{" + inner + entries.map(([k, item]) => jsonString(k) + ": " + write(item, level + 1)).join(comma + inner) + outer + "}";
  };
  return write(value, 0);
}

/** json.loads refused the text; the message is the one CPython's JSONDecodeError carries in `msg`. */
export class JsonError extends Error {}

/**
 * json.loads with an object_pairs_hook that refuses a duplicate member, as cli._read_json does. Numbers that are
 * integers come back as bigint when they do not fit a safe integer, so nothing is rounded; other numbers as number.
 * Python accepts NaN, Infinity and -Infinity, so this does too.
 */
export function pyLoads(text: string): PyValue {
  let i = 0;
  const fail = (msg: string): never => {
    throw new JsonError(msg);
  };
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i]!)) i++;
  };
  /** A value that is not an array or an object, at i (after white space). */
  const scalar = (): PyValue => {
    const ch = text[i];
    if (ch === '"') return string();
    if (text.startsWith("null", i)) return (i += 4), null;
    if (text.startsWith("true", i)) return (i += 4), true;
    if (text.startsWith("false", i)) return (i += 5), false;
    if (text.startsWith("NaN", i)) return (i += 3), Number.NaN;
    if (text.startsWith("Infinity", i)) return (i += 8), Number.POSITIVE_INFINITY;
    if (text.startsWith("-Infinity", i)) return (i += 9), Number.NEGATIVE_INFINITY;
    const m = /^-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/.exec(text.slice(i, i + 4096));
    if (!m) return fail("Expecting value");
    i += m[0].length;
    if (m[1] === undefined && m[2] === undefined) {
      const big = BigInt(m[0]);
      return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
    }
    return Number(m[0]);
  };
  const string = (): string => {
    i++;
    let out = "";
    for (;;) {
      if (i >= text.length) fail("Unterminated string starting at");
      const ch = text[i]!;
      if (ch === '"') {
        i++;
        return out;
      }
      if (ch === "\\") {
        const esc = text[i + 1];
        const simple: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (esc !== undefined && esc in simple) {
          out += simple[esc];
          i += 2;
          continue;
        }
        if (esc === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
          out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        fail("Invalid \\escape");
      }
      if (ch.charCodeAt(0) < 0x20) fail("Invalid control character at");
      out += ch;
      i++;
    }
  };
  // Arrays and objects are read with a stack of the open ones, not by recursion, so that no nesting a file can hold
  // exhausts the call stack: Python 3.15 reads a configuration nested 100,000 deep, and so must this. The checks are
  // made in the order the recursive reader made them, so the first problem is the one Python names.
  type Open = { array: PyValue[] } | { pairs: [string, PyValue][]; key: string };
  const stack: Open[] = [];
  /** The next member's name and ":" of an open object. */
  const member = (open: { key: string }) => {
    ws();
    if (text[i] !== '"') fail("Expecting property name enclosed in double quotes");
    open.key = string();
    ws();
    if (text[i] !== ":") fail("Expecting ':' delimiter");
    i++;
  };
  // The duplicate check runs when the object closes, as object_pairs_hook does.
  const close = (pairs: [string, PyValue][]) => {
    const out: { [key: string]: PyValue } = Object.create(null) as { [key: string]: PyValue };
    for (const [key, item] of pairs) {
      if (Object.hasOwn(out, key)) throw new DuplicateMember(key);
      out[key] = item;
    }
    return out;
  };
  if (text.startsWith("\ufeff")) fail("Unexpected UTF-8 BOM (decode using utf-8-sig)");
  let result: PyValue;
  value: for (;;) {
    // A value begins: a scalar, an empty array or object, or one that opens and whose first member begins next.
    ws();
    let done: PyValue;
    if (text[i] === "[") {
      i++;
      ws();
      if (text[i] !== "]") {
        stack.push({ array: [] });
        continue;
      }
      i++;
      done = [];
    } else if (text[i] === "{") {
      i++;
      ws();
      if (text[i] !== "}") {
        const open = { pairs: [], key: "" };
        stack.push(open);
        member(open);
        continue;
      }
      i++;
      done = close([]);
    } else done = scalar();
    // A value is complete: it goes into the innermost open array or object, which may then close in turn.
    for (;;) {
      const open = stack[stack.length - 1];
      if (open === undefined) {
        result = done;
        break value;
      }
      if ("array" in open) open.array.push(done);
      else open.pairs.push([open.key, done]);
      ws();
      const end = "array" in open ? "]" : "}";
      if (text[i] === ",") {
        i++;
        ws();
        if (text[i] === end) fail(`Illegal trailing comma before end of ${"array" in open ? "array" : "object"}`);
        if (!("array" in open)) member(open);
        continue value;
      }
      if (text[i] !== end) fail("Expecting ',' delimiter");
      i++;
      stack.pop();
      done = "array" in open ? open.array : close(open.pairs);
    }
  }
  ws();
  if (i !== text.length) fail("Extra data");
  return result;
}

/** A member that appears twice in one JSON object. */
export class DuplicateMember extends Error {
  readonly member: string;
  constructor(member: string) {
    super(`duplicate member ${member}`);
    this.member = member;
  }
}
