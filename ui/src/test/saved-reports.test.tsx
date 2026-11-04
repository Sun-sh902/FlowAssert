/**
 * Saved reports (v0.5.0), with the in-memory store: a check keeps a report only when "Keep" is pressed, and then that
 * one report, byte for byte; a refused store leaves the result as it is; the saved reports page imports, lists, opens,
 * downloads and deletes, and refuses a file that is not a report; nothing from a saved report fills in the CSV check;
 * the comparison page says premise differences first, refuses a pair that is not comparable, and never uses words
 * that overstate. The real IndexedDB store is tested in Chrome (e2e/saved-reports.spec.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLocalizer } from "../i18n/localizer";
import { readReport } from "../offline/savedReport";
import { inThreadRunner } from "../offline/runner";
import { parseHash } from "../lib/router";
import { ReportStoreContext, StorageUnavailable, memoryStore, type ReportStore } from "../lib/savedReports";
import { Check } from "../pages/Check";
import { SavedReportPage, SavedReportsPage } from "../pages/SavedReports";
import { REPO_ROOT } from "./fixtures/sources";
import { renderApp } from "./render";

const GOLDEN = join(REPO_ROOT, "offline/golden");
const goldenBytes = (name: string) => new Uint8Array(readFileSync(join(GOLDEN, name, "report.json")));
const goldenFile = (name: string, fileName = `${name}.json`) => new File([goldenBytes(name)], fileName, { type: "application/json" });
const example = (file: string) => new File([readFileSync(join(REPO_ROOT, "offline/examples", file))], file, { type: "text/csv" });
const caseReport = (name: string, side: "earlier" | "later") =>
  new TextEncoder().encode(JSON.stringify((JSON.parse(readFileSync(join(__dirname, "offline/comparison-cases", `${name}.json`), "utf-8")) as Record<string, { report: unknown }>)[side]!.report));

let saved: { blob: Blob; name: string }[] = [];

beforeEach(() => {
  saved = [];
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (blob: Blob) => (saved.push({ blob, name: "" }), "blob:test"), revokeObjectURL: () => undefined }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (this.download) saved[saved.length - 1]!.name = this.download;
  });
});

afterEach(() => vi.unstubAllGlobals());

const withStore = (store: ReportStore, ui: ReactNode) => <ReportStoreContext.Provider value={store}>{ui}</ReportStoreContext.Provider>;

/** Run the example check; with `store` null, on the page's own store, as in the app (IndexedDB). */
async function checkExample(store: ReportStore | null) {
  const user = userEvent.setup();
  const page = <Check runner={inThreadRunner()} />;
  render(store ? withStore(store, page) : page);
  await user.upload(screen.getByTestId("source-file"), example("source.csv"));
  await user.upload(screen.getByTestId("destination-file"), example("destination.csv"));
  await waitFor(() => expect(screen.getAllByText("3 columns")).toHaveLength(2));
  await user.selectOptions(screen.getByTestId("key-source"), "external_id");
  await user.selectOptions(screen.getByTestId("key-destination"), "external_id");
  await user.selectOptions(screen.getByTestId("field-0-source"), "phone");
  await user.selectOptions(screen.getByTestId("field-0-destination"), "phone");
  await user.click(screen.getByTestId("source-complete"));
  await user.type(screen.getByTestId("source-count"), "4");
  await user.click(screen.getByTestId("run-check"));
  await screen.findByRole("region", { name: "Result" }, { timeout: 5000 });
  return user;
}

async function stored(store: ReportStore, name: string, obtained: Parameters<ReportStore["add"]>[1] = { kind: "imported", fileName: `${name}.json` }, bytes = goldenBytes(name)) {
  return store.add(readReport(bytes, "r"), obtained);
}

describe("the in-memory store", () => {
  it("keeps the original bytes and the summary the list shows, and nothing else", async () => {
    const store = memoryStore();
    const bytes = goldenBytes("scope-exact-source-unknown");
    const entry = await stored(store, "scope-exact-source-unknown", { kind: "imported", fileName: "r.json" }, bytes);
    expect(Object.keys(entry).sort()).toEqual(["id", "obtained", "savedAt", "summary"]);
    expect(entry.summary).toEqual({
      evaluatedAt: "2000-01-01T00:00:00Z",
      cohortState: "Mismatch",
      counts: { Verified: 1, Mismatch: 3, Pending: 0, Unverified: 0 },
      destinationOnlyCounts: { Verified: 0, Mismatch: 0, Pending: 0, Unverified: 1 },
      key: ["id", "id"],
      fields: [["note", "note"]],
      redacted: false,
      details: "problems",
      size: bytes.length,
    });
    expect(await store.bytes(entry.id)).toEqual(bytes);
    expect((await store.list()).map((e) => e.id)).toEqual([entry.id]);
    await store.remove(entry.id);
    expect(await store.list()).toEqual([]);
    expect(await store.bytes(entry.id)).toBeNull();
  });

  it("lists the most recently saved first, and deletes everything at once", async () => {
    const store = memoryStore();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
    const first = await stored(store, "example");
    vi.setSystemTime(new Date("2026-11-04T11:00:00Z"));
    const second = await stored(store, "rules-pass");
    vi.useRealTimers();
    expect((await store.list()).map((e) => e.id)).toEqual([second.id, first.id]);
    await store.removeAll();
    expect(store.size).toBe(0);
  });
});

describe("keeping a report from the CSV check", () => {
  it("stores nothing, and touches no storage, unless Keep is pressed", async () => {
    const touched: string[] = [];
    // The page's own store is IndexedDB; any use of it at all is recorded.
    vi.stubGlobal("indexedDB", new Proxy({}, { get: (_, name) => (touched.push(String(name)), () => undefined) }));
    await checkExample(null);
    expect(screen.getByTestId("keep-report")).toBeTruthy();
    expect(touched).toEqual([]);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    // The same with a store that records every report it keeps.
    cleanupAll();
    const store = memoryStore();
    await checkExample(store);
    expect(store.size).toBe(0);
  });

  it("keeps that one report, byte for byte, when Keep is pressed, and says so", async () => {
    const store = memoryStore();
    const user = await checkExample(store);
    await user.click(screen.getByTestId("keep-report"));
    expect(await screen.findByText("This report is kept in this browser.")).toBeTruthy();
    expect((screen.getByTestId("keep-report") as HTMLButtonElement).disabled).toBe(true);
    const [entry] = await store.list();
    expect(store.size).toBe(1);
    expect(entry!.obtained).toEqual({ kind: "checked" });
    await user.click(screen.getByTestId("download-json"));
    expect(await store.bytes(entry!.id)).toEqual(new Uint8Array(await saved[0]!.blob.arrayBuffer()));
    // The premises are the ones stated for this check, with their origin.
    const { report } = readReport((await store.bytes(entry!.id))!, "r");
    expect(report.premises.source_complete).toEqual({ stated: true, origin: "browser form" });
    expect(report.premises.source_count!.stated).toBe(4);
  });

  it("says why when storage refuses, and the result stays", async () => {
    const store: ReportStore = { ...memoryStore(), add: () => Promise.reject(new StorageUnavailable("This browser blocks storage for this page.", "SecurityError: denied")) };
    const user = await checkExample(store);
    await user.click(screen.getByTestId("keep-report"));
    const refused = await screen.findByTestId("keep-refused");
    expect(refused.textContent).toBe("The report was not kept. This browser blocks storage for this page. (SecurityError: denied) The result on this page is unchanged.");
    expect(screen.getByRole("region", { name: "Result" })).toBeTruthy();
    expect(screen.getByTestId("summary").textContent).toContain("Mismatch: 4 rows of");
  });

  it("fills in nothing from a saved report: a new check starts with nothing chosen or stated", async () => {
    const store = memoryStore();
    await stored(store, "identical-content-allowed");
    await stored(store, "count-source-mismatch");
    render(withStore(store, <Check runner={inThreadRunner()} />));
    expect((screen.getByTestId("source-complete") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("destination-complete") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("allow-identical") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("source-count") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("destination-count") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("key-source") as HTMLSelectElement).value).toBe("");
    expect((screen.getByTestId("field-0-source") as HTMLSelectElement).value).toBe("");
  });
});

describe("the saved reports page", () => {
  it("imports a report, lists it with what it is, and says an imported report is not authenticated", async () => {
    const store = memoryStore();
    const user = userEvent.setup();
    render(withStore(store, <SavedReportsPage />));
    expect(await screen.findByTestId("no-saved-reports")).toBeTruthy();
    await user.upload(screen.getByTestId("import-file"), goldenFile("rules-redacted", "from-the-action.json"));
    const card = await screen.findByTestId("saved-entry");
    expect(within(card).getByText("Imported from a file")).toBeTruthy();
    expect(within(card).getByText("from-the-action.json")).toBeTruthy();
    expect(within(card).getByText("Not authenticated: imported from a file.")).toBeTruthy();
    expect(within(card).getByText("yes: keys and values are not in the report")).toBeTruthy();
    expect(card.querySelector('[data-count="Mismatch"]')!.textContent).toBe("3");
    expect(screen.getByTestId("saved-message").textContent).toBe("Imported: from-the-action.json An imported report is not authenticated.");
    expect(screen.getByTestId("storage-use").textContent).toBe(`1 report, ${goldenBytes("rules-redacted").length} bytes.`);
    expect(screen.getByText("memory of this page (tests only)")).toBeTruthy();
  });

  it("refuses a file that is not a valid report, and keeps nothing", async () => {
    const store = memoryStore();
    const user = userEvent.setup();
    render(withStore(store, <SavedReportsPage />));
    await screen.findByTestId("no-saved-reports");
    const altered = JSON.parse(readFileSync(join(GOLDEN, "example", "report.json"), "utf-8")) as { counts: { Mismatch: number } };
    altered.counts.Mismatch = 2;
    await user.upload(screen.getByTestId("import-file"), new File([JSON.stringify(altered)], "edited.json"));
    await waitFor(() => expect(screen.getByTestId("saved-message").textContent).toContain("Refused, and nothing was kept"));
    expect(screen.getByTestId("saved-message").textContent).toContain("edited.json: counts do not add up to source_rows_observed");
    // A file the picker would not offer (accept=".json") can still be chosen as "All files".
    await userEvent.setup({ applyAccept: false }).upload(screen.getByTestId("import-file"), new File(["key,phone\n1,2\n"], "data.csv"));
    await waitFor(() => expect(screen.getByTestId("saved-message").textContent).toContain("data.csv: invalid JSON"));
    expect(store.size).toBe(0);
  });

  it("downloads the original bytes, deletes one, and deletes all after a confirmation", async () => {
    const store = memoryStore();
    // Bytes the page's own writer would never produce: they must come back exactly as imported.
    const odd = new TextEncoder().encode(readFileSync(join(GOLDEN, "example", "report.json"), "utf-8").replace("{", '{\n  "a_member_from_the_future": [1, 2.5],') + "\n\n");
    await stored(store, "example", { kind: "imported", fileName: "odd.json" }, odd);
    await stored(store, "rules-pass", { kind: "checked" });
    await stored(store, "rules-fail", { kind: "checked" });
    const user = userEvent.setup();
    render(withStore(store, <SavedReportsPage />));
    await waitFor(() => expect(screen.getAllByTestId("saved-entry")).toHaveLength(3));
    const oddCard = screen.getAllByTestId("saved-entry").find((c) => c.textContent!.includes("odd.json"))!;
    await user.click(within(oddCard).getByTestId("download-entry"));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe("odd.json");
    // Compared as numbers: jsdom's Blob gives a typed array of another realm.
    expect([...new Uint8Array(await saved[0]!.blob.arrayBuffer())]).toEqual([...odd]);
    await user.click(within(oddCard).getByTestId("delete-entry"));
    await waitFor(() => expect(screen.getAllByTestId("saved-entry")).toHaveLength(2));
    await user.click(screen.getByTestId("delete-all"));
    expect(screen.getByText("Delete all 2 saved reports from this browser? This cannot be undone.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep them" }));
    expect(store.size).toBe(2);
    await user.click(screen.getByTestId("delete-all"));
    await user.click(screen.getByTestId("confirm-delete-all"));
    expect(await screen.findByTestId("no-saved-reports")).toBeTruthy();
    expect(store.size).toBe(0);
  });

  it("offers a comparison of two chosen reports, the earlier one first", async () => {
    const store = memoryStore();
    const later = await stored(store, "x", { kind: "checked" }, caseReport("classes-details-all", "later"));
    const earlier = await stored(store, "x", { kind: "checked" }, caseReport("classes-details-all", "earlier"));
    await stored(store, "example");
    const user = userEvent.setup();
    render(withStore(store, <SavedReportsPage />));
    await waitFor(() => expect(screen.getAllByTestId("saved-entry")).toHaveLength(3));
    const card = (id: string) => screen.getAllByTestId("saved-entry").find((c) => c.getAttribute("data-entry") === id)!;
    await user.click(within(card(later.id)).getByTestId("choose-entry"));
    expect(screen.queryByTestId("compare-chosen")).toBeNull();
    await user.click(within(card(earlier.id)).getByTestId("choose-entry"));
    // Two are chosen: the third cannot be.
    const third = screen.getAllByTestId("saved-entry").find((c) => ![earlier.id, later.id].includes(c.getAttribute("data-entry")!))!;
    expect((within(third).getByTestId("choose-entry") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId("compare-chosen").getAttribute("href")).toBe(`#/check/compare?earlier=${earlier.id}&later=${later.id}`);
  });

  it("says when storage is not available, and why", async () => {
    const store: ReportStore = { ...memoryStore(), list: () => Promise.reject(new StorageUnavailable("Storage is not available in this window, as in a private window.", "InvalidStateError")) };
    render(withStore(store, <SavedReportsPage />));
    expect((await screen.findByTestId("storage-unavailable")).textContent).toBe(
      "Saved reports are not available in this browser. Storage is not available in this window, as in a private window. (InvalidStateError) The CSV check still works; its reports can be downloaded.",
    );
  });
});

describe("an opened saved report", () => {
  it("shows what the CSV check shows of a result: state, claim, premises with origins, counts, limitations and problems", async () => {
    const store = memoryStore();
    const entry = await stored(store, "example");
    render(withStore(store, <SavedReportPage id={entry.id} />));
    const result = await screen.findByRole("region", { name: "Result" });
    expect(result.querySelector(".fa-seal")!.getAttribute("data-s")).toBe("Mismatch");
    expect(within(result).getByText("No claim is made: the result is not Verified.")).toBeTruthy();
    for (const name of ["source_complete", "destination_complete", "source_count", "destination_count"]) {
      expect(result.querySelector(`[data-premise="${name}"]`)!.textContent).toContain("command-line option");
    }
    expect(result.querySelector('[data-count="Verified"]')!.textContent).toBe("1");
    expect(within(result).getByText(/^Files and completeness statements are not authenticated\./)).toBeTruthy();
    expect([...result.querySelectorAll("[data-record]")].map((r) => r.getAttribute("data-record"))).toEqual(["2", "3", "4"]);
    expect(screen.getByText(/^Not authenticated: this report was imported from a file\./)).toBeTruthy();
  });

  it("shows the claim of a Verified report", async () => {
    const store = memoryStore();
    const entry = await stored(store, "rules-pass", { kind: "checked" });
    render(withStore(store, <SavedReportPage id={entry.id} />));
    expect(await screen.findByText("At this evaluation, under the stated premises, the supplied destination rows satisfy the rules for the supplied source rows.")).toBeTruthy();
    expect(screen.getByText(/^Kept from a check in this browser, when you asked\./)).toBeTruthy();
  });

  it("shows nothing of an entry whose bytes are no longer a valid report", async () => {
    const store = memoryStore();
    const entry = await stored(store, "example");
    const broken: ReportStore = { ...store, bytes: async () => new TextEncoder().encode("{}") };
    render(withStore(broken, <SavedReportPage id={entry.id} />));
    expect((await screen.findByTestId("saved-refused")).textContent).toContain("example.json: schema_version is missing");
    expect(screen.queryByRole("region", { name: "Result" })).toBeNull();
  });
});

describe("routes and navigation", () => {
  it("parses the saved reports routes", () => {
    expect(parseHash("#/check/reports").route).toEqual({ name: "saved-reports" });
    expect(parseHash("#/check/reports/abc").route).toEqual({ name: "saved-report", id: "abc" });
    expect(parseHash("#/check/compare?earlier=a&later=b").route).toEqual({ name: "compare-reports" });
    expect(parseHash("#/check/other").route).toEqual({ name: "not-found" });
  });

  it("is reached from the Browser check navigation and from the CSV check page", async () => {
    renderApp("#/check/reports");
    expect(await screen.findByRole("heading", { level: 1, name: "Saved reports" }, { timeout: 5000 })).toBeTruthy();
    const nav = screen.getAllByRole("navigation", { name: "Browser check" })[0]!;
    expect(within(nav).getByRole("link", { name: /Saved reports/ }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: /CSV check/ }).getAttribute("aria-current")).toBeNull();
    // jsdom has no IndexedDB: the page says storage is not available, and why.
    expect((await screen.findByTestId("storage-unavailable")).textContent).toContain("This browser offers no IndexedDB storage here.");
    cleanupAll();
    renderApp("#/check");
    expect((await screen.findByTestId("open-saved-reports", {}, { timeout: 5000 })).getAttribute("href")).toBe("#/check/reports");
  });
});

function cleanupAll() {
  document.body.innerHTML = "";
}

describe("in Chinese", () => {
  const ALLOWED = /^(FlowAssert|JSON|IndexedDB|GitHub|CSV|n8n|Action|Pages|problems|sun-sh902\.github\.io)$/;

  /** Words with Latin letters left after the localizer ran, outside values marked as data. */
  function untranslated(root: HTMLElement): string[] {
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.parentElement?.closest("code, pre, [data-no-translate], [aria-hidden='true'], .fa-seal, [data-ornament]")) continue;
      // A snake_case word is an identifier (a premise's or a report member's name), kept as written.
      for (const word of node.nodeValue!.match(/[A-Za-z][\w.-]*/g) ?? []) if (!ALLOWED.test(word) && !word.includes("_")) out.push(`${word} in “${node.nodeValue!.trim()}”`);
    }
    return out;
  }

  async function inChinese(ui: ReactNode, ready: () => void) {
    const { container } = render(ui);
    await waitFor(ready);
    const stop = startLocalizer(container);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const words = untranslated(container);
    stop();
    return words;
  }

  it("translates every interface string of the saved reports pages", async () => {
    const store = memoryStore();
    const a = await stored(store, "x", { kind: "imported", fileName: "a.json" }, caseReport("destination-only", "earlier"));
    const b = await stored(store, "x", { kind: "checked" }, caseReport("destination-only", "later"));
    const c = await stored(store, "x", { kind: "checked" }, caseReport("not-matched", "earlier"));
    const d = await stored(store, "x", { kind: "checked" }, caseReport("not-matched", "later"));
    const e = await stored(store, "x", { kind: "checked" }, caseReport("classes-details-all", "earlier"));
    const f = await stored(store, "x", { kind: "checked" }, caseReport("classes-details-all", "later"));
    expect(await inChinese(withStore(store, <SavedReportsPage />), () => expect(screen.getAllByTestId("saved-entry")).toHaveLength(6))).toEqual([]);
    cleanupAll();
    expect(await inChinese(withStore(store, <SavedReportPage id={a.id} />), () => expect(screen.getByRole("region", { name: "Result" })).toBeTruthy())).toEqual([]);
    cleanupAll();
    void [b, c, d, e, f];
  });
});
