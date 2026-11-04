/**
 * Comparing two reports of the same obligation (docs/report-comparison.md): which records became a problem, which
 * stopped being one, which stayed one, and what else the two reports record differently.
 *
 * A comparison is a view of two observations, never a new verdict. It reads the two parsed reports and nothing else:
 * no row is re-evaluated, no record's state is changed, and neither input is modified. It says what each report
 * recorded under the premises each one states; it does not say that a problem was fixed, that data improved, or that
 * a record is correct. Two reports that are not comparable are refused with every reason, and nothing else is given.
 */
import { STATES, type Counts, type RuleResult, type SourceRecord, type State } from "./evaluator";
import { REDACTED, instant, rulesOf, scopeOf, type SavedReport, type StatedPremise } from "./savedReport";

/** The classes of a key found once in each report, or once in one of them; in the order the page lists them. */
export const CLASSES = ["became-problem", "stopped-problem", "still-problem", "still-verified", "only-earlier", "only-later"] as const;
export type RecordClass = (typeof CLASSES)[number];
/** Destination-only keys (scope exact) are never Verified, so a key in both reports is still a problem. */
export const DESTINATION_ONLY_CLASSES = ["still-problem", "only-earlier", "only-later"] as const;
export type DestinationOnlyClass = (typeof DESTINATION_ONLY_CLASSES)[number];

export type NotComparableCode = "different-key" | "different-fields" | "different-rules" | "different-scope" | "different-comparison" | "redacted" | "same-report";

export interface NotComparable {
  code: NotComparableCode;
  message: string;
}

export interface RecordSide {
  source_row: number;
  state: State;
  candidates?: number;
}

/** A rule result that is not the same in the two reports. `changed` names its members that differ. */
export interface RuleChange {
  rule: string;
  earlier: RuleResult;
  later: RuleResult;
  changed: (keyof RuleResult)[];
}

export interface RecordChange {
  key: string;
  earlier: RecordSide | null;
  later: RecordSide | null;
  /**
   * The rule results that differ, for a key in both reports. null when either report does not have this record's
   * rule results (a Verified record under details "problems"), or when the key is in one report only.
   */
  rules: RuleChange[] | null;
  /** Destination rows carrying the key, when both reports give it and the numbers differ. */
  candidates?: [number, number];
}

export interface DestinationOnlySide {
  destination_row: number;
  rows: number;
  state: State;
}

export interface DestinationOnlyChange {
  key: string;
  earlier: DestinationOnlySide | null;
  later: DestinationOnlySide | null;
}

/** A record that cannot be matched by its key, and why. Nothing is guessed for it. */
export interface Unmatched {
  report: "earlier" | "later";
  key: string | null;
  source_row: number;
  state: State;
  /** no-key: the key is empty. repeated-key: the key is on more than one record of one of the reports. */
  reason: "no-key" | "repeated-key";
  /** For repeated-key: how many records carry the key in each report. */
  records?: { earlier: number; later: number };
}

export interface PremiseDifference {
  name: string;
  earlier: StatedPremise | null;
  later: StatedPremise | null;
  /** The stated value differs, or the premise is in one report only. */
  stated: boolean;
  /** The origin differs, or the premise is in one report only. */
  origin: boolean;
}

export interface Change<T> {
  earlier: T;
  later: T;
  changed: boolean;
}

export interface Comparison {
  comparable: true;
  /** chronological: earlier evaluated_at before later; reversed: the person swapped them; same-time: equal. */
  order: "chronological" | "reversed" | "same-time";
  evaluatedAt: Change<string>;
  cohortState: Change<State>;
  counts: { earlier: Counts; later: Counts };
  destinationOnlyCounts: { earlier: Counts; later: Counts } | null;
  sourceRowsObserved: Change<number>;
  sourcePopulationKnown: Change<boolean>;
  destinationCoverageSufficient: Change<boolean>;
  details: { earlier: SavedReport["details"]; later: SavedReport["details"] };
  /** Every premise whose stated value or origin differs, in name order. */
  premiseDifferences: PremiseDifference[];
  digests: { source: Change<string>; destination: Change<string> };
  /** Neither file's digest changed and the premises are the same. */
  sameFilesSamePremises: boolean;
  records: Record<RecordClass, RecordChange[]>;
  /** Records in both reports whose rule-level changes are not available (details "problems"). */
  ruleLevelUnavailable: number;
  destinationOnly: Record<DestinationOnlyClass, DestinationOnlyChange[]> | null;
  unmatched: Unmatched[];
}

export type ComparisonResult = Comparison | { comparable: false; reasons: NotComparable[] };

/* ---------- Comparable or not ---------- */

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const shown = (v: unknown) => JSON.stringify(v);

/** A stated value: true or false, a count (possibly a bigint), or null. Counts compare as numbers. */
function sameStated(a: StatedPremise["stated"], b: StatedPremise["stated"]) {
  if (a === null || b === null || typeof a === "boolean" || typeof b === "boolean") return a === b;
  return BigInt(a) === BigInt(b);
}
const samePremise = (a: StatedPremise, b: StatedPremise) => sameStated(a.stated, b.stated) && a.origin === b.origin && a.observed === b.observed && a.matched === b.matched;

const isRedacted = (r: SavedReport) => r.records.some((x) => x.key === REDACTED) || (r.destination_only ?? []).some((x) => x.key === REDACTED);

function refusals(earlier: SavedReport, later: SavedReport): NotComparable[] {
  const out: NotComparable[] = [];
  const a = earlier.obligation;
  const b = later.obligation;
  if (!same(a.key, b.key)) out.push({ code: "different-key", message: `the key differs: ${shown(a.key)} in the earlier report, ${shown(b.key)} in the later one` });
  if (!same(a.fields, b.fields)) out.push({ code: "different-fields", message: `the compared fields differ: ${shown(a.fields)} in the earlier report, ${shown(b.fields)} in the later one` });
  else if (!same(rulesOf(earlier), rulesOf(later)))
    out.push({ code: "different-rules", message: `the rules differ: ${shown(rulesOf(earlier))} in the earlier report, ${shown(rulesOf(later))} in the later one` });
  if (scopeOf(earlier) !== scopeOf(later)) out.push({ code: "different-scope", message: `the scope differs: ${scopeOf(earlier)} in the earlier report, ${scopeOf(later)} in the later one` });
  if (a.comparison !== b.comparison) out.push({ code: "different-comparison", message: `the comparison differs: ${a.comparison} in the earlier report, ${b.comparison} in the later one` });
  for (const [name, r] of [["earlier", earlier], ["later", later]] as const) {
    if (isRedacted(r)) out.push({ code: "redacted", message: `the ${name} report was written with --redact-values: its keys are ${REDACTED}, so no record can be matched` });
  }
  const names = new Set([...Object.keys(earlier.premises), ...Object.keys(later.premises)]);
  const samePremises = [...names].every((n) => earlier.premises[n] && later.premises[n] && samePremise(earlier.premises[n], later.premises[n]));
  if (earlier.inputs.source_sha256 === later.inputs.source_sha256 && earlier.inputs.destination_sha256 === later.inputs.destination_sha256 && samePremises && earlier.evaluated_at === later.evaluated_at)
    out.push({ code: "same-report", message: "the two are the same report: the same files, premises and evaluation time" });
  return out;
}

/* ---------- Records ---------- */

const side = (r: SourceRecord): RecordSide => (r.candidates === undefined ? { source_row: r.source_row, state: r.state } : { source_row: r.source_row, state: r.state, candidates: r.candidates });
const RULE_MEMBERS: (keyof RuleResult)[] = ["status", "reason", "rule", "expected", "actual", "expected_normalized", "actual_normalized"];

function ruleChanges(earlier: SourceRecord, later: SourceRecord): RuleChange[] | null {
  if (!earlier.rules || !later.rules) return null;
  const out: RuleChange[] = [];
  for (const [rule, a] of Object.entries(earlier.rules)) {
    const b = later.rules[rule];
    if (!b) continue;
    const changed = RULE_MEMBERS.filter((m) => a[m] !== b[m]);
    if (changed.length) out.push({ rule, earlier: a, later: b, changed });
  }
  return out;
}

function classOf(a: State, b: State): RecordClass {
  if (a === "Verified") return b === "Verified" ? "still-verified" : "became-problem";
  return b === "Verified" ? "stopped-problem" : "still-problem";
}

function byKey<T extends { key: string | null }>(items: readonly T[]) {
  const map = new Map<string, T[]>();
  for (const item of items) if (item.key !== null) map.set(item.key, [...(map.get(item.key) ?? []), item]);
  return map;
}

function compareRecords(earlier: SavedReport, later: SavedReport) {
  const records = Object.fromEntries(CLASSES.map((c) => [c, [] as RecordChange[]])) as Record<RecordClass, RecordChange[]>;
  const unmatched: Unmatched[] = [];
  const a = byKey(earlier.records);
  const b = byKey(later.records);
  let unavailable = 0;
  const notMatched = (report: "earlier" | "later", r: SourceRecord) => {
    if (r.key === null) return unmatched.push({ report, key: null, source_row: r.source_row, state: r.state, reason: "no-key" });
    const records = { earlier: a.get(r.key)?.length ?? 0, later: b.get(r.key)?.length ?? 0 };
    unmatched.push({ report, key: r.key, source_row: r.source_row, state: r.state, reason: "repeated-key", records });
  };
  const unique = (map: Map<string, SourceRecord[]>, key: string) => (map.get(key)?.length ?? 0) <= 1;
  for (const r of earlier.records) {
    if (r.key === null || !unique(a, r.key) || !unique(b, r.key)) {
      notMatched("earlier", r);
      continue;
    }
    const other = b.get(r.key)?.[0];
    if (!other) {
      records["only-earlier"].push({ key: r.key, earlier: side(r), later: null, rules: null });
      continue;
    }
    const change: RecordChange = { key: r.key, earlier: side(r), later: side(other), rules: ruleChanges(r, other) };
    if (r.candidates !== undefined && other.candidates !== undefined && r.candidates !== other.candidates) change.candidates = [r.candidates, other.candidates];
    if (change.rules === null) unavailable++;
    records[classOf(r.state, other.state)].push(change);
  }
  for (const r of later.records) {
    if (r.key === null || !unique(a, r.key) || !unique(b, r.key)) notMatched("later", r);
    else if (!a.has(r.key)) records["only-later"].push({ key: r.key, earlier: null, later: side(r), rules: null });
  }
  return { records, unmatched, unavailable };
}

function compareDestinationOnly(earlier: SavedReport, later: SavedReport): Record<DestinationOnlyClass, DestinationOnlyChange[]> | null {
  if (!earlier.destination_only || !later.destination_only) return null;
  const out = Object.fromEntries(DESTINATION_ONLY_CLASSES.map((c) => [c, [] as DestinationOnlyChange[]])) as Record<DestinationOnlyClass, DestinationOnlyChange[]>;
  const sideOf = (r: { destination_row: number; rows: number; state: State }): DestinationOnlySide => ({ destination_row: r.destination_row, rows: r.rows, state: r.state });
  // Each destination-only key is listed once in a report (savedReport.ts refuses a repeat).
  const b = new Map(later.destination_only.map((r) => [r.key, r]));
  const a = new Set(earlier.destination_only.map((r) => r.key));
  for (const r of earlier.destination_only) {
    const other = b.get(r.key);
    out[other ? "still-problem" : "only-earlier"].push({ key: r.key, earlier: sideOf(r), later: other ? sideOf(other) : null });
  }
  for (const r of later.destination_only) if (!a.has(r.key)) out["only-later"].push({ key: r.key, earlier: null, later: sideOf(r) });
  return out;
}

/* ---------- The comparison ---------- */

const change = <T>(earlier: T, later: T): Change<T> => ({ earlier, later, changed: earlier !== later });
const copyCounts = (c: Counts) => Object.fromEntries(STATES.map((s) => [s, c[s]])) as Counts;

/**
 * Compare two reports, `earlier` and `later` in the order the person chose. The page orders them by evaluated_at
 * and lets the person swap them; `order` says whether the two times agree with the order given.
 */
export function compareReports(earlier: SavedReport, later: SavedReport): ComparisonResult {
  const reasons = refusals(earlier, later);
  if (reasons.length) return { comparable: false, reasons };

  const names = [...new Set([...Object.keys(earlier.premises), ...Object.keys(later.premises)])].sort();
  const premiseDifferences: PremiseDifference[] = [];
  for (const name of names) {
    const a = earlier.premises[name] ?? null;
    const b = later.premises[name] ?? null;
    const stated = !a || !b || !sameStated(a.stated, b.stated);
    const origin = !a || !b || a.origin !== b.origin;
    if (stated || origin) premiseDifferences.push({ name, earlier: a, later: b, stated, origin });
  }
  const digests = {
    source: change(earlier.inputs.source_sha256, later.inputs.source_sha256),
    destination: change(earlier.inputs.destination_sha256, later.inputs.destination_sha256),
  };
  const at = [instant(earlier.evaluated_at), instant(later.evaluated_at)] as const;
  const { records, unmatched, unavailable } = compareRecords(earlier, later);
  return {
    comparable: true,
    order: at[0] < at[1] ? "chronological" : at[0] > at[1] ? "reversed" : "same-time",
    evaluatedAt: change(earlier.evaluated_at, later.evaluated_at),
    cohortState: change<State>(earlier.cohort_state, later.cohort_state),
    counts: { earlier: copyCounts(earlier.counts), later: copyCounts(later.counts) },
    destinationOnlyCounts: earlier.destination_only_counts && later.destination_only_counts ? { earlier: copyCounts(earlier.destination_only_counts), later: copyCounts(later.destination_only_counts) } : null,
    sourceRowsObserved: change(earlier.source_rows_observed, later.source_rows_observed),
    sourcePopulationKnown: change(earlier.source_population_known, later.source_population_known),
    destinationCoverageSufficient: change(earlier.destination_coverage_sufficient, later.destination_coverage_sufficient),
    details: { earlier: earlier.details, later: later.details },
    premiseDifferences,
    digests,
    sameFilesSamePremises: !digests.source.changed && !digests.destination.changed && premiseDifferences.length === 0,
    records,
    ruleLevelUnavailable: unavailable,
    destinationOnly: compareDestinationOnly(earlier, later),
    unmatched,
  };
}
