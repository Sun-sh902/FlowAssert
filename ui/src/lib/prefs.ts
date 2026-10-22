/**
 * Display and accessibility preferences — this browser only.
 *
 * Applied as data attributes and one custom property on <html>; the CSS in atelier.css reads them.
 * Preferences change how evidence is drawn, never what it says: no preference reaches a view model.
 */
import { useSyncExternalStore } from "react";

export interface Prefs {
  density: "comfortable" | "compact";
  cell: "8" | "10" | "12";
  landing: "overview" | "verifications";
  motion: "system" | "reduce";
  ring: "standard" | "heavy";
  pattern: "standard" | "strong";
  underline: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  density: "comfortable",
  cell: "8",
  landing: "overview",
  motion: "system",
  ring: "standard",
  pattern: "standard",
  underline: false,
};

const KEY = "flowassert.prefs";

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const pick = <K extends keyof Prefs>(k: K, allowed: readonly Prefs[K][]): Prefs[K] =>
      allowed.includes(parsed[k] as Prefs[K]) ? (parsed[k] as Prefs[K]) : DEFAULT_PREFS[k];
    return {
      density: pick("density", ["comfortable", "compact"]),
      cell: pick("cell", ["8", "10", "12"]),
      landing: pick("landing", ["overview", "verifications"]),
      motion: pick("motion", ["system", "reduce"]),
      ring: pick("ring", ["standard", "heavy"]),
      pattern: pick("pattern", ["standard", "strong"]),
      underline: pick("underline", [true, false]),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

let current: Prefs = read();
const listeners = new Set<() => void>();

function apply() {
  const el = document.documentElement;
  el.dataset.density = current.density;
  el.dataset.motion = current.motion;
  el.dataset.ring = current.ring;
  el.dataset.pattern = current.pattern;
  el.dataset.underline = String(current.underline);
  el.style.setProperty("--fa-cell", `${current.cell}px`);
}

function commit(next: Prefs) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the preference still applies for this page view */
  }
  apply();
  listeners.forEach((l) => l());
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  commit({ ...current, [key]: value });
}

export function resetPrefs() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  commit(DEFAULT_PREFS);
}

/** Before first render: apply preferences and honour the opening page on a bare visit. */
export function applyInitialPrefs() {
  apply();
  // Only a visit with no address inside the app; reloading "#/" keeps the Overview.
  const bare = window.location.hash === "" || window.location.hash === "#";
  if (bare && current.landing === "verifications") window.history.replaceState(null, "", "#/verifications");
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, () => current);
}
