/**
 * Phase 3A LocalHistoryProvider: exact wire requests, outcome classification (including integrity
 * failures), cancellation, archived-evidence digests, the list pagination rules and MOCK/LIVE
 * separation. HTTP is a test double here (./local/fakeHistoryService.ts, real captured bodies); the
 * real SQLite-backed Service is exercised by e2e-history/.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toHistoryListPageView } from "../adapters/historyToView";
import { admitListPage, startListChain } from "../data/history/listChain";
import { createLocalHistoryProvider, historyDetailUrl, historyEvidenceUrl, historyListUrl } from "../data/history/provider";
import { getHistoryProvider, unavailableHistoryProvider } from "../data/provider";
import type { EvidenceBinding } from "../data/history/decode";
import type { HistoryDetailView } from "../domain/history";
import { EXPECTED_ARCHIVE } from "./phase3a-history-decode.test";
import { FIRST_BATCH, example, fakeHistoryService, historyEnvelope, json } from "./local/fakeHistoryService";

const bindingOf = (d: HistoryDetailView): EvidenceBinding => ({ historyId: d.historyId, snapshotId: d.snapshotId, archiveId: d.archiveId, originalSnapshotId: d.originalSnapshotId, originalVerificationId: d.verificationId });

describe("wire requests", () => {
  it("use the additive contract's snake_case names, in a fixed order, and nothing else", () => {
    expect(historyListUrl({ limit: 4 })).toBe("/api/v1/history/verifications?limit=4");
    expect(historyListUrl({ limit: 4, verificationId: "SPEC-005", cursor: "a+b/c=" })).toBe("/api/v1/history/verifications?limit=4&verification_id=SPEC-005&cursor=a%2Bb%2Fc%3D");
    const h = `hist_${"a".repeat(64)}`;
    expect(historyDetailUrl(h)).toBe(`/api/v1/history/verifications/${h}`);
    expect(historyDetailUrl(h, "history-snapshot_x")).toBe(`/api/v1/history/verifications/${h}?snapshot_id=history-snapshot_x`);
    const u = new URL(historyEvidenceUrl(h, { snapshotId: "s", limit: 2, includePayload: false, cursor: "c.1" }), "http://x");
    expect([...u.searchParams.keys()]).toEqual(["snapshot_id", "limit", "include_payload", "cursor"]);
    expect(u.searchParams.get("cursor")).toBe("c.1");
  });

  it("are relative GETs with credentials omitted and redirects refused", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const p = createLocalHistoryProvider({ fetch: (async (url: string, init?: RequestInit) => (seen.push({ url, init }), json({}, 500))) as unknown as typeof fetch });
    await p.listHistory({ limit: 4 });
    expect(seen[0]!.url).toBe("/api/v1/history/verifications?limit=4");
    expect(seen[0]!.init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store" });
  });

  it("source names no external origin and imports no demo fixture, demo store or MOCK module", () => {
    for (const f of ["src/data/history/provider.ts", "src/data/history/decode.ts", "src/data/history/listChain.ts", "src/data/history/config.ts", "src/adapters/historyToView.ts", "src/pages/History.tsx", "src/components/history/HistoryEntry.tsx", "src/components/history/HistoryRows.tsx", "src/lib/useHistoryList.ts"]) {
      const src = readFileSync(f, "utf8");
      // Any absolute URL other than the loopback Service (the bare prefix "http://" may appear, stripped from that target).
      expect(src, f).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)[A-Za-z0-9[]/);
      const imports = [...src.matchAll(/^import (?!type )[^;]*?from "([^"]+)"/gms)].map((m) => m[1]);
      expect(imports.filter((i) => /mocks\/|data\/store|\/store$|researchToView|demoConfig/.test(i!)), f).toEqual([]);
      expect(src, f).not.toMatch(/\bDEMO_[A-Z_]+/);
    }
  });
});

describe("ready results copy the archive", () => {
  for (const [id, want] of Object.entries(EXPECTED_ARCHIVE))
    it(`${id}: archived cohort, record states in archive order, counts, population`, async () => {
      const r = await createLocalHistoryProvider({ fetch: fakeHistoryService().fetch }).getHistory(FIRST_BATCH[id]!);
      expect(r.kind).toBe("ready");
      if (r.kind !== "ready") return;
      expect(r.data.run.state).toBe(want.cohort);
      expect(r.data.result.cohort).toBe(want.cohort);
      expect(r.data.run.records.map((x) => x.state)).toEqual(want.records);
      expect(r.data.run.records.map((x) => x.sourceRow)).toEqual(want.records.map((_, i) => i));
      expect(r.data.run.expectedTotal).toBe(want.expectedTotal);
      expect(r.data.result.expectedTotal).toBe(want.expectedTotal);
      expect(r.data.run.populationKnown).toBe(want.populationKnown);
      // Two snapshot namespaces, kept apart.
      expect(r.data.snapshotId).toMatch(/^history-snapshot_[a-f0-9]{64}$/);
      expect(r.data.originalSnapshotId).toBe(r.data.run.local!.snapshotId);
      expect(r.data.originalSnapshotId).not.toBe(r.data.snapshotId);
      expect(r.context).toMatchObject({ mode: "LOCAL_RESEARCH", contractVersion: "phase3a-1.0.0", snapshotId: r.data.snapshotId, researchAuthorization: "research_only" });
    });

  it("SPEC-005: 12 Verified records, Unverified cohort, total unknown — never 0, never 12", async () => {
    const r = await createLocalHistoryProvider({ fetch: fakeHistoryService().fetch }).getHistory(FIRST_BATCH["SPEC-005"]!);
    if (r.kind !== "ready") throw new Error(r.kind);
    expect(r.data.run.counts).toEqual({ Verified: 12, Mismatch: 0, Pending: 0, Unverified: 0 });
    expect(r.data.run.state).toBe("Unverified");
    expect(r.data.run.expectedTotal).toBeNull();
    expect(r.data.result.expectedTotal).toBeNull();
  });

  it("archived evidence: bound to the Detail, every digest reproduced in this browser from the response lexemes", async () => {
    const svc = fakeHistoryService();
    const p = createLocalHistoryProvider({ fetch: svc.fetch });
    const d = await p.getHistory(FIRST_BATCH["SPEC-002"]!);
    if (d.kind !== "ready") throw new Error(d.kind);
    const page1 = await p.getHistoryEvidence(d.data.historyId, { binding: bindingOf(d.data), limit: 2, includePayload: true });
    if (page1.kind !== "ready") throw new Error(page1.kind);
    expect(page1.data.items.map((x) => x.payload.state === "loaded" && x.payload.digest)).toEqual(["reproduced", "reproduced"]);
    expect(page1.data.items.every((x) => x.serviceIntegrity?.status === "INTEGRITY_VERIFIED")).toBe(true);
    const page2 = await p.getHistoryEvidence(d.data.historyId, { binding: bindingOf(d.data), limit: 2, includePayload: true, cursor: page1.data.nextCursor! });
    if (page2.kind !== "ready") throw new Error(page2.kind);
    expect([...page1.data.items, ...page2.data.items].map((x) => x.id)).toEqual(d.data.run.local!.evidenceReferences.map((x) => x.id));
    expect(page2.data.nextCursor).toBeNull();
    for (const u of svc.log.filter((x) => x.includes("/evidence"))) expect(u).toContain(`snapshot_id=${d.data.snapshotId}&limit=2&include_payload=true`);
  });

  it("a payload altered in transit is a digest mismatch on that item only — identified, not hidden", async () => {
    const svc = fakeHistoryService();
    const p = createLocalHistoryProvider({ fetch: svc.fetch });
    const d = await p.getHistory(FIRST_BATCH["SPEC-001"]!);
    if (d.kind !== "ready") throw new Error(d.kind);
    svc.intercept(
      (u) => u.pathname.endsWith("/evidence"),
      async (u) => {
        const real = await (await fakeHistoryService().fetch(u.pathname + u.search)).json();
        real.items[1].payload.tampered = true;
        return json(real);
      },
    );
    const r = await p.getHistoryEvidence(d.data.historyId, { binding: bindingOf(d.data), limit: 2, includePayload: true });
    if (r.kind !== "ready") throw new Error(r.kind);
    expect(r.data.items.map((x) => (x.payload.state === "loaded" ? x.payload.digest : null))).toEqual(["reproduced", "mismatch"]);
  });

  it("payloads omitted by request carry no digest check, and stored availability is unchanged", async () => {
    const p = createLocalHistoryProvider({ fetch: fakeHistoryService().fetch });
    const d = await p.getHistory(FIRST_BATCH["SPEC-003"]!);
    if (d.kind !== "ready") throw new Error(d.kind);
    const r = await p.getHistoryEvidence(d.data.historyId, { binding: bindingOf(d.data), limit: 2, includePayload: false });
    if (r.kind !== "ready") throw new Error(r.kind);
    expect(r.data.items.map((x) => [x.availability, x.payload.state])).toEqual([
      ["available", "omitted"],
      ["available", "omitted"],
    ]);
  });

  it("evidence requested for another history than its binding is refused without a request", async () => {
    const svc = fakeHistoryService();
    const p = createLocalHistoryProvider({ fetch: svc.fetch });
    const d = await p.getHistory(FIRST_BATCH["SPEC-001"]!);
    if (d.kind !== "ready") throw new Error(d.kind);
    const n = svc.log.length;
    const r = await p.getHistoryEvidence(FIRST_BATCH["SPEC-002"]!, { binding: bindingOf(d.data), limit: 2, includePayload: true });
    expect(r).toMatchObject({ kind: "error", code: "binding_conflict" });
    expect(svc.log.length).toBe(n);
  });
});

describe("outcome classification", () => {
  const H = () => FIRST_BATCH["SPEC-001"]!;
  const once = (body: () => Response | Promise<Response>) => {
    const svc = fakeHistoryService();
    svc.intercept(() => true, body);
    return createLocalHistoryProvider({ fetch: svc.fetch, timeoutMs: 200 });
  };
  it("404 history_not_found → not_found (never invented rows)", async () => expect(await once(() => historyEnvelope("history_not_found", 404)).getHistory(H())).toMatchObject({ kind: "not_found" }));
  it("404 history_route_not_found → request error, not 'not found'", async () => expect(await once(() => historyEnvelope("history_route_not_found", 404)).getHistory(H())).toMatchObject({ kind: "error", access: "REQUEST_ERROR", code: "history_route_not_found" }));
  it("409 history_snapshot_conflict → STALE_SNAPSHOT", async () => expect(await once(() => historyEnvelope("history_snapshot_conflict", 409)).getHistory(H())).toMatchObject({ kind: "error", access: "STALE_SNAPSHOT", httpStatus: 409 }));
  it("503 INTEGRITY_FAILED on a Detail → SERVICE_UNAVAILABLE carrying the integrity failure", async () =>
    expect(await once(() => historyEnvelope("evidence_digest_mismatch", 503, [{ path: "archive", code: "INTEGRITY_FAILED" }])).getHistory(H())).toMatchObject({
      kind: "error",
      access: "SERVICE_UNAVAILABLE",
      code: "evidence_digest_mismatch",
      integrity: "INTEGRITY_FAILED",
      httpStatus: 503,
      retryable: true,
    }));
  it("503 INTEGRITY_UNVERIFIABLE on a list → carries unverifiable", async () =>
    expect(await once(() => historyEnvelope("archived_evidence_missing", 503, [{ path: "archive", code: "INTEGRITY_UNVERIFIABLE" }])).listHistory({ limit: 4 })).toMatchObject({ integrity: "INTEGRITY_UNVERIFIABLE" }));
  it("503 without integrity details → no integrity claim either way", async () => {
    const r = await once(() => historyEnvelope("history_key_unavailable", 503)).listHistory({ limit: 4 });
    expect(r).toMatchObject({ kind: "error", access: "SERVICE_UNAVAILABLE", code: "history_key_unavailable" });
    expect((r as { integrity?: string }).integrity).toBeUndefined();
  });
  for (const [status, code] of [
    [400, "invalid_cursor"],
    [400, "cursor_query_conflict"],
    [400, "invalid_query"],
    [403, "origin_not_allowed"],
    [405, "method_not_allowed"],
    [422, "invalid_parameter"],
    [500, "internal_error"],
  ] as const)
    it(`${status} ${code} → REQUEST_ERROR with the Service's own code`, async () => expect(await once(() => historyEnvelope(code, status)).listHistory({ limit: 4 })).toMatchObject({ kind: "error", access: "REQUEST_ERROR", code, httpStatus: status }));
  it("a gate refusal (not a FlowAssert envelope) → SERVICE_UNAVAILABLE no_service_envelope", async () =>
    expect(await once(() => json({ gate: { code: "route_not_allowed", reason: "x" } }, 404)).listHistory({ limit: 4 })).toMatchObject({ access: "SERVICE_UNAVAILABLE", code: "no_service_envelope" }));
  it("a proxy 502 text page → SERVICE_UNAVAILABLE no_service_envelope", async () =>
    expect(await once(() => new Response("Bad Gateway", { status: 502, headers: { "content-type": "text/plain" } })).getHistory(H())).toMatchObject({ access: "SERVICE_UNAVAILABLE", code: "no_service_envelope" }));
  it("200 that is not JSON → REQUEST_ERROR malformed_response, nothing published", async () => {
    expect(await once(() => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } })).listHistory({ limit: 4 })).toMatchObject({ access: "REQUEST_ERROR", code: "malformed_response" });
    expect(await once(() => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })).listHistory({ limit: 4 })).toMatchObject({ access: "REQUEST_ERROR", code: "malformed_response" });
  });
  it("200 with a contradictory body → REQUEST_ERROR with the refusal code", async () => {
    const r = await once(() => {
      const d = example("002-SPEC-001-history-detail");
      d.integrity.status = "INTEGRITY_FAILED";
      return json(d);
    }).getHistory(H());
    expect(r).toMatchObject({ kind: "error", access: "REQUEST_ERROR", code: "integrity_status_conflict", integrity: "INTEGRITY_FAILED", httpStatus: 200 });
  });
  it("network failure → SERVICE_UNAVAILABLE transport_failure", async () => {
    const p = createLocalHistoryProvider({ fetch: (async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch });
    expect(await p.listHistory({ limit: 4 })).toMatchObject({ access: "SERVICE_UNAVAILABLE", code: "transport_failure" });
  });
  it("time limit → SERVICE_UNAVAILABLE timeout", async () => {
    const p = createLocalHistoryProvider({
      timeoutMs: 30,
      fetch: ((_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch,
    });
    expect(await p.listHistory({ limit: 4 })).toMatchObject({ access: "SERVICE_UNAVAILABLE", code: "timeout" });
  });
  it("caller abort rejects with AbortError (no result)", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(createLocalHistoryProvider({ fetch: fakeHistoryService().fetch }).listHistory({ limit: 4 }, ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("list view: pagination under one list snapshot", () => {
  it("reads the 10-entry archive in 3 pages of 4, in the Service's order, ending exactly at page.total", async () => {
    const svc = fakeHistoryService();
    const p = createLocalHistoryProvider({ fetch: svc.fetch });
    let chain = startListChain(4);
    let cursor: string | null = null;
    for (let i = 0; i < 3; i++) {
      const r = await p.listHistory({ limit: 4, cursor: cursor ?? undefined });
      if (r.kind !== "ready") throw new Error(r.kind);
      const step = admitListPage(chain, cursor, r.data);
      if (!step.ok) throw new Error(step.code);
      chain = step.chain;
      cursor = chain.next ?? null;
    }
    expect(chain.next).toBeNull();
    expect(chain.items.map((x) => x.historyId)).toEqual(svc.entries().map((x) => x.history_id));
    expect(chain.items).toHaveLength(10);
    expect(chain.total).toBe(10);
  });

  it("a filtered view lists only that case, and its continuation carries the same filter", async () => {
    const svc = fakeHistoryService();
    const p = createLocalHistoryProvider({ fetch: svc.fetch });
    const r = await p.listHistory({ limit: 1, verificationId: "SPEC-005" });
    if (r.kind !== "ready") throw new Error(r.kind);
    expect(r.data.items.map((x) => x.verificationId)).toEqual(["SPEC-005"]);
    expect(r.data.total).toBe(2);
    const r2 = await p.listHistory({ limit: 1, verificationId: "SPEC-005", cursor: r.data.nextCursor! });
    expect(r2.kind).toBe("ready");
    expect(svc.log.at(-1)).toContain("verification_id=SPEC-005");
  });

  const page = (n: number, from: number, next: string | null, total = 10, snap = "list_a") => {
    const all = example("021-list-after-insert");
    return toHistoryListPageView({ ...all, items: all.items.slice(from, from + n), page: { snapshot_id: snap, next_cursor: next, total } });
  };
  const first = () => {
    const s = admitListPage(startListChain(4), null, page(4, 0, "c1"));
    if (!s.ok) throw new Error(s.code);
    return s.chain;
  };
  const cases: [string, () => ReturnType<typeof admitListPage>, string][] = [
    ["a continuation from another list view", () => admitListPage(first(), "c1", page(4, 4, "c2", 10, "list_b")), "snapshot_mismatch"],
    ["page.total changing inside one view", () => admitListPage(first(), "c1", page(4, 4, "c2", 11)), "total_conflict"],
    ["an entry repeated across pages", () => admitListPage(first(), "c1", page(4, 0, "c2")), "duplicate_entry"],
    ["a cursor the view already followed", () => admitListPage(first(), "c1", page(4, 4, "c1")), "cursor_cycle"],
    ["an empty page that asks to continue", () => admitListPage(first(), "c1", page(0, 4, "c2")), "no_progress"],
    ["a view that ends early", () => admitListPage(first(), "c1", page(4, 4, null)), "omitted_entries"],
    ["a page answering an unexpected cursor", () => admitListPage(first(), "zz", page(4, 4, "c2")), "cursor_out_of_sequence"],
    ["more entries than page.total", () => {
      const s = admitListPage(startListChain(4), null, page(4, 0, "c1", 5));
      if (!s.ok) throw new Error(s.code);
      return admitListPage(s.chain, "c1", page(4, 4, null, 5));
    }, "extra_entries"],
    ["a page larger than the limit", () => admitListPage(startListChain(4), null, page(5, 0, null, 10)), "page_too_large"],
  ];
  for (const [name, run, code] of cases) it(`refuses ${name} (${code})`, () => expect(run()).toMatchObject({ ok: false, code }));
  it("refuses any page after the view has ended", () => {
    const done = admitListPage(startListChain(25), null, page(10, 0, null));
    if (!done.ok) throw new Error(done.code);
    expect(admitListPage(done.chain, null, page(1, 0, null))).toMatchObject({ ok: false, code: "chain_complete" });
  });
});

describe("provider modes: history exists only in LOCAL_RESEARCH", () => {
  it("MOCK has no archive: an explicit unavailable error, never synthetic history", async () => {
    const p = getHistoryProvider("MOCK");
    expect(p.mode).toBe("MOCK");
    expect(await p.listHistory({ limit: 4 })).toMatchObject({ kind: "error", access: "SERVICE_UNAVAILABLE", code: "mock_history_not_modelled" });
    expect(await p.getHistory(`hist_${"a".repeat(64)}`)).toMatchObject({ kind: "error", code: "mock_history_not_modelled" });
  });
  it("LIVE is not implemented", async () => {
    expect(await unavailableHistoryProvider("LIVE").listHistory({ limit: 4 })).toMatchObject({ kind: "error", code: "provider_mode_unavailable" });
  });
  it("LOCAL_RESEARCH is the real HTTP provider", () => expect(getHistoryProvider("LOCAL_RESEARCH").mode).toBe("LOCAL_RESEARCH"));
});
