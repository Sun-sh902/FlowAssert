/** 3 · Record vs cohort. 9 · Record selection. 10 · Keyboard navigation. 11 · Field comparison. 12 · Evidence limitations. */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { latestRuns } from "../data/store";
import type { VerificationState } from "../domain/view";
import { currentHash, renderApp } from "./render";

const mismatch = latestRuns.find((r) => r.state === "Mismatch")!;
const unknownPopulation = latestRuns.find((r) => !r.populationKnown)!;
const PRIORITY: Record<VerificationState, number> = { Mismatch: 0, Unverified: 1, Pending: 2, Verified: 3 };
const listOrder = (run: typeof mismatch) => [...run.records].sort((a, b) => PRIORITY[a.state] - PRIORITY[b.state] || a.sourceRow - b.sourceRow);

const recordList = () => screen.getByRole("list", { name: "Records — use arrow keys to move" });
const recordButton = (key: string) => recordList().querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!;
const sheet = () => screen.getByRole("article");

describe("Verification Detail — verdict", () => {
  it("shows the cohort seal and the exact headline for a Mismatch run", () => {
    renderApp(`#/demo/verifications/${mismatch.id}`);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe(`${mismatch.counts.Mismatch} of ${mismatch.recordsEvaluated} records contradict the captured source cohort.`);
    expect(document.querySelector('.fa-seal[data-size="lg"]')!.getAttribute("data-s")).toBe("Mismatch");
  });

  it("keeps record and cohort results apart when every record passed but the cohort did not", () => {
    renderApp(`#/demo/verifications/${unknownPopulation.id}`);
    expect(document.querySelector('.fa-seal[data-size="lg"]')!.getAttribute("data-s")).toBe("Unverified");
    expect(screen.getByText(/Every record passed, yet the cohort is not Verified/)).toBeTruthy();
    expect(within(sheet()).getByText("Verified")).toBeTruthy();
    expect(within(sheet()).getByText(/This record is Verified, but the cohort is Unverified/)).toBeTruthy();
    const facts = document.querySelector<HTMLElement>('dl[aria-label="Case facts"]')!;
    expect(within(facts).getByText("Expected total").nextElementSibling!.textContent).toBe("unknown");
  });
});

describe("Verification Detail — records", () => {
  it("lists records worst-first and selects the first one by default", () => {
    renderApp(`#/demo/verifications/${mismatch.id}`);
    const keys = [...recordList().querySelectorAll<HTMLElement>("[data-key]")].map((b) => b.dataset.key);
    expect(keys).toEqual(listOrder(mismatch).map((r) => r.key));
    expect(recordButton(keys[0]!).getAttribute("aria-current")).toBe("true");
    expect(within(sheet()).getByRole("heading", { level: 3 }).textContent).toBe(keys[0]);
  });

  it("selects a record on click and records it in the URL", async () => {
    const { user } = renderApp(`#/demo/verifications/${mismatch.id}`);
    const target = mismatch.records.find((r) => r.state === "Verified")!;
    await user.click(recordButton(target.key));
    // Phase 2 (gap G3): the URL carries the row identity runId:sourceRow, not the raw key.
    expect(target.rowId).toBe(`${mismatch.id}:${target.sourceRow}`);
    expect(currentHash()).toBe(`#/demo/verifications/${mismatch.id}?record=${encodeURIComponent(target.rowId)}`);
    expect(recordButton(target.key).getAttribute("aria-current")).toBe("true");
    expect(within(sheet()).getByRole("heading", { level: 3 }).textContent).toBe(target.key);
  });

  it("restores the selected record from the URL", () => {
    const target = mismatch.records[10]!;
    renderApp(`#/demo/verifications/${mismatch.id}?record=${target.key}`);
    expect(within(sheet()).getByRole("heading", { level: 3 }).textContent).toBe(target.key);
  });

  it("restores the selected record from its row identity in the URL", () => {
    const target = mismatch.records[7]!;
    renderApp(`#/demo/verifications/${mismatch.id}?record=${encodeURIComponent(target.rowId)}`);
    expect(within(sheet()).getByRole("heading", { level: 3 }).textContent).toBe(target.key);
    expect(recordButton(target.key).getAttribute("aria-current")).toBe("true");
  });

  it("moves selection and focus with the arrow keys, clamped at the ends", async () => {
    const { user } = renderApp(`#/demo/verifications/${mismatch.id}`);
    const order = listOrder(mismatch).map((r) => r.key);
    recordButton(order[0]!).focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(recordButton(order[1]!));
    expect(recordButton(order[1]!).getAttribute("aria-current")).toBe("true");
    await user.keyboard("{ArrowDown}{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(recordButton(order[0]!));
    expect(currentHash()).toContain(`record=${encodeURIComponent(listOrder(mismatch)[0]!.rowId)}`);
  });

  it("filters records by state and keeps the filter in the URL", async () => {
    const { user } = renderApp(`#/demo/verifications/${mismatch.id}`);
    const group = screen.getByRole("group", { name: "Filter records by state" });
    await user.click(within(group).getByRole("button", { name: /^Mismatch/ }));
    const keys = [...recordList().querySelectorAll<HTMLElement>("[data-key]")].map((b) => b.dataset.key);
    expect(keys).toEqual(mismatch.records.filter((r) => r.state === "Mismatch").map((r) => r.key));
    expect(currentHash()).toBe(`#/demo/verifications/${mismatch.id}?state=Mismatch`);
  });

  it("searches records by key, name, company or contact ID", async () => {
    const { user } = renderApp(`#/demo/verifications/${mismatch.id}`);
    const target = mismatch.records[5]!;
    await user.type(screen.getByRole("searchbox", { name: "Search records" }), target.key);
    const keys = [...recordList().querySelectorAll<HTMLElement>("[data-key]")].map((b) => b.dataset.key);
    expect(keys).toEqual([target.key]);
  });
});

describe("Verification Detail — field comparison", () => {
  const differs = mismatch.records.find((r) => r.fields.some((f) => f.field === "phone" && f.status === "fail" && f.destination))!;
  const phone = differs.fields.find((f) => f.field === "phone")!;

  it("shows the captured source value and the HubSpot value on the operator spine", () => {
    renderApp(`#/demo/verifications/${mismatch.id}?record=${differs.key}`);
    const s = sheet();
    const wide = [...s.querySelectorAll<HTMLElement>(".hidden .fa-diff")].map((e) => e.textContent);
    expect(wide).toContain(phone.source);
    expect(wide).toContain(phone.destination);
    expect(within(s).getAllByRole("img", { name: "is contradicted" }).length).toBeGreaterThan(0);
    expect(within(s).getAllByText(/Exact comparison — no hidden normalisation/).length).toBeGreaterThan(0);
  });

  it("highlights only the differing segment, and quotes the evaluator's reason strings", () => {
    renderApp(`#/demo/verifications/${mismatch.id}?record=${differs.key}`);
    const marks = [...sheet().querySelectorAll(".hidden mark")].map((m) => m.textContent);
    expect(marks.length).toBeGreaterThan(0);
    expect(within(sheet()).getByText("rules.phone.fail")).toBeTruthy();
    expect(within(sheet()).getAllByText("“exact string comparison”").length).toBeGreaterThan(0);
  });

  it("labels the proposed email rule as proposed", () => {
    renderApp(`#/demo/verifications/${mismatch.id}?record=${differs.key}`);
    expect(within(sheet()).getAllByText(/proposed rule/i).length).toBeGreaterThan(0);
  });
});

describe("Verification Detail — evidence limitations", () => {
  it("lists what remains unknown, on every result including a green one", () => {
    const verified = latestRuns.find((r) => r.state === "Verified")!;
    for (const run of [mismatch, verified]) {
      renderApp(`#/demo/verifications/${run.id}`);
      const unknowns = screen.getByRole("region", { name: "What remains unknown" });
      for (const label of ["Workflow execution", "Business truth", "Absence cause", "Evidence authenticity"]) expect(within(unknowns).getByText(label)).toBeTruthy();
      expect(within(unknowns).getByText("not authenticated")).toBeTruthy();
      expect(screen.getByText("Consistent is not authenticated.")).toBeTruthy();
      document.body.innerHTML = "";
    }
  });

  it("marks premises that do not hold, and counts them", () => {
    renderApp(`#/demo/verifications/${unknownPopulation.id}`);
    const supports = screen.getByRole("region", { name: "What the evidence supports" });
    const notEstablished = unknownPopulation.premises.filter((p) => p.support !== "supported").length;
    expect(within(supports).getAllByText("not established")).toHaveLength(notEstablished);
    expect(within(supports).getByText(`${unknownPopulation.premises.length - notEstablished}/${unknownPopulation.premises.length} consistent`)).toBeTruthy();
  });
});

describe("Verification Detail — unknown run", () => {
  it("shows the not-found access state, which is not a verdict", () => {
    renderApp("#/demo/verifications/VR-9999");
    const notice = screen.getByRole("status");
    expect(notice.dataset.access).toBe("NOT_FOUND");
    expect(within(notice).getByText("Data access · not a verdict")).toBeTruthy();
    expect(notice.querySelector(".fa-seal")).toBeNull();
    expect(within(notice).getByRole("link", { name: "All verifications" })).toBeTruthy();
  });
});
