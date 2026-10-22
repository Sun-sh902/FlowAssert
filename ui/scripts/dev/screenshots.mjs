// Capture actual UI screenshots from a running dev/preview server (default http://127.0.0.1:5183) in local Chrome.
//   node scripts/dev/screenshots.mjs OUT_DIR [route=name ...]
// Each route is "name=#/hash". Waits for network idle, then a settled frame. Light theme unless FA_THEME=dark.
// FA_WIDTH / FA_HEIGHT set the viewport; FA_FULL=0 captures the viewport only.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [out, ...specs] = process.argv.slice(2);
if (!out || specs.length === 0) { console.error("usage: screenshots.mjs OUT_DIR name=#/route ..."); process.exit(2); }
mkdirSync(out, { recursive: true });
const base = process.env.FA_BASE ?? "http://127.0.0.1:5183/";
const width = Number(process.env.FA_WIDTH ?? 1440);
const theme = process.env.FA_THEME ?? "light";
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width, height: Number(process.env.FA_HEIGHT ?? 900) }, colorScheme: theme, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
for (const spec of specs) {
  const i = spec.indexOf("=");
  const name = spec.slice(0, i), hash = spec.slice(i + 1);
  await page.goto(base + hash, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const file = join(out, `${name}-${width}${theme === "dark" ? "-dark" : ""}.png`);
  await page.screenshot({ path: file, fullPage: process.env.FA_FULL !== "0" });
  console.log(file);
}
if (errors.length) console.log("console errors:", JSON.stringify(errors));
await browser.close();
