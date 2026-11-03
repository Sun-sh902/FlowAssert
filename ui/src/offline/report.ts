/**
 * The printed summary, the JSON report and the HTML report, with the same text as cli.summary, cli.write_json and
 * cli.write_html: the same members in the same order, json.dumps escaping, html.escape and repr(). The writers yield
 * the text in pieces, one record at a time, as the Python writers write it, so a large report is never one string
 * until the caller joins it (a Blob takes the pieces as they are).
 */
import { STATES, type Details, type EvaluationResult, type Premise, type Records, type State } from "./evaluator";
import { pyDumps, type PyValue } from "./pyjson";
import { compareCodePoints, htmlEscape, pyRepr } from "./pystr";

export const SCHEMA_VERSION = 1;
export const MAX_DETAILS = 50;
export const CLAIM = "At this evaluation, under the stated premises, the supplied destination rows satisfy the rules for the supplied source rows.";
export const LIMITS =
  "Files and completeness statements are not authenticated. Not assessed: whether a workflow ran, whether the source is true, whether a record existed by a past deadline.";
/** Where a premise was stated: the command line, or the CSV check page in the browser. */
export const ORIGINS = { cli: "command-line option", browser: "browser form" } as const;
export type Origin = (typeof ORIGINS)[keyof typeof ORIGINS];

export interface Report extends Omit<EvaluationResult, "premises"> {
  schema_version: number;
  details: Details;
  evaluated_at: string;
  inputs: Record<string, string | boolean>;
  premises: Record<string, Premise>;
  obligation: { type: "current_state"; key: string[]; fields: string[][]; comparison: string; rules?: string[]; scope?: string };
  claim: string | null;
  limitations: string;
}

/** cli.summary: the lines the command-line checker prints. */
export function* summary(report: Report, maxDetails: number | bigint = MAX_DETAILS): Generator<string> {
  const c = report.counts;
  const total = report.expected_total;
  yield `${report.cohort_state}: ${report.source_rows_observed} rows of ${total === null ? "unknown total" : total}`;
  yield `Verified ${c.Verified} · Mismatch ${c.Mismatch} · Unverified ${c.Unverified}`;
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

const HTML_STYLE = `
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0 auto;max-width:72rem;padding:1rem;
color:#1b1f24;background:#fff}
h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:2rem;border-bottom:1px solid #d0d7de}
table{border-collapse:collapse;width:100%;margin:.5rem 0}th,td{border:1px solid #d0d7de;padding:.3rem .5rem;
text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f6f8fa}
.state{display:inline-block;font-size:1.6rem;font-weight:700;padding:.2rem .8rem;border-radius:.3rem}
.Verified{background:#dafbe1;color:#116329}.Mismatch{background:#ffebe9;color:#a40e26}
.Unverified,.Pending{background:#fff8c5;color:#7d4e00}.premises{border:2px solid #7d4e00;padding:.5rem 1rem}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}
`;

type Shown = string | number | bigint | boolean | null | undefined;
/** cli._h */
const h = (value: Shown) => (value === null || value === undefined ? "<i>none</i>" : typeof value === "boolean" ? (value ? "yes" : "no") : htmlEscape(String(value)));
/** cli._v */
const v = (value: string | null | undefined) => (value === null || value === undefined ? "<i>none</i>" : "<code>" + htmlEscape(pyRepr(value)) + "</code>");
const stateClass = (state: string) => ((STATES as readonly string[]).includes(state) ? state : "");

/** cli.write_html: one self-contained page with no scripts that loads nothing. */
export function* writeHtml(report: Report): Generator<string> {
  const state = report.cohort_state;
  yield '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">\n" +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<title>FlowAssert report: ${h(state)}</title>\n<style>${HTML_STYLE}</style>\n</head>\n<body>\n` +
    "<h1>FlowAssert report</h1>\n" +
    `<p><span class="state ${stateClass(state)}">${h(state)}</span></p>\n`;
  const claim = report.claim;
  yield claim ? `<p>${h(claim)}</p>\n` : "<p>No claim is made: the result is not Verified.</p>\n";
  yield `<p>Evaluated at ${h(report.evaluated_at)} by evaluator ${h(report.evaluator)}.</p>\n`;

  yield '<section class="premises">\n<h2>Stated premises</h2>\n' +
    "<p>FlowAssert does not verify these statements. A wrong statement gives a wrong result.</p>\n" +
    "<table>\n<tr><th>Premise</th><th>Stated</th><th>Origin</th><th>Rows in file</th><th>Matched</th></tr>\n";
  for (const [name, premise] of Object.entries(report.premises ?? {})) {
    const observed = "observed" in premise ? h(premise.observed) : "";
    const matched = "matched" in premise ? h(premise.matched) : "";
    yield `<tr><td>${h(name)}</td><td>${h(premise.stated)}</td><td>${h(premise.origin)}</td><td>${observed}</td><td>${matched}</td></tr>\n`;
  }
  yield "</table>\n</section>\n";

  const c = report.counts;
  const total = report.expected_total;
  let out = "<h2>Counts</h2>\n<table>\n";
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
  for (const [label, value] of rows) out += `<tr><th>${h(label)}</th><td>${h(value)}</td></tr>\n`;
  yield out + "</table>\n";

  out = `<h2>Limitations</h2>\n<p>${h(report.limitations)}</p>\n<table>\n`;
  for (const name of ["workflow_execution", "business_truth", "existed_by_deadline", "acquisition_authenticity"] as const) {
    out += `<tr><th>${h(name)}</th><td>${h(report[name])}</td></tr>\n`;
  }
  yield out + "</table>\n";

  const problems = report.records.length - c.Verified;
  yield `<h2>Records that are not Verified (${problems})</h2>\n`;
  if (problems) {
    yield "<table>\n<tr><th>Record</th><th>Key</th><th>State</th><th>Rule</th><th>Status</th><th>Reason</th>" +
      "<th>Expected</th><th>Actual</th><th>Compared as</th></tr>\n";
    for (const record of report.records.problems()) {
      const rules = Object.entries(record.rules ?? {});
      const span = ` rowspan="${rules.length}"`;
      let lead = `<td${span}>${h(record.source_row + 1)}</td><td${span}>${v(record.key)}</td>` +
        `<td${span} class="${stateClass(record.state)}">${h(record.state)}</td>`;
      let text = "";
      for (const [name, rule] of rules) {
        const compared = "expected_normalized" in rule ? `${v(rule.expected_normalized)} vs ${v(rule.actual_normalized)}` : "";
        text += `<tr>${lead}<td>${h(name)}</td><td>${h(rule.status)}</td><td>${h(rule.reason)}</td>` +
          `<td>${"expected" in rule ? v(rule.expected) : ""}</td>` +
          `<td>${"actual" in rule ? v(rule.actual) : ""}</td><td>${compared}</td></tr>\n`;
        lead = "";
      }
      yield text;
    }
    yield "</table>\n";
  }

  if (report.destination_only) {
    const only = report.destination_only;
    yield `<h2>Destination-only records (${only.length})</h2>\n`;
    if (only.length) {
      yield "<table>\n<tr><th>Destination row</th><th>Key</th><th>Rows</th><th>State</th><th>Reason</th></tr>\n";
      for (const record of only) {
        yield `<tr><td>${h(record.destination_row + 1)}</td><td>${v(record.key)}</td>` +
          `<td>${h(record.rows)}</td><td class="${stateClass(record.state)}">` +
          `${h(record.state)}</td><td>${h(record.reason)}</td></tr>\n`;
      }
      yield "</table>\n";
    }
  }

  out = "<h2>Inputs</h2>\n<table>\n";
  for (const [name, value] of Object.entries(report.inputs ?? {})) out += `<tr><th>${h(name)}</th><td>${h(value)}</td></tr>\n`;
  for (const [name, value] of Object.entries(report.obligation ?? {})) {
    out += `<tr><th>obligation ${h(name)}</th><td><code>${h(pyDumps(value as PyValue))}</code></td></tr>\n`;
  }
  yield out + "</table>\n</body>\n</html>\n";
}

/** The records of a report, typed for callers that only read them. */
export type ReportRecords = Records;
export type { State };
