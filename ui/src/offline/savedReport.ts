/**
 * Reading a JSON report (docs/report-format.md, schema_version 1) written by the command line, the GitHub Action, the
 * packaged checker or the CSV check page, so it can be kept in this browser, shown and compared. A file is accepted
 * only when it has every member the format lists, of the right type, and its own numbers agree with each other;
 * otherwise it is refused with the check that failed, and nothing of it is used.
 *
 * Nothing is re-evaluated: a record's state is the report's. The checks only refuse a report that contradicts itself,
 * such as counts that do not add up or a record whose state is not the one its rule results give. Members the format
 * does not list are ignored, as the format asks. The original bytes are kept unchanged beside the parsed value, so a
 * download gives back exactly the file that was read; what the page shows comes from the parsed value.
 *
 * Version 2 is a report whose source the command line read from a Google Sheets range (docs/connectors/google-sheets.md):
 * the same members, with inputs.source_sheet saying where the rows were read. That member is shown as the report
 * records it; nothing here contacts Google, and a sheet source is no more Verified than the same rows in a file.
 *
 * A report read here is not authenticated: its files, statements and numbers are what the file says.
 */
import { MAX_BYTES } from "./csv";
import { Explorer, localStore, rulesOf as explorerRules, type Facts, type RecordStore } from "./explore";
import { EvaluatorError, STATES, VERSION, parseRule, type Counts, type Details, type DestinationOnlyRecord, type Premise, type RuleResult, type SourceRecord, type State } from "./evaluator";
import { DuplicateMember, JsonError, pyLoads, type PyValue } from "./pyjson";
import { pyRepr } from "./pystr";
import { CLAIM, LIMITS, SCHEMA_VERSION } from "./report";
import { SHOWN_RECORDS, type ResultView } from "./runner";

/** The value --redact-values writes in place of every key. */
export const REDACTED = "[redacted]";
/** The record states a report can give; Pending is always 0, because this checker has no waiting window. */
const RECORD_STATES = ["Verified", "Mismatch", "Unverified"] as const;
const RULE_STATUSES = ["pass", "fail", "unknown"] as const;
const ENCODING_NAMES = ["utf-8", "utf-16", "gb18030"] as const;
const NOT_ASSESSED = ["workflow_execution", "business_truth", "existed_by_deadline"] as const;
const SHA256 = /^[0-9a-f]{64}$/;
/** datetime.isoformat() in UTC with "Z": microseconds only when they are not 0. */
const EVALUATED_AT = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(\.\d{6})?Z$/;
/** schema_version 2: the source is a Google Sheets range (offline/flowassert_offline/sheets.py). */
export const SHEET_SCHEMA_VERSION = 2;
/** schema_version 3: the destination is HubSpot's contacts (offline/flowassert_offline/hubspot.py). */
export const HUBSPOT_SCHEMA_VERSION = 3;
const SPREADSHEET_ID = /^[A-Za-z0-9_-]{1,200}$/;
const DRIVE_VERSION = /^[0-9]{1,20}$/;
/** The reasons a sheet read cannot be tied to a revision. */
export const NO_REVISION = ["not requested (--skip-source-revision)", "Google Drive returned no version"] as const;

/** Which check refused the file. */
export type ReportCheck =
  | "size"
  | "encoding"
  | "json"
  | "duplicate-member"
  | "schema-version"
  | "member"
  | "counts"
  | "record-state"
  | "claim"
  | "cohort-state"
  | "destination-only-counts"
  | "premises"
  | "inputs"
  | "obligation";

/** The file is not a valid FlowAssert report. `check` names the check that failed; the message says how. */
export class NotAReport extends Error {
  readonly check: ReportCheck;
  constructor(check: ReportCheck, message: string) {
    super(message);
    this.check = check;
  }
}

export interface DriveRevision {
  version: string;
  modified_time: string | null;
}

/** Where the command line read the source rows of a schema_version 2 report. */
export interface SourceSheet {
  read_by: "FlowAssert";
  service: "Google Sheets API v4";
  spreadsheet_id: string;
  range_requested: string;
  range_returned: string;
  value_render_option: "FORMATTED_VALUE";
  date_time_render_option: "FORMATTED_STRING";
  major_dimension: "ROWS";
  read_at: string;
  revision: { available: true; before: DriveRevision; after: DriveRevision } | { available: false; reason: (typeof NO_REVISION)[number] };
  canonical_form: "flowassert-sheet-csv-1";
}

export interface ReportInputs {
  source_sha256: string;
  destination_sha256: string;
  source_complete_stated: boolean;
  destination_complete_stated: boolean;
  identical_content: boolean;
  identical_content_allowed?: true;
  mapping_file_sha256?: string;
  config_file_sha256?: string;
  source_encoding?: string;
  destination_encoding?: string;
  /** schema_version 2, and 3 when the source was also a sheet. */
  source_sheet?: SourceSheet;
  /** schema_version 3 only. */
  destination_hubspot?: DestinationHubspot;
}

export interface ReportObligation {
  type: "current_state";
  key: [string, string];
  fields: [string, string][];
  comparison: "exact-string" | "per-field-rule";
  rules?: string[];
  scope?: "source" | "exact";
}

export interface StatedPremise extends Premise {
  origin: string;
}

/** Where the command line read the destination rows of a schema_version 3 report: the contacts HubSpot listed. */
export interface DestinationHubspot {
  read_by: "FlowAssert";
  service: "HubSpot CRM API v3";
  object: "contacts";
  properties: string[];
  archived_excluded: true;
  page_limit: 100;
  pages: number;
  rows: number;
  read_at: string;
  read_finished_at: string;
  canonical_form: "flowassert-hubspot-csv-1";
}

/** A schema_version 1 report, with the members docs/report-format.md lists and nothing else. */
export interface SavedReport {
  schema_version: 1 | 2 | 3;
  cohort_state: (typeof RECORD_STATES)[number];
  claim: string | null;
  counts: Counts;
  expected_total: number | null;
  source_rows_observed: number;
  source_population_known: boolean;
  destination_coverage_sufficient: boolean;
  destination_rows_without_key: number;
  records: SourceRecord[];
  destination_only?: DestinationOnlyRecord[];
  destination_only_counts?: Counts;
  details: Details;
  premises: Record<string, StatedPremise>;
  inputs: ReportInputs;
  obligation: ReportObligation;
  evaluator: string;
  evaluated_at: string;
  limitations: string;
  workflow_execution: string;
  business_truth: string;
  existed_by_deadline: string;
  acquisition_authenticity: string;
}

export interface ReadReport {
  report: SavedReport;
  /** The file's bytes, exactly as read. */
  bytes: Uint8Array;
  /** Written with --redact-values: every key is "[redacted]". */
  redacted: boolean;
}

/* ---------- Typed reading, with the path of what failed ---------- */

type Obj = { readonly [key: string]: PyValue };

const fail = (check: ReportCheck, message: string): never => {
  throw new NotAReport(check, message);
};
const isObj = (v: PyValue | undefined): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const describe = (v: PyValue | undefined) =>
  v === undefined ? "missing" : v === null ? "null" : Array.isArray(v) ? "a list" : typeof v === "object" ? "an object" : typeof v === "string" ? `the string ${pyRepr(v)}` : `${String(v)}`;

function member(o: Obj, name: string, path: string): PyValue {
  if (!Object.hasOwn(o, name)) fail("member", `${path}${name} is missing`);
  return o[name]!;
}
function obj(v: PyValue | undefined, path: string): Obj {
  return isObj(v) ? v : fail("member", `${path} must be an object, not ${describe(v)}`);
}
function list(v: PyValue | undefined, path: string): readonly PyValue[] {
  return Array.isArray(v) ? (v as readonly PyValue[]) : fail("member", `${path} must be a list, not ${describe(v)}`);
}
function str(v: PyValue | undefined, path: string): string {
  return typeof v === "string" ? v : fail("member", `${path} must be a string, not ${describe(v)}`);
}
function bool(v: PyValue | undefined, path: string): boolean {
  return typeof v === "boolean" ? v : fail("member", `${path} must be true or false, not ${describe(v)}`);
}
/** A whole number from 0 that the page can count with. */
function count(v: PyValue | undefined, path: string, min = 0): number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min ? v : fail("member", `${path} must be a whole number from ${min}, not ${describe(v)}`);
}
function oneOf<T extends string>(v: PyValue | undefined, path: string, values: readonly T[], check: ReportCheck = "member"): T {
  return typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : fail(check, `${path} must be one of ${values.join(", ")}, not ${describe(v)}`);
}
function nullableStr(v: PyValue | undefined, path: string): string | null {
  return v === null ? null : str(v, path);
}
const sha = (v: PyValue | undefined, path: string) => (SHA256.test(str(v, path)) ? (v as string) : fail("inputs", `${path} must be a SHA-256 digest in lower-case hex`));

function counts(v: PyValue | undefined, path: string): Counts {
  const o = obj(v, path);
  const out = {} as Counts;
  for (const s of STATES) out[s] = count(member(o, s, `${path}.`), `${path}.${s}`);
  return out;
}

const sumOf = (c: Counts) => STATES.reduce((n, s) => n + c[s], 0);
const written = (c: Counts) => STATES.map((s) => `${s} ${c[s]}`).join(" + ");

/* ---------- Parts of a report ---------- */

function obligation(v: PyValue | undefined): ReportObligation {
  const o = obj(v, "obligation");
  if (member(o, "type", "obligation.") !== "current_state") fail("obligation", `obligation.type must be "current_state", not ${describe(o.type)}`);
  const pair = (p: PyValue | undefined, path: string): [string, string] => {
    const items = list(p, path);
    if (items.length !== 2) fail("obligation", `${path} must be a [source column, destination column] pair`);
    return [str(items[0], `${path}[0]`), str(items[1], `${path}[1]`)];
  };
  const key = pair(member(o, "key", "obligation."), "obligation.key");
  const fields = list(member(o, "fields", "obligation."), "obligation.fields").map((f, i) => pair(f, `obligation.fields[${i}]`));
  if (!fields.length) fail("obligation", "obligation.fields is empty");
  if (new Set(fields.map(([s]) => s)).size !== fields.length) fail("obligation", "obligation.fields repeats a source column");
  const comparison = oneOf(member(o, "comparison", "obligation."), "obligation.comparison", ["exact-string", "per-field-rule"] as const, "obligation");
  const out: ReportObligation = { type: "current_state", key, fields, comparison };
  if (Object.hasOwn(o, "rules")) {
    const rules = list(o.rules, "obligation.rules").map((r, i) => str(r, `obligation.rules[${i}]`));
    if (rules.length !== fields.length) fail("obligation", `obligation.rules has ${rules.length} rules for ${fields.length} fields`);
    for (const [i, r] of rules.entries()) {
      try {
        parseRule(r);
      } catch (e) {
        if (e instanceof EvaluatorError) fail("obligation", `obligation.rules[${i}]: ${e.message}`);
        throw e;
      }
    }
    out.rules = rules;
  }
  const exact = (out.rules ?? []).every((r) => r === "exact");
  if (comparison !== (exact ? "exact-string" : "per-field-rule")) fail("obligation", `obligation.comparison is ${comparison}, but the rules are ${exact ? "all exact" : "not all exact"}`);
  if (Object.hasOwn(o, "scope")) out.scope = oneOf(o.scope, "obligation.scope", ["source", "exact"] as const, "obligation");
  return out;
}

function premises(v: PyValue | undefined): Record<string, StatedPremise> {
  const o = obj(v, "premises");
  const out: Record<string, StatedPremise> = {};
  for (const name of ["source_complete", "destination_complete", "source_count", "destination_count"]) member(o, name, "premises.");
  for (const [name, value] of Object.entries(o)) {
    const path = `premises.${name}`;
    const p = obj(value, path);
    const origin = str(member(p, "origin", `${path}.`), `${path}.origin`);
    const stated = member(p, "stated", `${path}.`);
    if (name === "source_count" || name === "destination_count") {
      // A stated count can be larger than any safe integer; pyLoads gives it as a bigint, never rounded.
      if (stated !== null && !(typeof stated === "bigint" && stated >= 0n) && !(typeof stated === "number" && Number.isSafeInteger(stated) && stated >= 0))
        fail("member", `${path}.stated must be a whole number from 0 or null, not ${describe(stated)}`);
      const observed = count(member(p, "observed", `${path}.`), `${path}.observed`);
      const matched = member(p, "matched", `${path}.`);
      if (matched !== null) bool(matched, `${path}.matched`);
      const expected = stated === null ? null : BigInt(stated as number | bigint) === BigInt(observed);
      if (matched !== expected) fail("premises", `${path}.matched is ${describe(matched)}, but stated ${describe(stated)} and observed ${observed} give ${describe(expected)}`);
      out[name] = { stated: stated as number | bigint | null, observed, matched: matched as boolean | null, origin };
    } else if (name === "source_complete" || name === "destination_complete" || name === "allow_identical_content") {
      out[name] = { stated: bool(stated, `${path}.stated`), origin };
      if (name === "allow_identical_content" && stated !== true) fail("premises", `${path}.stated must be true: the premise is present only when it was stated`);
    } else {
      // A premise this reader does not know is still shown, as a statement that FlowAssert did not verify.
      if (stated !== null && typeof stated !== "boolean" && !(typeof stated === "number" && Number.isSafeInteger(stated)))
        fail("member", `${path}.stated must be true, false, a whole number or null, not ${describe(stated)}`);
      out[name] = { stated: stated as boolean | number | null, origin };
    }
  }
  return out;
}

function exactly<T extends string>(o: Obj, name: string, value: T): T {
  const path = `inputs.source_sheet.${name}`;
  if (member(o, name, "inputs.source_sheet.") !== value) fail("inputs", `${path} must be ${pyRepr(value)}, not ${describe(o[name])}`);
  return value;
}

function revisionAt(v: PyValue | undefined, path: string): DriveRevision {
  const o = obj(v, path);
  const version = str(member(o, "version", `${path}.`), `${path}.version`);
  if (!DRIVE_VERSION.test(version)) fail("inputs", `${path}.version must be a whole number written as a string, not ${pyRepr(version)}`);
  return { version, modified_time: nullableStr(member(o, "modified_time", `${path}.`), `${path}.modified_time`) };
}

function sourceSheet(v: PyValue | undefined): SourceSheet {
  const o = obj(v, "inputs.source_sheet");
  const text = (name: string) => str(member(o, name, "inputs.source_sheet."), `inputs.source_sheet.${name}`);
  const id = text("spreadsheet_id");
  if (!SPREADSHEET_ID.test(id)) fail("inputs", `inputs.source_sheet.spreadsheet_id must be letters, digits, - and _, not ${pyRepr(id)}`);
  const readAt = text("read_at");
  if (!EVALUATED_AT.test(readAt) || Number.isNaN(Date.parse(readAt))) fail("inputs", `inputs.source_sheet.read_at must be a UTC time such as 2026-11-02T08:15:30.123456Z, not ${pyRepr(readAt)}`);
  const r = obj(member(o, "revision", "inputs.source_sheet."), "inputs.source_sheet.revision");
  const available = bool(member(r, "available", "inputs.source_sheet.revision."), "inputs.source_sheet.revision.available");
  let revision: SourceSheet["revision"];
  if (available) {
    const before = revisionAt(member(r, "before", "inputs.source_sheet.revision."), "inputs.source_sheet.revision.before");
    const after = revisionAt(member(r, "after", "inputs.source_sheet.revision."), "inputs.source_sheet.revision.after");
    // The command line refuses a read during which the revision changed, so a report never records one.
    if (before.version !== after.version || before.modified_time !== after.modified_time) fail("inputs", "inputs.source_sheet.revision differs before and after the values, which the command line refuses");
    revision = { available: true, before, after };
  } else {
    revision = { available: false, reason: oneOf(member(r, "reason", "inputs.source_sheet.revision."), "inputs.source_sheet.revision.reason", NO_REVISION, "inputs") };
  }
  return {
    read_by: exactly(o, "read_by", "FlowAssert"),
    service: exactly(o, "service", "Google Sheets API v4"),
    spreadsheet_id: id,
    range_requested: text("range_requested"),
    range_returned: text("range_returned"),
    value_render_option: exactly(o, "value_render_option", "FORMATTED_VALUE"),
    date_time_render_option: exactly(o, "date_time_render_option", "FORMATTED_STRING"),
    major_dimension: exactly(o, "major_dimension", "ROWS"),
    read_at: readAt,
    revision,
    canonical_form: exactly(o, "canonical_form", "flowassert-sheet-csv-1"),
  };
}

const HUBSPOT_MEMBERS = ["read_by", "service", "object", "properties", "archived_excluded", "page_limit", "pages", "rows", "read_at", "read_finished_at", "canonical_form"];
const PROPERTY = /^[A-Za-z0-9_]{1,100}$/;

function destinationHubspot(v: PyValue | undefined): DestinationHubspot {
  const o = obj(v, "inputs.destination_hubspot");
  const path = "inputs.destination_hubspot.";
  for (const name of Object.keys(o)) if (!HUBSPOT_MEMBERS.includes(name)) fail("member", `unknown member ${pyRepr(`${path}${name}`)}`);
  const is = <T extends PyValue>(name: string, value: T): T => {
    if (member(o, name, path) !== value) fail("inputs", `${path}${name} must be ${pyRepr(value as string)}, not ${describe(o[name])}`);
    return value;
  };
  const time = (name: string) => {
    const t = str(member(o, name, path), `${path}${name}`);
    if (!EVALUATED_AT.test(t) || Number.isNaN(Date.parse(t))) fail("inputs", `${path}${name} must be a UTC time such as 2026-11-02T08:15:30.123456Z, not ${pyRepr(t)}`);
    return t;
  };
  const properties = list(member(o, "properties", path), `${path}properties`).map((p, i) => {
    const name = str(p, `${path}properties[${i}]`);
    if (!PROPERTY.test(name)) fail("inputs", `${path}properties[${i}] must be letters, digits and _, not ${pyRepr(name)}`);
    return name;
  });
  if (!properties.length) fail("inputs", `${path}properties must name at least one property`);
  const pages = count(member(o, "pages", path), `${path}pages`);
  if (pages < 1) fail("inputs", `${path}pages must be at least 1`);
  const readAt = time("read_at");
  const finishedAt = time("read_finished_at");
  if (finishedAt < readAt) fail("inputs", `${path}read_finished_at is before ${path}read_at`);
  return {
    read_by: is("read_by", "FlowAssert"),
    service: is("service", "HubSpot CRM API v3"),
    object: is("object", "contacts"),
    properties,
    archived_excluded: is("archived_excluded", true),
    page_limit: is("page_limit", 100),
    pages,
    rows: count(member(o, "rows", path), `${path}rows`),
    read_at: readAt,
    read_finished_at: finishedAt,
    canonical_form: is("canonical_form", "flowassert-hubspot-csv-1"),
  };
}

function inputs(v: PyValue | undefined, version: 1 | 2 | 3): ReportInputs {
  const o = obj(v, "inputs");
  const out: ReportInputs = {
    source_sha256: sha(member(o, "source_sha256", "inputs."), "inputs.source_sha256"),
    destination_sha256: sha(member(o, "destination_sha256", "inputs."), "inputs.destination_sha256"),
    source_complete_stated: bool(member(o, "source_complete_stated", "inputs."), "inputs.source_complete_stated"),
    destination_complete_stated: bool(member(o, "destination_complete_stated", "inputs."), "inputs.destination_complete_stated"),
    identical_content: bool(member(o, "identical_content", "inputs."), "inputs.identical_content"),
  };
  if (out.identical_content !== (out.source_sha256 === out.destination_sha256)) fail("inputs", "inputs.identical_content does not agree with the two digests");
  if (Object.hasOwn(o, "identical_content_allowed")) {
    if (o.identical_content_allowed !== true) fail("inputs", "inputs.identical_content_allowed must be true when present");
    out.identical_content_allowed = true;
  }
  if (out.identical_content && !out.identical_content_allowed) fail("inputs", "the two files have identical content, which is refused unless allowed, and inputs.identical_content_allowed is missing");
  for (const name of ["mapping_file_sha256", "config_file_sha256"] as const) if (Object.hasOwn(o, name)) out[name] = sha(o[name], `inputs.${name}`);
  const encodings = ["source_encoding", "destination_encoding"] as const;
  const given = encodings.filter((n) => Object.hasOwn(o, n));
  if (version === HUBSPOT_SCHEMA_VERSION) {
    // The records HubSpot lists have no encoding: only the source's is recorded, when it was chosen for a file.
    if (Object.hasOwn(o, "destination_encoding")) fail("inputs", "inputs.destination_encoding is present, but the destination was read from HubSpot, which has no encoding");
    out.destination_hubspot = destinationHubspot(member(o, "destination_hubspot", "inputs."));
    if (Object.hasOwn(o, "source_sheet")) {
      if (Object.hasOwn(o, "source_encoding")) fail("inputs", "inputs.source_encoding is present, but the source is a Google Sheets range, which has no encoding");
      out.source_sheet = sourceSheet(o.source_sheet);
    }
  } else if (version === SHEET_SCHEMA_VERSION) {
    // A sheet has no encoding: only the destination's is recorded, when it was chosen.
    if (Object.hasOwn(o, "source_encoding")) fail("inputs", "inputs.source_encoding is present, but the source is a Google Sheets range, which has no encoding");
    out.source_sheet = sourceSheet(member(o, "source_sheet", "inputs."));
  } else if (given.length === 1) {
    fail("inputs", `inputs.${given[0]} is present without inputs.${encodings.find((n) => n !== given[0])}: both are recorded`);
  }
  for (const name of given) out[name] = oneOf(o[name], `inputs.${name}`, ENCODING_NAMES, "inputs");
  return out;
}

function ruleResult(v: PyValue | undefined, path: string): RuleResult {
  const o = obj(v, path);
  const out: RuleResult = { status: oneOf(member(o, "status", `${path}.`), `${path}.status`, RULE_STATUSES), reason: str(member(o, "reason", `${path}.`), `${path}.reason`) };
  if (Object.hasOwn(o, "rule")) out.rule = str(o.rule, `${path}.rule`);
  for (const name of ["expected", "actual", "expected_normalized", "actual_normalized"] as const) if (Object.hasOwn(o, name)) out[name] = nullableStr(o[name], `${path}.${name}`);
  return out;
}

/** evaluator._state: Mismatch if any result fails, Verified if every one passes, Unverified otherwise. */
function stateOf(rules: Record<string, RuleResult>): State {
  const values = Object.values(rules).map((r) => r.status);
  if (values.includes("fail")) return "Mismatch";
  return values.length && values.every((s) => s === "pass") ? "Verified" : "Unverified";
}

function record(v: PyValue, i: number, details: Details, ruleNames: string[]): SourceRecord {
  const path = `records[${i}]`;
  const o = obj(v, path);
  const key = nullableStr(member(o, "key", `${path}.`), `${path}.key`);
  const row = count(member(o, "source_row", `${path}.`), `${path}.source_row`);
  if (row !== i) fail("member", `${path}.source_row is ${row}: records are one per source row, in file order`);
  const state = member(o, "state", `${path}.`);
  if (typeof state !== "string" || !(STATES as readonly string[]).includes(state)) fail("record-state", `${path}.state must be one of ${STATES.join(", ")}, not ${describe(state)}`);
  const out: SourceRecord = { key, source_row: row, state: state as State };
  const full = details === "all" || state !== "Verified";
  if (!full) {
    if (Object.hasOwn(o, "candidates") || Object.hasOwn(o, "rules")) fail("member", `${path} is Verified in a report with details "problems", so it has only key, source_row and state`);
    return out;
  }
  out.candidates = count(member(o, "candidates", `${path}.`), `${path}.candidates`);
  const rules = obj(member(o, "rules", `${path}.`), `${path}.rules`);
  const names = Object.keys(rules);
  if (names.length !== ruleNames.length || ruleNames.some((n) => !Object.hasOwn(rules, n)))
    fail("member", `${path}.rules must have ${ruleNames.join(", ")}, not ${names.join(", ") || "nothing"}`);
  out.rules = {};
  for (const name of ruleNames) out.rules[name] = ruleResult(rules[name], `${path}.rules.${name}`);
  const given = stateOf(out.rules);
  if (given !== state) fail("record-state", `${path}.state is ${state as string}, but its rule results give ${given}`);
  return out;
}

function destinationOnly(v: PyValue | undefined, populationKnown: boolean): DestinationOnlyRecord[] {
  const keys = new Set<string>();
  return list(v, "destination_only").map((item, i) => {
    const path = `destination_only[${i}]`;
    const o = obj(item, path);
    const key = str(member(o, "key", `${path}.`), `${path}.key`);
    if (key !== REDACTED && keys.has(key)) fail("destination-only-counts", `${path}.key repeats a destination-only key: each key is listed once`);
    keys.add(key);
    const state = oneOf(member(o, "state", `${path}.`), `${path}.state`, ["Mismatch", "Unverified"] as const, "record-state");
    // The state follows the source population alone: Mismatch when it is known, Unverified otherwise.
    if (state !== (populationKnown ? "Mismatch" : "Unverified"))
      fail("record-state", `${path}.state is ${state}, but a destination-only record is ${populationKnown ? "a Mismatch when" : "Unverified unless"} the source population is known`);
    return {
      key,
      destination_row: count(member(o, "destination_row", `${path}.`), `${path}.destination_row`),
      rows: count(member(o, "rows", `${path}.`), `${path}.rows`, 1),
      state,
      reason: str(member(o, "reason", `${path}.`), `${path}.reason`),
    };
  });
}

/* ---------- The whole report ---------- */

/** Check a parsed JSON value and return it as a report, or throw NotAReport. */
export function reportOf(data: PyValue): SavedReport {
  const o = obj(data, "the report");
  const version = member(o, "schema_version", "");
  if (version !== SCHEMA_VERSION && version !== SHEET_SCHEMA_VERSION && version !== HUBSPOT_SCHEMA_VERSION)
    fail("schema-version", `schema_version must be ${SCHEMA_VERSION}, ${SHEET_SCHEMA_VERSION} or ${HUBSPOT_SCHEMA_VERSION}, not ${describe(version)}`);

  const ob = obligation(member(o, "obligation", ""));
  const details = oneOf(member(o, "details", ""), "details", ["problems", "all"] as const);
  const ruleNames = ["existence", "uniqueness", ...ob.fields.map(([s]) => `field:${s}`)];
  const pr = premises(member(o, "premises", ""));
  const inp = inputs(member(o, "inputs", ""), version as 1 | 2 | 3);

  const rows = count(member(o, "source_rows_observed", ""), "source_rows_observed");
  const c = counts(member(o, "counts", ""), "counts");
  if (sumOf(c) !== rows) fail("counts", `counts do not add up to source_rows_observed: ${written(c)} = ${sumOf(c)}, source_rows_observed ${rows}`);
  if (c.Pending !== 0) fail("counts", `counts.Pending is ${c.Pending}: this checker has no waiting window, so it is always 0`);
  const recordList = list(member(o, "records", ""), "records");
  if (recordList.length !== rows) fail("counts", `records has ${recordList.length} entries for ${rows} source rows`);
  const records = recordList.map((r, i) => record(r, i, details, ruleNames));
  const tally = Object.fromEntries(STATES.map((s) => [s, 0])) as Counts;
  for (const r of records) tally[r.state]++;
  const differs = STATES.filter((s) => tally[s] !== c[s]);
  if (differs.length) fail("counts", `counts do not match the records: ${differs.map((s) => `counts.${s} is ${c[s]}, ${tally[s]} records are ${s}`).join("; ")}`);

  const populationKnown = bool(member(o, "source_population_known", ""), "source_population_known");
  const coverage = bool(member(o, "destination_coverage_sufficient", ""), "destination_coverage_sufficient");
  const keyless = count(member(o, "destination_rows_without_key", ""), "destination_rows_without_key");
  const expectedTotal = member(o, "expected_total", "");
  if (expectedTotal !== null) count(expectedTotal, "expected_total");
  if (expectedTotal !== (populationKnown ? rows : null))
    fail("counts", `expected_total is ${describe(expectedTotal)}, but it is ${populationKnown ? "the number of source rows when" : "null unless"} the source population is known`);

  // The premises and the conclusions drawn from them (evaluator_v2.finish).
  const sourceCount = pr.source_count!;
  const destinationCount = pr.destination_count!;
  if (sourceCount.observed !== rows) fail("premises", `premises.source_count.observed is ${sourceCount.observed}, but source_rows_observed is ${rows}`);
  if (inp.source_complete_stated !== pr.source_complete!.stated) fail("premises", "inputs.source_complete_stated and premises.source_complete.stated differ");
  if (inp.destination_complete_stated !== pr.destination_complete!.stated) fail("premises", "inputs.destination_complete_stated and premises.destination_complete.stated differ");
  if (inp.identical_content && pr.allow_identical_content?.stated !== true) fail("premises", "the two files have identical content, but premises.allow_identical_content is not stated");
  const redacted = records.some((r) => r.key === REDACTED);
  const keys = records.map((r) => r.key);
  const keysUsable = !redacted && keys.every((k) => k !== null) && new Set(keys).size === keys.length;
  const statedSource = pr.source_complete!.stated === true && sourceCount.matched !== false;
  // Redacted keys cannot be checked for gaps and repeats, so for them only the statements are.
  if (populationKnown ? !statedSource || (!redacted && !keysUsable) : statedSource && keysUsable)
    fail("premises", `source_population_known is ${populationKnown}, but the source statements${redacted ? "" : " and keys"} give ${!populationKnown}`);
  const coverageGiven = pr.destination_complete!.stated === true && keyless === 0 && destinationCount.matched !== false;
  if (coverage !== coverageGiven) fail("premises", `destination_coverage_sufficient is ${coverage}, but the destination statements and rows without a key give ${coverageGiven}`);
  if (inp.destination_hubspot && inp.destination_hubspot.rows !== destinationCount.observed)
    fail("premises", `premises.destination_count.observed is ${destinationCount.observed}, but HubSpot listed ${inp.destination_hubspot.rows} records`);
  if (destinationCount.observed! < keyless) fail("premises", `destination_rows_without_key is ${keyless}, more than the ${destinationCount.observed} destination rows`);

  const report: SavedReport = {
    schema_version: version as 1 | 2 | 3,
    cohort_state: "Unverified",
    claim: null,
    counts: c,
    expected_total: expectedTotal as number | null,
    source_rows_observed: rows,
    source_population_known: populationKnown,
    destination_coverage_sufficient: coverage,
    destination_rows_without_key: keyless,
    records,
    details,
    premises: pr,
    inputs: inp,
    obligation: ob,
    evaluator: "",
    evaluated_at: "",
    limitations: LIMITS,
    workflow_execution: "Not assessed",
    business_truth: "Not assessed",
    existed_by_deadline: "Not assessed",
    acquisition_authenticity: "not_authenticated",
  };

  const exact = (ob.scope ?? "source") === "exact";
  for (const name of ["destination_only", "destination_only_counts"]) {
    if (Object.hasOwn(o, name) !== exact) fail("destination-only-counts", `${name} is ${exact ? "missing" : "present"}, but the scope is ${exact ? "exact" : "source"}`);
  }
  if (exact) {
    const only = destinationOnly(o.destination_only, populationKnown);
    const onlyCounts = counts(o.destination_only_counts, "destination_only_counts");
    const given = Object.fromEntries(STATES.map((s) => [s, only.filter((r) => r.state === s).length])) as Counts;
    const wrong = STATES.filter((s) => given[s] !== onlyCounts[s]);
    if (wrong.length)
      fail("destination-only-counts", `destination_only_counts do not match destination_only: ${wrong.map((s) => `destination_only_counts.${s} is ${onlyCounts[s]}, ${given[s]} entries are ${s}`).join("; ")}`);
    report.destination_only = only;
    report.destination_only_counts = onlyCounts;
  }

  // The batch result follows the counts (evaluator_v2.finish), and only Verified carries the claim.
  const cohort = oneOf(member(o, "cohort_state", ""), "cohort_state", RECORD_STATES, "cohort-state");
  const extraMismatch = (report.destination_only_counts?.Mismatch ?? 0) > 0;
  const given = c.Mismatch || extraMismatch ? "Mismatch" : rows > 0 && populationKnown && c.Verified === rows ? "Verified" : "Unverified";
  if (cohort !== given) fail("cohort-state", `cohort_state is ${cohort}, but the counts and the source population give ${given}`);
  report.cohort_state = cohort;
  const claim = member(o, "claim", "");
  if (cohort === "Verified" && claim === null) fail("claim", "cohort_state is Verified, but claim is null");
  if (cohort !== "Verified" && claim !== null) fail("claim", `cohort_state is ${cohort}, so claim must be null`);
  if (claim !== null && claim !== CLAIM) fail("claim", "claim is not the text a Verified report carries");
  report.claim = claim as string | null;

  const evaluator = str(member(o, "evaluator", ""), "evaluator");
  if (evaluator !== VERSION) fail("member", `evaluator is ${pyRepr(evaluator)}; schema_version 1 is written by ${VERSION}`);
  report.evaluator = evaluator;
  const at = str(member(o, "evaluated_at", ""), "evaluated_at");
  if (!EVALUATED_AT.test(at) || Number.isNaN(Date.parse(at))) fail("member", `evaluated_at must be a UTC time such as 2026-11-02T08:15:30.123456Z, not ${pyRepr(at)}`);
  report.evaluated_at = at;
  if (str(member(o, "limitations", ""), "limitations") !== LIMITS) fail("member", "limitations is not the text every report carries");
  for (const name of NOT_ASSESSED) if (str(member(o, name, ""), name) !== "Not assessed") fail("member", `${name} must be "Not assessed"`);
  if (str(member(o, "acquisition_authenticity", ""), "acquisition_authenticity") !== "not_authenticated") fail("member", 'acquisition_authenticity must be "not_authenticated"');
  return report;
}

const decoder = () => new TextDecoder("utf-8", { fatal: true });

/** Read a report from its bytes, as a file named `name`. Throws NotAReport with the file's name in the message. */
export function readReport(bytes: Uint8Array, name: string): ReadReport {
  try {
    if (bytes.length > MAX_BYTES) fail("size", `file size ${bytes.length} bytes exceeds the limit of ${MAX_BYTES} bytes (200 MiB)`);
    let text: string;
    try {
      text = decoder().decode(bytes);
    } catch {
      return fail("encoding", "not UTF-8");
    }
    let data: PyValue;
    try {
      data = pyLoads(text);
    } catch (e) {
      if (e instanceof DuplicateMember) return fail("duplicate-member", `duplicate member ${pyRepr(e.member)}`);
      if (e instanceof JsonError) return fail("json", `invalid JSON (${e.message})`);
      throw e;
    }
    const report = reportOf(data);
    const redacted = report.records.some((r) => r.key === REDACTED) || (report.destination_only ?? []).some((r) => r.key === REDACTED);
    return { report, bytes, redacted };
  } catch (e) {
    if (e instanceof NotAReport) throw new NotAReport(e.check, `${name}: ${e.message}`);
    throw e;
  }
}

/** Read a chosen file: its size is checked before any of it is read. */
export async function readReportFile(file: Blob & { name: string }): Promise<ReadReport> {
  if (file.size > MAX_BYTES) throw new NotAReport("size", `${file.name}: file size ${file.size} bytes exceeds the limit of ${MAX_BYTES} bytes (200 MiB)`);
  return readReport(new Uint8Array(await file.arrayBuffer()), file.name);
}

/* ---------- What the pages show ---------- */

/** A report's time as one string that sorts in time order: microseconds always written. */
export const instant = (evaluatedAt: string) => (evaluatedAt.includes(".") ? evaluatedAt : evaluatedAt.replace("Z", ".000000Z"));

/** The rules each field is compared with: written in the report, or exact for every field when it does not say. */
export const rulesOf = (report: SavedReport) => report.obligation.rules ?? report.obligation.fields.map(() => "exact");
/** The scope: written in the report, or source when it does not say. */
export const scopeOf = (report: SavedReport) => report.obligation.scope ?? "source";

/** What the CSV check page shows of a result, from a report read here. */
export function viewOf(report: SavedReport): ResultView {
  const problems = report.records.filter((r) => r.state !== "Verified");
  return {
    cohort: report.cohort_state,
    claim: report.claim,
    counts: report.counts,
    expectedTotal: report.expected_total,
    sourceRows: report.source_rows_observed,
    populationKnown: report.source_population_known,
    coverageSufficient: report.destination_coverage_sufficient,
    destinationRowsWithoutKey: report.destination_rows_without_key,
    premises: Object.entries(report.premises),
    limitations: report.limitations,
    problems: problems.slice(0, SHOWN_RECORDS),
    problemCount: problems.length,
    destinationOnly: report.destination_only ? report.destination_only.slice(0, SHOWN_RECORDS) : null,
    destinationOnlyCount: report.destination_only?.length ?? 0,
    destinationOnlyCounts: report.destination_only_counts ?? null,
    // The plain members: inputs.source_sheet (schema_version 2) is an object, shown on its own.
    inputs: Object.entries(report.inputs).filter((e): e is [string, string | boolean] => typeof e[1] === "string" || typeof e[1] === "boolean"),
    facts: factsOfSaved(report),
  };
}

/** What the result explorer needs of a report read here. */
export const factsOfSaved = (report: SavedReport): Facts => ({
  total: report.records.length,
  destinationOnlyTotal: report.destination_only ? report.destination_only.length : null,
  rules: explorerRules(report.obligation.fields),
  details: report.details,
  redacted: report.records.some((r) => r.key === REDACTED) || (report.destination_only ?? []).some((r) => r.key === REDACTED),
});

/** The result explorer over a report read here: its records are in memory already. */
export const storeOfSaved = (report: SavedReport): RecordStore =>
  localStore(new Explorer({ length: report.records.length, at: (p) => report.records[p]!, destinationOnly: report.destination_only ?? null }, factsOfSaved(report)));
