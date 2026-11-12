/**
 * The README's screenshots of the CSV check page (docs/readme/check-*.png), with a workbook and the records to fix
 * (1.1.0), and of the standalone HTML report (docs/readme/html-report-*.png). They are written only when asked for:
 *
 *   FA_README_SCREENS=1 npx playwright test e2e/readme-screens.spec.ts --project chrome
 *
 * Every value shown comes from offline/examples/, offline/golden/rules-fail/ and offline/golden-xlsx/, which are synthetic.
 */
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { EXAMPLE, GOLDEN, GOLDEN_XLSX, REPO, check, openCheck } from "./check-helpers.ts";

const OUT = join(REPO, "docs", "readme");
const where = (name: string) => join(OUT, name);

test("README screenshots of the CSV check", async ({ page }) => {
  test.skip(!process.env.FA_README_SCREENS, "set FA_README_SCREENS=1 to write the README's screenshots");
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCheck(page, "/#/check");

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
  await page.locator('section[aria-labelledby="files-h"]').screenshot({ path: where("check-files.png") });
  await page.locator('section[aria-labelledby="premises-form-h"]').screenshot({ path: where("check-before.png") });

  // A result explored: a record whose fields failed, with the characters that differ.
  const folder = join(GOLDEN, "rules-fail");
  await page.goto("about:blank");
  await openCheck(page, "/#/check");
  await check(page, { source: join(folder, "source.csv"), destination: join(folder, "destination.csv"), config: join(folder, "config.json"), sourceComplete: true, destinationComplete: true });
  const region = page.locator("[data-result]");
  await region.waitFor();
  await region.getByRole("listbox").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(region.getByTestId("record-panel")).toHaveAttribute("data-record-row", "2");
  await page.waitForTimeout(400);
  await page.locator('section[aria-labelledby="explore-h"]').screenshot({ path: where("check-explorer.png") });
});

test("README screenshots of a workbook and the records to fix", async ({ page }) => {
  test.skip(!process.env.FA_README_SCREENS, "set FA_README_SCREENS=1 to write the README's screenshots");
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCheck(page, "/#/check");

  // A workbook with three sheets: the worksheet chosen, and its profile.
  await page.getByTestId("source-file").setInputFiles(join(GOLDEN_XLSX, "xlsx-refused-several-sheets", "source.xlsx"));
  await page.getByTestId("source-worksheet-1").check();
  await expect(page.getByTestId("source-profile")).toHaveAttribute("data-rows", "4");
  await page.waitForTimeout(300);
  await page.getByTestId("source-panel").screenshot({ path: where("check-worksheet.png") });

  // A workbook with every kind of cell: what was read as a number, a date, a formula.
  await page.goto("about:blank");
  await openCheck(page, "/#/check");
  await page.getByTestId("source-file").setInputFiles(join(GOLDEN_XLSX, "xlsx-cell-forms", "source.xlsx"));
  await page.getByTestId("source-profile").waitFor();
  await page.locator("details").evaluateAll((all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
  await page.waitForTimeout(300);
  await page.getByTestId("source-profile").screenshot({ path: where("check-workbook-profile.png") });

  // The records to fix of the example files, the destination not stated complete.
  await page.goto("about:blank");
  await openCheck(page, "/#/check");
  await check(page, { ...EXAMPLE, destinationComplete: false });
  const section = page.getByTestId("records-to-resend");
  await section.waitFor();
  await page.waitForTimeout(400);
  await section.screenshot({ path: where("check-export.png") });
});

test("README screenshots of the HTML report", async ({ browser }) => {
  test.skip(!process.env.FA_README_SCREENS, "set FA_README_SCREENS=1 to write the README's screenshots");
  for (const scheme of ["light", "dark"] as const) {
    const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 1100, height: 1500 } });
    await page.goto("file://" + join(GOLDEN, "rules-fail", "report.html"));
    await page.screenshot({ path: join(OUT, `html-report-${scheme}.png`) });
    await page.close();
  }
});
