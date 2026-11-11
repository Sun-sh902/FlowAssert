/**
 * Chinese explanations of the fixed English texts (i18n/englishTexts.ts). The refusal messages and reasons are read
 * from the Python sources themselves, so a message added to the command line or the evaluator without an explanation
 * fails here; so does a line of any golden summary or refusal. In the Chinese interface the page shows each English
 * text unchanged with its explanation next to it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { glossOf, summaryGlosses } from "../i18n/englishTexts";
import { CLAIM, LIMITS } from "../offline/report";
import { inThreadRunner } from "../offline/runner";
import { Check } from "../pages/Check";
import { REPO_ROOT } from "./fixtures/sources";

vi.mock("../i18n/locale", () => ({ useLocale: () => "zh-CN", pageLocale: () => "zh-CN", setLocale: () => undefined }));

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf-8");
const CLI = read("offline/flowassert_offline/cli.py");
const SHEETS = read("offline/flowassert_offline/sheets.py");
const HUBSPOT = read("offline/flowassert_offline/hubspot.py");
const EVALUATOR = read("offline/flowassert_offline/evaluator_v2.py");
const CSV = read("ui/src/offline/csv.ts");

/**
 * The Python string literals that follow each match of `start`, joined as Python joins adjacent literals: the message
 * of one call, written over several lines. An f-string's {…} stays as written.
 */
function literalsAfter(source: string, start: RegExp): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(start)) {
    let i = m.index + m[0].length;
    let text = "";
    let found = false;
    for (;;) {
      while (/\s/.test(source[i] ?? "")) i++;
      const lit = /^(f?)"((?:[^"\\]|\\.)*)"/.exec(source.slice(i));
      if (!lit) break;
      text += lit[2]!.replace(/\\(.)/g, "$1");
      i += lit[0].length;
      found = true;
    }
    if (found) out.push(text);
  }
  return out;
}

/**
 * What each expression of an f-string can be, for the messages to explain. An expression this table does not know
 * fails the test, so a new message has to be given samples here and an explanation in englishTexts.ts.
 */
const CSV_ERRORS = [...CSV.matchAll(/new CsvError\(([`"])(.*?)\1\)/g)].map((m) => m[2]!.replace("${FIELD_LIMIT}", "131072"));
const RULE_ERRORS = literalsAfter(EVALUATOR, /raise ValueError\(/g).filter((t) => !/must be|^a field is/.test(t)).map((t) =>
  t.replace("{rule!r}", "'date:'").replace("{fmt!r}", "'%Y-%m-%d'").replace("{e}", "stray % in format '%Y %'").replace("{rule!r}", "'fuzzy'"),
);
const SAMPLES: Record<string, string[]> = {
  "{name}": ["--max-bytes", "--source-count"],
  "{kind}": ["positive", "non-negative"],
  "{', '.join(allowed)}": ["problems, all"],
  "{path}": ["source.csv"],
  "{e.strerror}": ["No such file or directory", "Permission denied"],
  "{size}": ["300000000"],
  "{max_bytes}": ["209715200"],
  "{repr(text)}": ["':phone'"],
  "{label}": ["key", "field"],
  "{name!r}": ["'key'"],
  "{e.msg}": ["Expecting value"],
  "{', '.join(unknown)}": ["keys"],
  "{', '.join(missing)}": ["fields", "phone, email"],
  "{', '.join(premises)}": ["source_complete"],
  "{', '.join(SCOPES)}": ["source, exact"],
  "{', '.join(conflicts)}": ["--key, --field"],
  "{reader.line_num}": ["7"],
  "{self.max_rows}": ["1000000"],
  "{hint}": ["", " (no byte order mark)"],
  // The Google Sheets source (sheets.py, and its options in cli.py).
  "{option}": ["--source-range", "--source-timeout", "--skip-source-revision"],
  "{text!r}": ["'A1:F'", "'Leads!F1:A'"],
  "{what}": ["Google Sheets values", "Google Drive revision metadata"],
  "{s}": ["", " PERMISSION_DENIED"],
  "{code}": ["500", "503", "418"],
  "{response.status}": ["302", "307"],
  "{self.timeout}": ["60"],
  "{self.max_bytes}": ["209715200"],
  "{detail}": ["a compressed body", "not UTF-8", "a duplicate member", "NaN is not JSON", "not JSON", "not an object", "version is not a whole number written as a string", "modifiedTime is not a string", "range is missing", "majorDimension is not ROWS", "values is not a list of rows", "a cell is not valid Unicode"],
  "{returned!r}": ["'Leads!A1:G1000'"],
  "{self.range.text!r}": ["'Leads!A1:F'"],
  "{where}": ["Leads!A1:F"],
  "{number}": ["7"],
  "{before['version']}": ["57"],
  "{before['modified_time']}": ["2026-11-05T08:00:00.000Z", "None"],
  "{after['version']}": ["58"],
  "{after['modified_time']}": ["2026-11-05T08:00:01.000Z"],
  // The HubSpot Contacts destination (hubspot.py, and its options in cli.py).
  "{WHAT}": ["HubSpot contacts"],
  "{TOKEN_VARIABLE}": ["FLOWASSERT_HUBSPOT_TOKEN"],
  "{ENDPOINT_VARIABLE}": ["FLOWASSERT_HUBSPOT_TEST_ENDPOINT"],
  "{page}": ["1", "12"],
  "{first}": ["3"],
  "{PAGE_LIMIT}": ["100"],
};

/** Every message a template can give, or an error naming an expression with no samples. */
function expand(template: string): string[] {
  const special: Record<string, string[]> = {
    // CsvFile: a csv.Error from Python's reader, whose messages csv.ts repeats.
    "{path}: {e}": CSV_ERRORS.map((e) => `source.csv: ${e}`),
    // _read_json: a duplicate member, refused inside the JSON reader.
    "{path}: {e}_json": ["config.json: duplicate member 'key'"],
    // _config_field: a comparison rule parse_rule refuses.
    "{path}: field {item['source']!r}: {e}": RULE_ERRORS.map((e) => `config.json: field 'p': ${e}`),
    // pair(): the literal is followed by + repr(text).
    "empty column name in ": ["empty column name in ':phone'", "empty column name in ''"],
    // _no_duplicate_members: re-raised by _read_json as "{path}: {e}".
    "duplicate member {name!r}": ["config.json: duplicate member 'key'"],
    "{path}: field {name} must be a string": ["config.json: field source must be a string", "config.json: field destination must be a string"],
    // CsvFile: a file that does not decode in its encoding.
    "{path}: not {label}{hint}": ["UTF-8", "UTF-16", "GB18030"].flatMap((l) => [`source.csv: not ${l}`, `source.csv: not ${l} (no byte order mark)`]),
  };
  if (special[template]) return special[template];
  let messages = [""];
  for (const piece of template.split(/(\{[^}]+\})/)) {
    if (!piece.startsWith("{")) {
      messages = messages.map((m) => m + piece);
      continue;
    }
    const values = SAMPLES[piece];
    if (!values) throw new Error(`no samples for ${piece} in ${JSON.stringify(template)}: add them, and an explanation to englishTexts.ts`);
    messages = messages.flatMap((m) => values.map((v) => m + v));
  }
  return messages;
}

describe("every message in the sources has an explanation", () => {
  // sheets.py also builds refusals that a caller raises: return Refused(…).
  const refusals = [
    ...literalsAfter(CLI, /raise Refused\(/g),
    ...literalsAfter(SHEETS, /(?:raise|return) Refused\(/g),
    ...literalsAfter(HUBSPOT, /(?:raise|return) Refused\(/g),
  ];

  test("the scan finds the command line's refusals, the reasons and the CSV errors", () => {
    expect(refusals.length).toBeGreaterThan(35);
    expect(CSV_ERRORS).toHaveLength(4);
    expect(RULE_ERRORS).toHaveLength(5);
  });

  test.each(refusals)("refused: %s", (template) => {
    const messages = expand(template);
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(glossOf(`refused: ${message}`), message).not.toBeNull();
      // The page shows a header refusal without the "refused: " the command line prints.
      expect(glossOf(message), message).not.toBeNull();
    }
  });

  test("the duplicate member a JSON file can be refused for", () => {
    for (const message of expand("{path}: {e}_json")) expect(glossOf(`refused: ${message}`)).not.toBeNull();
  });

  // Reasons: _rule(status, reason), reason = …, ["reason"] = …, the destination-only reasons, and _EMPTY.
  const reasons = [
    ...literalsAfter(EVALUATOR, /_rule\("(?:pass|fail|unknown)",/g),
    ...literalsAfter(EVALUATOR, /_rule\(status,/g),
    ...literalsAfter(EVALUATOR, /(?<!state, )\breason = /g),
    ...literalsAfter(EVALUATOR, /\["reason"\] = /g),
    ...literalsAfter(EVALUATOR, /state, reason = "Mismatch",/g),
    ...literalsAfter(EVALUATOR, /_EMPTY = /g),
  ].map((r) => r.replace("{rule[5:]!r}", "'%Y-%m-%d'"));

  test("the scan finds every reason", () => {
    expect(new Set(reasons).size).toBeGreaterThanOrEqual(20);
  });

  test.each([...new Set(reasons)])("reason: %s", (reason) => {
    expect(glossOf(reason)).not.toBeNull();
  });

  test.each(RULE_ERRORS)("a date format the page refuses: %s", (message) => {
    expect(glossOf(message)).not.toBeNull();
  });

  test("the browser's own date format refusal", () => {
    expect(glossOf("date format '%Y %a' uses %a, which the browser check does not support; it supports %Y %m %d")!.zh).toContain("浏览器核对不支持");
  });

  test("the claim and the limitations", () => {
    expect(glossOf(CLAIM)!.id).toBe("claim");
    expect(glossOf(LIMITS)!.id).toBe("limitations");
  });

  test("an internal failure", () => {
    expect(glossOf("failed: MemoryError")!.zh).toContain("没有得出任何结论");
  });
});

describe("every golden summary line and refusal has an explanation", () => {
  const ROOTS = ["offline/golden", "offline/golden-sheets", "offline/golden-hubspot"];
  const names = ROOTS.flatMap((root) => readdirSync(join(REPO_ROOT, root)).sort().map((n) => `${root}/${n}`));

  test.each(names)("%s", (path) => {
    const GOLDEN = join(REPO_ROOT, path, "..");
    const name = path.split("/").pop()!;
    const stdout = readFileSync(join(GOLDEN, name, "stdout.txt"), "utf-8");
    for (const line of stdout.split("\n").filter(Boolean)) expect(glossOf(line), line).not.toBeNull();
    const stderr = readFileSync(join(GOLDEN, name, "stderr.txt"), "utf-8").trim();
    if (stderr) expect(glossOf(stderr), stderr).not.toBeNull();
  });

  test("a rule line explains the reason, and says what the values in brackets are", () => {
    expect(glossOf("    field:phone fail: exact string comparison ('+1 212 555 0102' vs '+1 212 555 0199')")!.zh).toBe("规则 field:phone 不通过：按原样比较字符串。括号里依次是来源值和目标值。");
    expect(glossOf("    field:signed unknown: value does not match date format '%Y-%m-%d' ('2026-01-02' vs '02/01/2026'), compared as ('2026-01-02T00:00:00' vs None)")!.zh).toContain("按规则比较时的值");
  });

  test("the summary's explanations, one per kind of line", () => {
    const lines = summaryGlosses(readFileSync(join(REPO_ROOT, "offline/golden", "example", "stdout.txt"), "utf-8"));
    // Three record lines share one explanation.
    expect(lines.filter((l) => l.line.startsWith("  record"))).toHaveLength(1);
    expect(lines[0]!.zh).toBe("批次结果：不一致。来源有 4 行，总数 4。");
  });

  test("an unknown text has none", () => {
    expect(glossOf("something else entirely")).toBeNull();
  });
});

describe("on the page, in the Chinese interface", () => {
  const example = (file: string) => new File([readFileSync(join(REPO_ROOT, "offline/examples", file))], file, { type: "text/csv" });

  test("each English text stays as written, with its explanation next to it", async () => {
    const user = userEvent.setup();
    render(<Check runner={inThreadRunner()} />);
    await user.upload(screen.getByTestId("source-file"), example("source.csv"));
    await user.upload(screen.getByTestId("destination-file"), example("destination.csv"));
    await waitFor(() => expect(screen.getAllByText("3 columns")).toHaveLength(2));
    for (const [id, value] of [["key-source", "external_id"], ["key-destination", "external_id"], ["field-0-source", "phone"], ["field-0-destination", "phone"]] as const) {
      await user.selectOptions(screen.getByTestId(id), value);
    }
    await user.click(screen.getByTestId("source-complete"));
    await user.click(screen.getByTestId("destination-complete"));
    await user.click(screen.getByTestId("run-check"));
    const result = await screen.findByRole("region", { name: "Result" }, { timeout: 5000 });
    // A reason: the English as the evaluator wrote it, then the explanation.
    // The record, chosen in the result explorer, shows its rule results in the panel.
    await user.click(
      await waitFor(() => {
        const option = result.querySelector<HTMLElement>('[data-record="2"]');
        if (!option) throw new Error("record 2 is not listed yet");
        return option;
      }),
    );
    const record = await within(result).findByTestId("record-panel");
    expect(within(record).getAllByText("exact string comparison").length).toBeGreaterThan(0);
    expect(record.querySelector('[data-gloss="reason-exact"]')!.textContent).toBe("按原样比较字符串。");
    // The limitations, in English, with their explanation.
    expect(within(result).getAllByText(LIMITS).length).toBeGreaterThan(0);
    expect(result.querySelector('[data-gloss="limitations"]')).not.toBeNull();
    // The summary is the command line's; its lines are explained beside it.
    const glosses = within(result).getByTestId("summary-glosses");
    expect(glosses.textContent).toContain("Mismatch: 4 rows of 4");
    expect(glosses.textContent).toContain("批次结果：不一致。");
  });

  test("a refusal stays as the command line prints it, with its explanation", async () => {
    const user = userEvent.setup();
    render(<Check runner={inThreadRunner()} />);
    await user.upload(screen.getByTestId("source-file"), new File(["k,p,p\n1,2,3\n"], "s.csv"));
    expect(await screen.findByText("s.csv: repeated column name")).toBeTruthy();
    expect(document.querySelector('[data-gloss="repeated-column"]')!.textContent).toBe("s.csv：表头中有列名重复出现。");
  });
});

describe("the trial feedback form, one language at a time", () => {
  const form = (name: string) => read(`.github/ISSUE_TEMPLATE/${name}`);
  const ids = (text: string) => [...text.matchAll(/^\s+id: (\S+)$/gm)].map((m) => m[1]);

  test("the English form holds no Chinese, the Chinese copy asks the same questions", () => {
    const english = form("trial_feedback.yml");
    const chinese = form("trial_feedback_zh-CN.yml");
    expect(english).not.toMatch(/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/);
    expect(chinese).toMatch(/[\u4e00-\u9fff]/);
    expect(ids(chinese)).toEqual(ids(english));
    expect(ids(english).length).toBeGreaterThan(0);
  });

  test("the Chinese interface links to the Chinese copy, with nothing but the template in its address", () => {
    render(<Check runner={inThreadRunner()} />);
    const url = new URL((screen.getByTestId("give-feedback") as HTMLAnchorElement).href);
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/Sun-sh902/FlowAssert/issues/new");
    expect([...url.searchParams]).toEqual([["template", "trial_feedback_zh-CN.yml"]]);
  });
});
