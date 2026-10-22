// Layout-shift probe: load a route N times in fresh pages and record every layout-shift entry with its sources,
// plus font-face load events, so a CLS failure can be attributed to a mechanism instead of guessed.
//   node scripts/dev/cls-probe.mjs BASE_URL HASH RUNS OUT.json
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const [base, hash, runsArg, out] = process.argv.slice(2);
const runs = Number(runsArg ?? 10);
const browser = await chromium.launch({ channel: "chrome" });
const results = [];
for (let i = 0; i < runs; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const w = window;
    w.__shifts = [];
    w.__fonts = [];
    const t0 = performance.now();
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        w.__shifts.push({
          t: Math.round(e.startTime),
          value: Math.round(e.value * 10000) / 10000,
          sources: (e.sources ?? []).map((s) => ({
            node: s.node ? `${s.node.nodeName.toLowerCase()}${s.node.id ? "#" + s.node.id : ""}.${String(s.node.className ?? "").split(" ").slice(0, 4).join(".")} «${(s.node.textContent ?? "").trim().slice(0, 40)}»` : null,
            prev: [s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height].map(Math.round),
            curr: [s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height].map(Math.round),
          })),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
    document.fonts.addEventListener("loadingdone", (ev) => w.__fonts.push({ t: Math.round(performance.now() - t0), done: ev.fontfaces.map((f) => `${f.family} ${f.weight} ${f.style}`) }));
  });
  await page.goto("about:blank");
  await page.goto(base + hash);
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ shifts: window.__shifts, fonts: window.__fonts, fcp: Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1) }));
  r.cls = Math.round(r.shifts.reduce((n, s) => n + s.value, 0) * 1000) / 1000;
  results.push(r);
  await ctx.close();
}
await browser.close();
writeFileSync(out, JSON.stringify(results, null, 1));
const cls = results.map((r) => r.cls);
console.log(JSON.stringify({ runs, cls, over: cls.filter((c) => c >= 0.1).length, max: Math.max(...cls) }));
