import { defineConfig, devices } from "@playwright/test";

/**
 * ID-addressability remediation-03 real end-to-end checks (e2e-lookup/): the production build on vite preview
 * 127.0.0.1:5183 (the backend's exact Origin allowlist) behind the exact local API gate, in front of the isolated
 * exact-source Phase 3A Service at the handoff identity (scripts/phase3a/prepare_lookup_runtime.py), launched by
 * the suite itself through scripts/phase3a/lookup-alias-service.sh on 127.0.0.1:8765 with the backend's own
 * test-only identity aliases. One worker, serial: every test shares that Service.
 * "chrome" is the Chromium engine (Google Chrome channel, as in the earlier Phase 2/3A suites).
 *
 *   FA_BROWSERS=chrome,webkit,firefox npx playwright test -c playwright.lookup.config.ts
 */
const wanted = (process.env.FA_BROWSERS ?? "chrome").split(",").map((s) => s.trim());

const projects = [
  { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
].filter((p) => wanted.includes(p.name));

export default defineConfig({
  testDir: "e2e-lookup",
  outputDir: "test-results-lookup",
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
