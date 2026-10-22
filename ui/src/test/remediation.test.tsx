/**
 * Regression tests for the Phase 2.5 independent audit findings (FlowAssert-UI-Review/FINDINGS.md).
 * Expectations come from the stated requirements, not from the implementation's output:
 *   UIA-002 / UIA-006  drawer containment, inert background, scroll lock and breakpoint cleanup;
 *   UIA-004 / UIA-005  cancelled, superseded, unmounted and synchronously failing reads;
 *   UIA-007            the evidence table's scroll region;
 *   UIA-008            Detail NOT_FOUND heading.
 * Focus visibility (UIA-001) needs real rendering and is tested in e2e/remediation.spec.ts.
 */
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvidenceLedger } from "../components/states/EvidenceLedger";
import type { ProviderResult } from "../data/access";
import { MOCK_CONTEXT } from "../data/provider";
import { latestRuns } from "../data/store";
import type { EvidenceReferenceView } from "../domain/evidence";
import type { RunView } from "../domain/view";
import { resetThemePreference } from "../lib/theme";
import { useProviderRead } from "../lib/useProviderRead";
import { renderApp } from "./render";

const A = latestRuns[0]!;
const B = latestRuns[1]!;
const ready = (data: RunView, snapshotId: string | null = null): ProviderResult<RunView> => ({ kind: "ready", data, context: { ...MOCK_CONTEXT, snapshotId } });
const VERDICT_WORD = /"(Verified|Mismatch|Pending|Unverified)"/;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/* ---------- UIA-004 · cancellation and late answers with providers that ignore AbortSignal ---------- */

describe("UIA-004 · a cancelled read publishes nothing, whatever the provider does", () => {
  it("drops a success that arrives after cancel() from a provider that ignores the signal", async () => {
    const d = deferred<ProviderResult<RunView>>();
    const { result } = renderHook(() => useProviderRead(() => d.promise, "k"));
    act(() => result.current.cancel());
    expect(result.current.state.status).toBe("cancelled");
    await act(async () => d.resolve(ready(A)));
    expect(result.current.state.status).toBe("cancelled");
  });

  it("drops a failure that arrives after cancel() too (no error replaces the cancelled state)", async () => {
    const d = deferred<ProviderResult<RunView>>();
    const { result } = renderHook(() => useProviderRead(() => d.promise, "k"));
    act(() => result.current.cancel());
    await act(async () => d.reject(new TypeError("late network failure")));
    expect(result.current.state.status).toBe("cancelled");
  });

  it("still aborts the signal, for providers that do cooperate", () => {
    let signal: AbortSignal | null = null;
    const { result } = renderHook(() =>
      useProviderRead((s) => {
        signal = s;
        return new Promise(() => {});
      }, "k"),
    );
    act(() => result.current.cancel());
    expect(signal!.aborted).toBe(true);
  });

  it("a read started after a cancel is published normally, and the cancelled one still cannot land", async () => {
    const first = deferred<ProviderResult<RunView>>();
    const second = deferred<ProviderResult<RunView>>();
    const queue = [first, second];
    const { result } = renderHook(() => useProviderRead(() => queue.shift()!.promise, "k", { auto: false }));
    act(() => result.current.read());
    act(() => result.current.cancel());
    act(() => result.current.read());
    await act(async () => second.resolve(ready(B)));
    await act(async () => first.resolve(ready(A)));
    const s = result.current.state;
    expect(s.status === "settled" && s.result.kind === "ready" && s.result.data.id).toBe(B.id);
  });

  it("cancel() with nothing in flight leaves a settled result alone", async () => {
    const { result } = renderHook(() => useProviderRead(async () => ready(A), "k"));
    await waitFor(() => expect(result.current.state.status).toBe("settled"));
    const before = result.current.state;
    act(() => result.current.cancel());
    expect(result.current.state).toBe(before);
  });

  it("a delayed answer for the previous key never replaces the current key's answer (provider ignores abort)", async () => {
    const pending = { a: deferred<ProviderResult<RunView>>(), b: deferred<ProviderResult<RunView>>() };
    const { result, rerender } = renderHook(({ id }) => useProviderRead(() => pending[id].promise, id), { initialProps: { id: "a" as "a" | "b" } });
    rerender({ id: "b" });
    await act(async () => pending.b.resolve(ready(B)));
    await act(async () => pending.a.resolve(ready(A)));
    const s = result.current.state;
    expect(s.status === "settled" && s.result.kind === "ready" && s.result.data.id).toBe(B.id);
  });

  it("an answer after unmount is not published and raises no React warning", async () => {
    const d = deferred<ProviderResult<RunView>>();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useProviderRead(() => d.promise, "k"));
    const last = result.current.state;
    unmount();
    await act(async () => d.resolve(ready(A)));
    expect(result.current.state).toBe(last);
    expect(errors).not.toHaveBeenCalled();
  });

  it("snapshot pinning still holds: a superseded read from another snapshot never settles the view", async () => {
    const first = deferred<ProviderResult<RunView>>();
    const second = deferred<ProviderResult<RunView>>();
    const queue = [first, second];
    const { result } = renderHook(() => useProviderRead(() => queue.shift()!.promise, "k", { auto: false, pinnedSnapshotId: "snap-2" }));
    act(() => result.current.read());
    act(() => result.current.read());
    await act(async () => first.resolve(ready(A, "snap-1")));
    expect(result.current.state.status).toBe("loading");
    await act(async () => second.resolve(ready(B, "snap-9")));
    const s = result.current.state;
    expect(s.status === "settled" && s.result).toMatchObject({ kind: "error", access: "STALE_SNAPSHOT" });
    expect(s.status === "settled" && "data" in s.result).toBe(false);
  });
});

/* ---------- UIA-005 · a provider that throws before returning a promise ---------- */

const throwsSync = (message: string) =>
  (() => {
    throw new Error(message);
  }) as unknown as (signal: AbortSignal) => Promise<ProviderResult<RunView>>;

describe("UIA-005 · a synchronous provider exception is a REQUEST_ERROR, like a rejection", () => {
  it("settles as REQUEST_ERROR with the error's message, no data, no context and no verdict", async () => {
    const { result } = renderHook(() => useProviderRead(throwsSync("sync boom"), "k"));
    await waitFor(() => expect(result.current.state.status).toBe("settled"));
    const s = result.current.state;
    expect(s.status === "settled" && s.result).toEqual({ kind: "error", access: "REQUEST_ERROR", code: "provider_exception", message: "sync boom", requestId: null, retryable: true });
    expect(JSON.stringify(s)).not.toMatch(VERDICT_WORD);
    expect(JSON.stringify(s)).not.toMatch(/MOCK|synthetic/);
  });

  it("settles exactly as an asynchronous rejection with the same error does", async () => {
    const sync = renderHook(() => useProviderRead(throwsSync("same"), "k"));
    const async = renderHook(() => useProviderRead(async (): Promise<ProviderResult<RunView>> => Promise.reject(new Error("same")), "k"));
    await waitFor(() => expect(sync.result.current.state.status).toBe("settled"));
    await waitFor(() => expect(async.result.current.state.status).toBe("settled"));
    const strip = (s: typeof sync.result.current.state) => (s.status === "settled" ? s.result : s);
    expect(strip(sync.result.current.state)).toEqual(strip(async.result.current.state));
  });

  it("is not reclassified as a snapshot mismatch when pinned", async () => {
    const { result } = renderHook(() => useProviderRead(throwsSync("x"), "k", { pinnedSnapshotId: "snap-1" }));
    await waitFor(() => expect(result.current.state.status).toBe("settled"));
    const s = result.current.state;
    expect(s.status === "settled" && s.result.kind === "error" && s.result.access).toBe("REQUEST_ERROR");
  });

  it("a later read still works, and a superseded synchronous throw never lands", async () => {
    let calls = 0;
    const d = deferred<ProviderResult<RunView>>();
    const load = ((): Promise<ProviderResult<RunView>> => {
      calls++;
      if (calls === 1) throw new Error("first fails");
      return d.promise;
    }) as (signal: AbortSignal) => Promise<ProviderResult<RunView>>;
    const { result } = renderHook(() => useProviderRead(load, "k", { auto: false }));
    act(() => {
      result.current.read();
      result.current.read();
    });
    await act(async () => {});
    expect(result.current.state.status).toBe("loading");
    await act(async () => d.resolve(ready(A)));
    const s = result.current.state;
    expect(s.status === "settled" && s.result.kind).toBe("ready");
  });

  it("does not escape to React: the component tree stays mounted", async () => {
    function Reader() {
      const { state } = useProviderRead(throwsSync("boom"), "k");
      return <p data-testid="status">{state.status === "settled" && state.result.kind === "error" ? state.result.access : state.status}</p>;
    }
    render(<Reader />);
    expect(await screen.findByText("REQUEST_ERROR")).toBeTruthy();
  });
});

/* ---------- UIA-002 / UIA-006 · mobile drawer ---------- */

/** matchMedia stand-in whose answers a test can change, so a breakpoint crossing can be simulated. */
function controllableMedia() {
  const lists = new Map<string, { matches: boolean; listeners: Set<(e: MediaQueryListEvent) => void> }>();
  const entry = (q: string) => {
    if (!lists.has(q)) lists.set(q, { matches: false, listeners: new Set() });
    return lists.get(q)!;
  };
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const e = entry(query);
    return {
      get matches() {
        return e.matches;
      },
      media: query,
      onchange: null,
      addEventListener: (_t: string, l: (e: MediaQueryListEvent) => void) => e.listeners.add(l),
      removeEventListener: (_t: string, l: (e: MediaQueryListEvent) => void) => e.listeners.delete(l),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  });
  return {
    set(query: string, matches: boolean) {
      const e = entry(query);
      e.matches = matches;
      act(() => e.listeners.forEach((l) => l({ matches, media: query } as MediaQueryListEvent)));
    },
    listeners: (query: string) => entry(query).listeners.size,
  };
}
const DESKTOP = "(min-width: 64rem)";

describe("UIA-002 · drawer focus stays inside after a click on non-interactive drawer space", () => {
  beforeEach(() => resetThemePreference());

  async function openDrawer() {
    const app = renderApp("#/demo/verifications");
    await app.user.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    const panel = dialog.lastElementChild as HTMLElement;
    return { ...app, dialog, panel };
  }

  it("blank click, then Tab: focus enters the drawer, never the search field behind it", async () => {
    const { user, dialog, panel } = await openDrawer();
    await user.click(panel); // the panel itself is not focusable: focus falls to <body>
    expect(document.activeElement).toBe(document.body);
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Close navigation" }));
    for (let i = 0; i < 30; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement), `Tab #${i + 1}`).toBe(true);
      expect(document.activeElement).not.toBe(screen.queryByRole("searchbox", { hidden: true }));
    }
  });

  it("blank click, then Shift+Tab: focus enters the drawer at its last control and keeps cycling", async () => {
    const { user, dialog, panel } = await openDrawer();
    await user.click(panel);
    await user.tab({ shift: true });
    const focusable = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);
    for (let i = 0; i < 30; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement), `Shift+Tab #${i + 1}`).toBe(true);
    }
  });

  it("makes everything behind the drawer inert while it is open, and only then", async () => {
    const { user } = await openDrawer();
    const search = screen.getByRole("searchbox", { name: "Search runs", hidden: true });
    expect(search.closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open navigation", hidden: true }).closest("[inert]")).not.toBeNull();
    expect(document.querySelector('a[href="#main"]')!.closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("dialog").closest("[inert]")).toBeNull();
    await user.keyboard("{Escape}");
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("Escape closes and returns focus to the menu button; the document listener is removed", async () => {
    const removed = vi.spyOn(document, "removeEventListener");
    const { user } = await openDrawer();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open navigation" }));
    expect(removed.mock.calls.some(([type]) => type === "keydown")).toBe(true);
    // With the drawer closed, Tab is the page's own again: nothing forces focus anywhere.
    const before = document.activeElement;
    const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(before);
  });
});

describe("UIA-006 · scroll lock and breakpoint cleanup", () => {
  beforeEach(() => resetThemePreference());
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("locks scroll while open and restores the previous inline value on close", async () => {
    document.body.style.overflow = "clip";
    const { user } = renderApp("#/");
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("clip");
  });

  it("widening to desktop while open closes the drawer, restores scroll, removes its listeners and keeps focus in the page", async () => {
    const media = controllableMedia();
    const { user } = renderApp("#/demo/verifications");
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(media.listeners(DESKTOP)).toBe(1);
    media.set(DESKTOP, true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.querySelector("[inert]")).toBeNull();
    expect(media.listeners(DESKTOP)).toBe(0);
    // The menu button is hidden at desktop widths, so focus goes to the main region instead of being lost.
    expect(document.activeElement).toBe(document.getElementById("main"));
  });

  it("resizing within the mobile range keeps the drawer, the lock and the trap", async () => {
    const media = controllableMedia();
    const { user } = renderApp("#/");
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    media.set("(min-width: 48rem)", true); // an unrelated query changing must not matter
    const dialog = screen.getByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");
    await user.click(dialog.lastElementChild as HTMLElement);
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("unmounting with the drawer open restores scroll and removes every listener", async () => {
    const media = controllableMedia();
    const removed = vi.spyOn(document, "removeEventListener");
    const { user, unmount } = renderApp("#/");
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    unmount();
    expect(document.body.style.overflow).toBe("");
    expect(media.listeners(DESKTOP)).toBe(0);
    expect(removed.mock.calls.some(([type]) => type === "keydown")).toBe(true);
  });
});

/* ---------- UIA-007 · evidence table scroll region ---------- */

const ITEMS: EvidenceReferenceView[] = (["source", "destination", "policy"] as const).map((role) => ({
  id: `ev-${role}`,
  role,
  sha256: null,
  availability: "available",
  reason: null,
  acquisitionKind: "synthetic_local",
  externalAuthenticity: "not_assessed",
  payload: { state: "not_loaded" },
}));

describe("UIA-007 · the evidence table is a reachable, named scroll region only when it scrolls", () => {
  let observers: (() => void)[] = [];
  let wide = false;
  beforeEach(() => {
    observers = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          observers.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => (wide ? 560 : 300));
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => 300);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("adds no Tab stop and no landmark when the table fits", () => {
    wide = false;
    const { container } = render(<EvidenceLedger items={ITEMS} caption="Evidence references for VR-1" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.hasAttribute("tabindex")).toBe(false);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("becomes focusable, with the caption as its name, when the table is wider than its column", () => {
    wide = true;
    render(<EvidenceLedger items={ITEMS} caption="Evidence references for VR-1" />);
    const region = screen.getByRole("region", { name: "Evidence references for VR-1" });
    expect(region.tabIndex).toBe(0);
    expect(region.querySelector("table")).toBeTruthy();
  });

  it("follows resizes in both directions", () => {
    wide = false;
    render(<EvidenceLedger items={ITEMS} caption="Evidence" />);
    wide = true;
    act(() => observers.forEach((cb) => cb()));
    expect(screen.getByRole("region", { name: "Evidence" }).tabIndex).toBe(0);
    wide = false;
    act(() => observers.forEach((cb) => cb()));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("keeps the evidence rows, their order and their contents unchanged", () => {
    wide = false;
    const narrow = render(<EvidenceLedger items={ITEMS} caption="Evidence" />);
    const rows = () => [...document.querySelectorAll("tbody tr")].map((r) => r.textContent);
    const fits = rows();
    narrow.unmount();
    wide = true;
    render(<EvidenceLedger items={ITEMS} caption="Evidence" />);
    expect(rows()).toEqual(fits);
    expect([...document.querySelectorAll("tbody .mono-id")].map((e) => e.textContent)).toEqual(["ev-source", "ev-destination", "ev-policy"]);
  });
});

/* ---------- UIA-008 · Detail NOT_FOUND heading ---------- */

describe("UIA-008 · Detail NOT_FOUND has a top-level heading", () => {
  it("names the missing run in the page's only h1, with the notice's existing type style", () => {
    renderApp("#/demo/verifications/VR-9999");
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toBe("No verification run VR-9999");
    expect(h1s[0]!.closest("[data-access]")!.getAttribute("data-access")).toBe("NOT_FOUND");
    expect(h1s[0]!.className).toBe("serif mt-2 text-[26px] leading-[1.15] text-ink sm:text-[28px]");
    expect(screen.queryByRole("heading", { level: 2, name: /No verification run/ })).toBeNull();
  });
});
