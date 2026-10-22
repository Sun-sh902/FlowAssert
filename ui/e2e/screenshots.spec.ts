/**
 * Deliverable captures for docs/screenshots/phase2_5. Runs only with FA_CAPTURE=1 so ordinary test
 * runs never write into docs/. Each access-state specimen is captured on its own, in both themes.
 */
import { test } from "@playwright/test";
import { join } from "node:path";
import { THEMES, open } from "./helpers.ts";

// FA_CAPTURE_DIR redirects a re-capture (e.g. a Phase 2 regression comparison) so the accepted Phase 2.5 set is never overwritten.
const DIR = process.env.FA_CAPTURE_DIR ?? join(process.cwd(), "docs", "screenshots", "phase2_5");
const PLATES = ["st-live", "st-loading", "st-empty", "st-error", "st-notfound", "st-partial", "st-stale", "st-evidence", "st-service", "st-cancelled"];

test.skip(!process.env.FA_CAPTURE, "set FA_CAPTURE=1 to write deliverable screenshots");

for (const theme of THEMES) {
  test(`state specimens · ${theme} · 1440`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "#/states", theme);
    await page.getByRole("button", { name: /^Read VR-/ }).click();
    await page.locator("[data-live-result] .fa-seal").first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(DIR, `${theme}-states-head-1440.png`) });
    for (const id of PLATES) await page.locator(`#${id}`).screenshot({ path: join(DIR, `${theme}-${id.replace("st-", "state-")}-1440.png`) });
  });

  test(`live read in flight · ${theme} · 1440`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "#/states", theme);
    await page.getByRole("button", { name: /^Read VR-/ }).click();
    await page.locator("#st-live").screenshot({ path: join(DIR, `${theme}-state-live-loading-1440.png`) });
  });

  test(`state specimens · ${theme} · 375`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, "#/states", theme);
    await page.waitForTimeout(400);
    for (const id of ["st-error", "st-partial", "st-evidence"]) await page.locator(`#${id}`).screenshot({ path: join(DIR, `${theme}-${id.replace("st-", "state-")}-375.png`) });
  });

  test(`detail not found · ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "#/verifications/VR-9999", theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(DIR, `${theme}-detail-not-found-1440x900.png`) });
  });

  test(`regression views · ${theme}`, async ({ page }) => {
    for (const [name, hash, w] of [
      ["overview", "#/", 1440],
      ["detail", "#/verifications/VR-2025", 1440],
      ["verifications", "#/verifications", 1024],
      ["connections", "#/connections", 768],
      ["rules", "#/rules", 1280],
      ["settings", "#/settings", 1440],
      ["detail", "#/verifications/VR-2025", 375],
      ["overview", "#/", 375],
    ] as const) {
      await page.setViewportSize({ width: w, height: w < 768 ? 812 : 900 });
      await open(page, hash, theme);
      await page.screenshot({ path: join(DIR, `${theme}-regression-${name}-${w}.png`) });
    }
  });

  test(`mobile drawer · ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, "#/verifications/VR-2025", theme);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(DIR, `${theme}-drawer-focus-trap-375.png`) });
  });
}
