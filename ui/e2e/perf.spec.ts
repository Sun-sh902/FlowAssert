/**
 * Performance observations on the production build (local preview, no throttling).
 * Reports DOM size, cumulative layout shift and load timing per route; asserts only CLS < 0.1.
 * Numbers from one machine are observations, not a performance guarantee.
 */
import { expect, test } from "@playwright/test";
import { ROUTES, open, writeReport } from "./helpers.ts";

test("DOM size, layout shift and load timing per route", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    // Layout Instability API is Chromium-only; elsewhere CLS is reported as null (not measured), never 0.
    if (!PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
      (window as unknown as { __cls: number | null }).__cls = null;
      return;
    }
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[])
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  const rows = [];
  for (const r of ROUTES) {
    await open(page, r.hash);
    await page.waitForTimeout(500);
    rows.push(
      await page.evaluate((name) => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const fcp = performance.getEntriesByName("first-contentful-paint")[0];
        return {
          route: name,
          domNodes: document.getElementsByTagName("*").length,
          cls: (() => {
            const v = (window as unknown as { __cls: number | null }).__cls;
            return v === null ? null : Math.round(v * 1000) / 1000;
          })(),
          domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
          firstContentfulPaintMs: fcp ? Math.round(fcp.startTime) : null,
          transferredKB: Math.round(performance.getEntriesByType("resource").reduce((n, e) => n + ((e as PerformanceResourceTiming).transferSize || 0), nav.transferSize) / 1024),
        };
      }, r.name),
    );
  }
  writeReport(`perf-${browserName}`, rows);
  for (const row of rows) if (row.cls !== null) expect.soft(row.cls, row.route).toBeLessThan(0.1);
});
