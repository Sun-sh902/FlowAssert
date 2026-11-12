/**
 * The printed summary, the JSON report and the HTML report, with the same text as cli.summary, cli.write_json and
 * cli.write_html: the same members in the same order, json.dumps escaping, html.escape and repr(). The writers yield
 * the text in pieces, one record at a time, as the Python writers write it, so a large report is never one string
 * until the caller joins it (a Blob takes the pieces as they are).
 */
import { align, codePoint, codePoints, pieces, type Run } from "./chardiff";
import { STATES, type Details, type EvaluationResult, type Premise, type Records, type RuleResult, type State } from "./evaluator";
import { pyDumps, type PyValue } from "./pyjson";
import { compareCodePoints, htmlEscape, pyRepr } from "./pystr";
import type { WorkbookMember } from "./xlsx";

export const SCHEMA_VERSION = 1;
/** A report in which either side was read from an .xlsx workbook (cli.WORKBOOK_SCHEMA_VERSION). */
export const WORKBOOK_SCHEMA_VERSION = 4;
export const MAX_DETAILS = 50;
export const CLAIM = "At this evaluation, under the stated premises, the supplied destination rows satisfy the rules for the supplied source rows.";
export const LIMITS =
  "Files and completeness statements are not authenticated. Not assessed: whether a workflow ran, whether the source is true, whether a record existed by a past deadline.";
/**
 * Where a premise was stated: the command line, the CSV check page in the browser, or a program calling the packaged
 * checker (api.ts), which says whether it is any JavaScript, the n8n example's Code node, or the n8n community node
 * (1.1.0).
 */
export const ORIGINS = { cli: "command-line option", browser: "browser form", javascript: "JavaScript call", n8n: "n8n Code node", n8nNode: "n8n node" } as const;
export type Origin = (typeof ORIGINS)[keyof typeof ORIGINS];

export interface Report extends Omit<EvaluationResult, "premises"> {
  schema_version: number;
  details: Details;
  evaluated_at: string;
  inputs: Record<string, string | boolean | WorkbookMember>;
  premises: Record<string, Premise>;
  obligation: { type: "current_state"; key: string[]; fields: string[][]; comparison: string; rules?: string[]; scope?: string };
  claim: string | null;
  limitations: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** cli.workbook_lines: what the summary says of a side read from a workbook. */
export function* workbookLines(label: string, book: WorkbookMember): Generator<string> {
  yield `${label} read from worksheet ${pyRepr(book.worksheet)} of an .xlsx workbook: cells as stored, not as displayed.`;
  const cells = book.cells;
  const parts = (
    [
      ["number", "number", "numbers"],
      ["percentage", "percentage as a fraction", "percentages as fractions"],
      ["date_time", "date or time in ISO 8601", "dates or times in ISO 8601"],
      ["duration", "duration in days", "durations in days"],
      ["boolean", "boolean as TRUE or FALSE", "booleans as TRUE or FALSE"],
      ["formula", "formula result as last saved", "formula results as last saved"],
    ] as const
  )
    .filter(([name]) => cells[name])
    .map(([name, one, many]) => plural(cells[name], one, many));
  if (parts.length) yield `  Read as stored, where a spreadsheet may display them otherwise: ${parts.join(", ")}.`;
  const sentences: string[] = [];
  const hidden = (
    [
      ["hidden_rows", "row", "rows"],
      ["hidden_columns", "column", "columns"],
    ] as const
  )
    .filter(([name]) => book[name])
    .map(([name, one, many]) => plural(book[name], one, many));
  if (hidden.length) sentences.push(`Hidden: ${hidden.join(", ")}, read like any other.`);
  if (book.merged_ranges) sentences.push(`Merged ranges: ${book.merged_ranges}, read as stored: only the first cell of each holds the value.`);
  if (sentences.length) yield "  " + sentences.join(" ");
}

const WORKBOOK_SIDES = [
  ["source_workbook", "Source"],
  ["destination_workbook", "Destination"],
] as const;
const workbookOf = (report: Report, side: string) => report.inputs?.[side] as WorkbookMember | undefined;

/** cli.summary: the lines the command-line checker prints. */
export function* summary(report: Report, maxDetails: number | bigint = MAX_DETAILS): Generator<string> {
  const c = report.counts;
  const total = report.expected_total;
  yield `${report.cohort_state}: ${report.source_rows_observed} rows of ${total === null ? "unknown total" : total}`;
  yield `Verified ${c.Verified} · Mismatch ${c.Mismatch} · Unverified ${c.Unverified}`;
  for (const [side, label] of WORKBOOK_SIDES) {
    const book = workbookOf(report, side);
    if (book) yield* workbookLines(label, book);
  }
  if (report.inputs?.identical_content) yield "Source and destination files were identical (--allow-identical-content).";
  const premises = report.premises ?? {};
  for (const [name, label, consequence] of [
    ["source_count", "Source", "the batch cannot be Verified"],
    ["destination_count", "Destination", "absence and uniqueness stay unknown"],
  ] as const) {
    const count = premises[name];
    if (count?.matched === false) yield `${label} count stated ${String(count.stated)}, file has ${count.observed} rows: ${consequence}.`;
  }
  if (!report.source_population_known) yield "Source population unknown: the batch cannot be Verified.";
  if (!report.destination_coverage_sufficient) yield "Destination coverage not established: absence and uniqueness stay unknown.";
  if (report.destination_only) {
    const n = report.destination_only.length;
    if (!n) yield "Destination-only: 0 records not in the source.";
    else if (report.source_population_known) yield `Destination-only: ${n} records not in the source, each a Mismatch.`;
    else yield `Destination-only: ${n} records not in the source, listed without a conclusion.`;
  }
  let shown = 0;
  let omitted = 0;
  for (const record of report.records.problems()) {
    if (BigInt(shown) >= BigInt(maxDetails)) {
      omitted++;
      continue;
    }
    shown++;
    yield `  record ${record.source_row + 1} ${record.key || "(no key)"}: ${record.state}`;
    for (const [name, rule] of Object.entries(record.rules ?? {})) {
      if (rule.status === "pass") continue;
      let values = "expected" in rule ? ` (${pyRepr(rule.expected)} vs ${pyRepr(rule.actual)})` : "";
      if ("expected_normalized" in rule) values += `, compared as (${pyRepr(rule.expected_normalized)} vs ${pyRepr(rule.actual_normalized)})`;
      yield `    ${name} ${rule.status}: ${rule.reason}${values}`;
    }
  }
  if (omitted) yield `... ${omitted} more records not shown; use --json for all of them.`;
  yield report.limitations;
}

/** The summary as printed: its lines and a final line break. */
export const summaryText = (report: Report, maxDetails?: number | bigint) => [...summary(report, maxDetails)].join("\n") + "\n";

const indented = (value: PyValue, prefix: string) => pyDumps(value, { indent: 2, sortKeys: true }).replaceAll("\n", "\n" + prefix);

/** cli.write_json: json.dump(indent=2, sort_keys=True) with schema_version first, one record at a time. */
export function* writeJson(report: Report): Generator<string> {
  yield '{\n  "schema_version": ' + pyDumps(report.schema_version);
  const members = report as unknown as Record<string, unknown>;
  for (const name of Object.keys(members).sort(compareCodePoints)) {
    if (name === "schema_version" || members[name] === undefined) continue;
    yield ",\n  " + pyDumps(name) + ": ";
    if (name !== "records") {
      yield indented(members[name] as PyValue, "  ");
      continue;
    }
    let separator = "[\n    ";
    for (const record of report.records) {
      yield separator + indented(record as unknown as PyValue, "    ");
      separator = ",\n    ";
    }
    yield separator === "[\n    " ? "[]" : "\n  ]";
  }
  yield "\n}";
}

/** cli._HTML_STYLE: the Evidence Atelier palette, light and dark, and a print layout; nothing is loaded. */
const HTML_STYLE = `
:root{color-scheme:light dark;--canvas:#f3efe6;--surface:#fbf9f4;--sunken:#ece6d9;--line:#d8d0bf;--line-2:#e6e0d2;
--line-3:#b9b09c;--ink:#1d1b16;--ink-2:#4b473e;--ink-3:#6d675a;--brand:#2f3590;--brand-soft:#e4e4f1;
--v:#255a3b;--v-soft:#dfe9df;--v-line:#b7cfba;--m:#a23117;--m-soft:#f5e0d6;--m-line:#e7b7a5;--u:#4b473e;
--u-soft:#ebe6da;--u-line:#b9b09c;--p:#845a08;
--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;
--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
@media (prefers-color-scheme:dark){:root{--canvas:#14120e;--surface:#1c1915;--sunken:#110f0c;--line:#34302a;
--line-2:#29261f;--line-3:#4d473d;--ink:#ece6d8;--ink-2:#bdb5a4;--ink-3:#8f8777;--brand:#b4b9ff;
--brand-soft:rgb(154 162 255/.14);--v:#7cc597;--v-soft:rgb(75 162 111/.13);--v-line:rgb(75 162 111/.35);--m:#f0937d;
--m-soft:rgb(226 101 74/.13);--m-line:rgb(226 101 74/.38);--u:#b6ae9d;--u-soft:rgb(138 132 118/.14);--u-line:#4d473d;
--p:#e3b35c}}
*{box-sizing:border-box}
html{background:var(--canvas)}
body{margin:0 auto;max-width:60rem;padding:2rem 1rem 3rem;font:15px/1.55 var(--sans);color:var(--ink);
background:var(--canvas);overflow-wrap:anywhere}
h1,h2,h3{font-family:var(--serif);font-weight:400;line-height:1.2;margin:0}
h2{font-size:1.45rem;margin:2.4rem 0 .5rem;padding-bottom:.35rem;border-bottom:1px solid var(--line)}
h3{font-size:1.08rem}
p{margin:.35rem 0}
code{font-family:var(--mono);font-size:.86em;white-space:pre-wrap}
.kicker{margin:0 0 .5rem;font-size:.72rem;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)}
.verdict{padding:1.4rem 1.5rem 1.2rem;background:var(--surface);border:1px solid var(--line);border-radius:10px}
.seal{display:inline-flex;align-items:center;gap:.5rem;padding:.3rem .9rem .35rem;font-size:2.1rem;border-radius:4px;
border:1.5px solid}
.claim{max-width:44rem;margin-top:.9rem;font-size:1.05rem}
.rows{color:var(--ink-2)}
.counts{display:flex;flex-wrap:wrap;gap:.4rem 1.6rem;margin:.6rem 0 0;padding:0}
.counts div{display:flex;gap:.45rem;align-items:baseline}.counts dt{color:var(--ink-2)}
.counts dd{margin:0;font-family:var(--mono);font-weight:600}
.meta{margin-top:.8rem;font-size:.82rem;color:var(--ink-3)}
.s-Verified{color:var(--v);background:var(--v-soft);border-color:var(--v-line)}
.s-Mismatch{color:var(--m);background:var(--m-soft);border-color:var(--m-line)}
.s-Unverified{color:var(--u);background:var(--u-soft);border-color:var(--u-line)}
.s-Pending{color:var(--p);background:var(--u-soft);border-color:var(--u-line)}
.counts .s-Verified,.counts .s-Mismatch,.counts .s-Unverified{background:none}
.premises{margin-top:1.4rem;padding:.9rem 1.2rem 1rem;border:2px solid var(--u-line);border-radius:10px}
.premises h2{margin-top:0;border:0;padding:0;font-size:1.25rem}
.note{font-size:.86rem;color:var(--ink-3)}
.premise{padding:.55rem 0;border-top:1px solid var(--line-2)}
.premise:first-of-type{border-top:0}
.premise p{margin:.1rem 0}.premise .name{font-weight:600}.premise .name code{font-weight:400;color:var(--ink-3)}
.applied{font-size:.86rem;font-weight:600}.applied.yes{color:var(--v)}.applied.no{color:var(--m)}
.applied.none{color:var(--ink-3);font-weight:400}
table.facts{border-collapse:collapse;width:100%;margin:.4rem 0;font-size:.9rem}
.facts th,.facts td{padding:.32rem .5rem;border-bottom:1px solid var(--line-2);text-align:left;vertical-align:top}
.facts th{width:38%;font-weight:500;color:var(--ink-2)}
.record{margin:.8rem 0;padding:.9rem 1.1rem 1rem;background:var(--surface);border:1px solid var(--line);
border-left:4px solid var(--line-3);border-radius:8px;break-inside:avoid}
.record.s-Mismatch{border-left-color:var(--m-line);color:inherit;background:var(--surface)}
.record.s-Unverified{border-left-color:var(--u-line);color:inherit;background:var(--surface)}
.record h3{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .6rem}
.badge{display:inline-block;padding:.05rem .5rem;font:600 .74rem/1.6 var(--sans);border:1px solid;border-radius:3px}
.carries{font-size:.84rem;color:var(--ink-2)}
.rules{list-style:none;margin:.5rem 0 0;padding:0}
.rule{padding:.55rem 0;border-top:1px solid var(--line-2)}
.rule p{margin:.12rem 0}.rule-head{display:flex;flex-wrap:wrap;gap:.2rem .6rem;align-items:baseline}
.st{font-size:.8rem;font-weight:600}.st-pass{color:var(--v)}.st-fail{color:var(--m)}.st-unknown{color:var(--p)}
.reason{font-size:.86rem;color:var(--ink-3)}
.values{display:grid;grid-template-columns:8.5rem minmax(0,1fr);gap:.15rem .8rem;margin:.35rem 0 0;font-size:.86rem}
.values dt{color:var(--ink-3)}.values dd{margin:0;min-width:0}
.v{color:var(--ink)}.none{color:var(--ink-3);font-style:italic}
.diff{margin:.5rem 0 0;padding:.55rem .75rem;background:var(--sunken);border:1px solid var(--line-2);border-radius:6px}
.diff figcaption{font-size:.7rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.diff dl{display:grid;grid-template-columns:7rem minmax(0,1fr);gap:.2rem .8rem;margin:.35rem 0 0;font-size:.9rem}
.diff dt{color:var(--ink-3)}.diff dd{margin:0;min-width:0}
.cps{display:block;font-family:var(--mono);font-size:.74rem;color:var(--ink-3)}
del{text-decoration:line-through 1.5px var(--m);background:var(--m-soft);color:var(--ink);border-radius:2px}
ins{text-decoration:underline 2px var(--brand);text-underline-offset:3px;background:var(--brand-soft);color:var(--ink);
border-radius:2px}
.tok{display:inline-block;margin:0 1px;padding:0 3px;border:1px dashed var(--line-3);border-radius:3px;
font-size:.8em;line-height:1.35;color:var(--ink-2)}
.aid{font-size:.8rem;color:var(--ink-3)}
@media (max-width:36rem){body{padding:1.2rem .9rem 2rem}.verdict{padding:1rem}.seal{font-size:1.7rem}
.values,.diff dl{grid-template-columns:minmax(0,1fr)}.values dd,.diff dd{margin-bottom:.3rem}.facts th{width:45%}}
@page{margin:16mm 14mm}
@media print{:root{color-scheme:light;--canvas:#fff;--surface:#fff;--sunken:#f6f3ec}
body{max-width:none;padding:0;font-size:10.5pt}html,body{background:#fff}
.verdict,.premises,.record,.diff{-webkit-print-color-adjust:exact;print-color-adjust:exact}
h2{break-after:avoid}.record,.premise,.facts tr{break-inside:avoid}}
`;

const GLYPH: Record<string, string> = { Verified: "\u25cf", Mismatch: "\u25c6", Unverified: "\u25cb", Pending: "\u25d4" };

const PREMISE_LABEL: Record<string, string> = {
  source_complete: "The source is the whole batch",
  destination_complete: "The destination covers the whole object",
  source_count: "Source total in the original system",
  destination_count: "Destination total in the original system",
};

type Shown = string | number | bigint | boolean | null | undefined;
/** cli._h */
const h = (value: Shown) => (value === null || value === undefined ? "<i>none</i>" : typeof value === "boolean" ? (value ? "yes" : "no") : htmlEscape(String(value)));
/** cli._state_class */
const stateClass = (state: string) => ((STATES as readonly string[]).includes(state) ? `s-${state}` : "");

/** cli._drawn */
function drawn(text: string, highlighted: boolean, start: boolean, end: boolean): string {
  let out = "";
  for (const p of pieces(text, highlighted, { start, end })) {
    out += p.token ? `<span class="tok" title="${codePoint(p.ch)}">${htmlEscape(p.text)}</span>` : htmlEscape(p.text);
  }
  return out;
}

/** cli._value */
function value(v: string | null | undefined): string {
  if (v === null || v === undefined) return '<span class="none">none</span>';
  if (v === "") return "<code class=\"v none\">''</code>";
  return `<code class="v">${drawn(v, false, true, true)}</code>`;
}

/** cli._runs */
function runs(list: Run[]): string {
  let out = "";
  list.forEach((r, i) => {
    const inner = drawn(r.text, r.kind !== "same", i === 0, i === list.length - 1);
    out += r.kind === "deleted" ? `<del>${inner}</del>` : r.kind === "inserted" ? `<ins>${inner}</ins>` : inner;
  });
  return out;
}

/** cli._diff */
function diff(source: string, destination: string, caption: string): string {
  const a = align(source, destination);
  let out = `<figure class="diff">\n<figcaption>${caption}</figcaption>\n<dl>\n`;
  for (const [label, list] of [
    ["Source", a.source],
    ["Destination", a.destination],
  ] as const) {
    const points = codePoints(list);
    const listed = points.length ? `<span class="cps">${htmlEscape(points.join(" · "))}</span>` : "";
    out += `<dt>${label}</dt><dd><code class="v">${runs(list)}</code>${listed}</dd>\n`;
  }
  out += "</dl>\n";
  if (a.tooLong) out += '<p class="aid">The values are too long to align character by character, so the differing parts are shown as replaced whole.</p>\n';
  return out + '<p class="aid">This highlights where the two values differ. The rule\u2019s result above is the conclusion.</p>\n</figure>\n';
}

/** cli._rule */
function ruleHtml(name: string, rule: RuleResult): string {
  let out = `<li class="rule">\n<p class="rule-head"><code>${h(name)}</code> <span class="st st-${h(rule.status)}">${h(rule.status)}</span>`;
  if ("rule" in rule) out += ` <code class="reason">${h(rule.rule)}</code>`;
  out += `</p>\n<p class="reason">${h(rule.reason)}</p>\n`;
  if ("expected" in rule) {
    out += `<dl class="values">\n<dt>Source value</dt><dd>${value(rule.expected)}</dd>\n<dt>Destination value</dt><dd>${value(rule.actual)}</dd>\n`;
    if ("expected_normalized" in rule) out += `<dt>Compared as</dt><dd>${value(rule.expected_normalized)} and ${value(rule.actual_normalized)}</dd>\n`;
    out += "</dl>\n";
  }
  const normalised = "expected_normalized" in rule;
  const compared = normalised ? [rule.expected_normalized, rule.actual_normalized] : [rule.expected, rule.actual];
  if (rule.status === "fail" && typeof compared[0] === "string" && typeof compared[1] === "string") {
    out += diff(compared[0], compared[1], normalised ? "Where the compared values differ" : "Where the values differ");
  }
  return out + "</li>\n";
}

const carries = (rows: number) => (rows === 1 ? "1 destination row has this key" : `${rows} destination rows have this key`);
const keyHtml = (key: string | null) => (key === null ? '<span class="none">no key</span>' : `<code>${drawn(key, false, true, true)}</code>`);

/** cli._applied */
function applied(name: string, premise: Premise, premises: Record<string, Premise>): string {
  if (name.endsWith("_complete")) {
    if (premise.stated !== true) return '<p class="applied none">not stated</p>';
    if (premises[name.replace("_complete", "_count")]?.matched === false) return '<p class="applied no">not applied: the stated total differs from the rows read</p>';
    return '<p class="applied yes">applied</p>';
  }
  if (name.endsWith("_count")) {
    if (premise.stated === null || premise.stated === undefined) return '<p class="applied none">not stated</p>';
    if (premise.matched === false) return '<p class="applied no">differs from the rows read</p>';
    return '<p class="applied yes">matches the rows read</p>';
  }
  return "";
}

/** cli.write_html: one self-contained page with no scripts that loads nothing. */
export function* writeHtml(report: Report): Generator<string> {
  const state = report.cohort_state;
  const c = report.counts;
  const total = report.expected_total;
  yield '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">\n" +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta name="color-scheme" content="light dark">\n' +
    `<title>FlowAssert report: ${h(state)}</title>\n<style>${HTML_STYLE}</style>\n</head>\n<body>\n<main>\n` +
    '<header class="verdict">\n<p class="kicker">FlowAssert report</p>\n' +
    `<h1 class="seal ${stateClass(state)}"><span aria-hidden="true">${GLYPH[state] ?? ""}</span> ${h(state)}</h1>\n`;
  const claim = report.claim;
  let out = claim ? `<p class="claim">${h(claim)}</p>\n` : '<p class="claim">No claim is made: the result is not Verified.</p>\n';
  out += `<p class="rows">${h(report.source_rows_observed)} rows of ${total === null ? "unknown total" : h(total)}</p>\n<dl class="counts">\n`;
  for (const name of ["Verified", "Mismatch", "Unverified"] as const) out += `<div class="${stateClass(name)}"><dt>${name}</dt><dd>${h(c[name])}</dd></div>\n`;
  out += `</dl>\n<p class="meta">Evaluated at ${h(report.evaluated_at)} by evaluator ${h(report.evaluator)}.</p>\n</header>\n`;
  yield out;

  const premises = (report.premises ?? {}) as Record<string, Premise & { origin?: string }>;
  out = '<section class="premises">\n<h2>Stated premises</h2>\n<p class="note">FlowAssert does not verify these statements. A wrong statement gives a wrong result.</p>\n';
  for (const [name, premise] of Object.entries(premises)) {
    out += `<div class="premise">\n<p class="name">${h(PREMISE_LABEL[name] ?? name)} <code>${h(name)}</code></p>\n<p>Stated: ${h(premise.stated)} \u00b7 origin: ${h(premise.origin)}`;
    if ("observed" in premise) out += ` \u00b7 rows read: ${h(premise.observed)}`;
    out += `</p>\n${applied(name, premise, premises)}\n</div>\n`;
  }
  yield out + "</section>\n";

  out = '<section>\n<h2>Counts</h2>\n<table class="facts">\n';
  const rows: [string, Shown][] = [
    ["Source rows observed", report.source_rows_observed],
    ["Expected total", total === null ? "unknown" : total],
    ...STATES.map((name): [string, Shown] => [`${name} records`, c[name]]),
    ["Source population known", report.source_population_known],
    ["Destination coverage sufficient", report.destination_coverage_sufficient],
    ["Destination rows without key", report.destination_rows_without_key],
  ];
  if (report.destination_only_counts) {
    const only = report.destination_only_counts;
    rows.push(...STATES.map((name): [string, Shown] => [`Destination-only ${name}`, only[name]]));
  }
  for (const [label, v] of rows) out += `<tr><th>${h(label)}</th><td>${h(v)}</td></tr>\n`;
  yield out + "</table>\n</section>\n";

  const problems = report.records.length - c.Verified;
  yield `<section>\n<h2>Records that are not Verified (${problems})</h2>\n` + (problems ? "" : '<p class="note">Every source record is Verified.</p>\n');
  for (const record of report.records.problems()) {
    let text = `<article class="record ${stateClass(record.state)}">\n` +
      `<h3>Record ${record.source_row + 1} <span aria-hidden="true">\u00b7</span> ${keyHtml(record.key)} ` +
      `<span class="badge ${stateClass(record.state)}">${h(record.state)}</span></h3>\n`;
    if (record.candidates !== undefined) text += `<p class="carries">${carries(record.candidates)}</p>\n`;
    text += '<ul class="rules">\n' + Object.entries(record.rules ?? {}).map(([n, r]) => ruleHtml(n, r)).join("") + "</ul>\n</article>\n";
    yield text;
  }
  yield "</section>\n";

  if (report.destination_only) {
    const only = report.destination_only;
    yield `<section>\n<h2>Destination-only records (${only.length})</h2>\n`;
    for (const record of only) {
      yield `<article class="record ${stateClass(record.state)}">\n` +
        `<h3>Destination row ${record.destination_row + 1} <span aria-hidden="true">\u00b7</span> ` +
        `${keyHtml(record.key)} <span class="badge ${stateClass(record.state)}">${h(record.state)}` +
        `</span></h3>\n<p class="carries">${carries(record.rows)}</p>\n` +
        `<p class="reason">${h(record.reason)}</p>\n</article>\n`;
    }
    yield "</section>\n";
  }

  for (const [side, label] of WORKBOOK_SIDES) {
    const book = workbookOf(report, side);
    if (book) yield workbookHtml(label, book);
  }

  out = `<section>\n<h2>Limitations</h2>\n<p>${h(report.limitations)}</p>\n<table class="facts">\n`;
  for (const name of ["workflow_execution", "business_truth", "existed_by_deadline", "acquisition_authenticity"] as const) {
    out += `<tr><th>${h(name)}</th><td>${h(report[name])}</td></tr>\n`;
  }
  yield out + "</table>\n</section>\n";

  out = '<section>\n<h2>Inputs</h2>\n<table class="facts">\n';
  for (const [name, v] of Object.entries(report.inputs ?? {})) {
    if (typeof v === "object") continue; // a workbook's member has its own section
    out += `<tr><th>${h(name)}</th><td>${h(v)}</td></tr>\n`;
  }
  for (const [name, v] of Object.entries(report.obligation ?? {})) {
    out += `<tr><th>obligation ${h(name)}</th><td><code>${h(pyDumps(v as PyValue))}</code></td></tr>\n`;
  }
  yield out + "</table>\n</section>\n</main>\n</body>\n</html>\n";
}

const WORKBOOK_FACTS = [
  "worksheet", "worksheet_state", "sheets", "date_system", "columns", "rows", "hidden_rows", "hidden_columns", "merged_ranges",
  "values", "file_sha256", "file_bytes", "inflated_bytes", "canonical_form",
] as const;

/** cli._write_workbook */
function workbookHtml(label: string, book: WorkbookMember): string {
  let out =
    `<section>\n<h2>${label} read from an .xlsx workbook</h2>\n` +
    "<p>FlowAssert read one worksheet itself, each cell as it is stored in the file. A spreadsheet can display a cell otherwise: a number through its format, a date as text, a percentage multiplied by 100, a formula's value as calculated again. Dates and times are read in ISO 8601, and a formula's value as the file was last saved.</p>\n";
  for (const line of workbookLines(label, book)) out += `<p>${h(line.trim())}</p>\n`;
  out += '<table class="facts">\n';
  for (const name of WORKBOOK_FACTS) out += `<tr><th>${h(name)}</th><td>${h(book[name])}</td></tr>\n`;
  for (const [name, value] of Object.entries(book.cells)) out += `<tr><th>cells ${h(name)}</th><td>${h(value)}</td></tr>\n`;
  return out + "</table>\n</section>\n";
}

/** The records of a report, typed for callers that only read them. */
export type ReportRecords = Records;
export type { State };
