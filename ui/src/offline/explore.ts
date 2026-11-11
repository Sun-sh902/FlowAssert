/**
 * The result explorer's records (docs/design/1.0-browser.md, "The result explorer"): every record of one report,
 * filtered, searched and sorted, read a window at a time. It reads the records as the report records them and
 * changes none of them; a filter is a way of looking, never a result.
 *
 * One Explorer serves every page. The check page's sits in the check worker, over the records of the report it has just
 * written, built as they are asked for, so a million records are never copied into the page. A saved report's sits in
 * the page, over the records read from its bytes. The page reaches either through RecordStore.
 */
import type { Details, DestinationOnlyRecord, SourceRecord, State, Status } from "./evaluator";

export type { Status };

/** Which records are listed and how. Search is the only part never written to the address. */
export interface Query {
  list: "source" | "destination-only";
  /** A state, "not-verified" for Mismatch and Unverified together, or null for any state. */
  state: StateFilter | null;
  /** A position in Facts.rules, or null for any rule. */
  rule: number | null;
  status: Status | null;
  /** Keys that contain this text, exactly as written. */
  search: string;
  order: "asc" | "desc";
}

export type StateFilter = State | "not-verified";

const stateMatches = (filter: StateFilter | null, state: State) => filter === null || (filter === "not-verified" ? state !== "Verified" : state === filter);

export const ANY: Query = { list: "source", state: null, rule: null, status: null, search: "", order: "asc" };

/** What the explorer knows of a report before it lists a record. */
export interface Facts {
  total: number;
  /** The destination-only records of a report of scope exact, or null for scope source. */
  destinationOnlyTotal: number | null;
  /** The rules of every record in the report's order: existence, uniqueness, then field:SOURCE for each field. */
  rules: string[];
  details: Details;
  /** Keys and values were left out of the report (--redact-values). */
  redacted: boolean;
}

export interface Matched {
  matches: number;
  /** The records of the list the query reads: source records, or destination-only ones. */
  of: number;
  /** Records a rule filter cannot test, because the report holds no rule results for them (details problems). */
  untestable: number;
}

export type Item = { kind: "source"; record: SourceRecord } | { kind: "destination-only"; index: number; record: DestinationOnlyRecord };

/** The records of one report: every source record by position, and the destination-only records. */
export interface RecordAccess {
  length: number;
  at(position: number): SourceRecord;
  /** Faster reads of a record's state and key, where the records are built on demand. */
  stateAt?(position: number): State;
  keyAt?(position: number): string | null;
  destinationOnly: readonly DestinationOnlyRecord[] | null;
}

/** The rules of a report's records, from its obligation. */
export const rulesOf = (fields: readonly (readonly string[])[]) => ["existence", "uniqueness", ...fields.map((f) => `field:${f[0]}`)];

export class Explorer {
  readonly facts: Facts;
  private readonly access: RecordAccess;
  private list: Query["list"] = "source";
  private order: Query["order"] = "asc";
  private matches: Int32Array = new Int32Array(0);

  constructor(access: RecordAccess, facts: Facts) {
    this.access = access;
    this.facts = facts;
    this.query(ANY);
  }

  query(q: Query): Matched {
    this.list = q.list === "destination-only" && this.access.destinationOnly ? "destination-only" : "source";
    this.order = q.order;
    const search = this.facts.redacted ? "" : q.search;
    const found: number[] = [];
    let untestable = 0;
    if (this.list === "destination-only") {
      const only = this.access.destinationOnly!;
      only.forEach((r, i) => {
        if (stateMatches(q.state, r.state) && (!search || r.key.includes(search))) found.push(i);
      });
      this.matches = Int32Array.from(found);
      return { matches: found.length, of: only.length, untestable: 0 };
    }
    const a = this.access;
    const name = q.rule === null ? null : (this.facts.rules[q.rule] ?? null);
    const byRule = name !== null || q.status !== null;
    for (let p = 0; p < a.length; p++) {
      if (q.state !== null && !stateMatches(q.state, a.stateAt ? a.stateAt(p) : a.at(p).state)) continue;
      if (search) {
        const key = a.keyAt ? a.keyAt(p) : a.at(p).key;
        if (key === null || !key.includes(search)) continue;
      }
      if (byRule) {
        const rules = a.at(p).rules;
        if (!rules) {
          untestable++;
          continue;
        }
        const results = name === null ? Object.values(rules) : rules[name] ? [rules[name]] : [];
        if (!results.some((r) => q.status === null || r.status === q.status)) continue;
      }
      found.push(p);
    }
    this.matches = Int32Array.from(found);
    return { matches: found.length, of: a.length, untestable };
  }

  /** `count` matching records from `start`, in the order asked. */
  window(start: number, count: number): Item[] {
    const n = this.matches.length;
    const out: Item[] = [];
    for (let i = Math.max(0, start); i < Math.min(n, start + count); i++) {
      const at = this.matches[this.order === "asc" ? i : n - 1 - i]!;
      out.push(this.list === "source" ? { kind: "source", record: this.access.at(at) } : { kind: "destination-only", index: at, record: this.access.destinationOnly![at]! });
    }
    return out;
  }

  /** Where the record of source row `row` (or the destination-only record `row`) is in the current list, or -1. */
  indexOf(row: number): number {
    const n = this.matches.length;
    // The matches are in ascending order: a binary search.
    let lo = 0;
    let hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = this.matches[mid]!;
      if (v === row) return this.order === "asc" ? mid : n - 1 - mid;
      if (v < row) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
}

/** The same Explorer, reached asynchronously: in the page, or in the check worker (runner.ts). */
export interface RecordStore {
  facts: Facts;
  query(q: Query): Promise<Matched>;
  window(start: number, count: number): Promise<Item[]>;
  indexOf(row: number): Promise<number>;
}

export function localStore(explorer: Explorer): RecordStore {
  return {
    facts: explorer.facts,
    query: (q) => Promise.resolve(explorer.query(q)),
    window: (start, count) => Promise.resolve(explorer.window(start, count)),
    indexOf: (row) => Promise.resolve(explorer.indexOf(row)),
  };
}

/* ---------- The address ---------- */

const STATES: readonly StateFilter[] = ["Verified", "Mismatch", "Unverified", "not-verified"];
const STATUSES: readonly Status[] = ["pass", "fail", "unknown"];

/** A rule's name in the address: e existence, u uniqueness, f1 the first field… Never a column name. */
const ruleParam = (i: number) => (i === 0 ? "e" : i === 1 ? "u" : `f${i - 1}`);

function ruleOf(param: string | null, rules: readonly string[]): number | null {
  if (param === "e") return 0;
  if (param === "u") return 1;
  const m = param ? /^f([1-9][0-9]{0,4})$/.exec(param) : null;
  const i = m ? Number(m[1]) + 1 : -1;
  return i >= 2 && i < rules.length ? i : null;
}

/**
 * The explorer's state as address parameters: numbers and fixed words only, and only where it differs from the view
 * the report opens on (`start`), so an untouched view leaves the address alone.
 */
export function toParams(q: Query, selected: number | null, start: Query = ANY): Record<string, string | null> {
  return {
    list: q.list === "destination-only" ? "destination-only" : null,
    state: q.state === start.state ? null : (q.state ?? "any"),
    rule: q.rule === null ? null : ruleParam(q.rule),
    result: q.status,
    sort: q.order === "desc" ? "desc" : null,
    row: selected === null ? null : String(selected + 1),
  };
}

/** The explorer's state read back from the address; anything unknown is ignored, never guessed. */
export function fromParams(params: URLSearchParams, facts: Facts, start: Query = ANY): { query: Query; selected: number | null } {
  const state = params.get("state");
  const status = params.get("result");
  const list = params.get("list") === "destination-only" && facts.destinationOnlyTotal !== null ? "destination-only" : "source";
  const row = params.get("row");
  const selected = row && /^[1-9][0-9]{0,8}$/.test(row) ? Number(row) - 1 : null;
  return {
    query: {
      list,
      state: state === "any" ? null : STATES.includes(state as StateFilter) ? (state as StateFilter) : start.state,
      rule: list === "source" ? ruleOf(params.get("rule"), facts.rules) : null,
      status: list === "source" && STATUSES.includes(status as Status) ? (status as Status) : null,
      search: "",
      order: params.get("sort") === "desc" ? "desc" : "asc",
    },
    selected: selected !== null && selected < (list === "source" ? facts.total : (facts.destinationOnlyTotal ?? 0)) ? selected : null,
  };
}

/** The address parameters the explorer writes: removed together when a view starts afresh. */
export const EXPLORER_PARAMS = ["list", "state", "rule", "result", "sort", "row"] as const;

/** The address parameters of the page as it is now: everything after the first "?" of the hash. */
export const currentParams = () => {
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  const at = hash.indexOf("?");
  return new URLSearchParams(at === -1 ? "" : hash.slice(at + 1));
};

/** Whether writing `next` would change the explorer's part of the address. */
export const changesAddress = (next: Record<string, string | null>, now: URLSearchParams = currentParams()) =>
  EXPLORER_PARAMS.some((p) => (next[p] ?? null) !== now.get(p));

