/**
 * Workspace Overview, Verifications, Capture runs and the four status axes (product rounds 01–02).
 * Fakes serve real captured Service bodies: the Phase 3A archive (test/local/fakeHistoryService.ts) and the
 * Phase 2 v1 Details (test/local/fakeService.ts). The real Service is exercised by e2e-workspace/.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaseStatusAxes, StatusAxesLedger } from "../components/workspace/StatusAxes";
import { createLocalHistoryProvider } from "../data/history/provider";
import { createLocalResearchProvider } from "../data/local/provider";
import { indexArchive } from "../data/workspace/archiveIndex";
import type { HistorySummaryView } from "../domain/history";
import { ADMISSION_NOT_IMPLEMENTED, CAPTURE_NOT_IMPLEMENTED, noVerdict } from "../domain/statusAxes";
import { CaptureRuns, WorkspaceOverview, WorkspaceVerifications } from "../pages/Workspace";
import { FIRST_BATCH, fakeHistoryService, historyEnvelope } from "./local/fakeHistoryService";
import { fakeService } from "./local/fakeService";
import { renderApp } from "./render";

afterEach(() => vi.unstubAllGlobals());

const CASES = ["SPEC-001", "SPEC-002", "SPEC-003", "SPEC-004", "SPEC-005"];

/** Newest archived cohort per case, straight from the captured list body (archive order). */
function expectedLatest(entries: { original_verification_id: string; result_summary?: { cohort_state: string } }[]) {
  const out: Record<string, string> = {};
  for (const e of entries) if (!(e.original_verification_id in out)) out[e.original_verification_id] = e.result_summary!.cohort_state;
  return out;
}

const seals = (root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(".fa-seal")].map((s) => s.dataset.s);

/** One fetch for both API families, each answered by its own captured-body fake. */
function workspaceFakes() {
  const history = fakeHistoryService();
  const v1 = fakeService();
  const log: string[] = [];
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    log.push(raw);
    return raw.startsWith("/api/v1/history") ? history.fetch(input, init) : v1.fetch(input, init);
  }) as typeof fetch;
  return {
    history,
    v1,
    log,
    fetch: fetchImpl,
    providers: () => ({ history: createLocalHistoryProvider({ fetch: fetchImpl }), live: createLocalResearchProvider({ fetch: fetchImpl }) }),
  };
}

/* ---------- Pure index ---------- */

function summary(id: string, cohort: HistorySummaryView["result"]["cohort"], n: number, integrity: HistorySummaryView["integrity"]["status"] = "INTEGRITY_VERIFIED"): HistorySummaryView {
  return {
    historyId: `hist_${String(n).padStart(64, "0")}`,
    verificationId: id,
    archivedAt: `2026-10-22T12:00:0${n}Z`,
    result: { cohort, counts: { Verified: 0, Mismatch: 0, Pending: 0, Unverified: 0 }, expectedTotal: null, populationKnown: false },
    integrity: { status: integrity, checkedSha256: null, scope: "archive_candidate_and_relationships" },
  } as HistorySummaryView;
}

describe("indexArchive", () => {
  it("takes each case's newest archived result in archive order, and never re-sorts", () => {
    const items = [summary("SPEC-002", "Mismatch", 3), summary("SPEC-001", "Verified", 2), summary("SPEC-002", "Verified", 1)];
    const idx = indexArchive(items, "list_x");
    const spec2 = idx.cases.find((c) => c.id === "SPEC-002")!;
    expect(spec2.entries.map((e) => e.historyId)).toEqual([items[0]!.historyId, items[2]!.historyId]);
    expect(spec2.axes.verdict).toMatchObject({ kind: "VERDICT", state: "Mismatch", source: { kind: "archived", historyId: items[0]!.historyId } });
    expect(spec2.axes.archive).toMatchObject({ kind: "ARCHIVED", entries: 2 });
    expect(idx.latestByState).toEqual({ Verified: 1, Mismatch: 1, Pending: 0, Unverified: 0 });
  });

  it("gives a case without an archived evaluation NO verdict — never Unverified", () => {
    const idx = indexArchive([summary("SPEC-001", "Verified", 1)], "list_x");
    expect(idx.notArchived).toBe(4);
    for (const c of idx.cases.filter((c) => c.id !== "SPEC-001")) {
      expect(c.axes.verdict.kind).toBe("NO_VERDICT");
      expect(c.axes.archive.kind).toBe("NOT_ARCHIVED");
    }
    expect(idx.latestByState.Unverified).toBe(0);
  });

  it("states capture and admission as not implemented for every case", () => {
    for (const c of indexArchive([], "list_x").cases) {
      expect(c.axes.capture).toBe(CAPTURE_NOT_IMPLEMENTED);
      expect(c.axes.admission).toBe(ADMISSION_NOT_IMPLEMENTED);
    }
  });

  it("keeps entries of unknown cases visible and counts record checks that did not pass", () => {
    const idx = indexArchive([summary("SPEC-009", "Verified", 2), summary("SPEC-001", "Verified", 1, "INTEGRITY_FAILED")], "list_x");
    expect(idx.unexpected.map((e) => e.verificationId)).toEqual(["SPEC-009"]);
    expect(idx.integrityExceptions).toBe(1);
    expect(idx.totalEntries).toBe(2);
  });
});

/* ---------- Status axes ledger ---------- */

describe("StatusAxesLedger", () => {
  it("draws No verdict without a seal or the Unverified hatch", () => {
    render(
      <StatusAxesLedger
        axes={{ capture: CAPTURE_NOT_IMPLEMENTED, admission: ADMISSION_NOT_IMPLEMENTED, archive: { axis: "archive", kind: "NOT_ARCHIVED" }, verdict: noVerdict("nothing read") }}
      />,
    );
    const verdict = document.querySelector('[data-axis="verdict"]')!;
    expect(verdict.querySelector("[data-axis-noverdict]")).not.toBeNull();
    expect(verdict.querySelector(".fa-seal")).toBeNull();
    expect(document.body.textContent).not.toContain("Unverified");
    expect(document.querySelectorAll("[data-axis-na]")).toHaveLength(2);
  });

  it("labels the four axes separately and says only the last is a business verdict", () => {
    render(
      <StatusAxesLedger
        axes={{
          capture: CAPTURE_NOT_IMPLEMENTED,
          admission: ADMISSION_NOT_IMPLEMENTED,
          archive: { axis: "archive", kind: "UNAVAILABLE", code: "transport_failure", integrity: false },
          verdict: { axis: "verdict", kind: "VERDICT", state: "Pending", source: { kind: "live", request: "GET /api/v1/verifications/SPEC-003 (live read)" } },
        }}
      />,
    );
    expect([...document.querySelectorAll("[data-axis] dt")].map((d) => d.textContent)).toEqual([
      "01Capture status",
      "02Evidence admission status",
      "03Archive status",
      "04Evaluator verdict",
    ]);
    expect(screen.getByText(/only 04 is a business verdict/)).toBeTruthy();
    // An unavailable archive is a read failure on the archive axis — it never changes the verdict.
    expect(seals()).toEqual(["Pending"]);
    expect(document.querySelector('[data-axis="archive"]')!.textContent).toContain("Archive unavailable");
  });
});

/* ---------- Overview and Verifications: live beside archived ---------- */

describe("Workspace Overview (LOCAL_RESEARCH)", () => {
  it("reads one archive list view and one live Detail per known case, then compares them", async () => {
    const f = workspaceFakes();
    render(<WorkspaceOverview {...f.providers()} />);
    await waitFor(() => expect(document.querySelectorAll('[data-case] [data-comparison]:not([data-comparison="READING"])')).toHaveLength(5));
    // 10 entries at 4 per page: three list requests, continuations carrying the server cursor; five live reads.
    const lists = f.log.filter((u) => u.startsWith("/api/v1/history?"));
    expect(lists).toHaveLength(3);
    expect(lists.slice(1).every((u) => u.includes("cursor="))).toBe(true);
    expect(f.log.filter((u) => u.startsWith("/api/v1/verifications/")).sort()).toEqual(CASES.map((id) => `/api/v1/verifications/${id}`));
    const want = expectedLatest(f.history.entries() as never);
    for (const id of CASES) {
      const row = document.querySelector(`[data-case="${id}"]`)!;
      // live seal, then archived seal — both copied, the same here because the input is the same.
      expect(seals(row)).toEqual([want[id], want[id]]);
      expect(row.querySelector("[data-comparison]")!.getAttribute("data-comparison")).toBe("SAME_INPUT_AGREE");
    }
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/case contradicts its source/);
    expect(document.querySelector('[data-comparison-strip] [data-comparison="SAME_INPUT_AGREE"]')!.parentElement!.textContent).toContain("5");
  });

  it("an empty archive: live verdicts still shown, every comparison is Not archived — never Unverified", async () => {
    const f = workspaceFakes();
    f.history.empty();
    render(<WorkspaceOverview {...f.providers()} />);
    await waitFor(() => expect(document.querySelectorAll('[data-case] [data-comparison="ARCHIVE_MISSING"]')).toHaveLength(5));
    for (const id of CASES) expect(document.querySelector(`[data-case="${id}"] [data-axis-noverdict]`)).not.toBeNull();
  });

  it("a live result missing for one case is No live result, with no verdict on the live side", async () => {
    const f = workspaceFakes();
    f.v1.intercept(
      (u) => u.pathname === "/api/v1/verifications/SPEC-003",
      () => new Response(JSON.stringify({ error: { code: "run_not_found", message: "x", request_id: "r", retryable: false, details: [] } }), { status: 404, headers: { "content-type": "application/json" } }),
    );
    render(<WorkspaceOverview {...f.providers()} />);
    const row = await waitFor(() => {
      const r = document.querySelector('[data-case="SPEC-003"] [data-comparison="LIVE_MISSING"]');
      expect(r).not.toBeNull();
      return r!.closest("[data-case]")!;
    });
    expect(seals(row)).toEqual(["Pending"]); // the archived seal only
    expect(row.textContent).toContain("no current result");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/one could not be read/);
  });

  it("shows Service unavailable — never demo data or a verdict — when the Service cannot be reached", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    render(<WorkspaceOverview history={createLocalHistoryProvider({ fetch: down })} live={createLocalResearchProvider({ fetch: down })} />);
    await waitFor(() => expect(document.querySelector('[data-access="SERVICE_UNAVAILABLE"]')).not.toBeNull());
    expect(screen.getByText("The local Service is unavailable")).toBeTruthy();
    expect(seals()).toEqual([]);
    expect(document.querySelector("[data-case]")).toBeNull();
    expect(document.body.textContent).toContain("none — no other data source is used");
  });

  it("an archive integrity failure keeps live results but compares nothing (Inconclusive), and says why", async () => {
    const f = workspaceFakes();
    f.history.intercept(
      (u) => u.pathname === "/api/v1/history" && u.searchParams.has("cursor"),
      () => historyEnvelope("archive_integrity_failed", 503, [{ path: "items[0]", code: "INTEGRITY_FAILED" }]),
    );
    render(<WorkspaceOverview {...f.providers()} />);
    await waitFor(() => expect(document.querySelectorAll('[data-case] [data-comparison="INCONCLUSIVE"]')).toHaveLength(5));
    expect(document.body.textContent).toContain("INTEGRITY_FAILED");
    for (const id of CASES) expect(seals(document.querySelector(`[data-case="${id}"]`)!)).toHaveLength(1); // live only
  });

  it("a continuation from another list view is refused as a stale snapshot; nothing archived is compared", async () => {
    const f = workspaceFakes();
    f.history.intercept(
      (u) => u.pathname === "/api/v1/history" && u.searchParams.has("cursor"),
      async (u) => {
        const body = await (await fakeHistoryService().fetch(u.pathname + u.search)).json();
        body.page.snapshot_id = "list_other_view";
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      },
    );
    render(<WorkspaceOverview {...f.providers()} />);
    await waitFor(() => expect(document.querySelector('[data-access="STALE_SNAPSHOT"]')).not.toBeNull());
    expect(document.body.textContent).toContain("list_other_view");
    expect(document.querySelectorAll('[data-case] [data-comparison="SAME_INPUT_AGREE"]').length).toBe(0);
    expect(document.querySelectorAll('[data-case] [data-comparison="INCONCLUSIVE"]')).toHaveLength(5);
  });

  it("is a loading state while reading; Cancel stops every unfinished read and nothing is compared", async () => {
    const pending = (() => new Promise<Response>(() => {})) as typeof fetch;
    const { getAllByRole } = render(<WorkspaceOverview history={createLocalHistoryProvider({ fetch: pending })} live={createLocalResearchProvider({ fetch: pending })} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Reading five known cases…");
    expect(seals()).toEqual([]);
    getAllByRole("button", { name: "Cancel read" })[0]!.click();
    await waitFor(() => expect(document.querySelectorAll('[data-case] [data-comparison="INCONCLUSIVE"]')).toHaveLength(5));
  });
});

describe("bounded live reads", () => {
  it("never has more than two live reads in flight, and aborts the rest on unmount", async () => {
    let inFlight = 0;
    let peak = 0;
    const signals: AbortSignal[] = [];
    const slow = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = String(input);
      if (raw.startsWith("/api/v1/history")) return new Promise<Response>(() => {});
      inFlight++;
      peak = Math.max(peak, inFlight);
      signals.push(init!.signal!);
      return new Promise<Response>((_, reject) =>
        init!.signal!.addEventListener("abort", () => {
          inFlight--;
          reject(new DOMException("aborted", "AbortError"));
        }),
      );
    }) as typeof fetch;
    const { unmount } = render(<WorkspaceOverview history={createLocalHistoryProvider({ fetch: slow })} live={createLocalResearchProvider({ fetch: slow })} />);
    await waitFor(() => expect(signals.length).toBe(2));
    expect(peak).toBe(2);
    unmount();
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
});

describe("Workspace Verifications", () => {
  it("lists the known cases with capture, admission, live verdict, newest archived verdict and comparison", async () => {
    const f = workspaceFakes();
    render(<WorkspaceVerifications {...f.providers()} />);
    const table = await waitFor(() => {
      const t = document.querySelector<HTMLTableElement>("[data-case-table]");
      expect(t?.querySelectorAll('[data-comparison="SAME_INPUT_AGREE"]').length).toBe(5);
      return t!;
    });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Case",
      "01–02 Capture · Admission",
      "04 Live verdict",
      "03 Newest archived",
      "Comparison · diagnostic",
    ]);
    const want = expectedLatest(f.history.entries() as never);
    for (const id of CASES) {
      const row = table.querySelector(`tr[data-case="${id}"]`)!;
      expect(row.querySelectorAll("[data-axis-na]")).toHaveLength(2);
      expect(seals(row)).toEqual([want[id], want[id]]);
      expect((row.querySelector("a") as HTMLAnchorElement).hash).toBe(`#/local/verifications/${id}`);
    }
  });
});

describe("Capture runs", () => {
  it("states capture is not implemented, sends nothing and offers no action", () => {
    const stub = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", stub);
    render(<CaptureRuns />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Capture runs are not implemented.");
    const section = document.querySelector("[data-capture-unavailable]")!;
    expect(section.querySelectorAll("button")).toHaveLength(0);
    expect([...section.querySelectorAll("a")].map((a) => (a as HTMLAnchorElement).hash)).toEqual(["#/verifications", "#/local/history"]);
    expect(section.textContent).toContain("Not authorized");
    expect(stub).not.toHaveBeenCalled();
  });
});

describe("Status axes on the routed pages", () => {
  it("the History entry shows this archived evaluation and its archived verdict", async () => {
    const svc = fakeHistoryService();
    vi.stubGlobal("fetch", svc.fetch);
    renderApp(`#/local/history/${FIRST_BATCH["SPEC-005"]}`);
    const ledger = await waitFor(() => {
      const l = document.querySelector("[data-status-axes]");
      expect(l).not.toBeNull();
      return l!;
    });
    expect(ledger.querySelectorAll("[data-axis-na]")).toHaveLength(2);
    expect(ledger.querySelector('[data-axis="archive"]')!.textContent).toContain("record check · service");
    expect(ledger.querySelector('[data-axis="verdict"]')!.textContent).toContain("copied from archived evaluation");
  });

  it("the overview at #/ is LOCAL_RESEARCH and reads only the history list and the known cases' Details", async () => {
    const f = workspaceFakes();
    vi.stubGlobal("fetch", f.fetch);
    renderApp("#/");
    await waitFor(() => expect(document.querySelectorAll('[data-case] [data-comparison="SAME_INPUT_AGREE"]')).toHaveLength(5));
    expect(screen.getByRole("region", { name: "Local research register" })).toBeTruthy();
    expect(f.log.every((u) => u.startsWith("/api/v1/history?") || /^\/api\/v1\/verifications\/SPEC-00[1-5]$/.test(u))).toBe(true);
  });
});

describe("CaseStatusAxes (Verification Detail)", () => {
  const live = { axis: "verdict", kind: "VERDICT", state: "Unverified", source: { kind: "live", request: "GET /api/v1/verifications/SPEC-005 (live read)" } } as const;

  it("reads this case's archive entries to the end and keeps the live verdict", async () => {
    const svc = fakeHistoryService();
    render(<CaseStatusAxes id="SPEC-005" verdict={live} provider={createLocalHistoryProvider({ fetch: svc.fetch })} />);
    await waitFor(() => expect(document.querySelector('[data-axis="archive"]')!.textContent).toContain("2 evaluations"));
    expect(svc.log.every((u) => u.includes("verification_id=SPEC-005"))).toBe(true);
    expect(seals()).toEqual(["Unverified"]);
    expect(document.querySelector('[data-axis="verdict"]')!.textContent).toContain("live read");
  });

  it("sends no archive request for an ID the archive contract cannot address", () => {
    const listHistory = vi.fn();
    const getHistory = vi.fn();
    render(<CaseStatusAxes id="SPEC:001" verdict={live} provider={{ listHistory, getHistory }} />);
    expect(listHistory).not.toHaveBeenCalled();
    expect(getHistory).not.toHaveBeenCalled();
    expect(document.querySelector('[data-axis="archive"]')!.textContent).toContain("Not addressable");
  });

  it("reports an unreachable archive on the archive axis only", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    render(<CaseStatusAxes id="SPEC-002" verdict={{ ...live, state: "Mismatch" }} provider={createLocalHistoryProvider({ fetch: down })} />);
    await waitFor(() => expect(document.querySelector('[data-axis="archive"]')!.textContent).toContain("Archive unavailable"));
    expect(seals()).toEqual(["Mismatch"]);
  });
});
