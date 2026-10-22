/**
 * Product round 01 — the workspace pages against the real local Service (../service), in a real browser.
 * Expected cohort results are the backend handoff's case table (support.ts), never read from the UI.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN, CASES, EXPECTED_COHORT, OUT, custody, open, recordRequests, seals, startService, stopService, writeEvidence, type ServiceProcess } from "./support.ts";

test.describe.configure({ mode: "serial" });

let svc: ServiceProcess | null = null;
test.afterAll(async () => {
  await stopService(svc);
  svc = null;
  writeEvidence(`custody-${test.info().project.name}`, custody);
});

async function useState(state: "dev-main" | "dev-empty" | "down") {
  if (svc?.state === state) return;
  await stopService(svc);
  svc = state === "down" ? null : await startService(state);
}

const AXE_PATH = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function axe(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    // Same exclusion as e2e/a11y.spec.ts: [data-ornament] is aria-hidden typographic decoration.
    const r = await axe.run({ exclude: [["[data-ornament]"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] }, resultTypes: ["violations"] });
    return r.violations.map((v) => `${v.id} ×${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  });
}

const onlyOwnOrigin = (seen: { url: string }[]) => seen.filter((r) => !r.url.startsWith(APP_ORIGIN) && !r.url.startsWith("about:") && !r.url.startsWith("data:"));

test.describe("archive: dev-main (10 archived evaluations)", () => {
  test.beforeAll(async () => useState("dev-main"));

  test("Overview states each case's newest archived result, read only from its own origin", async ({ page }) => {
    const seen = recordRequests(page);
    await open(page, "#/");
    await expect(page.locator("[data-case]")).toHaveCount(5);
    for (const id of CASES) expect(await seals(page, `[data-case="${id}"]`), id).toEqual([EXPECTED_COHORT[id]]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("One case contradicts its source. Two cannot be concluded, one is still waiting, one is verified.");
    await expect(page.getByText("10 of 10 INTEGRITY_VERIFIED by the Service")).toBeVisible();
    const api = seen.filter((r) => r.url.includes("/api/"));
    expect(api.length).toBe(3);
    expect(api.every((r) => r.method === "GET" && r.url.startsWith(`${APP_ORIGIN}/api/v1/history?limit=4`))).toBe(true);
    expect(onlyOwnOrigin(seen)).toEqual([]);
    writeEvidence(`overview-requests-${test.info().project.name}`, api);
  });

  test("Verifications keeps four axes apart for every case", async ({ page }) => {
    await open(page, "#/verifications");
    const table = page.locator("[data-case-table]");
    await expect(table.locator("tbody tr")).toHaveCount(5);
    for (const id of CASES) {
      const row = table.locator(`tr[data-case="${id}"]`);
      await expect(row.locator("[data-axis-na]")).toHaveCount(2);
      await expect(row).toContainText("Archived · 2 evaluations");
      expect(await seals(page, `tr[data-case="${id}"]`), id).toEqual([EXPECTED_COHORT[id]]);
    }
  });

  test("Detail shows the live verdict with this case's archive status beside it", async ({ page }) => {
    await open(page, "#/local/verifications/SPEC-005");
    const axes = page.locator("[data-status-axes]");
    await expect(axes.locator('[data-axis="archive"]')).toContainText("2 evaluations");
    await expect(axes.locator('[data-axis="verdict"] .fa-seal')).toHaveAttribute("data-s", "Unverified");
    await expect(axes.locator('[data-axis="verdict"]')).toContainText("GET /api/v1/verifications/SPEC-005 (live read)");
    await expect(axes.locator("[data-axis-na]")).toHaveCount(2);
    // The accepted Detail composition below is unchanged: the cohort seal and the unknown total.
    await expect(page.getByText("Expected total", { exact: true }).locator("..")).toContainText("unknown");
  });

  test("History entry shows the archived evaluation on the archive and verdict axes", async ({ page }) => {
    await open(page, "#/local/history");
    await page.locator("a[data-history-link]").first().click();
    const axes = page.locator("[data-status-axes]");
    await expect(axes.locator('[data-axis="archive"]')).toContainText("record check · service");
    await expect(axes.locator('[data-axis="verdict"]')).toContainText("copied from archived evaluation");
  });

  test("Capture runs offers no action and sends nothing", async ({ page }) => {
    const seen = recordRequests(page);
    await open(page, "#/capture");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Capture runs are not implemented.");
    await expect(page.locator("[data-capture-unavailable] button")).toHaveCount(0);
    expect(seen.filter((r) => r.url.includes("/api/"))).toEqual([]);
  });

  for (const theme of ["light", "dark"] as const)
    for (const width of [1440, 375])
      test(`axe · ${theme} · ${width}px · workspace pages`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const results: Record<string, string[]> = {};
        for (const hash of ["#/", "#/verifications", "#/local/verifications/SPEC-005", "#/capture"]) {
          await open(page, hash, theme);
          await page.locator(hash === "#/capture" ? "[data-capture-unavailable]" : hash.includes("SPEC-005") ? "[data-status-axes] .fa-seal" : "[data-case]").first().waitFor({ state: "attached" });
          await page.waitForTimeout(300);
          results[hash] = await axe(page);
        }
        writeEvidence(`axe-${test.info().project.name}-${theme}-${width}`, results);
        expect(Object.entries(results).flatMap(([h, v]) => v.map((x) => `${h} ${x}`))).toEqual([]);
      });

  test("no horizontal overflow at 375px on the workspace pages", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const hash of ["#/", "#/verifications", "#/local/verifications/SPEC-001", "#/capture"]) {
      await open(page, hash);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, hash).toBeLessThanOrEqual(0);
    }
  });

  test("screenshots of the implemented screens", async ({ page }) => {
    test.skip(test.info().project.name !== "chrome", "one browser is enough for the delivered screenshots");
    const shots: [string, string, number, "light" | "dark"][] = [
      ["overview", "#/", 1440, "light"],
      ["overview", "#/", 1440, "dark"],
      ["verifications", "#/verifications", 1440, "light"],
      ["verifications", "#/verifications", 1440, "dark"],
      ["detail-spec005", "#/local/verifications/SPEC-005", 1440, "light"],
      ["detail-spec002", "#/local/verifications/SPEC-002", 1440, "dark"],
      ["history-entry", "#/local/history", 1440, "light"],
      ["capture", "#/capture", 1440, "light"],
      ["overview", "#/", 375, "light"],
      ["verifications", "#/verifications", 375, "dark"],
    ];
    for (const [name, hash, width, theme] of shots) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, hash, theme);
      if (name === "history-entry") {
        await page.locator("a[data-history-link]").first().click();
        await page.locator("[data-status-axes]").waitFor();
      }
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(OUT, "..", "..", "screenshots", `${name}-${width}-${theme}.png`), fullPage: true });
    }
  });
});

test.describe("archive: dev-empty (valid, empty)", () => {
  test.beforeAll(async () => useState("dev-empty"));

  test("Overview and Verifications give every case No verdict — never Unverified", async ({ page }) => {
    await open(page, "#/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("No case has an archived evaluation yet.");
    await expect(page.locator("[data-axis-noverdict]")).toHaveCount(5);
    expect(await seals(page)).toEqual([]);
    await open(page, "#/verifications");
    await expect(page.locator("[data-case-table] tbody tr")).toHaveCount(5);
    await expect(page.locator("[data-case-table] [data-axis-noverdict]")).toHaveCount(5);
    await expect(page.locator("[data-case-table]")).toContainText("Not archived");
    expect(await seals(page, "[data-case-table]")).toEqual([]);
  });

  test("Detail still reads the live verdict; the archive axis says Not archived", async ({ page }) => {
    await open(page, "#/local/verifications/SPEC-002");
    const axes = page.locator("[data-status-axes]");
    await expect(axes.locator('[data-axis="archive"]')).toContainText("Not archived");
    await expect(axes.locator('[data-axis="verdict"] .fa-seal')).toHaveAttribute("data-s", "Mismatch");
  });
});

test.describe("Service stopped", () => {
  test.beforeAll(async () => useState("down"));

  test("Overview and Verifications show Service unavailable — no verdict, no demo data", async ({ page }) => {
    for (const hash of ["#/", "#/verifications"]) {
      await open(page, hash);
      const notice = page.locator('[data-access="SERVICE_UNAVAILABLE"]');
      await expect(notice).toBeVisible();
      await expect(notice).toContainText("none — no other data source is used");
      expect(await seals(page), hash).toEqual([]);
      await expect(page.locator("[data-case]")).toHaveCount(0);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "#/");
    await page.locator('[data-access="SERVICE_UNAVAILABLE"]').waitFor();
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    if (test.info().project.name === "chrome") await page.screenshot({ path: join(OUT, "..", "..", "screenshots", "overview-service-unavailable-1440-light.png"), fullPage: true });
  });
});
