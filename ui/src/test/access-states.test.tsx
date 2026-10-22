/**
 * Asynchronous UI states: components, the read hook and the specimen page.
 * Mandatory distinctions under test: a failed read is never a verdict; missing evidence is never a
 * Mismatch; a stale or superseded response never replaces a newer one; a partial set never looks complete.
 */
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccessNotice } from "../components/states/AccessStates";
import { EvidenceLedger } from "../components/states/EvidenceLedger";
import { DetailSkeleton, PartialTraces, type TraceSlot } from "../components/states/Skeletons";
import { ACCESS_STATES, type ProviderResult } from "../data/access";
import { MOCK_CONTEXT } from "../data/provider";
import { latestRuns, workflowSummaries } from "../data/store";
import { STATES, type RunView } from "../domain/view";
import { useProviderRead } from "../lib/useProviderRead";
import { evidenceFor } from "../mocks/scenarios";
import { renderApp } from "./render";

const VERDICT_SEAL = STATES.map((s) => `.fa-seal[data-s="${s}"]`).join(",");
const VERDICT_GLYPH_CLASSES = ["text-verified", "text-mismatch", "text-pending", "text-unverified"];

describe("AccessNotice", () => {
  for (const state of ACCESS_STATES) {
    it(`${state}: announces itself, says it is not a verdict, and draws no verdict mark`, () => {
      render(<AccessNotice state={state} />);
      const role = ["REQUEST_ERROR", "SERVICE_UNAVAILABLE", "STALE_SNAPSHOT"].includes(state) ? "alert" : "status";
      const el = screen.getByRole(role);
      expect(el.dataset.access).toBe(state);
      expect(within(el).getByText("Data access · not a verdict")).toBeTruthy();
      expect(el.textContent).toMatch(/verdict · none/);
      expect(el.querySelector(VERDICT_SEAL)).toBeNull();
      expect(el.querySelector(".fa-cell, .hatch, .hatch-soft")).toBeNull();
      for (const c of VERDICT_GLYPH_CLASSES) expect(el.querySelector(`svg.${c}`)).toBeNull();
      expect(screen.getByRole("heading", { level: 2 })).toBeTruthy();
    });
  }

  it("never words a request failure as Unverified or missing evidence as Mismatch", () => {
    render(
      <>
        <AccessNotice state="REQUEST_ERROR" />
        <AccessNotice state="EVIDENCE_UNAVAILABLE" />
      </>,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/This is not Unverified/);
    expect(screen.getByRole("status").textContent).toMatch(/never as a Mismatch/);
  });
});

describe("DetailSkeleton", () => {
  it("is busy, announces the read politely, and draws no records or verdict", () => {
    const { container } = render(<DetailSkeleton runId="VR-2025" />);
    expect(container.firstElementChild!.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toMatch(/Reading verification run VR-2025/);
    expect(container.querySelectorAll(".fa-cell")).toHaveLength(0);
    expect(container.querySelector(VERDICT_SEAL)).toBeNull();
    expect(container.querySelector('.fa-seal[data-s="reading"]')).toBeTruthy();
  });
});

describe("PartialTraces", () => {
  const slots: TraceSlot[] = workflowSummaries.map((w, i): TraceSlot =>
    i === 1
      ? { kind: "loading", runId: w.latest.id, workflowName: w.workflow.name, sourceNamespace: w.workflow.sourceNamespace }
      : i === 3
        ? { kind: "error", runId: w.latest.id, workflowName: w.workflow.name, sourceNamespace: w.workflow.sourceNamespace, explanation: "Detail read failed (503)." }
        : { kind: "ready", run: w.latest },
  );

  it("says how much of the set was read and marks it partial", () => {
    render(<PartialTraces slots={slots} />);
    const region = screen.getByRole("region", { name: /partially loaded/ });
    expect(region.dataset.access).toBe("PARTIAL_DATA");
    expect(region.textContent).toMatch(/3 of 5 traces read/);
  });

  it("draws cells only for runs that were read — never from the unread runs' counts", () => {
    const { container } = render(<PartialTraces slots={slots} />);
    for (const slot of container.querySelectorAll('[data-slot="loading"], [data-slot="error"]')) {
      expect(slot.querySelectorAll(".fa-cell, .fa-strip")).toHaveLength(0);
      expect(slot.querySelector(VERDICT_SEAL)).toBeNull();
    }
    const readCells = container.querySelectorAll('.fa-cell:not([data-s="unknown"])').length;
    const expected = slots.reduce((n, s) => n + (s.kind === "ready" ? s.run.recordsEvaluated : 0), 0);
    expect(readCells).toBe(expected);
  });
});

describe("EvidenceLedger", () => {
  it("shows stored availability and this read's payload outcome as separate facts", () => {
    render(<EvidenceLedger items={evidenceFor("VR-2025").items} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(6);
    const dst = rows.find((r) => r.textContent!.includes("ref-dst-0002"))!;
    expect(dst.textContent).toMatch(/available/);
    expect(dst.textContent).toMatch(/payload unreadable · read failed \(503\)/);
    for (const a of ["not collected", "redacted", "expired"]) expect(screen.getByText(a)).toBeTruthy();
    expect(screen.getByRole("table").querySelector(VERDICT_SEAL)).toBeNull();
  });
});

/* ---------- useProviderRead ---------- */

const run = latestRuns[0]!;
const ready = (snapshotId: string | null, data: RunView = run): ProviderResult<RunView> => ({ kind: "ready", data, context: { ...MOCK_CONTEXT, snapshotId } });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useProviderRead", () => {
  it("goes loading → settled with the provider's result", async () => {
    const d = deferred<ProviderResult<RunView>>();
    const { result } = renderHook(() => useProviderRead(() => d.promise, "k"));
    expect(result.current.state.status).toBe("loading");
    await act(async () => d.resolve(ready(null)));
    expect(result.current.state).toMatchObject({ status: "settled", result: { kind: "ready", data: run } });
  });

  it("drops a late answer to an older read, so it cannot overwrite the newer one", async () => {
    const first = deferred<ProviderResult<RunView>>();
    const second = deferred<ProviderResult<RunView>>();
    const queue = [first, second];
    const other = latestRuns[1]!;
    const { result } = renderHook(() => useProviderRead(() => queue.shift()!.promise, "k", { auto: false }));
    act(() => result.current.read());
    act(() => result.current.read());
    await act(async () => second.resolve(ready(null, other)));
    await act(async () => first.resolve(ready(null, run)));
    expect(result.current.state).toMatchObject({ status: "settled", result: { kind: "ready", data: other } });
  });

  it("refuses a response from another snapshot when pinned, and shows no data", async () => {
    const { result } = renderHook(() => useProviderRead(async () => ready("snap-9"), "k", { pinnedSnapshotId: "snap-7" }));
    await waitFor(() => expect(result.current.state.status).toBe("settled"));
    const s = result.current.state;
    expect(s.status === "settled" && s.result).toMatchObject({ kind: "error", access: "STALE_SNAPSHOT", code: "snapshot_mismatch" });
    expect(s.status === "settled" && "data" in s.result).toBe(false);
  });

  it("treats cancellation as a hook state that publishes nothing", async () => {
    const { result } = renderHook(() =>
      useProviderRead(
        (signal) =>
          new Promise<ProviderResult<RunView>>((_res, rej) => signal.addEventListener("abort", () => rej(new DOMException("x", "AbortError")))),
        "k",
      ),
    );
    await act(async () => result.current.cancel());
    expect(result.current.state.status).toBe("cancelled");
  });

  it("turns a provider exception into a request error, never a verdict", async () => {
    const { result } = renderHook(() => useProviderRead(async () => Promise.reject(new TypeError("Failed to fetch")), "k"));
    await waitFor(() => expect(result.current.state.status).toBe("settled"));
    expect(result.current.state).toMatchObject({ result: { kind: "error", access: "REQUEST_ERROR", message: "Failed to fetch", retryable: true } });
  });

  it("aborts the in-flight read on unmount", () => {
    let signal: AbortSignal | null = null;
    const { unmount } = renderHook(() =>
      useProviderRead((s) => {
        signal = s;
        return new Promise(() => {});
      }, "k"),
    );
    unmount();
    expect(signal!.aborted).toBe(true);
  });
});

/* ---------- Specimen page ---------- */

describe("Interface states page", () => {
  it("is reachable at #/states (lazy-loaded) and shows a plate for every access state", async () => {
    renderApp("#/states");
    await screen.findByRole("heading", { level: 1 });
    expect(document.title).toBe("Interface states — FlowAssert");
    for (const title of ["Loading", "Empty", "Request error", "Not found", "Partial data", "Stale snapshot", "Evidence unavailable", "Service unavailable", "Cancelled"])
      expect(screen.getByRole("heading", { level: 2, name: new RegExp(`${title}$`) })).toBeTruthy();
    expect(screen.getAllByText("Simulated · no request is made")).toHaveLength(10);
  });

  it("runs a simulated read: loading, then a request error with retry, then ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderApp("#/states");
    await screen.findByRole("heading", { level: 1 });
    const live = document.querySelector<HTMLElement>("[data-live-result]")!;
    await user.click(screen.getByRole("radio", { name: "Request error" }));
    await user.click(screen.getByRole("button", { name: /^Read VR-/ }));
    expect(live.querySelector('[aria-busy="true"]')).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(1000));
    const alert = within(live).getByRole("alert");
    expect(alert.dataset.access).toBe("REQUEST_ERROR");
    await user.click(screen.getByRole("radio", { name: "Ready" }));
    await user.click(within(alert).getByRole("button", { name: "Retry the read" }));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(live.querySelector(".fa-seal")!.getAttribute("data-s")).toBe(latestRuns.find((r) => r.state === "Mismatch")!.state);
  });

  it("refuses a stale-snapshot response instead of showing its result", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderApp("#/states");
    await screen.findByRole("heading", { level: 1 });
    const live = document.querySelector<HTMLElement>("[data-live-result]")!;
    await user.click(screen.getByRole("radio", { name: "Stale snapshot" }));
    await user.click(screen.getByRole("button", { name: /^Read VR-/ }));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(within(live).getByRole("alert").dataset.access).toBe("STALE_SNAPSHOT");
    expect(live.querySelector(VERDICT_SEAL)).toBeNull();
  });

  it("cancels a read in flight and publishes nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderApp("#/states");
    await screen.findByRole("heading", { level: 1 });
    const live = document.querySelector<HTMLElement>("[data-live-result]")!;
    await user.click(screen.getByRole("button", { name: /^Read VR-/ }));
    await user.click(screen.getByRole("button", { name: "Cancel read" }));
    await act(async () => vi.advanceTimersByTime(2000));
    expect(live.textContent).toMatch(/Read cancelled/);
    expect(live.querySelector(VERDICT_SEAL)).toBeNull();
  });
});
