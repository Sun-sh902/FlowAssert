/**
 * Pixel comparison of the Phase 2 re-capture against the accepted Phase 2.5 screenshots.
 *   node scripts/phase2/visual_diff.mjs
 * Reads docs/screenshots/phase2_5 (never written) and docs/screenshots/phase2_integration/mock-regression;
 * writes diff images to docs/screenshots/phase2_integration/diff and a JSON report to
 * docs/phase2/evidence/visual/visual-diff.json. A pixel "differs" when any RGBA channel differs by > 24.
 * Runs in the installed Chrome through Playwright (canvas getImageData); no image library is added.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
// Optional overrides: node visual_diff.mjs <baselineDir> <candidateDir> <diffDir> <report.json>
const [argBase, argNext, argDiff, argOut] = process.argv.slice(2);
const BASE = argBase ?? join(ROOT, "docs/screenshots/phase2_5");
const NEXT = argNext ?? join(ROOT, "docs/screenshots/phase2_integration/mock-regression");
const DIFF = argDiff ?? join(ROOT, "docs/screenshots/phase2_integration/diff");
const OUT = argOut ?? join(ROOT, "docs/phase2/evidence/visual/visual-diff.json");
mkdirSync(DIFF, { recursive: true });
mkdirSync(join(OUT, ".."), { recursive: true });

const names = readdirSync(NEXT).filter((n) => n.endsWith(".png")).sort();
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.setContent("<canvas id=a></canvas><canvas id=b></canvas><canvas id=d></canvas>");
const report = [];
for (const name of names) {
  let baseB64;
  try {
    baseB64 = readFileSync(join(BASE, name)).toString("base64");
  } catch {
    report.push({ name, status: "no-baseline" });
    continue;
  }
  const nextB64 = readFileSync(join(NEXT, name)).toString("base64");
  const r = await page.evaluate(
    async ([a, b]) => {
      const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `data:image/png;base64,${src}`; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
      const ctx = (id, img) => { const c = document.getElementById(id); c.width = w; c.height = h; const x = c.getContext("2d"); x.fillStyle = "#ff00ff"; x.fillRect(0, 0, w, h); if (img) x.drawImage(img, 0, 0); return x; };
      const da = ctx("a", ia).getImageData(0, 0, w, h).data, db = ctx("b", ib).getImageData(0, 0, w, h).data;
      const dx = ctx("d", null); const out = dx.createImageData(w, h);
      let diff = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let i = 0; i < da.length; i += 4) {
        const changed = Math.abs(da[i] - db[i]) > 24 || Math.abs(da[i + 1] - db[i + 1]) > 24 || Math.abs(da[i + 2] - db[i + 2]) > 24 || Math.abs(da[i + 3] - db[i + 3]) > 24;
        const p = i / 4, x = p % w, y = (p - x) / w;
        if (changed) { diff++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; out.data.set([255, 0, 80, 255], i); }
        else { const g = (db[i] + db[i + 1] + db[i + 2]) / 3; out.data.set([g, g, g, 70], i); }
      }
      dx.putImageData(out, 0, 0);
      return { w, h, sizeA: [ia.width, ia.height], sizeB: [ib.width, ib.height], diff, ratio: diff / (w * h), box: diff ? [x0, y0, x1, y1] : null, png: diff ? document.getElementById("d").toDataURL("image/png").split(",")[1] : null };
    },
    [baseB64, nextB64],
  );
  if (r.png) writeFileSync(join(DIFF, name), Buffer.from(r.png, "base64"));
  const { png: _png, ...rest } = r;
  report.push({ name, status: r.diff ? "changed" : "identical", ...rest });
}
await browser.close();
writeFileSync(OUT, JSON.stringify(report, null, 1) + "\n");
for (const r of report) console.log(`${r.status.padEnd(10)} ${r.name.padEnd(46)} ${r.diff ?? ""} ${r.ratio !== undefined ? (r.ratio * 100).toFixed(3) + "%" : ""} ${r.box ? JSON.stringify(r.box) : ""} ${r.sizeA && JSON.stringify(r.sizeA) !== JSON.stringify(r.sizeB) ? `size ${r.sizeA}→${r.sizeB}` : ""}`);
