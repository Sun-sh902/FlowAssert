/**
 * UIA-009 · `workflow.n8n_label` is required and nullable in the frozen contract.
 * Search, display and filtering must be null-safe, keep the original null, and never search the
 * presentation fallback ("Workflow label unavailable") as if it were data.
 */
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RunView } from "../domain/view";
import { workflowLabelText } from "../lib/format";
import { matchesSearch, normalizeQuery } from "../lib/search";
import { searchRuns } from "../pages/Verifications";
import { renderApp } from "./render";

vi.mock("../data/store", async (importActual) => {
  const actual = await importActual<typeof import("../data/store")>();
  const base = actual.runs[0]!;
  const withLabel = (id: string, workflowId: string, name: string, n8nLabel: string | null): RunView => ({
    ...base,
    id,
    workflow: { ...base.workflow, id: workflowId, name, n8nLabel },
  });
  const extra = [
    withLabel("VR-N001", "wf-null", "Absent label flow", null),
    withLabel("VR-N002", "wf-empty", "Empty label flow", ""),
    withLabel("VR-N003", "wf-normal", "Normal label flow", "Quarterly import · ledger"),
  ];
  return {
    ...actual,
    runs: [...extra, ...actual.runs],
    workflows: [...extra.map((r) => r.workflow), ...actual.workflows],
  };
});

const { runs, workflows } = await import("../data/store");
const nullRun = runs.find((r) => r.id === "VR-N001")!;
const emptyRun = runs.find((r) => r.id === "VR-N002")!;
const normalRun = runs.find((r) => r.id === "VR-N003")!;
const ids = (list: RunView[]) => list.map((r) => r.id);

describe("UIA-009 · null-safe search helper", () => {
  it("skips null and undefined fields instead of throwing", () => {
    expect(() => matchesSearch("x", [null, undefined, "abc"])).not.toThrow();
    expect(matchesSearch("ab", [null, undefined, "abc"])).toBe(true);
    expect(matchesSearch("zz", [null, undefined, "abc"])).toBe(false);
    expect(matchesSearch("anything", [null, undefined])).toBe(false);
  });

  it("treats an empty query as no search and normalizes case and spacing", () => {
    expect(matchesSearch("", [null])).toBe(true);
    expect(matchesSearch("   ", [null])).toBe(true);
    expect(normalizeQuery("  LeDgEr ")).toBe("ledger");
    expect(matchesSearch("  LEDGER ", ["Quarterly import · ledger"])).toBe(true);
  });

  it("never matches the words a null value would be displayed as", () => {
    for (const q of ["null", "undefined", "unavailable", "workflow label unavailable", "workflow label empty"]) {
      expect(matchesSearch(q, [null, ""]), q).toBe(false);
    }
  });
});

describe("UIA-009 · presentation fallback", () => {
  it("distinguishes null, empty and a real label, flagging the fallbacks", () => {
    expect(workflowLabelText(null)).toEqual({ text: "Workflow label unavailable", fallback: true });
    expect(workflowLabelText("")).toEqual({ text: "Workflow label empty", fallback: true });
    expect(workflowLabelText("Webinar → CRM")).toEqual({ text: "Webinar → CRM", fallback: false });
  });
});

describe("UIA-009 · run search over a mixed collection", () => {
  it("keeps the authoritative null and empty values in the view models", () => {
    expect(nullRun.workflow.n8nLabel).toBeNull();
    expect(emptyRun.workflow.n8nLabel).toBe("");
    expect(normalRun.workflow.n8nLabel).toBe("Quarterly import · ledger");
  });

  it("returns every run, in order, for an empty query", () => {
    expect(ids(searchRuns(runs, ""))).toEqual(ids(runs));
    expect(ids(searchRuns(runs, "  "))).toEqual(ids(runs));
  });

  it("finds a null-label run by its real fields: ID, workflow name and namespace", () => {
    expect(ids(searchRuns(runs, "VR-N001"))).toEqual(["VR-N001"]);
    expect(ids(searchRuns(runs, "absent label flow"))).toEqual(["VR-N001"]);
    expect(searchRuns(runs, nullRun.workflow.sourceNamespace).map((r) => r.id)).toContain("VR-N001");
  });

  it("finds a run by a real n8n label", () => {
    expect(ids(searchRuns(runs, "quarterly import"))).toEqual(["VR-N003"]);
    const demoLabel = runs.find((r) => r.id.startsWith("VR-2"))!.workflow.n8nLabel!;
    expect(searchRuns(runs, demoLabel).length).toBeGreaterThan(0);
  });

  it("does not search invented fallback text", () => {
    for (const q of ["Workflow label unavailable", "label unavailable", "Workflow label empty", "null"]) {
      expect(ids(searchRuns(runs, q)), q).toEqual([]);
    }
  });

  it("does not mutate the runs it searches", () => {
    const before = structuredClone(runs.map((r) => r.workflow));
    searchRuns(runs, "flow");
    searchRuns(runs, "");
    expect(runs.map((r) => r.workflow)).toEqual(before);
    expect(nullRun.workflow.n8nLabel).toBeNull();
  });

  it("returns the original objects, not copies with a filled-in label", () => {
    const hit = searchRuns(runs, "VR-N001")[0];
    expect(hit).toBe(nullRun);
  });
});

describe("UIA-009 · pages", () => {
  const table = () => screen.getByRole("table", { name: "Verification runs" });
  const rowIds = () => within(table()).getAllByRole("link").map((a) => a.textContent);

  it("renders the Verifications list with null and empty labels, and searches without throwing", async () => {
    const { user } = renderApp("#/demo/verifications");
    expect(rowIds()).toEqual(ids(runs));
    const box = screen.getByRole("searchbox", { name: "Search runs" });
    await user.type(box, "label unavailable");
    expect(screen.getByText("No runs match")).toBeTruthy();
    await user.clear(box);
    await user.type(box, "absent label");
    expect(rowIds()).toEqual(["VR-N001"]);
  });

  it("combines a null-safe search with the cohort filter", () => {
    renderApp(`#/demo/verifications?state=${nullRun.state}&q=label flow`);
    const expected = runs.filter((r) => r.state === nullRun.state && /label flow/i.test(r.workflow.name)).map((r) => r.id);
    expect(expected).toContain("VR-N001");
    expect(rowIds()).toEqual(expected);
  });

  it("shows the fallback only as presentation text on Connections", () => {
    renderApp("#/connections");
    expect(workflows.find((w) => w.id === "wf-null")!.n8nLabel).toBeNull();
    const unavailable = screen.getByText("Workflow label unavailable");
    expect(unavailable.className).toContain("italic");
    expect(screen.getByText("Workflow label empty").className).toContain("italic");
    expect(screen.getByText("Quarterly import · ledger").className).not.toContain("italic");
  });
});
