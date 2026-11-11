/**
 * The CSV check page in Chrome, on the production build: a full check of the example files in English and in
 * Chinese, at desktop width and at 375 px, with the command line's summary and reports byte for byte; no request from
 * choosing the files to downloading both reports, and nothing of the files left in storage or the address (no report
 * is kept unless "Keep" is pressed: e2e/saved-reports.spec.ts); the refusals; and the axe audit of the existing suites.
 */
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { EXAMPLE, GOLDEN, anyTime, asBrowser, audit, check, download, expectNoNetwork, golden, openCheck, recordRequests, storedState, type Locale } from "./check-helpers.ts";
import { writeReport } from "./helpers.ts";

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 375, height: 812 } } as const;
const LOCALES: Locale[] = ["en", "zh-CN"];
/** Text of the example files that must never be kept by the browser. */
const FILE_TEXT = ["SYN-002", "+1 212 555 0199", "grace@example.test", "edsger.2@example.test", "external_id,phone"];

async function result(page: Page) {
  const region = page.locator("[data-result]");
  await region.waitFor({ timeout: 30_000 });
  return region;
}

for (const locale of LOCALES) {
  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    test(`full check of the example files · ${locale} · ${width}`, async ({ page, context }) => {
      await page.setViewportSize(viewport);
      await openCheck(page, "/#/check", locale);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(locale === "en" ? "CSV check" : "CSV 核对");
      const before = page.url();
      const requests = recordRequests(context);

      await check(page, EXAMPLE);
      const region = await result(page);
      await expect(region).toHaveAttribute("data-result", "Mismatch");
      // The printed summary is the command line's, character for character, in both languages.
      expect(await page.getByTestId("summary").textContent()).toBe(golden("example-page", "stdout.txt"));
      const json = await download(page, "download-json");
      const html = await download(page, "download-html");
      requests.stop();

      expectNoNetwork(page, requests);
      expect([json.name, html.name]).toEqual(["flowassert-report.json", "flowassert-report.html"]);
      expect(anyTime(json.text)).toBe(anyTime(asBrowser(golden("example-page", "report.json"))));
      expect(anyTime(html.text)).toBe(anyTime(asBrowser(golden("example-page", "report.html"))));

      // Every stated premise is beside the result, and only Verified is ever styled as Verified.
      for (const name of ["source_complete", "destination_complete", "source_count", "destination_count"]) {
        await expect(region.locator(`[data-premise="${name}"]`)).toContainText("browser form");
      }
      await expect(region.locator('.fa-seal[data-s="Verified"]')).toHaveCount(0);
      // Nothing of the files or the statements is kept, and the address is unchanged. "Keep this report in this
      // browser" is offered and not pressed, so no report is kept either: there is no IndexedDB database at all.
      await expect(page.getByTestId("keep-report")).toBeEnabled();
      const stored = await storedState(page);
      expect(stored.session).toEqual([]);
      expect(stored.cookie).toBe("");
      expect(stored.indexedDB).toEqual([]);
      expect(stored.url).toBe(before);
      expect(stored.local.map(([k]) => k).every((k) => k.startsWith("flowassert."))).toBe(true);
      for (const text of FILE_TEXT) expect(JSON.stringify(stored)).not.toContain(text);
      // No horizontal page scroll at any width.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}

test("reports for unsafe values are the golden files, byte for byte", async ({ page }) => {
  await openCheck(page);
  const folder = join(GOLDEN, "unsafe-values");
  await check(page, {
    source: join(folder, "source.csv"),
    destination: join(folder, "destination.csv"),
    config: join(folder, "config.json"),
    sourceComplete: true,
    destinationComplete: true,
  });
  await result(page);
  expect(await page.getByTestId("summary").textContent()).toBe(golden("unsafe-values", "stdout.txt"));
  expect(anyTime((await download(page, "download-json")).text)).toBe(anyTime(asBrowser(golden("unsafe-values", "report.json"))));
  expect(anyTime((await download(page, "download-html")).text)).toBe(anyTime(asBrowser(golden("unsafe-values", "report.html"))));
  // Values from the files are shown, escaped, and a script in them never runs.
  expect(await page.evaluate(() => (window as unknown as { alerted?: boolean }).alerted)).toBeUndefined();
});

test.describe("refusals", () => {
  test("a malformed CSV is refused and no result is shown", async ({ page }) => {
    await openCheck(page);
    const folder = join(GOLDEN, "refused-unexpected-end");
    await check(page, { source: join(folder, "source.csv"), destination: join(folder, "destination.csv"), key: ["k", "k"], fields: [["p", "p"]] });
    await expect(page.getByTestId("refusal")).toContainText(golden("refused-unexpected-end", "stderr.txt").replace(/^refused: /, "").trim());
    await expect(page.locator("[data-result]")).toHaveCount(0);
  });

  test("a file in another encoding is refused, naming the file and the encoding", async ({ page }) => {
    await openCheck(page);
    const folder = join(GOLDEN, "decode-wrong-encoding");
    await page.getByTestId("source-file").setInputFiles(join(folder, "source.csv"));
    // The header still reads; the full read refuses the file, as the command line does.
    await page.getByTestId("destination-file").setInputFiles(join(folder, "destination.csv"));
    await expect(page.getByText("source.csv: not UTF-8")).toBeVisible();
    await expect(page.getByTestId("run-check")).toBeDisabled();
    // In its own encoding it reads.
    await page.getByTestId("source-encoding").selectOption("gb18030");
    await expect(page.getByText("source.csv: not UTF-8")).toHaveCount(0);
  });

  test("a configuration that states completeness is refused", async ({ page }) => {
    await openCheck(page);
    await page.getByTestId("config-file").setInputFiles(join(GOLDEN, "refused-config-premise", "config.json"));
    await expect(page.getByText(golden("refused-config-premise", "stderr.txt").replace(/^refused: /, "").trim())).toBeVisible();
    await expect(page.getByTestId("key-source")).toHaveValue("");
  });
});

test("the sample files download as offline/examples has them, from this page", async ({ page, context }) => {
  await openCheck(page);
  const requests = recordRequests(context);
  expect((await download(page, "sample-source")).text).toBe((await import("node:fs")).readFileSync(join(EXAMPLE.source), "utf-8"));
  expect((await download(page, "sample-destination")).text).toBe((await import("node:fs")).readFileSync(join(EXAMPLE.destination), "utf-8"));
  requests.stop();
  expectNoNetwork(page, requests);
});

test("cancelling a check shows no result", async ({ page }) => {
  await openCheck(page);
  // A source large enough to still be reading when Cancel is pressed.
  const rows = Array.from({ length: 400_000 }, (_, i) => `K${i},${i}`).join("\n");
  await page.getByTestId("source-file").setInputFiles({ name: "big.csv", mimeType: "text/csv", buffer: Buffer.from("k,p\n" + rows + "\n") });
  await page.getByTestId("destination-file").setInputFiles({ name: "d.csv", mimeType: "text/csv", buffer: Buffer.from("k,p\nK1,1\n") });
  await expect(page.getByTestId("key-source").locator("option").nth(1)).toBeAttached();
  await page.getByTestId("key-source").selectOption("k");
  await page.getByTestId("key-destination").selectOption("k");
  await page.getByTestId("field-0-source").selectOption("p");
  await page.getByTestId("field-0-destination").selectOption("p");
  await page.getByTestId("run-check").click();
  await page.getByTestId("cancel-check").click();
  await expect(page.getByTestId("run-status")).toContainText("Cancelled");
  await page.waitForTimeout(3000);
  await expect(page.locator("[data-result]")).toHaveCount(0);
  // The next check runs in the fresh worker.
  await page.getByTestId("destination-file").setInputFiles({ name: "d.csv", mimeType: "text/csv", buffer: Buffer.from("k,p\nK1,1\nK2,2\n") });
  await page.getByTestId("run-check").click();
  await result(page);
});

for (const theme of ["light", "dark"] as const) {
  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    test(`axe · ${theme} · ${width} · CSV check with a result`, async ({ page, browserName }) => {
      await page.addInitScript((t) => localStorage.setItem("flowassert.theme", t), theme);
      await page.setViewportSize(viewport);
      await openCheck(page);
      expect(await audit(page)).toEqual([]);
      await check(page, { ...EXAMPLE, fields: [["phone", "phone", "digits"], ["email", "hs_email", "casefold"]], sourceComplete: false });
      await result(page);
      await page.waitForTimeout(400); // let fade-ins finish so contrast is measured at rest
      const violations = await audit(page);
      writeReport(`axe-${browserName}-${theme}-${width}-check`, violations);
      expect(violations).toEqual([]);
    });
  }
}

/** Nothing on the page is wider than the window. */
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const locale of LOCALES) {
  for (const theme of ["light", "dark"] as const) {
    for (const [width, viewport] of Object.entries(VIEWPORTS)) {
      test(`axe · ${theme} · ${width} · ${locale} · a dropped file, file profiles, a profile refusal and the lines before a check`, async ({ page, context, browserName }) => {
        await page.addInitScript((t) => localStorage.setItem("flowassert.theme", t), theme);
        await page.setViewportSize(viewport);
        await openCheck(page, "/#/check", locale);
        const requests = recordRequests(context);

        // A file dragged over a panel, then dropped on it.
        const dragged = await page.evaluateHandle(() => {
          const d = new DataTransfer();
          d.items.add(new File(["external_id,phone\nSYN-901,+1 212 555 0901\n"], "dragged.csv", { type: "text/csv" }));
          return d;
        });
        await page.getByTestId("source-panel").dispatchEvent("dragenter", { dataTransfer: dragged });
        await expect(page.getByTestId("source-drop-here")).toBeVisible();
        expect(await audit(page)).toEqual([]);
        await page.getByTestId("source-panel").dispatchEvent("drop", { dataTransfer: dragged });
        await expect(page.getByTestId("source-drop-here")).toHaveCount(0);
        await expect(page.getByTestId("source-profile")).toHaveAttribute("data-rows", "1");

        // The example files, profiled; a stated total that differs from the export (issue #2).
        await page.getByTestId("source-file").setInputFiles(EXAMPLE.source);
        await page.getByTestId("destination-file").setInputFiles(EXAMPLE.destination);
        await expect(page.getByTestId("source-profile")).toHaveAttribute("data-rows", "4");
        await expect(page.getByTestId("destination-profile")).toHaveAttribute("data-rows", "4");
        await page.getByTestId("key-source").selectOption("external_id");
        await page.getByTestId("key-destination").selectOption("external_id");
        await page.getByTestId("destination-complete").check();
        await page.getByTestId("destination-count").fill("5");
        await expect(page.locator('[data-warning="destination-count"]')).toBeVisible();
        await expect(page.locator('[data-warning="destination-repeated-key"]')).toBeVisible();
        await page.locator("details").evaluateAll((all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
        await page.waitForTimeout(400);
        let violations = await audit(page);
        writeReport(`axe-${browserName}-${theme}-${width}-${locale}-profiles`, violations);
        expect(violations).toEqual([]);
        expect(await noSideways(page)).toBe(true);

        // A destination file the check would refuse: the profile says so, with the hint, before any check.
        await page.getByTestId("destination-file").setInputFiles({ name: "refused.csv", mimeType: "text/csv", buffer: Buffer.from("external_id,phone\nSYN-001,1,extra\n") });
        await expect(page.getByTestId("destination-profile-refused")).toContainText("refused.csv: line 2 does not match the header");
        await expect(page.getByTestId("refusal-hint")).toBeVisible();
        await page.waitForTimeout(400);
        violations = await audit(page);
        writeReport(`axe-${browserName}-${theme}-${width}-${locale}-profile-refused`, violations);
        expect(violations).toEqual([]);
        expect(await noSideways(page)).toBe(true);
        expectNoNetwork(page, requests);
      });
    }
  }
}

for (const locale of LOCALES) {
  for (const theme of ["light", "dark"] as const) {
    for (const [width, viewport] of Object.entries(VIEWPORTS)) {
      test(`axe · ${theme} · ${width} · ${locale} · the result explorer, a record and the character diff`, async ({ page, context, browserName }) => {
        await page.addInitScript((t) => localStorage.setItem("flowassert.theme", t), theme);
        await page.setViewportSize(viewport);
        await openCheck(page, "/#/check", locale);
        const requests = recordRequests(context);
        const folder = join(GOLDEN, "rules-fail");
        await check(page, { source: join(folder, "source.csv"), destination: join(folder, "destination.csv"), config: join(folder, "config.json"), sourceComplete: true, destinationComplete: true });
        const region = await result(page);
        // The explorer opens on the records that are not Verified; the first is chosen by keyboard.
        await expect(region.getByTestId("explorer-count")).toHaveAttribute("data-matches", /^[1-9]/);
        const list = region.getByRole("listbox");
        await list.focus();
        await page.keyboard.press("ArrowDown");
        const panel = region.getByTestId("record-panel");
        await expect(panel).toHaveAttribute("data-record-row", "1");
        await expect(panel.getByTestId("value-diff")).toHaveCount(6);
        await page.waitForTimeout(400);
        let violations = await audit(page);
        writeReport(`axe-${browserName}-${theme}-${width}-${locale}-explorer`, violations);
        expect(violations).toEqual([]);
        expect(await noSideways(page)).toBe(true);
        // A filter that matches nothing.
        await region.getByTestId("explorer-state").selectOption("Verified");
        await region.getByTestId("explorer-rule").selectOption({ index: 3 });
        await region.getByTestId("explorer-status").selectOption("fail");
        await expect(region.getByTestId("explorer-empty")).toBeVisible();
        violations = await audit(page);
        writeReport(`axe-${browserName}-${theme}-${width}-${locale}-explorer-empty`, violations);
        expect(violations).toEqual([]);
        expect(await noSideways(page)).toBe(true);
        // The address holds the view, never a key or a value.
        expect(page.url()).toMatch(/#\/check\?state=Verified&rule=f1&result=fail$/);
        expectNoNetwork(page, requests);
      });
    }
  }
}
