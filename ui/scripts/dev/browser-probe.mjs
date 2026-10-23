// Browser provisioning check (Round 02 hardening FIX02): launch every browser the regression requires and load a page.
// A directory under ms-playwright proves nothing — Playwright may resolve another path (PLAYWRIGHT_BROWSERS_PATH) or
// another revision — so each browser is launched for real, exactly as the suites launch it.
//   Mandatory (scripts/dev/regression.sh runs FA_BROWSERS=chrome,webkit): "chrome" = the installed Google Chrome
//   (channel "chrome"), "webkit" = Playwright's WebKit build.
//   Firefox is launched for information only: its suites are not run (the accepted F15 Firefox harness defect).
// Records Playwright's version, the revisions its browsers.json requires, and each browser's version and executable.
//   node scripts/dev/browser-probe.mjs OUT.json      exit 0 = every mandatory browser launched; 1 = one did not
import { chromium, firefox, webkit } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const out = process.argv[2];
const require = createRequire(import.meta.url);
const core = dirname(require.resolve("playwright-core/package.json"));
const BROWSERS = [
  { name: "chrome", type: chromium, options: { channel: "chrome" }, mandatory: true, source: "installed Google Chrome (channel chrome)" },
  { name: "webkit", type: webkit, options: {}, mandatory: true, source: "Playwright WebKit build" },
  { name: "firefox", type: firefox, options: {}, mandatory: false, source: "Playwright Firefox build — information only, suites not run (F15)" },
];
const report = {
  playwright: require("@playwright/test/package.json").version,
  required_revisions: JSON.parse(readFileSync(join(core, "browsers.json"), "utf8")).browsers.filter((b) => ["chromium", "webkit", "firefox"].includes(b.name)),
  browsers_path: process.env.PLAYWRIGHT_BROWSERS_PATH ?? null,
  results: [],
};
for (const b of BROWSERS) {
  const r = { name: b.name, mandatory: b.mandatory, source: b.source };
  try {
    const browser = await b.type.launch({ ...b.options, timeout: 30_000 });
    const page = await browser.newPage();
    await page.setContent("<p id=ok>ok</p>");
    r.launched = (await page.textContent("#ok")) === "ok";
    r.version = browser.version();
    r.user_agent = await page.evaluate(() => navigator.userAgent);
    if (!b.options.channel) r.executable = b.type.executablePath();
    await browser.close();
  } catch (e) {
    r.launched = false;
    r.error = String(e?.message ?? e).split("\n")[0];
  }
  report.results.push(r);
  console.log(`${r.launched ? "OK     " : r.mandatory ? "FAIL   " : "ABSENT "} ${b.name.padEnd(8)} ${r.version ?? r.error}${b.mandatory ? "" : " (not mandatory)"}`);
}
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
process.exit(report.results.every((r) => r.launched || !r.mandatory) ? 0 : 1);
