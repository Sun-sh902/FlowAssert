/**
 * "Records to resend" in the browser, on the production build (docs/design/1.1-exports.md): each file the result has
 * downloads with the bytes the command line's --export-dir writes; nothing is requested and nothing of the files is
 * kept; the warnings are shown where they apply; and the axe audit passes in both themes at desktop and phone width,
 * without horizontal scroll.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { EXAMPLE, audit, check, expectNoNetwork, openCheck, recordRequests, storedState } from "./check-helpers.ts";
import { THEMES, writeReport } from "./helpers.ts";

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 375, height: 812 } } as const;
/** What flowassert-verify --export-dir writes for the example files with both statements. */
const EXPECTED = {
  "missing-from-destination.csv": "﻿external_id,phone,email\r\nSYN-003,+1 212 555 0103,alan@example.test\r\n",
  "values-differ.csv": "﻿external_id,phone,email\r\nSYN-002,+1 212 555 0102,grace@example.test\r\n",
  "duplicated-in-destination.csv": "﻿external_id,phone,email\r\nSYN-004,+1 212 555 0104,edsger@example.test\r\n",
};

async function resend(page: Page) {
  await page.locator("[data-result]").waitFor({ timeout: 30_000 });
  return page.getByTestId("records-to-resend");
}

async function save(page: Page, file: string) {
  const row = page.locator(`[data-export="${file}"]`);
  const [download] = await Promise.all([page.waitForEvent("download"), row.getByTestId("download-export").click()]);
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}

test("each file downloads with the command line's bytes, with no request and nothing kept", async ({ page, context }) => {
  await openCheck(page);
  const before = await storedState(page);
  const requests = recordRequests(context);
  await check(page, EXAMPLE);
  const section = await resend(page);
  await expect(section.locator("[data-export]")).toHaveCount(3);
  for (const [file, text] of Object.entries(EXPECTED)) {
    const saved = await save(page, file);
    expect(saved.name).toBe(file);
    expect([...saved.bytes]).toEqual([...Buffer.from(text, "utf-8")]);
    await expect(page.locator(`[data-export="${file}"]`).getByTestId("export-formula-warning")).toContainText("1 field in this file begins with =, +, -, @");
  }
  requests.stop();
  expectNoNetwork(page, requests);
  const after = await storedState(page);
  expect({ ...after, url: "" }).toEqual({ ...before, url: "" });
  expect(after.url).not.toMatch(/SYN-|example\.test/);
});

test("without the statements: the unknown file and its warning, and no list of missing records", async ({ page }) => {
  await openCheck(page);
  await check(page, { ...EXAMPLE, sourceComplete: false, destinationComplete: false });
  const section = await resend(page);
  await expect(section.getByTestId("resend-no-missing")).toHaveText("No list of missing records: the destination was not stated complete, so absence is not established.");
  await expect(section.locator('[data-export="missing-from-destination.csv"]')).toHaveCount(0);
  const unknown = section.locator('[data-export="unknown-status-resending-may-create-duplicates.csv"]');
  await expect(unknown.getByTestId("export-unknown-warning")).toBeVisible();
  const saved = await save(page, "unknown-status-resending-may-create-duplicates.csv");
  expect(saved.bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
});

for (const theme of THEMES) {
  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    test(`axe · ${theme} · ${width} · the records to resend, with a warning shown`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("flowassert.theme", t), theme);
      await page.setViewportSize(viewport);
      await openCheck(page);
      await check(page, { ...EXAMPLE, destinationComplete: false });
      const section = await resend(page);
      await save(page, "values-differ.csv");
      await expect(section.getByTestId("export-formula-warning")).toBeVisible();
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const violations = await audit(page);
      writeReport(`axe-records-to-resend-${theme}-${width}`, violations);
      expect(violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}
