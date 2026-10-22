/**
 * Automated accessibility audit with axe-core (WCAG 2.0/2.1/2.2 A and AA rules) in a real browser,
 * on every route in both themes, plus the open mobile drawer and expanded disclosures.
 * axe finds a subset of issues; it does not replace a screen-reader pass.
 */
import { expect, test, type Page } from "@playwright/test";
import { AXE_PATH, ROUTES, THEMES, open, writeReport } from "./helpers.ts";

interface AxeResult {
  violations: { id: string; impact: string | null; help: string; nodes: { target: string[]; failureSummary?: string }[] }[];
  passes: unknown[];
}

async function audit(page: Page): Promise<AxeResult> {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<AxeResult> } }).axe;
    // [data-ornament] marks pure typographic decoration (ordinal numerals, § marks): aria-hidden, no information,
    // exempt from WCAG 1.4.3 as "pure decoration". Listed in docs/PHASE2_5_FRONTEND_READINESS.md §F.
    const r = await axe.run({ exclude: [["[data-ornament]"]] } as unknown as Document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] }, resultTypes: ["violations"] });
    return { violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target, failureSummary: n.failureSummary })) })), passes: [] };
  });
}

const summary = (r: AxeResult) => r.violations.map((v) => `${v.impact} ${v.id} ×${v.nodes.length}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);

for (const theme of THEMES) {
  for (const r of ROUTES) {
    test(`axe · ${theme} · ${r.name}`, async ({ page, browserName }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, r.hash, theme);
      // Expand disclosures so their content is audited too.
      // The rail's "What's real?" toggle is a button too; expanding one never adds another, so this ends.
      const collapsed = page.locator('main button[aria-expanded="false"]:visible');
      for (let i = 0; i < 20 && (await collapsed.count()) > 0; i++) await collapsed.first().click();
      await page.getByRole("button", { name: "What’s real?" }).click();
      await page.waitForTimeout(400); // let fade-ins finish so contrast is measured at rest
      if (r.name === "states") {
        await page.getByRole("button", { name: /^Read VR-/ }).click();
        await page.locator("[data-live-result] .fa-seal").first().waitFor();
      }
      const result = await audit(page);
      writeReport(`axe-${browserName}-${theme}-${r.name}`, result.violations);
      expect(summary(result)).toEqual([]);
    });
  }

  test(`axe · ${theme} · mobile drawer open`, async ({ page, browserName }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, "#/verifications/VR-2025", theme);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog", { name: "Navigation" }).waitFor();
    await page.waitForTimeout(400); // let the drawer's fade-in finish so contrast is measured at rest
    const result = await audit(page);
    writeReport(`axe-${browserName}-${theme}-drawer`, result.violations);
    expect(summary(result)).toEqual([]);
  });
}
