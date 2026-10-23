/**
 * final-audit-followup-04 (History F14) — the payload-mode switch racing the first evidence page.
 *
 * Switching "Payloads" → "References only" restarts the evidence acquisition. When the first include_payload=true
 * page's read settles and the switch are rendered together, that page must not be admitted into the new
 * include_payload=false acquisition (it was, and the real omitted page was then refused as cursor_out_of_sequence:
 * 0 omitted references, "Evidence retrieval stopped · nothing kept" — the F14 failure).
 *
 * The first page is held, then released, and the switch is clicked 0–15 tasks / 0–24 microtasks later, in both
 * orders, on the History entry and on the remediation-03 exact-ID lookup Detail (both share useEvidenceAcquisition).
 * Only the moment each answer is released is controlled; the bodies are the test doubles' usual captured bodies.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalHistoryProvider } from "../data/history/provider";
import { lookupHref, type Location } from "../lib/router";
import { HistoryEntry } from "../pages/History";
import { FIRST_BATCH, fakeHistoryService } from "./local/fakeHistoryService";
import { lookupService } from "./local/fakeLookupService";
import { renderApp } from "./render";

const OMITTED = "payload omitted · omitted_by_request";
const seal = () => document.querySelector('.fa-seal[data-size="lg"]')?.getAttribute("data-s");
const retrieval = () => document.querySelector("[data-retrieval]")?.textContent;
const tasks = async (k: number) => {
  for (let i = 0; i < k; i++) await new Promise((r) => setTimeout(r, 0));
};
const microtasks = async (k: number) => {
  for (let i = 0; i < k; i++) await Promise.resolve();
};
const firstPayloadPage = (u: URL) => u.pathname.endsWith("evidence") && u.searchParams.get("include_payload") === "true" && !u.searchParams.has("cursor");

/** "References only", two omitted references, nothing refused, no payload-bearing page kept. */
async function expectOmittedFirstPage() {
  await waitFor(() => expect(screen.queryAllByText(OMITTED)).toHaveLength(2));
  expect(screen.getByRole("radio", { name: "References only" }).getAttribute("aria-checked")).toBe("true");
  expect(retrieval()).toMatch(/^1 page (retrieved|read) · 2 of 4 references · more pages remain$/); // History / LOCAL Detail wording
  expect(document.querySelector('[data-access="REQUEST_ERROR"]')).toBeNull();
  expect(document.body.textContent).not.toMatch(/Archived payloads read in this browser|Payloads read in this browser/);
}

type Order = "release, then switch" | "switch, then release";
const sweep: [Order, "tasks" | "microtasks", number][] = [
  ...Array.from({ length: 16 }, (_, k) => ["release, then switch", "tasks", k] as [Order, "tasks", number]),
  ...Array.from({ length: 25 }, (_, k) => ["release, then switch", "microtasks", k] as [Order, "microtasks", number]),
  ...Array.from({ length: 4 }, (_, k) => ["switch, then release", "tasks", k] as [Order, "tasks", number]),
];

async function race(release: () => void, order: Order, unit: "tasks" | "microtasks", k: number) {
  const wait = unit === "tasks" ? tasks : microtasks;
  await act(async () => {
    if (order === "release, then switch") {
      release();
      await wait(k);
      fireEvent.click(screen.getByRole("radio", { name: "References only" }));
    } else {
      fireEvent.click(screen.getByRole("radio", { name: "References only" }));
      await wait(k);
      release();
    }
  });
}

describe("History entry: payload-mode switch vs. the first evidence page", () => {
  const HID = FIRST_BATCH["SPEC-003"]!;
  const loc: Location = { route: { name: "local-history-entry", id: HID }, params: new URLSearchParams(), path: `/local/history/${HID}` };

  it.each(sweep)("%s after %s: %i", async (order, unit, k) => {
    const svc = fakeHistoryService();
    const real = fakeHistoryService();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    svc.intercept(firstPayloadPage, (u) => held.then(() => real.fetch(u.pathname + u.search)));
    window.history.replaceState(null, "", `#/local/history/${HID}`);
    const view = render(<HistoryEntry id={HID} location={loc} provider={createLocalHistoryProvider({ fetch: svc.fetch })} />);
    await waitFor(() => expect(seal()).toBe("Pending"));
    await race(release, order, unit, k);
    await expectOmittedFirstPage();
    // The continuation is read in the chosen mode, from the omitted page's own cursor.
    fireEvent.click(screen.getByRole("button", { name: "Read all remaining" }));
    await waitFor(() => expect(retrieval()).toBe("All evidence pages retrieved · 2 pages · all 4 references, in the archive’s order"));
    expect(screen.queryAllByText(OMITTED)).toHaveLength(4);
    expect(svc.log.filter((u) => u.includes("cursor=")).every((u) => u.includes("include_payload=false"))).toBe(true);
    view.unmount();
  });
});

describe("exact-ID lookup Detail: payload-mode switch vs. the first evidence page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(sweep)("x/evidence · %s after %s: %i", async (order, unit, k) => {
    const svc = lookupService({ "x/evidence": "SPEC-005" });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let holding = true;
    const fetchHeld = ((input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, "http://127.0.0.1:5183");
      if (holding && firstPayloadPage(u)) {
        holding = false;
        return held.then(() => svc.fetch(input, init));
      }
      return svc.fetch(input, init);
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchHeld);
    const view = renderApp(lookupHref("x/evidence"));
    await waitFor(() => expect(seal()).toBe("Unverified"));
    await race(release, order, unit, k);
    await expectOmittedFirstPage();
    // Every evidence read is by the exact ID; the omitted mode is the one in force.
    const evidence = svc.log.filter((u) => u.startsWith("/api/v1/verification-evidence?"));
    expect(evidence.every((u) => u.startsWith("/api/v1/verification-evidence?verification_id=x%2Fevidence&"))).toBe(true);
    // (A held request is logged when released, so log order is not request order.)
    expect(evidence.filter((u) => u.endsWith("&include_payload=false"))).toHaveLength(1);
    view.unmount();
  });
});
