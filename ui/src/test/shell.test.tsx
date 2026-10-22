/** 19 · Theme switching (rail). 20 · Mobile navigation: open, focus, trap, Escape, restore, navigate. */
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetThemePreference } from "../lib/theme";
import { currentHash, renderApp, waitForHash } from "./render";

beforeEach(() => resetThemePreference());

describe("Mobile navigation drawer", () => {
  it("opens as a modal dialog and focuses its close button", async () => {
    const { user } = renderApp("#/");
    const open = screen.getByRole("button", { name: "Open navigation" });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    await user.click(open);
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(within(dialog).getAllByRole("button", { name: "Close navigation" }).find((b) => b.tabIndex !== -1));
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("keeps Tab focus inside the drawer in both directions", async () => {
    const { user } = renderApp("#/");
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    for (let i = 0; i < 14; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 14; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("closes on Escape and returns focus to the menu button", async () => {
    const { user } = renderApp("#/");
    const open = screen.getByRole("button", { name: "Open navigation" });
    await user.click(open);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(open);
    expect(document.body.style.overflow).toBe("");
  });

  it("navigates and closes when a destination is chosen", async () => {
    const { user } = renderApp("#/");
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    await user.click(within(dialog).getByRole("link", { name: /Rules/ }));
    await waitForHash((h) => h === "#/rules");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(currentHash()).toBe("#/rules");
  });

  it("marks the current page in the navigation", () => {
    renderApp("#/settings");
    const nav = screen.getAllByRole("navigation", { name: "Primary" })[0]!;
    expect(within(nav).getByRole("link", { name: /Settings/ }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: /Overview/ }).getAttribute("aria-current")).toBeNull();
  });
});

describe("Theme switch in the rail", () => {
  it("applies and persists the chosen theme", async () => {
    const { user } = renderApp("#/");
    const group = screen.getAllByRole("radiogroup", { name: "Theme" })[0]!;
    await user.click(within(group).getByRole("radio", { name: "Night ledger (dark)" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("flowassert.theme")).toBe("dark");
    expect(within(group).getByRole("radio", { name: "Night ledger (dark)" }).getAttribute("aria-checked")).toBe("true");
    await user.click(within(group).getByRole("radio", { name: "Paper (light)" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("resolves System from the device preference", async () => {
    const { user } = renderApp("#/");
    const group = screen.getAllByRole("radiogroup", { name: "Theme" })[0]!;
    await user.click(within(group).getByRole("radio", { name: "System" }));
    // The jsdom stand-in for matchMedia reports no dark preference.
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("flowassert.theme")).toBe("system");
  });
});
