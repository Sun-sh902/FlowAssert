/**
 * Translate one interface string. Only strings the catalogue names are changed, so an ID, a digest, an evidence value
 * or an evaluator reason stays exactly as supplied. Surrounding whitespace is kept, because React splits a sentence
 * around its expressions and the spaces belong to the neighbouring nodes.
 *
 * Catalogue keys write every number as "#", so one entry covers all its counts. A value takes the numbers back in order
 * through "#", or by position through "{1}", "{2}" when Chinese reorders them.
 */
import { EXACT, PATTERNS } from "./zh-CN";

const SEPARATORS = [" · ", " — "];

function fill(template: string, numbers: string[]): string {
  if (/\{\d\}/.test(template)) return template.replace(/\{(\d)\}/g, (_, i: string) => numbers[Number(i) - 1] ?? "");
  let next = 0;
  return template.replace(/#/g, () => numbers[next++] ?? "#");
}

function lookup(text: string): string | null {
  const numbers = text.match(/\d+/g) ?? [];
  const key = text.replace(/\d+/g, "#");
  if (Object.hasOwn(EXACT, key)) return fill(EXACT[key]!, numbers);
  for (const [pattern, build] of PATTERNS) {
    const m = pattern.exec(text);
    if (m) return build(...m.slice(1));
  }
  return null;
}

function segments(text: string, level: number): string | null {
  const whole = lookup(text);
  if (whole !== null) return whole;
  const separator = SEPARATORS[level];
  if (separator === undefined) return null;
  if (!text.includes(separator)) return segments(text, level + 1);
  const parts = text.split(separator).map((p) => segments(p, level + 1));
  if (parts.every((p) => p === null)) return null;
  return text.split(separator).map((p, i) => parts[i] ?? p).join(separator);
}

/** A message assembled from whole sentences: translate those the catalogue knows and keep the rest as supplied. */
function sentences(text: string): string | null {
  const parts = text.split(/(?<=[.!?]) (?=[A-Z])/);
  if (parts.length < 2) return null;
  const done = parts.map((p) => segments(p, 0));
  return done.some((p) => p !== null) ? parts.map((p, i) => done[i] ?? `${p} `).join("") : null;
}

export function translate(text: string): string {
  const core = text.trim();
  if (core === "" || !/[A-Za-z]/.test(core)) return text;
  const out = segments(core, 0) ?? sentences(core);
  if (out === null) return text;
  const start = text.indexOf(core);
  return text.slice(0, start) + out + text.slice(start + core.length);
}
