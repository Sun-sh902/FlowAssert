/**
 * The CSV check page in Chrome, on the production build: a full check of the example files in English and in
 * Chinese, at desktop width and at 375 px, with the command line's summary and reports byte for byte; no request from
 * choosing the files to downloading both reports, and nothing of the files left in storage or the address; the
 * refusals; and the axe audit of the existing suites.
 */
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { EXAMPLE, GOLDEN, anyTime, asBrowser, check, download, expectNoNetwork, golden, openCheck, recordRequests, storedState, type Locale } from "./check-helpers.ts";
import { AXE_PATH, writeReport } from "./helpers.ts";

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
      // Nothing of the files or the statements is kept, and the address is unchanged.
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

interface AxeResult {
  violations: { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }[];
}

async function audit(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE_PATH });
  const result = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<AxeResult> } }).axe;
    const r = await axe.run({ exclude: [["[data-ornament]"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] }, resultTypes: ["violations"] });
    return { violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target })) })) };
  });
  return result.violations.map((v) => `${v.impact} ${v.id} ×${v.nodes.length}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

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
