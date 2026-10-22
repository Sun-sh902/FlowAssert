import { defineConfig, devices } from "@playwright/test";

/**
 * Product round 01 — real end-to-end checks of the workspace pages (Overview, Verifications, Detail status
 * axes, History entry, Capture runs) against the product workspace's own Service (../service), launched only
 * through ../scripts/dev/service.sh on 127.0.0.1:8765. The suite owns that process (e2e-workspace/support.ts)
 * so it can switch archive states (dev-main, dev-empty) and run with the Service stopped.
 * Requires seeded states: ../scripts/dev/seed.sh. Stop any dev server on 5183 and any Service on 8765 first.
 *
 *   npx playwright test -c playwright.workspace.config.ts
 *   FA_BROWSERS=chrome,webkit npx playwright test -c playwright.workspace.config.ts
 */
const wanted = (process.env.FA_BROWSERS ?? "chrome").split(",").map((s) => s.trim());

const projects = [
  { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
].filter((p) => wanted.includes(p.name));

export default defineConfig({
  testDir: "e2e-workspace",
  outputDir: "test-results-workspace",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:5183", trace: process.env.FA_TRACE ? "on" : "off" },
  projects,
  webServer: {
    command: "npm run build && npx vite preview --port 5183 --strictPort",
    url: "http://127.0.0.1:5183",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
