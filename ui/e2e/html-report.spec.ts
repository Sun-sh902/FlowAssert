/**
 * The standalone HTML report, as a reader opens and prints it: the golden reports pass the axe audit in light and dark,
 * at desktop and phone width, with nothing wider than the window; and printed to PDF on A4 and on Letter, a report
 * paginates (the pages a PDF says it has) and no text is cut off at the printed width. The report has a Content
 * Security Policy that forbids scripts, so the audit runs with the policy bypassed for axe alone.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { GOLDEN, audit } from "./check-helpers.ts";
import { writeReport } from "./helpers.ts";

test.use({ bypassCSP: true });

/** A Verified, a Mismatch with every rule failing, an Unverified, and a scope exact report with destination-only records. */
const REPORTS = ["rules-pass", "rules-fail", "scenario-empty-key-no-statements", "scope-exact-source-known"];
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, phone: { width: 375, height: 812 } } as const;
const url = (name: string) => "file://" + join(GOLDEN, name, "report.html");

for (const scheme of ["light", "dark"] as const) {
  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    test(`axe · ${scheme} · ${width} · the HTML reports`, async ({ page, browserName }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(viewport);
      for (const name of REPORTS) {
        await page.goto(url(name));
        const violations = await audit(page);
        writeReport(`axe-${browserName}-${scheme}-${width}-html-report-${name}`, violations);
        expect(violations, name).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), name).toBe(true);
      }
    });
  }
}

/** The pages of a PDF, from its page objects. */
const pagesOf = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

for (const [format, printable] of [
  // The width inside the 14 mm side margins of @page, in CSS pixels.
  ["A4", Math.floor(((210 - 28) / 25.4) * 96)],
  ["Letter", Math.floor((8.5 * 25.4 - 28) / 25.4 * 96)],
] as const) {
  test(`print · ${format} · the HTML reports paginate, and no text is cut off`, async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "page.pdf is Chromium's");
    const counts: Record<string, number> = {};
    for (const name of REPORTS) {
      // At the printed width, in print media, nothing reaches past the page's right edge.
      await page.setViewportSize({ width: printable, height: 1000 });
      await page.emulateMedia({ media: "print", colorScheme: "light" });
      await page.goto(url(name));
      const overflowing = await page.evaluate((w) => {
        const out: string[] = [];
        for (const el of document.body.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width && r.right > w + 0.5) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.right)}`);
          if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") out.push(`${el.tagName.toLowerCase()} scrolls`);
        }
        return out;
      }, printable);
      expect(overflowing, name).toEqual([]);
      const pdf = await page.pdf({ format, printBackground: true, preferCSSPageSize: true });
      counts[name] = pagesOf(pdf);
      expect(counts[name], name).toBeGreaterThan(0);
    }
    // The long report takes more pages than the short one, which fits on three.
    expect(counts["rules-fail"]!).toBeGreaterThan(counts["rules-pass"]!);
    expect(counts["rules-pass"]!).toBeLessThanOrEqual(3);
    testInfo.annotations.push({ type: "pages", description: JSON.stringify(counts) });
    console.info(`print ${format}: ${JSON.stringify(counts)}`);
  });
}

test("the golden reports are the files on disk, and none has a script or a link", () => {
  for (const name of REPORTS) {
    const html = readFileSync(join(GOLDEN, name, "report.html"), "utf-8");
    expect(html).not.toMatch(/<script|<link|<img|<iframe|https?:\/\//i);
  }
});
