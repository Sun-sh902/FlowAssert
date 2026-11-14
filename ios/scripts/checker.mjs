#!/usr/bin/env node
/**
 * The packaged checker inside the app: ios/FlowAssert/Engine/Page/flowassert-check.js must be exactly the script
 * `cd ui && npm run build:lib` writes (ui/dist-lib/flowassert-check.js), as the n8n example must hold it.
 *
 *   node ios/scripts/checker.mjs           copy the build into the app
 *   node ios/scripts/checker.mjs --check   exit 1 when the app's copy is not the build (CI)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
const build = join(repo, "ui/dist-lib/flowassert-check.js");
const copy = join(repo, "ios/FlowAssert/Engine/Page/flowassert-check.js");

if (!existsSync(build)) {
  console.error(`${build} does not exist; run npm run build:lib in ui/ first`);
  process.exit(2);
}
const built = readFileSync(build);
if (process.argv.includes("--check")) {
  if (!existsSync(copy) || !readFileSync(copy).equals(built)) {
    console.error(`${copy} is not the packaged checker of this checkout; run node ios/scripts/checker.mjs`);
    process.exit(1);
  }
  console.log(`${copy} is current`);
} else {
  writeFileSync(copy, built);
  console.log(`wrote ${copy} (${built.length} bytes)`);
}
