/**
 * Byte-for-byte parity with the command-line checker for workbooks: every case in offline/golden-xlsx/ (written by
 * offline/bench/golden.py from offline/bench/xlsx_cases.py) is run through the TypeScript check, and the exit status,
 * the printed summary, the refusal and both reports must be identical. docs/design/1.1-excel.md.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, reportHtml, reportJson } from "../../offline/check";
import { compareCodePoints } from "../../offline/pystr";
import { REPO_ROOT } from "../fixtures/sources";
import { parseArgs } from "./cli-args";

const GOLDEN = join(REPO_ROOT, "offline/golden-xlsx");
const EVALUATED_AT = () => "2000-01-01T00:00:00Z";
const text = (folder: string, file: string) => (existsSync(join(folder, file)) ? readFileSync(join(folder, file), "utf-8") : null);
const names = readdirSync(GOLDEN).sort(compareCodePoints);

describe("golden workbook reports", () => {
  test("the folder holds the workbook cases golden.py writes", () => {
    expect(names.length).toBeGreaterThanOrEqual(60);
  });

  test.each(names)("%s, as the command line runs it", async (name) => {
    const folder = join(GOLDEN, name);
    const c = JSON.parse(readFileSync(join(folder, "case.json"), "utf-8")) as { args: string[] };
    const outcome = await check({ ...parseArgs(c.args, folder), now: EVALUATED_AT });
    expect({
      exit: outcome.exit,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      json: outcome.report ? reportJson(outcome.report) : null,
      html: outcome.report ? reportHtml(outcome.report) : null,
    }).toEqual({
      exit: Number(text(folder, "exit_status.txt")),
      stdout: text(folder, "stdout.txt"),
      stderr: text(folder, "stderr.txt"),
      json: text(folder, "report.json"),
      html: text(folder, "report.html"),
    });
  });
});
