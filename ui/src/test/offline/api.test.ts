/**
 * The packaged checker's function, checkCsv (api.ts), in this process: every golden case the page can run gives the
 * command line's exit status, summary, refusal and reports, with the caller's origin, with and without crypto.subtle;
 * its own inputs are refused when they are not what it documents; and a host that lacks, or answers differently for,
 * something the check needs is refused, never worked around.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { API_ORIGINS, VERSION, checkCsv, type CheckCsvInput } from "../../offline/api";
import { REPO_ROOT } from "../fixtures/sources";
import { GOLDEN, apiInput, comparable, expectedResult, pageCases } from "./golden-cases";

const STATES = { 0: "Verified", 1: "Mismatch", 3: "Unverified", 2: "refused", 4: "failed" } as const;

const example = (): CheckCsvInput => ({
  source: { name: "source.csv", content: readFileSync(join(REPO_ROOT, "offline/examples/source.csv")) },
  destination: { name: "destination.csv", content: readFileSync(join(REPO_ROOT, "offline/examples/destination.csv")) },
  config: { key: ["external_id", "external_id"], fields: [{ source: "phone", destination: "phone", rule: "exact" }], scope: "source" },
  sourceComplete: true,
  destinationComplete: true,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkCsv on the golden cases", () => {
  test("the version is the command line's", () => {
    const python = readFileSync(join(REPO_ROOT, "offline/flowassert_offline/__init__.py"), "utf-8");
    expect(python).toContain(`__version__ = "${VERSION}"`);
  });

  test.each(pageCases)("%s", async (name) => {
    const result = await checkCsv(apiInput(name));
    const expected = expectedResult(name, "JavaScript call");
    expect(comparable(result)).toEqual(expected);
    expect(result.state).toBe(STATES[expected.exit as keyof typeof STATES]);
  });

  test.each(pageCases.filter((_, i) => i % 4 === 0))("%s, without crypto.subtle", async (name) => {
    vi.stubGlobal("crypto", undefined);
    expect(globalThis.crypto).toBeUndefined();
    const result = await checkCsv({ ...apiInput(name), origin: "n8n Code node" });
    expect(comparable(result)).toEqual(expectedResult(name, "n8n Code node"));
  });
});

describe("checkCsv inputs", () => {
  test("the origins a caller may choose", async () => {
    expect(API_ORIGINS).toEqual(["JavaScript call", "n8n Code node"]);
    expect((await checkCsv(example())).json).toContain('"origin": "JavaScript call"');
    expect((await checkCsv({ ...example(), origin: "n8n Code node" })).json).toContain('"origin": "n8n Code node"');
    for (const origin of ["command-line option", "browser form", "javascript call", ""]) {
      const result = await checkCsv({ ...example(), origin: origin as "JavaScript call" });
      expect(result).toEqual({
        exit: 2,
        state: "refused",
        summary: "",
        message: "refused: origin must be one of: JavaScript call, n8n Code node\n",
        json: null,
        html: null,
      });
    }
  });

  test("text, bytes and an ArrayBuffer give the same result; a configuration as text, bytes or value too", async () => {
    const bytes = await checkCsv(example());
    const input = example();
    const source = input.source.content as Uint8Array;
    const configText = JSON.stringify(input.config, null, 2) + "\n";
    const variants: CheckCsvInput[] = [
      { ...input, source: { ...input.source, content: new TextDecoder().decode(source) } },
      { ...input, source: { ...input.source, content: new Uint8Array(source).buffer } },
      { ...input, config: configText },
      { ...input, config: new TextEncoder().encode(configText) },
    ];
    for (const variant of variants) expect(comparable(await checkCsv(variant))).toEqual(comparable(bytes));
  });

  test("the premises are not stated unless they are exactly true", async () => {
    const { sourceComplete: _s, destinationComplete: _d, ...none } = example();
    const result = await checkCsv(none);
    expect(result.state).toBe("Mismatch");
    expect(result.json).toContain('"source_complete": {\n      "origin": "JavaScript call",\n      "stated": false\n    }');
    expect(result.summary).toContain("Source population unknown: the batch cannot be Verified.");
  });

  test.each([
    ["sourceComplete", "true", "sourceComplete must be true or false"],
    ["destinationComplete", 1, "destinationComplete must be true or false"],
    ["allowIdenticalContent", "yes", "allowIdenticalContent must be true or false"],
    ["sourceCount", true, "sourceCount must be a string, an integer or null"],
    ["destinationCount", 1.5, "destinationCount must be a string, an integer or null"],
  ])("%s = %j is refused", async (name, value, message) => {
    const result = await checkCsv({ ...example(), [name]: value } as unknown as CheckCsvInput);
    expect(result).toMatchObject({ exit: 2, state: "refused", message: `refused: ${message}\n`, json: null });
  });

  test("counts are taken as the command line takes them", async () => {
    const result = await checkCsv({ ...example(), sourceCount: 4, destinationCount: "+0_5" });
    expect(result.json).toContain('"source_count": {\n      "matched": true,\n      "observed": 4,\n      "origin": "JavaScript call",\n      "stated": 4\n    }');
    expect(result.summary).toContain("Destination count stated 5, file has 4 rows: absence and uniqueness stay unknown.");
    expect((await checkCsv({ ...example(), sourceCount: "4 " })).message).toBe("refused: --source-count must be a non-negative integer\n");
  });

  test.each([
    ["an empty name", { source: { name: "", content: "k\n" } }, "source name must be a non-empty string"],
    ["no source", { source: null }, "source must be an object with name, content and encoding"],
    ["a number for content", { destination: { name: "d.csv", content: 7 } }, "destination content must be a Uint8Array, an ArrayBuffer or a string"],
    ["text to read as gb18030", { source: { name: "s.csv", content: "k,p\n", encoding: "gb18030" } }, "source content as text can only be read as utf-8; pass the file's bytes for gb18030"],
    ["text with a lone surrogate", { source: { name: "s.csv", content: "k,p\n\ud800,1\n" } }, "source content is not well-formed text (it has a lone surrogate); pass its bytes instead"],
    ["no configuration", { config: undefined }, "config is required: key, fields and scope, as in a --config file"],
    ["a configuration JSON cannot hold", { config: { a: 1n } }, "config cannot be written as JSON"],
  ])("%s is refused", async (_, change, message) => {
    const result = await checkCsv({ ...example(), ...change } as unknown as CheckCsvInput);
    expect(result).toMatchObject({ exit: 2, state: "refused", summary: "", message: `refused: ${message}\n`, json: null, html: null });
  });

  test("the configuration file's own refusals are the command line's", async () => {
    const premise = await checkCsv({ ...example(), config: { ...(example().config as object), source_complete: true } });
    expect(premise.message).toBe(
      "refused: configuration: source_complete cannot be set in a configuration file; completeness statements and counts are command-line options, chosen at each run\n",
    );
    const encoding = await checkCsv({ ...example(), source: { ...example().source, encoding: "latin-1" } });
    expect(encoding.message).toBe("refused: --source-encoding must be one of: utf-8, utf-16, gb18030\n");
  });

  test("a call that is not an object is refused, and nothing throws", async () => {
    for (const input of [undefined, null, "source.csv"]) {
      const result = await checkCsv(input as unknown as CheckCsvInput);
      expect(result.message).toBe("refused: checkCsv takes one object: source, destination, config and the premises\n");
    }
  });
});

describe("checkCsv and its host", () => {
  const NOT_ANOTHER_WAY = "FlowAssert does not decode, encode or hash another way, so it never gives an answer the command line would not";
  const gb18030 = () => apiInput("encoding-gb18030");

  test("without TextDecoder the check is refused", async () => {
    vi.stubGlobal("TextDecoder", undefined);
    const result = await checkCsv(example());
    expect(result.message).toBe(`refused: this JavaScript host has no TextDecoder, which the check needs; ${NOT_ANOTHER_WAY}\n`);
  });

  test("without a gb18030 decoder only a gb18030 file is refused", async () => {
    const Real = TextDecoder;
    vi.stubGlobal(
      "TextDecoder",
      class extends Real {
        constructor(label?: string, options?: TextDecoderOptions) {
          if (label === "gb18030") throw new RangeError("unsupported");
          super(label, options);
        }
      },
    );
    expect((await checkCsv(example())).state).toBe("Mismatch");
    expect((await checkCsv(gb18030())).message).toBe(`refused: this JavaScript host has no TextDecoder for gb18030, which the check needs; ${NOT_ANOTHER_WAY}\n`);
  });

  test("a decoder that does not reject invalid bytes is refused", async () => {
    const Real = TextDecoder;
    vi.stubGlobal(
      "TextDecoder",
      class extends Real {
        constructor(label?: string) {
          super(label); // drops fatal: invalid bytes become U+FFFD
        }
      },
    );
    expect((await checkCsv(example())).message).toBe(
      `refused: this JavaScript host has a TextDecoder that does not reject invalid utf-8, which the check needs; ${NOT_ANOTHER_WAY}\n`,
    );
  });

  test("a utf-16 decoder that decodes differently is refused", async () => {
    const Real = TextDecoder;
    vi.stubGlobal(
      "TextDecoder",
      class extends Real {
        constructor(label?: string, options?: TextDecoderOptions) {
          super(label === "utf-16be" ? "utf-16le" : label, options);
        }
      },
    );
    const input = apiInput("encoding-utf16-be");
    expect((await checkCsv(input)).message).toBe(
      `refused: this JavaScript host has a TextDecoder that decodes utf-16be differently, which the check needs; ${NOT_ANOTHER_WAY}\n`,
    );
  });

  test("without TextEncoder or BigInt the check is refused", async () => {
    vi.stubGlobal("TextEncoder", undefined);
    expect((await checkCsv(example())).message).toBe(`refused: this JavaScript host has no TextEncoder, which the check needs; ${NOT_ANOTHER_WAY}\n`);
    vi.unstubAllGlobals();
    vi.stubGlobal("BigInt", undefined);
    expect((await checkCsv(example())).message).toBe(`refused: this JavaScript host has no BigInt, which the check needs; ${NOT_ANOTHER_WAY}\n`);
  });

  test("the page's digest still needs crypto.subtle: importing the page's modules sets no other digest", async () => {
    vi.resetModules();
    const { sha256Hex } = await import("../../offline/csv");
    vi.stubGlobal("crypto", undefined);
    await expect(sha256Hex(new Uint8Array([1]))).rejects.toThrow();
  });

  test("the golden folder is where the cases are", () => {
    expect(GOLDEN.endsWith(join("offline", "golden"))).toBe(true);
    expect(pageCases.length).toBeGreaterThanOrEqual(50);
  });
});
