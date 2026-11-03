/**
 * datetime.strptime for the `date:FORMAT` rule, as CPython 3.15 parses in the C locale (Lib/_strptime.py), for the
 * directives %Y %m %d %H %M %S %f %z %b %B %y %p %I %j and %%. The command-line checker accepts every directive
 * Python knows; a format with any other is refused here with a message that says so, never parsed approximately.
 *
 * Python builds a regular expression from the format and compiles it with re.IGNORECASE. This module builds the same
 * expression, with Python's \d (decimal digits of every script), \s (Python's whitespace) and Python's case-insensitive
 * literal matching spelled out as character classes, then reads the groups in format order as _strptime does.
 *
 * Known differences between Python versions, followed here as 3.15 behaves: %d needs a year directive (3.15 refuses the
 * format); %z may be absent from the value (3.14+); ' also matches U+02BC. A format that repeats a directive cannot
 * compile in Python, and parse_rule refuses it; so does this module, with the same message.
 */
import { caseGroup, decimalValue, pyRepr, pyStrip } from "./pystr";
import { DECIMAL_ZEROS, WHITESPACE } from "./unicodeTables";

/** strptime raised ValueError; the message is CPython's. */
export class PyValueError extends Error {}

/** A format this browser check refuses although Python would accept it. The message says why. */
export class UnsupportedFormat extends Error {}

/** The format repeats a directive, which Python's re.compile refuses; the message is parse_rule's. */
export class RepeatedDirective extends Error {}

export const SUPPORTED_DIRECTIVES = ["Y", "m", "d", "H", "M", "S", "f", "z", "b", "B", "y", "p", "I", "j", "%"] as const;
type Directive = (typeof SUPPORTED_DIRECTIVES)[number];
const SUPPORTED = new Set<string>(SUPPORTED_DIRECTIVES);
/** Every directive Python 3.15's TimeRE knows in the C locale, so an unknown one gets Python's own message. */
const PYTHON_DIRECTIVES = new Set("d f H k I l G j m M S U w u V y Y z :z A a B b p Z n t % Od Om Oy OC OH OI OM OS Ow e Oe P Op W D F T R r X x c".split(" "));

const u = (cp: number) => `\\u{${cp.toString(16)}}`;
const DIGIT = "[" + DECIMAL_ZEROS.map((z) => `${u(z)}-${u(z + 9)}`).join("") + "]";
const SPACE = "[" + [...WHITESPACE].map((c) => u(c.codePointAt(0)!)).join("") + "]";

/** One character of the format, matched as Python's re.IGNORECASE matches a literal. */
function literal(ch: string): string {
  const group = caseGroup(ch);
  const one = (c: string) => (/[A-Za-z0-9]/.test(c) ? c : u(c.codePointAt(0)!));
  return group.length === 1 ? one(ch) : "[" + [...group].map(one).join("") + "]";
}

const words = (names: readonly string[]) => names.map((n) => [...n].map(literal).join("")).join("|");
const D = DIGIT;
const A_MONTH = ["", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const F_MONTH = ["", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// TimeRE sorts the names longest first (a stable sort), so a longer name is tried before its prefix.
const byLength = (names: string[]) => [...names].sort((a, b) => b.length - a.length);

const PATTERN: Record<Directive, string> = {
  d: `(?<d>3[0-1]|[1-2]${D}|0[1-9]|[1-9]| [1-9])`,
  f: `(?<f>[0-9]{1,6})`,
  H: `(?<H>2[0-3]|[0-1]${D}|${D}| ${D})`,
  I: `(?<I>1[0-2]|0[1-9]|[1-9]| [1-9])`,
  j: `(?<j>36[0-6]|3[0-5]${D}|[1-2]${D}${D}|0[1-9]${D}|00[1-9]|[1-9]${D}|0[1-9]|[1-9])`,
  m: `(?<m>1[0-2]|0[1-9]|[1-9])`,
  M: `(?<M>[0-5]${D}|${D})`,
  S: `(?<S>6[0-1]|[0-5]${D}|${D})`,
  y: `(?<y>${D}${D})`,
  Y: `(?<Y>${D}${D}${D}${D})`,
  z: `(?<z>(?:[+\\-]${D}${D}:?[0-5]${D}(?::?[0-5]${D}(?:\\.${D}{1,6})?)?)|Z)?`,
  B: `(?<B>${words(byLength(F_MONTH.slice(1)))})`,
  b: `(?<b>${words(byLength(A_MONTH.slice(1)))})`,
  p: `(?<p>${words(["am", "pm"])})`,
  "%": "%",
};

const NO_YEAR =
  "Day of month directive '%d' may not be used without a year directive. Parsing dates involving a day of month " +
  "without a year is ambiguous and fails to parse leap day. Add a year to the input and format. " +
  "See https://github.com/python/cpython/issues/70647.";

export interface DateFormat {
  readonly format: string;
  readonly regex: RegExp;
  /** The directives with a group, in format order: the order _strptime reads them. */
  readonly order: readonly Exclude<Directive, "%">[];
}

const cache = new Map<string, DateFormat>();

/**
 * TimeRE.compile(format), or PyValueError with Python's message, or UnsupportedFormat. The format goes through the
 * same three substitutions as TimeRE.pattern before its directives are found, so a directive is what Python would see.
 */
export function compileFormat(format: string): DateFormat {
  const hit = cache.get(format);
  if (hit) return hit;
  let text = format.replace(/([\\.^$*+?(){}[\]|])/gu, "\\$1");
  text = text.replace(new RegExp(SPACE + "+", "gu"), "\\s+");
  text = text.replace(/'/gu, "['ʼ]");
  const order: Exclude<Directive, "%">[] = [];
  let body = "";
  let last = 0;
  // The rest of the text holds only what the substitutions wrote: \x for an escaped character, \s+, ['ʼ], literals.
  const literals = (segment: string) => {
    let out = "";
    const chars = [...segment];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      if (ch === "\\" && chars[i + 1] === "s" && chars[i + 2] === "+") {
        out += SPACE + "+";
        i += 2;
      } else if (ch === "\\") {
        out += literal(chars[++i]!);
      } else if (ch === "[" && segment.startsWith("['ʼ]", chars.slice(0, i).join("").length)) {
        out += "['\\u{2bc}]";
        i += 3;
      } else out += literal(ch);
    }
    return out;
  };
  for (const m of text.matchAll(/%[-_0^#]*[0-9]*([OE]?[:\\]?[^\n]?)/gu)) {
    const directive = m[0].slice(1);
    body += literals(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (!SUPPORTED.has(directive)) {
      const bad = directive.replaceAll("\\s", "");
      if (!bad) throw new PyValueError(`stray % in format '${format}'`);
      if (PYTHON_DIRECTIVES.has(directive)) {
        throw new UnsupportedFormat(
          `date format ${pyRepr(format)} uses %${directive}, which the browser check does not support; ` +
            `it supports ${SUPPORTED_DIRECTIVES.map((d) => "%" + d).join(" ")}`,
        );
      }
      throw new PyValueError(`'${bad.replace("\\", "")}' is a bad directive in format '${format}'`);
    }
    body += PATTERN[directive as Directive];
    if (directive !== "%") order.push(directive as Exclude<Directive, "%">);
  }
  body += literals(text.slice(last));
  if (order.includes("d") && !order.includes("Y") && !order.includes("y")) throw new PyValueError(NO_YEAR);
  const repeated = order.find((d, i) => order.indexOf(d) !== i);
  if (repeated) throw new RepeatedDirective(`date format ${pyRepr(format)} repeats a directive`);
  const compiled = { format, regex: new RegExp("^(?:" + body + ")", "u"), order };
  if (cache.size > 64) cache.clear();
  cache.set(format, compiled);
  return compiled;
}

/** int() of a matched group: decimal digits of any script, surrounding whitespace allowed. */
function pyInt(s: string): number {
  const core = pyStrip(s);
  let n = 0;
  for (const ch of core) {
    const v = decimalValue(ch.codePointAt(0)!);
    if (v < 0) throw new PyValueError(`invalid literal for int() with base 10: ${pyRepr(s)}`);
    n = n * 10 + v;
  }
  if (!core) throw new PyValueError(`invalid literal for int() with base 10: ${pyRepr(s)}`);
  return n;
}

/* ---------- Proleptic Gregorian dates, as Lib/datetime.py computes them ---------- */

const DAYS_IN_MONTH = [-1, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAYS_BEFORE_MONTH = [-1, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const isLeap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
const daysInMonth = (y: number, m: number) => (m === 2 && isLeap(y) ? 29 : DAYS_IN_MONTH[m]!);
const MAX_ORDINAL = 3652059;

function daysBeforeYear(year: number): number {
  const y = year - 1;
  return y * 365 + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400);
}

function checkDate(year: number, month: number, day: number) {
  if (year < 1 || year > 9999) throw new PyValueError(`year ${year} is out of range`);
  if (month < 1 || month > 12) throw new PyValueError("month must be in 1..12");
  const dim = daysInMonth(year, month);
  if (day < 1 || day > dim) throw new PyValueError(`day ${day} must be in range 1..${dim} for month ${month} in year ${year}`);
}

function toOrdinal(year: number, month: number, day: number): number {
  checkDate(year, month, day);
  return daysBeforeYear(year) + DAYS_BEFORE_MONTH[month]! + (month > 2 && isLeap(year) ? 1 : 0) + day;
}

function fromOrdinal(ordinal: number): [number, number, number] {
  if (ordinal < 1) throw new PyValueError("ordinal must be >= 1");
  let n = ordinal - 1;
  const n400 = Math.floor(n / 146097);
  n %= 146097;
  let year = n400 * 400 + 1;
  const n100 = Math.floor(n / 36524);
  n %= 36524;
  const n4 = Math.floor(n / 1461);
  n %= 1461;
  const n1 = Math.floor(n / 365);
  n %= 365;
  year += n100 * 100 + n4 * 4 + n1;
  if (n1 === 4 || n100 === 4) return check([year - 1, 12, 31]);
  const leap = n1 === 3 && (n4 !== 24 || n100 === 3);
  let month = (n + 50) >> 5;
  let preceding = DAYS_BEFORE_MONTH[month]! + (month > 2 && leap ? 1 : 0);
  if (preceding > n) {
    month -= 1;
    preceding -= DAYS_IN_MONTH[month]! + (month === 2 && leap ? 1 : 0);
  }
  return check([year, month, n - preceding + 1]);
  function check(ymd: [number, number, number]): [number, number, number] {
    if (ymd[0] > 9999) throw new PyValueError(`year ${ymd[0]} is out of range`);
    return ymd;
  }
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/**
 * datetime.strptime(value, format), then astimezone(timezone.utc) when it has an offset, then isoformat(): the value
 * the date rule compares. Throws PyValueError when Python raises ValueError, and also when the conversion to UTC
 * leaves the years 1–9999, where Python raises OverflowError and _normalize gives no value either way.
 */
export function normalizeDate(value: string, format: DateFormat | string): string {
  const f = typeof format === "string" ? compileFormat(format) : format;
  const found = f.regex.exec(value);
  if (!found) throw new PyValueError(`time data ${pyRepr(value)} does not match format ${pyRepr(f.format)}`);
  if (found[0].length !== value.length) throw new PyValueError(`unconverted data remains: ${value.slice(found[0].length)}`);
  const g = found.groups ?? {};
  let year: number | null = null;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let fraction = 0;
  let julian: number | null = null;
  let gmtoff: number | null = null;
  let gmtoffFraction = 0;
  for (const key of f.order) {
    const text = g[key];
    switch (key) {
      case "y": {
        const y = pyInt(text!);
        year = y <= 68 ? y + 2000 : y + 1900;
        break;
      }
      case "Y":
        year = pyInt(text!);
        break;
      case "m":
        month = pyInt(text!);
        break;
      case "B":
      case "b": {
        const names = key === "B" ? F_MONTH : A_MONTH;
        const lower = text!.toLowerCase();
        month = names.indexOf(lower);
        if (month < 0) throw new PyValueError(`${pyRepr(lower)} is not in list`);
        break;
      }
      case "d":
        day = pyInt(text!);
        break;
      case "H":
        hour = pyInt(text!);
        break;
      case "I": {
        hour = pyInt(text!);
        const ampm = (g.p ?? "").toLowerCase();
        if (ampm === "pm") {
          if (hour !== 12) hour += 12;
        } else if (hour === 12) hour = 0;
        break;
      }
      case "M":
        minute = pyInt(text!);
        break;
      case "S":
        second = pyInt(text!);
        break;
      case "f":
        fraction = pyInt(text!.padEnd(6, "0"));
        break;
      case "j":
        julian = pyInt(text!);
        break;
      case "z": {
        if (!text) break;
        if (text === "Z") {
          gmtoff = 0;
          break;
        }
        let z = [...text];
        if (z[3] === ":") {
          z = [...z.slice(0, 3), ...z.slice(4)];
          if (z.length > 5) {
            if (z[5] !== ":") throw new PyValueError(`Inconsistent use of : in ${text}`);
            z = [...z.slice(0, 5), ...z.slice(6)];
          }
        }
        const part = (a: number, b: number) => z.slice(a, b).join("");
        const hours = pyInt(part(1, 3));
        const minutes = pyInt(part(3, 5));
        const seconds = part(5, 7) ? pyInt(part(5, 7)) : 0;
        gmtoff = hours * 3600 + minutes * 60 + seconds;
        const rest = part(8, z.length);
        gmtoffFraction = pyInt(rest + "0".repeat(Math.max(0, 6 - rest.length)));
        if (z[0] === "-") {
          gmtoff = -gmtoff;
          gmtoffFraction = -gmtoffFraction;
        }
        break;
      }
      case "p":
        break;
    }
  }
  let leapYearFix = false;
  if (year === null) {
    if (month === 2 && day === 29) {
      year = 1904;
      leapYearFix = true;
    } else year = 1900;
  }
  if (julian === null) {
    toOrdinal(year, month, day);
  } else {
    [year, month, day] = fromOrdinal(julian - 1 + toOrdinal(year, 1, 1));
  }
  toOrdinal(year, month, day); // weekday
  if (leapYearFix) year = 1900;
  checkDate(year, month, day);
  if (second > 59) throw new PyValueError("second must be in 0..59");
  const iso = (y: number, mo: number, d: number, h: number, mi: number, sec: number, us: number) =>
    `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}T${pad(h, 2)}:${pad(mi, 2)}:${pad(sec, 2)}${us ? "." + pad(us, 6) : ""}`;
  if (gmtoff === null) return iso(year, month, day, hour, minute, second, fraction);
  // timezone(timedelta(seconds=gmtoff, microseconds=gmtoff_fraction)) must be strictly within one day.
  const offset = BigInt(gmtoff) * 1_000_000n + BigInt(gmtoffFraction);
  const oneDay = 86_400_000_000n;
  if (offset >= oneDay || offset <= -oneDay) {
    throw new PyValueError("offset must be a timedelta strictly between -timedelta(hours=24) and timedelta(hours=24)");
  }
  // astimezone(timezone.utc) is self - offset, in microseconds; outside the years 1-9999 there is no value to compare.
  const local = BigInt(toOrdinal(year, month, day) * 86400 + hour * 3600 + minute * 60 + second) * 1_000_000n + BigInt(fraction);
  const utc = local - offset;
  const ordinal = Number(utc / oneDay);
  if (utc < oneDay || ordinal > MAX_ORDINAL) throw new PyValueError("date value out of range");
  const inDay = Number((utc % oneDay) / 1_000_000n);
  const [uy, um, ud] = fromOrdinal(ordinal);
  return iso(uy, um, ud, Math.floor(inDay / 3600), Math.floor((inDay % 3600) / 60), inDay % 60, Number(utc % 1_000_000n)) + "+00:00";
}

/** The sample parse_rule renders with strftime and parses back: 2001-02-03 04:05:06.007000 UTC. */
const SAMPLE: Record<Directive, string> = {
  Y: "2001", m: "02", d: "03", H: "04", M: "05", S: "06", f: "007000", z: "+0000", b: "Feb", B: "February", y: "01", p: "AM", I: "04", j: "034", "%": "%",
};

/**
 * The format check in evaluator_v2.parse_rule: datetime.strptime(_DATE_SAMPLE.strftime(fmt), fmt). Throws
 * PyValueError (parse_rule then calls the format malformed) or UnsupportedFormat.
 */
export function checkDateFormat(format: string): DateFormat {
  const compiled = compileFormat(format);
  // Every % in a compiled format starts a supported directive, so strftime sees the same directives.
  const sample = format.replace(/%([\s\S])/gu, (_, d: string) => SAMPLE[d as Directive] ?? "%" + d);
  normalizeDate(sample, compiled);
  return compiled;
}
