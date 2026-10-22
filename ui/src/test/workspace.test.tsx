/**
 * Product round 01 — workspace Overview, Verifications, Capture runs and the four status axes.
 * The archive is the captured, schema-validated Phase 3A list (test/local/fakeHistoryService.ts); the real
 * Service is exercised by e2e-workspace/.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaseStatusAxes, StatusAxesLedger } from "../components/workspace/StatusAxes";
import { createLocalHistoryProvider } from "../data/history/provider";
import { indexArchive } from "../data/workspace/archiveIndex";
import type { HistorySummaryView } from "../domain/history";
import { ADMISSION_NOT_IMPLEMENTED, CAPTURE_NOT_IMPLEMENTED, noVerdict } from "../domain/statusAxes";
import { CaptureRuns, WorkspaceOverview, WorkspaceVerifications } from "../pages/Workspace";
import { FIRST_BATCH, fakeHistoryService, historyEnvelope, historyExamplesPresent } from "./local/fakeHistoryService";
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

/* ---------- Pages over the captured archive ---------- */

describe.skipIf(!historyExamplesPresent)("Workspace Overview (LOCAL_RESEARCH)", () => {
  it("reads every list page under one view, then states the newest archived result of each case", async () => {
    const svc = fakeHistoryService();
    render(<WorkspaceOverview provider={createLocalHistoryProvider({ fetch: svc.fetch })} />);
    await waitFor(() => expect(document.querySelectorAll("[data-case]")).toHaveLength(5));
    // 10 entries at 4 per page: three list requests, continuations carrying the server cursor.
    expect(svc.log.filter((u) => u.startsWith("/api/v1/history?"))).toHaveLength(3);
    expect(svc.log.slice(1).every((u) => u.includes("cursor="))).toBe(true);
    const want = expectedLatest(svc.entries() as never);
    for (const id of CASES) expect(seals(document.querySelector(`[data-case="${id}"]`)!)).toEqual([want[id]]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/case contradicts its source/);
    expect(screen.getByText(/10 of 10 INTEGRITY_VERIFIED by the Service/)).toBeTruthy();
  });

  it("an empty archive gives every case No verdict, and says nothing is archived", async () => {
    const svc = fakeHistoryService();
    svc.empty();
    render(<WorkspaceOverview provider={createLocalHistoryProvider({ fetch: svc.fetch })} />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No case has an archived evaluation yet."));
    expect(seals()).toEqual([]);
    expect(document.querySelectorAll("[data-axis-noverdict]")).toHaveLength(5);
  });

  it("shows Service unavailable — never demo data or a verdict — when the Service cannot be reached", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    render(<WorkspaceOverview provider={createLocalHistoryProvider({ fetch: down })} />);
    await waitFor(() => expect(document.querySelector('[data-access="SERVICE_UNAVAILABLE"]')).not.toBeNull());
    expect(screen.getByText("The local Service is unavailable")).toBeTruthy();
    expect(seals()).toEqual([]);
    expect(document.querySelector("[data-case]")).toBeNull();
    expect(document.body.textContent).toContain("none — no other data source is used");
  });

  it("shows no per-case result when a continuation fails with an archive integrity error", async () => {
    const svc = fakeHistoryService();
    svc.intercept(
      (u) => u.pathname === "/api/v1/history" && u.searchParams.has("cursor"),
      () => historyEnvelope("archive_integrity_failed", 503, [{ path: "items[0]", code: "INTEGRITY_FAILED" }]),
    );
    render(<WorkspaceOverview provider={createLocalHistoryProvider({ fetch: svc.fetch })} />);
    await waitFor(() => expect(document.body.textContent).toContain("INTEGRITY_FAILED"));
    expect(document.querySelector("[data-case]")).toBeNull();
    expect(seals()).toEqual([]);
  });

  it("refuses a continuation from another list view as a stale snapshot and shows no per-case result", async () => {
    const svc = fakeHistoryService();
    svc.intercept(
      (u) => u.pathname === "/api/v1/history" && u.searchParams.has("cursor"),
      async (u) => {
        const body = await (await fakeHistoryService().fetch(u.pathname + u.search)).json();
        body.page.snapshot_id = "list_other_view";
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      },
    );
    render(<WorkspaceOverview provider={createLocalHistoryProvider({ fetch: svc.fetch })} />);
    // The read layer refuses it before the list chain sees it: a stale-snapshot read state, not a verdict.
    await waitFor(() => expect(document.querySelector('[data-access="STALE_SNAPSHOT"]')).not.toBeNull());
    expect(document.body.textContent).toContain("list_other_view");
    expect(document.body.textContent).not.toContain("scripts/dev/service.sh");
    expect(document.querySelector("[data-case]")).toBeNull();
    expect(seals()).toEqual([]);
  });

  it("is a loading state, with no result drawn, while pages are read; Cancel stops it", async () => {
    const pending = (() => new Promise<Response>(() => {})) as typeof fetch;
    const { getByRole } = render(<WorkspaceOverview provider={createLocalHistoryProvider({ fetch: pending })} />);
    expect(document.querySelector('[data-access="LOADING"]')).not.toBeNull();
    expect(seals()).toEqual([]);
    getByRole("button", { name: "Cancel read" }).click();
    await waitFor(() => expect(screen.getByText(/Read cancelled/)).toBeTruthy());
  });
});

describe.skipIf(!historyExamplesPresent)("Workspace Verifications", () => {
  it("lists the five reviewed cases with four separate axes, linking each to its live Detail", async () => {
    const svc = fakeHistoryService();
    render(<WorkspaceVerifications provider={createLocalHistoryProvider({ fetch: svc.fetch })} />);
    const table = await waitFor(() => {
      const t = document.querySelector<HTMLTableElement>("[data-case-table]");
      expect(t).not.toBeNull();
      return t!;
    });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Case", "01 Capture", "02 Admission", "03 Archive", "04 Evaluator verdict"]);
    const want = expectedLatest(svc.entries() as never);
    for (const id of CASES) {
      const row = table.querySelector(`tr[data-case="${id}"]`)!;
      expect(row.querySelectorAll("[data-axis-na]")).toHaveLength(2);
      expect(row.textContent).toContain("Archived");
      expect(seals(row)).toEqual([want[id]]);
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

describe.skipIf(!historyExamplesPresent)("Status axes on the routed pages", () => {
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

  it("the overview at #/ is LOCAL_RESEARCH and reads only the history list", async () => {
    const svc = fakeHistoryService();
    vi.stubGlobal("fetch", svc.fetch);
    renderApp("#/");
    await waitFor(() => expect(document.querySelectorAll("[data-case]")).toHaveLength(5));
    expect(screen.getByRole("region", { name: "Local research register" })).toBeTruthy();
    expect(svc.log.every((u) => u.startsWith("/api/v1/history?"))).toBe(true);
  });
});

describe("CaseStatusAxes (Verification Detail)", () => {
  const live = { axis: "verdict", kind: "VERDICT", state: "Unverified", source: { kind: "live", request: "GET /api/v1/verifications/SPEC-005 (live read)" } } as const;

  it.skipIf(!historyExamplesPresent)("reads this case's archive entries to the end and keeps the live verdict", async () => {
    const svc = fakeHistoryService();
    render(<CaseStatusAxes id="SPEC-005" verdict={live} provider={createLocalHistoryProvider({ fetch: svc.fetch })} />);
    await waitFor(() => expect(document.querySelector('[data-axis="archive"]')!.textContent).toContain("2 evaluations"));
    expect(svc.log.every((u) => u.includes("verification_id=SPEC-005"))).toBe(true);
    expect(seals()).toEqual(["Unverified"]);
    expect(document.querySelector('[data-axis="verdict"]')!.textContent).toContain("live read");
  });

  it("sends no archive request for an ID the archive contract cannot address", () => {
    const listHistory = vi.fn();
    render(<CaseStatusAxes id="SPEC:001" verdict={live} provider={{ listHistory }} />);
    expect(listHistory).not.toHaveBeenCalled();
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
