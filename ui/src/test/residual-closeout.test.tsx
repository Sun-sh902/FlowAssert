/**
 * Round 02 residual closeout: regression tests for the confirmed findings, and the contract boundary of the ones
 * classified as unreachable.
 *   R04  an out-of-contract case ID never reaches the archive index (the decoder refuses the whole list page)
 *   R05  a Service 404 for a live case is "no current result", not a read failure; failures, an unreachable Service,
 *        cancelled and pending reads are each named as what they are
 *   R06  the History list's record check says what this browser checked (identifier binding), not a recomputed digest
 *   R07  replacing the provider under the same key re-reads from the new provider; the old provider's answer is dropped
 */
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecordCheck } from "../components/history/HistoryRows";
import type { ProviderResult } from "../data/access";
import { decodeHistoryList } from "../data/history/decode";
import { createLocalHistoryProvider } from "../data/history/provider";
import { createLocalResearchProvider } from "../data/local/provider";
import { MOCK_CONTEXT, type FlowAssertHistoryProvider } from "../data/provider";
import { latestRuns } from "../data/store";
import type { HistorySummaryView } from "../domain/history";
import type { RunView } from "../domain/view";
import { useHistoryList } from "../lib/useHistoryList";
import { useProviderRead } from "../lib/useProviderRead";
import { WorkspaceOverview } from "../pages/Workspace";
import { example, fakeHistoryService } from "./local/fakeHistoryService";
import { fakeService, json } from "./local/fakeService";

/* ---------- R04 · ArchiveIndex.unexpected: the contract boundary ---------- */

describe("R04 an out-of-contract case ID never reaches the archive index", () => {
  const list = () => JSON.parse(JSON.stringify(example("021-list-after-insert")));

  it("the decoder refuses a list page whose entry names SPEC-009, as a whole", () => {
    const body = list();
    body.items[0].original_verification_id = "SPEC-009";
    const decoded = decodeHistoryList(body, { limit: body.items.length });
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.code).toBe("schema_invalid");
      expect(decoded.problems.join("\n")).toMatch(/original_verification_id: does not match \^SPEC-00\[1-5\]\$/);
    }
  });

  it("the unchanged page is admitted (control)", () => {
    const body = list();
    expect(decodeHistoryList(body, { limit: body.items.length }).ok).toBe(true);
  });

  it("the Overview shows no SPEC-009 and no archive counts when the Service sends one", async () => {
    const history = fakeHistoryService();
    const v1 = fakeService();
    history.intercept(
      (u) => u.pathname === "/api/v1/history/verifications",
      () => {
        const body = list();
        body.items = body.items.slice(0, 4);
        body.items[0].original_verification_id = "SPEC-009";
        return json(body);
      },
    );
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => (String(input).startsWith("/api/v1/history") ? history.fetch(input, init) : v1.fetch(input, init))) as typeof fetch;
    render(<WorkspaceOverview history={createLocalHistoryProvider({ fetch: fetchImpl })} live={createLocalResearchProvider({ fetch: fetchImpl })} />);
    const register = await screen.findByRole("region", { name: "Workspace register" });
    await waitFor(() => expect(register.textContent).toMatch(/Archivenot read \((failed|refused)\)/));
    expect(register.textContent).toMatch(/Record checks—/);
    expect(document.body.textContent).not.toContain("SPEC-009");
  });
});

/* ---------- R05 · not_found is not a read failure ---------- */

const CASES = ["SPEC-001", "SPEC-002", "SPEC-003", "SPEC-004", "SPEC-005"] as const;
type Outcome = "ready" | "not_found" | "error" | "transport" | "pending";
const notFound = () => json({ error: { code: "run_not_found", message: "x", request_id: "r", retryable: false, details: [] } }, 404);
const serverError = () => json({ error: { code: "internal_error", message: "x", request_id: "r", retryable: false, details: [] } }, 500);

/** The Overview with the real captured archive and, per case, the given live outcome. */
function overview(outcomes: Record<(typeof CASES)[number], Outcome>, archive: "ok" | "transport" = "ok") {
  const history = fakeHistoryService();
  const v1 = fakeService();
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(input);
    if (raw.startsWith("/api/v1/history")) return archive === "transport" ? Promise.reject(new TypeError("fetch failed")) : history.fetch(input, init);
    const id = CASES.find((c) => raw.endsWith(`/${c}?phase3b=true`));
    const o = id ? outcomes[id] : "ready";
    if (o === "not_found") return Promise.resolve(notFound());
    if (o === "error") return Promise.resolve(serverError());
    if (o === "transport") return Promise.reject(new TypeError("fetch failed"));
    if (o === "pending") return new Promise<Response>(() => {});
    return v1.fetch(input, init);
  }) as typeof fetch;
  render(<WorkspaceOverview history={createLocalHistoryProvider({ fetch: fetchImpl })} live={createLocalResearchProvider({ fetch: fetchImpl })} />);
}
const all = (o: Outcome) => Object.fromEntries(CASES.map((c) => [c, o])) as Record<(typeof CASES)[number], Outcome>;
const h1 = () => screen.getByRole("heading", { level: 1 }).textContent ?? "";
const register = () => screen.getByRole("region", { name: "Workspace register" }).textContent ?? "";
const settled = () => waitFor(() => expect(document.querySelectorAll('[data-case] [data-comparison]:not([data-comparison="READING"])').length).toBe(5));

describe("R05 the Overview headline and register keep not-found apart from failures", () => {
  it("1 · all ready: the headline names states only; nothing is unread", async () => {
    overview(all("ready"));
    await settled();
    expect(h1()).not.toMatch(/could not|no current result|still being read/i);
    await waitFor(() => expect(register()).toMatch(/5 of 5 answered · ≤2 at a time/));
  });

  it("2 · all not found: the Service holds no current result — not 'could not be read'", async () => {
    overview(all("not_found"));
    await waitFor(() => expect(h1()).toBe("The Service holds no current result for these cases."));
    expect(h1()).not.toMatch(/could not be read|could be read/);
    expect(register()).toMatch(/5 of 5 answered \(5 not found\)/);
    expect(within(screen.getByRole("region", { name: "No current result" })).getAllByRole("listitem")).toHaveLength(5);
  });

  it("3 · mixed ready and not found: the missing case is named as having no current result", async () => {
    overview({ ...all("ready"), "SPEC-003": "not_found" });
    await settled();
    await waitFor(() => expect(h1()).toMatch(/One has no current result at the Service\./i));
    expect(h1()).not.toMatch(/could not be read/);
    expect(register()).toMatch(/5 of 5 answered \(1 not found\)/);
  });

  it("4 · all transport failures (live and archive): the Service-unavailable page, never 'not found'", async () => {
    overview(all("transport"), "transport");
    await waitFor(() => expect(document.querySelector('[data-access="SERVICE_UNAVAILABLE"]')).not.toBeNull());
    expect(document.body.textContent).not.toMatch(/no current result at the Service|holds no current result/);
  });

  it("4b · all live reads failed with a Service error: still 'could not be read'", async () => {
    overview(all("error"));
    await waitFor(() => expect(h1()).toBe("No current result could be read."));
    expect(register()).toMatch(/0 of 5 answered · ≤2 at a time/);
  });

  it("5 · mixed failure and not found, nothing read: each is counted under its own name", async () => {
    overview({ ...all("not_found"), "SPEC-001": "error", "SPEC-002": "error" });
    await waitFor(() => expect(h1()).toMatch(/^No current result was read\./));
    expect(h1()).toMatch(/Three have no current result at the Service/i);
    expect(h1()).toMatch(/two could not be read/i);
  });

  it("5b · one live read cannot reach the Service while the others answer: named as unreachable", async () => {
    overview({ ...all("ready"), "SPEC-004": "transport" });
    await settled();
    await waitFor(() => expect(h1()).toMatch(/One could not reach the Service\./i));
    expect(h1()).not.toMatch(/no current result at the Service/);
  });

  it("6 · reads still pending are 'being read', never counted as not found or failed", async () => {
    overview({ ...all("pending"), "SPEC-001": "not_found" });
    await waitFor(() => expect(h1()).toBe("No current result has been read yet."));
    expect(screen.getByRole("region", { name: "Current result being read" })).toBeTruthy();
    expect(register()).toMatch(/1 of 5 answered \(1 not found\)/);
  });
});

/* ---------- R06 · the History list's record check wording ---------- */

describe("R06 the record check tooltip says what this browser checked", () => {
  const entry = { historyId: `hist_${"0".repeat(64)}`, integrity: { status: "INTEGRITY_VERIFIED", checkedSha256: "0".repeat(64), scope: "archive_candidate_and_relationships" } } as unknown as HistorySummaryView;

  it("credits the digest check to the Service, and says the browser compared identifiers without recomputing", () => {
    render(<RecordCheck entry={entry} />);
    const title = document.querySelector(".fa-itag")!.closest("[title]")!.getAttribute("title")!;
    expect(title).toMatch(/^The Service re-verified this archive’s stored candidate bytes and relationships/);
    expect(title).toContain("This browser did not recompute that digest");
    expect(title).toContain("history, archive and snapshot IDs");
    expect(title).not.toContain("confirmed that the reported digest");
    // Text, glyph and assistive-technology name stay the Service's check.
    expect(document.querySelector(".fa-itag")!.textContent).toBe("Integrity verified: record check · service");
  });
});

/* ---------- R07 · provider replacement under an unchanged key ---------- */

const run = latestRuns[0]!;
const other = latestRuns[1]!;
const ready = (data: RunView): ProviderResult<RunView> => ({ kind: "ready", data, context: { ...MOCK_CONTEXT, snapshotId: null } });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}
interface FakeProvider {
  calls: AbortSignal[];
  read: (signal: AbortSignal) => Promise<ProviderResult<RunView>>;
}
function provider(answer: () => Promise<ProviderResult<RunView>>): FakeProvider {
  const p: FakeProvider = {
    calls: [],
    read: (signal) => {
      p.calls.push(signal);
      return answer();
    },
  };
  return p;
}
const useRead = ({ p }: { p: FakeProvider }) => useProviderRead((signal) => p.read(signal), "k", { source: p });

describe("R07 useProviderRead re-reads when the provider object changes", () => {
  it("queries provider B after A is replaced under the same key, and shows B's answer", async () => {
    const a = provider(async () => ready(run));
    const b = provider(async () => ready(other));
    const { result, rerender } = renderHook(useRead, { initialProps: { p: a } });
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "settled", result: { data: run } }));
    rerender({ p: b });
    // Never A's data under provider B, not even for one render.
    expect(result.current.state.status === "settled" && result.current.state.result.kind === "ready" && result.current.state.result.data).not.toBe(run);
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "settled", result: { data: other } }));
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
  });

  it("a late answer from the replaced provider cannot overwrite the new provider's answer, and A's read is aborted", async () => {
    const late = deferred<ProviderResult<RunView>>();
    const a = provider(() => late.promise);
    const b = provider(async () => ready(other));
    const { result, rerender } = renderHook(useRead, { initialProps: { p: a } });
    rerender({ p: b });
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "settled", result: { data: other } }));
    expect(a.calls[0]!.aborted).toBe(true);
    await act(async () => late.resolve(ready(run)));
    expect(result.current.state).toMatchObject({ status: "settled", result: { data: other } });
  });

  it("a stable provider is read once across re-renders (no loop, no extra reads)", async () => {
    const a = provider(async () => ready(run));
    const { result, rerender } = renderHook(useRead, { initialProps: { p: a } });
    await waitFor(() => expect(result.current.state.status).toBe("settled"));
    for (let i = 0; i < 5; i++) rerender({ p: a });
    expect(a.calls).toHaveLength(1);
  });

  it("unmount while the new provider's read is pending aborts it and publishes nothing", async () => {
    const a = provider(async () => ready(run));
    const b = provider(() => new Promise(() => {}));
    const { result, rerender, unmount } = renderHook(useRead, { initialProps: { p: a } });
    await waitFor(() => expect(result.current.state.status).toBe("settled"));
    rerender({ p: b });
    await waitFor(() => expect(b.calls).toHaveLength(1));
    unmount();
    expect(b.calls[0]!.aborted).toBe(true);
  });

  it("a failing replacement settles as B's failure, never as A's data", async () => {
    const a = provider(async () => ready(run));
    const b = provider(async () => Promise.reject(new TypeError("Failed to fetch")));
    const { result, rerender } = renderHook(useRead, { initialProps: { p: a } });
    await waitFor(() => expect(result.current.state.status).toBe("settled"));
    rerender({ p: b });
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "settled", result: { kind: "error", access: "REQUEST_ERROR" } }));
  });
});

describe("R07 useHistoryList starts a new list view when the provider object changes", () => {
  const providerOf = (svc: ReturnType<typeof fakeHistoryService>) => createLocalHistoryProvider({ fetch: svc.fetch });

  it("reads provider B from the first page and drops A's pages", async () => {
    const svcA = fakeHistoryService();
    const svcB = fakeHistoryService();
    svcB.empty();
    const a: FlowAssertHistoryProvider = providerOf(svcA);
    const b: FlowAssertHistoryProvider = providerOf(svcB);
    const { result, rerender } = renderHook(({ p }) => useHistoryList(p, undefined), { initialProps: { p: a } });
    await waitFor(() => expect(result.current.chain.items.length).toBeGreaterThan(0));
    rerender({ p: b });
    // No entry of A is ever presented as B's.
    expect(result.current.chain.items).toHaveLength(0);
    await waitFor(() => expect(result.current.status).toBe("complete"));
    expect(result.current.chain.items).toHaveLength(0);
    expect(svcB.log.filter((u) => u.startsWith("/api/v1/history/verifications?"))).toHaveLength(1);
  });

  it("after loading more from A, provider B starts again at its first page (no cursor carried over)", async () => {
    const svcA = fakeHistoryService();
    const svcB = fakeHistoryService();
    const { result, rerender } = renderHook(({ p }) => useHistoryList(p, undefined), { initialProps: { p: providerOf(svcA) } });
    await waitFor(() => expect(result.current.status).toBe("more"));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.chain.pages).toBe(2));
    rerender({ p: providerOf(svcB) });
    await waitFor(() => expect(result.current.chain.pages).toBe(1));
    expect(svcB.log.filter((u) => u.startsWith("/api/v1/history/verifications?"))).toEqual(["/api/v1/history/verifications?limit=4"]);
  });

  it("a stable provider reads its first page once", async () => {
    const svc = fakeHistoryService();
    const p = providerOf(svc);
    const { result, rerender } = renderHook(({ p }) => useHistoryList(p, undefined), { initialProps: { p } });
    await waitFor(() => expect(result.current.status).toBe("more"));
    for (let i = 0; i < 5; i++) rerender({ p });
    expect(svc.log.filter((u) => u.startsWith("/api/v1/history/verifications?"))).toHaveLength(1);
  });
});
