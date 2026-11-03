/**
 * Test helper: the packaged checker built from this checkout, as `npm run build:lib` builds it, into a folder of its
 * own, so a test never reads a stale dist-lib/.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const UI = resolve(__dirname, "../../..");
export const DIST_LIB = join(UI, "dist-lib/flowassert-check.js");

export function buildBundle(): string {
  const out = mkdtempSync(join(tmpdir(), "flowassert-lib-"));
  try {
    execFileSync(process.execPath, [join(UI, "node_modules/vite/bin/vite.js"), "build", "--config", "vite.lib.config.ts", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], {
      cwd: UI,
      stdio: ["ignore", "ignore", "inherit"],
    });
    return readFileSync(join(out, "flowassert-check.js"), "utf-8");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
