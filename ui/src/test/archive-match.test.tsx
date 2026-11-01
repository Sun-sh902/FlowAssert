/** Exact Detail → Archive matching panel (product round 02), over captured Phase 2 / Phase 3A Service bodies. */
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArchiveMatchPanel } from "../components/workspace/ArchiveMatch";
import { createLocalHistoryProvider } from "../data/history/provider";
import { createLocalResearchProvider } from "../data/local/provider";
import type { HistorySummaryView } from "../domain/history";
import type { RunView } from "../domain/view";
import { FIRST_BATCH, fakeHistoryService, historyEnvelope } from "./local/fakeHistoryService";
import { fakeService } from "./local/fakeService";

async function liveRun(id: string): Promise<RunView> {
  const r = await createLocalResearchProvider({ fetch: fakeService().fetch }).getVerification(id);
  if (r.kind !== "ready") throw new Error(`no live ${id}`);
  return r.data;
}

async function entriesOf(id: string): Promise<HistorySummaryView[]> {
  const r = await createLocalHistoryProvider({ fetch: fakeHistoryService().fetch }).listHistory({ limit: 100, verificationId: id });
  if (r.kind !== "ready") throw new Error("no list");
  return r.data.items;
}

describe("ArchiveMatchPanel", () => {
  it("one exact match: navigation to it, its record check, and a byte-identical full result", async () => {
    const live = await liveRun("SPEC-005");
    const one = (await entriesOf("SPEC-005")).filter((e) => e.historyId === FIRST_BATCH["SPEC-005"]);
    const svc = fakeHistoryService();
    render(<ArchiveMatchPanel live={live} entries={one} provider={createLocalHistoryProvider({ fetch: svc.fetch })} />);
    expect(document.querySelector("[data-archive-match]")!.getAttribute("data-archive-match")).toBe("one");
    const link = document.querySelector<HTMLAnchorElement>(`[data-archive-candidate="${FIRST_BATCH["SPEC-005"]}"] a`)!;
    expect(link.hash).toBe(`#/local/history/${FIRST_BATCH["SPEC-005"]}`);
    await waitFor(() => expect(document.querySelector("[data-result-relation]")!.getAttribute("data-result-relation")).toBe("identical"));
    expect(document.body.textContent).toContain("record check · service");
    expect(svc.log).toEqual([`/api/v1/history/verifications/${FIRST_BATCH["SPEC-005"]}`]);
  });

  it("several exact matches: all listed in archive order, none chosen; a candidate that cannot be retrieved says so", async () => {
    const live = await liveRun("SPEC-002");
    const entries = await entriesOf("SPEC-002");
    expect(entries).toHaveLength(2);
    render(<ArchiveMatchPanel live={live} entries={entries} provider={createLocalHistoryProvider({ fetch: fakeHistoryService().fetch })} />);
    expect(document.querySelector("[data-archive-match]")!.getAttribute("data-archive-match")).toBe("many");
    expect(document.body.textContent).toContain("None is chosen.");
    expect([...document.querySelectorAll("[data-archive-candidate]")].map((e) => e.getAttribute("data-archive-candidate"))).toEqual(entries.map((e) => e.historyId));
    // The captured fake holds Details for the first batch only: the second batch's candidate is listed, not retrievable.
    await waitFor(() => expect(document.body.textContent).toContain("history_not_found"));
    expect(document.querySelectorAll('[data-result-relation="identical"]')).toHaveLength(1);
  });

  it("a candidate whose archived Detail fails its integrity check shows the Service's integrity failure", async () => {
    const live = await liveRun("SPEC-003");
    const one = (await entriesOf("SPEC-003")).filter((e) => e.historyId === FIRST_BATCH["SPEC-003"]);
    const svc = fakeHistoryService();
    svc.intercept(
      (u) => u.pathname === `/api/v1/history/verifications/${FIRST_BATCH["SPEC-003"]}`,
      () => historyEnvelope("archive_integrity_failed", 503, [{ path: "run", code: "INTEGRITY_FAILED" }]),
    );
    render(<ArchiveMatchPanel live={live} entries={one} provider={createLocalHistoryProvider({ fetch: svc.fetch })} />);
    await waitFor(() => expect(document.body.textContent).toContain("INTEGRITY_FAILED"));
    expect(document.querySelector("[data-result-relation]")).toBeNull();
  });

  it("no exact match: says so and names the identity fields that differ — nothing is linked as a match", async () => {
    const live = await liveRun("SPEC-001");
    const other = (await entriesOf("SPEC-001")).map((e) => ({ ...e, inputEvidenceSha256: "f".repeat(64) }));
    render(<ArchiveMatchPanel live={live} entries={other} provider={createLocalHistoryProvider({ fetch: fakeHistoryService().fetch })} />);
    expect(document.querySelector("[data-archive-match]")!.getAttribute("data-archive-match")).toBe("none");
    expect(document.querySelector("[data-archive-candidate]")).toBeNull();
    expect(document.body.textContent).toContain("differs in input evidence");
  });
});
