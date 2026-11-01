/**
 * Interface language — this browser only. English is the source text and the default; Simplified Chinese is a
 * presentation layer over it (./localizer.ts). Like the display preferences, a language changes how evidence is
 * labelled, never what it says: no locale reaches a provider, a decoder or a view model.
 */
import { useSyncExternalStore } from "react";

export type Locale = "en" | "zh-CN";
const KEY = "flowassert.locale";

function read(): Locale {
  try {
    return localStorage.getItem(KEY) === "zh-CN" ? "zh-CN" : "en";
  } catch {
    return "en";
  }
}

const current: Locale = read();

/** The language this page view was started in. Changing it reloads, so no partly translated screen can exist. */
export const pageLocale = (): Locale => current;

export function setLocale(next: Locale, reload: () => void = () => window.location.reload()) {
  if (next === current) return;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    return; // storage unavailable: a reload would come back in the same language
  }
  reload();
}

const subscribe = () => () => undefined;

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => current);
}
