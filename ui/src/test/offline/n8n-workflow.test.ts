/**
 * The n8n example (examples/n8n/flowassert-check.workflow.json). Its Code node must hold the packaged checker of this
 * checkout, as ui/scripts/n8n/build_workflow.mjs writes it now (the same freshness rule as golden.py --check); it must
 * use no node that runs a command or makes a request; every premise must start unstated; and its Code node, run as
 * n8n runs one (an async function with $input and this.helpers, in a context without crypto), must give the command
 * line's result for the sample files: golden case example-page-no-premises, with the origin "n8n Code node".
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { beforeAll, describe, expect, test } from "vitest";
import { REPO_ROOT } from "../fixtures/sources";
import { UI, buildBundle } from "./bundle";
import { expectedResult, withoutTime } from "./golden-cases";

const WORKFLOW = join(REPO_ROOT, "examples/n8n/flowassert-check.workflow.json");

interface Node {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
}

let bundle = "";
const workflow = JSON.parse(readFileSync(WORKFLOW, "utf-8")) as { nodes: Node[]; connections: Record<string, unknown> };
const codeNode = workflow.nodes.find((n) => n.type === "n8n-nodes-base.code")!;
const jsCode = codeNode.parameters.jsCode as string;

beforeAll(() => {
  bundle = buildBundle();
}, 120_000);

/** Run the Code node as n8n's task runner does: the code in an async function, with $input and this.helpers. */
async function runCodeNode(code: string, files: Record<string, Uint8Array>) {
  const items = Object.entries(files).map(([field, bytes]) => ({ json: {}, binary: { [field]: { data: "filesystem-v2", fileName: `${field}.csv` } }, bytes }));
  const context = createContext({ TextDecoder, TextEncoder, $input: { all: () => items.map(({ json, binary }) => ({ json, binary })) } });
  const run = runInContext(`(async function () {\n${code}\n})`, context) as (this: unknown) => Promise<{ json: Record<string, unknown> }[]>;
  const helpers = { getBinaryDataBuffer: async (index: number, field: string) => Buffer.from(items[index]!.binary[field] ? items[index]!.bytes : []) };
  return run.call({ helpers });
}

describe("the n8n example", () => {
  test("its Code node holds this checkout's packaged checker, as build_workflow.mjs writes it now", () => {
    const dir = mkdtempSync(join(tmpdir(), "flowassert-n8n-"));
    try {
      writeFileSync(join(dir, "flowassert-check.js"), bundle);
      const output = execFileSync(process.execPath, [join(UI, "scripts/n8n/build_workflow.mjs"), "--check", "--bundle", join(dir, "flowassert-check.js")], {
        cwd: UI,
        encoding: "utf-8",
      });
      expect(output).toContain("is current");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(jsCode).toContain(`\n${bundle.trimEnd()}\n`);
  });

  test("reads two files, checks them in a Code node, and branches on the state, with no command or request", () => {
    expect(workflow.nodes.map((n) => n.type)).toEqual([
      "n8n-nodes-base.manualTrigger",
      "n8n-nodes-base.readWriteFile",
      "n8n-nodes-base.readWriteFile",
      "n8n-nodes-base.merge",
      "n8n-nodes-base.code",
      "n8n-nodes-base.if",
    ]);
    const outside = jsCode.replace(bundle.trimEnd(), "");
    expect(outside).not.toMatch(/\brequire\s*\(|\bfetch\b|\bimport\s*\(|\$env|process\./);
    expect(JSON.stringify(workflow.nodes.find((n) => n.type === "n8n-nodes-base.if")!.parameters)).toContain('"leftValue":"={{ $json.state }}","rightValue":"Verified"');
  });

  test("starts with the configuration block, every premise unstated, each with what it means", () => {
    expect(jsCode.startsWith("// ===== FlowAssert check: configuration. Edit this block only. =====\n")).toBe(true);
    const block = jsCode.slice(0, jsCode.indexOf("// ===== End of the configuration. ====="));
    expect(block).toContain("FlowAssert cannot check any of them");
    for (const line of ["const SOURCE_COMPLETE = false;", "const DESTINATION_COMPLETE = false;", "const SOURCE_COUNT = null;", "const DESTINATION_COUNT = null;", "const ALLOW_IDENTICAL_CONTENT = false;"]) {
      expect(block).toContain(line);
      const before = block.slice(0, block.indexOf(line)).split("\n").at(-2)!;
      expect(before.startsWith("// "), line).toBe(true);
    }
  });

  test("its Code node gives the command line's result for the sample files, with nothing but the report's values", async () => {
    const read = (name: string) => new Uint8Array(readFileSync(join(REPO_ROOT, "offline/examples", name)));
    const json = (await runCodeNode(jsCode, { source: read("source.csv"), destination: read("destination.csv") }))[0]!.json;
    const expected = expectedResult("example-page-no-premises", "n8n Code node");
    expect(Object.keys(json)).toEqual(["state", "exit", "counts", "summary", "message", "flowassertVersion", "reportJson"]);
    expect({ exit: json.exit, summary: json.summary, message: json.message, json: withoutTime(json.reportJson as string) }).toEqual({
      exit: expected.exit,
      summary: expected.summary,
      message: expected.message,
      json: expected.json,
    });
    expect(json.state).toBe("Mismatch");
    expect({ ...(json.counts as object) }).toEqual({ ...JSON.parse(json.reportJson as string).counts });
  });

  test("a premise changed in the configuration block reaches the report, with its origin", async () => {
    const read = (name: string) => new Uint8Array(readFileSync(join(REPO_ROOT, "offline/examples", name)));
    const code = jsCode.replace("const SOURCE_COMPLETE = false;", "const SOURCE_COMPLETE = true;").replace("const DESTINATION_COMPLETE = false;", "const DESTINATION_COMPLETE = true;");
    const json = (await runCodeNode(code, { source: read("source.csv"), destination: read("destination.csv") }))[0]!.json;
    expect(withoutTime(json.reportJson as string)).toBe(expectedResult("example-page", "n8n Code node").json);
  });

  test("a missing file is an error of the node, never a result", async () => {
    await expect(runCodeNode(jsCode, { source: new Uint8Array([107, 10]) })).rejects.toThrow('FlowAssert: no input item has the binary field "destination"');
  });
});
