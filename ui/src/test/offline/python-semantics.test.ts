/**
 * The Python behaviour the browser check reproduces, against values printed by CPython 3.15 (the expected values
 * below were produced with str.casefold, repr and evaluator_v2._normalize / parse_rule). The golden and random parity
 * suites cover the same ground end to end; these name the individual characters and formats.
 */
import { describe, expect, test } from "vitest";
import { EvaluatorError, compare, parseRule } from "../../offline/evaluator";
import { pyDumps } from "../../offline/pyjson";
import { compareCodePoints, htmlEscape, pyCasefold, pyRepr, pyStrip } from "../../offline/pystr";
import { PyValueError, normalizeDate } from "../../offline/strptime";

describe("str.casefold", () => {
  // Full case folding, not toLowerCase: ß and ẞ fold to ss, the long s to s, ligatures expand, final sigma folds to σ,
  // lower-case Cherokee folds to upper case, dotted capital I keeps its dot, and dotless ı is unchanged.
  const PYTHON: Record<string, string> = {
    Straße: "strasse", STRASSE: "strasse", "\u1e9e": "ss", "\u017f": "s", "\ufb01": "fi", "\ufb00": "ff", "\u0390": "\u03b9\u0308\u0301",
    "\u03a3\u0391\u03a3": "\u03c3\u03b1\u03c3", "\u03c2": "\u03c3", "\uab70": "\u13a0", "\u13a0": "\u13a0", "\u0130stanbul": "i\u0307stanbul",
    "\u212a": "k", "\u00c5": "\u00e5", "\u00b5": "\u03bc", "\u1f88": "\u1f00\u03b9", "\u0131": "\u0131", "\ud801\udc00": "\ud801\udc28",
    "\u01c4": "\u01c6", "\u0149": "\u02bcn", "\ufb06": "st",
  };
  test.each(Object.entries(PYTHON))("%s", (input, folded) => expect(pyCasefold(input)).toBe(folded));

  test("toLowerCase would differ", () => {
    expect("Straße".toLowerCase()).not.toBe("STRASSE".toLowerCase());
    expect(compare("Straße", "STRASSE", "casefold").status).toBe("pass");
    expect(compare("ΣΑΣ", "σας", "casefold").status).toBe("pass");
  });
});

test("repr", () => {
  const PYTHON: [string, string][] = [
    ["a'b", "\"a'b\""], ['a"b', "'a\"b'"], ["a'\"b", "'a\\'\"b'"],
    ["\u0000\u001f\u007f\u0080\u0085\u00a0\u00ad", "'\\x00\\x1f\\x7f\\x80\\x85\\xa0\\xad'"],
    ["\u200b\u2028\ufeff\ue000", "'\\u200b\\u2028\\ufeff\\ue000'"],
    ["\ud83d\ude00\udb40\udc01\udbff\udfff", "'\ud83d\ude00\\U000e0001\\U0010ffff'"],
    ["tab\tnl\ncr\r\\", "'tab\\tnl\\ncr\\r\\\\'"], ["\u540d\u5b57 Zo\u00eb", "'\u540d\u5b57 Zo\u00eb'"], ["\u0378", "'\\u0378'"],
  ];
  for (const [value, shown] of PYTHON) expect(pyRepr(value)).toBe(shown);
  expect(pyRepr(null)).toBe("None");
});

test("str.strip, sorting, json.dumps and html.escape", () => {
  expect(pyStrip("\x1c\x85 a \u3000\t")).toBe("a");
  expect(pyStrip("\ufeffa")).toBe("\ufeffa"); // not whitespace to Python, unlike String.prototype.trim
  expect(["\uffff", "\ud83d\ude00", "a"].sort(compareCodePoints)).toEqual(["a", "\uffff", "\ud83d\ude00"]);
  expect(pyDumps({ b: ["é", "😀", "\x7f"], a: null }, { indent: 2, sortKeys: true })).toBe(
    '{\n  "a": null,\n  "b": [\n    "\\u00e9",\n    "\\ud83d\\ude00",\n    "\\u007f"\n  ]\n}',
  );
  expect(pyDumps([[], {}, true, 1n])).toBe("[[], {}, true, 1]");
  expect(htmlEscape(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#x27;&amp;&#x27;&lt;/a&gt;");
});

describe("date rule", () => {
  const PYTHON: [string, string, string | null][] = [
    ["%Y-%m-%d", "\u0662\u0660\u0662\u0666-\u0660\u0661-\u0660\u0662", null],
    ["%Y-%m-%d", "2026-1\u0663-01", null],
    ["%Y-%d-%m", "2026-1\u0663-01", "2026-01-13T00:00:00"],
    ["%Y %b", "2026 MAY", "2026-05-01T00:00:00"],
    ["%Y %B", "2026 apr\u0130l", null],
    ["%Y %b", "2026 \u017fep", null],
    ["%Y %b", "2026 seP", "2026-09-01T00:00:00"],
    ["%Y%m%d", "20260102", "2026-01-02T00:00:00"],
    ["%Y %j", "2024 366", "2024-12-31T00:00:00"],
    ["%Y %j", "2023 366", "2024-01-01T00:00:00"],
    ["%y", "69", "1969-01-01T00:00:00"],
    ["%y", "68", "2068-01-01T00:00:00"],
    ["%I %p %Y", "12 PM 2026", "2026-01-01T12:00:00"],
    ["%I %Y", "12 2026", "2026-01-01T00:00:00"],
    ["%H:%M:%S.%f", "1:2:3.4", "1900-01-01T01:02:03.400000"],
    ["%Y %z", "2026 +01:02:03.000004", "2025-12-31T22:57:56.999996+00:00"],
    ["%Y %z", "2026 -0000", "2026-01-01T00:00:00+00:00"],
    ["%Y %z", "2026 +01:0203", null],
    ["%Y\u001c%m", "2026\u0085\u300003", "2026-03-01T00:00:00"],
    ["%Y %m", "2026\t03", "2026-03-01T00:00:00"],
    ["%YT%H", "2026t05", "2026-01-01T05:00:00"],
    ["%Y'%m", "2026\u02bc03", "2026-03-01T00:00:00"],
    ["%Y %d", "2026  5", "2026-01-05T00:00:00"],
    ["%Y-%m-%d %H:%M:%S", "2026-02-29 00:00:00", null],
    ["%Y-%m-%d %H:%M:%S", "2024-02-29 23:59:61", null],
    ["%Y-%m-%d %H:%M:%S", "2024-02-29 23:59:60", null],
    ["%Y %H", "2026 24", null],
  ];
  test.each(PYTHON)("%s on %j", (format, value, normalized) => {
    expect(compare(value, value, "date:" + format).expected_normalized).toBe(normalized);
  });

  test("a UTC conversion outside the years 1–9999 gives no value, so the field is unknown", () => {
    expect(() => normalizeDate("0001-01-01 00:00 +0100", "%Y-%m-%d %H:%M %z")).toThrow(PyValueError);
    expect(() => normalizeDate("9999-12-31 23:59 -0100", "%Y-%m-%d %H:%M %z")).toThrow(PyValueError);
    expect(compare("0001-01-01 00:00 +0100", "0001-01-01 00:00 +0100", "date:%Y-%m-%d %H:%M %z")).toMatchObject({
      status: "unknown",
      reason: "value does not match date format '%Y-%m-%d %H:%M %z'",
      expected_normalized: null,
    });
  });

  test("formats Python refuses get Python's message", () => {
    const PYTHON: [string, string][] = [
      ["date:%q", "malformed date format '%q' ('q' is a bad directive in format '%q')"],
      ["date:%Y-%", "malformed date format '%Y-%' (stray % in format '%Y-%')"],
      ["date:%-d %Y", "malformed date format '%-d %Y' ('-d' is a bad directive in format '%-d %Y')"],
      ["date:%Y %\t", "malformed date format '%Y %\\t' (stray % in format '%Y %\t')"],
      ["date:%d", "malformed date format '%d' (Day of month directive '%d' may not be used without a year directive. Parsing dates involving a day of month without a year is ambiguous and fails to parse leap day. Add a year to the input and format. See https://github.com/python/cpython/issues/70647.)"],
      ["date:", "date rule 'date:' has no format"],
      ["date:%%Y", "date format '%%Y' has no directive"],
      ["Trim", "unknown comparison rule 'Trim'; use exact, trim, casefold, digits or date:FORMAT"],
    ];
    for (const [rule, message] of PYTHON) expect(() => parseRule(rule)).toThrow(new EvaluatorError(message));
    expect(parseRule("date:%Y %%")).toBe("date:%Y %%");
  });

  test("directives Python accepts but this check does not are refused as unsupported in the browser", () => {
    for (const rule of ["date:%Y %a", "date:%Y %e", "date:%Y %:z", "date:%c"]) expect(() => parseRule(rule)).toThrow(/does not support/);
  });

  test("a repeated directive, which Python's re.compile cannot compile, is refused with parse_rule's message", () => {
    expect(() => parseRule("date:%Y %Y")).toThrow(new EvaluatorError("date format '%Y %Y' repeats a directive"));
    expect(() => parseRule("date:%H %H %Y")).toThrow(new EvaluatorError("date format '%H %H %Y' repeats a directive"));
  });
});
