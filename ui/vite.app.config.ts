import { defineConfig } from "vite";

/**
 * The readers of the iPhone and iPad app (`npm run build:app`): src/offline/appLib.ts as one classic script,
 * dist-app/flowassert-app.js, that defines the global FlowAssertApp. It is not the checker: a check runs only in
 * dist-lib/flowassert-check.js. ios/scripts/checker.mjs copies both into the app.
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist-app",
    emptyOutDir: true,
    target: "es2022",
    minify: true,
    sourcemap: false,
    lib: {
      entry: "src/offline/appLib.ts",
      name: "FlowAssertApp",
      formats: ["iife"],
      fileName: () => "flowassert-app.js",
    },
  },
});
