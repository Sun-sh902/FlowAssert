/**
 * LocalResearchProvider: exact wire requests, outcome classification, cancellation, and a faithful
 * copy of the evaluator's results. HTTP is a test double here (./local/fakeService.ts, built from
 * the real captured bodies); the real Service is exercised by e2e-local/.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { wireToRunView } from "../adapters/wireToView";
import { createLocalResearchProvider, evidenceUrl, verificationUrl } from "../data/local/provider";
import { admitPage, ledgerItems, startChain } from "../data/local/evidenceChain";
import type { EvidencePageView, EvidenceReferenceView } from "../domain/evidence";
import { CASE_IDS, captured, fakeService, json } from "./local/fakeService";

/**
 * Expected outcomes, fixed independently of the UI: transcribed from FlowAssert-Phase2-Support/
 * SYNTHETIC_CASES.md ("Actual record states", "Actual cohort", counts, expected_total).
 */
const EXPECTED = {
  "SPEC-001": { cohort: "Verified", records: ["Verified"], expectedTotal: 1, populationKnown: true },
  "SPEC-002": { cohort: "Mismatch", records: ["Mismatch"], expectedTotal: 1, populationKnown: true },
  "SPEC-003": { cohort: "Pending", records: ["Pending"], expectedTotal: 1, populationKnown: true },
  "SPEC-004": { cohort: "Unverified", records: ["Unverified"], expectedTotal: 1, populationKnown: true },
  "SPEC-005": { cohort: "Unverified", records: Array(12).fill("Verified"), expectedTotal: null, populationKnown: false },
} as const;

describe("wire requests", () => {
  it("use the frozen snake_case names, encode opaque values and add nothing else", () => {
    expect(verificationUrl("SPEC-001")).toBe("/api/v1/verifications/SPEC-001");
    expect(verificationUrl("A/B C", "snap 1&x")).toBe("/api/v1/verifications/A%2FB%20C?snapshot_id=snap+1%26x");
    const u = new URL(evidenceUrl("SPEC-001", { snapshotId: "s-1", limit: 2, includePayload: false, cursor: "ab+/=" }), "http://x");
    expect([...u.searchParams.keys()]).toEqual(["snapshot_id", "limit", "include_payload", "cursor"]);
    expect(u.searchParams.get("include_payload")).toBe("false");
    expect(u.searchParams.get("cursor")).toBe("ab+/="); // sent back exactly as received
    expect(u.search).not.toMatch(/snapshotId|includePayload/);
  });

  it("are relative: the provider has no base URL and cannot reach another origin", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const p = createLocalResearchProvider({
      fetch: (async (url: string, init?: RequestInit) => {
        seen.push({ url, init });
        return json(captured("invalid-id"), 404);
      }) as typeof fetch,
    });
    await p.getVerification("SPEC-404");
    expect(seen[0]!.url).toBe("/api/v1/verifications/SPEC-404");
    expect(seen[0]!.init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store" });
  });

  it("source never names an external origin, the demo fixtures or a verdict reducer", () => {
    for (const f of ["src/data/local/provider.ts", "src/data/local/decode.ts", "src/adapters/wireToView.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
      // G8: no demo fixtures, demo clock, demo store, MOCK adapter or MOCK provider module on the real path.
      // Runtime imports only: `import type` is erased by the compiler (verbatimModuleSyntax).
      const imports = [...src.matchAll(/^import (?!type )[^;]*?from "([^"]+)"/gms)].map((m) => m[1]);
      expect(imports.filter((i) => /mocks\/|data\/store|\/store$|researchToView|^\.\.\/provider$|data\/provider$/.test(i!)), f).toEqual([]);
      expect(src, f).not.toMatch(/\bDEMO_[A-Z_]+/);
    }
  });
});

describe("ready results copy the evaluator", () => {
  for (const id of CASE_IDS) {
    it(`${id}: cohort, record states in capture order, counts and rule outcomes are copied`, async () => {
      const svc = fakeService();
      const r = await createLocalResearchProvider({ fetch: svc.fetch }).getVerification(id);
      expect(r.kind).toBe("ready");
      if (r.kind !== "ready") return;
      const dto = captured(`${id}-detail`);
      const want = EXPECTED[id];
      expect(r.data.state).toBe(want.cohort);
      expect(r.data.records.map((x) => x.state)).toEqual(want.records);
      expect(r.data.records.map((x) => x.sourceRow)).toEqual(want.records.map((_, i) => i));
      expect(r.data.records.map((x) => x.rowId)).toEqual(want.records.map((_, i) => `${id}:${i}`));
      expect(r.data.counts).toEqual(dto.result.counts);
      expect(r.data.expectedTotal).toBe(want.expectedTotal);
      expect(r.data.populationKnown).toBe(want.populationKnown);
      for (const [i, rec] of r.data.records.entries())
        for (const rule of rec.rules) {
          expect(rule.status).toBe(dto.result.records[i].rules[rule.id].status);
          expect(rule.reasonRaw).toBe(dto.result.records[i].rules[rule.id].reason);
          expect(rule.proposed).toBe(false);
        }
      expect(r.data.records.flatMap((x) => x.rules.map((rl) => rl.id))).not.toContain("email");
      expect(r.context).toMatchObject({ mode: "LOCAL_RESEARCH", synthetic: true, workspaceId: "ws-synthetic-01", snapshotId: svc.snapshot(), researchAuthorization: "research_only" });
      expect(r.data.local?.snapshotId).toBe(svc.snapshot());
    });
  }

  it("SPEC-005: twelve Verified rows never make a Verified cohort, and the unknown total stays null", async () => {
    const r = await createLocalResearchProvider({ fetch: fakeService().fetch }).getVerification("SPEC-005");
    if (r.kind !== "ready") throw new Error(r.kind);
    expect(r.data.counts.Verified).toBe(12);
    expect(r.data.state).toBe("Unverified");
    expect(r.data.expectedTotal).toBeNull();
    expect(r.data.headline).toBe("All 12 visible records match — but the source total is unconfirmed.");
  });

  it("SPEC-004: denied access and a missing observed tick stay unavailable — no zero, no substitute time", async () => {
    const r = await createLocalResearchProvider({ fetch: fakeService().fetch }).getVerification("SPEC-004");
    if (r.kind !== "ready") throw new Error(r.kind);
    expect(r.data.destinationAccess).toBe("denied");
    expect(r.data.observedAt).toBeNull();
    expect(r.data.timeline.find((e) => e.id === "observed")).toMatchObject({ at: null, future: false });
    expect(r.data.local!.diagnostics).toEqual([expect.objectContaining({ path: "result.observed_at", code: "missing_time_tick" })]);
    expect(r.data.records[0]!.rules.every((x) => x.status === "unknown")).toBe(true);
    expect(r.data.state).toBe("Unverified");
    expect(r.data.local!.evidenceReferences.find((x) => x.role === "destination")!.availability).toBe("available"); // denied-read receipt is available
  });

  it("SPEC-002 / SPEC-003: an open window keeps Mismatch a Mismatch and Pending a Pending", async () => {
    const p = createLocalResearchProvider({ fetch: fakeService().fetch });
    const b = await p.getVerification("SPEC-002");
    const c = await p.getVerification("SPEC-003");
    if (b.kind !== "ready" || c.kind !== "ready") throw new Error("not ready");
    expect([b.data.windowOpen, b.data.state]).toEqual([true, "Mismatch"]);
    expect([c.data.windowOpen, c.data.state]).toEqual([true, "Pending"]);
    expect(b.data.records[0]!.fields[0]).toMatchObject({ source: "+1 212 555 0101", destination: "different supplied phone", status: "fail" });
  });

  it("keeps the nullable source annotations null (presentation fallbacks only)", async () => {
    const r = await createLocalResearchProvider({ fetch: fakeService().fetch }).getVerification("SPEC-001");
    if (r.kind !== "ready") throw new Error(r.kind);
    expect(r.data.records[0]!.displayName).toBeNull();
    expect(r.data.records[0]!.company).toBeNull();
  });

  it("UIA-009: a null n8n label is admitted and kept null", async () => {
    const svc = fakeService();
    svc.intercept(
      (u) => u.pathname.endsWith("/SPEC-001"),
      () => {
        const d = captured("SPEC-001-detail");
        d.workflow.n8n_label = null;
        return json(d);
      },
    );
    const r = await createLocalResearchProvider({ fetch: svc.fetch }).getVerification("SPEC-001");
    if (r.kind !== "ready") throw new Error(r.kind);
    expect(r.data.workflow.n8nLabel).toBeNull();
  });

  it("wireToRunView does not mutate the admitted DTO", () => {
    const d = captured("SPEC-005-detail");
    const before = JSON.stringify(d);
    wireToRunView(d);
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe("outcomes that are not verifications", () => {
  const withResponse = (res: () => Response | Promise<Response>) => createLocalResearchProvider({ fetch: (async () => res()) as typeof fetch });

  it("404 run_not_found → not_found, with the service's request ID", async () => {
    const r = await createLocalResearchProvider({ fetch: fakeService().fetch }).getVerification("SPEC-404");
    expect(r).toEqual({ kind: "not_found", requestId: "req-run_not_found-404" });
  });

  it("400 invalid_cursor → REQUEST_ERROR carrying the service's code", async () => {
    const r = await withResponse(() => json(captured("invalid-cursor"), 400)).getEvidence("SPEC-001", { snapshotId: "s", limit: 2, cursor: "bad" });
    expect(r).toMatchObject({ kind: "error", access: "REQUEST_ERROR", code: "invalid_cursor", retryable: false });
  });

  it("409 snapshot_unavailable → STALE_SNAPSHOT on both reads", async () => {
    expect(await withResponse(() => json(captured("unavailable-snapshot"), 409)).getVerification("SPEC-001", { snapshotId: "old" })).toMatchObject({
      kind: "error",
      access: "STALE_SNAPSHOT",
      code: "snapshot_unavailable",
    });
    expect(await withResponse(() => json(captured("restart-old-cursor"), 409)).getEvidence("SPEC-001", { snapshotId: "old", limit: 1, cursor: "c" })).toMatchObject({
      access: "STALE_SNAPSHOT",
    });
  });

  it("503 → SERVICE_UNAVAILABLE for Detail, EVIDENCE_UNAVAILABLE for evidence; retryable as the service says", async () => {
    expect(await withResponse(() => json(captured("service-unavailable-detail"), 503)).getVerification("SPEC-001")).toMatchObject({
      access: "SERVICE_UNAVAILABLE",
      code: "cursor_key_unavailable",
      retryable: true,
    });
    expect(await withResponse(() => json(captured("service-unavailable-evidence"), 503)).getEvidence("SPEC-001", { limit: 1 })).toMatchObject({
      access: "EVIDENCE_UNAVAILABLE",
      code: "cursor_key_unavailable",
    });
  });

  it("422 invalid_parameter → REQUEST_ERROR", async () => {
    expect(await withResponse(() => json(captured("invalid-limit"), 422)).getEvidence("SPEC-001", { limit: 1 })).toMatchObject({ access: "REQUEST_ERROR", code: "invalid_parameter" });
  });

  it("a proxy's own failure (service down: 500, empty text/plain) is SERVICE_UNAVAILABLE — not a 500 from the service", async () => {
    const r = await withResponse(() => new Response("", { status: 500, headers: { "content-type": "text/plain" } })).getVerification("SPEC-001");
    expect(r).toMatchObject({ kind: "error", access: "SERVICE_UNAVAILABLE", code: "no_service_envelope" });
  });

  it("a 404 without the Error envelope is not 'run not found'", async () => {
    const r = await withResponse(() => new Response("<html>404</html>", { status: 404, headers: { "content-type": "text/html" } })).getVerification("SPEC-001");
    expect(r).toMatchObject({ kind: "error", code: "no_service_envelope" });
  });

  it("transport failure and timeout are SERVICE_UNAVAILABLE and never a verdict", async () => {
    const refused = createLocalResearchProvider({ fetch: (async () => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch });
    const r1 = await refused.getVerification("SPEC-001");
    expect(r1).toMatchObject({ kind: "error", access: "SERVICE_UNAVAILABLE", code: "transport_failure" });
    expect("data" in r1).toBe(false);
    const hang = createLocalResearchProvider({
      timeoutMs: 20,
      fetch: ((_u: string, init?: RequestInit) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch,
    });
    expect(await hang.getVerification("SPEC-001")).toMatchObject({ kind: "error", access: "SERVICE_UNAVAILABLE", code: "timeout" });
  });

  it("malformed and refused 200 bodies fail closed as REQUEST_ERROR", async () => {
    expect(await withResponse(() => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } })).getVerification("SPEC-001")).toMatchObject({
      access: "REQUEST_ERROR",
      code: "malformed_response",
    });
    expect(await withResponse(() => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } })).getVerification("SPEC-001")).toMatchObject({
      code: "malformed_response",
    });
    const missing = captured("SPEC-001-detail");
    delete missing.result.cohort_state;
    const r = await withResponse(() => json(missing)).getVerification("SPEC-001");
    expect(r).toMatchObject({ kind: "error", access: "REQUEST_ERROR", code: "schema_invalid" });
  });

  it("copies the cohort state as returned — the frontend never re-derives it from record states", async () => {
    // Twelve Verified rows. Whatever cohort state the evaluator returned is what is shown; the UI has
    // no reducer that could "agree" or "disagree". Here the body is altered to prove the copy direction.
    const altered = captured("SPEC-005-detail");
    altered.result.cohort_state = "Pending";
    const r = await withResponse(() => json(altered)).getVerification("SPEC-005");
    expect(r.kind === "ready" ? r.data.state : r.kind).toBe("Pending");
    const original = await withResponse(() => json(captured("SPEC-005-detail"))).getVerification("SPEC-005");
    expect(original.kind === "ready" ? original.data.state : original.kind).toBe("Unverified");
  });

  it("an oversized body is refused before parsing", async () => {
    const r = await withResponse(() => new Response("x".repeat(2_000_001), { status: 200, headers: { "content-type": "application/json" } })).getVerification("SPEC-001");
    expect(r).toMatchObject({ code: "response_too_large" });
  });

  it("cancellation rejects with AbortError and produces no result", async () => {
    const ctrl = new AbortController();
    const p = createLocalResearchProvider({
      fetch: ((_u: string, init?: RequestInit) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch,
    });
    const pending = p.getVerification("SPEC-001", {}, ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const pre = new AbortController();
    pre.abort();
    await expect(p.getEvidence("SPEC-001", { limit: 1 }, pre.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("evidence pages and the acquisition chain", () => {
  const detailRefs = async (id = "SPEC-001") => {
    const r = await createLocalResearchProvider({ fetch: fakeService().fetch }).getVerification(id);
    if (r.kind !== "ready") throw new Error(r.kind);
    return { refs: r.data.local!.evidenceReferences, snapshot: r.data.local!.snapshotId };
  };

  it("reads all pages in order with the Detail's snapshot, constant limit and payload mode", async () => {
    const svc = fakeService();
    const p = createLocalResearchProvider({ fetch: svc.fetch });
    const d = await p.getVerification("SPEC-002");
    if (d.kind !== "ready") throw new Error(d.kind);
    let chain = startChain(d.data.local!.evidenceReferences, d.data.local!.snapshotId, 2, true);
    let cursor: string | null = null;
    for (;;) {
      const page = await p.getEvidence("SPEC-002", { snapshotId: chain.snapshotId, limit: 2, includePayload: true, cursor: cursor ?? undefined });
      if (page.kind !== "ready") throw new Error(page.kind);
      const step = admitPage(chain, cursor, page.data);
      if (!step.ok) throw new Error(step.code);
      chain = step.chain;
      if (chain.next === null) break;
      cursor = chain.next!;
    }
    expect(chain.pages).toBe(2);
    expect(chain.read.map((x) => x.id)).toEqual(["SPEC-002-source", "SPEC-002-destination", "SPEC-002-policy", "SPEC-002-evaluation_input"]);
    expect(chain.read.every((x) => x.payload.state === "loaded" && x.payload.digest === "reproduced")).toBe(true);
    const evidenceCalls = svc.log.filter((u) => u.includes("/evidence"));
    expect(evidenceCalls).toHaveLength(2);
    for (const u of evidenceCalls) expect(u).toMatch(new RegExp(`snapshot_id=${svc.snapshot()}&limit=2&include_payload=true`));
    expect(evidenceCalls[1]).toContain("&cursor=");
    expect(ledgerItems(chain, d.data.local!.evidenceReferences).map((x) => x.payload.state)).toEqual(["loaded", "loaded", "loaded", "loaded"]);
  });

  it("include_payload=false is omission by request; stored availability is unchanged", async () => {
    const r = await createLocalResearchProvider({ fetch: fakeService().fetch }).getEvidence("SPEC-004", { limit: 4, includePayload: false });
    if (r.kind !== "ready") throw new Error(r.kind);
    expect(r.data.items.map((x) => x.payload)).toEqual(Array(4).fill({ state: "omitted", reason: "omitted_by_request" }));
    expect(r.data.items.map((x) => x.availability)).toEqual(Array(4).fill("available"));
  });

  const page = (items: EvidenceReferenceView[], next: string | null, snapshotId: string, total: number | null = 4): EvidencePageView => ({
    runId: "SPEC-001",
    snapshotId,
    items,
    nextCursor: next,
    total,
  });

  it("refuses snapshot mixing, cycles, duplicates, reordering, changed metadata, omissions and extras", async () => {
    const { refs, snapshot } = await detailRefs();
    const start = startChain(refs, snapshot, 2, true);
    const ok1 = admitPage(start, null, page(refs.slice(0, 2), "c1", snapshot));
    expect(ok1.ok).toBe(true);
    const c1 = ok1.ok ? ok1.chain : start;
    const codeOf = (s: ReturnType<typeof admitPage>) => (s.ok ? "ok" : s.code);
    expect(codeOf(admitPage(start, null, page(refs.slice(0, 2), "c1", "snapshot-new")))).toBe("snapshot_mismatch");
    expect(codeOf(admitPage(c1, "c1", page(refs.slice(2, 4), "c1", snapshot)))).toBe("cursor_cycle");
    expect(codeOf(admitPage(c1, "c1", page([refs[1]!, refs[2]!], null, snapshot)))).toBe("duplicate_reference");
    expect(codeOf(admitPage(c1, "c1", page([refs[3]!, refs[2]!], null, snapshot)))).toBe("reference_mismatch");
    expect(codeOf(admitPage(c1, "c1", page([{ ...refs[2]!, sha256: "f".repeat(64) }, refs[3]!], null, snapshot)))).toBe("reference_mismatch");
    expect(codeOf(admitPage(c1, "c1", page([refs[2]!], null, snapshot)))).toBe("omitted_references");
    expect(codeOf(admitPage(c1, "c1", page([refs[2]!, refs[3]!], "c2", snapshot)))).toBe("ok");
    expect(codeOf(admitPage(c1, "c9", page(refs.slice(2, 4), null, snapshot)))).toBe("cursor_out_of_sequence");
    expect(codeOf(admitPage(c1, "c1", page([], "c2", snapshot)))).toBe("no_progress");
    expect(codeOf(admitPage(start, null, page(refs.slice(0, 2), "c1", snapshot, 7)))).toBe("total_conflict");
    expect(codeOf(admitPage(start, null, page(refs.slice(0, 3), "c1", snapshot)))).toBe("page_too_large");
    expect(codeOf(admitPage(start, null, page(refs.slice(0, 2), "c1", snapshot, null)))).toBe("ok"); // total unknown is allowed
    const done = admitPage(c1, "c1", page(refs.slice(2, 4), null, snapshot));
    expect(done.ok && done.chain.next).toBeNull();
    if (done.ok) expect(codeOf(admitPage(done.chain, null, page(refs.slice(0, 2), null, snapshot)))).toBe("chain_complete");
  });

  it("a restart between pages invalidates the old cursor: 409, nothing merged", async () => {
    const svc = fakeService();
    const p = createLocalResearchProvider({ fetch: svc.fetch });
    const d = await p.getVerification("SPEC-001");
    if (d.kind !== "ready") throw new Error(d.kind);
    const first = await p.getEvidence("SPEC-001", { snapshotId: d.data.local!.snapshotId, limit: 2 });
    if (first.kind !== "ready") throw new Error(first.kind);
    svc.restart();
    const second = await p.getEvidence("SPEC-001", { snapshotId: d.data.local!.snapshotId, limit: 2, cursor: first.data.nextCursor! });
    expect(second).toMatchObject({ kind: "error", access: "STALE_SNAPSHOT", code: "snapshot_unavailable" });
  });
});
