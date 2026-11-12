/**
 * An .xlsx workbook on the CSV check page (docs/design/1.1-excel.md, "The browser"): chosen by button or dropped, its
 * worksheets listed with their sizes, one chosen by keyboard, profiled before the check, refused when it cannot be
 * read with certainty, and checked with the summary the command line prints for the same rows. Every state passes
 * axe in light and dark, at desktop and phone width, with nothing wider than the window, and the page makes no
 * request from choosing the files to the result.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { EXAMPLE, GOLDEN_XLSX, audit, expectNoNetwork, goldenXlsx, openCheck, recordRequests } from "./check-helpers.ts";
import { writeReport } from "./helpers.ts";

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 375, height: 812 } } as const;
/** Three sheets: Summary, Contacts (hidden, the example's rows) and Notes. */
const SEVERAL = join(GOLDEN_XLSX, "xlsx-refused-several-sheets", "source.xlsx");
const FORMS = join(GOLDEN_XLSX, "xlsx-cell-forms", "source.xlsx");
const ERROR_VALUE = join(GOLDEN_XLSX, "xlsx-refused-error-value", "source.xlsx");
/** A file is read in the profile worker; with every browser test running at once, that can take some seconds. */
const READ = { timeout: 15_000 };
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("a workbook with several worksheets: chosen by keyboard, profiled, and checked as the command line checks it", async ({ page, context }) => {
  await openCheck(page);
  const requests = recordRequests(context);
  await page.getByTestId("source-file").setInputFiles(SEVERAL);
  const choice = page.getByTestId("source-worksheets");
  await expect(choice).toBeVisible();
  await expect(choice.getByRole("radio")).toHaveCount(3);
  // Nothing is read from a worksheet before the choice, and the check cannot start.
  await expect(page.getByTestId("source-profile-part")).toHaveCount(0);
  await expect(page.getByText("Choose the worksheet of the source workbook.")).toBeVisible();
  // The keyboard: focus the first sheet, then move with the arrow keys; each move chooses.
  await page.getByTestId("source-worksheet-0").focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("source-profile")).toHaveAttribute("data-rows", "1", READ);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("source-worksheet-1")).toBeChecked();
  await expect(page.getByTestId("source-worksheet-1")).toBeFocused();
  await expect(page.getByTestId("source-profile")).toHaveAttribute("data-rows", "4", READ);
  await expect(page.locator('[data-profile="worksheet"]')).toContainText("Contacts");
  await expect(page.locator('[data-profile="worksheet"]')).toContainText("hidden in the workbook");
  await expect(page.locator('[data-profile="sheets"] li')).toHaveCount(3);

  await page.getByTestId("destination-file").setInputFiles(EXAMPLE.destination);
  await expect(page.getByTestId("destination-profile")).toHaveAttribute("data-rows", "4", READ);
  await page.getByTestId("key-source").selectOption("external_id");
  await page.getByTestId("key-destination").selectOption("external_id");
  await page.getByTestId("field-0-source").selectOption("phone");
  await page.getByTestId("field-0-destination").selectOption("phone");
  await page.getByRole("button", { name: "Add a field" }).click();
  await page.getByTestId("field-1-source").selectOption("email");
  await page.getByTestId("field-1-destination").selectOption("hs_email");
  await page.getByTestId("source-complete").check();
  await page.getByTestId("destination-complete").check();
  await page.getByTestId("run-check").click();
  const result = page.locator("[data-result]");
  await expect(result).toHaveAttribute("data-result", "Mismatch", { timeout: 30_000 });
  expect(await page.getByTestId("summary").textContent()).toBe(goldenXlsx("xlsx-hidden-sheet-by-name", "stdout.txt"));
  await expect(page.getByTestId("explanation")).toContainText("of an .xlsx workbook, each cell as it is stored");
  requests.stop();
  expectNoNetwork(page, requests);
});

test("a dropped workbook is read as one, and its cells as stored", async ({ page, context }) => {
  await openCheck(page);
  const requests = recordRequests(context);
  const bytes = [...readFileSync(FORMS)];
  const dragged = await page.evaluateHandle((data) => {
    const d = new DataTransfer();
    d.items.add(new File([new Uint8Array(data)], "forms.xlsx"));
    return d;
  }, bytes);
  await page.getByTestId("source-panel").dispatchEvent("dragenter", { dataTransfer: dragged });
  await page.getByTestId("source-panel").dispatchEvent("drop", { dataTransfer: dragged });
  await expect(page.getByTestId("source-workbook")).toContainText("Excel workbook (.xlsx)");
  await expect(page.getByTestId("source-encoding")).toHaveCount(0);
  await expect(page.getByTestId("source-profile")).toHaveAttribute("data-rows", "41", READ);
  const forms = page.locator('[data-profile="forms"]');
  await expect(forms).toContainText("14 numbers");
  await expect(forms).toContainText("2 percentages, read as fractions");
  await expect(forms).toContainText("10 dates or times, read in ISO 8601");
  await expect(page.locator('[data-profile="hidden"]')).toContainText("2 hidden rows");
  requests.stop();
  expectNoNetwork(page, requests);
});

test("a workbook that cannot be read with certainty is refused before the check, with the cell named", async ({ page }) => {
  await openCheck(page);
  await page.getByTestId("source-file").setInputFiles(ERROR_VALUE);
  await expect(page.getByTestId("source-profile-refused")).toContainText("source.xlsx: worksheet 'Contacts': cell B2 holds the error value #N/A", READ);
  await expect(page.getByTestId("run-check")).toBeDisabled();
});

for (const theme of ["light", "dark"] as const) {
  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    test(`axe · ${theme} · ${width} · a workbook's worksheet choice, its profile and a refused workbook`, async ({ page, browserName }) => {
      await page.addInitScript((t) => localStorage.setItem("flowassert.theme", t), theme);
      await page.setViewportSize(viewport);
      await openCheck(page);
      const violations: string[] = [];
      await page.getByTestId("source-file").setInputFiles(SEVERAL);
      await expect(page.getByTestId("source-worksheets")).toBeVisible();
      violations.push(...(await audit(page)));
      expect(await noSideways(page)).toBe(true);
      await page.getByTestId("source-worksheet-1").check();
      await expect(page.getByTestId("source-profile")).toHaveAttribute("data-rows", "4", READ);
      await page.getByTestId("destination-file").setInputFiles(FORMS);
      await expect(page.getByTestId("destination-profile")).toHaveAttribute("data-rows", "41", READ);
      await page.waitForTimeout(400);
      violations.push(...(await audit(page)));
      expect(await noSideways(page)).toBe(true);
      await page.getByTestId("destination-file").setInputFiles(ERROR_VALUE);
      await expect(page.getByTestId("destination-profile-refused")).toContainText("cell B2 holds the error value #N/A", READ);
      violations.push(...(await audit(page)));
      expect(await noSideways(page)).toBe(true);
      writeReport(`axe-${browserName}-${theme}-${width}-workbook`, violations);
      expect(violations).toEqual([]);
    });
  }
}
