/**
 * Reading a JSON report (ui/src/offline/savedReport.ts): every golden report is accepted, both details levels and
 * redacted ones, with its bytes kept unchanged; a report that is not schema_version 1, lacks a member, has one of the
 * wrong type, or contradicts its own numbers is refused, naming the check that failed.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_BYTES } from "../../offline/csv";
import { NotAReport, readReport, readReportFile, viewOf, type ReportCheck } from "../../offline/savedReport";
import { GOLDEN } from "./golden-cases";

const goldenReports = readdirSync(GOLDEN).filter((name) => existsSync(join(GOLDEN, name, "report.json"))).sort();
const bytesOf = (name: string) => new Uint8Array(readFileSync(join(GOLDEN, name, "report.json")));
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const golden = (name: string): Json => JSON.parse(readFileSync(join(GOLDEN, name, "report.json"), "utf-8")) as Json;

function refusal(bytes: Uint8Array): NotAReport {
  try {
    readReport(bytes, "report.json");
  } catch (e) {
    if (e instanceof NotAReport) return e;
    throw e;
  }
  throw new Error("accepted");
}

describe("reading a report", () => {
  it("finds the golden reports", () => {
    expect(goldenReports.length).toBeGreaterThanOrEqual(45);
  });

  it.each(goldenReports)("accepts offline/golden/%s/report.json and keeps its bytes", (name) => {
    const bytes = bytesOf(name);
    const read = readReport(bytes, "report.json");
    expect(read.bytes).toBe(bytes);
    expect(read.report.records.length).toBe(read.report.source_rows_observed);
    const args = (JSON.parse(readFileSync(join(GOLDEN, name, "case.json"), "utf-8")) as { args: string[] }).args;
    expect(read.redacted).toBe(args.includes("--redact-values"));
  });

  it("accepts a report of the CSV check page, whose premises' origin is the browser form", () => {
    const text = readFileSync(join(GOLDEN, "example-page", "report.json"), "utf-8").replaceAll('"origin": "command-line option"', '"origin": "browser form"');
    const { report } = readReport(new TextEncoder().encode(text), "report.json");
    expect(Object.values(report.premises).map((p) => p.origin)).toEqual(["browser form", "browser form", "browser form", "browser form"]);
  });

  it("reads both details levels: a Verified record has rule results only with details all", () => {
    expect(readReport(bytesOf("example"), "r").report.records[0]).toEqual({ key: "SYN-001", source_row: 0, state: "Verified" });
    expect(readReport(bytesOf("example-details-all"), "r").report.records[0]!.rules).toBeDefined();
  });

  it("keeps only the members the format lists, and ignores others", () => {
    const value = golden("example");
    value.added_later = { anything: [1, 2] };
    value.inputs.something_new = 3;
    const { report } = readReport(encode(value), "r");
    expect("added_later" in report).toBe(false);
    expect("something_new" in report.inputs).toBe(false);
  });

  it("shows what the CSV check page shows of a result", () => {
    const view = viewOf(readReport(bytesOf("example"), "r").report);
    expect(view.cohort).toBe("Mismatch");
    expect(view.problemCount).toBe(3);
    expect(view.problems.map((r) => r.key)).toEqual(["SYN-002", "SYN-003", "SYN-004"]);
    expect(view.premises.map(([name]) => name)).toEqual(["destination_complete", "destination_count", "source_complete", "source_count"]);
  });

  it("refuses a file over 200 MiB before reading it", async () => {
    let read = false;
    const file = { name: "big.json", size: MAX_BYTES + 1, arrayBuffer: () => ((read = true), Promise.resolve(new ArrayBuffer(0))) } as unknown as File;
    await expect(readReportFile(file)).rejects.toMatchObject({ check: "size", message: expect.stringContaining("exceeds the limit of 209715200 bytes") });
    expect(read).toBe(false);
  });

  it("accepts a file of exactly 200 MiB as far as size goes", () => {
    // Only the size: the bytes themselves are not JSON.
    expect(refusal(new Uint8Array(MAX_BYTES)).check).toBe("json");
  });
});

/** An altered golden report, the check that refuses it, and words of its message. */
const ALTERED: [string, string, (r: Json) => void, ReportCheck, string][] = [
  ["schema_version 2", "example", (r) => (r.schema_version = 2), "schema-version", "schema_version must be 1, not 2"],
  ["no schema_version (FlowAssert 0.1.x)", "example", (r) => delete r.schema_version, "member", "schema_version is missing"],
  ["a missing member", "example", (r) => delete r.limitations, "member", "limitations is missing"],
  ["counts of the wrong type", "example", (r) => (r.counts.Mismatch = "3"), "member", "counts.Mismatch must be a whole number"],
  ["a negative count", "example", (r) => (r.counts.Verified = -1), "member", "counts.Verified must be a whole number from 0"],
  ["a fractional count", "example", (r) => (r.counts.Verified = 1.5), "member", "counts.Verified must be a whole number"],
  ["counts that do not add up", "example", (r) => (r.counts.Mismatch = 2), "counts", "counts do not add up to source_rows_observed: Verified 1 + Mismatch 2 + Pending 0 + Unverified 0 = 3, source_rows_observed 4"],
  ["counts that add up but do not match the records", "example", (r) => ((r.counts.Mismatch = 2), (r.counts.Unverified = 1)), "counts", "counts.Mismatch is 2, 3 records are Mismatch"],
  ["a Pending count", "example", (r) => ((r.counts.Mismatch = 2), (r.counts.Pending = 1)), "counts", "counts.Pending is 1"],
  ["fewer records than rows", "example", (r) => r.records.pop(), "counts", "records has 3 entries for 4 source rows"],
  ["a record state outside the four states", "example", (r) => (r.records[1].state = "Fixed"), "record-state", "records[1].state must be one of Verified, Mismatch, Pending, Unverified"],
  ["a record state its rule results contradict", "example", (r) => ((r.records[1].state = "Unverified"), (r.counts.Mismatch = 2), (r.counts.Unverified = 1)), "record-state", "records[1].state is Unverified, but its rule results give Mismatch"],
  ["a rule status outside pass, fail, unknown", "example", (r) => (r.records[1].rules["field:phone"].status = "ok"), "member", "records[1].rules.field:phone.status must be one of pass, fail, unknown"],
  ["a missing rule result", "example", (r) => delete r.records[1].rules.uniqueness, "member", "records[1].rules must have existence, uniqueness, field:phone, field:email"],
  ["records out of file order", "example", (r) => ([r.records[0], r.records[1]] = [r.records[1], r.records[0]]), "member", "records[0].source_row is 1"],
  ["a Verified record with rule results under details problems", "example", (r) => (r.records[0].candidates = 1), "member", 'records[0] is Verified in a report with details "problems"'],
  ["a Verified record without rule results under details all", "example-details-all", (r) => delete r.records[0].rules, "member", "records[0].rules is missing"],
  ["details that is neither problems nor all", "example", (r) => (r.details = "some"), "member", "details must be one of problems, all"],
  ["a Verified cohort with a claim of null", "rules-pass", (r) => (r.claim = null), "claim", "cohort_state is Verified, but claim is null"],
  ["a claim on a cohort that is not Verified", "example", (r) => (r.claim = "At this evaluation, under the stated premises, the supplied destination rows satisfy the rules for the supplied source rows."), "claim", "cohort_state is Mismatch, so claim must be null"],
  ["a claim with other words", "rules-pass", (r) => (r.claim = "Everything is correct."), "claim", "claim is not the text a Verified report carries"],
  ["a cohort state its counts contradict", "example", (r) => (r.cohort_state = "Unverified"), "cohort-state", "cohort_state is Unverified, but the counts and the source population give Mismatch"],
  ["a Verified cohort without a known source population", "rules-pass", (r) => ((r.source_population_known = false), (r.expected_total = null)), "premises", "source_population_known is false"],
  ["an expected total without a known source population", "example-without-premises", (r) => (r.expected_total = 4), "counts", "expected_total is 4"],
  ["coverage without the destination statement", "example-without-premises", (r) => (r.destination_coverage_sufficient = true), "premises", "destination_coverage_sufficient is true"],
  ["a count premise whose matched contradicts it", "count-source-mismatch", (r) => (r.premises.source_count.matched = true), "premises", "premises.source_count.matched is true"],
  ["inputs that disagree with the premises", "example", (r) => (r.inputs.source_complete_stated = false), "premises", "inputs.source_complete_stated and premises.source_complete.stated differ"],
  ["a premise without its origin", "example", (r) => delete r.premises.source_complete.origin, "member", "premises.source_complete.origin is missing"],
  ["a digest that is not SHA-256", "example", (r) => (r.inputs.source_sha256 = "abc"), "inputs", "inputs.source_sha256 must be a SHA-256 digest"],
  ["identical content without it being allowed", "example", (r) => (r.inputs.destination_sha256 = r.inputs.source_sha256), "inputs", "inputs.identical_content does not agree with the two digests"],
  ["one encoding without the other", "example-page", (r) => delete r.inputs.destination_encoding, "inputs", "inputs.source_encoding is present without inputs.destination_encoding"],
  ["an unknown comparison rule", "rules-fail", (r) => (r.obligation.rules[0] = "fuzzy"), "obligation", "unknown comparison rule 'fuzzy'"],
  ["a comparison that does not follow the rules", "rules-fail", (r) => (r.obligation.comparison = "exact-string"), "obligation", "obligation.comparison is exact-string, but the rules are not all exact"],
  ["an unknown scope", "scope-exact-cli", (r) => (r.obligation.scope = "all"), "obligation", "obligation.scope must be one of source, exact"],
  ["destination-only counts that do not match destination_only", "scope-exact-source-unknown", (r) => ((r.destination_only_counts.Unverified = 0), (r.destination_only_counts.Mismatch = 1)), "destination-only-counts", "destination_only_counts.Mismatch is 1, 0 entries are Mismatch"],
  ["destination-only records without scope exact", "example", (r) => ((r.destination_only = []), (r.destination_only_counts = { Mismatch: 0, Pending: 0, Unverified: 0, Verified: 0 })), "destination-only-counts", "destination_only is present, but the scope is source"],
  ["scope exact without destination-only records", "scope-exact-cli", (r) => delete r.destination_only, "destination-only-counts", "destination_only is missing, but the scope is exact"],
  ["a destination-only state that does not follow the source population", "scope-exact-source-unknown", (r) => ((r.destination_only[0].state = "Mismatch"), (r.destination_only_counts.Unverified = 0), (r.destination_only_counts.Mismatch = 1)), "record-state", "destination_only[0].state is Mismatch"],
  ["another evaluator", "example", (r) => (r.evaluator = "v3"), "member", "evaluator is 'v3'"],
  ["a time that is not UTC ISO 8601", "example", (r) => (r.evaluated_at = "yesterday"), "member", "evaluated_at must be a UTC time"],
  ["a limitation removed", "example", (r) => (r.limitations = "None."), "member", "limitations is not the text every report carries"],
  ["business truth claimed", "example", (r) => (r.business_truth = "Verified"), "member", 'business_truth must be "Not assessed"'],
  ["files claimed authentic", "example", (r) => (r.acquisition_authenticity = "authenticated"), "member", 'acquisition_authenticity must be "not_authenticated"'],
  ["a list in place of the report", "example", () => undefined, "member", "the report must be an object"],
];

describe("refusing a report", () => {
  it.each(ALTERED)("refuses %s", (_, name, alter, check, words) => {
    let value: unknown = golden(name);
    if (words === "the report must be an object") value = [value];
    else alter(value as Json);
    const e = refusal(encode(value));
    expect(e.check).toBe(check);
    expect(e.message).toContain(words);
    expect(e.message.startsWith("report.json: ")).toBe(true);
  });

  it("refuses a duplicate member, as the command line refuses one in a configuration file", () => {
    const text = readFileSync(join(GOLDEN, "example", "report.json"), "utf-8").replace('"details": "problems",', '"details": "problems",\n  "details": "all",');
    const e = refusal(new TextEncoder().encode(text));
    expect([e.check, e.message]).toEqual(["duplicate-member", "report.json: duplicate member 'details'"]);
  });

  it("refuses a file that is not JSON, or not UTF-8", () => {
    expect(refusal(new TextEncoder().encode("source,destination\n1,2\n"))).toMatchObject({ check: "json", message: "report.json: invalid JSON (Expecting value)" });
    expect(refusal(new Uint8Array([0x7b, 0xff, 0x7d]))).toMatchObject({ check: "encoding", message: "report.json: not UTF-8" });
    expect(refusal(new TextEncoder().encode("{}"))).toMatchObject({ check: "member", message: "report.json: schema_version is missing" });
  });

  it("refuses a FlowAssert configuration file for what it is not", () => {
    expect(refusal(new Uint8Array(readFileSync(join(GOLDEN, "rules-pass", "config.json")))).message).toBe("report.json: schema_version is missing");
  });
});
