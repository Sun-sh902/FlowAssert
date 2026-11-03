#!/usr/bin/env node
/**
 * The n8n example workflow, examples/n8n/flowassert-check.workflow.json, with the packaged checker of this version in
 * its Code node.
 *
 *   npm run build:lib && node scripts/n8n/build_workflow.mjs           write the workflow again
 *   npm run build:lib && node scripts/n8n/build_workflow.mjs --check   exit 1 if the committed workflow differs
 *
 * Both read the bundle from dist-lib/flowassert-check.js, or from the file after --bundle. The workflow is: Manual Trigger, two Read/Write Files from
 * Disk nodes (the source and the destination CSV), Merge (append), the Code node "FlowAssert check", and an If node on
 * its state. The Code node is a configuration block, the bundle unchanged, and the call; it runs no command and makes
 * no request. ui/src/test/offline/n8n-workflow.test.ts fails when the committed file is not what this writes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UI = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const WORKFLOW = join(UI, "../examples/n8n/flowassert-check.workflow.json");
export const BUNDLE = join(UI, "dist-lib/flowassert-check.js");
/** Where n8n's Read/Write Files node may read by default, in the official Docker image (~/.n8n-files). */
export const FILES = "/home/node/.n8n-files/flowassert";

export const CONFIGURATION = `// ===== FlowAssert check: configuration. Edit this block only. =====
// The two files, from the "Read source CSV" and "Read destination CSV" nodes. name is what a refusal calls the file;
// encoding is "utf-8" (with or without a byte order mark), "utf-16" (with a byte order mark) or "gb18030".
const SOURCE = { binaryField: "source", name: "source.csv", encoding: "utf-8" };
const DESTINATION = { binaryField: "destination", name: "destination.csv", encoding: "utf-8" };

// What to compare, as in a flowassert-verify --config file: the key column in each file, and each field with its
// rule (exact, trim, casefold, digits or date:FORMAT). scope "exact" also reports destination keys not in the source.
const CONFIG = {
  key: ["external_id", "external_id"],
  fields: [
    { source: "phone", destination: "phone", rule: "exact" },
    { source: "email", destination: "hs_email", rule: "exact" },
  ],
  scope: "source",
};

// Premises: what you state about these files. FlowAssert cannot check any of them, and a wrong statement gives a
// wrong result. Each stays false or null unless you know it is true for the files of this run.
// true: the source file is the whole batch. While false, the batch can never be Verified.
const SOURCE_COMPLETE = false;
// true: the destination export covers the whole destination object. While false, a missing record or a duplicate
// stays unknown.
const DESTINATION_COMPLETE = false;
// The source total you saw in the original system, such as "120", or null. A different row count blocks Verified;
// a matching one does not replace SOURCE_COMPLETE.
const SOURCE_COUNT = null;
// The destination total you saw in the original system, or null. A different row count leaves missing records and
// duplicates unknown.
const DESTINATION_COUNT = null;
// true: the two files have identical content and really come from two different systems.
const ALLOW_IDENTICAL_CONTENT = false;
// ===== End of the configuration. =====
`;

export const CALL = `
// ===== Run the check. =====
// The files' bytes stay in this n8n instance: the checker above makes no request and runs no command.
const items = $input.all();
const bytesOf = async (file) => {
  const index = items.findIndex((item) => item.binary && item.binary[file.binaryField]);
  if (index === -1) throw new Error(\`FlowAssert: no input item has the binary field "\${file.binaryField}"\`);
  return this.helpers.getBinaryDataBuffer(index, file.binaryField);
};
const result = await FlowAssert.checkCsv({
  source: { name: SOURCE.name, content: await bytesOf(SOURCE), encoding: SOURCE.encoding },
  destination: { name: DESTINATION.name, content: await bytesOf(DESTINATION), encoding: DESTINATION.encoding },
  config: CONFIG,
  sourceComplete: SOURCE_COMPLETE,
  destinationComplete: DESTINATION_COMPLETE,
  sourceCount: SOURCE_COUNT,
  destinationCount: DESTINATION_COUNT,
  allowIdenticalContent: ALLOW_IDENTICAL_CONTENT,
  origin: "n8n Code node",
});
// state: Verified, Mismatch, Unverified, refused or failed. summary is what flowassert-verify prints; message is its
// refusal or failure. reportJson is the JSON report, byte for byte, or null when the check was refused or failed.
return [{
  json: {
    state: result.state,
    exit: result.exit,
    counts: result.json === null ? null : JSON.parse(result.json).counts,
    summary: result.summary,
    message: result.message,
    flowassertVersion: FlowAssert.VERSION,
    reportJson: result.json,
  },
}];
`;

/** The Code node's JavaScript: the configuration, the bundle unchanged, and the call. */
export function code(bundle) {
  return `${CONFIGURATION}
// ===== FlowAssert packaged checker (flowassert-check.js, written by npm run build:lib). Do not edit. =====
${bundle.trimEnd()}
${CALL}`;
}

/** The workflow's JSON text, with the bundle in its Code node. */
export function workflowText(bundle) {
  const workflow = {
    name: "FlowAssert CSV check",
    nodes: [
      { id: "6f1c2a10-0d1e-4c55-9a51-000000000001", name: "Run the check", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [0, 0], parameters: {} },
      {
        id: "6f1c2a10-0d1e-4c55-9a51-000000000002",
        name: "Read source CSV",
        type: "n8n-nodes-base.readWriteFile",
        typeVersion: 1.1,
        position: [240, -120],
        parameters: { fileSelector: `${FILES}/source.csv`, options: { dataPropertyName: "source" } },
      },
      {
        id: "6f1c2a10-0d1e-4c55-9a51-000000000003",
        name: "Read destination CSV",
        type: "n8n-nodes-base.readWriteFile",
        typeVersion: 1.1,
        position: [240, 120],
        parameters: { fileSelector: `${FILES}/destination.csv`, options: { dataPropertyName: "destination" } },
      },
      { id: "6f1c2a10-0d1e-4c55-9a51-000000000004", name: "Both files", type: "n8n-nodes-base.merge", typeVersion: 3.2, position: [480, 0], parameters: {} },
      {
        id: "6f1c2a10-0d1e-4c55-9a51-000000000005",
        name: "FlowAssert check",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [720, 0],
        parameters: { mode: "runOnceForAllItems", language: "javaScript", jsCode: code(bundle) },
      },
      {
        id: "6f1c2a10-0d1e-4c55-9a51-000000000006",
        name: "Verified?",
        type: "n8n-nodes-base.if",
        typeVersion: 2.2,
        position: [960, 0],
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
            conditions: [
              {
                id: "6f1c2a10-0d1e-4c55-9a51-000000000007",
                leftValue: "={{ $json.state }}",
                rightValue: "Verified",
                operator: { type: "string", operation: "equals" },
              },
            ],
            combinator: "and",
          },
          options: {},
        },
      },
    ],
    connections: {
      "Run the check": {
        main: [
          [
            { node: "Read source CSV", type: "main", index: 0 },
            { node: "Read destination CSV", type: "main", index: 0 },
          ],
        ],
      },
      "Read source CSV": { main: [[{ node: "Both files", type: "main", index: 0 }]] },
      "Read destination CSV": { main: [[{ node: "Both files", type: "main", index: 1 }]] },
      "Both files": { main: [[{ node: "FlowAssert check", type: "main", index: 0 }]] },
      "FlowAssert check": { main: [[{ node: "Verified?", type: "main", index: 0 }]] },
    },
    settings: { executionOrder: "v1" },
    pinData: {},
    meta: { templateCredsSetupCompleted: true },
  };
  return JSON.stringify(workflow, null, 2) + "\n";
}

function main(args) {
  const check = args.includes("--check");
  const at = args.indexOf("--bundle");
  const path = at === -1 ? BUNDLE : args[at + 1];
  let bundle;
  try {
    bundle = readFileSync(path, "utf-8");
  } catch {
    console.error(`${path} is missing: run npm run build:lib first`);
    return 2;
  }
  const text = workflowText(bundle);
  if (!check) {
    writeFileSync(WORKFLOW, text);
    console.log(`wrote ${WORKFLOW}`);
    return 0;
  }
  let committed = "";
  try {
    committed = readFileSync(WORKFLOW, "utf-8");
  } catch {
    committed = "";
  }
  if (committed === text) {
    console.log(`${WORKFLOW} is current`);
    return 0;
  }
  console.error(`${WORKFLOW} is not what scripts/n8n/build_workflow.mjs writes now; run it again and commit the result`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
