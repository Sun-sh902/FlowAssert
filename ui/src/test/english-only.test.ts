/**
 * FlowAssert is English only from 1.1.0 (the owner's decision of 2026-11-12): no tracked file is a Chinese copy, and no
 * Markdown document has Chinese text. Data is not text: Chinese characters in code spans and code blocks, in test
 * values, golden files and fixtures, and the historical records under service/ are not scanned.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { REPO_ROOT } from "./fixtures/sources";

const tracked = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf-8" }).split("\n").filter(Boolean);
const HISTORY = /^service\//;
/** Han characters, and the CJK and full-width punctuation that only Chinese text uses. */
const CHINESE = /[　-〿㐀-䶿一-鿿豈-﫿！-｠]/u;
/** A Markdown file's text outside fenced code blocks and code spans, where a value is a value. */
const prose = (text: string) => text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "").replace(/(`+)[^`\n][\s\S]*?\1/g, "");

describe("English only", () => {
  test("no tracked file is a Chinese copy or in a zh folder", () => {
    expect(tracked.filter((f) => !HISTORY.test(f) && (/\.zh-CN\./.test(f) || /(^|\/)zh\//.test(f)))).toEqual([]);
  });

  const documents = tracked.filter((f) => f.endsWith(".md") && !HISTORY.test(f));

  test("the documents are scanned", () => {
    expect(documents.length).toBeGreaterThan(40);
    expect(documents).toContain("docs/ROADMAP.md");
  });

  test.each(documents)("%s has no Chinese text outside code", (file) => {
    const lines = prose(readFileSync(join(REPO_ROOT, file), "utf-8")).split("\n");
    expect(lines.map((line, i) => [i + 1, line] as const).filter(([, line]) => CHINESE.test(line))).toEqual([]);
  });

  test("the scan finds Chinese text, and leaves a value in code alone", () => {
    expect(CHINESE.test(prose("A sentence, 中文."))).toBe(true);
    expect(CHINESE.test(prose("A value `名字` and\n```text\n名字 Zoë\n```\n"))).toBe(false);
  });
});
