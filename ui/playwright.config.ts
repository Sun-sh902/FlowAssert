import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks against the production build (vite preview on 127.0.0.1:4183, loopback only), and against the
 * GitHub Pages build at 127.0.0.1:4185/FlowAssert/ for the CSV check's Pages tests.
 *
 * Default: the locally installed Google Chrome (channel "chrome") — no browser download.
 * Firefox and WebKit run only when their Playwright builds are installed and requested:
 *   npx playwright install firefox webkit
 *   FA_BROWSERS=chrome,webkit npm run test:e2e        (verified 2026-10-18)
 *   FA_BROWSERS=chrome,firefox,webkit npm run test:e2e
 * Firefox 155 (build 1543) could not start on macOS 27.2 here; see docs/PHASE2_5_FRONTEND_READINESS.md §G.
 */
const wanted = (process.env.FA_BROWSERS ?? "chrome").split(",").map((s) => s.trim());

const projects = [
  { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
].filter((p) => wanted.includes(p.name));

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4183", trace: "off" },
  projects,
  webServer: [
    {
      command: "npm run build && npx vite preview --port 4183 --strictPort",
      url: "http://127.0.0.1:4183",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    // The GitHub Pages build, served from a sub-path as Pages serves it (e2e/check-pages.spec.ts).
    {
      command: "npx vite build --mode pages && npx vite preview --outDir dist-pages --base /FlowAssert/ --port 4185 --strictPort",
      url: "http://127.0.0.1:4185/FlowAssert/",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
