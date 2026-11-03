/**
 * The packaged checker as a host gets it: the script `npm run build:lib` writes (dist-lib/flowassert-check.js), built
 * here from this checkout and run in a node:vm context that has only what the bundle says it needs from its host,
 * TextDecoder and TextEncoder: no crypto, no require, no fetch, no process. Every golden case the page can run must
 * give the command line's exit status, summary, refusal and both reports byte for byte, apart from the premises'
 * origin and evaluated_at.
 */
import { existsSync, readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { createContext, runInContext } from "node:vm";
import { beforeAll, describe, expect, test } from "vitest";
import type { CheckCsvInput, CheckCsvResult } from "../../offline/api";
import { VERSION } from "../../offline/api";
import { DIST_LIB, buildBundle } from "./bundle";
import { apiInput, comparable, expectedResult, pageCases } from "./golden-cases";

interface Global {
  FlowAssert: { VERSION: string; checkCsv: (input: CheckCsvInput) => Promise<CheckCsvResult> };
}

let bundle = "";

beforeAll(() => {
  bundle = buildBundle();
}, 120_000);

/** A fresh context with only `globals`, and the bundle run in it. */
function host(globals: Record<string, unknown> = { TextDecoder, TextEncoder }) {
  const context = createContext({ ...globals });
  runInContext(bundle, context, { filename: "flowassert-check.js" });
  return context as unknown as Global & Record<string, unknown>;
}

describe("the packaged checker", () => {
  test("is one script that defines one global and imports nothing", () => {
    expect(bundle.startsWith("var FlowAssert=")).toBe(true);
    for (const pattern of [/\bimport\s*[({"'`*]/, /\bimport\./, /\brequire\s*\(/, /\bfetch\b/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /importScripts/, /\bprocess\./]) {
      expect(bundle, String(pattern)).not.toMatch(pattern);
    }
    const context = host();
    expect(Object.keys(context).sort()).toEqual(["FlowAssert", "TextDecoder", "TextEncoder"]);
    expect(Object.keys(context.FlowAssert).sort()).toEqual(["VERSION", "checkCsv"]);
    expect(context.FlowAssert.VERSION).toBe(VERSION);
    expect(context.crypto).toBeUndefined();
  });

  test("stays small enough to paste into a workflow's code step", () => {
    expect(new TextEncoder().encode(bundle).length).toBeLessThan(160_000);
  });

  test("dist-lib, when it has been built, is this build", () => {
    if (existsSync(DIST_LIB)) expect(readFileSync(DIST_LIB, "utf-8")).toBe(bundle);
  });

  test.each(pageCases)("%s, without crypto", async (name) => {
    const result = await host().FlowAssert.checkCsv(apiInput(name));
    expect(comparable(result)).toEqual(expectedResult(name, "JavaScript call"));
  });

  test("with crypto.subtle, the same digests", async () => {
    for (const name of ["example-page", "encoding-gb18030", "rules-fail"]) {
      const result = await host({ TextDecoder, TextEncoder, crypto: webcrypto }).FlowAssert.checkCsv({ ...apiInput(name), origin: "n8n Code node" });
      expect(comparable(result)).toEqual(expectedResult(name, "n8n Code node"));
    }
  });

  test("without TextDecoder, a refusal that says so", async () => {
    const result = await host({ TextEncoder }).FlowAssert.checkCsv(apiInput("example-page"));
    expect({ ...result }).toEqual({
      exit: 2,
      state: "refused",
      summary: "",
      message:
        "refused: this JavaScript host has no TextDecoder, which the check needs; FlowAssert does not decode, encode or hash another way, so it never gives an answer the command line would not\n",
      json: null,
      html: null,
    });
  });
});
