import react from "@vitejs/plugin-react";
import { searchForWorkspaceRoot } from "vite";
import { defineConfig } from "vitest/config";

// Unit and component tests (jsdom). Browser checks live in e2e/ and run with Playwright.
export default defineConfig({
  plugins: [react()],
  // The CSV check page imports offline/examples/*.csv as its sample files.
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), "../offline/examples"] } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    restoreMocks: true,
  },
});
