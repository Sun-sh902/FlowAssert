/**
 * Phase 3A History pages — component behaviour with a test-double history service built from the
 * backend's real captured bodies. (The real SQLite-backed Service is exercised in browsers by e2e-history/.)
 * Expected verdicts come from EXPECTED_ARCHIVE (handoff table), never from the rendered output.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProviderResult } from "../data/access";
import { createLocalHistoryProvider } from "../data/history/provider";
import type { FlowAssertHistoryProvider } from "../data/provider";
import type { HistoryDetailView } from "../domain/history";
import type { Location } from "../lib/router";
import { HistoryEntry, HistoryList } from "../pages/History";
import { EXPECTED_ARCHIVE } from "./phase3a-history-decode.test";
import { FIRST_BATCH, example, fakeHistoryService, historyEnvelope, json, type FakeHistoryService } from "./local/fakeHistoryService";
import { renderApp } from "./render";

const listLoc = (query = ""): Location => ({ route: { name: "local-history" }, params: new URLSearchParams(query), path: "/local/history" });
const entryLoc = (id: string): Location => ({ route: { name: "local-history-entry", id }, params: new URLSearchParams(), path: `/local/history/${id}` });

function mountList(svc: FakeHistoryService, query = "") {
  window.history.replaceState(null, "", `#/local/history${query ? `?${query}` : ""}`);
  const user = userEvent.setup();
  return { user, ...render(<HistoryList location={listLoc(query)} provider={createLocalHistoryProvider({ fetch: svc.fetch })} />) };
}
function mountEntry(id: string, provider: FlowAssertHistoryProvider) {
  window.history.replaceState(null, "", `#/local/history/${id}`);
  const user = userEvent.setup();
  return { user, ...render(<HistoryEntry id={id} location={entryLoc(id)} provider={provider} />) };
}

const rows = () => [...document.querySelectorAll<HTMLElement>("tr[data-history-id]")];
const rowStates = () => rows().map((r) => r.querySelector(".fa-seal")!.getAttribute("data-s"));
const seal = () => document.querySelector('.fa-seal[data-size="lg"]');
const retrieval = () => document.querySelector("[data-retrieval]")?.textContent;
const integrity = () => document.querySelector("[data-integrity]")?.textContent;
const topIntegrity = () => document.querySelector("[data-archive-evidence-integrity]")?.getAttribute("data-archive-evidence-integrity");

describe("History list", () => {
  it("reads the archive page by page, keeping the Service's order and counting archive entries only", async () => {
    const svc = fakeHistoryService();
    const { user } = mountList(svc);
    expect(screen.getByRole("status").textContent).toMatch(/Reading the archive list/);
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(document.querySelector("[data-list-status]")!.textContent).toMatch(/^4 of 10 archive entries shown · 1 page · older entries remain/);
    await user.click(screen.getByRole("button", { name: "Load older entries" }));
    await waitFor(() => expect(rows()).toHaveLength(8));
    await user.click(screen.getByRole("button", { name: "Load older entries" }));
    await waitFor(() => expect(rows()).toHaveLength(10));
    expect(document.querySelector("[data-list-status]")!.textContent).toMatch(/^All 10 archive entries shown · 3 pages, in archive order/);
    expect(rows().map((r) => r.dataset.historyId)).toEqual(svc.entries().map((e) => e.history_id));
    const byCase = svc.entries().map((e) => EXPECTED_ARCHIVE[e.original_verification_id as keyof typeof EXPECTED_ARCHIVE].cohort);
    expect(rowStates()).toEqual(byCase);
    expect(screen.queryByRole("button", { name: "Load older entries" })).toBeNull();
    // Each continuation sends the previous page's cursor; the limit is constant.
    expect(svc.log).toHaveLength(3);
    expect(svc.log[0]).toBe("/api/v1/history/verifications?limit=4");
    for (const u of svc.log.slice(1)) expect(u).toMatch(/^\/api\/v1\/history\/verifications\?limit=4&cursor=/);
  });

  it("SPEC-005 rows say 'total unknown', never 0 or 12", async () => {
    mountList(fakeHistoryService());
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const spec5 = rows().find((r) => r.textContent!.includes("SPEC-005"))!;
    expect(spec5.textContent).toContain("12 records · total unknown");
    expect(spec5.textContent).not.toMatch(/12 expected|0 expected/);
  });

  it("filters by case through the contract's verification_id and lists both archived evaluations of SPEC-005", async () => {
    const svc = fakeHistoryService();
    mountList(svc, "case=SPEC-005");
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().every((r) => r.textContent!.includes("SPEC-005"))).toBe(true);
    expect(new Set(rows().map((r) => r.dataset.historyId)).size).toBe(2);
    expect(svc.log[0]).toBe("/api/v1/history/verifications?limit=4&verification_id=SPEC-005");
  });

  it("refuses an unknown case filter without sending anything", () => {
    const svc = fakeHistoryService();
    mountList(svc, "case=SPEC-999");
    expect(screen.getByText("This address names an unknown case filter")).toBeTruthy();
    expect(svc.log).toEqual([]);
  });

  it("an empty archive is EMPTY — not Verified, not a failure", async () => {
    const svc = fakeHistoryService();
    svc.empty();
    mountList(svc);
    await waitFor(() => expect(screen.getByText("The local archive holds no evaluations")).toBeTruthy());
    expect(document.querySelector('[data-access="EMPTY"]')).toBeTruthy();
    expect(document.querySelector(".fa-seal")).toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it("a 503 integrity failure on the list is a conspicuous integrity alert with no entries and no verdict", async () => {
    const svc = fakeHistoryService();
    svc.intercept(() => true, () => historyEnvelope("evidence_digest_mismatch", 503, [{ path: "archive", code: "INTEGRITY_FAILED" }]));
    mountList(svc);
    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-integrity-notice")).toBe("failed");
    expect(alert.textContent).toContain("Integrity check failed");
    expect(alert.textContent).toContain("evidence_digest_mismatch");
    expect(alert.textContent).toContain("not a verdict");
    expect(rows()).toHaveLength(0);
    expect(document.querySelector(".fa-seal:not([data-s='reading'])")).toBeNull();
  });

  it("service unavailable: no entries, no MOCK fallback", async () => {
    const svc = fakeHistoryService();
    svc.intercept(() => true, () => Promise.reject(new TypeError("Failed to fetch")));
    mountList(svc);
    await waitFor(() => expect(document.querySelector('[data-access="SERVICE_UNAVAILABLE"]')).toBeTruthy());
    expect(document.body.textContent).toContain("none — no other data source is used");
    expect(rows()).toHaveLength(0);
  });

  it("a malformed 200 is refused, nothing listed", async () => {
    const svc = fakeHistoryService();
    svc.intercept(() => true, () => new Response("{oops", { status: 200, headers: { "content-type": "application/json" } }));
    mountList(svc);
    await waitFor(() => expect(document.querySelector('[data-access="REQUEST_ERROR"]')?.textContent).toContain("malformed_response"));
    expect(rows()).toHaveLength(0);
  });

  it("a rejected continuation cursor keeps the admitted page, says older entries were not read, and never claims completeness", async () => {
    const svc = fakeHistoryService();
    const { user } = mountList(svc);
    await waitFor(() => expect(rows()).toHaveLength(4));
    svc.intercept((u) => u.searchParams.has("cursor"), () => historyEnvelope("invalid_cursor", 400));
    await user.click(screen.getByRole("button", { name: "Load older entries" }));
    await waitFor(() => expect(screen.getByText("The service rejected the continuation cursor")).toBeTruthy());
    expect(rows()).toHaveLength(4);
    expect(document.querySelector("[data-list-status]")!.textContent).toMatch(/4 of 10 archive entries shown · older entries could not be read/);
    expect(document.body.textContent).not.toMatch(/All 10 archive entries shown/);
  });

  it("arrow keys move between entries; every entry link has a full screen-reader label", async () => {
    const { user } = mountList(fakeHistoryService());
    await waitFor(() => expect(rows()).toHaveLength(4));
    const links = within(document.querySelector<HTMLElement>('[data-history-layout="wide"]')!).getAllByRole("link");
    expect(links[0]!.getAttribute("aria-label")).toMatch(/^SPEC-005, archived evaluation hist_[a-f0-9]{64}\. Cohort result Unverified\. 12 records, total unknown\. Archived /);
    links[0]!.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(links[1]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(links[3]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(links[0]);
  });
});

describe("History entry", () => {
  for (const [id, want] of Object.entries(EXPECTED_ARCHIVE))
    it(`${id}: the archived cohort and records, exactly as archived`, async () => {
      mountEntry(FIRST_BATCH[id]!, createLocalHistoryProvider({ fetch: fakeHistoryService().fetch }));
      await waitFor(() => expect(seal()?.getAttribute("data-s")).toBe(want.cohort));
      const ids = [...document.querySelectorAll<HTMLElement>("section[aria-labelledby='index-title'] button.fa-cell")].map((b) => b.getAttribute("data-s"));
      expect(ids).toEqual(want.records);
      const facts = document.querySelector<HTMLElement>('dl[aria-label="Case facts"]')!;
      expect(within(facts).getByText("Expected total").nextElementSibling!.textContent).toBe(want.expectedTotal === null ? "unknown" : String(want.expectedTotal));
    });

  it("shows the archive identities and keeps archive time, evaluation time and the two snapshots apart", async () => {
    const svc = fakeHistoryService();
    mountEntry(FIRST_BATCH["SPEC-005"]!, createLocalHistoryProvider({ fetch: svc.fetch }));
    await waitFor(() => expect(seal()).toBeTruthy());
    const band = screen.getByRole("region", { name: "Archive provenance" });
    const d = example("014-SPEC-005-history-detail");
    for (const [label, full] of [
      ["History ID", d.history_id],
      ["History snapshot", d.snapshot_id],
      ["Original snapshot", d.original_snapshot_id],
    ])
      expect(within(band).getByText(label).nextElementSibling!.querySelector("[title]")!.getAttribute("title")).toBe(full);
    expect(within(band).getByText("Archived at")).toBeTruthy();
    expect(within(band).getByText("Evaluated at")).toBeTruthy();
    expect(within(band).getByText("synthetic_local · research_only")).toBeTruthy();
    expect(within(band).getByText("not authenticated")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("All 12 visible records match — but the source total is unconfirmed.");
    // Never the ephemeral verification routes: the archive is the only source.
    expect(svc.log.every((u) => u.startsWith("/api/v1/history/"))).toBe(true);
  });

  it("retrieval and integrity are separate: the last page is 'all pages retrieved'; integrity is verified only after every digest agrees", async () => {
    const svc = fakeHistoryService();
    const { user } = mountEntry(FIRST_BATCH["SPEC-001"]!, createLocalHistoryProvider({ fetch: svc.fetch }));
    await waitFor(() => expect(retrieval()).toBe("1 page retrieved · 2 of 4 references · more pages remain"));
    expect(integrity()).toBe("Integrity not established yet · 2 of 4 references verified so far");
    expect(topIntegrity()).toBe("pending");
    await user.click(screen.getByRole("button", { name: "Read next page" }));
    await waitFor(() => expect(retrieval()).toBe("All evidence pages retrieved · 2 pages · all 4 references, in the archive’s order"));
    expect(integrity()).toBe("Stored-content integrity verified · 4 of 4 references — the Service’s stored-byte check and this browser’s SHA-256 agree");
    expect(topIntegrity()).toBe("verified");
    const ev = svc.log.filter((u) => u.includes("/evidence"));
    const d = example("002-SPEC-001-history-detail");
    for (const u of ev) {
      expect(u).toContain(`snapshot_id=${d.snapshot_id}&limit=2&include_payload=true`);
      expect(u).not.toContain(d.original_snapshot_id);
    }
    const ledger = screen.getByRole("table", { name: "Archived evidence references for this entry" });
    expect(within(ledger).getAllByText("verified")).toHaveLength(4);
  });

  it("a payload that does not reproduce its digest is a conspicuous integrity failure naming the reference — never a success seal", async () => {
    const svc = fakeHistoryService();
    const { user } = mountEntry(FIRST_BATCH["SPEC-001"]!, createLocalHistoryProvider({ fetch: svc.fetch }));
    await waitFor(() => expect(retrieval()).toMatch(/2 of 4/));
    svc.intercept(
      (u) => u.searchParams.has("cursor"),
      async (u) => {
        const real = await (await fakeHistoryService().fetch(u.pathname + u.search)).json();
        real.items[0].payload.altered = "after archival";
        return json(real);
      },
    );
    await user.click(screen.getByRole("button", { name: "Read next page" }));
    await waitFor(() => expect(topIntegrity()).toBe("failed"));
    expect(retrieval()).toMatch(/^All evidence pages retrieved/);
    expect(integrity()).toBe("Integrity failed · SPEC-001-policy — content failed internal consistency verification");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("SPEC-001-policy");
    expect(alert.textContent).toContain("not a Mismatch");
    expect(document.querySelector('[data-digest-mismatch="SPEC-001-policy"]')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Stored-content integrity verified/);
    expect(document.querySelectorAll('.fa-iseal[data-i="verified"]')).toHaveLength(0);
    expect(seal()?.getAttribute("data-s")).toBe("Verified"); // the archived verdict is shown as stored, not re-evaluated
  });

  it("payloads omitted by request leave integrity unverifiable here, never verified", async () => {
    const { user } = mountEntry(FIRST_BATCH["SPEC-003"]!, createLocalHistoryProvider({ fetch: fakeHistoryService().fetch }));
    await waitFor(() => expect(retrieval()).toMatch(/2 of 4/));
    await user.click(screen.getByRole("radio", { name: "References only" }));
    await waitFor(() => expect(screen.getAllByText("payload omitted · omitted_by_request")).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Read all remaining" }));
    await waitFor(() => expect(retrieval()).toMatch(/^All evidence pages retrieved/));
    expect(integrity()).toMatch(/^Integrity unverifiable · 4 of 4 references not verified \(payload omitted by request/);
    expect(topIntegrity()).toBe("unverifiable");
  });

  it("a 503 INTEGRITY_FAILED Detail shows the integrity failure and no verdict at all", async () => {
    const svc = fakeHistoryService();
    svc.intercept(() => true, () => historyEnvelope("evidence_digest_mismatch", 503, [{ path: "archive", code: "INTEGRITY_FAILED" }]));
    mountEntry(FIRST_BATCH["SPEC-002"]!, createLocalHistoryProvider({ fetch: svc.fetch }));
    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-integrity-notice")).toBe("failed");
    expect(alert.querySelector("h1")!.textContent).toMatch(/^Stored content failed internal consistency verification/);
    expect(seal()).toBeNull();
    expect(document.querySelector("[data-row-id]")).toBeNull();
  });

  it("a 503 INTEGRITY_UNVERIFIABLE Detail is 'could not be verified' — not verified, not failed", async () => {
    const svc = fakeHistoryService();
    svc.intercept(() => true, () => historyEnvelope("archived_evidence_missing", 503, [{ path: "archive", code: "INTEGRITY_UNVERIFIABLE" }]));
    mountEntry(FIRST_BATCH["SPEC-003"]!, createLocalHistoryProvider({ fetch: svc.fetch }));
    await waitFor(() => expect(document.querySelector('[data-integrity-notice="unverifiable"]')).toBeTruthy());
    expect(document.querySelector('[data-integrity-notice="unverifiable"]')!.textContent).toContain("Stored content could not be verified");
    expect(seal()).toBeNull();
  });

  it("a 503 on archived evidence: nothing kept, integrity failed at the top, verdict unchanged", async () => {
    const svc = fakeHistoryService();
    svc.intercept((u) => u.pathname.endsWith("/evidence"), () => historyEnvelope("evidence_digest_mismatch", 503, [{ path: "archive", code: "INTEGRITY_FAILED" }]));
    mountEntry(FIRST_BATCH["SPEC-004"]!, createLocalHistoryProvider({ fetch: svc.fetch }));
    await waitFor(() => expect(topIntegrity()).toBe("failed"));
    expect(retrieval()).toBe("Evidence retrieval stopped · nothing kept");
    expect(seal()?.getAttribute("data-s")).toBe("Unverified");
    expect(screen.getAllByText("payload not read yet")).toHaveLength(4);
  });

  it("a cross-history cursor is rejected by the Service: request error, pages discarded, verdict unchanged", async () => {
    const svc = fakeHistoryService();
    const { user } = mountEntry(FIRST_BATCH["SPEC-002"]!, createLocalHistoryProvider({ fetch: svc.fetch }));
    await waitFor(() => expect(retrieval()).toMatch(/2 of 4/));
    svc.intercept((u) => u.searchParams.has("cursor"), () => historyEnvelope("cursor_query_conflict", 400));
    await user.click(screen.getByRole("button", { name: "Read next page" }));
    await waitFor(() => expect(screen.getByText(/rejected the continuation cursor for this archive/)).toBeTruthy());
    expect(retrieval()).toBe("Evidence retrieval stopped · nothing kept");
    expect(topIntegrity()).toBe("pending");
    expect(seal()?.getAttribute("data-s")).toBe("Mismatch");
  });

  it("404 history_not_found is NOT_FOUND, with no invented entry", async () => {
    mountEntry(`hist_${"0".repeat(64)}`, createLocalHistoryProvider({ fetch: fakeHistoryService().fetch }));
    await waitFor(() => expect(document.querySelector('[data-access="NOT_FOUND"]')).toBeTruthy());
    expect(seal()).toBeNull();
  });

  it("a malformed history ID is refused before any request", () => {
    const svc = fakeHistoryService();
    mountEntry("..", createLocalHistoryProvider({ fetch: svc.fetch }));
    expect(screen.getByText("This address does not name a valid history entry")).toBeTruthy();
    expect(svc.log).toEqual([]);
  });

  it("cancelling the read publishes nothing", async () => {
    const hang = createLocalHistoryProvider({
      fetch: ((_u: string, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch,
    });
    const { user } = mountEntry(FIRST_BATCH["SPEC-001"]!, hang);
    await user.click(screen.getByRole("button", { name: "Cancel read" }));
    expect(screen.getByText(/Read cancelled/)).toBeTruthy();
    expect(seal()).toBeNull();
  });
});

describe("async and snapshot safety across histories", () => {
  it("history A's late Detail never overwrites history B after navigation", async () => {
    const A = FIRST_BATCH["SPEC-001"]!;
    const B = FIRST_BATCH["SPEC-002"]!;
    let releaseA!: () => void;
    const gate = new Promise<void>((r) => (releaseA = r));
    const real = fakeHistoryService();
    const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u === `/api/v1/history/verifications/${A}`) await gate; // ignores abort on purpose
      return real.fetch(input, init);
    });
    vi.stubGlobal("fetch", stub);
    try {
      renderApp(`#/local/history/${A}`);
      await waitFor(() => expect(stub).toHaveBeenCalledWith(`/api/v1/history/verifications/${A}`, expect.anything()));
      await act(async () => {
        window.location.hash = `#/local/history/${B}`;
      });
      await waitFor(() => expect(seal()?.getAttribute("data-s")).toBe("Mismatch"));
      await act(async () => {
        releaseA();
        await gate;
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(seal()?.getAttribute("data-s")).toBe("Mismatch");
      expect(document.querySelector("[data-history-entry]")!.getAttribute("data-history-entry")).toBe(B);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("evidence of A arriving late is never attached to B", async () => {
    const A = FIRST_BATCH["SPEC-003"]!;
    const B = FIRST_BATCH["SPEC-004"]!;
    let releaseA!: () => void;
    const gate = new Promise<void>((r) => (releaseA = r));
    const real = fakeHistoryService();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith(`/api/v1/history/${A}/evidence`)) await gate;
        return real.fetch(input, init);
      }),
    );
    try {
      renderApp(`#/local/history/${A}`);
      await waitFor(() => expect(seal()?.getAttribute("data-s")).toBe("Pending"));
      await act(async () => {
        window.location.hash = `#/local/history/${B}`;
      });
      await waitFor(() => expect(retrieval()).toMatch(/2 of 4/));
      await act(async () => {
        releaseA();
        await gate;
        await new Promise((r) => setTimeout(r, 20));
      });
      const ledger = screen.getByRole("table", { name: "Archived evidence references for this entry" });
      const ids = [...ledger.querySelectorAll("tbody tr .mono-id")].map((e) => e.textContent);
      expect(ids.every((x) => x!.startsWith("SPEC-004-"))).toBe(true);
      expect(seal()?.getAttribute("data-s")).toBe("Unverified");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("unmounting during a read publishes nothing afterwards", async () => {
    let resolve!: (r: ProviderResult<HistoryDetailView>) => void;
    const provider: FlowAssertHistoryProvider = {
      mode: "LOCAL_RESEARCH",
      listHistory: () => new Promise(() => {}),
      getHistory: () => new Promise((r) => (resolve = r)),
      getHistoryEvidence: () => new Promise(() => {}),
    };
    const { unmount } = mountEntry(FIRST_BATCH["SPEC-001"]!, provider);
    unmount();
    const late = await createLocalHistoryProvider({ fetch: fakeHistoryService().fetch }).getHistory(FIRST_BATCH["SPEC-001"]!);
    await act(async () => resolve(late));
    expect(document.body.textContent).toBe("");
  });
});

describe("navigation and mode separation", () => {
  it("puts History in the Workspace group; it is current only on history routes", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    try {
      renderApp("#/local/history");
      const nav = screen.getAllByRole("navigation", { name: "Primary" })[0]!;
      expect(within(nav).getByRole("link", { name: /History/ }).getAttribute("aria-current")).toBe("page");
      expect(within(nav).getByRole("link", { name: "Verifications" }).getAttribute("aria-current")).toBeNull();
      expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual([
        "01Overview",
        "02Verifications",
        "03History",
        "04Capture runs",
        "05Connections",
        "06Rules",
        "07Settings",
        "08Demo overview",
        "09Demo runs",
      ]);
      expect(screen.getByRole("region", { name: "Local research register" })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("demo pages and Capture runs never call the history API (or any API)", () => {
    const stub = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", stub);
    try {
      for (const hash of ["#/demo", "#/demo/verifications", "#/demo/verifications/VR-2025", "#/connections", "#/rules", "#/settings", "#/capture"]) {
        const { unmount } = renderApp(hash);
        unmount();
      }
      expect(stub).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
