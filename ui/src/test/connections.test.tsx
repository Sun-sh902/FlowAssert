/** 13 · Connections role selection: click, arrow keys, URL, and nothing pretends to connect. */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CONNECTIONS } from "../data/demoConfig";
import { currentHash, renderApp } from "./render";

const parties = () => within(screen.getByRole("group", { name: /Parties to a verification/ })).getAllByRole("button");
const party = (role: string) => document.querySelector<HTMLButtonElement>(`[data-role-btn="${role}"]`)!;

describe("Connections", () => {
  it("opens on the destination role with a roving tab stop", () => {
    renderApp("#/connections");
    expect(parties()).toHaveLength(3);
    expect(party("destination").getAttribute("aria-pressed")).toBe("true");
    expect(parties().filter((b) => b.tabIndex === 0)).toEqual([party("destination")]);
    expect(screen.getByRole("heading", { level: 2, name: CONNECTIONS.find((c) => c.role === "destination")!.name })).toBeTruthy();
  });

  it("selects a role on click and syncs it to the URL", async () => {
    const { user } = renderApp("#/connections");
    await user.click(party("source"));
    expect(currentHash()).toBe("#/connections?role=source");
    expect(party("source").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("No source provider chosen")).toBeTruthy();
  });

  it("moves selection and focus with arrow keys, wrapping around", async () => {
    const { user } = renderApp("#/connections?role=source");
    party("source").focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(party("workflow"));
    expect(currentHash()).toBe("#/connections?role=workflow");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(document.activeElement).toBe(party("source"));
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(party("destination"));
    expect(currentHash()).toBe("#/connections");
  });

  it("keeps Authorise disabled with its reason, and states nothing is connected", () => {
    renderApp("#/connections");
    const authorise = screen.getByRole("button", { name: /Authorise/ }) as HTMLButtonElement;
    expect(authorise.disabled).toBe(true);
    expect(document.getElementById(authorise.getAttribute("aria-describedby")!)!.textContent).toMatch(/not implemented/);
    expect(screen.getAllByText("Not connected").length).toBeGreaterThan(0);
  });

  it("falls back to the destination role for an unknown ?role", () => {
    renderApp("#/connections?role=nonsense");
    expect(party("destination").getAttribute("aria-pressed")).toBe("true");
  });
});
