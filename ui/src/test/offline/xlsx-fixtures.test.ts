/**
 * The browser's .xlsx reader beyond the golden cases (docs/design/1.1-excel.md): workbooks from independent writers
 * (offline/xlsx-fixtures/, the same expected rows scripts/dev/tests/test_xlsx.py requires of Python), the bound on
 * ZIP entries, and the packaged checker and the page's check on a workbook, as the command line runs them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { checkCsv } from "../../offline/api";
import { Refused } from "../../offline/csv";
import { pageCheck } from "../../offline/pageCheck";
import { reportJson } from "../../offline/check";
import { readXlsx } from "../../offline/xlsx";
import { REPO_ROOT } from "../fixtures/sources";
import { inputFile } from "./cli-args";

const FIXTURES = join(REPO_ROOT, "offline/xlsx-fixtures");
const EXPECTED = JSON.parse(readFileSync(join(FIXTURES, "expected.json"), "utf-8")) as Record<
  string,
  { worksheet: string | null; rows: string[][]; cells?: unknown; hidden_rows?: number; merged_ranges?: number; date_system?: string; worksheet_state?: string; sheets?: number }
>;
const blobOf = (path: string) => new Blob([new Uint8Array(readFileSync(path))]);

describe("workbooks from independent writers", () => {
  test.each(Object.keys(EXPECTED).sort())("%s", async (name) => {
    const expected = EXPECTED[name]!;
    const rows: string[][] = [];
    const read = await readXlsx({ name, blob: blobOf(join(FIXTURES, name.split("#")[0]!)) }, null, (values) => void rows.push(values), {
      worksheet: expected.worksheet ?? undefined,
    });
    expect([read.header, ...rows]).toEqual(expected.rows);
    for (const member of ["cells", "hidden_rows", "merged_ranges", "date_system", "worksheet_state", "sheets"] as const) {
      if (expected[member] !== undefined) expect(read.member[member]).toEqual(expected[member]);
    }
  });
});

/** A ZIP archive of stored, empty entries named p0, p1, ... */
function emptyEntries(count: number): Uint8Array {
  const parts: number[] = [];
  const central: number[] = [];
  const u16 = (out: number[], v: number) => out.push(v & 0xff, v >>> 8);
  const u32 = (out: number[], v: number) => out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24);
  for (let i = 0; i < count; i++) {
    const name = [...`p${i}`].map((c) => c.charCodeAt(0));
    const offset = parts.length;
    u32(parts, 0x04034b50);
    [20, 0, 0, 0, 0].forEach((v) => u16(parts, v));
    [0, 0, 0].forEach((v) => u32(parts, v));
    u16(parts, name.length);
    u16(parts, 0);
    parts.push(...name);
    u32(central, 0x02014b50);
    [20, 20, 0, 0, 0, 0].forEach((v) => u16(central, v));
    [0, 0, 0].forEach((v) => u32(central, v));
    [name.length, 0, 0, 0, 0].forEach((v) => u16(central, v));
    u32(central, 0);
    u32(central, offset);
    central.push(...name);
  }
  const end: number[] = [];
  u32(end, 0x06054b50);
  [0, 0, count, count].forEach((v) => u16(end, v));
  u32(end, central.length);
  u32(end, parts.length);
  u16(end, 0);
  return Uint8Array.from([...parts, ...central, ...end]);
}

describe("bounds no golden case holds", () => {
  test("more than 10000 ZIP entries are refused, 10000 are read", async () => {
    const refusal = (bytes: Uint8Array) =>
      readXlsx({ name: "book.xlsx", blob: new Blob([bytes as Uint8Array<ArrayBuffer>]) }, null, () => undefined).then(
        () => "read",
        (e: unknown) => (e instanceof Refused ? e.message : String(e)),
      );
    expect(await refusal(emptyEntries(10_001))).toBe("book.xlsx: more than 10000 ZIP entries");
    expect(await refusal(emptyEntries(10_000))).toBe("book.xlsx: missing part [Content_Types].xml");
  });
});

describe("the packaged checker and the page's check on a workbook", () => {
  const folder = join(REPO_ROOT, "offline/golden-xlsx/xlsx-as-the-page-runs-it");
  const golden = readFileSync(join(folder, "report.json"), "utf-8");
  const now = () => "2000-01-01T00:00:00Z";

  test("the page gives the command line's report, with its own origin", async () => {
    const outcome = await pageCheck({
      source: inputFile(folder, "source.xlsx"),
      destination: inputFile(folder, "destination.csv"),
      sourceEncoding: "utf-8",
      destinationEncoding: "utf-8",
      sourceFormat: "xlsx",
      config: { loaded: inputFile(folder, "config.json") },
      sourceComplete: true,
      destinationComplete: true,
      sourceCount: null,
      destinationCount: null,
      allowIdenticalContent: false,
      sameFile: false,
      now,
    });
    expect(outcome.stdout).toBe(readFileSync(join(folder, "stdout.txt"), "utf-8"));
    expect(reportJson(outcome.report!)).toBe(golden.replaceAll('"origin": "command-line option"', '"origin": "browser form"'));
  });

  test("checkCsv reads a workbook given as bytes", async () => {
    const result = await checkCsv({
      source: { name: "source.xlsx", content: new Uint8Array(readFileSync(join(folder, "source.xlsx"))), format: "xlsx" },
      destination: { name: "destination.csv", content: readFileSync(join(folder, "destination.csv"), "utf-8") },
      config: readFileSync(join(folder, "config.json"), "utf-8"),
      sourceComplete: true,
      destinationComplete: true,
    });
    expect(result.exit).toBe(1);
    expect(result.summary).toBe(readFileSync(join(folder, "stdout.txt"), "utf-8"));
    const report = JSON.parse(result.json!) as { evaluated_at: string };
    const expected = JSON.parse(golden.replaceAll('"origin": "command-line option"', '"origin": "JavaScript call"')) as { evaluated_at: string };
    expect({ ...report, evaluated_at: "" }).toEqual({ ...expected, evaluated_at: "" });
  });

  test("checkCsv refuses a workbook's arguments it cannot use", async () => {
    const bytes = new Uint8Array(readFileSync(join(folder, "source.xlsx")));
    const base = { destination: { name: "d.csv", content: "external_id\n" }, config: readFileSync(join(folder, "config.json"), "utf-8") };
    expect((await checkCsv({ ...base, source: { name: "s.xlsx", content: bytes, format: "xls" } })).message).toBe("refused: source format must be csv or xlsx\n");
    expect((await checkCsv({ ...base, source: { name: "s.xlsx", content: bytes, format: "xlsx", encoding: "utf-8" } })).message).toBe(
      "refused: source encoding does not apply to a workbook\n",
    );
    expect((await checkCsv({ ...base, source: { name: "s.csv", content: "a\n", worksheet: "S" } })).message).toBe("refused: source worksheet needs format xlsx\n");
    expect((await checkCsv({ ...base, source: { name: "s.xlsx", content: "text", format: "xlsx" } })).message).toBe(
      "refused: source content of a workbook must be its bytes: a Uint8Array or an ArrayBuffer\n",
    );
  });
});
