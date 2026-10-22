/** 5 · List navigation. 6 · Search and filtering. 7 · URL synchronisation. 8 · Detail navigation. */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { runs } from "../data/store";
import { STATES } from "../domain/view";
import { currentHash, renderApp, waitForHash } from "./render";

const table = () => screen.getByRole("table", { name: "Verification runs" });
const rowIds = () => within(table()).getAllByRole("link").map((a) => a.textContent);
const chip = (name: string) => within(screen.getByRole("group", { name: "Filter by cohort result" })).getByRole("button", { name: new RegExp(`^${name}`) });

describe("Verifications list", () => {
  it("lists every run newest first, each linking to its case", () => {
    renderApp("#/verifications");
    expect(rowIds()).toEqual(runs.map((r) => r.id));
    for (const link of within(table()).getAllByRole("link")) expect((link as HTMLAnchorElement).hash).toBe(`#/verifications/${link.textContent}`);
    expect(screen.getByText(`of ${runs.length} runs`)).toBeTruthy();
  });

  it("filters by cohort result, with chip counts that match", async () => {
    const { user } = renderApp("#/verifications");
    for (const s of STATES) {
      const n = runs.filter((r) => r.state === s).length;
      expect(chip(s).textContent).toBe(`${s}${n}`);
    }
    await user.click(chip("Mismatch"));
    const expected = runs.filter((r) => r.state === "Mismatch").map((r) => r.id);
    expect(rowIds()).toEqual(expected);
    expect(chip("Mismatch").getAttribute("aria-pressed")).toBe("true");
    expect(currentHash()).toBe("#/verifications?state=Mismatch");
  });

  it("searches run ID, workflow name and source namespace, and keeps the query in the URL", async () => {
    const { user } = renderApp("#/verifications");
    await user.type(screen.getByRole("searchbox", { name: "Search runs" }), "partner");
    const expected = runs.filter((r) => r.workflow.name.toLowerCase().includes("partner") || r.workflow.sourceNamespace.includes("partner")).map((r) => r.id);
    expect(expected.length).toBeGreaterThan(0);
    expect(rowIds()).toEqual(expected);
    expect(currentHash()).toBe("#/verifications?q=partner");
  });

  it("restores filter and search from the URL on arrival", () => {
    renderApp("#/verifications?state=Unverified&q=webinar");
    const expected = runs.filter((r) => r.state === "Unverified" && r.workflow.name.toLowerCase().includes("webinar")).map((r) => r.id);
    expect(rowIds()).toEqual(expected);
    expect((screen.getByRole("searchbox", { name: "Search runs" }) as HTMLInputElement).value).toBe("webinar");
  });

  it("shows an empty state that can clear filters", async () => {
    const { user } = renderApp("#/verifications?q=no-such-run");
    expect(screen.getByText("No runs match")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rowIds()).toHaveLength(runs.length);
    expect(currentHash()).toBe("#/verifications");
  });

  it("clears the search with Escape", async () => {
    const { user } = renderApp("#/verifications?q=partner");
    const box = screen.getByRole("searchbox", { name: "Search runs" });
    box.focus();
    await user.keyboard("{Escape}");
    expect((box as HTMLInputElement).value).toBe("");
    expect(rowIds()).toHaveLength(runs.length);
  });

  it("opens Verification Detail from a row and moves focus to the main region", async () => {
    const { user } = renderApp("#/verifications");
    const target = runs[2]!;
    await user.click(within(table()).getByRole("link", { name: target.id }));
    await waitForHash((h) => h === `#/verifications/${target.id}`);
    expect(await screen.findByRole("article")).toBeTruthy();
    expect(screen.getByRole("button", { name: `Copy run ID ${target.id}` })).toBeTruthy();
    expect(document.activeElement?.id).toBe("main");
    expect(document.title).toBe(`${target.id} · ${target.workflow.name} — FlowAssert`);
  });
});
