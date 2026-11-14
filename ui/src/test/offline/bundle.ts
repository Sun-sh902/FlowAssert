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
export const DIST_APP = join(UI, "dist-app/flowassert-app.js");

/** The packaged checker, or with `app` the readers of the iPhone and iPad app (`npm run build:app`). */
export function buildBundle(app = false): string {
  const [config, file] = app ? ["vite.app.config.ts", "flowassert-app.js"] : ["vite.lib.config.ts", "flowassert-check.js"];
  const out = mkdtempSync(join(tmpdir(), "flowassert-lib-"));
  try {
    execFileSync(process.execPath, [join(UI, "node_modules/vite/bin/vite.js"), "build", "--config", config, "--outDir", out, "--emptyOutDir", "--logLevel", "error"], {
      cwd: UI,
      stdio: ["ignore", "ignore", "inherit"],
    });
    return readFileSync(join(out, file), "utf-8");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
