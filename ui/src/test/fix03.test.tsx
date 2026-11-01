/**
 * Round 02 hardening FIX03 — domain and UI semantic findings (docs/product-dev/round-02-hardening/fix03/).
 * Each test reproduces one CONFIRMED finding and fails on 203f702. Service behaviour is the captured or genuine one:
 * the 503 detail shape is service/app/history_api.py's; the rule records are verbatim output of the pinned Evaluator
 * (service/vendor/model.py) on reviewed fixture A-verified with one input changed (see fix03/evidence/evaluator/).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wireToRunView } from "../adapters/wireToView";
import { ComparisonSheet } from "../components/detail/ComparisonSheet";
import { RecordCheck } from "../components/history/HistoryRows";
import { ArchiveMatchPanel } from "../components/workspace/ArchiveMatch";
import { CaseStatusAxes, StatusAxesLedger } from "../components/workspace/StatusAxes";
import { createLocalHistoryProvider } from "../data/history/provider";
import { createLocalResearchProvider } from "../data/local/provider";
import type { FlowAssertReadProvider } from "../data/provider";
import type { HistorySummaryView } from "../domain/history";
import { serviceIntegrityState } from "../domain/integrity";
import { ADMISSION_NOT_IMPLEMENTED, CAPTURE_NOT_IMPLEMENTED, noVerdict } from "../domain/statusAxes";
import type { RunView } from "../domain/view";
import { WorkspaceOverview } from "../pages/Workspace";
import { FIRST_BATCH, fakeHistoryService, historyEnvelope } from "./local/fakeHistoryService";
import { captured, fakeService } from "./local/fakeService";
import { renderApp } from "./render";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const verdict = { axis: "verdict", kind: "VERDICT", state: "Mismatch", source: { kind: "live", request: "GET /api/v1/verifications/SPEC-002 (live read)" } } as const;
const archiveAxis = () => document.querySelector<HTMLElement>('[data-axis="archive"]')!;

async function liveRun(id: string): Promise<RunView> {
  const r = await createLocalResearchProvider({ fetch: fakeService().fetch }).getVerification(id);
  if (r.kind !== "ready") throw new Error(`no live ${id}`);
  return r.data;
}

/* ---------- F-01 · integrity: INTEGRITY_UNVERIFIABLE is never drawn or described as FAILED ---------- */

describe("F-01 integrity states stay distinct", () => {
  it("maps each Service integrity statement to its own state", () => {
    expect(serviceIntegrityState("INTEGRITY_VERIFIED")).toBe("verified");
    expect(serviceIntegrityState("INTEGRITY_FAILED")).toBe("failed");
    expect(serviceIntegrityState("INTEGRITY_UNVERIFIABLE")).toBe("unverifiable");
  });

  it("the History record check and the archive axis draw UNVERIFIABLE as unverifiable", () => {
    const entry = (status: HistorySummaryView["integrity"]["status"]) =>
      ({ historyId: `hist_${"0".repeat(64)}`, verificationId: "SPEC-001", archivedAt: "2026-10-22T12:00:00Z", integrity: { status, checkedSha256: null, scope: "archive_candidate_and_relationships" } }) as HistorySummaryView;
    const { unmount } = render(<RecordCheck entry={entry("INTEGRITY_UNVERIFIABLE")} />);
    expect(document.querySelector(".fa-itag")!.getAttribute("data-i")).toBe("unverifiable");
    unmount();
    render(
      <StatusAxesLedger
        axes={{
          capture: CAPTURE_NOT_IMPLEMENTED,
          admission: ADMISSION_NOT_IMPLEMENTED,
          archive: { axis: "archive", kind: "THIS_ENTRY", historyId: `hist_${"0".repeat(64)}`, archivedAt: "2026-10-22T12:00:00Z", integrity: "INTEGRITY_UNVERIFIABLE" },
          verdict: noVerdict("nothing read"),
        }}
      />,
    );
    expect(archiveAxis().querySelector(".fa-itag")!.getAttribute("data-i")).toBe("unverifiable");
  });

  it("a 503 with INTEGRITY_UNVERIFIABLE (archive_unavailable) is not reported as an integrity failure on the Detail axes", async () => {
    const svc = fakeHistoryService();
    svc.intercept((u) => u.pathname === "/api/v1/history/verifications", () => historyEnvelope("archive_unavailable", 503, [{ path: "archive", code: "INTEGRITY_UNVERIFIABLE" }]));
    const live = await liveRun("SPEC-002");
    render(<CaseStatusAxes id="SPEC-002" verdict={verdict} live={live} provider={createLocalHistoryProvider({ fetch: svc.fetch })} />);
    await waitFor(() => expect(archiveAxis().textContent).toContain("Archive unavailable"));
    expect(document.body.textContent).not.toContain("integrity failure");
    expect(archiveAxis().textContent).toContain("could not verify");
    expect(archiveAxis().querySelector(".fa-itag")!.getAttribute("data-i")).toBe("unverifiable");
  });

  it("a 503 with INTEGRITY_FAILED is still reported as an integrity failure", async () => {
    const svc = fakeHistoryService();
    svc.intercept((u) => u.pathname === "/api/v1/history/verifications", () => historyEnvelope("archive_digest_mismatch", 503, [{ path: "archive", code: "INTEGRITY_FAILED" }]));
    render(<CaseStatusAxes id="SPEC-002" verdict={verdict} live={await liveRun("SPEC-002")} provider={createLocalHistoryProvider({ fetch: svc.fetch })} />);
    await waitFor(() => expect(archiveAxis().textContent).toContain("integrity failure"));
    expect(archiveAxis().querySelector(".fa-itag")!.getAttribute("data-i")).toBe("failed");
    expect(document.querySelectorAll(".fa-seal")).toHaveLength(1); // the live verdict only
  });

  it("names the integrity state for assistive technology, not only by glyph", () => {
    const entry = { historyId: `hist_${"0".repeat(64)}`, integrity: { status: "INTEGRITY_VERIFIED", checkedSha256: null, scope: "x" } } as unknown as HistorySummaryView;
    render(<RecordCheck entry={entry} />);
    expect(document.querySelector(".fa-itag")!.textContent).toBe("Integrity verified: record check · service");
  });
});

/* ---------- F-02 · rule coverage: existed_by_deadline and workflow_execution are shown with their status ---------- */

/** The captured SPEC-001 Detail with its record replaced by a genuine Evaluator record. */
function runWith(record: unknown): RunView {
  const dto = captured("SPEC-001-detail");
  dto.result.records = [record];
  dto.result.counts = { Verified: 0, Mismatch: 0, Pending: 0, Unverified: 1 };
  dto.result.cohort_state = "Unverified";
  return wireToRunView(dto);
}
const PASS3 = {
  existence: { status: "pass", reason: "reliable candidate observed" },
  phone: { status: "pass", reason: "exact string comparison", expected: "+1 212 555 0101", actual: "+1 212 555 0101" },
  uniqueness: { status: "pass", reason: "complete relevant synthetic inventory" },
};
const record = (rules: Record<string, unknown>) => ({ key: "SYN-001", source_row: 0, state: "Unverified", candidate_ids: ["SYN-HS-001"], rules });
const DEADLINE = { status: "unknown", reason: "current read cannot reconstruct historical deadline" };
const EXECUTION = { status: "unknown", reason: "Approach B contains no execution evidence" };

describe("F-02 the comparison sheet shows every rule the Evaluator returned", () => {
  it("existed_by_deadline (require_historical_deadline) appears as its own not-assessed row", () => {
    const run = runWith(record({ ...PASS3, existed_by_deadline: DEADLINE }));
    render(<ComparisonSheet record={run.records[0]!} run={run} />);
    const sheet = screen.getByRole("article");
    expect(within(sheet).getAllByText("Existed by deadline").length).toBeGreaterThan(0);
    expect(within(sheet).getAllByRole("img", { name: "not assessed" })).toHaveLength(2); // wide + narrow layout
    expect(within(sheet).getAllByRole("img", { name: "holds" })).toHaveLength(6); // existence, uniqueness, phone × 2 layouts
    expect(sheet.textContent).toContain("current read cannot reconstruct historical deadline");
    expect(run.records[0]!.summary).toBe("The contact exists, but this rule could not be assessed: Existed by deadline.");
  });

  it("workflow_execution and both optional rules: each shown once per layout, never a sixth rule", () => {
    const run = runWith(record({ ...PASS3, existed_by_deadline: DEADLINE, workflow_execution: EXECUTION }));
    render(<ComparisonSheet record={run.records[0]!} run={run} />);
    const sheet = screen.getByRole("article");
    expect(within(sheet).getAllByText("Workflow execution").length).toBeGreaterThan(0);
    expect(within(sheet).getAllByRole("img", { name: "not assessed" })).toHaveLength(4);
    expect(run.records[0]!.rulesTotal).toBe(5);
    expect(within(sheet).queryByText(/email/i)).toBeNull();
  });

  it("the record summary never claims the phone matches when the phone was not compared", () => {
    const run = runWith(
      record({
        existence: { status: "pass", reason: "reliable candidate observed" },
        phone: { status: "unknown", reason: "missing, null, inaccessible, or unsupported phone type" },
        uniqueness: { status: "unknown", reason: "insufficient evidence" },
      }),
    );
    expect(run.records[0]!.summary).not.toContain("phone matches");
    expect(run.records[0]!.summary).toBe("The contact exists, but these rules could not be assessed: One contact per source key, Phone matches source.");
  });

  it("leaves the reviewed fixtures' wording unchanged (three rules, Verified)", async () => {
    const run = await liveRun("SPEC-001");
    expect(run.records[0]!.rulesTotal).toBe(3);
    expect(run.records[0]!.summary).toBe("All 3 required rules passed at this observation.");
  });
});

/* ---------- F-03 · async: a provider rejection that is not an abort is a failure, never "cancelled" or "reading" ---------- */

describe("F-03 unexpected rejections settle as failures", () => {
  it("a live read rejecting with a non-abort error is not labelled cancelled", async () => {
    const history = createLocalHistoryProvider({ fetch: fakeHistoryService().fetch });
    const real = createLocalResearchProvider({ fetch: fakeService().fetch });
    const live: FlowAssertReadProvider = { ...real, getVerification: (id, q, s) => (id === "SPEC-003" ? Promise.reject(new TypeError("boom")) : real.getVerification(id, q, s)) };
    render(<WorkspaceOverview history={history} live={live} />);
    const row = await waitFor(() => {
      const r = document.querySelector('[data-case="SPEC-003"] [data-comparison]');
      expect(r?.getAttribute("data-comparison")).toBe("INCONCLUSIVE");
      return r!.closest("[data-case]")!;
    });
    expect(row.textContent).toContain("unexpected error");
    expect(row.textContent).not.toMatch(/cancelled/i);
  });

  it("a candidate Detail read rejecting with a non-abort error settles instead of reading forever", async () => {
    const live = await liveRun("SPEC-005");
    const entries = await createLocalHistoryProvider({ fetch: fakeHistoryService().fetch }).listHistory({ limit: 100, verificationId: "SPEC-005" });
    if (entries.kind !== "ready") throw new Error("no list");
    const one = entries.data.items.filter((e) => e.historyId === FIRST_BATCH["SPEC-005"]);
    render(<ArchiveMatchPanel live={live} entries={one} provider={{ getHistory: () => Promise.reject(new TypeError("boom")) }} />);
    await waitFor(() => expect(document.querySelector("[data-candidate-reads]")!.getAttribute("data-candidate-reads")).toBe("settled"));
    expect(document.body.textContent).toContain("retrieval failed · client_error");
    expect(document.querySelector("[data-result-relation]")).toBeNull();
  });
});

/* ---------- F-04 · truthful claims ---------- */

describe("F-04 truthful UI claims", () => {
  it("cases still being read are not counted or grouped as No result", async () => {
    const pending = (() => new Promise<Response>(() => {})) as typeof fetch;
    render(<WorkspaceOverview history={createLocalHistoryProvider({ fetch: pending })} live={createLocalResearchProvider({ fetch: pending })} />);
    const noResult = screen.getByRole("rowheader", { name: "No result" }).closest("tr")!;
    expect(noResult.querySelectorAll("td")[0]!.textContent).toBe("·");
    expect(screen.queryByRole("region", { name: "No current result" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Current result being read" })).getAllByRole("listitem")).toHaveLength(5);
  });

  it("the headline does not say no result could be read while reads are still in flight", async () => {
    const live = createLocalResearchProvider({
      fetch: ((input: RequestInfo | URL) => (String(input).endsWith("/SPEC-001?phase3b=true") ? Promise.reject(new TypeError("fetch failed")) : new Promise<Response>(() => {}))) as typeof fetch,
    });
    render(<WorkspaceOverview history={createLocalHistoryProvider({ fetch: (() => new Promise<Response>(() => {})) as typeof fetch })} live={live} />);
    await waitFor(() => expect(document.querySelector('[data-case="SPEC-001"]')).not.toBeNull());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No current result has been read yet."));
    expect(within(screen.getByRole("region", { name: "No current result" })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("the register states pages and page size, not 'N pages of M'", async () => {
    const f = fakeHistoryService();
    const v1 = fakeService();
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => (String(input).startsWith("/api/v1/history") ? f.fetch(input, init) : v1.fetch(input, init))) as typeof fetch;
    render(<WorkspaceOverview history={createLocalHistoryProvider({ fetch: fetchImpl })} live={createLocalResearchProvider({ fetch: fetchImpl })} />);
    const register = await screen.findByRole("region", { name: "Workspace register" });
    await waitFor(() => expect(register.textContent).toMatch(/10 entries · 3 pages · 4 per page/));
    expect(register.textContent).not.toMatch(/pages? of \d/);
  });

  it("a list 404 on the Detail axes is not found — not a read failure", async () => {
    const svc = fakeHistoryService();
    svc.intercept((u) => u.pathname === "/api/v1/history/verifications", () => historyEnvelope("history_not_found", 404));
    render(<CaseStatusAxes id="SPEC-002" verdict={verdict} live={await liveRun("SPEC-002")} provider={createLocalHistoryProvider({ fetch: svc.fetch })} />);
    await waitFor(() => expect(archiveAxis().textContent).toContain("Archive list not found"));
    expect(document.body.textContent).not.toContain("read failure");
    expect(document.body.textContent).not.toContain("Archive unavailable");
  });

  it("a production build does not claim the DEV-only fixture check ran", () => {
    vi.stubEnv("DEV", false);
    renderApp("#/settings");
    const check = screen.getByText("Fixture check").closest("div")!;
    expect(check.textContent).toContain("not run in this build");
    expect(check.textContent).not.toContain("consistent");
  });

  it("the dev server states the check it ran at startup", () => {
    vi.stubEnv("DEV", true);
    renderApp("#/settings");
    expect(screen.getByText("Fixture check").closest("div")!.textContent).toMatch(/\d+ runs consistent.*when the dev server started/);
  });
});

/* ---------- F-05 · accessibility ---------- */

describe("F-05 accessibility", () => {
  it("the Overview keeps a top-level heading when the Service is unavailable", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    render(<WorkspaceOverview history={createLocalHistoryProvider({ fetch: down })} live={createLocalResearchProvider({ fetch: down })} />);
    await waitFor(() => expect(document.querySelector('[data-access="SERVICE_UNAVAILABLE"]')).not.toBeNull());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("The local Service is unavailable");
  });

  it("each case's results pair every term with its own description", async () => {
    const f = fakeHistoryService();
    const v1 = fakeService();
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => (String(input).startsWith("/api/v1/history") ? f.fetch(input, init) : v1.fetch(input, init))) as typeof fetch;
    render(<WorkspaceOverview history={createLocalHistoryProvider({ fetch: fetchImpl })} live={createLocalResearchProvider({ fetch: fetchImpl })} />);
    const dl = await waitFor(() => document.querySelector<HTMLElement>('dl[aria-label="SPEC-001 results"]')!);
    const groups = [...dl.children];
    expect(groups.map((g) => g.tagName)).toEqual(["DIV", "DIV"]);
    expect(groups.map((g) => [...g.children].map((c) => c.tagName))).toEqual([
      ["DT", "DD"],
      ["DT", "DD"],
    ]);
    expect(groups.map((g) => g.querySelector("dt")!.textContent)).toEqual(["Live", "Archived"]);
  });

  for (const [where, hash, pick] of [
    ["rail", "#/", (gs: HTMLElement[]) => gs[0]!],
    ["Settings specimens", "#/settings", (gs: HTMLElement[]) => gs.find((g) => g.querySelector(".fa-specimen"))!],
  ] as const)
    it(`the ${where} theme selector is one Tab stop and moves with the arrow keys`, async () => {
      renderApp(hash);
      const group = pick(screen.getAllByRole("radiogroup", { name: "Theme" }));
      const radios = within(group).getAllByRole("radio");
      expect(radios.map((r) => r.tabIndex).filter((t) => t === 0)).toHaveLength(1);
      const checked = () => radios.find((r) => r.getAttribute("aria-checked") === "true")!;
      const start = radios.indexOf(checked());
      checked().focus();
      act(() => void fireEvent.keyDown(checked(), { key: "ArrowRight" }));
      await waitFor(() => expect(radios.indexOf(checked())).toBe((start + 1) % radios.length));
      expect(document.activeElement).toBe(checked());
      expect(checked().tabIndex).toBe(0);
      act(() => void fireEvent.keyDown(checked(), { key: "ArrowLeft" }));
      await waitFor(() => expect(radios.indexOf(checked())).toBe(start));
    });
});
