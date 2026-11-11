/**
 * The character diff (offline/chardiff.ts): an alignment that rebuilds both values and is a longest common
 * subsequence, with fixed tie-breaking; invisible characters drawn as tokens; code points of what differs; and the
 * notes about normalisation and case.
 */
import { describe, expect, test } from "vitest";
import { MAX_CELLS, align, codePoints, notes, pieces, token, type Run } from "../../offline/chardiff";
import { random } from "./random-cases";

const text = (runs: Run[]) => runs.map((r) => r.text).join("");
const same = (runs: Run[]) => runs.filter((r) => r.kind === "same").map((r) => r.text).join("");

/** The length of a longest common subsequence, by the textbook recurrence. */
function lcsLength(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i++) {
    const row = [0];
    for (let j = 1; j <= b.length; j++) row.push(a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, row[j - 1]!));
    prev = row;
  }
  return prev[b.length]!;
}

describe("align", () => {
  test("a changed digit, a trailing space, an accent written two ways", () => {
    expect(align("+1 555 0102", "+1 555 0109")).toEqual({
      source: [{ kind: "same", text: "+1 555 010" }, { kind: "deleted", text: "2" }],
      destination: [{ kind: "same", text: "+1 555 010" }, { kind: "inserted", text: "9" }],
      tooLong: false,
    });
    expect(align("B2", "B2 ").destination).toEqual([{ kind: "same", text: "B2" }, { kind: "inserted", text: " " }]);
    expect(align("café", "café")).toEqual({
      source: [{ kind: "same", text: "caf" }, { kind: "deleted", text: "é" }],
      destination: [{ kind: "same", text: "caf" }, { kind: "inserted", text: "é" }],
      tooLong: false,
    });
  });

  test("code points, not UTF-16 units: a character outside the BMP is one character", () => {
    expect(align("a😀b", "a😁b").source).toEqual([{ kind: "same", text: "a" }, { kind: "deleted", text: "😀" }, { kind: "same", text: "b" }]);
  });

  test("ties are broken the same way every time: a deletion before an insertion", () => {
    expect(align("ab", "ba")).toEqual({
      source: [{ kind: "deleted", text: "a" }, { kind: "same", text: "b" }],
      destination: [{ kind: "same", text: "b" }, { kind: "inserted", text: "a" }],
      tooLong: false,
    });
  });

  test("random values: both values are rebuilt, and what is kept is a longest common subsequence", () => {
    const { int, pick } = random(20261110);
    const alphabet = ["a", "b", "c", " ", " ", "é", "é", "😀", "\t"];
    for (let k = 0; k < 2000; k++) {
      const word = () => Array.from({ length: int(0, 11) }, () => pick(alphabet)).join("");
      const a = word();
      const b = word();
      const r = align(a, b);
      expect(text(r.source)).toBe(a);
      expect(text(r.destination)).toBe(b);
      expect(same(r.source)).toBe(same(r.destination));
      expect(Array.from(same(r.source)).length).toBe(lcsLength(Array.from(a), Array.from(b)));
      expect(r.source.every((x) => x.kind !== "inserted") && r.destination.every((x) => x.kind !== "deleted")).toBe(true);
    }
  });

  test("middles too long to align are shown as replaced, and say so", () => {
    const a = "x" + "a".repeat(300) + "y";
    const b = "x" + "b".repeat(300) + "y";
    expect((300 + 1) * (300 + 1)).toBeGreaterThan(MAX_CELLS);
    const r = align(a, b);
    expect(r.tooLong).toBe(true);
    expect(r.source).toEqual([{ kind: "same", text: "x" }, { kind: "deleted", text: "a".repeat(300) }, { kind: "same", text: "y" }]);
    // A long common prefix and suffix cost nothing.
    expect(align("p".repeat(5000) + "1" + "s".repeat(5000), "p".repeat(5000) + "2" + "s".repeat(5000)).tooLong).toBe(false);
  });
});

describe("invisible characters", () => {
  test("each has its token, and other format characters their code point", () => {
    expect([" ", "\t", "\n", "\r", " ", "​", "‌", "‍", "﻿", "⁠", "­"].map(token)).toEqual(["·", "→", "↵", "␍", "NBSP", "ZWSP", "ZWNJ", "ZWJ", "BOM", "WJ", "SHY"]);
    expect(token("‮")).toBe("U+202E");
    expect(token(" ")).toBe("U+2003");
    expect(token("a")).toBeNull();
  });

  test("a space is a token where it is highlighted or at an edge, and a plain space between words otherwise", () => {
    expect(pieces("a b", false, { start: true, end: true })).toEqual([{ text: "a b" }]);
    expect(pieces(" a b ", false, { start: true, end: true })).toEqual([{ text: "·", token: true, ch: " " }, { text: "a b" }, { text: "·", token: true, ch: " " }]);
    expect(pieces("  ", true)).toEqual([{ text: "·", token: true, ch: " " }, { text: "·", token: true, ch: " " }]);
    // A non-breaking space is never left to look like a space.
    expect(pieces("a b", false)).toEqual([{ text: "a" }, { text: "NBSP", token: true, ch: " " }, { text: "b" }]);
  });

  test("the code points of what differs, combining marks on a dotted circle", () => {
    const r = align("café", "café");
    expect(codePoints(r.source)).toEqual(["é U+00E9"]);
    expect(codePoints(r.destination)).toEqual(["◌́ U+0301"]);
    expect(codePoints(align("A", "А").destination)).toEqual(["А U+0410"]);
    expect(codePoints(align("a", "a​").destination)).toEqual([]);
  });

  test("notes: equal after NFC, after NFKC, or only in case", () => {
    expect(notes("café", "café")).toEqual(["nfc"]);
    expect(notes("ﬁ", "fi")).toEqual(["nfkc"]);
    expect(notes("Ada", "ada")).toEqual(["case"]);
    expect(notes("a", "b")).toEqual([]);
    expect(notes("a", "a")).toEqual([]);
  });
});
