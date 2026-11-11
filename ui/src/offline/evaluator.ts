/**
 * Evaluator v2 in TypeScript: offline/flowassert_offline/evaluator_v2.py, line for line, so the browser check and the
 * command-line checker give the same result for the same rows. The Python module is the reference; its docstring is
 * the specification. No React and no DOM here, so a Web Worker and the tests import it directly.
 *
 * Premises are stated by the caller and never authenticated. Without a premise the matching conclusion stays unknown.
 * Rows are consumed once, source first; the source rows are indexed, each destination row is folded into the entry
 * for its key as it is read, and no destination row is kept. Records are built when they are read from the result.
 */
import { pyCasefold, pyRepr, pyStrip } from "./pystr";
import { PyValueError, RepeatedDirective, UnsupportedFormat, checkDateFormat, normalizeDate } from "./strptime";

export const VERSION = "v2-current-state-1";
export const STATES = ["Verified", "Mismatch", "Pending", "Unverified"] as const;
export const SCOPES = ["source", "exact"] as const;
export const DETAILS = ["problems", "all"] as const;
export type State = (typeof STATES)[number];
export type Scope = (typeof SCOPES)[number];
export type Details = (typeof DETAILS)[number];
export type Status = "pass" | "fail" | "unknown";
export type Counts = Record<State, number>;

const EMPTY = "empty value; a missing value is not assumed to be a difference";

/** A ValueError from the evaluator: an invalid rule, scope, count or details level. */
export class EvaluatorError extends Error {}

/** A cell value: a string from the file, or null where the row has no such column (Python's None). */
export type Value = string | null;

export interface RuleResult {
  status: Status;
  reason: string;
  rule?: string;
  expected?: Value;
  actual?: Value;
  expected_normalized?: Value;
  actual_normalized?: Value;
}

export interface SourceRecord {
  key: string | null;
  source_row: number;
  state: State;
  candidates?: number;
  rules?: Record<string, RuleResult>;
}

export interface DestinationOnlyRecord {
  key: string;
  destination_row: number;
  rows: number;
  state: State;
  reason: string;
}

export interface Premise {
  stated: boolean | number | bigint | null;
  observed?: number;
  matched?: boolean | null;
  origin?: string;
}

export interface Obligation {
  key: readonly [string, string];
  fields: readonly (readonly [string, string] | readonly [string, string, unknown])[];
  scope?: unknown;
}

export interface PremiseInput {
  source_complete?: unknown;
  destination_complete?: unknown;
  source_count?: unknown;
  destination_count?: unknown;
}

const key = (value: Value): string | null => (typeof value === "string" && pyStrip(value) ? value : null);
const rule = (status: Status, reason: string, detail: Partial<RuleResult> = {}): RuleResult => ({ status, reason, ...detail });

function stateOf(rules: Record<string, RuleResult>): State {
  const values = Object.values(rules).map((r) => r.status);
  if (values.includes("fail")) return "Mismatch";
  return values.length && values.every((v) => v === "pass") ? "Verified" : "Unverified";
}

/** parse_rule: the rule unchanged if it is valid, else EvaluatorError with Python's message. */
export function parseRule(value: unknown): string {
  if (value === "exact" || value === "trim" || value === "casefold" || value === "digits") return value;
  if (typeof value === "string" && value.startsWith("date:")) {
    const fmt = value.slice(5);
    if (!fmt) throw new EvaluatorError(`date rule ${pyRepr(value)} has no format`);
    if (!fmt.replaceAll("%%", "").includes("%")) throw new EvaluatorError(`date format ${pyRepr(fmt)} has no directive`);
    try {
      checkDateFormat(fmt);
    } catch (e) {
      if (e instanceof UnsupportedFormat || e instanceof RepeatedDirective) throw new EvaluatorError(e.message);
      if (e instanceof PyValueError) throw new EvaluatorError(`malformed date format ${pyRepr(fmt)} (${e.message})`);
      throw e;
    }
    return value;
  }
  const shown = value === null || ["string", "number", "boolean", "bigint"].includes(typeof value) ? pyRepr(value as string | number | null) : JSON.stringify(value);
  throw new EvaluatorError(`unknown comparison rule ${shown}; use exact, trim, casefold, digits or date:FORMAT`);
}

/** _normalize: the value a rule compares, or null when there is nothing to compare. */
function normalize(r: string, value: Value): Value {
  if (typeof value !== "string") return null;
  if (r === "trim") return pyStrip(value);
  if (r === "casefold") return pyCasefold(value);
  if (r === "digits") return value.replace(/[^0-9]/g, "");
  try {
    return normalizeDate(value, r.slice(5));
  } catch (e) {
    if (e instanceof PyValueError) return null;
    throw e;
  }
}

/** _compare: one field under its rule. */
export function compare(expected: Value, actual: Value, r = "exact"): RuleResult {
  if (r === "exact") {
    if (!expected || !actual) return rule("unknown", EMPTY, { expected, actual });
    return rule(expected === actual ? "pass" : "fail", "exact string comparison", { expected, actual });
  }
  const e = normalize(r, expected);
  const a = normalize(r, actual);
  const detail = { rule: r, expected, actual, expected_normalized: e, actual_normalized: a };
  if (!expected || !actual) return rule("unknown", EMPTY, detail);
  let reason: string;
  if (r === "trim") {
    if (!e || !a) return rule("unknown", "empty after trimming whitespace; a missing value is not assumed to be a difference", detail);
    reason = "comparison after trimming leading and trailing whitespace";
  } else if (r === "casefold") {
    reason = "comparison after Unicode case folding";
  } else if (r === "digits") {
    if (!e || !a) return rule("unknown", "no digits to compare", detail);
    reason = "comparison of the digits 0-9 only";
  } else {
    if (e === null || a === null) return rule("unknown", `value does not match date format ${pyRepr(r.slice(5))}`, detail);
    reason = `date comparison with format ${pyRepr(r.slice(5))}`;
  }
  return rule(e === a ? "pass" : "fail", reason, detail);
}

function count(name: string, value: unknown): number | bigint | null {
  if (value === null || value === undefined) return null;
  if ((typeof value === "number" && Number.isInteger(value) && value >= 0) || (typeof value === "bigint" && value >= 0n)) return value;
  throw new EvaluatorError(`${name} must be None or a non-negative integer`);
}

type Field = readonly [string, string, string];

function fieldsOf(obligation: Obligation): Field[] {
  return obligation.fields.map((f) => {
    if (f.length === 2) return [f[0], f[1], "exact"] as const;
    if (f.length === 3) return [f[0], f[1], parseRule(f[2])] as const;
    throw new EvaluatorError("a field is (source, destination) or (source, destination, rule)");
  });
}

/** Whether a stated total equals the rows read: the one comparison, for the check and for the page's warnings before it. */
export const sameCount = (stated: number | bigint, observed: number) => BigInt(stated) === BigInt(observed);

/** The records of one evaluation in source order, each built when it is read. */
export class Records {
  private readonly e: Evaluation;
  private readonly details: Details;
  private readonly redact: boolean;

  constructor(e: Evaluation, details: Details, redact = false) {
    this.e = e;
    this.details = details;
    this.redact = redact;
  }

  get length(): number {
    return this.e.states.length;
  }

  at(position: number): SourceRecord {
    if (position < 0) position += this.length;
    if (position < 0 || position >= this.length) throw new RangeError("record position out of range");
    return this.build(position);
  }

  *[Symbol.iterator](): IterableIterator<SourceRecord> {
    for (let p = 0; p < this.length; p++) yield this.build(p);
  }

  /** The records that are not Verified, in source order. */
  *problems(): IterableIterator<SourceRecord> {
    const states = this.e.states;
    for (let p = 0; p < states.length; p++) if (states[p] !== VERIFIED) yield this.build(p);
  }

  redacted(): Records {
    return new Records(this.e, this.details, true);
  }

  private build(position: number): SourceRecord {
    const record: SourceRecord =
      this.details === "problems" && this.e.states[position] === VERIFIED
        ? { key: this.e.keys[position]!, source_row: position, state: "Verified" }
        : this.e.record(position);
    if (this.redact) {
      record.key = "[redacted]";
      for (const r of Object.values(record.rules ?? {})) {
        delete r.expected;
        delete r.actual;
        delete r.expected_normalized;
        delete r.actual_normalized;
      }
    }
    return record;
  }
}

const CODE: Record<State, number> = { Verified: 0, Mismatch: 1, Pending: 2, Unverified: 3 };
const VERIFIED = CODE.Verified;

export interface EvaluationResult {
  evaluator: string;
  counts: Counts;
  records: Records;
  expected_total: number | null;
  source_rows_observed: number;
  source_population_known: boolean;
  destination_coverage_sufficient: boolean;
  destination_rows_without_key: number;
  workflow_execution: "Not assessed";
  business_truth: "Not assessed";
  existed_by_deadline: "Not assessed";
  acquisition_authenticity: "not_authenticated";
  premises: Record<string, Premise>;
  destination_only?: DestinationOnlyRecord[];
  destination_only_counts?: Counts;
  cohort_state: State;
}

/** One evaluation, fed source rows and then destination rows. */
export class Evaluation {
  readonly sourceKey: string;
  readonly destinationKey: string;
  readonly fields: Field[];
  readonly scope: Scope;
  private readonly sourceComplete: boolean;
  private readonly destinationComplete: boolean;
  private readonly sourceCount: number | bigint | null;
  private readonly destinationCount: number | bigint | null;
  /** Per source row: its key, or null. */
  readonly keys: (string | null)[] = [];
  /** Per compared field: the value of each source row. One array per field, not one per row, to keep a million rows small. */
  private readonly values: Value[][];
  /** key -> position of the first source row with it. */
  private readonly first = new Map<string, number>();
  private readonly repeated = new Set<string>();
  private invalidSourceKeys = 0;
  /** Per first position: destination rows carrying the key. */
  private candidates: Float64Array | null = null;
  /** first position -> destination values, only where they differ from the source. */
  private readonly actual = new Map<number, Value[]>();
  /** key -> [first destination row, rows], only for scope "exact". */
  private readonly destinationOnly = new Map<string, [number, number]>();
  private destinationRows = 0;
  private keyless = 0;
  private sourceCountMatches: boolean | null = null;
  private destinationCountMatches: boolean | null = null;
  private coverage = false;
  states: Uint8Array = new Uint8Array(0);

  constructor(obligation: Obligation, premises: PremiseInput = {}) {
    [this.sourceKey, this.destinationKey] = obligation.key;
    this.fields = fieldsOf(obligation);
    this.values = this.fields.map(() => []);
    const scope = obligation.scope === undefined ? "source" : obligation.scope;
    if (scope !== "source" && scope !== "exact") throw new EvaluatorError(`scope must be one of ${SCOPES.join(", ")}`);
    this.scope = scope;
    this.sourceComplete = premises.source_complete === true;
    this.destinationComplete = premises.destination_complete === true;
    this.sourceCount = count("source_count", premises.source_count);
    this.destinationCount = count("destination_count", premises.destination_count);
  }

  /** add_source, with the row already read as its key and its field values. */
  addSource(keyValue: Value, fieldValues: Value[]) {
    const position = this.keys.length;
    const k = key(keyValue);
    if (k === null) this.invalidSourceKeys++;
    else if (!this.first.has(k)) this.first.set(k, position);
    else this.repeated.add(k);
    this.keys.push(k);
    for (let i = 0; i < this.values.length; i++) this.values[i]!.push(fieldValues[i] ?? null);
  }

  /**
   * What the keys of the source rows read so far say: how many rows, how many without a key, and how many keys more
   * than one row has. finish() draws its conclusions from these same counts; the page's key profile reads them.
   */
  keyFacts(): { rows: number; withoutKey: number; repeatedKeys: number } {
    return { rows: this.keys.length, withoutKey: this.invalidSourceKeys, repeatedKeys: this.repeated.size };
  }

  /** add_destination, with the row already read as its key and its field values. */
  addDestination(keyValue: Value, fieldValues: Value[]) {
    this.candidates ??= new Float64Array(this.keys.length);
    const number = this.destinationRows++;
    const k = key(keyValue);
    if (k === null) {
      this.keyless++;
      return;
    }
    const position = this.first.get(k);
    if (position === undefined) {
      if (this.scope === "exact") {
        const entry = this.destinationOnly.get(k);
        if (entry) entry[1]++;
        else this.destinationOnly.set(k, [number, 1]);
      }
      return;
    }
    this.candidates[position]! += 1;
    if (this.repeated.has(k)) return;
    if (this.candidates[position] === 1) {
      const values = this.values;
      for (let i = 0; i < values.length; i++) {
        if ((fieldValues[i] ?? null) !== values[i]![position]) {
          this.actual.set(position, fieldValues);
          break;
        }
      }
    } else this.actual.delete(position); // no arbitrary candidate is selected
  }

  /** `progress`, when given, is called about every 20,000 records with how many have their state. */
  finish(details: Details, progress?: (done: number, total: number) => void): EvaluationResult {
    this.candidates ??= new Float64Array(this.keys.length);
    const n = this.keys.length;
    this.sourceCountMatches = this.sourceCount === null ? null : sameCount(this.sourceCount, n);
    this.destinationCountMatches = this.destinationCount === null ? null : sameCount(this.destinationCount, this.destinationRows);
    // A destination row that cannot be matched could be the record being looked for.
    this.coverage = this.destinationComplete && this.keyless === 0 && this.destinationCountMatches !== false;
    this.states = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      this.states[p] = CODE[this.record(p).state];
      if (progress && p % 20_000 === 19_999) progress(p + 1, n);
    }
    const counts: Counts = { Verified: 0, Mismatch: 0, Pending: 0, Unverified: 0 };
    for (const code of this.states) counts[STATES[code]!]++;
    const populationKnown = this.sourceComplete && this.invalidSourceKeys === 0 && this.repeated.size === 0 && this.sourceCountMatches !== false;
    const result: EvaluationResult = {
      evaluator: VERSION,
      counts,
      records: new Records(this, details),
      expected_total: populationKnown ? n : null,
      source_rows_observed: n,
      source_population_known: populationKnown,
      destination_coverage_sufficient: this.coverage,
      destination_rows_without_key: this.keyless,
      workflow_execution: "Not assessed",
      business_truth: "Not assessed",
      existed_by_deadline: "Not assessed",
      acquisition_authenticity: "not_authenticated",
      premises: this.premises(),
      cohort_state: "Unverified",
    };
    let extraMismatch = false;
    if (this.scope === "exact") {
      const only = this.destinationOnlyRecords(populationKnown);
      result.destination_only = only;
      const onlyCounts: Counts = { Verified: 0, Mismatch: 0, Pending: 0, Unverified: 0 };
      for (const r of only) onlyCounts[r.state]++;
      result.destination_only_counts = onlyCounts;
      extraMismatch = onlyCounts.Mismatch > 0;
    }
    if (counts.Mismatch || extraMismatch) result.cohort_state = "Mismatch";
    else if (n && populationKnown && counts.Verified === n) result.cohort_state = "Verified";
    return result;
  }

  private premises(): Record<string, Premise> {
    return {
      source_complete: { stated: this.sourceComplete },
      destination_complete: { stated: this.destinationComplete },
      source_count: { stated: this.sourceCount, observed: this.keys.length, matched: this.sourceCountMatches },
      destination_count: { stated: this.destinationCount, observed: this.destinationRows, matched: this.destinationCountMatches },
    };
  }

  private destinationOnlyRecords(populationKnown: boolean): DestinationOnlyRecord[] {
    const [state, reason]: [State, string] = populationKnown
      ? ["Mismatch", "key not in the source, and the source population is known"]
      : ["Unverified", "key not in the source; source population unknown, so no conclusion"];
    return [...this.destinationOnly].map(([k, [number, rows]]) => ({ key: k, destination_row: number, rows, state, reason }));
  }

  record(position: number): SourceRecord {
    const k = this.keys[position]!;
    const names = ["existence", "uniqueness", ...this.fields.map(([s]) => "field:" + s)];
    const rules: Record<string, RuleResult> = {};
    for (const name of names) rules[name] = rule("unknown", "insufficient evidence");
    for (const [s, , r] of this.fields) if (r !== "exact") rules["field:" + s]!.rule = r;
    const candidates = k !== null ? this.candidates![this.first.get(k)!]! : 0;
    if (k === null || this.repeated.has(k)) {
      for (const name of Object.keys(rules)) rules[name]!.reason = "invalid or duplicate source key";
    } else if (candidates > 1) {
      rules.existence = rule("pass", "candidates observed");
      rules.uniqueness = rule("fail", "more than one destination row carries this key");
      for (const [s] of this.fields) rules["field:" + s]!.reason = "no arbitrary candidate selected";
    } else if (candidates) {
      rules.existence = rule("pass", "candidate observed");
      if (this.coverage) rules.uniqueness = rule("pass", "one row in stated complete destination");
      const actual = this.actual.get(position);
      this.fields.forEach(([s, , r], i) => {
        const expected = this.values[i]![position] ?? null;
        rules["field:" + s] = compare(expected, actual ? (actual[i] ?? null) : expected, r);
      });
    } else if (this.coverage) {
      rules.existence = rule("fail", "key not found in stated complete destination");
    } else if (this.destinationComplete && this.keyless === 0 && this.destinationCountMatches === false) {
      rules.existence = rule("unknown", "destination row count differs from the stated count; absence not established");
    } else {
      rules.existence = rule("unknown", "destination not stated complete; absence not established");
    }
    return { key: k, source_row: position, state: stateOf(rules), candidates, rules };
  }
}

/** A row as a mapping: a missing column reads as no value. */
export type RowObject = Readonly<Record<string, unknown>>;

const cell = (row: RowObject, column: string): Value => {
  if (!Object.hasOwn(row, column)) return null;
  const v = row[column];
  if (v === null || typeof v === "string") return v;
  throw new EvaluatorError(`column ${pyRepr(column)} holds a ${typeof v}; rows hold strings`);
};

/**
 * evaluate(): `obligation` is { key: [source, destination], fields: [[source, destination(, rule)], ...] } with an
 * optional scope. Rows are mappings, read once each, source rows first. `details` "all" builds every record in full;
 * "problems" keeps only key, source_row and state for a Verified record.
 */
export function evaluate(
  obligation: Obligation,
  sourceRows: Iterable<RowObject>,
  destinationRows: Iterable<RowObject>,
  premises: PremiseInput & { details?: string } = {},
): EvaluationResult {
  const details = premises.details ?? "all";
  if (details !== "problems" && details !== "all") throw new EvaluatorError(`details must be one of ${DETAILS.join(", ")}`);
  const e = new Evaluation(obligation, premises);
  for (const row of sourceRows) e.addSource(cell(row, e.sourceKey), e.fields.map(([s]) => cell(row, s)));
  for (const row of destinationRows) e.addDestination(cell(row, e.destinationKey), e.fields.map(([, d]) => cell(row, d)));
  return e.finish(details);
}
