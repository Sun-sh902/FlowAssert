/**
 * Phase 3A history admission (src/data/history/decode.ts) against the backend's real captured bodies
 * (FlowAssert-Phase3A-Service/contracts/history-examples.json, read-only), plus one deliberate
 * contradiction per rule. Expected verdicts are fixed independently of the UI: transcribed from the
 * backend handoff table and FlowAssert-Phase2-Support/SYNTHETIC_CASES.md, never from UI output.
 */
import { describe, expect, it } from "vitest";
import { decodeHistoryDetail, decodeHistoryEvidencePage, decodeHistoryList, validateHistorySchema } from "../data/history/decode";
import { DETAIL_EXAMPLES, EVIDENCE_EXAMPLES, example } from "./local/fakeHistoryService";

/** Independently fixed expectations (handoff "Case / Stored cohort" table; SYNTHETIC_CASES.md). */
export const EXPECTED_ARCHIVE = {
  "SPEC-001": { cohort: "Verified", records: ["Verified"], expectedTotal: 1, populationKnown: true },
  "SPEC-002": { cohort: "Mismatch", records: ["Mismatch"], expectedTotal: 1, populationKnown: true },
  "SPEC-003": { cohort: "Pending", records: ["Pending"], expectedTotal: 1, populationKnown: true },
  "SPEC-004": { cohort: "Unverified", records: ["Unverified"], expectedTotal: 1, populationKnown: true },
  "SPEC-005": { cohort: "Unverified", records: Array<string>(12).fill("Verified"), expectedTotal: null, populationKnown: false },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const detailReq = (d: Any) => ({ historyId: d.history_id });
const evidenceReq = (d: Any, over: object = {}) => ({
  historyId: d.history_id,
  snapshotId: d.snapshot_id,
  archiveId: d.archive_id,
  originalSnapshotId: d.original_snapshot_id,
  originalVerificationId: d.original_verification_id,
  includePayload: true,
  limit: 25,
  ...over,
});

describe("every captured 200 body is admitted", () => {
  it("all five Details, with the independently fixed verdicts", () => {
    for (const n of DETAIL_EXAMPLES) {
      const d = example(n);
      const r = decodeHistoryDetail(d, detailReq(d));
      expect(r.ok, n).toBe(true);
      const want = EXPECTED_ARCHIVE[d.original_verification_id as keyof typeof EXPECTED_ARCHIVE];
      expect(d.run.result.cohort_state).toBe(want.cohort);
      expect(d.run.result.records.map((x: Any) => x.state)).toEqual(want.records);
      expect(d.run.result.expected_total).toBe(want.expectedTotal);
      expect(d.result_summary.source_population_known).toBe(want.populationKnown);
    }
  });
  it("the Details captured after a real restart", () => {
    for (const n of ["036-history-stable-after-restart", "037-history-stable-after-restart", "038-history-stable-after-restart", "039-history-stable-after-restart", "040-history-stable-after-restart"]) {
      const d = example(n);
      expect(decodeHistoryDetail(d, detailReq(d)).ok, n).toBe(true);
    }
  });
  it("all evidence pages, full and single-item", () => {
    const details = Object.fromEntries(DETAIL_EXAMPLES.map((n) => [example(n).history_id, example(n)]));
    for (const n of [...EVIDENCE_EXAMPLES, "017-history-first-page"]) {
      const p = example(n);
      const r = decodeHistoryEvidencePage(p, evidenceReq(details[p.history_id]));
      expect(r.ok, `${n}: ${!r.ok && r.problems.join("; ")}`).toBe(true);
    }
  });
  it("all list pages (two batches, continuations, after restart)", () => {
    for (const [n, limit] of [["018-list-before-insert", 2], ["019-list-pinned-continuation", 2], ["020-list-pinned-continuation", 2], ["021-list-after-insert", 25], ["035-list-after-restart", 2]] as const) {
      const r = decodeHistoryList(example(n), { limit });
      expect(r.ok, `${n}: ${!r.ok && r.problems.join("; ")}`).toBe(true);
    }
  });
  it("Error bodies are the shared Error envelope", () => {
    for (const n of ["024-error-invalid_cursor", "025-error-history_snapshot_conflict", "026-error-invalid_history_id", "027-error-history_not_found", "031-error-no-write", "032-error-origin", "042-real-corrupt-evidence-503", "045-real-schema-invalid-503"])
      expect(validateHistorySchema("Error", example(n)), n).toEqual([]);
  });
});

type Mut = [name: string, mutate: (d: Any) => void, code: string, integrity?: string];

describe("Detail contradictions are refused, never repaired", () => {
  const SPEC5 = "014-SPEC-005-history-detail";
  const cases: Mut[] = [
    ["unknown top-level key", (d) => (d.extra = 1), "schema_invalid"],
    ["missing run", (d) => delete d.run, "schema_invalid"],
    ["other contract version", (d) => (d.contract_version = "phase3a-2.0.0"), "schema_invalid"],
    ["other workspace", (d) => (d.workspace_id = "ws-other"), "schema_invalid"],
    ["unknown verdict in the summary", (d) => (d.result_summary.cohort_state = "Passed"), "schema_invalid"],
    ["archive_id bound to another candidate", (d) => (d.archive_id = `archive_${"0".repeat(64)}`), "integrity_binding_conflict", "INTEGRITY_UNVERIFIABLE"],
    ["snapshot_id bound to another candidate", (d) => (d.snapshot_id = `history-snapshot_${"0".repeat(64)}`), "integrity_binding_conflict", "INTEGRITY_UNVERIFIABLE"],
    ["checked digest is not the candidate's", (d) => (d.integrity.checked_sha256 = "0".repeat(64)), "integrity_binding_conflict", "INTEGRITY_UNVERIFIABLE"],
    ["archive integrity scope swapped", (d) => (d.integrity.content_scope = "evidence_canonical_bytes"), "integrity_binding_conflict", "INTEGRITY_UNVERIFIABLE"],
    ["INTEGRITY_FAILED in a 200", (d) => (d.integrity.status = "INTEGRITY_FAILED"), "integrity_status_conflict", "INTEGRITY_FAILED"],
    ["INTEGRITY_UNVERIFIABLE in a 200", (d) => ((d.integrity.status = "INTEGRITY_UNVERIFIABLE"), (d.integrity.checked_sha256 = null)), "integrity_status_conflict", "INTEGRITY_UNVERIFIABLE"],
    ["foreign evaluator", (d) => (d.evaluator.model_sha256 = "0".repeat(64)), "evaluator_identity_conflict"],
    ["provenance commit differs from evaluator", (d) => (d.provenance.research_source_commit = "0".repeat(40)), "provenance_conflict"],
    ["original contract is not the frozen one", (d) => (d.original_contract_sha256 = "0".repeat(64)), "contract_identity_conflict"],
    ["unknown population given a total of 12", (d) => (d.result_summary.expected_total = 12), "population_conflict"],
    ["unknown population given a total of 0", (d) => (d.result_summary.expected_total = 0), "population_conflict"],
    ["original verification differs from the run", (d) => (d.original_verification_id = "SPEC-001"), "archive_binding_conflict"],
    ["original snapshot differs from run.snapshot_id", (d) => (d.original_snapshot_id = "snapshot-other"), "archive_binding_conflict"],
    ["input digest differs from the run", (d) => (d.input_evidence_sha256 = "0".repeat(64)), "archive_binding_conflict"],
    ["summary says Verified, archived run says Unverified", (d) => (d.result_summary.cohort_state = "Verified"), "summary_conflict"],
    ["summary counts differ from the run", (d) => (d.result_summary.counts.Verified = 11), "summary_conflict"],
    ["a record state changed without its counts", (d) => (d.run.result.records[0].state = "Mismatch"), "counts_conflict"],
    ["record order swapped", (d) => ([d.run.result.records[0], d.run.result.records[1]] = [d.run.result.records[1], d.run.result.records[0]]), "row_inventory_conflict"],
    ["a record dropped", (d) => d.run.result.records.pop(), "counts_conflict"],
    ["an evidence reference dropped from the run", (d) => d.run.evidence_references.pop(), "reference_conflict"],
  ];
  for (const [name, mutate, code, integrity] of cases)
    it(`${name} → ${code}`, () => {
      const d = example(SPEC5);
      mutate(d);
      const r = decodeHistoryDetail(d, detailReq(example(SPEC5)));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code, r.problems.join("; ")).toBe(code);
        expect(r.integrity).toBe(integrity);
      }
    });
  it("a Detail for another history ID is refused", () => {
    const d = example(SPEC5);
    expect(decodeHistoryDetail(d, { historyId: example(DETAIL_EXAMPLES[0]).history_id })).toMatchObject({ ok: false, code: "identity_conflict" });
  });
  it("a Detail from another persistent snapshot than the one pinned is refused", () => {
    const d = example(SPEC5);
    expect(decodeHistoryDetail(d, { historyId: d.history_id, snapshotId: "history-snapshot_other" })).toMatchObject({ ok: false, code: "snapshot_conflict" });
  });
  it("documented boundary: a consistent rewrite of run and summary together is admitted (copied, cannot be authenticated — P2-AUD-006)", () => {
    const d = example("002-SPEC-001-history-detail");
    d.run.result.cohort_state = "Unverified";
    d.result_summary.cohort_state = "Unverified";
    expect(decodeHistoryDetail(d, detailReq(d)).ok).toBe(true);
  });
});

describe("evidence page contradictions are refused", () => {
  const D = () => example("002-SPEC-001-history-detail");
  const P = () => example("003-SPEC-001-history-evidence");
  const cases: [string, (p: Any) => void, string, string?, object?][] = [
    ["root INTEGRITY_FAILED", (p) => (p.integrity.status = "INTEGRITY_FAILED"), "integrity_status_conflict", "INTEGRITY_FAILED"],
    ["page snapshot differs from the outer snapshot", (p) => (p.page.snapshot_id = "history-snapshot_other"), "snapshot_conflict"],
    ["an item reports INTEGRITY_FAILED", (p) => (p.items[1].integrity.status = "INTEGRITY_FAILED"), "integrity_status_conflict", "INTEGRITY_FAILED"],
    ["an item's checked digest is not its reference's", (p) => (p.items[0].integrity.checked_sha256 = "0".repeat(64)), "integrity_binding_conflict", "INTEGRITY_UNVERIFIABLE"],
    ["an item's integrity scope is the archive's", (p) => (p.items[0].integrity.content_scope = "archive_candidate_and_relationships"), "integrity_binding_conflict", "INTEGRITY_UNVERIFIABLE"],
    ["UNVERIFIABLE for an available, hashed reference", (p) => ((p.items[0].integrity.status = "INTEGRITY_UNVERIFIABLE"), (p.items[0].integrity.checked_sha256 = null)), "integrity_binding_conflict", "INTEGRITY_UNVERIFIABLE"],
    ["available payload missing", (p) => ((p.items[2].payload = null), (p.items[2].payload_reason = "gone")), "payload_binding_conflict"],
    ["more items than the limit", () => {}, "page_conflict", undefined, { limit: 2 }],
    ["empty next_cursor", (p) => (p.page.next_cursor = ""), "page_conflict"],
    ["payload present although omission was requested", () => {}, "payload_binding_conflict", undefined, { includePayload: false }],
    ["unknown key on an item", (p) => (p.items[0].extra = true), "schema_invalid"],
  ];
  for (const [name, mutate, code, integrity, over] of cases)
    it(`${name} → ${code}`, () => {
      const p = P();
      mutate(p);
      const r = decodeHistoryEvidencePage(p, evidenceReq(D(), over));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code, r.problems.join("; ")).toBe(code);
        expect(r.integrity).toBe(integrity);
      }
    });
  it("evidence of another archive is never attached to this Detail", () => {
    const other = example("006-SPEC-002-history-evidence");
    expect(decodeHistoryEvidencePage(other, evidenceReq(D()))).toMatchObject({ ok: false, code: "identity_conflict" });
  });
  it("evidence carrying another original snapshot or verification is refused", () => {
    expect(decodeHistoryEvidencePage(P(), evidenceReq(D(), { originalSnapshotId: "snapshot-other" }))).toMatchObject({ ok: false, code: "identity_conflict" });
    expect(decodeHistoryEvidencePage(P(), evidenceReq(D(), { originalVerificationId: "SPEC-002" }))).toMatchObject({ ok: false, code: "identity_conflict" });
  });
});

describe("list page contradictions are refused", () => {
  const L = () => example("021-list-after-insert");
  const cases: [string, (l: Any) => void, string, object?][] = [
    ["an entry outside the requested case filter", () => {}, "scope_conflict", { verificationId: "SPEC-005" }],
    ["the same entry twice in a page", (l) => (l.items[1] = l.items[0]), "duplicate_entry"],
    ["more entries than the limit", () => {}, "page_conflict", { limit: 4 }],
    ["total below the entries returned", (l) => (l.page.total = 3), "page_conflict"],
    ["an entry reports INTEGRITY_FAILED", (l) => (l.items[3].integrity.status = "INTEGRITY_FAILED"), "integrity_status_conflict"],
    ["an entry with a foreign evaluator", (l) => (l.items[2].evaluator.source_commit = "0".repeat(40)), "evaluator_identity_conflict"],
    ["an unknown population given a total", (l) => (l.items[0].result_summary.expected_total = 12), "population_conflict"],
    ["an entry whose archive_id names another candidate", (l) => (l.items[4].archive_id = `archive_${"0".repeat(64)}`), "integrity_binding_conflict"],
    ["empty next_cursor", (l) => (l.page.next_cursor = ""), "page_conflict"],
  ];
  for (const [name, mutate, code, over] of cases)
    it(`${name} → ${code}`, () => {
      const l = L();
      mutate(l);
      const r = decodeHistoryList(l, { limit: 25, ...over });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code, r.problems.join("; ")).toBe(code);
    });
});
