// Layout-shift probe: load a route N times in fresh pages and record every layout-shift entry with its sources,
// plus font-face load events, so a CLS failure can be attributed to a mechanism instead of guessed.
// Round 02 hardening FIX02: each load also records the browser version, viewport and its page errors (a page that
// failed to render cannot shift; rules_cls_probe.sh fails on any page error).
// Residual closeout R10: the observation window is 800 ms after load AND at least until document.fonts.ready plus two
// frames and 300 ms, so a font that arrives late still has its swap measured. The observer is buffered and never reset:
// waiting only extends the window, it never drops a shift that happened earlier. Each load records the font status at
// the end of the 800 ms window and when the measurement was taken, and when the last font finished loading.
//   node scripts/dev/cls-probe.mjs BASE_URL HASH RUNS OUT.json
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const [base, hash, runsArg, out] = process.argv.slice(2);
const runs = Number(runsArg ?? 10);
const browser = await chromium.launch({ channel: "chrome" });
const results = [];
const viewport = { width: 1440, height: 900 };
for (let i = 0; i < runs; i++) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(`${e.name}: ${e.message}`));
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
  const fontsAtWindowEnd = await page.evaluate(() => document.fonts.status);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ shifts: window.__shifts, fonts: window.__fonts, fontsAtEnd: document.fonts.status, observedMs: Math.round(performance.now()), fcp: Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1) }));
  Object.assign(r, { fontsAtWindowEnd, lastFontLoadMs: Math.max(-1, ...r.fonts.map((f) => f.t)) });
  r.cls = Math.round(r.shifts.reduce((n, s) => n + s.value, 0) * 1000) / 1000;
  Object.assign(r, { browser: `chrome ${browser.version()}`, viewport, pageErrors });
  results.push(r);
  await ctx.close();
}
await browser.close();
writeFileSync(out, JSON.stringify(results, null, 1));
const cls = results.map((r) => r.cls);
console.log(JSON.stringify({ runs, browser: `chrome ${browser.version()}`, cls, over: cls.filter((c) => c >= 0.1).length, max: Math.max(...cls), pageErrors: results.reduce((n, r) => n + r.pageErrors.length, 0), fontsLateAtWindowEnd: results.filter((r) => r.fontsAtWindowEnd !== "loaded").length, maxLastFontLoadMs: Math.max(...results.map((r) => r.lastFontLoadMs)) }));
