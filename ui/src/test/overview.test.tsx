/** 1 · Overview rendering and state counts. 2 · Evidence-trace ordering. 3 · Record vs cohort. 4 · Unknown population. */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecordCells } from "../components/records/RecordCells";
import { Trace } from "../components/runs/Trace";
import { cohortCounts, latestRuns, sumCounts } from "../data/store";
import { STATES, type RunView } from "../domain/view";
import { renderApp } from "./render";

const cellStates = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".fa-cell")].map((c) => c.dataset.s);

describe("Overview", () => {
  it("states the day's finding from cohort counts of the latest runs", () => {
    renderApp("#/demo");
    const c = cohortCounts(latestRuns);
    // Fixture shape: 1 Mismatch, 2 Unverified, 1 Pending, 1 Verified among the five latest runs.
    expect(c).toEqual({ Verified: 1, Mismatch: 1, Pending: 1, Unverified: 2 });
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("One workflow contradicts its source. Two cannot be concluded, one is still waiting, one is verified.");
  });

  it("totals record results in the ledger, by state, with percentages", () => {
    renderApp("#/demo");
    const r = sumCounts(latestRuns);
    const total = STATES.reduce((n, s) => n + r[s], 0);
    const ledger = screen.getByRole("heading", { name: `Record results · ${total} records` }).parentElement!;
    for (const s of STATES) {
      const row = within(ledger).getByText(s, { selector: "dt" }).parentElement!;
      expect(row.querySelector("dd")!.textContent).toBe(`${r[s]}${Math.round((r[s] / total) * 100)}%`);
    }
  });

  it("draws one trace per workflow, with an accessible description of its record results", () => {
    renderApp("#/demo");
    const traces = screen.getByRole("region", { name: /Workflow traces/ });
    const imgs = within(traces).getAllByRole("img");
    expect(imgs).toHaveLength(latestRuns.length);
    for (const run of latestRuns) expect(within(traces).getByRole("link", { name: `Open ${run.id} →` })).toHaveProperty("hash", `#/demo/verifications/${run.id}`);
  });

  it("groups exhibits by what to do, and never lists a Verified run", () => {
    renderApp("#/demo");
    expect(screen.getByRole("region", { name: "Contradicted by evidence" })).toBeTruthy();
    expect(screen.getByText("Contradicted by evidence · 1")).toBeTruthy();
    expect(screen.getByText("Inconclusive · 2")).toBeTruthy();
    expect(screen.getByText("Within the sync window · 1")).toBeTruthy();
    const verified = latestRuns.find((r) => r.state === "Verified")!;
    const exhibits = screen.getByRole("region", { name: "Exhibits" });
    expect(within(exhibits).queryByText(verified.id)).toBeNull();
  });
});

describe("Evidence trace", () => {
  it("draws record cells in capture order, whatever order the records arrive in", () => {
    const run = latestRuns.find((r) => r.state === "Mismatch")!;
    const shuffled: RunView = { ...run, records: [...run.records].reverse() };
    const { container } = render(<RecordCells run={shuffled} />);
    const expected = [...run.records].sort((a, b) => a.sourceRow - b.sourceRow).map((r) => r.state);
    expect(cellStates(container)).toEqual(expected);
  });

  it("falls back to a proportional strip above 120 records without inventing per-record cells", () => {
    const run = latestRuns[0]!;
    const big: RunView = { ...run, recordsEvaluated: 121 };
    const { container } = render(<RecordCells run={big} />);
    expect(container.querySelector(".fa-strip")).toBeTruthy();
    expect(container.querySelectorAll(".fa-cell")).toHaveLength(0);
  });

  it("keeps the cohort seal and record cells distinct: a Mismatch run still shows its Verified records", () => {
    const run = latestRuns.find((r) => r.state === "Mismatch")!;
    const { container } = render(
      <ul>
        <Trace run={run} />
      </ul>,
    );
    const seals = container.querySelectorAll(".fa-seal");
    expect([...seals].every((s) => (s as HTMLElement).dataset.s === "Mismatch")).toBe(true);
    const states = cellStates(container);
    expect(states.filter((s) => s === "Verified")).toHaveLength(run.counts.Verified);
    expect(states.filter((s) => s === "Mismatch")).toHaveLength(run.counts.Mismatch);
  });
});

describe("Unknown source population", () => {
  const run = latestRuns.find((r) => !r.populationKnown)!;

  it("is the fixture where every record is Verified and the cohort is Unverified", () => {
    expect(run.state).toBe("Unverified");
    expect(run.counts.Verified).toBe(run.recordsEvaluated);
    expect(run.expectedTotal).toBeNull();
  });

  it("adds open rings after the records — uncertainty marks, not extra records", () => {
    const { container } = render(<RecordCells run={run} />);
    const states = cellStates(container);
    expect(states.filter((s) => s === "unknown")).toHaveLength(3);
    expect(states.filter((s) => s !== "unknown")).toHaveLength(run.recordsEvaluated);
    expect(states.slice(-3)).toEqual(["unknown", "unknown", "unknown"]);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/expected total unknown$/);
  });

  it("says so in the trace instead of claiming an expected total", () => {
    render(
      <ul>
        <Trace run={run} />
      </ul>,
    );
    expect(screen.getByText(/expected total unknown/)).toBeTruthy();
    expect(screen.queryByText(/of \d+ expected/)).toBeNull();
  });
});
