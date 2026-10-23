/**
 * ID-addressability remediation-03 — the whole app at #/local/verification-lookup, with a test-double Service
 * (./local/fakeLookupService.ts). The real Service and real browsers are exercised by e2e-lookup/.
 *  - direct entry reads by exact ID through the query API only, renders the evaluator's result, keeps the ID in
 *    the address across record selection, and reads evidence with the same ID and snapshot;
 *  - the legacy path route still refuses a dot/slash ID without a request, and offers the lookup link;
 *  - a malformed lookup address is shown as such, with no request.
 */
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupHref } from "../lib/router";
import { lookupService } from "./local/fakeLookupService";
import { currentHash, renderApp, waitForHash } from "./render";

const seal = () => document.querySelector('.fa-seal[data-size="lg"]');
const ALIASES = { "x/evidence": "SPEC-005", x: "SPEC-002", "..": "SPEC-002", ".": "SPEC-001", "a?b#c": "SPEC-002" };

afterEach(() => vi.unstubAllGlobals());

describe("exact-ID lookup route", () => {
  it("x/evidence: one Detail read by exact ID, the SPEC-005 result, never the evidence route of x", async () => {
    const svc = lookupService(ALIASES);
    vi.stubGlobal("fetch", svc.fetch);
    const { user } = renderApp(lookupHref("x/evidence"));
    await waitFor(() => expect(seal()?.getAttribute("data-s")).toBe("Unverified"));
    // Detail by exact ID, then (existing behaviour) the first evidence page pinned to the Detail's snapshot.
    await waitFor(() => expect(svc.log).toHaveLength(2));
    expect(svc.log).toEqual([
      "/api/v1/verification-lookup?verification_id=x%2Fevidence",
      "/api/v1/verification-evidence?verification_id=x%2Fevidence&snapshot_id=snapshot-fake-1&limit=2&include_payload=true",
    ]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("All 12 visible records match — but the source total is unconfirmed.");
    expect(document.querySelectorAll("[data-row-id]")).toHaveLength(12);
    expect([...document.querySelectorAll<HTMLElement>("[data-row-id]")].every((b) => b.dataset.rowId!.startsWith("x/evidence:"))).toBe(true);
    // Breadcrumb names the exact ID (not "x", not "evidence").
    expect([...document.querySelectorAll("b.mono-id")].map((b) => b.textContent)).toContain("x/evidence");
    expect(document.title).toMatch(/^x\/evidence · /);

    // Record selection keeps the exact ID in the address (replaceState, no new history entry).
    const before = window.history.length;
    const rows = [...document.querySelectorAll<HTMLButtonElement>("ul [data-row-id]")];
    await user.click(rows[3]!);
    await waitForHash((h) => h.includes("record="));
    expect(currentHash().startsWith("#/local/verification-lookup?verification_id=x%2Fevidence&")).toBe(true);
    expect(window.history.length).toBe(before);

    // Continuation: user-controlled, same exact ID, snapshot, limit and payload, the returned cursor verbatim.
    await user.click(screen.getByRole("button", { name: "Read next page" }));
    await waitFor(() => expect(svc.log.length).toBe(3));
    expect(svc.log[2]).toMatch(/^\/api\/v1\/verification-evidence\?verification_id=x%2Fevidence&snapshot_id=snapshot-fake-1&limit=2&include_payload=true&cursor=[^&]+$/);
    expect(svc.log.some((u) => u.startsWith("/api/v1/verifications/"))).toBe(false);
  });

  for (const id of [".", "..", "a?b#c"])
    it(`${JSON.stringify(id)} is read as itself`, async () => {
      const svc = lookupService(ALIASES);
      vi.stubGlobal("fetch", svc.fetch);
      renderApp(lookupHref(id));
      await waitFor(() => expect(seal()).toBeTruthy());
      expect(svc.log[0]).toBe(`/api/v1/verification-lookup?verification_id=${new URLSearchParams({ v: id }).toString().slice(2)}`);
      expect([...document.querySelectorAll<HTMLElement>("[data-row-id]")].every((b) => b.dataset.rowId!.startsWith(`${id}:`))).toBe(true);
    });

  it("the legacy path route refuses x/evidence without a request and offers the exact-ID lookup", async () => {
    const svc = lookupService(ALIASES);
    vi.stubGlobal("fetch", svc.fetch);
    const { user } = renderApp("#/local/verifications/x%2Fevidence");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This verification ID cannot be requested over the local API");
    const link = screen.getByRole("link", { name: "Open with exact-ID lookup" });
    expect(link.getAttribute("href")).toBe("#/local/verification-lookup?verification_id=x%2Fevidence");
    expect(svc.log).toEqual([]);
    await user.click(link);
    await waitFor(() => expect(seal()?.getAttribute("data-s")).toBe("Unverified"));
    expect(svc.log[0]).toBe("/api/v1/verification-lookup?verification_id=x%2Fevidence");
    expect(svc.log.every((u) => !u.startsWith("/api/v1/verifications/"))).toBe(true);
  });

  it("an ordinary ID on the legacy route is unchanged: path request, no lookup link", async () => {
    const log: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      log.push(u);
      return new Response("{}", { status: 503, headers: { "content-type": "text/plain" } });
    });
    renderApp("#/local/verifications/SPEC-001");
    await waitFor(() => expect(log).toEqual(["/api/v1/verifications/SPEC-001"]));
    expect(screen.queryByRole("link", { name: "Open with exact-ID lookup" })).toBeNull();
  });

  for (const hash of ["#/local/verification-lookup?verification_id=%FF", "#/local/verification-lookup?verification_id=a&verification_id=b", "#/local/verification-lookup"])
    it(`malformed ${hash.slice(28) || "(no query)"}: refused, nothing requested`, () => {
      const log: string[] = [];
      vi.stubGlobal("fetch", async (u: string) => {
        log.push(u);
        return new Response("", { status: 500 });
      });
      renderApp(hash);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This address does not name a valid verification ID");
      expect(screen.getByText(/the address query is refused/)).toBeTruthy();
      expect(log).toEqual([]);
    });

  it("129 code points: invalid, nothing requested", () => {
    const log: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      log.push(u);
      return new Response("", { status: 500 });
    });
    renderApp(lookupHref("\u{1F9EA}".repeat(129)));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This address does not name a valid verification ID");
    expect(log).toEqual([]);
  });
});
