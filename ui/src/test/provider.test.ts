/** Provider boundary and data-access vocabulary. No network is involved anywhere. */
import { describe, expect, it } from "vitest";
import { ACCESS_STATES, accessStateOf, admitResponse, classifyHttpFailure, type ProviderResult, type ReadState } from "../data/access";
import { activeProvider, getReadProvider, mockReadProvider, unavailableReadProvider } from "../data/provider";
import { getRun, runs } from "../data/store";
import { STATES, type RunView } from "../domain/view";

describe("MOCK read provider", () => {
  it("returns the store's run unchanged as a ready result", async () => {
    const run = runs[3]!;
    const r = await mockReadProvider.getVerification(run.id);
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.data).toBe(getRun(run.id));
    expect(r.context.mode).toBe("MOCK");
    expect(r.context.synthetic).toBe(true);
  });

  it("returns not_found for an unknown ID — not an error and not a verdict", async () => {
    expect(await mockReadProvider.getVerification("VR-9999")).toEqual({ kind: "not_found", requestId: null });
  });

  it("rejects with AbortError when cancelled", async () => {
    const ctrl = new AbortController();
    const p = mockReadProvider.getVerification(runs[0]!.id, {}, ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects immediately for an already-aborted signal", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(mockReadProvider.getVerification(runs[0]!.id, {}, ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("declares that MOCK carries no evidence payloads", async () => {
    expect(mockReadProvider.capabilities.readEvidence).toBe(false);
    const r = await mockReadProvider.getEvidence(runs[0]!.id, {});
    expect(r).toMatchObject({ kind: "error", access: "EVIDENCE_UNAVAILABLE" });
  });

  it("keeps the synchronous seam serving the same runs", () => {
    expect(activeProvider.mode).toBe("MOCK");
    expect(activeProvider.listRuns()).toBe(runs);
  });
});

describe("reserved modes", () => {
  // Phase 2: LOCAL_RESEARCH is implemented (src/data/local/provider.ts) and no longer reserved; LIVE still is.
  // The unavailable-provider behaviour is still asserted for both modes, through unavailableReadProvider.
  for (const mode of ["LOCAL_RESEARCH", "LIVE"] as const) {
    it(`${mode}: the unavailable provider returns an explicit error and never falls back to MOCK`, async () => {
      const p = unavailableReadProvider(mode);
      expect(p).not.toBe(mockReadProvider);
      expect(p.mode).toBe(mode);
      expect(p.capabilities).toEqual({ readRuns: false, readEvidence: false, liveAcquisition: false, requestRecheck: false });
      const r = await p.getVerification(runs[0]!.id);
      expect(r).toMatchObject({ kind: "error", access: "SERVICE_UNAVAILABLE", code: "provider_mode_unavailable", retryable: false });
      expect("data" in r).toBe(false);
      expect(await p.getEvidence(runs[0]!.id, {})).toMatchObject({ kind: "error" });
    });
  }

  it("LIVE stays unavailable through getReadProvider", async () => {
    const p = getReadProvider("LIVE");
    expect(p).not.toBe(mockReadProvider);
    expect(p.mode).toBe("LIVE");
    expect(p.capabilities).toEqual({ readRuns: false, readEvidence: false, liveAcquisition: false, requestRecheck: false });
    expect(await p.getVerification(runs[0]!.id)).toMatchObject({ kind: "error", access: "SERVICE_UNAVAILABLE", code: "provider_mode_unavailable" });
  });

  it("LOCAL_RESEARCH maps to the HTTP provider — never to MOCK, never with live acquisition or recheck", () => {
    const p = getReadProvider("LOCAL_RESEARCH");
    expect(p).not.toBe(mockReadProvider);
    expect(p.mode).toBe("LOCAL_RESEARCH");
    expect(p.capabilities).toEqual({ readRuns: true, readEvidence: true, liveAcquisition: false, requestRecheck: false });
    expect(getReadProvider("LOCAL_RESEARCH")).toBe(p);
  });

  it("MOCK maps to the mock provider", () => {
    expect(getReadProvider("MOCK")).toBe(mockReadProvider);
  });
});

describe("access vocabulary", () => {
  it("shares no word with the verdict vocabulary", () => {
    const verdicts = new Set<string>(STATES.map((s) => s.toUpperCase()));
    for (const a of ACCESS_STATES) expect(verdicts.has(a)).toBe(false);
  });

  it("classifies HTTP failures without ever producing a verdict", () => {
    expect(classifyHttpFailure(null, "verification")).toBe("SERVICE_UNAVAILABLE");
    expect(classifyHttpFailure(409, "verification")).toBe("STALE_SNAPSHOT");
    expect(classifyHttpFailure(503, "verification")).toBe("SERVICE_UNAVAILABLE");
    expect(classifyHttpFailure(503, "evidence")).toBe("EVIDENCE_UNAVAILABLE");
    for (const s of [400, 422, 429, 500, 502]) expect(classifyHttpFailure(s, "verification")).toBe("REQUEST_ERROR");
  });

  const run = runs[0]!;
  const settled = (result: ProviderResult<RunView>): ReadState<RunView> => ({ status: "settled", seq: 1, result });
  const ctx = { mode: "MOCK" as const, synthetic: true, workspaceId: null, contractVersion: null, snapshotId: null, requestId: null, researchAuthorization: "demo" as const, acquisitionAuthenticity: "not_authenticated" as const, clockBasis: "" };

  it("maps read states to access states", () => {
    expect(accessStateOf<RunView>({ status: "idle" })).toBe("LOADING");
    expect(accessStateOf<RunView>({ status: "loading", seq: 1 })).toBe("LOADING");
    expect(accessStateOf<RunView>({ status: "cancelled", seq: 1 })).toBeNull();
    expect(accessStateOf(settled({ kind: "ready", data: run, context: ctx }))).toBeNull();
    expect(accessStateOf(settled({ kind: "partial", data: run, context: ctx, unavailableIds: ["x"] }))).toBe("PARTIAL_DATA");
    expect(accessStateOf(settled({ kind: "not_found", requestId: null }))).toBe("NOT_FOUND");
    expect(accessStateOf(settled({ kind: "error", access: "REQUEST_ERROR", code: "x", message: "", requestId: null, retryable: true }))).toBe("REQUEST_ERROR");
    expect(accessStateOf({ status: "settled", seq: 1, result: { kind: "ready", data: [] as RunView[], context: ctx } }, (d) => d.length === 0)).toBe("EMPTY");
  });

  it("admits only the newest request, and only from the pinned snapshot", () => {
    expect(admitResponse(2, null, { seq: 2, snapshotId: null })).toEqual({ admit: true });
    expect(admitResponse(3, null, { seq: 2, snapshotId: null })).toEqual({ admit: false, reason: "superseded" });
    expect(admitResponse(2, "s-7", { seq: 2, snapshotId: "s-7" })).toEqual({ admit: true });
    expect(admitResponse(2, "s-7", { seq: 2, snapshotId: "s-9" })).toEqual({ admit: false, reason: "snapshot_mismatch" });
    // Opaque IDs are compared, not ordered: a lexically "newer" ID is still a mismatch.
    expect(admitResponse(2, "s-9", { seq: 2, snapshotId: "s-10" })).toEqual({ admit: false, reason: "snapshot_mismatch" });
    // A data-bearing result with no snapshot echo is refused when pinned; a result without data is not snapshot-bound.
    expect(admitResponse(2, "s-7", { seq: 2, snapshotId: null })).toEqual({ admit: false, reason: "snapshot_mismatch" });
    expect(admitResponse(2, "s-7", { seq: 2, snapshotId: undefined })).toEqual({ admit: true });
    expect(admitResponse(3, "s-7", { seq: 2, snapshotId: undefined })).toEqual({ admit: false, reason: "superseded" });
  });
});
