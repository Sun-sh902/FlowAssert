import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks against the production build (vite preview on 127.0.0.1:4183, loopback only).
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
  webServer: {
    command: "npm run build && npx vite preview --port 4183 --strictPort",
    url: "http://127.0.0.1:4183",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
