/**
 * Where two values differ, character by character (docs/design/1.0-browser.md, "The character diff"). A display aid:
 * the rule's result is the conclusion, and nothing here changes or adds to it.
 *
 * The alignment is by code point: the common prefix and suffix, and between them a longest common subsequence with
 * fixed tie-breaking (a deletion before an insertion). It is written so that offline/flowassert_offline/chardiff.py
 * can do exactly the same, for the HTML report.
 */

/** A run of code points: the same on both sides, only in the source value, or only in the destination value. */
export interface Run {
  kind: "same" | "deleted" | "inserted";
  text: string;
}

export interface Alignment {
  /** The source value as runs of "same" and "deleted". */
  source: Run[];
  /** The destination value as runs of "same" and "inserted". */
  destination: Run[];
  /** The middles were too long to align, so they are shown as replaced whole. */
  tooLong: boolean;
}

/** The most cells of alignment table the middles may need; beyond it they are shown as replaced. */
export const MAX_CELLS = 65_536;

const runsOf = (parts: [Run["kind"], string][]): Run[] => {
  const runs: Run[] = [];
  for (const [kind, ch] of parts) {
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.text += ch;
    else runs.push({ kind, text: ch });
  }
  return runs;
};

export function align(a: string, b: string): Alignment {
  const x = Array.from(a);
  const y = Array.from(b);
  let prefix = 0;
  while (prefix < x.length && prefix < y.length && x[prefix] === y[prefix]) prefix++;
  let suffix = 0;
  while (suffix < x.length - prefix && suffix < y.length - prefix && x[x.length - 1 - suffix] === y[y.length - 1 - suffix]) suffix++;
  const m = x.slice(prefix, x.length - suffix);
  const n = y.slice(prefix, y.length - suffix);
  const source: [Run["kind"], string][] = x.slice(0, prefix).map((c) => ["same", c]);
  const destination: [Run["kind"], string][] = y.slice(0, prefix).map((c) => ["same", c]);
  const tooLong = (m.length + 1) * (n.length + 1) > MAX_CELLS;
  if (tooLong) {
    for (const c of m) source.push(["deleted", c]);
    for (const c of n) destination.push(["inserted", c]);
  } else {
    // lcs[i][j]: the length of a longest common subsequence of m[i:] and n[j:].
    const w = n.length + 1;
    const lcs = new Uint32Array((m.length + 1) * w);
    for (let i = m.length - 1; i >= 0; i--) {
      for (let j = n.length - 1; j >= 0; j--) {
        lcs[i * w + j] = m[i] === n[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < m.length || j < n.length) {
      if (i < m.length && j < n.length && m[i] === n[j]) {
        source.push(["same", m[i++]!]);
        destination.push(["same", n[j++]!]);
      } else if (j === n.length || (i < m.length && lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!)) {
        source.push(["deleted", m[i++]!]);
      } else {
        destination.push(["inserted", n[j++]!]);
      }
    }
  }
  for (const c of x.slice(x.length - suffix)) source.push(["same", c]);
  for (const c of y.slice(y.length - suffix)) destination.push(["same", c]);
  return { source: runsOf(source), destination: runsOf(destination), tooLong };
}

/* ---------- Invisible characters ---------- */

/** The visible token of a character that cannot be seen, or null for one that can. */
const TOKENS: ReadonlyMap<number, string> = new Map([
  [0x20, "·"],
  [0x09, "→"],
  [0x0a, "↵"],
  [0x0d, "␍"],
  [0xa0, "NBSP"],
  [0x200b, "ZWSP"],
  [0x200c, "ZWNJ"],
  [0x200d, "ZWJ"],
  [0xfeff, "BOM"],
  [0x2060, "WJ"],
  [0xad, "SHY"],
]);

/**
 * Characters with no glyph of their own, beyond those with a token: shown by their code point. A fixed list, not a
 * Unicode property, so that every Python and every browser draws the same value the same way whatever Unicode version
 * it has: the C0 and C1 controls, the spaces other than U+0020, and the format characters of bidirectional text,
 * invisible operators and tags.
 */
const INVISIBLE: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x61c, 0x61c],
  [0x1680, 0x1680],
  [0x180e, 0x180e],
  [0x2000, 0x200a],
  [0x200e, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x205f],
  [0x2061, 0x2064],
  [0x2066, 0x206f],
  [0x3000, 0x3000],
  [0xfff9, 0xfffb],
  [0xe0001, 0xe0001],
  [0xe0020, 0xe007f],
];

/** The blocks of combining diacritical marks: drawn on a dotted circle when listed alone. Also a fixed list. */
const COMBINING: readonly (readonly [number, number])[] = [
  [0x300, 0x36f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
];

const within = (ranges: readonly (readonly [number, number])[], cp: number) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

export const codePoint = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

/** A character as the diff draws it: its token when it cannot be seen. */
export function token(ch: string): string | null {
  const known = TOKENS.get(ch.codePointAt(0)!);
  if (known !== undefined) return known;
  return within(INVISIBLE, ch.codePointAt(0)!) ? codePoint(ch) : null;
}

/** A piece of a value as drawn: characters as they are, or one invisible character as its token. */
export type Piece = { text: string; token?: false } | { text: string; token: true; ch: string };

/**
 * A value as drawn: invisible characters become tokens where `visible` is true for their position — in a highlighted
 * run, and at the start and the end of the value, where a space is otherwise easy to miss.
 */
export function pieces(text: string, highlighted: boolean, edges: { start: boolean; end: boolean } = { start: false, end: false }): Piece[] {
  const chars = Array.from(text);
  // The leading and trailing invisible characters of the whole value.
  let lead = 0;
  while (edges.start && lead < chars.length && token(chars[lead]!) !== null) lead++;
  let trail = chars.length;
  while (edges.end && trail > lead && token(chars[trail - 1]!) !== null) trail--;
  const out: Piece[] = [];
  chars.forEach((ch, i) => {
    const t = token(ch);
    const shown = t !== null && (highlighted || i < lead || i >= trail || t !== "·");
    if (shown) out.push({ text: t, token: true, ch });
    else {
      const last = out[out.length - 1];
      if (last && !last.token) last.text += ch;
      else out.push({ text: ch });
    }
  });
  return out;
}

/** Characters that differ and are not ASCII, with their code points: what makes a look-alike or a normalisation visible. */
export function codePoints(runs: Run[]): string[] {
  const seen: string[] = [];
  for (const run of runs) {
    if (run.kind === "same") continue;
    for (const ch of Array.from(run.text)) {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x80 || TOKENS.has(cp)) continue;
      const shown = within(COMBINING, cp) ? `◌${ch}` : within(INVISIBLE, cp) ? "" : ch;
      const line = `${shown ? shown + " " : ""}${codePoint(ch)}`;
      if (!seen.includes(line)) seen.push(line);
    }
  }
  return seen;
}

/** Facts about two values that the highlighting alone does not make plain. Browser only; never in a report. */
export function notes(a: string, b: string): ("nfc" | "nfkc" | "case")[] {
  if (a === b) return [];
  const out: ("nfc" | "nfkc" | "case")[] = [];
  if (a.normalize("NFC") === b.normalize("NFC")) out.push("nfc");
  else if (a.normalize("NFKC") === b.normalize("NFKC")) out.push("nfkc");
  if (a.toLowerCase() === b.toLowerCase() && a.toUpperCase() === b.toUpperCase()) out.push("case");
  return out;
}
