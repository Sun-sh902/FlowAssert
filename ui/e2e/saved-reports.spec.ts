/**
 * Saved reports and comparing two reports (v0.5.0) in Chrome, on the production build, with the real IndexedDB: a
 * report is kept only when "Keep" is pressed and is found in the list with its original bytes; every kind of golden
 * report imports, and a file that is not a report is refused with nothing stored; two reports with different premises
 * show the difference before any count, and a pair that is not comparable is refused; deleting one and deleting all
 * leave the database empty, then gone; blocked storage refuses saving while the check still works; no request is made
 * by any of it; and the axe audit of the new pages in both themes, at desktop and phone width.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { EXAMPLE, GOLDEN, audit, check, download, expectNoNetwork, openCheck, recordRequests, storedState } from "./check-helpers.ts";
import { writeReport } from "./helpers.ts";

const DATABASE = "flowassert-saved-reports";
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 375, height: 812 } } as const;
const CASES = join(process.cwd(), "src/test/offline/comparison-cases");
const GOLDEN_REPORTS = readdirSync(GOLDEN).filter((n) => existsSync(join(GOLDEN, n, "report.json"))).sort();

/**
 * No request, as expectNoNetwork requires, apart from the tab icon: in the production build Chrome fetches
 * /favicon.svg again on its own after a navigation inside the page. It carries nothing of the page; the Pages build
 * writes its icon into the page and is held to no request at all (e2e/check-pages.spec.ts).
 */
function expectNoRequest(page: Page, requests: { urls: string[]; local: string[] }) {
  expectNoNetwork(page, { urls: requests.urls.filter((u) => new URL(u).pathname !== "/favicon.svg"), local: requests.local });
}

/** One report of a shared comparison case, as a file to choose. */
function caseFile(name: string, side: "earlier" | "later") {
  const value = (JSON.parse(readFileSync(join(CASES, `${name}.json`), "utf-8")) as Record<string, { report: unknown }>)[side]!.report;
  return { name: `${name}-${side}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value, null, 2)) };
}

/** Open the saved reports page and let it load everything it needs, as openCheck does for the CSV check. */
async function openSaved(page: Page, url = "/#/check/reports") {
  await page.goto("about:blank");
  const icon = page.waitForResponse((r) => r.url().endsWith("/favicon.svg"), { timeout: 5000 }).catch(() => null);
  await page.goto(url);
  await page.getByRole("heading", { level: 1, name: "Saved reports" }).waitFor();
  await page.waitForFunction(() => [...document.fonts].every((f) => f.status === "loaded" || f.status === "error"));
  if (!(await page.locator('link[rel="icon"]').getAttribute("href"))?.startsWith("data:")) await icon;
  await page.waitForLoadState("networkidle");
}

/** The saved entries, read straight from IndexedDB; null when the database does not exist. */
const databaseEntries = (page: Page) =>
  page.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some((d) => d.name === name)) return null;
    return new Promise<number[]>((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(["entries", "bytes"]);
        const counts: number[] = [];
        tx.objectStore("entries").count().onsuccess = (e) => counts.push((e.target as IDBRequest<number>).result);
        tx.objectStore("bytes").count().onsuccess = (e) => counts.push((e.target as IDBRequest<number>).result);
        tx.oncomplete = () => (db.close(), resolve(counts));
      };
    });
  }, DATABASE);

async function importFiles(page: Page, files: (string | { name: string; mimeType: string; buffer: Buffer })[]) {
  for (const file of files) {
    const before = await page.getByTestId("saved-entry").count();
    await page.getByTestId("import-file").setInputFiles(file);
    await expect(page.getByTestId("saved-entry")).toHaveCount(before + 1);
  }
}

async function compareFirstTwo(page: Page) {
  await page.getByTestId("choose-entry").nth(0).check();
  await page.getByTestId("choose-entry").nth(1).check();
  await page.getByTestId("compare-chosen").click();
  await page.locator('[data-testid="before-counts"], [data-testid="not-comparable"]').first().waitFor();
}

test("a report is kept only when Keep is pressed, and is found in the list with its original bytes", async ({ page, context }) => {
  await openCheck(page);
  const requests = recordRequests(context);
  await check(page, EXAMPLE);
  await page.locator("[data-result]").waitFor({ timeout: 30_000 });
  const json = await download(page, "download-json");
  // The result is shown and the report downloaded: still nothing is stored.
  expect((await storedState(page)).indexedDB).toEqual([]);
  await page.getByTestId("keep-report").click();
  await expect(page.getByTestId("keep-status")).toHaveText("This report is kept in this browser. Open saved reports");
  await expect(page.getByTestId("keep-report")).toBeDisabled();
  expect(await databaseEntries(page)).toEqual([1, 1]);
  await page.getByTestId("keep-status").getByRole("link", { name: "Open saved reports" }).click();
  await expect(page.getByTestId("saved-entry")).toHaveCount(1);
  const entry = page.getByTestId("saved-entry");
  await expect(entry).toContainText("Checked in this browser");
  await expect(entry.locator('[data-count="Mismatch"]')).toHaveText("3");
  expect((await download(page, "download-entry")).text).toBe(json.text);
  await entry.getByTestId("open-entry").click();
  const result = page.locator("[data-result]");
  await expect(result).toHaveAttribute("data-result", "Mismatch");
  await expect(result.locator('[data-premise="source_complete"]')).toContainText("browser form");
  expect((await download(page, "download-saved")).text).toBe(json.text);
  requests.stop();
  expectNoRequest(page, requests);
  // The files themselves are never stored: only the report, whose bytes are the downloaded report's.
  const stored = await storedState(page);
  expect(stored.session).toEqual([]);
  expect(stored.indexedDB).toEqual([DATABASE]);
});

test("every kind of golden report imports, and opens as it was written", async ({ page, context }) => {
  test.setTimeout(120_000);
  await openSaved(page);
  const requests = recordRequests(context);
  await importFiles(page, GOLDEN_REPORTS.map((n) => join(GOLDEN, n, "report.json")));
  await expect(page.getByTestId("storage-use")).toHaveText(new RegExp(`^${GOLDEN_REPORTS.length} reports, \\d+ bytes\\.$`));
  expect(await databaseEntries(page)).toEqual([GOLDEN_REPORTS.length, GOLDEN_REPORTS.length]);
  // Every entry is imported, and says it is not authenticated.
  await expect(page.locator('[data-provenance="imported"]')).toHaveCount(GOLDEN_REPORTS.length);
  // Open a redacted report with details all, then download it.
  const redacted = readFileSync(join(GOLDEN, "rules-redacted", "report.json"));
  await page.getByTestId("import-file").setInputFiles({ name: "redacted-details-all.json", mimeType: "application/json", buffer: redacted });
  const entry = page.getByTestId("saved-entry").filter({ hasText: "redacted-details-all.json" });
  await expect(entry).toContainText("yes: keys and values are not in the report");
  await entry.getByTestId("open-entry").click();
  await expect(page.locator("[data-result]")).toHaveAttribute("data-result", "Mismatch");
  await expect(page.locator("[data-record]")).toHaveCount(3);
  expect((await download(page, "download-saved")).text).toBe(readFileSync(join(GOLDEN, "rules-redacted", "report.json"), "utf-8"));
  requests.stop();
  expectNoRequest(page, requests);
});

test("a file that is not a valid report is refused, and nothing is stored", async ({ page, context }) => {
  await openSaved(page);
  const requests = recordRequests(context);
  const edited = JSON.parse(readFileSync(join(GOLDEN, "rules-pass", "report.json"), "utf-8")) as { claim: string | null };
  edited.claim = null;
  await page.getByTestId("import-file").setInputFiles({ name: "edited.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(edited)) });
  await expect(page.getByTestId("saved-message")).toHaveText(
    "Refused, and nothing was kept: the file is not a valid FlowAssert report. edited.json: cohort_state is Verified, but claim is null",
  );
  await page.getByTestId("import-file").setInputFiles(join(GOLDEN, "rules-pass", "config.json"));
  await expect(page.getByTestId("saved-message")).toContainText("config.json: schema_version is missing");
  await expect(page.getByTestId("no-saved-reports")).toBeVisible();
  requests.stop();
  expectNoRequest(page, requests);
  // Refused before storage: not even the database was created.
  expect((await storedState(page)).indexedDB).toEqual([]);
});

test("two reports with different premises: the premise difference comes before any count", async ({ page, context }) => {
  await openSaved(page);
  const requests = recordRequests(context);
  await importFiles(page, [caseFile("premise-flags-differ", "later"), caseFile("premise-flags-differ", "earlier")]);
  await compareFirstTwo(page);
  // Ordered by evaluated_at, whichever was chosen first.
  await expect(page.locator('[data-report="earlier"]')).toContainText("2026-11-01T09:30:00Z");
  await expect(page.locator('[data-report="later"]')).toContainText("2026-11-02T09:30:00Z");
  const differences = page.getByTestId("premise-differences");
  await expect(differences).toContainText("The two reports state different premises");
  const premiseTop = (await differences.boundingBox())!.y;
  for (const count of await page.locator("[data-count], [data-class-count]").all()) expect((await count.boundingBox())!.y).toBeGreaterThan(premiseTop);
  await expect(page.locator('[data-class-count="stopped-problem"]')).toHaveText("1");
  await expect(page.locator('[data-class="stopped-problem"] [data-key="K1"]')).toContainText("Verified");
  // Swapping says the order is reversed.
  await page.getByTestId("swap").click();
  await expect(page.getByTestId("order-reversed")).toBeVisible();
  expect(await page.locator("main").textContent()).not.toMatch(/\b(fix(ed|es)?|improv\w*|resolv\w*|correct\w*|better|worse)\b/i);
  requests.stop();
  expectNoRequest(page, requests);
});

test("a pair that is not comparable is refused with the reason, and no comparison is shown", async ({ page, context }) => {
  await openSaved(page);
  const requests = recordRequests(context);
  await importFiles(page, [caseFile("refused-different-key", "earlier"), caseFile("refused-different-key", "later")]);
  await compareFirstTwo(page);
  const refusal = page.getByTestId("not-comparable");
  await expect(refusal).toContainText("These two reports cannot be compared, so no comparison is shown.");
  await expect(refusal.locator('[data-reason="different-key"]')).toContainText("The key columns differ.");
  await expect(page.getByTestId("before-counts")).toHaveCount(0);
  await expect(page.locator("[data-class-count]")).toHaveCount(0);
  requests.stop();
  expectNoRequest(page, requests);
});

test("deleting one and deleting all leave nothing: the database is empty, then gone", async ({ page, context }) => {
  await openSaved(page);
  const requests = recordRequests(context);
  await importFiles(page, [join(GOLDEN, "example", "report.json"), join(GOLDEN, "rules-pass", "report.json"), join(GOLDEN, "scope-exact-cli", "report.json")]);
  await page.getByTestId("saved-entry").first().getByTestId("delete-entry").click();
  await expect(page.getByTestId("saved-entry")).toHaveCount(2);
  expect(await databaseEntries(page)).toEqual([2, 2]);
  // Opening one and deleting it there.
  await page.getByTestId("saved-entry").first().getByTestId("open-entry").click();
  await page.getByTestId("delete-saved").click();
  await expect(page.getByTestId("no-such-report")).toHaveText("The report was deleted from this browser.");
  expect(await databaseEntries(page)).toEqual([1, 1]);
  await page.goto("/#/check/reports");
  await page.getByTestId("delete-all").click();
  await expect(page.getByText("Delete the 1 saved report from this browser? This cannot be undone.")).toBeVisible();
  await page.getByTestId("confirm-delete-all").click();
  await expect(page.getByTestId("no-saved-reports")).toBeVisible();
  expect(await databaseEntries(page)).toBeNull();
  expect((await storedState(page)).indexedDB).toEqual([]);
  requests.stop();
  expectNoRequest(page, requests);
  // Reading the empty list again, after a reload, does not create the database.
  await page.reload();
  await expect(page.getByTestId("no-saved-reports")).toBeVisible();
  expect((await storedState(page)).indexedDB).toEqual([]);
});

test("with storage blocked, saving is refused with the reason and the check still works", async ({ page, context }) => {
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException("The user denied permission to access the database.", "SecurityError");
    };
    Object.defineProperty(IDBFactory.prototype, "open", { value: blocked });
    Object.defineProperty(IDBFactory.prototype, "databases", { value: () => Promise.reject(new DOMException("The user denied permission to access the database.", "SecurityError")) });
  });
  await openCheck(page);
  const requests = recordRequests(context);
  await check(page, EXAMPLE);
  await page.locator("[data-result]").waitFor({ timeout: 30_000 });
  await page.getByTestId("keep-report").click();
  await expect(page.getByTestId("keep-refused")).toHaveText(
    "The report was not kept. This browser blocks storage for this page. (SecurityError: The user denied permission to access the database.) The result on this page is unchanged.",
  );
  // The check is untouched: its result and reports are all there.
  await expect(page.locator("[data-result]")).toHaveAttribute("data-result", "Mismatch");
  expect((await download(page, "download-json")).name).toBe("flowassert-report.json");
  await page.getByTestId("open-saved-reports").click();
  await expect(page.getByTestId("storage-unavailable")).toContainText("Saved reports are not available in this browser. This browser blocks storage for this page.");
  requests.stop();
  expectNoRequest(page, requests);
});

test("the comparison page at phone width, without horizontal scroll", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.phone);
  await page.goto("/#/check/reports");
  await page.getByRole("heading", { level: 1, name: "Saved reports" }).waitFor();
  await importFiles(page, [caseFile("classes-details-all", "earlier"), caseFile("classes-details-all", "later")]);
  await compareFirstTwo(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Comparing two reports");
  await expect(page.locator('[data-class="became-problem"] h3')).toHaveText("Became a problem (1)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const theme of ["light", "dark"] as const) {
  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    test(`axe · ${theme} · ${width} · saved reports, a saved report and a comparison`, async ({ page, browserName }) => {
      await page.addInitScript((t) => localStorage.setItem("flowassert.theme", t), theme);
      await page.setViewportSize(viewport);
      await openSaved(page);
      const problems: string[] = [];
      const record = async (name: string) => {
        // At the top of the page, as the other audits run: scrolled, the shell's "What's real?" button passes under
        // the sticky phone header, which axe reports as a small target on every page.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(400); // let fade-ins finish so contrast is measured at rest
        for (const v of await audit(page)) problems.push(`${name}: ${v}`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: no horizontal scroll`).toBe(true);
      };
      await record("empty list");
      await importFiles(page, [caseFile("destination-only", "earlier"), caseFile("destination-only", "later"), caseFile("not-matched", "earlier"), join(GOLDEN, "unsafe-values-details-all", "report.json")]);
      await page.getByTestId("delete-all").click();
      await record("list, delete all asked");
      await page.getByRole("button", { name: "Keep them" }).click();
      const entry = (name: string) => page.getByTestId("saved-entry").filter({ hasText: name });
      await entry("destination-only-earlier.json").getByTestId("open-entry").click();
      await page.locator("[data-result]").waitFor();
      await record("saved report");
      await page.goBack();
      await entry("destination-only-earlier.json").getByTestId("choose-entry").check();
      await entry("destination-only-later.json").getByTestId("choose-entry").check();
      await page.getByTestId("compare-chosen").click();
      await page.getByTestId("before-counts").waitFor();
      await record("comparison");
      // Back on the list nothing is chosen: a choice is never remembered.
      await page.goBack();
      await entry("destination-only-later.json").getByTestId("choose-entry").check();
      await entry("not-matched-earlier.json").getByTestId("choose-entry").check();
      await page.getByTestId("compare-chosen").click();
      await page.getByTestId("not-comparable").waitFor();
      await record("refused comparison");
      writeReport(`axe-${browserName}-${theme}-${width}-saved-reports`, problems);
      expect(problems).toEqual([]);
    });
  }
}
