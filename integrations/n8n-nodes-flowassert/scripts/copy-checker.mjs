/**
 * Put the packaged checker into the node: nodes/FlowAssert/checker.js, written from ui/dist-lib/flowassert-check.js,
 * which `cd ui && npm run build:lib` builds from ui/src/offline/ (the checker the browser and the n8n example run).
 * The node has no runtime dependency: the checker is part of its own code. The file is written at every build and
 * never committed, so it is always this repository's checker.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, "../../../ui/dist-lib/flowassert-check.js");
const out = join(here, "../nodes/FlowAssert/checker.js");

if (!existsSync(bundle)) {
  console.error(`${bundle} is missing: build it first with "cd ui && npm ci && npm run build:lib".`);
  process.exit(1);
}
const code = readFileSync(bundle, "utf-8");
if (!code.startsWith("var FlowAssert=")) {
  console.error(`${bundle} does not define FlowAssert as npm run build:lib writes it.`);
  process.exit(1);
}
const text = `// The packaged FlowAssert checker, written by scripts/copy-checker.mjs from ui/dist-lib/flowassert-check.js. Do not
// edit: it is the checker of ui/src/offline/, built with "npm run build:lib". It makes no request and reads no file.
${code.trimEnd()}
/** @type {(input: import('./types').CheckCsvInput) => Promise<import('./types').CheckCsvResult>} */
export const checkCsv = FlowAssert.checkCsv;
/** @type {string} */
export const VERSION = FlowAssert.VERSION;
`;
const old = existsSync(out) ? readFileSync(out, "utf-8") : null;
if (old !== text) writeFileSync(out, text);
console.log(`${out}: written from ${bundle} (${code.length} characters)`);
