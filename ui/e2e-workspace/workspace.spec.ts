/**
 * The workspace pages against the real local Service (../service), in a real browser (product rounds 01–02).
 * Expected cohort results are the backend handoff's case table (support.ts), never read from the UI.
 * States: dev-main (2 archived evaluations per case), dev-single (exactly 1 per case), dev-empty, and Service stopped.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { APP_ORIGIN, CASES, EXPECTED_COHORT, SHOTS, custody, open, recordRequests, seals, startService, stopService, writeEvidence, type ServiceProcess, type State } from "./support.ts";

test.describe.configure({ mode: "serial" });

let svc: ServiceProcess | null = null;
test.afterAll(async () => {
  await stopService(svc);
  svc = null;
  writeEvidence(`custody-${test.info().project.name}`, custody);
});

async function useState(state: State | "down") {
  if (state === "down" ? svc === null : svc?.state === state) return;
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

const notOwnOrigin = (seen: { url: string }[]) => seen.filter((r) => !r.url.startsWith(APP_ORIGIN) && !r.url.startsWith("about:") && !r.url.startsWith("data:"));
const settledComparisons = (page: Page) => page.locator('[data-case] [data-comparison]:not([data-comparison="READING"])');
const settled = async (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));

test.describe("archive: dev-main (2 archived evaluations per case)", () => {
  test.beforeAll(async () => useState("dev-main"));

  test("Overview: live beside newest archived for each known case, bounded reads, own origin only", async ({ page }) => {
    const seen = recordRequests(page);
    await open(page, "#/");
    await expect(settledComparisons(page)).toHaveCount(5);
    for (const id of CASES) {
      expect(await seals(page, `[data-case="${id}"]`), id).toEqual([EXPECTED_COHORT[id], EXPECTED_COHORT[id]]);
      await expect(page.locator(`[data-case="${id}"] [data-comparison]`)).toHaveAttribute("data-comparison", "SAME_INPUT_AGREE");
    }
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("One case contradicts its source. Two cannot be concluded, one is still waiting, one is verified.");
    const api = seen.filter((r) => r.url.includes("/api/"));
    expect(api.filter((r) => r.url.includes("/api/v1/history?")).length).toBe(3);
    expect(api.filter((r) => r.url.includes("/api/v1/verifications/")).map((r) => r.url.replace(APP_ORIGIN, "")).sort()).toEqual(CASES.map((id) => `/api/v1/verifications/${id}`));
    expect(api.every((r) => r.method === "GET")).toBe(true);
    expect(api).toHaveLength(8);
    expect(notOwnOrigin(seen)).toEqual([]);
    writeEvidence(`overview-requests-${test.info().project.name}`, api);
  });

  test("Service status: reachable from the page's own reads, Check issues one permitted read", async ({ page }) => {
    const seen = recordRequests(page);
    await open(page, "#/verifications");
    await expect(page.locator("[data-service-status]")).toHaveAttribute("data-service-status", "REACHABLE");
    await expect(page.locator("[data-service-status]")).toContainText("Service reachable");
    await expect(page.locator('[data-case-table] [data-comparison="SAME_INPUT_AGREE"]')).toHaveCount(5);
    const before = seen.filter((r) => r.url.includes("/api/")).length;
    await page.getByRole("button", { name: "Check the local Service now" }).click();
    await expect.poll(() => seen.filter((r) => r.url.includes("/api/")).length).toBe(before + 1);
    expect(seen.at(-1)!.url).toBe(`${APP_ORIGIN}/api/v1/history?limit=1`);
    await expect(page.locator("[data-service-status]")).toHaveAttribute("data-service-status", "REACHABLE");
  });

  test("Verifications: capture and admission not implemented, live and archived verdicts, comparison", async ({ page }) => {
    await open(page, "#/verifications");
    const table = page.locator("[data-case-table]");
    await expect(table.locator('[data-comparison="SAME_INPUT_AGREE"]')).toHaveCount(5);
    for (const id of CASES) {
      const row = table.locator(`tr[data-case="${id}"]`);
      await expect(row.locator("[data-axis-na]")).toHaveCount(2);
      expect(await seals(page, `tr[data-case="${id}"]`), id).toEqual([EXPECTED_COHORT[id], EXPECTED_COHORT[id]]);
      await expect(row).toContainText("2 evaluations archived");
    }
  });

  test("Detail: two archived evaluations of exactly this input — both listed, none chosen, both byte-identical", async ({ page }) => {
    const seen = recordRequests(page);
    await open(page, "#/local/verifications/SPEC-005");
    const match = page.locator('[data-archive-match="many"]');
    await expect(match.locator("[data-archive-candidate]")).toHaveCount(2);
    await expect(match).toContainText("None is chosen.");
    await expect(match.locator('[data-result-relation="identical"]')).toHaveCount(2);
    const axes = page.locator("[data-status-axes]");
    await expect(axes.locator('[data-axis="verdict"] .fa-seal')).toHaveAttribute("data-s", "Unverified");
    await expect(axes.locator('[data-axis="archive"]')).toContainText("2 evaluations");
    await expect(page.getByText("Expected total", { exact: true }).locator("..")).toContainText("unknown");
    // The Detail reads its own case only: live Detail and evidence, this case's archive list, its candidates' archived Details.
    const api = seen.filter((r) => r.url.includes("/api/")).map((r) => r.url.replace(APP_ORIGIN, ""));
    expect(api.filter((u) => !u.startsWith("/api/v1/verifications/SPEC-005") && !u.startsWith("/api/v1/history?limit=4&verification_id=SPEC-005") && !/^\/api\/v1\/history\/hist_[0-9a-f]{64}$/.test(u))).toEqual([]);
    expect(api.filter((u) => u.startsWith("/api/v1/history/hist_"))).toHaveLength(2);
  });

  test("History entry: archived axes, and a link to the case's current result", async ({ page }) => {
    await open(page, "#/local/history");
    await page.locator("a[data-history-link]").first().click();
    const axes = page.locator("[data-status-axes]");
    await expect(axes.locator('[data-axis="archive"]')).toContainText("record check · service");
    await expect(axes.locator('[data-axis="verdict"]')).toContainText("copied from archived evaluation");
    await expect(page.getByRole("link", { name: /current result of SPEC-00\d/ })).toBeVisible();
  });

  test("Capture runs offers no action and sends nothing", async ({ page }) => {
    const seen = recordRequests(page);
    await open(page, "#/capture");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Capture runs are not implemented.");
    await expect(page.locator("[data-capture-unavailable] button")).toHaveCount(0);
    expect(seen.filter((r) => r.url.includes("/api/"))).toEqual([]);
    await expect(page.locator("[data-service-status]")).toHaveAttribute("data-service-status", "UNKNOWN");
  });

  for (const theme of ["light", "dark"] as const)
    for (const width of [1440, 375])
      test(`axe · ${theme} · ${width}px · updated pages`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const results: Record<string, string[]> = {};
        const ready: Record<string, string> = {
          "#/": '[data-case] [data-comparison="SAME_INPUT_AGREE"]',
          "#/verifications": '[data-case] [data-comparison="SAME_INPUT_AGREE"]',
          "#/local/verifications/SPEC-005": "[data-result-relation]",
          "#/local/history": "a[data-history-link]",
          "#/capture": "[data-capture-unavailable]",
        };
        for (const [hash, sel] of Object.entries(ready)) {
          await open(page, hash, theme);
          await page.locator(sel).first().waitFor({ state: "attached" });
          await settled(page);
          results[hash] = await axe(page);
        }
        writeEvidence(`axe-${test.info().project.name}-${theme}-${width}`, results);
        expect(Object.entries(results).flatMap(([h, v]) => v.map((x) => `${h} ${x}`))).toEqual([]);
      });

  test("no horizontal overflow at 375px on the updated pages", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const hash of ["#/", "#/verifications", "#/local/verifications/SPEC-005", "#/local/history", "#/capture"]) {
      await open(page, hash);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, hash).toBeLessThanOrEqual(0);
    }
  });

  test("screenshots of the implemented screens (after)", async ({ page }) => {
    test.skip(test.info().project.name !== "chrome", "one browser is enough for the delivered screenshots");
    mkdirSync(SHOTS, { recursive: true });
    const shots: [string, string, number, "light" | "dark"][] = [];
    for (const theme of ["light", "dark"] as const)
      for (const width of [1440, 375])
        for (const [name, hash] of [
          ["overview", "#/"],
          ["verifications", "#/verifications"],
          ["detail-SPEC-005", "#/local/verifications/SPEC-005"],
          ["history", "#/local/history"],
          ["rules", "#/rules"],
        ] as const)
          shots.push([name, hash, width, theme]);
    shots.push(["history-entry", "#/local/history", 1440, "light"], ["capture", "#/capture", 1440, "dark"]);
    for (const [name, hash, width, theme] of shots) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, hash, theme);
      if (name === "history-entry") {
        await page.locator("a[data-history-link]").first().click();
        await page.locator("[data-status-axes]").waitFor();
      }
      await page.waitForLoadState("networkidle");
      await settled(page);
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(SHOTS, `${name}-${width}-${theme}.png`), fullPage: true });
    }
  });
});

test.describe("archive: dev-single (exactly one archived evaluation per case)", () => {
  test.beforeAll(async () => useState("dev-single"));

  test("Detail links to the one exactly matching archived evaluation", async ({ page }) => {
    await open(page, "#/local/verifications/SPEC-002");
    const match = page.locator('[data-archive-match="one"]');
    await expect(match.locator('[data-result-relation="identical"]')).toHaveCount(1);
    const link = match.getByRole("link", { name: /Open matching archived evaluation/ });
    const target = await link.getAttribute("href");
    expect(target).toMatch(/^#\/local\/history\/hist_[0-9a-f]{64}$/);
    await link.click();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(target);
    await expect(page.locator('[data-status-axes] [data-axis="verdict"] .fa-seal')).toHaveAttribute("data-s", "Mismatch");
    if (test.info().project.name === "chrome") {
      mkdirSync(SHOTS, { recursive: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, "#/local/verifications/SPEC-002");
      await page.locator('[data-result-relation="identical"]').waitFor();
      await settled(page);
      await page.screenshot({ path: join(SHOTS, "detail-SPEC-002-single-match-1440-light.png"), fullPage: true });
    }
  });
});

test.describe("archive: dev-empty (valid, empty)", () => {
  test.beforeAll(async () => useState("dev-empty"));

  test("live verdicts still shown; every comparison is Not archived — never Unverified", async ({ page }) => {
    await open(page, "#/verifications");
    await expect(page.locator('[data-case-table] [data-comparison="ARCHIVE_MISSING"]')).toHaveCount(5);
    for (const id of CASES) expect(await seals(page, `tr[data-case="${id}"]`), id).toEqual([EXPECTED_COHORT[id]]);
    await expect(page.locator("[data-case-table] [data-axis-noverdict]")).toHaveCount(5);
  });

  test("Detail: no matching archived evaluation; the archive axis says Not archived", async ({ page }) => {
    await open(page, "#/local/verifications/SPEC-002");
    await expect(page.locator('[data-archive-match="none"]')).toContainText("The archive holds no evaluation of this case.");
    await expect(page.locator("[data-archive-candidate]")).toHaveCount(0);
    await expect(page.locator('[data-status-axes] [data-axis="archive"]')).toContainText("Not archived");
  });
});

test.describe("Service stopped", () => {
  test.beforeAll(async () => useState("down"));

  test("Overview and Verifications show Service unavailable — no verdict, no demo data; the status says so", async ({ page }) => {
    for (const hash of ["#/", "#/verifications"]) {
      await open(page, hash);
      const notice = page.locator('[data-access="SERVICE_UNAVAILABLE"]');
      await expect(notice).toBeVisible();
      await expect(notice).toContainText("none — no other data source is used");
      expect(await seals(page), hash).toEqual([]);
      await expect(page.locator("[data-case]")).toHaveCount(0);
      await expect(page.locator("[data-service-status]")).toHaveAttribute("data-service-status", "UNAVAILABLE");
    }
    if (test.info().project.name === "chrome") {
      mkdirSync(SHOTS, { recursive: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, "#/");
      await page.locator('[data-access="SERVICE_UNAVAILABLE"]').waitFor();
      await settled(page);
      await page.screenshot({ path: join(SHOTS, "overview-service-unavailable-1440-light.png"), fullPage: true });
    }
  });
});
