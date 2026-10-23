/**
 * LOCAL_RESEARCH Verification Detail — component behaviour with a test-double service.
 * (The real Service is exercised in the browser by e2e-local/.)
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProviderResult } from "../data/access";
import { createLocalResearchProvider } from "../data/local/provider";
import type { FlowAssertReadProvider } from "../data/provider";
import type { RunView } from "../domain/view";
import type { Location } from "../lib/router";
import { LocalVerificationDetail } from "../pages/VerificationDetail";
import { captured, fakeService, json } from "./local/fakeService";
import { renderApp } from "./render";

const loc = (id: string, query = ""): Location => ({ route: { name: "local-verification", id }, params: new URLSearchParams(query), path: `/local/verifications/${id}` });

function mount(id: string, provider: FlowAssertReadProvider) {
  window.history.replaceState(null, "", `#/local/verifications/${id}`);
  const user = userEvent.setup();
  return { user, ...render(<LocalVerificationDetail id={id} location={loc(id)} provider={provider} />) };
}

const seal = () => document.querySelector('.fa-seal[data-size="lg"]');

describe("LOCAL_RESEARCH Detail — ready", () => {
  it("shows the mode, provenance and the evaluator's cohort result for SPEC-005", async () => {
    const svc = fakeService();
    mount("SPEC-005", createLocalResearchProvider({ fetch: svc.fetch }));
    expect(screen.getByRole("status").textContent).toMatch(/Reading verification run SPEC-005 from the local research service/);
    await waitFor(() => expect(seal()?.getAttribute("data-s")).toBe("Unverified"));
    const band = screen.getByRole("region", { name: "Data provenance" });
    expect(within(band).getByText("Local research · synthetic · unapproved research version")).toBeTruthy();
    expect(within(band).getByText("LOCAL_RESEARCH")).toBeTruthy();
    expect(within(band).getByText("ws-synthetic-01")).toBeTruthy();
    expect(within(band).getByText("research_only")).toBeTruthy();
    expect(within(band).getByText("Round03.5 research — unapproved")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("All 12 visible records match — but the source total is unconfirmed.");
    expect(screen.getByText(/Every record passed, yet the cohort is not Verified/)).toBeTruthy();
    const facts = document.querySelector<HTMLElement>('dl[aria-label="Case facts"]')!;
    expect(within(facts).getByText("Expected total").nextElementSibling!.textContent).toBe("unknown");
    expect(within(facts).getByText("Sync window").nextElementSibling!.textContent).toBe("closed at evaluation");
    // Record order is capture order; identities are runId:source_row.
    const cells = [...document.querySelectorAll<HTMLElement>("[data-row-id]")].map((b) => b.dataset.rowId);
    expect(cells).toEqual(Array.from({ length: 12 }, (_, i) => `SPEC-005:${i}`));
    expect(svc.log[0]).toBe("/api/v1/verifications/SPEC-005");
  });

  it("SPEC-004: no time, no axis position and no age for the missing observation", async () => {
    mount("SPEC-004", createLocalResearchProvider({ fetch: fakeService().fetch }));
    await waitFor(() => expect(seal()?.getAttribute("data-s")).toBe("Unverified"));
    expect(screen.getAllByText("HubSpot read denied").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/time unavailable/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Time unavailable \(missing_time_tick\)/)).toBeTruthy();
    expect(screen.getByText(/Observation time unavailable, so no age is computed/)).toBeTruthy();
    // The axis draws only the three available instants.
    expect(document.querySelectorAll(".fa-axis-ev")).toHaveLength(3);
  });

  it("SPEC-002: Mismatch with an open window stays Mismatch, relative to the evaluation clock", async () => {
    mount("SPEC-002", createLocalResearchProvider({ fetch: fakeService().fetch }));
    await waitFor(() => expect(seal()?.getAttribute("data-s")).toBe("Mismatch"));
    const facts = document.querySelector<HTMLElement>('dl[aria-label="Case facts"]')!;
    expect(within(facts).getByText("Sync window").nextElementSibling!.textContent).toBe("open at evaluation · closes 5 min after evaluation");
  });

  it("reads evidence pinned to the Detail's snapshot, one page at a time, then all remaining", async () => {
    const svc = fakeService();
    const { user } = mount("SPEC-001", createLocalResearchProvider({ fetch: svc.fetch }));
    await waitFor(() => expect(screen.getByText(/1 page read · 2 of 4 references · more pages remain/)).toBeTruthy());
    const ledger = screen.getByRole("table", { name: "Evidence references for this case" });
    expect(within(ledger).getAllByText("payload read · sha256 reproduced")).toHaveLength(2);
    expect(within(ledger).getAllByText("payload not read yet")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Read next page" }));
    // Phase 3A (P2-AUD-001): "Complete" became "All evidence pages retrieved"; integrity is a separate line.
    await waitFor(() => expect(screen.getByText(/All evidence pages retrieved · 2 pages · all 4 references/)).toBeTruthy());
    expect(within(ledger).getAllByText("payload read · sha256 reproduced")).toHaveLength(4);
    expect(document.querySelector("[data-integrity]")!.textContent).toBe("Payload digests reproduced in this browser · 4 of 4 — internal consistency only");
    const ev = svc.log.filter((u) => u.includes("/evidence"));
    expect(ev).toHaveLength(2);
    for (const u of ev) expect(u).toContain(`snapshot_id=${svc.snapshot()}&limit=2&include_payload=true`);
  });

  it("switching to references only restarts the read with include_payload=false; availability is unchanged", async () => {
    const svc = fakeService();
    const { user } = mount("SPEC-003", createLocalResearchProvider({ fetch: svc.fetch }));
    await waitFor(() => expect(screen.getByText(/2 of 4 references/)).toBeTruthy());
    await user.click(screen.getByRole("radio", { name: "References only" }));
    await waitFor(() => expect(screen.getAllByText("payload omitted · omitted_by_request")).toHaveLength(2));
    expect(screen.getAllByText("available")).toHaveLength(4);
    const last = svc.log.filter((u) => u.includes("/evidence")).at(-1)!;
    expect(last).toContain("include_payload=false");
    expect(last).not.toContain("cursor=");
  });
});

describe("LOCAL_RESEARCH Detail — UIA-009 nullable workflow label", () => {
  for (const [label, shown] of [
    [null, "Workflow label unavailable"],
    ["", "Workflow label empty"],
    ["Proposed n8n lead sync — no execution evidence", "Proposed n8n lead sync — no execution evidence"],
  ] as const) {
    it(`renders n8n_label=${JSON.stringify(label)} without inventing a value, and record search still works`, async () => {
      const svc = fakeService();
      svc.intercept(
        (u) => !u.pathname.endsWith("/evidence"),
        () => {
          const d = captured("SPEC-005-detail");
          d.workflow.n8n_label = label;
          return json(d);
        },
      );
      const { user } = mount("SPEC-005", createLocalResearchProvider({ fetch: svc.fetch }));
      await waitFor(() => expect(seal()?.getAttribute("data-s")).toBe("Unverified"));
      const band = screen.getByRole("region", { name: "Data provenance" });
      const el = within(band).getByText(shown);
      expect(el.className.includes("italic")).toBe(label === null || label === "");
      await user.type(screen.getByRole("searchbox", { name: "Search records" }), "unavailable");
      expect(screen.getByText("No records match")).toBeTruthy(); // fallback text is never searched
      await user.clear(screen.getByRole("searchbox", { name: "Search records" }));
      await user.type(screen.getByRole("searchbox", { name: "Search records" }), "SYN-012");
      expect([...document.querySelectorAll<HTMLElement>("[data-row-id]")].map((b) => b.dataset.rowId)).toEqual(["SPEC-005:11"]);
    });
  }
});

describe("LOCAL_RESEARCH Detail — snapshots and failures", () => {
  it("a restart before page 2 shows the stale-snapshot state, merges nothing, and re-reads only on request", async () => {
    const svc = fakeService();
    const { user } = mount("SPEC-001", createLocalResearchProvider({ fetch: svc.fetch }));
    await waitFor(() => expect(screen.getByText(/2 of 4 references/)).toBeTruthy());
    const oldSnapshot = svc.snapshot();
    svc.restart();
    await user.click(screen.getByRole("button", { name: "Read next page" }));
    await waitFor(() => expect(screen.getByText("This case was read from a snapshot the service no longer serves")).toBeTruthy());
    expect(screen.getByText(/Evidence read stopped · nothing kept/)).toBeTruthy();
    expect(screen.queryAllByText(/payload read/)).toHaveLength(0); // the first page is discarded, not merged
    expect(screen.getAllByText(oldSnapshot).length).toBeGreaterThan(0);
    expect(seal()?.getAttribute("data-s")).toBe("Verified"); // the stored verdict is unchanged
    const before = svc.log.length;
    await user.click(screen.getAllByRole("button", { name: /Re-read the whole case/ })[0]!);
    await waitFor(() => expect(screen.getByText(/2 of 4 references/)).toBeTruthy());
    expect(svc.log[before]).toBe("/api/v1/verifications/SPEC-001"); // a fresh, unpinned Detail read
    expect(svc.log.at(-1)).toContain(`snapshot_id=${svc.snapshot()}`);
    expect(screen.queryByText("This case was read from a snapshot the service no longer serves")).toBeNull();
  });

  it("an invalid cursor is a request error with a restart from page 1 — not a verdict", async () => {
    const svc = fakeService();
    svc.intercept((u) => u.searchParams.has("cursor"), () => json(captured("invalid-cursor"), 400));
    const { user } = mount("SPEC-002", createLocalResearchProvider({ fetch: svc.fetch }));
    await waitFor(() => expect(screen.getByText(/2 of 4 references/)).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Read next page" }));
    await waitFor(() => expect(screen.getByText(/rejected the continuation cursor/)).toBeTruthy());
    expect(seal()?.getAttribute("data-s")).toBe("Mismatch");
    await user.click(screen.getByRole("button", { name: /Restart evidence read/ }));
    await waitFor(() => expect(screen.getByText(/2 of 4 references/)).toBeTruthy());
    expect(svc.log.at(-1)).not.toContain("cursor=");
  });

  it("service outage: an access state, no seal, no records, no MOCK data", async () => {
    const down = createLocalResearchProvider({ fetch: (async () => new Response("", { status: 500, headers: { "content-type": "text/plain" } })) as typeof fetch });
    mount("SPEC-001", down);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(document.querySelector('[data-access="SERVICE_UNAVAILABLE"]')).toBeTruthy();
    expect(screen.getByText("none — no other data source is used")).toBeTruthy();
    expect(seal()).toBeNull();
    expect(document.querySelector("[data-row-id]")).toBeNull();
    expect(screen.queryByText(/VR-20/)).toBeNull();
    expect(screen.getByText(/verdict ·/).textContent).toMatch(/none/);
  });

  it("404 is not found; a malformed body is a request error; neither shows a verdict", async () => {
    mount("SPEC-999", createLocalResearchProvider({ fetch: fakeService().fetch }));
    await waitFor(() => expect(document.querySelector('[data-access="NOT_FOUND"]')).toBeTruthy());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/No local research run SPEC-999/);
    expect(seal()).toBeNull();
  });

  it("a refused body fails closed", async () => {
    const svc = fakeService();
    svc.intercept(
      () => true,
      () => {
        const d = captured("SPEC-002-detail");
        d.result.counts.Mismatch = 0;
        return json(d);
      },
    );
    mount("SPEC-002", createLocalResearchProvider({ fetch: svc.fetch }));
    await waitFor(() => expect(document.querySelector('[data-access="REQUEST_ERROR"]')).toBeTruthy());
    expect(screen.getAllByText(/counts_conflict/).length).toBeGreaterThan(0);
    expect(seal()).toBeNull();
  });

  it("cancelling the Detail read publishes nothing", async () => {
    const hang = createLocalResearchProvider({
      fetch: ((_u: string, init?: RequestInit) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch,
    });
    const { user } = mount("SPEC-001", hang);
    await user.click(screen.getByRole("button", { name: "Cancel read" }));
    expect(screen.getByText(/Read cancelled/)).toBeTruthy();
    expect(seal()).toBeNull();
  });
});

describe("async safety with a provider that ignores AbortSignal", () => {
  it("a late answer to an older read never overwrites the newer one", async () => {
    // Read A (generation 0) is answered only after read B (generation 1) has settled.
    const ready = async (id: string, state: "A" | "B"): Promise<ProviderResult<RunView>> => {
      const r = await createLocalResearchProvider({ fetch: fakeService().fetch }).getVerification(id);
      if (r.kind !== "ready") return r;
      return { ...r, data: { ...r.data, headline: `answer ${state}` } };
    };
    let releaseA!: () => void;
    const gateA = new Promise<void>((res) => (releaseA = res));
    let calls = 0;
    const provider: FlowAssertReadProvider = {
      mode: "LOCAL_RESEARCH",
      capabilities: { readRuns: true, readEvidence: true, liveAcquisition: false, requestRecheck: false },
      getVerification: (id) => {
        calls += 1;
        return calls === 1 ? gateA.then(() => ready(id, "A")) : ready(id, "B"); // ignores the signal entirely
      },
      getEvidence: () => new Promise(() => {}),
    };
    const { user } = mount("SPEC-001", provider);
    // StrictMode is not used here, so call 1 is read A. Re-read starts read B.
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Reading/));
    await user.click(screen.getByRole("button", { name: "Cancel read" }));
    await user.click(screen.getByRole("button", { name: "Read again" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("answer B"));
    await act(async () => {
      releaseA();
      await gateA;
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("answer B");
  });

  it("unmounting during a read publishes nothing afterwards", async () => {
    let resolve!: (r: ProviderResult<RunView>) => void;
    const provider: FlowAssertReadProvider = {
      mode: "LOCAL_RESEARCH",
      capabilities: { readRuns: true, readEvidence: true, liveAcquisition: false, requestRecheck: false },
      getVerification: () => new Promise((r) => (resolve = r)),
      getEvidence: () => new Promise(() => {}),
    };
    const { unmount } = mount("SPEC-001", provider);
    unmount();
    const late = await createLocalResearchProvider({ fetch: fakeService().fetch }).getVerification("SPEC-001");
    await act(async () => resolve(late));
    expect(document.body.textContent).toBe("");
  });
});

describe("routing and mode separation", () => {
  it("keeps the demo pages on MOCK with the demo register", () => {
    renderApp("#/demo/verifications");
    expect(screen.getByRole("region", { name: "Demo register" })).toBeTruthy();
    expect(screen.queryByText("LOCAL_RESEARCH")).toBeNull();
  });

  it("marks Verifications current on local case routes and keeps the demo runs apart", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    try {
      renderApp("#/local/verifications/SPEC-001");
      const nav = screen.getAllByRole("navigation", { name: "Primary" })[0]!;
      expect(within(nav).getByRole("link", { name: "Verifications" }).getAttribute("aria-current")).toBe("page");
      expect(within(nav).getByRole("link", { name: /Demo runs/ }).getAttribute("aria-current")).toBeNull();
      expect(screen.getByRole("region", { name: "Local research register" })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("P3A-AUD-001 — contract-valid IDs through the routed Detail page", () => {
  /** A fake Service holding one extra run, "SPEC:001": the genuine SPEC-001 body with only identity.id changed. */
  function aliasFetch() {
    const svc = fakeService();
    const sent: string[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = String(input);
      sent.push(raw);
      if (raw === "/api/v1/verifications/SPEC%3A001") {
        const body = captured("SPEC-001-detail");
        body.identity.id = "SPEC:001";
        body.snapshot_id = svc.snapshot();
        return json(body);
      }
      return svc.fetch(input, init);
    }) as typeof fetch;
    return { f, sent };
  }

  it("reads SPEC:001 with one canonical request and keeps the ID intact in in-page links", async () => {
    const { f, sent } = aliasFetch();
    vi.stubGlobal("fetch", f);
    const { user } = renderApp("#/local/verifications/SPEC%3A001");
    await waitFor(() => expect(seal()?.getAttribute("data-s")).toBe("Verified"));
    expect(sent[0]).toBe("/api/v1/verifications/SPEC%3A001");
    const row = document.querySelector<HTMLButtonElement>("[data-row-id]")!;
    expect(row.dataset.rowId).toBe("SPEC:001:0");
    await user.click(row);
    // Before the correction the raw ID was interpolated into the hash; now the segment stays SPEC%3A001.
    expect(window.location.hash.startsWith("#/local/verifications/SPEC%3A001?")).toBe(true);
    expect(new URLSearchParams(window.location.hash.split("?")[1]).get("record")).toBe("SPEC:001:0");
    expect(sent.every((u) => !u.includes("SPEC:001"))).toBe(true);
  });

  it("an unknown contract-valid ID is requested and shown as the Service's not-found", async () => {
    const { f, sent } = aliasFetch();
    vi.stubGlobal("fetch", f);
    renderApp(`#/local/verifications/${encodeURIComponent("中文")}`);
    await waitFor(() => expect(document.querySelector('[data-access="NOT_FOUND"]')).not.toBeNull());
    expect(sent[0]).toBe("/api/v1/verifications/%E4%B8%AD%E6%96%87");
  });

  for (const [hash, text] of [
    ["#/local/verifications/100%", "not valid percent-encoding"],
    ["#/local/verifications/%zz", "not valid percent-encoding"],
    ["#/local/verifications/%2E%2E", "cannot be requested over the local API"],
    ["#/local/verifications/a%2Fb", "cannot be requested over the local API"],
  ] as const)
    it(`${hash} sends nothing and says why (${text})`, () => {
      const { f, sent } = aliasFetch();
      vi.stubGlobal("fetch", f);
      renderApp(hash);
      expect(document.body.textContent).toContain(text);
      expect(sent).toEqual([]);
    });
});
