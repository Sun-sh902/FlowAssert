import { defineConfig, devices } from "@playwright/test";

/**
 * PHASE 3A real end-to-end checks against the SQLite-backed Phase 3A history Service (e2e-history/).
 *
 * The production build is served by `vite preview` on 127.0.0.1:5183 — the origin the Phase 3A backend
 * names in its exact Origin allowlist (FRONTEND_HANDOFF.md) — behind the exact local API gate
 * (vite.config.ts → server/localApiGate.ts). The Service is NOT a webServer here: the suite owns its
 * process so it can stop, restart and switch archive states (e2e-history/support.ts), always through
 * scripts/phase3a/history-service.sh on 127.0.0.1:8765. One worker, serial: every test shares that Service.
 * Requires the isolated runtime and seeded archives (scripts/phase3a/prepare_runtime.py, seed_states.py).
 * Port 5183 is also the dev server's port: stop any dev server first.
 *
 *   npx playwright test -c playwright.history.config.ts
 *   FA_BROWSERS=chrome,webkit,firefox npx playwright test -c playwright.history.config.ts
 */
const wanted = (process.env.FA_BROWSERS ?? "chrome").split(",").map((s) => s.trim());

const projects = [
  { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
].filter((p) => wanted.includes(p.name));

export default defineConfig({
  testDir: "e2e-history",
  outputDir: "test-results-history",
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
