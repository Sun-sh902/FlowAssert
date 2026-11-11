/**
 * The README's screenshots of the CSV check page (docs/readme/check-*.png, and docs/readme/zh/ for the Chinese
 * interface) and of the standalone HTML report (docs/readme/html-report-*.png). They are written only when asked for:
 *
 *   FA_README_SCREENS=1 npx playwright test e2e/readme-screens.spec.ts --project chrome
 *
 * Every value shown comes from offline/examples/ and offline/golden/rules-fail/, which are synthetic.
 */
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { EXAMPLE, GOLDEN, REPO, check, openCheck, type Locale } from "./check-helpers.ts";

const OUT = join(REPO, "docs", "readme");
const where = (locale: Locale, name: string) => join(OUT, ...(locale === "zh-CN" ? ["zh"] : []), name);

for (const locale of ["en", "zh-CN"] as const) {
  test(`README screenshots of the CSV check · ${locale}`, async ({ page }) => {
    test.skip(!process.env.FA_README_SCREENS, "set FA_README_SCREENS=1 to write the README's screenshots");
    await page.setViewportSize({ width: 1280, height: 900 });
    await openCheck(page, "/#/check", locale);

    // The files, profiled, and what a check would do with a total that contradicts the export (issue #2).
    await page.getByTestId("source-file").setInputFiles(EXAMPLE.source);
    await page.getByTestId("destination-file").setInputFiles(EXAMPLE.destination);
    await expect(page.getByTestId("destination-profile")).toHaveAttribute("data-rows", "4");
    await page.getByTestId("key-source").selectOption("external_id");
    await page.getByTestId("key-destination").selectOption("external_id");
    await page.getByTestId("field-0-source").selectOption("phone");
    await page.getByTestId("field-0-destination").selectOption("phone");
    await page.getByTestId("destination-complete").check();
    await page.getByTestId("destination-count").fill("5");
    await expect(page.locator('[data-warning="destination-count"]')).toBeVisible();
    await page.locator("details").evaluateAll((all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
    await page.waitForTimeout(300);
    await page.locator('section[aria-labelledby="files-h"]').screenshot({ path: where(locale, "check-files.png") });
    await page.locator('section[aria-labelledby="premises-form-h"]').screenshot({ path: where(locale, "check-before.png") });

    // A result explored: a record whose fields failed, with the characters that differ.
    const folder = join(GOLDEN, "rules-fail");
    await page.goto("about:blank");
    await openCheck(page, "/#/check", locale);
    await check(page, { source: join(folder, "source.csv"), destination: join(folder, "destination.csv"), config: join(folder, "config.json"), sourceComplete: true, destinationComplete: true });
    const region = page.locator("[data-result]");
    await region.waitFor();
    await region.getByRole("listbox").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(region.getByTestId("record-panel")).toHaveAttribute("data-record-row", "2");
    await page.waitForTimeout(400);
    await page.locator('section[aria-labelledby="explore-h"]').screenshot({ path: where(locale, "check-explorer.png") });
  });
}

test("README screenshots of the HTML report", async ({ browser }) => {
  test.skip(!process.env.FA_README_SCREENS, "set FA_README_SCREENS=1 to write the README's screenshots");
  for (const scheme of ["light", "dark"] as const) {
    const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 1100, height: 1500 } });
    await page.goto("file://" + join(GOLDEN, "rules-fail", "report.html"));
    await page.screenshot({ path: join(OUT, `html-report-${scheme}.png`) });
    await page.close();
  }
});
