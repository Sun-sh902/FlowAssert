/** Live ↔ archived comparison, exact archive matching and Service status classification (product round 02). Pure. */
import { describe, expect, it } from "vitest";
import { describeStatus } from "../components/shell/ServiceStatus";
import { HISTORY_SCOPE } from "../data/history/config";
import { LOCAL_SCOPE } from "../data/local/config";
import { STALE_AFTER_MS, classifyExchange } from "../data/serviceStatus";
import { compareCase, matchArchive, resultRelation, type ArchiveSide, type LiveSide } from "../data/workspace/comparison";
import type { HistorySummaryView } from "../domain/history";
import type { RunView, VerificationState } from "../domain/view";

const INPUT = "a".repeat(64);
const MODEL = "b61779e198dd0213b67f8319b77a2daf9feb502dc553784df6d6600e8e3a842d";
const COMMIT = "4deddb323ad0f1f00b2c369a7b141dc04c95f8fa";
const counts = (s: VerificationState) => ({ Verified: 0, Mismatch: 0, Pending: 0, Unverified: 0, [s]: 1 });

function run(over: { state?: VerificationState; input?: string; model?: string; contract?: string; snapshot?: string; canonical?: string | null; id?: string } = {}): RunView {
  const state = over.state ?? "Verified";
  return {
    id: over.id ?? "SPEC-001",
    state,
    counts: counts(state),
    expectedTotal: 1,
    populationKnown: true,
    local: {
      workspaceId: HISTORY_SCOPE.workspaceId,
      contractVersion: over.contract ?? LOCAL_SCOPE.contractVersion,
      snapshotId: over.snapshot ?? "snapshot-live",
      evaluator: { modelSha256: over.model ?? MODEL, sourceCommit: COMMIT, versionLabel: "x", workspaceDirty: true },
      inputEvidenceSha256: over.input ?? INPUT,
      resultCanonical: over.canonical === undefined ? '{"cohort_state":"Verified"}' : over.canonical,
      serviceExecutedAt: "2026-10-22T13:00:00Z",
    },
  } as unknown as RunView;
}

let seq = 0;
function entry(over: { state?: VerificationState; input?: string; model?: string; snapshot?: string; id?: string; contract?: string } = {}): HistorySummaryView {
  const state = over.state ?? "Verified";
  seq++;
  return {
    historyId: `hist_${String(seq).padStart(64, "0")}`,
    verificationId: over.id ?? "SPEC-001",
    workspaceId: HISTORY_SCOPE.workspaceId,
    archivedAt: "2026-10-22T12:00:00Z",
    originalSnapshotId: over.snapshot ?? "snapshot-archived",
    originalContractSha256: over.contract ?? HISTORY_SCOPE.originalContractSha256,
    inputEvidenceSha256: over.input ?? INPUT,
    evaluator: { modelSha256: over.model ?? MODEL, sourceCommit: COMMIT, versionLabel: "x", workspaceDirty: true },
    result: { cohort: state, counts: counts(state), expectedTotal: 1, populationKnown: true },
    integrity: { status: "INTEGRITY_VERIFIED", checkedSha256: null, scope: "archive_candidate_and_relationships" },
  } as unknown as HistorySummaryView;
}

const ready = (r: RunView): LiveSide => ({ kind: "ready", run: r });
const archived = (...e: HistorySummaryView[]): ArchiveSide => ({ kind: "ready", entries: e });
const transport = { code: "transport_failure", message: "down.", transport: true, integrity: false };

describe("compareCase", () => {
  it("same input, evaluator and contract with equal summaries: SAME_INPUT_AGREE, even across Service publications", () => {
    const c = compareCase(ready(run()), archived(entry()));
    expect(c.state).toBe("SAME_INPUT_AGREE");
    expect(c.sameSnapshot).toBe(false); // the snapshot is shown, never matched on
  });

  it("same input but a different cohort: SAME_INPUT_DIFFER — a diagnostic naming the field, never a verdict", () => {
    const c = compareCase(ready(run({ state: "Verified" })), archived(entry({ state: "Mismatch" })));
    expect(c.state).toBe("SAME_INPUT_DIFFER");
    expect(c.resultDiffers).toEqual(["cohort", "counts"]);
    expect(c.reason).toMatch(/Diagnostic only — not a verdict/);
  });

  it("different input, evaluator or an unmappable contract: DIFFERENT_INPUT, results not compared", () => {
    expect(compareCase(ready(run()), archived(entry({ input: "c".repeat(64), state: "Mismatch" })))).toMatchObject({ state: "DIFFERENT_INPUT", identityDiffers: ["inputEvidenceSha256"], resultDiffers: [] });
    expect(compareCase(ready(run()), archived(entry({ model: "d".repeat(64) }))).identityDiffers).toEqual(["evaluatorModelSha256"]);
    expect(compareCase(ready(run({ contract: "0.2.0" })), archived(entry())).identityDiffers).toEqual(["contractSha256"]);
  });

  it("compares with the NEWEST archived entry (archive order), never a chosen one", () => {
    const c = compareCase(ready(run()), archived(entry({ input: "c".repeat(64) }), entry()));
    expect(c.state).toBe("DIFFERENT_INPUT");
  });

  it("missing sides are named as missing — never Unverified", () => {
    expect(compareCase({ kind: "not_found" }, archived(entry())).state).toBe("LIVE_MISSING");
    expect(compareCase({ kind: "not_found" }, archived()).state).toBe("LIVE_MISSING");
    expect(compareCase(ready(run()), archived()).state).toBe("ARCHIVE_MISSING");
    for (const c of [compareCase({ kind: "not_found" }, archived()), compareCase(ready(run()), archived())]) expect(JSON.stringify(c)).not.toContain("Unverified");
  });

  it("transport failures are SERVICE_UNAVAILABLE; refusals, integrity failures and cancellation are INCONCLUSIVE", () => {
    expect(compareCase({ kind: "failed", failure: transport }, { kind: "failed", failure: transport }).state).toBe("SERVICE_UNAVAILABLE");
    expect(compareCase(ready(run()), { kind: "failed", failure: transport }).state).toBe("SERVICE_UNAVAILABLE");
    expect(compareCase(ready(run()), { kind: "failed", failure: { code: "archive_integrity_failed", message: "x", transport: false, integrity: true } }).state).toBe("INCONCLUSIVE");
    expect(compareCase(ready(run()), { kind: "failed", failure: { code: "snapshot_mismatch", message: "x", transport: false, integrity: false } }).state).toBe("INCONCLUSIVE");
    expect(compareCase({ kind: "cancelled" }, archived(entry())).state).toBe("INCONCLUSIVE");
    expect(compareCase({ kind: "reading" }, archived(entry())).state).toBe("READING");
  });
});

describe("matchArchive (exact Detail → Archive)", () => {
  it("zero, one or several exact matches; several are all returned, none chosen", () => {
    const a = entry();
    const b = entry();
    expect(matchArchive(run(), [])).toMatchObject({ kind: "none", considered: 0 });
    expect(matchArchive(run(), [a])).toEqual({ kind: "one", entry: a });
    expect(matchArchive(run(), [a, b])).toEqual({ kind: "many", entries: [a, b] });
  });

  it("never matches on time or label: an entry with the same verdict but another input is not a match", () => {
    const m = matchArchive(run({ state: "Verified" }), [entry({ state: "Verified", input: "c".repeat(64) })]);
    expect(m.kind).toBe("none");
    expect(m.kind === "none" && m.nearest[0]!.differs).toEqual(["inputEvidenceSha256"]);
  });

  it("ignores the snapshot for identity, and never matches another verification ID", () => {
    expect(matchArchive(run({ snapshot: "s1" }), [entry({ snapshot: "s2" })]).kind).toBe("one");
    expect(matchArchive(run(), [entry({ id: "SPEC-002" })]).kind).toBe("none");
  });

  it("resultRelation compares the evaluator's canonical result bytes, or says it cannot", () => {
    expect(resultRelation(run({ canonical: "{}" }), run({ canonical: "{}" }))).toBe("identical");
    expect(resultRelation(run({ canonical: "{}" }), run({ canonical: '{"a":1}' }))).toBe("different");
    expect(resultRelation(run({ canonical: null }), run({ canonical: "{}" }))).toBe("not_checkable");
  });
});

describe("Service status", () => {
  const ok = (status: number, body: unknown) => ({ kind: "response" as const, status, contentType: "application/json", text: JSON.stringify(body) });

  it("classifies what answered: Service 200, Service error, gate refusal, gate unreachable, transport", () => {
    expect(classifyExchange("/api/v1/history", 1, ok(200, {})).kind).toBe("REACHABLE");
    expect(classifyExchange("/x", 1, ok(404, { error: { code: "history_not_found" } }))).toMatchObject({ kind: "REQUEST_FAILURE", answeredBy: "service", code: "history_not_found" });
    expect(classifyExchange("/x", 1, ok(400, { gate: { code: "path_refused" } }))).toMatchObject({ kind: "REQUEST_FAILURE", answeredBy: "gate" });
    expect(classifyExchange("/x", 1, ok(502, { gate: { code: "service_unreachable" } }))).toMatchObject({ kind: "UNAVAILABLE", reason: "gate_service_unreachable" });
    expect(classifyExchange("/x", 1, { kind: "transport" })).toMatchObject({ kind: "UNAVAILABLE", reason: "transport" });
    expect(classifyExchange("/x", 1, { kind: "timeout" })).toMatchObject({ kind: "UNAVAILABLE", reason: "timeout" });
    expect(classifyExchange("/x", 1, { kind: "response", status: 404, contentType: "application/json", text: '{"detail":"Not Found"}' })).toMatchObject({
      kind: "REQUEST_FAILURE",
      answeredBy: "unrecognized",
    });
  });

  it("describes checking, unknown and stale without inventing health", () => {
    expect(describeStatus(null, 1, 0).kind).toBe("CHECKING");
    expect(describeStatus(null, 0, 0).kind).toBe("UNKNOWN");
    const last = classifyExchange("/x", 0, ok(200, {}));
    expect(describeStatus(last, 0, 1000).kind).toBe("REACHABLE");
    expect(describeStatus(last, 0, STALE_AFTER_MS + 1).kind).toBe("STALE");
    expect(describeStatus(last, 0, 1000).detail).not.toMatch(/n8n|HubSpot|capture/i);
  });
});
