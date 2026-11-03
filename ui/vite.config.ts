import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot } from "vite";
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
  // The CSV check runs in a module worker (src/offline/worker.ts), bundled as one file of the page's own origin.
  worker: { format: "es" },
  // cors: false — the app is same-origin; no cross-origin client is served, and Vite's own CORS middleware would
  // otherwise answer OPTIONS on /api paths before the gate decides (it never forwarded them).
  // The CSV check page offers offline/examples/*.csv as sample files, so the dev server may read that folder.
  server: {
    host: "127.0.0.1",
    port: 5183,
    strictPort: true,
    cors: false,
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), "../offline/examples"] },
  },
  preview: { host: "127.0.0.1", cors: false },
  // The normal build uses index.html only. Art-direction sources stay available at /lab.html
  // through `npm run dev`, without shipping the laboratory and its fonts in the product output.
});
