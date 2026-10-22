/**
 * Responsive review at 375 / 768 / 1024 / 1280 / 1440 in both themes, on every route.
 * Measures page-level horizontal overflow and, at 375, interactive targets under 24 × 24 CSS px
 * (WCAG 2.2 SC 2.5.8). Captures screenshots for the visual review in e2e/.output/screens.
 */
import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { OUT, ROUTES, THEMES, WIDTHS, open, writeReport } from "./helpers.ts";

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`no horizontal overflow · ${theme} · ${width}px`, async ({ page, browserName }) => {
      await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
      const rows: { route: string; scrollWidth: number; offenders: string[] }[] = [];
      for (const r of ROUTES) {
        await open(page, r.hash, theme);
        const m = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const clipped = (el: Element) => {
            for (let p = el.parentElement; p; p = p.parentElement) {
              const o = getComputedStyle(p).overflowX;
              if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
            }
            return false;
          };
          const offenders = [...document.querySelectorAll("body *")]
            .filter((el) => {
              const b = el.getBoundingClientRect();
              return b.width > 0 && b.right > vw + 1 && !clipped(el);
            })
            .slice(0, 5)
            .map((el) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 60)}`);
          return { scrollWidth: document.documentElement.scrollWidth, vw, offenders };
        });
        rows.push({ route: r.name, scrollWidth: m.scrollWidth, offenders: m.offenders });
        const full = width === 375 || width === 1440;
        await page.screenshot({ path: join(OUT, "screens", browserName, `${theme}-${r.name}-${width}.jpg`), fullPage: full, type: "jpeg", quality: 72 });
      }
      writeReport(`responsive-${browserName}-${theme}-${width}`, rows);
      for (const row of rows) expect.soft(row.offenders, `${row.route} overflows at ${width}px`).toEqual([]);
      for (const row of rows) expect.soft(row.scrollWidth, `${row.route} scrollWidth`).toBeLessThanOrEqual(width);
    });
  }
}

/**
 * WCAG 2.2 SC 2.5.8 Target Size (Minimum), as specified: a target passes if it is at least 24 × 24 CSS px,
 * or if a 24px-diameter circle centred on it intersects no other target and no other undersized target's circle
 * (the spacing exception). Both outcomes are reported; only a target failing both fails the test.
 */
test("touch targets at 375px", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const report: Record<string, { label: string; w: number; h: number; spacingException: boolean }[]> = {};
  for (const r of ROUTES) {
    await open(page, r.hash);
    report[r.name] = await page.evaluate(() => {
      const targets = [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, [role=radio], [role=switch]")]
        .filter((el) => {
          const s = getComputedStyle(el);
          const b = el.getBoundingClientRect();
          return s.visibility !== "hidden" && b.width > 1 && b.height > 1 && !el.closest(".sr-only") && el.tabIndex !== -1;
        })
        .map((el) => {
          // A positioned ::before hit area (the .fa-hit class) enlarges the target without moving the type.
          const b = el.getBoundingClientRect();
          const p = getComputedStyle(el, "::before");
          const hit = p.content !== "none" && p.position === "absolute";
          const ext = (v: string) => (hit ? Math.max(0, -parseFloat(v)) : 0);
          const rect = { l: b.left - ext(p.left), r: b.right + ext(p.right), t: b.top - ext(p.top), b: b.bottom + ext(p.bottom) };
          return { el, rect, label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 48) };
        });
      const small = targets.filter((t) => t.rect.r - t.rect.l < 24 || t.rect.b - t.rect.t < 24);
      const centre = (t: (typeof targets)[number]) => ({ x: (t.rect.l + t.rect.r) / 2, y: (t.rect.t + t.rect.b) / 2 });
      const distToRect = (c: { x: number; y: number }, q: (typeof targets)[number]["rect"]) =>
        Math.hypot(Math.max(q.l - c.x, 0, c.x - q.r), Math.max(q.t - c.y, 0, c.y - q.b));
      return small.map((t) => {
        const c = centre(t);
        const clear =
          targets.every((o) => o === t || o.el.contains(t.el) || t.el.contains(o.el) || distToRect(c, o.rect) >= 12) &&
          small.every((o) => o === t || Math.hypot(centre(o).x - c.x, centre(o).y - c.y) >= 24);
        return { label: t.label, w: Math.round(t.rect.r - t.rect.l), h: Math.round(t.rect.b - t.rect.t), spacingException: clear };
      });
    });
  }
  writeReport(`touch-targets-375-${browserName}`, report);
  const failing = Object.entries(report).flatMap(([route, list]) => list.filter((t) => !t.spacingException).map((t) => `${route}: ${t.label} ${t.w}×${t.h}`));
  expect(failing).toEqual([]);
});
