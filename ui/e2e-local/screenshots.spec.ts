/**
 * Phase 2 deliverable captures of the LOCAL_RESEARCH pages, from the real local Service.
 * Runs only with FA_CAPTURE=1; writes to docs/screenshots/phase2_integration/local.
 */
import { test, type Page } from "@playwright/test";
import { join } from "node:path";
import { startService, stopService, type ServiceProcess } from "./support.ts";

// FA_CAPTURE_DIR redirects a re-capture (Phase 3A regression) so the accepted Phase 2 set is never overwritten.
const DIR = process.env.FA_CAPTURE_DIR ?? join(process.cwd(), "docs", "screenshots", "phase2_integration", "local");
test.skip(!process.env.FA_CAPTURE, "set FA_CAPTURE=1 to write deliverable screenshots");
test.describe.configure({ mode: "serial" });

let service: ServiceProcess;
test.beforeAll(async () => {
  service = await startService("capture");
});
test.afterAll(async () => {
  await stopService(service, "capture");
});

async function openAt(page: Page, hash: string, theme: string, w: number) {
  await page.setViewportSize({ width: w, height: w < 768 ? 812 : 900 });
  await page.addInitScript((t) => localStorage.setItem("flowassert.theme", t), theme);
  await page.goto("about:blank");
  await page.goto(`/${hash}`);
  await page.locator("#main").waitFor();
}

for (const theme of ["light", "dark"]) {
  test(`local pages · ${theme}`, async ({ page }) => {
    await openAt(page, "#/local/verifications", theme, 1440);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(DIR, `${theme}-local-cases-1440.png`) });
    for (const [id, w] of [["SPEC-001", 1440], ["SPEC-002", 1440], ["SPEC-003", 1440], ["SPEC-004", 1440], ["SPEC-005", 1440], ["SPEC-005", 375]] as const) {
      await openAt(page, `#/local/verifications/${id}`, theme, w);
      await page.locator('.fa-seal[data-size="lg"]').waitFor();
      await page.getByRole("region", { name: "Evidence references" }).getByRole("status").filter({ hasText: "references" }).waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(DIR, `${theme}-${id}-${w}.png`), fullPage: true });
    }
    await openAt(page, "#/local/verifications/SPEC-001", theme, 1440);
    await page.getByRole("button", { name: "Read all remaining" }).click();
    await page.getByText("All evidence pages retrieved · 2 pages").waitFor(); // Phase 3A wording (P2-AUD-001)
    await page.getByRole("button", { name: /Payloads read in this browser/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole("region", { name: "Evidence references" }).screenshot({ path: join(DIR, `${theme}-evidence-complete-1440.png`) });
  });

  test(`local failure states · ${theme}`, async ({ page }) => {
    await stopService(service, `capture-outage-${theme}`);
    await openAt(page, "#/local/verifications/SPEC-002", theme, 1440);
    await page.locator('[data-access="SERVICE_UNAVAILABLE"]').waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(DIR, `${theme}-service-unavailable-1440.png`) });
    service = await startService(`capture-recovered-${theme}`);
    await openAt(page, "#/local/verifications/SPEC-001", theme, 1440);
    await page.getByRole("region", { name: "Evidence references" }).getByRole("status").filter({ hasText: "2 of 4" }).waitFor();
    await stopService(service, `capture-restart-${theme}`);
    service = await startService(`capture-restart-${theme}`);
    await page.getByRole("button", { name: "Read next page" }).click();
    await page.getByText("This case was read from a snapshot the service no longer serves").waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(DIR, `${theme}-snapshot-409-1440.png`) });
    await openAt(page, "#/local/verifications/SPEC-404", theme, 1440);
    await page.locator('[data-access="NOT_FOUND"]').waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(DIR, `${theme}-not-found-1440.png`) });
  });
}
