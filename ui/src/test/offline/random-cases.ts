/**
 * Test helper: random small check cases from a fixed seed, for the random parity test. Each case is a spec for
 * offline/bench/parity.py: the text of each file with the encoding Python writes it in (and bytes injected to break
 * it, sometimes), and the command-line arguments. Python writes the bytes, so both checkers read the same bytes.
 *
 * The cases lean towards what is easy to get wrong: Unicode case and whitespace, quoting and line endings, every
 * encoding and decoding failure, duplicate and missing keys, every rule and date directive, stated counts in odd
 * forms, scopes, redaction, limits, and malformed files and configurations. Date formats use only the directives the
 * browser supports and never repeat one (a repeated directive is a documented difference; see strptime.ts).
 */

export interface FileSpec {
  text: string;
  encoding: "utf-8" | "utf-8-bom" | "utf-16" | "utf-16-be" | "utf-16-nobom" | "gb18030";
  inject?: [number, string][];
  truncate?: number;
}

export interface CaseSpec {
  files: Record<string, FileSpec>;
  args: string[];
}

/** mulberry32: a small, fixed pseudo-random generator, so a seed always gives the same cases. */
export function random(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const chance = (p: number) => next() < p;
  const shuffle = <T>(items: T[]): T[] => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  };
  return { next, int, pick, chance, shuffle };
}

type Rng = ReturnType<typeof random>;

const COLUMNS = ["id", "key", "k", "phone", "email", "名前", "note", "a b", " pad ", "x,y", 'q"uote', "date", "at", "Σ", "ID", "é", "tel", "n\nl", "😀"];
const WORDS = [
  "Ada", "ada", "ADA", " Ada ", "Grace\t", "Straße", "STRASSE", "strasse", "ΣΑΣ", "σας", "σασ", "ﬁle", "FILE", "file", "İstanbul", "istanbul",
  "ꭰꭱ", "ᎠᎡ", "名字", "Zoë", "zoë", "😀", "<script>alert(1)</script>", "a,b", 'say "hi"', "it's", "line\nbreak", "cr\rlf", "crlf\r\n",
  "　wide　", "wide", "\x85x", "x", "\x1cy", "y", "", " ", "​", "tab\t", "tab", "back\\slash", "\x01", "K", "k", "ǅ", "ǆ",
  "ŉ", "ʼn", "\x7f", "\ufeffbom", "\x00nul", "ḿ", "\ue7c7", "\ue5e5", "€",
];
const DIGITS = ["+1 (212) 555-0101", "12125550101", "555 0102", "5550102", "n/a", "٣١٢", "312", "1٣", "", "  ", "x9y", "9", "00", "0"];
const KEYS = ["K1", "K2", "K3", "K4", "K5", "K6", "K7", "k1", " K1", "K-😀", "Ключ", "", " ", "\t", "　"];
const A_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const F_MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SEPARATORS = ["-", "/", " ", "", "T", "t", ".", "'", "\t", "年", ",", "  ", "　", "%%", ":"];

/** A random date format from the supported directives, sometimes one Python refuses. */
function dateFormat(r: Rng): string {
  const parts: string[] = [];
  const year = r.pick(["%Y", "%Y", "%y", ""]);
  const month = r.pick(["%m", "%m", "%b", "%B", ""]);
  const day = year ? r.pick(["%d", "%d", ""]) : "";
  if (r.chance(0.08)) parts.push("%j");
  for (const p of r.shuffle([year, month, day].filter(Boolean))) parts.push(p);
  const time = r.pick(["", "", "%H:%M", "%H:%M:%S", "%I:%M %p", "%H:%M:%S.%f", "%I%p", "%H%M%S", "%M:%S.%f"]);
  if (time) parts.push(time);
  if (r.chance(0.3)) parts.push("%z");
  if (!parts.length) parts.push("%Y");
  let fmt = parts.map((p, i) => (i ? r.pick(SEPARATORS) : "") + p).join("");
  if (r.chance(0.04)) fmt += r.pick(["%", "%q", "%Q", " %"]);
  if (r.chance(0.03)) fmt = "%d" + r.pick(["/", "-"]) + "%m";
  return fmt;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");
const ARABIC = (s: string) => s.replace(/[0-9]/g, (d) => String.fromCharCode(0x660 + Number(d)));

/** A value written with `fmt`, usually a valid date, sometimes a near miss. */
function dateValue(r: Rng, fmt: string): string {
  const year = r.chance(0.05) ? r.pick([1, 9999, 0, 1900, 2024]) : r.int(1950, 2060);
  const month = r.int(1, 12);
  const day = r.chance(0.05) ? r.pick([29, 30, 31]) : r.int(1, 28);
  const hour = r.int(0, 23);
  const caseOf = (s: string) => r.pick([s, s.toUpperCase(), s.toLowerCase()]);
  let out = fmt.replace(/%([%A-Za-z])/g, (_, d: string) => {
    const lead = (n: number, w: number) => (r.chance(0.2) ? String(n) : pad(n, w));
    switch (d) {
      case "Y": return pad(year, 4);
      case "y": return pad(year % 100, 2);
      case "m": return lead(month, 2);
      case "b": return caseOf(A_MONTH[month - 1]!);
      case "B": return caseOf(F_MONTH[month - 1]!);
      case "d": return lead(day, 2);
      case "H": return lead(hour, 2);
      case "I": return lead(hour % 12 || 12, 2);
      case "p": return caseOf(hour < 12 ? "AM" : "PM");
      case "M": return lead(r.int(0, 59), 2);
      case "S": return lead(r.chance(0.05) ? r.int(60, 61) : r.int(0, 59), 2);
      case "f": return String(r.int(0, 999999)).padStart(6, "0").slice(0, r.int(1, 6));
      case "j": return lead(r.int(1, 366), 3);
      case "z": return r.pick(["Z", "+0000", "-0130", "+05:45", "+01:02:03", "-00:00:30.5", "+2400", "z", "+08:00", "-1200"]);
      case "%": return "%";
      default: return "%" + d;
    }
  });
  if (r.chance(0.05)) out = ARABIC(out);
  if (r.chance(0.05)) out = out + r.pick([" ", "x", "0"]);
  if (r.chance(0.03)) out = out.slice(1);
  return out;
}

function value(r: Rng, rule: string): string {
  if (rule === "digits") return r.pick(DIGITS);
  if (rule.startsWith("date:")) return r.chance(0.9) ? dateValue(r, rule.slice(5)) : r.pick(WORDS);
  return r.pick(WORDS);
}

/** A destination value for a source value: often the same, sometimes equal under the rule, sometimes different. */
function variant(r: Rng, rule: string, v: string, faithful: boolean): string {
  if (faithful ? rule === "exact" || r.chance(0.5) : r.chance(0.55)) return v;
  if (faithful) {
    // Equal under the rule, written differently.
    if (rule === "trim") return r.pick([` ${v}`, `${v}\t`, `\u3000${v}\x85`]);
    if (rule === "casefold") return r.pick([v.toUpperCase(), v.toLowerCase()]);
    if (rule === "digits") return v.replace(/[^0-9]/g, "");
    return v.replace(/^0/, "");
  }
  if (rule === "trim") return r.pick([` ${v}`, `${v}\t`, `　${v}\x85`, v.trim(), v + "x"]);
  if (rule === "casefold") return r.pick([v.toUpperCase(), v.toLowerCase(), v.replace(/ss/g, "ß"), v + "s"]);
  if (rule === "digits") return r.pick([v.replace(/[^0-9]/g, ""), `(${v})`, v + "1", r.pick(DIGITS)]);
  if (rule.startsWith("date:")) return r.chance(0.5) ? dateValue(r, rule.slice(5)) : v.replace(/^0/, "");
  return r.pick(WORDS);
}

function csvCell(r: Rng, cell: string): string {
  const needs = /[",\r\n]/.test(cell) || cell === "";
  if (needs || r.chance(0.1)) return '"' + cell.replace(/"/g, '""') + '"';
  return cell;
}

function csvText(r: Rng, rows: string[][]): string {
  const eol = r.pick(["\n", "\n", "\r\n", "\r"]);
  const lines = rows.map((row) => (row.length === 1 && row[0] === "" ? '""' : row.map((c) => csvCell(r, c)).join(",")));
  const out: string[] = [];
  for (const line of lines) {
    out.push(line);
    if (r.chance(0.05)) out.push("");
  }
  let text = out.join(eol);
  if (r.chance(0.85)) text += eol;
  return text;
}

function encoding(r: Rng): FileSpec["encoding"] {
  const x = r.next();
  if (x < 0.68) return "utf-8";
  if (x < 0.76) return "utf-8-bom";
  if (x < 0.83) return "utf-16";
  if (x < 0.88) return "utf-16-be";
  if (x < 0.99) return "gb18030";
  return "utf-16-nobom";
}

const ARG_ENCODING: Record<FileSpec["encoding"], string> = {
  "utf-8": "utf-8", "utf-8-bom": "utf-8", "utf-16": "utf-16", "utf-16-be": "utf-16", "utf-16-nobom": "utf-16", gb18030: "gb18030",
};

const BREAK: Record<string, string[]> = {
  "utf-8": ["ff", "c3", "e282", "ed a0 80".replace(/ /g, ""), "f4 90 80 80".replace(/ /g, "")],
  "utf-16": ["00d8", "00dc", "41"],
  gb18030: ["80", "ff", "8130", "81"],
};

/** Count forms the command line reads (or refuses): the number, or an odd spelling of it. */
function count(r: Rng, rows: number): string {
  const n = r.chance(0.6) ? rows : Math.max(0, rows + r.pick([-1, 1, 2]));
  if (r.chance(0.12)) return r.pick([`${n}.0`, ` ${n}`, "-1", "x", "١"]); // refused
  return r.pick([String(n), String(n), String(n), `+${n}`, `0_${n}`, `00${n}`]);
}

export function generateCase(seed: number): CaseSpec {
  const r = random(seed);
  const names = r.shuffle([...COLUMNS]);
  const nFields = r.int(1, 3);
  const sourceKey = names[0]!;
  const sourceFields = names.slice(1, 1 + nFields);
  const extra = names.slice(1 + nFields, 1 + nFields + r.int(0, 2));
  const pool = r.shuffle(COLUMNS.filter((c) => !names.slice(0, 1 + nFields).includes(c) || r.chance(0.5)));
  const used = new Set<string>();
  const renamed = (c: string) => {
    let name = r.chance(0.35) ? (pool.pop() ?? c) : c;
    if (used.has(name)) name = c;
    if (used.has(name)) name = c + "_d";
    used.add(name);
    return name;
  };
  const destinationKey = renamed(sourceKey);
  const destinationFields = sourceFields.map(renamed);
  const byConfig = r.chance(0.75);
  // A faithful destination: every source row once, each value equal under its rule, both premises stated.
  const faithful = r.chance(0.2);
  const rules = sourceFields.map(() => (byConfig ? r.pick(["exact", "trim", "casefold", "digits", "date", "date"]) : "exact")).map((x) => (x === "date" ? "date:" + dateFormat(r) : x));

  // Source rows, then destination rows derived from them.
  const source: string[][] = [];
  const keys = faithful ? r.shuffle(KEYS.filter((k) => k.trim())) : [];
  for (let i = r.int(0, 7); i > 0; i--) source.push([faithful ? keys.pop()! : r.pick(KEYS), ...rules.map((rule) => value(r, rule))]);
  let destination: string[][] = [];
  for (const row of source) {
    if (!faithful && r.chance(0.12)) continue;
    const copy = [row[0]!, ...rules.map((rule, i) => variant(r, rule, row[i + 1]!, faithful))];
    destination.push(copy);
    if (!faithful && r.chance(0.1)) destination.push([...copy]);
  }
  for (let i = faithful ? 0 : r.int(0, 2); i > 0; i--) destination.push([r.pick(KEYS), ...rules.map((rule) => value(r, rule))]);
  if (r.chance(0.5)) destination = r.shuffle(destination);

  // Whole files, with the extra columns and the destination's own column order.
  const sourceHeader = [sourceKey, ...sourceFields, ...extra];
  const sourceRows = source.map((row) => [...row, ...extra.map(() => r.pick(WORDS))]);
  const order = r.shuffle([...Array(1 + nFields).keys()]);
  const destinationHeader = order.map((i) => (i === 0 ? destinationKey : destinationFields[i - 1]!));
  const destinationRows = destination.map((row) => order.map((i) => row[i]!));
  if (r.chance(0.02)) sourceHeader.push(sourceHeader[1]!); // a repeated column name
  if (r.chance(0.02)) destinationHeader[0] = destinationHeader[0] + "?"; // a missing column
  if (r.chance(0.02) && sourceRows.length) sourceRows[r.int(0, sourceRows.length - 1)]!.push("extra");
  if (r.chance(0.01)) sourceRows.push([r.pick(KEYS), "x".repeat(r.pick([131072, 131073])), ...Array(sourceHeader.length - 2).fill("y")]);
  let sourceText = csvText(r, [sourceHeader, ...sourceRows]);
  let destinationText = csvText(r, [destinationHeader, ...destinationRows]);
  if (r.chance(0.02)) sourceText += '"unclosed';
  if (r.chance(0.02)) destinationText = destinationText.replace(/\n/, '\n"a"b,');

  const files: Record<string, FileSpec> = {};
  const fileSpec = (text: string): FileSpec => {
    const spec: FileSpec = { text, encoding: encoding(r) };
    if (faithful) return spec;
    const family = spec.encoding.startsWith("utf-16") ? "utf-16" : spec.encoding.startsWith("utf-8") ? "utf-8" : "gb18030";
    if (r.chance(0.03)) spec.inject = [[r.next(), r.pick(BREAK[family]!)]];
    if (r.chance(0.02)) spec.truncate = r.int(1, 3);
    return spec;
  };
  files["source.csv"] = fileSpec(sourceText);
  files["destination.csv"] = r.chance(0.03) ? { ...files["source.csv"] } : fileSpec(destinationText);

  const args = ["--source", "source.csv", "--destination", "destination.csv"];
  for (const [option, file] of [["--source-encoding", files["source.csv"]], ["--destination-encoding", files["destination.csv"]]] as const) {
    const right = ARG_ENCODING[file.encoding];
    if (right !== "utf-8" || r.chance(0.2)) args.push(option, r.chance(0.04) ? r.pick(["utf-8", "gb18030", "utf-16"]) : right);
  }
  if (byConfig) {
    const config: Record<string, unknown> = {
      key: [sourceKey, destinationKey],
      fields: sourceFields.map((s, i) => (rules[i] === "exact" && r.chance(0.5) ? { source: s, destination: destinationFields[i] } : { source: s, destination: destinationFields[i], rule: rules[i] })),
    };
    if (r.chance(0.7)) config.scope = r.pick(["source", "exact"]);
    if (r.chance(0.02)) config[r.pick(["source_complete", "Source-Count", "extra"])] = true;
    files["config.json"] = { text: JSON.stringify(config, null, r.pick([0, 2, 4])) + (r.chance(0.5) ? "\n" : ""), encoding: r.chance(0.1) ? "utf-8-bom" : "utf-8" };
    args.push("--config", "config.json");
  } else {
    const pair = (s: string, d: string) => (s === d && r.chance(0.5) ? s : `${s}:${d}`);
    args.push("--key", pair(sourceKey, destinationKey));
    sourceFields.forEach((s, i) => args.push("--field", pair(s, destinationFields[i]!)));
    if (r.chance(0.3)) args.push("--scope", r.pick(["source", "exact", "exact"]));
  }
  if (faithful || r.chance(0.55)) args.push("--source-complete");
  if (faithful || r.chance(0.55)) args.push("--destination-complete");
  if (r.chance(0.2)) args.push("--source-count", count(r, sourceRows.length));
  if (r.chance(0.2)) args.push("--destination-count", count(r, destinationRows.length));
  if (r.chance(0.1)) args.push("--allow-identical-content");
  if (r.chance(0.3)) args.push("--details", r.chance(0.97) ? "all" : "some");
  if (r.chance(0.15)) args.push("--redact-values");
  if (r.chance(0.2)) args.push("--max-details", String(r.pick([0, 1, 3])));
  if (r.chance(0.04)) args.push("--max-rows", String(r.int(1, 4)));
  if (r.chance(0.02)) args.push("--max-bytes", String(r.int(20, 400)));
  return { files, args };
}
