/** 17 · Settings persistence. 18 · Preference reset. 19 · Theme switching (specimens ↔ rail). */
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRuleDraft, saveRuleDraft, SEED_DRAFT } from "../data/ruleDraft";
import { resetPrefs } from "../lib/prefs";
import { resetThemePreference } from "../lib/theme";
import { renderApp } from "./render";

beforeEach(() => {
  resetPrefs();
  resetThemePreference();
  clearRuleDraft();
});

const html = () => document.documentElement;
const stored = () => JSON.parse(localStorage.getItem("flowassert.prefs") ?? "{}");
const group = (name: string) => screen.getAllByRole("radiogroup", { name }).at(-1)!;

describe("Display and accessibility preferences", () => {
  it("apply to <html> immediately and persist", async () => {
    const { user } = renderApp("#/settings");
    await user.click(within(group("Density")).getByRole("radio", { name: "Compact" }));
    await user.click(within(group("Record cell size")).getByRole("radio", { name: "12 px" }));
    await user.click(within(group("Motion")).getByRole("radio", { name: "Reduce" }));
    await user.click(within(group("Focus ring")).getByRole("radio", { name: "Heavy" }));
    await user.click(within(group("Uncertainty pattern")).getByRole("radio", { name: "Strong" }));
    await user.click(screen.getByRole("switch", { name: "Underline all links" }));
    expect(html().dataset).toMatchObject({ density: "compact", motion: "reduce", ring: "heavy", pattern: "strong", underline: "true" });
    expect(html().style.getPropertyValue("--fa-cell")).toBe("12px");
    expect(stored()).toEqual({ density: "compact", cell: "12", landing: "overview", motion: "reduce", ring: "heavy", pattern: "strong", underline: true });
  });

  it("move with arrow keys inside a segmented control", async () => {
    const { user } = renderApp("#/settings");
    const cell = group("Record cell size");
    within(cell).getByRole("radio", { name: "8 px" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(within(cell).getByRole("radio", { name: "10 px" }));
    expect(stored().cell).toBe("10");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(stored().cell).toBe("12");
  });

  it("are read back on the next load, and invalid stored values fall back to defaults", async () => {
    localStorage.setItem("flowassert.prefs", JSON.stringify({ density: "compact", cell: "99", landing: "verifications", motion: "reduce", ring: "loud", pattern: "strong", underline: "yes" }));
    vi.resetModules();
    window.history.replaceState(null, "", "/");
    const prefs = await import("../lib/prefs");
    prefs.applyInitialPrefs();
    expect(html().dataset).toMatchObject({ density: "compact", motion: "reduce", ring: "standard", pattern: "strong", underline: "false" });
    expect(html().style.getPropertyValue("--fa-cell")).toBe("8px");
    // Opening page applies only to a visit with no address inside the app.
    expect(window.location.hash).toBe("#/verifications");
  });
});

describe("Reset local preferences", () => {
  it("restores theme, display, accessibility and clears the draft, then confirms", async () => {
    saveRuleDraft(SEED_DRAFT);
    const { user } = renderApp("#/settings");
    await user.click(within(group("Density")).getByRole("radio", { name: "Compact" }));
    await user.click(screen.getByRole("radio", { name: "Night ledger (dark)" }));
    expect(localStorage.getItem("flowassert.theme")).toBe("dark");
    await user.click(screen.getByRole("button", { name: /Reset local preferences/ }));
    expect(localStorage.getItem("flowassert.prefs")).toBe(JSON.stringify({ density: "comfortable", cell: "8", landing: "overview", motion: "system", ring: "standard", pattern: "standard", underline: false }));
    expect(localStorage.getItem("flowassert.theme")).toBe("system");
    expect(localStorage.getItem("flowassert.ruleDraft")).toBeNull();
    expect(html().dataset.density).toBe("comfortable");
    expect(screen.getByText("Theme, display, accessibility and the draft rule were reset in this browser.")).toBeTruthy();
  });
});

describe("Theme specimens", () => {
  it("share one theme store with the rail switch", async () => {
    const { user } = renderApp("#/settings");
    const specimens = screen.getAllByRole("radiogroup", { name: "Theme" }).find((g) => g.querySelector(".fa-specimen"))!;
    const rail = screen.getAllByRole("radiogroup", { name: "Theme" }).find((g) => !g.querySelector(".fa-specimen"))!;
    await user.click(within(specimens).getByRole("radio", { name: /Night ledger/ }));
    expect(html().dataset.theme).toBe("dark");
    expect(within(rail).getByRole("radio", { name: "Night ledger (dark)" }).getAttribute("aria-checked")).toBe("true");
    await user.click(within(rail).getByRole("radio", { name: "Paper (light)" }));
    expect(within(specimens).getByRole("radio", { name: /Paper/ }).getAttribute("aria-checked")).toBe("true");
    expect(html().dataset.theme).toBe("light");
  });

  it("render the plates in their own theme regardless of the page theme", () => {
    renderApp("#/settings");
    const plates = [...document.querySelectorAll<HTMLElement>(".fa-specimen-plate")].map((p) => p.dataset.theme);
    expect(plates).toEqual(["light", "dark", "light", "dark"]);
  });
});

describe("Provider modes", () => {
  it("shows MOCK active and the other modes reserved, with the interface-state specimens linked", () => {
    renderApp("#/settings");
    // FIX03: a statement of the build's providers, not an operable control — a list, with no radio semantics or Tab stop.
    const providers = screen.getByRole("list", { name: "Data provider" });
    const items = within(providers).getAllByRole("listitem");
    expect(items.map((r) => r.getAttribute("aria-current"))).toEqual(["true", null, null]);
    expect(items.map((r) => r.textContent)).toEqual([expect.stringContaining("active"), expect.stringContaining("local research pages only"), expect.stringContaining("not implemented")]);
    expect(within(providers).queryAllByRole("radio")).toHaveLength(0);
    expect(providers.querySelectorAll("[tabindex]")).toHaveLength(0);
    expect((screen.getByRole("link", { name: /Interface states/ }) as HTMLAnchorElement).hash).toBe("#/states");
  });
});
