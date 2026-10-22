import { DEMO_NOW_ISO } from "../mocks/fixtures";

/** The demo runs on a frozen clock so relative times stay consistent with fixtures. */
export const DEMO_NOW_MS = Date.parse(DEMO_NOW_ISO);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Shown wherever an instant is null: no tick zero, no receipt time, no browser time stands in for it. */
export const TIME_UNAVAILABLE = "time unavailable";

/** All times are shown in UTC with an explicit zone label (USER_EXPERIENCE.md §5). */
export function formatTime(iso: string | null): string {
  if (iso === null) return TIME_UNAVAILABLE;
  const d = new Date(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function formatDay(iso: string | null): string {
  if (iso === null) return TIME_UNAVAILABLE;
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function formatDateTime(iso: string | null): string {
  if (iso === null) return TIME_UNAVAILABLE;
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${formatTime(iso)}`;
}

export function formatDuration(minutes: number): string {
  const m = Math.round(Math.abs(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 48) return rest ? `${h} h ${rest} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export function relativeToDemoNow(iso: string | null): string {
  if (iso === null) return TIME_UNAVAILABLE;
  const diff = (Date.parse(iso) - DEMO_NOW_MS) / 60000;
  if (Math.abs(diff) < 1) return "just now";
  return diff < 0 ? `${formatDuration(diff)} ago` : `in ${formatDuration(diff)}`;
}

/**
 * Relative to a declared reference instant (G5) — for LOCAL_RESEARCH, the evaluation snapshot clock —
 * never the browser clock. Either side unavailable → unavailable.
 */
export function relativeTo(iso: string | null, reference: string | null, referenceLabel: string): string {
  if (iso === null || reference === null) return TIME_UNAVAILABLE;
  const diff = (Date.parse(iso) - Date.parse(reference)) / 60000;
  if (Math.abs(diff) < 1) return `at ${referenceLabel}`;
  return diff < 0 ? `${formatDuration(diff)} before ${referenceLabel}` : `${formatDuration(diff)} after ${referenceLabel}`;
}

/**
 * Display text for a nullable workflow label. Presentation only: the view model keeps null, and
 * search never sees this fallback (src/lib/search.ts).
 */
export function workflowLabelText(label: string | null): { text: string; fallback: boolean } {
  if (label === null) return { text: "Workflow label unavailable", fallback: true };
  if (label === "") return { text: "Workflow label empty", fallback: true };
  return { text: label, fallback: false };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function shortDigest(hex: string): string {
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}
