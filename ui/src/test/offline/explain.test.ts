/**
 * "What this result means" (offline/explain.ts): the points expected for golden reports of every kind, the same points
 * from a check's report and from the saved report of the same JSON, repeated reasons grouped and the list capped, no
 * point that offers a premise as a way to reach Verified.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, type CheckArgs } from "../../offline/check";
import { MAX_POINTS, explain, textsOf, type Explanation, type Part } from "../../offline/explain";
import { compareCodePoints } from "../../offline/pystr";
import { readReport } from "../../offline/savedReport";
import { REPO_ROOT } from "../fixtures/sources";
import { parseArgs } from "./cli-args";

const GOLDEN = join(REPO_ROOT, "offline/golden");
const withReports = readdirSync(GOLDEN)
  .sort(compareCodePoints)
  .filter((name) => existsSync(join(GOLDEN, name, "report.json")));
const argsOf = (name: string) => (JSON.parse(readFileSync(join(GOLDEN, name, "case.json"), "utf-8")) as { args: string[] }).args;

function saved(name: string): Explanation {
  const read = readReport(new Uint8Array(readFileSync(join(GOLDEN, name, "report.json"))), name);
  return explain(read.report, { redacted: read.redacted });
}

const flat = (parts: readonly Part[]) => parts.map((p) => (typeof p === "string" ? p : `«${p.value}»`)).join("");
const point = (e: Explanation, id: string) => {
  const p = e.points.find((x) => x.id === id);
  if (!p) throw new Error(`no point ${id} in ${e.points.map((x) => x.id).join(", ")}`);
  return { text: flat(p.text), detail: p.detail ? flat(p.detail) : "" };
};

/** Each golden report and the points it must give, in order. */
const EXPECTED: Record<string, string[]> = {
  // Verified: what was shown, under which premises, with which rules, and what it does not show.
  "rules-pass": ["verified-records", "verified-premises", "verified-rules", "scope-source", "not-shown"],
  "encoding-utf8-bom": ["verified-records", "verified-premises", "scope-source", "not-shown"],
  // Mismatch: which rules failed for how many records, and where they are listed.
  example: ["mismatch-records", "fail:phone", "fail-missing", "fail-duplicate", "see-records"],
  "rules-fail": ["mismatch-records", "fail:name", "fail:email", "fail:phone", "fail:signed", "fail:at", "fail:code", "see-records", "also", "unknown:date:at"],
  "scope-exact-source-known": [
    "mismatch-records", "fail:note", "fail:名前", "fail-destination-only", "see-records", "also",
    "coverage-not-established", "destination-not-stated", "found-once",
  ],
  // A Mismatch with what else is not established.
  "example-without-premises": [
    "mismatch-records", "fail:phone", "fail-duplicate", "see-records", "also",
    "population-unknown", "source-not-stated", "coverage-not-established", "destination-not-stated", "not-found", "found-once",
  ],
  "count-source-mismatch": ["mismatch-records", "fail:phone", "fail-missing", "fail-duplicate", "see-records", "also", "population-unknown", "source-count-differs"],
  "count-destination-mismatch": [
    "mismatch-records", "fail:phone", "fail-duplicate", "see-records", "also",
    "coverage-not-established", "destination-count-differs", "not-found", "found-once",
  ],
  "scope-exact-keyless-destination": ["fail-destination-only", "see-records", "also", "coverage-not-established", "destination-keyless", "not-found", "found-once"],
  "scope-exact-source-unknown": ["mismatch-records", "fail:note", "see-records", "also", "population-unknown", "source-not-stated", "destination-only-unverified"],
  "rules-unknown": [
    "mismatch-records", "fail:email", "see-records", "also",
    "unknown:trim:name", "unknown:empty:email", "unknown:digits:phone", "unknown:date:signed", "unknown:date:at", "unknown:empty:code", "unknown:empty:name",
  ],
  // Unverified: each reason, in the order that matters.
  "keyless-rows": ["population-unknown", "source-empty-keys", "coverage-not-established", "destination-keyless", "found-once", "see-records"],
  "duplicate-source-key": ["population-unknown", "source-repeated-keys", "see-records"],
  "empty-values": ["unknown:empty:p", "see-records"],
  "date-overflow-unknown": ["population-unknown", "source-not-stated", "coverage-not-established", "destination-not-stated", "found-once", "unknown:date:t", "see-records"],
  "no-rows": ["no-rows"],
  "counts-zero": ["no-rows"],
};

describe("golden reports", () => {
  test.each(Object.entries(EXPECTED))("%s gives the expected points", (name, ids) => {
    expect(saved(name).points.map((p) => p.id)).toEqual(ids);
  });

  test("the table covers each state, and every point the module can give a golden report", () => {
    const states = new Set(Object.keys(EXPECTED).map((name) => saved(name).state));
    expect([...states].sort()).toEqual(["Mismatch", "Unverified", "Verified"]);
  });

  test.each(withReports)("%s: a check's report and the saved JSON give the same points", async (name) => {
    const args = argsOf(name);
    const outcome = await check({ ...parseArgs(args, join(GOLDEN, name)), now: () => "2000-01-01T00:00:00Z" });
    expect(explain(outcome.report!, { redacted: args.includes("--redact-values") })).toEqual(saved(name));
  });
});

describe("wording, from the report only", () => {
  test("the leads and the counts are the report's", () => {
    const e = saved("example");
    expect(e.lead).toBe("At least one rule is demonstrably false, and one such record is enough for the batch to be a Mismatch.");
    expect(point(e, "mismatch-records").text).toBe("3 of 4 source records: Mismatch. At least one rule is demonstrably false for each of them.");
    expect(point(e, "fail:phone").text).toBe("1 record differs in column «phone» under the rule «exact»");
    expect(point(saved("rules-fail"), "fail:email").text).toBe("3 records differ in column «email → mail» under the rule «casefold»");
  });

  test("a premise that was not stated says what it means, how to find out, and that FlowAssert cannot check it", () => {
    const { text, detail } = point(saved("example-without-premises"), "source-not-stated");
    expect(text).toBe("It was not stated that the source file is the whole batch.");
    expect(detail).toContain("compare the file’s 4 rows with the total the source system shows");
    expect(detail).toContain("FlowAssert cannot check the statement");
    expect(point(saved("example-without-premises"), "destination-not-stated").detail).toContain("compare the export’s 4 rows with the total the destination system shows");
  });

  test("a count that differs names both numbers", () => {
    expect(point(saved("count-source-mismatch"), "source-count-differs").text).toBe("The source total stated (5) differs from the row count of the file (4).");
    expect(point(saved("count-destination-mismatch"), "destination-count-differs").text).toBe("The destination total stated (3) differs from the row count of the export (4).");
  });

  test("Verified says which premises it rests on and what it does not show", () => {
    const e = saved("rules-pass");
    expect(point(e, "verified-records").text).toBe("All 3 source records were found exactly once in the destination export, and every compared field matched under its rule.");
    expect(point(e, "verified-premises").text).toContain("If either is wrong, this result is wrong.");
    expect(point(e, "verified-rules").text).toContain("«name: trim, email: casefold, phone: digits, signed: date:%Y-%m-%d, at: date:%d/%m/%Y %H:%M:%S.%f %z»");
    expect(point(e, "not-shown").text).toContain("that a workflow made these writes");
  });

  test("the first group of a kind says what it means, and the same kind is not explained twice", () => {
    const e = saved("rules-unknown");
    expect(point(e, "unknown:date:signed").detail).toBe("The rule «date:%Y-%m-%d» reads both values as dates; a value that does not match its format cannot be compared. The records list shows each value.");
    expect(point(e, "unknown:date:at").detail).toBe("");
    expect(point(e, "unknown:empty:email").text).toBe("2 records have an empty value in column «email → mail»");
  });
});

const KP = { key: ["k", "k"], fields: [{ source: "p", destination: "p", rule: "exact" }], scope: "source" };
const file = (name: string, text: string) => {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.length, read: () => bytes };
};
async function run(source: string, destination: string, args: Partial<CheckArgs> = {}, config: object = KP) {
  const outcome = await check({ source: file("source.csv", source), destination: file("destination.csv", destination), config: file("config.json", JSON.stringify(config)), ...args });
  return explain(outcome.report!, { redacted: args.redactValues === true });
}

describe("reports made for the reasons the golden files do not show", () => {
  test("Verified with matching totals and scope exact", async () => {
    const e = await run("k,p\nA,1\nB,2\n", "k,p\nB,2\nA,1\n", { sourceComplete: true, destinationComplete: true, sourceCount: "2", destinationCount: "2" }, { ...KP, scope: "exact" });
    expect(e.points.map((p) => p.id)).toEqual(["verified-records", "verified-premises", "verified-counts", "scope-exact", "not-shown"]);
    expect(point(e, "verified-counts").text).toBe("The two totals stated from the original systems matched the rows in the files. A matching total does not prove that a file is complete.");
  });

  test("every record passed, and the batch is Unverified because the source was not stated complete", async () => {
    const e = await run("k,p\nA,1\n", "k,p\nA,1\nB,2\n", { destinationComplete: true });
    expect(e.state).toBe("Unverified");
    expect(e.points.map((p) => p.id)).toEqual(["all-records-passed", "population-unknown", "source-not-stated"]);
    expect(point(e, "all-records-passed").text).toBe("The 1 source record passed every rule, but the batch is not Verified, for the reasons below.");
    expect(point(e, "source-not-stated").detail).toContain("compare the file’s 1 row with");
  });

  test("37 records with an empty value are one point", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => `K${i},${i < 37 ? "" : i}`).join("\n");
    const e = await run(`k,p\n${rows}\n`, `k,p\n${Array.from({ length: 40 }, (_, i) => `K${i},${i}`).join("\n")}\n`, { sourceComplete: true, destinationComplete: true });
    expect(point(e, "unknown:empty:p").text).toBe("37 records have an empty value in column «p»");
    expect(e.points.filter((p) => p.id.startsWith("unknown:"))).toHaveLength(1);
  });

  test("the list is capped, and says how many points it leaves out", async () => {
    const columns = Array.from({ length: 30 }, (_, i) => `c${i}`);
    const config = { key: ["k", "k"], fields: columns.map((c) => ({ source: c, destination: c, rule: "exact" })), scope: "source" };
    const header = ["k", ...columns].join(",");
    const e = await run(`${header}\nA,${columns.map(() => "").join(",")}\n`, `${header}\nA,${columns.map(() => "x").join(",")}\n`, { sourceComplete: true, destinationComplete: true }, config);
    expect(e.points.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(e.more).toBe(30 - e.points.filter((p) => p.id.startsWith("unknown:")).length);
    expect(e.more).toBeGreaterThan(0);
  });

  test("a redacted report does not tell an empty key from a repeated one", async () => {
    const e = await run("k,p\n,1\nA,2\nA,3\n", "k,p\nA,2\n", { redactValues: true });
    expect(e.points.map((p) => p.id)).toContain("source-invalid-keys");
    expect(point(e, "source-invalid-keys").text).toBe("3 source rows have an empty or repeated key, so they cannot be matched by their key.");
    expect(e.points.map((p) => p.id)).not.toContain("source-empty-keys");
  });
});

/** Every explanation the tests can make: one per golden report. */
const everyExplanation = () => withReports.map((name) => [name, saved(name)] as const);

describe("never a way to Verified", () => {
  /** Phrasing that would offer a premise, or a choice on the page, as a way to reach Verified. */
  const STEERING = [/\btick/i, /check the box/i, /\bcheckbox/i, /\b(select|choose) /i, /\b(if|once|when) you (state|tick|check|select|choose)\b/i, /\b(to|will|would|can|could) (get|reach|make|become|turn)\b/i, /\bstate (it|them|that|this)\b/i];

  test.each(everyExplanation())("%s: no point steers toward Verified", (_, e) => {
    for (const text of textsOf(e)) for (const pattern of STEERING) expect(text, text).not.toMatch(pattern);
  });

  test("a premise is described as a statement FlowAssert cannot check, wherever it appears", () => {
    for (const [, e] of everyExplanation()) {
      for (const p of e.points.filter((x) => x.id.endsWith("-not-stated"))) expect(flat(p.detail!)).toContain("FlowAssert cannot check the statement, and a wrong statement gives a wrong result.");
    }
  });
});
