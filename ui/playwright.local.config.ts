import { defineConfig, devices } from "@playwright/test";

/**
 * PHASE 2 real end-to-end checks against the accepted local Python Service (e2e-local/).
 *
 * The production build is served by `vite preview` on 127.0.0.1:4184 with the same-origin `/api/v1`
 * proxy (vite.config.ts). The Service itself is NOT a webServer here: the suite owns its process so it
 * can stop, restart and re-key it (e2e-local/support.ts). One worker, serial, because every test shares
 * that one Service on 127.0.0.1:8765. Requires the isolated runtime (scripts/phase2/prepare_runtime.py).
 *
 *   npm run test:e2e:local
 *   FA_BROWSERS=chrome,webkit npm run test:e2e:local
 */
const wanted = (process.env.FA_BROWSERS ?? "chrome").split(",").map((s) => s.trim());

const projects = [
  { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
].filter((p) => wanted.includes(p.name));

export default defineConfig({
  testDir: "e2e-local",
  outputDir: "test-results-local",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4184", trace: "off" },
  projects,
  webServer: {
    command: "npm run build && npx vite preview --port 4184 --strictPort",
    url: "http://127.0.0.1:4184",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
