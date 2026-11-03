import { defineConfig } from "vite";

/**
 * The packaged checker (`npm run build:lib`): src/offline/api.ts, through lib.ts, as one classic script,
 * dist-lib/flowassert-check.js, that defines the global FlowAssert (checkCsv, VERSION) and imports nothing. It is not
 * committed; CI builds it, and ui/scripts/n8n/build_workflow.mjs puts it into the n8n example.
 */
export default defineConfig({
  // No public folder and no plugins: nothing but the bundle is written.
  publicDir: false,
  build: {
    outDir: "dist-lib",
    emptyOutDir: true,
    target: "es2022",
    minify: true,
    sourcemap: false,
    lib: {
      entry: "src/offline/lib.ts",
      name: "FlowAssert",
      formats: ["iife"],
      fileName: () => "flowassert-check.js",
    },
  },
});
