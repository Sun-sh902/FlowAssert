#!/usr/bin/env node
/**
 * The packaged checker inside the app: ios/FlowAssert/Engine/Page/flowassert-check.js must be exactly the script
 * `cd ui && npm run build:lib` writes (ui/dist-lib/flowassert-check.js), as the n8n example must hold it, and
 * flowassert-app.js the readers `npm run build:app` writes (ui/dist-app/flowassert-app.js).
 *
 *   node ios/scripts/checker.mjs           copy both builds into the app
 *   node ios/scripts/checker.mjs --check   exit 1 when a copy in the app is not its build (CI)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PAIRS = [
  [join(repo, "ui/dist-lib/flowassert-check.js"), join(repo, "ios/FlowAssert/Engine/Page/flowassert-check.js"), "npm run build:lib"],
  [join(repo, "ui/dist-app/flowassert-app.js"), join(repo, "ios/FlowAssert/Engine/Page/flowassert-app.js"), "npm run build:app"],
];

let stale = 0;
for (const [build, copy, script] of PAIRS) {
  if (!existsSync(build)) {
    console.error(`${build} does not exist; run ${script} in ui/ first`);
    process.exit(2);
  }
  const built = readFileSync(build);
  if (process.argv.includes("--check")) {
    if (!existsSync(copy) || !readFileSync(copy).equals(built)) {
      console.error(`${copy} is not the build of this checkout; run node ios/scripts/checker.mjs`);
      stale++;
    } else console.log(`${copy} is current`);
  } else {
    writeFileSync(copy, built);
    console.log(`wrote ${copy} (${built.length} bytes)`);
  }
}
process.exit(stale ? 1 : 0);
