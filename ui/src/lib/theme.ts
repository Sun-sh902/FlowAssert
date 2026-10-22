import { useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";
const KEY = "flowassert.theme";

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

function resolve(pref: ThemePreference): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/* One shared preference, so the rail switch and the Settings specimens never disagree. */
let current: ThemePreference = readPreference();
const listeners = new Set<() => void>();

function apply() {
  document.documentElement.dataset.theme = resolve(current);
}

export function setThemePreference(pref: ThemePreference) {
  current = pref;
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable */
  }
  apply();
  listeners.forEach((l) => l());
}

export function resetThemePreference() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  setThemePreference("system");
}

export function applyInitialTheme() {
  apply();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTheme() {
  const preference = useSyncExternalStore(subscribe, () => current);

  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [preference]);

  return { preference, setPreference: setThemePreference };
}
