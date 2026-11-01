/**
 * Phase 3B frontend wiring: what is requested, what is admitted, and how an admitted status is drawn.
 * Admitted bodies are the real captured Service bodies with the additive fields added, as the Service adds them.
 * The fields as the real Service emits them are exercised by e2e-workspace/ and e2e-history/.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decide } from "../../server/localApiGate.ts";
import { toPhase3BView } from "../adapters/phase3bToView";
import { CaptureValue, ReportedAdmission } from "../components/workspace/AxisMarks";
import { StatusAxesLedger } from "../components/workspace/StatusAxes";
import { ADMISSION_STATUSES, CAPTURE_STATUSES, type Phase3BFieldsDTO } from "../data/contract/phase3b";
import { decodeHistoryDetail, decodeHistoryList } from "../data/history/decode";
import { createLocalHistoryProvider, historyDetailUrl, historyEvidenceUrl, historyListUrl } from "../data/history/provider";
import { decodeLiveVerificationRun, decodeVerificationRun } from "../data/local/decode";
import { PHASE3B_PAIRS, phase3bProblems, phase3bSplit } from "../data/local/phase3b";
import { createLocalResearchProvider, evidenceUrl, lookupEvidenceUrl, lookupUrl, verificationUrl } from "../data/local/provider";
import { ADMISSION_AXES, ADMISSION_NOT_IMPLEMENTED, CAPTURE_AXES, CAPTURE_NOT_IMPLEMENTED, deriveAdmissionAxis, deriveCaptureAxis, deriveWorkspaceStatusAxes, noVerdict, type Phase3BView } from "../domain/statusAxes";
import { WorkspaceOverview, WorkspaceVerifications } from "../pages/Workspace";
import { DETAIL_EXAMPLES, example, fakeHistoryService, FIRST_BATCH, json } from "./local/fakeHistoryService";
import { captured, fakeService, LEGACY_ADMISSION } from "./local/fakeService";
import { renderApp } from "./render";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "#/");
});

const SHA = "a".repeat(64);
/** 2^53 + 1 and + 501: exact only as lexemes. */
const STARTED = "9007199254740993";
const COMPLETED = "9007199254741493";

function metadata(over: Record<string, unknown> = {}) {
  return { run_id: "0f".repeat(16), execution_cwd_sha256: SHA, source_basis_sha256: SHA, rule_basis_sha256: SHA, started_mono_ns: 100, completed_mono_ns: 200, verifier_work_completed: true, outer_exit_status: 0, subprocess_failures: 0, ...over };
}
const admitted = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ capture_status: "CAPTURED_COMPLETE", admission_status: "ADMITTED_RUN_BOUND", run_bound_metadata: metadata(over), ...extra });

/** A real archived Detail, admitted run-bound: the metadata digests are the archived run's own. */
function admittedDetail(name: (typeof DETAIL_EXAMPLES)[number] = DETAIL_EXAMPLES[0], over: Record<string, unknown> = {}) {
  const d = example(name);
  return { ...d, ...admitted({ source_basis_sha256: d.run.result.source_basis_sha256, rule_basis_sha256: d.run.result.rule_basis_sha256, ...over }) };
}

/** A body with `started_mono_ns` written as an exact lexeme JSON.parse cannot hold. */
const withExactMono = (body: object) => JSON.stringify(body).replace('"started_mono_ns":100', `"started_mono_ns":${STARTED}`).replace('"completed_mono_ns":200', `"completed_mono_ns":${COMPLETED}`);
const respond = (text: string) => new Response(text, { status: 200, headers: { "content-type": "application/json" } });

const facts = (captureStatus: Phase3BView["captureStatus"], admissionStatus: Phase3BView["admissionStatus"]): Phase3BView => ({ captureStatus, admissionStatus, runBound: null });

/* ---------- Requests ---------- */

describe("requests", () => {
  it("asks both Detail reads for the fields, in one spelling", () => {
    expect(verificationUrl("SPEC-001")).toBe("/api/v1/verifications/SPEC-001?phase3b=true");
    expect(verificationUrl("SPEC-001", "s")).toBe("/api/v1/verifications/SPEC-001?snapshot_id=s&phase3b=true");
    expect(lookupUrl("x/y")).toBe("/api/v1/verification-lookup?verification_id=x%2Fy&phase3b=true");
    expect(lookupUrl("x/y", "s")).toBe("/api/v1/verification-lookup?verification_id=x%2Fy&snapshot_id=s&phase3b=true");
  });

  it("never sends the flag to an Evidence read or to History, which refuse it", () => {
    const urls = [
      evidenceUrl("SPEC-001", { limit: 2, includePayload: true }),
      lookupEvidenceUrl("x", { limit: 2, includePayload: true }),
      historyListUrl({ limit: 4 }),
      historyDetailUrl(`hist_${SHA}`),
      historyEvidenceUrl(`hist_${SHA}`, { snapshotId: "s", limit: 2, includePayload: true }),
    ];
    for (const u of urls) expect(u).not.toContain("phase3b");
  });

  it("reads History from the routes that carry the fields; Evidence stays on the reviewed route", () => {
    expect(historyListUrl({ limit: 4 })).toBe("/api/v1/history/verifications?limit=4");
    expect(historyDetailUrl(`hist_${SHA}`)).toBe(`/api/v1/history/verifications/hist_${SHA}`);
    expect(historyEvidenceUrl(`hist_${SHA}`, { snapshotId: "s", limit: 2, includePayload: true }).startsWith(`/api/v1/history/hist_${SHA}/evidence?`)).toBe(true);
  });

  const gate = (rawTarget: string) => decide({ method: "GET", rawTarget, host: "127.0.0.1:5183", ownHosts: ["127.0.0.1:5183"], hasBody: false });

  it("the gate forwards exactly what the app sends", () => {
    for (const [t, route] of [
      [verificationUrl("SPEC-001"), "verification"],
      [verificationUrl("SPEC-001", "s"), "verification"],
      [lookupUrl("x/y"), "verification-lookup"],
      [lookupUrl("x/y", "s"), "verification-lookup"],
      [historyListUrl({ limit: 4, verificationId: "SPEC-001", cursor: "c" }), "history-verifications"],
      [historyDetailUrl(`hist_${SHA}`, "s"), "history-verification-detail"],
    ] as const)
      expect(gate(t), t).toEqual({ forward: true, route, target: t });
  });

  it.each([
    ["/api/v1/verifications/SPEC-001?phase3b=false"],
    ["/api/v1/verifications/SPEC-001?phase3b=1"],
    ["/api/v1/verifications/SPEC-001?phase3b="],
    ["/api/v1/verifications/SPEC-001?phase3b"],
    ["/api/v1/verifications/SPEC-001?phase3b=true&phase3b=true"],
    ["/api/v1/verification-lookup?verification_id=a&phase3b=false"],
    ["/api/v1/verification-lookup?verification_id=a&phase3b=TRUE"],
    ["/api/v1/verifications/SPEC-001/evidence?phase3b=true"],
    ["/api/v1/verification-evidence?verification_id=a&phase3b=true"],
    ["/api/v1/history?phase3b=true"],
    ["/api/v1/history/verifications?phase3b=true"],
    [`/api/v1/history/verifications/hist_${SHA}?phase3b=true`],
    ["/api/v1/verifications/SPEC-001?run2=x"],
  ])("the gate refuses %s", (t) => expect(gate(t)).toMatchObject({ forward: false, status: 400, code: "query_not_allowed" }));

  it("the gate admits no other path under the new routes", () => {
    expect(gate("/api/v1/history/verifications/x")).toMatchObject({ forward: false, status: 404 });
    expect(gate(`/api/v1/history/verifications/hist_${SHA}/evidence`)).toMatchObject({ forward: false, status: 404 });
    expect(gate("/api/v1/history/verificationsx")).toMatchObject({ forward: false, status: 404 });
  });
});

/* ---------- Admission of the additive fields ---------- */

describe("admission of the additive fields", () => {
  const f = (o: object) => o as Record<string, unknown>;

  it("sets aside only the three additive members, own members only", () => {
    const body = { a: 1, capture_status: "X", admission_status: "Y", run_bound_metadata: {} };
    expect(phase3bSplit(body)).toEqual({ frozen: { a: 1 }, fields: { capture_status: "X", admission_status: "Y", run_bound_metadata: {} } });
    expect(body).toHaveProperty("capture_status"); // the input is not mutated
    expect(phase3bSplit({ a: 1 })).toEqual({ frozen: { a: 1 }, fields: null });
    expect(phase3bSplit(JSON.parse('{"__proto__":{"capture_status":"CAPTURED_COMPLETE"}}')).fields).toBeNull();
    for (const v of [null, 1, "x", []]) expect(phase3bSplit(v)).toEqual({ frozen: v, fields: null });
  });

  it("no fields states nothing and refuses nothing", () => expect(phase3bProblems(null)).toEqual([]));

  it.each(PHASE3B_PAIRS)("admits the pair %s / %s", (capture, admission) => {
    const meta = admission === "ADMISSION_NOT_IMPLEMENTED" ? {} : { run_bound_metadata: metadata() };
    expect(phase3bProblems({ capture_status: capture, admission_status: admission, ...meta })).toEqual([]);
  });

  const allPairs = CAPTURE_STATUSES.flatMap((c) => ADMISSION_STATUSES.map((a) => [c, a] as const));
  it.each(allPairs.filter(([c, a]) => !PHASE3B_PAIRS.some(([x, y]) => x === c && y === a)))("refuses the contradictory pair %s / %s", (capture, admission) => {
    expect(phase3bProblems({ capture_status: capture, admission_status: admission, run_bound_metadata: metadata() })).toEqual([expect.stringContaining("cannot accompany")]);
  });

  it.each([
    ["capture only", { capture_status: "CAPTURED_COMPLETE" }],
    ["admission only", { admission_status: "ADMITTED_RUN_BOUND" }],
    ["metadata only", { run_bound_metadata: metadata() }],
    ["unknown capture", { capture_status: "CAPTURED", admission_status: "ADMITTED_RUN_BOUND" }],
    ["unknown admission", { capture_status: "CAPTURED_COMPLETE", admission_status: "ADMITTED" }],
    ["null statuses", { capture_status: null, admission_status: null }],
    ["lower-case status", { capture_status: "captured_complete", admission_status: "admitted_run_bound" }],
    ["inherited name", { capture_status: "toString", admission_status: "constructor" }],
  ])("refuses %s", (_label, fields) => expect(phase3bProblems(f(fields))).not.toEqual([]));

  it.each([
    ["no metadata", { capture_status: "CAPTURED_COMPLETE", admission_status: "ADMITTED_RUN_BOUND" }, "carries no run_bound_metadata"],
    ["metadata on not implemented", { ...LEGACY_ADMISSION, run_bound_metadata: metadata() }, "accompanies"],
    ["work not completed", admitted({ verifier_work_completed: false }), "verifier_work_completed is false"],
    ["non-zero exit", admitted({ outer_exit_status: 1 }), "outer_exit_status is 1"],
    ["null exit", admitted({ outer_exit_status: null }), "outer_exit_status is null"],
    ["subprocess failures", admitted({ subprocess_failures: 2 }), "subprocess_failures is 2"],
    ["completed before started", admitted({ completed_mono_ns: 99 }), "completed before it started"],
  ])("refuses an admission with %s", (_label, fields, message) => expect(phase3bProblems(f(fields)).join()).toContain(message));

  it.each([
    ["undeclared token", { ...metadata(), token: SHA }],
    ["missing member", Object.fromEntries(Object.entries(metadata()).filter(([k]) => k !== "run_id"))],
    ["empty run_id", metadata({ run_id: "" })],
    ["numeric run_id", metadata({ run_id: 1 })],
    ["upper-case digest", metadata({ source_basis_sha256: "A".repeat(64) })],
    ["short digest", metadata({ rule_basis_sha256: "a".repeat(63) })],
    ["negative reading", metadata({ started_mono_ns: -1 })],
    ["fractional reading", metadata({ completed_mono_ns: 1.5 })],
    ["string reading", metadata({ started_mono_ns: "1" })],
    ["string flag", metadata({ verifier_work_completed: "true" })],
    ["fractional exit", metadata({ outer_exit_status: 0.5 })],
    ["negative failures", metadata({ subprocess_failures: -1 })],
    ["array", []],
    ["null", null],
  ])("refuses metadata with %s, even beside a refusal", (_label, meta) => {
    expect(phase3bProblems({ capture_status: "CAPTURE_INCOMPLETE", admission_status: "REJECTED_INCOMPLETE_EXECUTION", run_bound_metadata: meta })).not.toEqual([]);
  });

  it("a refusal keeps its reported metadata as it is: a failed run has failed readings", () => {
    expect(phase3bProblems({ capture_status: "CAPTURE_SUBPROCESS_FAILED", admission_status: "REJECTED_INCOMPLETE_EXECUTION", run_bound_metadata: metadata({ verifier_work_completed: false, outer_exit_status: null, subprocess_failures: 3 }) })).toEqual([]);
  });

  it("a Detail's admission must name the archived run's own digests", () => {
    const body = example(DETAIL_EXAMPLES[0]);
    const request = { historyId: body.history_id };
    expect(decodeHistoryDetail(admittedDetail(), request).ok).toBe(true);
    expect(decodeHistoryDetail({ ...body, ...admitted() }, request)).toMatchObject({ ok: false, code: "phase3b_status_conflict" });
  });

  it("a frozen Detail body with no fields is still admitted, unchanged", () => {
    const body = example(DETAIL_EXAMPLES[0]);
    const d = decodeHistoryDetail(body, { historyId: body.history_id });
    expect(d.ok && toPhase3BView(d.value)).toBeNull();
  });

  it("the additive fields are accepted at the top level only: an archived run stays an exact frozen body", () => {
    const body = example(DETAIL_EXAMPLES[0]);
    expect(decodeHistoryDetail({ ...body, run: { ...body.run, ...LEGACY_ADMISSION } }, { historyId: body.history_id })).toMatchObject({ ok: false, code: "schema_invalid" });
  });

  it("every other undeclared member is still refused by the frozen schemas", () => {
    const list = example("021-list-after-insert");
    list.items[0].capture_status_extra = "x";
    expect(decodeHistoryList(list, { limit: 100 })).toMatchObject({ ok: false, code: "schema_invalid" });
    const run = captured("SPEC-001-detail");
    expect(decodeLiveVerificationRun({ ...run, token: SHA }, { id: "SPEC-001" })).toMatchObject({ ok: false, code: "schema_invalid" });
  });

  it("decodeVerificationRun itself stays frozen: it refuses the additive fields", () => {
    expect(decodeVerificationRun({ ...captured("SPEC-001-detail"), ...LEGACY_ADMISSION }, { id: "SPEC-001" })).toMatchObject({ ok: false, code: "schema_invalid" });
  });

  it("one bad list item refuses the whole page, naming the item", () => {
    const list = example("021-list-after-insert");
    list.items = list.items.map((x: object, i: number) => ({ ...x, ...LEGACY_ADMISSION, ...(i === 2 ? { capture_status: "FORGED" } : {}) }));
    const r = decodeHistoryList(list, { limit: 100 });
    expect(r).toMatchObject({ ok: false, code: "phase3b_status_conflict" });
    expect(!r.ok && r.problems[0]).toContain("items[2]");
  });
});

/* ---------- Provider → view ---------- */

describe("provider to view", () => {
  it("the live fixture statement stays not implemented, and is copied", async () => {
    const r = await createLocalResearchProvider({ fetch: fakeService().fetch }).getVerification("SPEC-001");
    expect(r.kind === "ready" && r.data.phase3b).toEqual({ captureStatus: "CAPTURE_NOT_IMPLEMENTED", admissionStatus: "ADMISSION_NOT_IMPLEMENTED", runBound: null });
  });

  it("a live body that forges a status is refused whole; no verdict is published", async () => {
    const svc = fakeService();
    svc.intercept((u) => u.pathname === "/api/v1/verifications/SPEC-001", () => json({ ...captured("SPEC-001-detail"), snapshot_id: svc.snapshot(), capture_status: "CAPTURED_COMPLETE", admission_status: "ADMITTED_RUN_BOUND" }));
    expect(await createLocalResearchProvider({ fetch: svc.fetch }).getVerification("SPEC-001")).toMatchObject({ kind: "error", access: "REQUEST_ERROR", code: "phase3b_status_conflict" });
  });

  it("keeps a reading beyond a safe integer exact, from the response's own lexemes", async () => {
    const svc = fakeHistoryService();
    const hid = FIRST_BATCH["SPEC-001"]!;
    svc.intercept((u) => u.pathname.endsWith(hid), () => respond(withExactMono(admittedDetail())));
    const r = await createLocalHistoryProvider({ fetch: svc.fetch }).getHistory(hid);
    expect(JSON.parse(`{"n":${STARTED}}`).n.toString()).not.toBe(STARTED); // what JSON.parse alone would keep
    expect(r.kind === "ready" && r.data.phase3b?.runBound).toMatchObject({ startedMonoNs: STARTED, completedMonoNs: COMPLETED, elapsedNs: "500" });
  });

  it("list items keep their own exact readings", async () => {
    const list = example("021-list-after-insert");
    list.items = list.items.map((x: object, i: number) => ({ ...x, ...(i === 1 ? admitted() : LEGACY_ADMISSION) }));
    const svc = fakeHistoryService();
    svc.intercept((u) => u.pathname === "/api/v1/history/verifications", () => respond(withExactMono(list)));
    const r = await createLocalHistoryProvider({ fetch: svc.fetch }).listHistory({ limit: 100 });
    if (r.kind !== "ready") throw new Error(r.kind);
    expect(r.data.items[0]!.phase3b?.runBound).toBeNull();
    expect(r.data.items[1]!.phase3b?.admissionStatus).toBe("ADMITTED_RUN_BOUND");
    expect(r.data.items[1]!.phase3b?.runBound?.startedMonoNs).toBe(STARTED);
  });

  it("a reading with no exact lexeme is unknown, not a rounded number", () => {
    const m = metadata({ started_mono_ns: 2 ** 60 }) as Phase3BFieldsDTO["run_bound_metadata"];
    const view = toPhase3BView({ capture_status: "CAPTURED_COMPLETE", admission_status: "ADMITTED_RUN_BOUND", run_bound_metadata: m });
    expect(view?.runBound).toMatchObject({ startedMonoNs: null, completedMonoNs: "200", elapsedNs: null });
  });

  it("an absent exit status stays null, never zero", () => {
    const m = metadata({ outer_exit_status: null }) as Phase3BFieldsDTO["run_bound_metadata"];
    expect(toPhase3BView({ capture_status: "CAPTURE_INCOMPLETE", admission_status: "REJECTED_INCOMPLETE_EXECUTION", run_bound_metadata: m })?.runBound?.outerExitStatus).toBeNull();
  });
});

/* ---------- Axes and marks ---------- */

describe("axes", () => {
  it.each(CAPTURE_STATUSES)("%s has one canonical axis", (s) => expect(deriveCaptureAxis(facts(s, "ADMISSION_NOT_IMPLEMENTED"))).toBe(CAPTURE_AXES[s]));
  it.each(ADMISSION_STATUSES)("%s has one canonical axis", (s) => expect(deriveAdmissionAxis(facts("CAPTURE_NOT_IMPLEMENTED", s))).toBe(ADMISSION_AXES[s]));

  it("no statement read means not implemented", () => {
    for (const v of [null, undefined]) {
      expect(deriveCaptureAxis(v)).toBe(CAPTURE_NOT_IMPLEMENTED);
      expect(deriveAdmissionAxis(v)).toBe(ADMISSION_NOT_IMPLEMENTED);
    }
  });

  it("the canonical axes are frozen", () => {
    expect(Object.isFrozen(CAPTURE_AXES.CAPTURED_COMPLETE)).toBe(true);
    expect(Object.isFrozen(ADMISSION_AXES)).toBe(true);
  });

  it("capture and admission belong to the same evaluation as the verdict", () => {
    const live = { id: "SPEC-001", state: "Verified", phase3b: facts("CAPTURE_NOT_IMPLEMENTED", "ADMISSION_NOT_IMPLEMENTED") } as never;
    const latest = { historyId: "h", archivedAt: "t", result: { cohort: "Mismatch" }, integrity: { status: "INTEGRITY_VERIFIED" }, phase3b: facts("CAPTURED_COMPLETE", "ADMITTED_RUN_BOUND") } as never;
    expect(deriveWorkspaceStatusAxes({ live, latest }).admission.status).toBe("ADMITTED_RUN_BOUND");
    expect(deriveWorkspaceStatusAxes({ live, latest, verdict: { axis: "verdict", kind: "VERDICT", state: "Verified", source: { kind: "live", request: "r" } } }).admission.status).toBe("ADMISSION_NOT_IMPLEMENTED");
    expect(deriveWorkspaceStatusAxes({ live }).capture).toBe(CAPTURE_NOT_IMPLEMENTED);
  });
});

describe("marks", () => {
  const OUTCOMES = [...Object.values(CAPTURE_AXES), ...Object.values(ADMISSION_AXES)].filter((a) => a.kind !== "NOT_IMPLEMENTED");

  it.each(OUTCOMES.map((a) => [a.status, a] as const))("%s draws its product label, with no verdict or coral styling", (_s, axis) => {
    const { container } = render(<CaptureValue axis={axis} />);
    const mark = container.querySelector<HTMLElement>("[data-axis-outcome]")!;
    expect(mark.textContent).toBe(axis.label);
    expect(mark.dataset.axisOutcome).toBe(axis.status);
    expect(container.querySelector("[data-axis-na]")).toBeNull();
    expect(container.querySelector(".fa-seal")).toBeNull();
    expect(mark.className).not.toMatch(/mismatch|verified|pending|unverified/);
  });

  it("no capture or admission label borrows a verdict word", () => {
    for (const a of [...Object.values(CAPTURE_AXES), ...Object.values(ADMISSION_AXES)]) expect(a.label).not.toMatch(/\b(Verified|Mismatch|Pending|Unverified)\b/i);
  });

  it("refused tones are told apart by shape, not only by colour", () => {
    const { container } = render(<CaptureValue axis={ADMISSION_AXES.REJECTED_STALE_RECEIPT} />);
    expect(container.querySelector("svg path")).not.toBeNull();
    expect(container.querySelector("[data-axis-tone]")!.getAttribute("data-axis-tone")).toBe("refused");
  });

  it("the ledger states an outcome and its own note, and leaves the verdict to axis 04", () => {
    const axes = { capture: CAPTURE_AXES.CAPTURED_COMPLETE, admission: ADMISSION_AXES.ADMITTED_RUN_BOUND, archive: { axis: "archive", kind: "NOT_ARCHIVED" }, verdict: noVerdict("nothing read") } as const;
    const { container } = render(<StatusAxesLedger axes={axes} />);
    expect(container.querySelector('[data-axis="capture"] [data-axis-outcome="CAPTURED_COMPLETE"]')).not.toBeNull();
    expect(container.querySelector('[data-axis="capture"]')!.textContent).toContain(CAPTURE_AXES.CAPTURED_COMPLETE.basis);
    expect(container.querySelector('[data-axis="admission"]')!.textContent).toContain(ADMISSION_AXES.ADMITTED_RUN_BOUND.basis);
    expect(container.querySelector('[data-axis="verdict"] [data-axis-noverdict]')).not.toBeNull();
    expect(container.querySelector("[data-run-bound]")).toBeNull();
  });

  it("the ledger states the reported run, exactly", () => {
    const axes = { capture: CAPTURE_AXES.CAPTURE_SUBPROCESS_FAILED, admission: ADMISSION_AXES.REJECTED_INCOMPLETE_EXECUTION, archive: { axis: "archive", kind: "NOT_ARCHIVED" }, verdict: noVerdict("nothing read") } as const;
    const runBound = { runId: "run-1", executionCwdSha256: SHA, sourceBasisSha256: SHA, ruleBasisSha256: SHA, startedMonoNs: STARTED, completedMonoNs: null, elapsedNs: null, verifierWorkCompleted: false, outerExitStatus: null, subprocessFailures: 3 };
    const { container } = render(<StatusAxesLedger axes={axes} runBound={runBound} />);
    const text = container.querySelector("[data-run-bound]")!.textContent!;
    for (const part of ["run-1", STARTED, "not stated exactly", "verifier_work_completedfalse", "outer_exit_statusnull", "subprocess_failures3", "not wall time"]) expect(text).toContain(part);
  });

  it("a negative span is stated, not corrected", () => {
    const axes = { capture: CAPTURE_AXES.CAPTURE_INCOMPLETE, admission: ADMISSION_AXES.REJECTED_INCOMPLETE_EXECUTION, archive: { axis: "archive", kind: "NOT_ARCHIVED" }, verdict: noVerdict("x") } as const;
    const runBound = { runId: "r", executionCwdSha256: SHA, sourceBasisSha256: SHA, ruleBasisSha256: SHA, startedMonoNs: "9", completedMonoNs: "4", elapsedNs: "-5", verifierWorkCompleted: true, outerExitStatus: 0, subprocessFailures: 0 };
    const { container } = render(<StatusAxesLedger axes={axes} runBound={runBound} />);
    expect(container.querySelector("[data-run-bound]")!.textContent).toContain("-5 ns · completed before started");
  });

  it("an archived row draws an outcome and nothing for not implemented", () => {
    const { container, rerender } = render(<ReportedAdmission facts={facts("CAPTURE_NOT_IMPLEMENTED", "ADMISSION_NOT_IMPLEMENTED")} />);
    expect(container.textContent).toBe("");
    rerender(<ReportedAdmission facts={null} />);
    expect(container.textContent).toBe("");
    rerender(<ReportedAdmission facts={facts("CAPTURE_INCOMPLETE", "REJECTED_BINDING_MISMATCH")} />);
    expect(container.textContent).toBe("Rejected · binding");
  });
});

/* ---------- Pages ---------- */

/** One app-wide fetch over the archive and the live fixtures. `newest` is SPEC-001's newest entry; Details exist for the first batch (`hid`). */
function services() {
  const history = fakeHistoryService();
  const v1 = fakeService();
  const hid = FIRST_BATCH["SPEC-001"]!;
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => (String(input).startsWith("/api/v1/history") ? history.fetch(input, init) : v1.fetch(input, init))) as typeof fetch;
  const newest = (history.entries() as { history_id: string; original_verification_id: string }[]).find((x) => x.original_verification_id === "SPEC-001")!.history_id;
  return { history, v1, hid, newest, fetch: fetchImpl };
}

const LIST_ROUTE = (u: URL) => u.pathname === "/api/v1/history/verifications";

async function admittedList(svc: ReturnType<typeof services>) {
  const real = (await (await fakeHistoryService().fetch("/api/v1/history/verifications?limit=100")).json()) as { items: { history_id: string }[] };
  return real.items.map((x) => (x.history_id === svc.newest ? { ...x, ...admitted() } : x));
}

function serveAdmittedList(svc: ReturnType<typeof services>) {
  // Every page of the list view is the real page with that one item admitted.
  const original = svc.history.fetch;
  svc.history.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    if (!LIST_ROUTE(new URL(String(input), "http://h"))) return res;
    const body = (await res.json()) as { items: { history_id: string }[] };
    const items = await admittedList(svc);
    return json({ ...body, items: body.items.map((x) => items.find((y) => y.history_id === x.history_id) ?? x) });
  }) as typeof fetch;
}

describe("pages", () => {
  it("Verifications: fixtures stay not implemented, and an archived outcome sits with its archived verdict", async () => {
    const svc = services();
    serveAdmittedList(svc);
    render(<WorkspaceVerifications history={createLocalHistoryProvider({ fetch: svc.fetch })} live={createLocalResearchProvider({ fetch: svc.fetch })} />);
    const table = document.querySelector("[data-case-table]")!;
    await waitFor(() => expect(table.querySelector('[data-case="SPEC-001"] [data-axis-outcome="ADMITTED_RUN_BOUND"]')).not.toBeNull());
    const row = table.querySelector('[data-case="SPEC-001"]')!;
    expect(row.querySelectorAll("[data-axis-na]")).toHaveLength(2); // the live evaluation's own axes
    expect(table.querySelectorAll("[data-axis-outcome]")).toHaveLength(1);
  });

  it("Verifications: with no live result, the row states the newest archived evaluation's axes", async () => {
    const svc = services();
    serveAdmittedList(svc);
    const down = (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    render(<WorkspaceVerifications history={createLocalHistoryProvider({ fetch: svc.fetch })} live={createLocalResearchProvider({ fetch: down })} />);
    const table = document.querySelector("[data-case-table]")!;
    await waitFor(() => expect(table.querySelector('[data-case="SPEC-001"] [data-axis-outcome="CAPTURED_COMPLETE"]')).not.toBeNull());
    expect(table.querySelector('[data-case="SPEC-002"] [data-axis-na]')).not.toBeNull();
  });

  it("Overview: the register stops claiming not implemented once an outcome is reported", async () => {
    const svc = services();
    serveAdmittedList(svc);
    render(<WorkspaceOverview history={createLocalHistoryProvider({ fetch: svc.fetch })} live={createLocalResearchProvider({ fetch: svc.fetch })} />);
    const register = await screen.findByRole("region", { name: "Workspace register" });
    await waitFor(() => expect(register.querySelector("[data-reported-outcomes]")?.textContent).toContain("1 of 5 cases report an outcome"));
    expect(register.textContent).not.toContain("Not implemented in this build");
    expect(within(register).getByText("Live n8n · HubSpot")).toBeTruthy();
  });

  it("Overview: with fixtures only, the register still says not implemented", async () => {
    const svc = services();
    render(<WorkspaceOverview history={createLocalHistoryProvider({ fetch: svc.fetch })} live={createLocalResearchProvider({ fetch: svc.fetch })} />);
    const register = await screen.findByRole("region", { name: "Workspace register" });
    await waitFor(() => expect(register.textContent).toContain("5 of 5 answered"));
    expect(register.textContent).toContain("Not implemented in this build");
    expect(register.querySelector("[data-reported-outcomes]")).toBeNull();
  });

  it("History: a list row carries the outcome, also for assistive technology", async () => {
    const svc = services();
    serveAdmittedList(svc);
    vi.stubGlobal("fetch", svc.fetch);
    renderApp("#/local/history?case=SPEC-001");
    await waitFor(() => expect(document.querySelector('[data-history-layout="wide"] [data-reported-admission]')).not.toBeNull());
    const row = document.querySelector(`[data-history-layout="wide"] [data-history-id="${svc.newest}"]`)!;
    expect(row.querySelector('[data-axis-outcome="ADMITTED_RUN_BOUND"]')).not.toBeNull();
    expect(row.querySelector("a[data-history-link]")!.getAttribute("aria-label")).toContain("Admission: Admitted · run-bound.");
  });

  it("History entry: states the entry's axes and run, read from the Phase 3B route", async () => {
    const svc = services();
    svc.history.intercept((u) => u.pathname === `/api/v1/history/verifications/${svc.hid}`, () => respond(withExactMono(admittedDetail())));
    vi.stubGlobal("fetch", svc.fetch);
    renderApp(`#/local/history/${svc.hid}`);
    await waitFor(() => expect(document.querySelector('[data-axis="admission"] [data-axis-outcome="ADMITTED_RUN_BOUND"]')).not.toBeNull());
    expect(document.querySelector('[data-axis="capture"] [data-axis-outcome="CAPTURED_COMPLETE"]')).not.toBeNull();
    const run = document.querySelector("[data-run-bound]")!.textContent!;
    expect(run).toContain(STARTED);
    expect(run).toContain("500 ns (0.001 ms)");
    expect(svc.history.log[0]).toBe(`/api/v1/history/verifications/${svc.hid}`);
  });

  it("History entry: a refused status fails the entry; nothing is shown as a result", async () => {
    const svc = services();
    svc.history.intercept((u) => u.pathname === `/api/v1/history/verifications/${svc.hid}`, () => json({ ...admittedDetail(), capture_status: "CAPTURE_INCOMPLETE" }));
    vi.stubGlobal("fetch", svc.fetch);
    renderApp(`#/local/history/${svc.hid}`);
    await waitFor(() => expect(document.body.textContent).toContain("phase3b_status_conflict"));
    expect(document.querySelector("[data-history-entry]")).toBeNull();
    expect(document.querySelector("[data-axis-outcome]")).toBeNull();
  });

  it("Detail: states the live axes, with no run-bound section for a fixture", async () => {
    const svc = services();
    vi.stubGlobal("fetch", svc.fetch);
    renderApp("#/local/verifications/SPEC-001");
    await waitFor(() => expect(document.querySelectorAll('[data-status-axes] [data-axis-na]')).toHaveLength(2));
    expect(document.querySelector("[data-run-bound]")).toBeNull();
    expect(svc.v1.log[0]).toBe("/api/v1/verifications/SPEC-001?phase3b=true");
  });
});
