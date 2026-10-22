/**
 * Phase 3A deliverable captures of the History pages, from the real SQLite-backed Service.
 * Runs only with FA_CAPTURE=1; writes to docs/screenshots/phase3a/history (FA_CAPTURE_DIR overrides).
 * Every state is real except where named: the "browser digest mismatch" capture alters one payload of a
 * real evidence page in transit (interception), exactly as the corresponding E2E test does.
 */
import { test, type Page } from "@playwright/test";
import { join } from "node:path";
import { FIRST, SEED, startService, stopService, type ArchiveState, type ServiceProcess } from "./support.ts";

const DIR = process.env.FA_CAPTURE_DIR ?? join(process.cwd(), "docs", "screenshots", "phase3a", "history");
test.skip(!process.env.FA_CAPTURE, "set FA_CAPTURE=1 to write deliverable screenshots");
test.describe.configure({ mode: "serial" });

let service: ServiceProcess;
test.beforeAll(async () => {
  service = await startService("capture", "ui-main");
});
test.afterAll(async () => {
  await stopService(service, "capture");
});
async function switchTo(state: ArchiveState) {
  await stopService(service, `capture:${state}`);
  service = await startService(`capture:${state}`, state);
}

async function openAt(page: Page, hash: string, theme: string, w: number) {
  await page.setViewportSize({ width: w, height: w < 768 ? 812 : 900 });
  await page.addInitScript((t) => localStorage.setItem("flowassert.theme", t), theme);
  await page.goto("about:blank");
  await page.goto(`/${hash}`);
  await page.locator("#main").waitFor();
}
const settle = (page: Page) => page.waitForTimeout(400);
const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: join(DIR, `${name}.png`), fullPage });
const readAll = async (page: Page) => {
  await page.locator("[data-retrieval]").filter({ hasText: "2 of 4" }).waitFor();
  await page.getByRole("region", { name: "Archived evidence" }).getByRole("button", { name: "Read all remaining" }).click();
  await page.locator("[data-retrieval]").filter({ hasText: "All evidence pages retrieved" }).waitFor();
};

for (const theme of ["light", "dark"]) {
  test(`history list and entries · ${theme}`, async ({ page }) => {
    for (const w of [1440, 768, 375]) {
      await openAt(page, "#/local/history", theme, w);
      await page.locator("[data-list-status]").waitFor(); // rows of the hidden layout exist too; wait on the status line
      await settle(page);
      await shot(page, `${theme}-history-list-${w}`, w === 375);
    }
    await openAt(page, "#/local/history", theme, 1440);
    await page.locator("tr[data-history-id]").first().waitFor();
    for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Load older entries" }).click();
    await page.locator("[data-list-status]").filter({ hasText: "All 10 archive entries shown" }).waitFor();
    await settle(page);
    await shot(page, `${theme}-history-list-all-1440`, true);
    await openAt(page, "#/local/history?case=SPEC-005", theme, 1440);
    await page.locator("tr[data-history-id]").first().waitFor();
    await settle(page);
    await shot(page, `${theme}-history-filter-SPEC-005-1440`);

    for (const id of ["SPEC-001", "SPEC-002", "SPEC-003", "SPEC-004", "SPEC-005"] as const) {
      await openAt(page, `#/local/history/${FIRST[id]}`, theme, 1440);
      await page.locator('.fa-seal[data-size="lg"]').waitFor();
      await readAll(page);
      await settle(page);
      await shot(page, `${theme}-history-entry-${id}-1440`, true);
    }
    await openAt(page, `#/local/history/${FIRST["SPEC-005"]}`, theme, 375);
    await page.locator('.fa-seal[data-size="lg"]').waitFor();
    await readAll(page);
    await settle(page);
    await shot(page, `${theme}-history-entry-SPEC-005-375`, true);

    // Evidence panel: first page (integrity not established) and complete (verified).
    await openAt(page, `#/local/history/${FIRST["SPEC-001"]}`, theme, 1440);
    await page.locator("[data-retrieval]").filter({ hasText: "2 of 4" }).waitFor();
    await settle(page);
    await page.getByRole("region", { name: "Archived evidence" }).screenshot({ path: join(DIR, `${theme}-evidence-partial-1440.png`) });
    await page.getByRole("region", { name: "Archive provenance" }).screenshot({ path: join(DIR, `${theme}-provenance-pending-1440.png`) });
    await page.getByRole("region", { name: "Archived evidence" }).getByRole("button", { name: "Read all remaining" }).click();
    await page.locator("[data-retrieval]").filter({ hasText: "All evidence pages retrieved" }).waitFor();
    await settle(page);
    await page.getByRole("region", { name: "Archived evidence" }).screenshot({ path: join(DIR, `${theme}-evidence-verified-1440.png`) });
    await page.getByRole("region", { name: "Archive provenance" }).screenshot({ path: join(DIR, `${theme}-provenance-verified-1440.png`) });
    // Payloads omitted by request: unverifiable.
    await page.getByRole("region", { name: "Archived evidence" }).getByRole("radio", { name: "References only" }).click();
    await page.locator("[data-retrieval]").filter({ hasText: "2 of 4" }).waitFor();
    await page.getByRole("region", { name: "Archived evidence" }).getByRole("button", { name: "Read all remaining" }).click();
    await page.locator("[data-integrity]").filter({ hasText: "Integrity unverifiable" }).waitFor();
    await settle(page);
    await page.getByRole("region", { name: "Archived evidence" }).screenshot({ path: join(DIR, `${theme}-evidence-omitted-unverifiable-1440.png`) });
    // Browser-side digest mismatch (interception alters one payload of a real page).
    const hid = FIRST["SPEC-001"];
    const pattern = new RegExp(`/api/v1/history/${hid}/evidence\\?.*cursor=`);
    await page.route(pattern, async (route) => {
      const real = await route.fetch();
      const body = JSON.parse(await real.text());
      body.items[0].payload.phase3a_altered = true;
      await route.fulfill({ response: real, body: JSON.stringify(body) });
    });
    await openAt(page, `#/local/history/${hid}`, theme, 1440);
    await page.locator("[data-retrieval]").filter({ hasText: "2 of 4" }).waitFor();
    await page.getByRole("region", { name: "Archived evidence" }).getByRole("button", { name: "Read next page" }).click();
    await page.locator('[data-archive-evidence-integrity="failed"]').waitFor();
    await settle(page);
    await page.getByRole("region", { name: "Archived evidence" }).screenshot({ path: join(DIR, `${theme}-evidence-browser-mismatch-1440.png`) });
    await page.getByRole("region", { name: "Archive provenance" }).screenshot({ path: join(DIR, `${theme}-provenance-failed-1440.png`) });
    await page.unroute(pattern);

    await openAt(page, "#/local/history/%2E%2E", theme, 1440);
    await settle(page);
    await shot(page, `${theme}-history-invalid-id-1440`);
    // The accepted Phase 2 evidence panel with the separated retrieval / integrity lines (P2-AUD-001).
    await openAt(page, "#/local/verifications/SPEC-001", theme, 1440);
    await page.locator("[data-retrieval]").filter({ hasText: "2 of 4" }).waitFor();
    await page.getByRole("region", { name: "Evidence references" }).getByRole("button", { name: "Read all remaining" }).click();
    await page.locator("[data-retrieval]").filter({ hasText: "All evidence pages retrieved" }).waitFor();
    await settle(page);
    await page.getByRole("region", { name: "Evidence references" }).screenshot({ path: join(DIR, `${theme}-phase2-evidence-retrieval-integrity-1440.png`) });
  });

  test(`history failure states · ${theme}`, async ({ page }) => {
    await switchTo("ui-corrupt");
    await openAt(page, "#/local/history", theme, 1440);
    await page.locator('[data-integrity-notice="failed"]').waitFor();
    await settle(page);
    await shot(page, `${theme}-history-list-integrity-failed-1440`);
    await openAt(page, `#/local/history/${SEED["ui-corrupt"].damage.history_id}`, theme, 1440);
    await page.locator('[data-integrity-notice="failed"]').waitFor();
    await settle(page);
    await shot(page, `${theme}-history-entry-integrity-failed-1440`);
    await openAt(page, `#/local/history/${SEED["ui-corrupt"].damage.history_id}`, theme, 375);
    await page.locator('[data-integrity-notice="failed"]').waitFor();
    await settle(page);
    await shot(page, `${theme}-history-entry-integrity-failed-375`, true);
    await switchTo("ui-unverifiable");
    await openAt(page, `#/local/history/${SEED["ui-unverifiable"].damage.history_id}`, theme, 1440);
    await page.locator('[data-integrity-notice="unverifiable"]').waitFor();
    await settle(page);
    await shot(page, `${theme}-history-entry-integrity-unverifiable-1440`);
    await switchTo("ui-empty");
    await openAt(page, "#/local/history", theme, 1440);
    await page.locator('[data-access="EMPTY"]').waitFor();
    await settle(page);
    await shot(page, `${theme}-history-empty-1440`);
    await stopService(service, "capture:outage");
    await openAt(page, "#/local/history", theme, 1440);
    await page.locator('[data-access="SERVICE_UNAVAILABLE"]').waitFor();
    await settle(page);
    await shot(page, `${theme}-history-service-unavailable-1440`);
    service = await startService("capture:main", "ui-main");
  });
}
