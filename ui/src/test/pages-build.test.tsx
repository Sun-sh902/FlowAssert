/**
 * The GitHub Pages build (vite build --mode pages): the CSV check is the home page, the MOCK demo stays, and every
 * page that needs the local Service says it works only locally and requests nothing.
 */
import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "./render";

vi.mock("../lib/build", () => ({ PAGES_BUILD: true }));

afterEach(() => vi.unstubAllGlobals());

describe("Pages build", () => {
  it("opens on the CSV check", async () => {
    renderApp("#/");
    expect(await screen.findByRole("heading", { level: 1, name: "CSV check" }, { timeout: 5000 })).toBeTruthy();
  });

  it.each(["#/overview", "#/verifications", "#/local/verifications/SPEC-001", "#/local/verification-lookup?verification_id=x", "#/local/history", "#/local/history/h1", "#/capture"])(
    "%s says it works only locally and requests nothing",
    async (hash) => {
      const fetch = vi.fn(() => Promise.reject(new Error("no request may be made")));
      vi.stubGlobal("fetch", fetch);
      renderApp(hash);
      expect(await screen.findByRole("heading", { level: 1, name: "Works only locally" })).toBeTruthy();
      expect(screen.getAllByText("works only locally").length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: "Check the local Service now" })).toBeNull();
      await new Promise((r) => setTimeout(r, 50));
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("keeps the MOCK demo pages", async () => {
    renderApp("#/demo");
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.queryByText("Works only locally")).toBeNull();
  });

  it("links the Overview at #/overview, since #/ is the CSV check", () => {
    renderApp("#/demo");
    const nav = screen.getAllByRole("navigation", { name: "Primary" })[0]!;
    expect(within(nav).getByRole("link", { name: /Overview/ }).getAttribute("href")).toBe("#/overview");
  });
});
