/**
 * The result explorer's records (offline/explore.ts). For every golden report:
 *  - the check page's explorer, over the records the check builds as they are asked for, and the saved report's,
 *    over the records read back from the JSON report, list the same records for every filter;
 *  - each filter lists exactly the records a plain reading of the report gives, in row order or its reverse;
 *  - a record is found again by its row.
 * The address holds numbers and fixed words only, never a key or a value.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check } from "../../offline/check";
import { ANY, Explorer, fromParams, toParams, type Facts, type Item, type Query } from "../../offline/explore";
import type { SourceRecord } from "../../offline/evaluator";
import { compareCodePoints } from "../../offline/pystr";
import { accessOf, factsOf } from "../../offline/runner";
import { factsOfSaved, readReport, storeOfSaved, type SavedReport } from "../../offline/savedReport";
import { REPO_ROOT } from "../fixtures/sources";
import { parseArgs } from "./cli-args";

const GOLDEN = join(REPO_ROOT, "offline/golden");
const withReports = readdirSync(GOLDEN).sort(compareCodePoints).filter((n) => existsSync(join(GOLDEN, n, "report.json")));

/** Every query worth asking of a report: each state, each rule with each result, a search, both orders. */
function queries(facts: Facts, report: SavedReport): Query[] {
  const out: Query[] = [];
  for (const order of ["asc", "desc"] as const) {
    for (const state of [null, "Verified", "Mismatch", "Unverified", "not-verified"] as const) out.push({ ...ANY, state, order });
    for (let rule = -1; rule < facts.rules.length; rule++) {
      for (const status of [null, "pass", "fail", "unknown"] as const) out.push({ ...ANY, rule: rule < 0 ? null : rule, status, order });
    }
    const key = report.records.find((r) => r.key)?.key;
    if (key) out.push({ ...ANY, search: key.slice(1, 3), order }, { ...ANY, search: key, state: "not-verified", order });
    if (facts.destinationOnlyTotal !== null) {
      for (const state of [null, "Mismatch", "Unverified"] as const) out.push({ ...ANY, list: "destination-only", state, order });
    }
  }
  return out;
}

/** The records a query lists, by reading the report plainly. */
function plain(report: SavedReport, facts: Facts, q: Query): number[] {
  const stateOk = (s: string) => q.state === null || (q.state === "not-verified" ? s !== "Verified" : s === q.state);
  const search = facts.redacted ? "" : q.search;
  if (q.list === "destination-only") {
    const rows = (report.destination_only ?? []).map((r, i) => [r, i] as const).filter(([r]) => stateOk(r.state) && (!search || r.key.includes(search))).map(([, i]) => i);
    return q.order === "asc" ? rows : rows.reverse();
  }
  const name = q.rule === null ? null : facts.rules[q.rule]!;
  const rows = report.records
    .filter((r) => stateOk(r.state) && (!search || (r.key ?? "").includes(search) && r.key !== null))
    .filter((r) => (name === null && q.status === null) || (r.rules !== undefined && Object.entries(r.rules).some(([n, x]) => (name === null || n === name) && (q.status === null || x.status === q.status))))
    .map((r) => r.source_row);
  return q.order === "asc" ? rows : rows.reverse();
}

const rowOf = (item: Item) => (item.kind === "source" ? item.record.source_row : item.index);

describe("the explorer lists the same records from the check and from the saved report", () => {
  test.each(withReports)("%s", async (name) => {
    const folder = join(GOLDEN, name);
    const args = parseArgs((JSON.parse(readFileSync(join(folder, "case.json"), "utf-8")) as { args: string[] }).args, folder);
    const outcome = await check({ ...args, now: () => "2000-01-01T00:00:00Z" });
    const saved = readReport(new Uint8Array(readFileSync(join(folder, "report.json"))), "report.json").report;
    const facts = factsOfSaved(saved);
    const fromCheck = new Explorer(accessOf(outcome.report!), factsOf(outcome.report!));
    const fromSaved = storeOfSaved(saved);
    // The page never redacts; otherwise the facts are the same.
    expect({ ...fromCheck.facts, redacted: facts.redacted }).toEqual(facts);
    for (const q of queries(facts, saved)) {
      const a = fromCheck.query(q);
      const b = await fromSaved.query(q);
      expect(a).toEqual(b);
      const listed = fromCheck.window(0, a.matches);
      expect(listed).toEqual(await fromSaved.window(0, b.matches));
      expect(listed.map(rowOf)).toEqual(plain(saved, facts, q));
      // A record without rule results is counted, never matched, by a rule filter.
      if (q.list === "source" && (q.rule !== null || q.status !== null)) {
        expect(a.untestable).toBe(saved.records.filter((r) => !r.rules && (q.state === null || r.state === q.state || (q.state === "not-verified" && r.state !== "Verified"))).length);
      }
      for (const [i, item] of listed.entries()) expect(fromCheck.indexOf(rowOf(item))).toBe(i);
      // A window is a slice of the list.
      expect(fromCheck.window(1, 2)).toEqual(listed.slice(1, 3));
    }
  });
});

describe("the explorer's address", () => {
  const facts: Facts = { total: 10, destinationOnlyTotal: 3, rules: ["existence", "uniqueness", "field:phone", "field:email"], details: "problems", redacted: false };

  test("every part round-trips, and a search is never written", () => {
    const q: Query = { list: "source", state: "Mismatch", rule: 3, status: "fail", search: "SYN-0", order: "desc" };
    const params = toParams(q, 4);
    expect(params).toEqual({ list: null, state: "Mismatch", rule: "f2", result: "fail", sort: "desc", row: "5" });
    const back = fromParams(new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]), facts);
    expect(back).toEqual({ query: { ...q, search: "" }, selected: 4 });
    expect(JSON.stringify(params)).not.toContain("SYN");
    expect(JSON.stringify(params)).not.toContain("phone");
  });

  test("anything unknown is ignored, never guessed", () => {
    const back = fromParams(new URLSearchParams("state=verified&rule=f9&result=maybe&row=0&sort=up&list=x"), facts);
    expect(back).toEqual({ query: ANY, selected: null });
    expect(fromParams(new URLSearchParams("row=11"), facts).selected).toBeNull();
    expect(fromParams(new URLSearchParams("list=destination-only&rule=e"), facts).query).toEqual({ ...ANY, list: "destination-only" });
    // What the address does not name is the page's own starting view; "any" names the state the start does not have.
    const start: Query = { ...ANY, state: "not-verified" };
    expect(fromParams(new URLSearchParams(""), facts, start).query.state).toBe("not-verified");
    expect(fromParams(new URLSearchParams("state=any"), facts, start).query.state).toBeNull();
    expect(toParams(start, null, start)).toEqual({ list: null, state: null, rule: null, result: null, sort: null, row: null });
    expect(toParams(ANY, null, start).state).toBe("any");
  });
});

describe("a million records", () => {
  test("are filtered by state and key without building a record, and a window builds only its own", () => {
    const n = 1_000_000;
    let built = 0;
    const states = ["Verified", "Mismatch", "Unverified"] as const;
    const at = (p: number): SourceRecord => (built++, { key: `SYN-${p}`, source_row: p, state: states[p % 3]! });
    const e = new Explorer({ length: n, at, stateAt: (p) => states[p % 3]!, keyAt: (p) => `SYN-${p}`, destinationOnly: null }, { total: n, destinationOnlyTotal: null, rules: ["existence", "uniqueness"], details: "problems", redacted: false });
    const start = performance.now();
    expect(e.query({ ...ANY, state: "Mismatch", search: "99" }).matches).toBeGreaterThan(0);
    expect(built).toBe(0);
    expect(e.window(0, 20)).toHaveLength(20);
    expect(built).toBe(20);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
