import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localApiGate } from "./server/localApiGate.ts";

/**
 * LOCAL_RESEARCH: the browser requests relative `/api/v1/...`. On the dev and preview servers an exact
 * gate (server/localApiGate.ts, Phase 3A, P2-AUD-004) forwards only the documented local GET routes —
 * the two accepted Phase 2 verification reads, the three Phase 3A history reads and the two remediation-03
 * exact-ID lookup reads (/api/v1/verification-lookup, /api/v1/verification-evidence) — unchanged, to the
 * local Python Service fixed at 127.0.0.1:8765 (its launchers run.py / run_history.py). Any other
 * /api path, any other method, dot-segment paths, percent-encoding other than a Verification ID's canonical
 * segment (P3A-AUD-001), unknown query keys, foreign Host headers
 * and upstream redirects are refused by the gate and never reach the Service. The Service has no CORS
 * middleware; same-origin forwarding needs none. Both servers bind to loopback only.
 * A static build served elsewhere has no gate: LOCAL_RESEARCH pages then show Service unavailable.
 */
export default defineConfig({
  plugins: [localApiGate(), react(), tailwindcss()],
  // cors: false — the app is same-origin; no cross-origin client is served, and Vite's own CORS middleware would
  // otherwise answer OPTIONS on /api paths before the gate decides (it never forwarded them).
  server: { host: "127.0.0.1", port: 5183, strictPort: true, cors: false },
  preview: { host: "127.0.0.1", cors: false },
  build: {
    rollupOptions: {
      // lab.html is the isolated art-direction lab; it never ships styles into the app.
      input: { main: resolve(__dirname, "index.html"), lab: resolve(__dirname, "lab.html") },
    },
  },
});
