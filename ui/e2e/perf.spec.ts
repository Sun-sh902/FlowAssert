/**
 * Performance observations on the production build (local preview, no throttling).
 * Reports DOM size, cumulative layout shift and load timing per route; asserts only CLS < 0.1.
 * Numbers from one machine are observations, not a performance guarantee.
 * Round 02 hardening FIX02: one report per project and repeat (parallel repeats no longer overwrite one file), with the
 * browser version, viewport and every page error. A page error fails the test: a page that failed to render cannot
 * shift, so its CLS would be a false 0. transferredKB counts bytes over the network only (cached resources count 0),
 * so after the first route it is not a page weight.
 */
import { expect, test } from "@playwright/test";
import { ROUTES, open, writeReport } from "./helpers.ts";

test("DOM size, layout shift and load timing per route", async ({ page, browser, browserName }, info) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(`${e.name}: ${e.message}`));
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
  writeReport(`perf-${browserName}${info.repeatEachIndex ? `-repeat${info.repeatEachIndex}` : ""}`, {
    project: info.project.name,
    browser: `${browserName} ${browser.version()}`,
    repeat: info.repeatEachIndex,
    viewport: page.viewportSize(),
    cache: "one page, routes in order: the first route loads cold, later routes reuse the cache",
    threshold: { cls: 0.1 },
    pageErrors,
    rows,
  });
  for (const row of rows) if (row.cls !== null) expect.soft(row.cls, row.route).toBeLessThan(0.1);
  expect.soft(pageErrors, "page errors during the measurement").toEqual([]);
});
