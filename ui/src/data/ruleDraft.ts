/**
 * Demo-only draft rule, kept in this browser.
 *
 * A draft is never sent anywhere and never evaluated. `checkDraft` restates a few of the evaluator's
 * prerequisites (model.py: comparison == "exact-string", settling is an explicit boolean, deadline at
 * or after capture, an approval record bound to the version) so the editor can explain why a draft
 * could not run. It is display feedback, not validation the evaluator relies on.
 */
import { useSyncExternalStore } from "react";
import type { RuleStatus } from "../domain/view";

export type DraftComparison = "exact-string" | "case-insensitive" | "trimmed";
export type DraftField = "company" | "email" | "phone";

export interface RuleDraft {
  field: DraftField;
  comparison: DraftComparison;
  deadline: string;
  maxAge: string;
  retry: boolean;
  settling: boolean;
}

/** What the editor opens with before anything is saved. */
export const SEED_DRAFT: RuleDraft = {
  field: "company",
  comparison: "case-insensitive",
  deadline: "120",
  maxAge: "15",
  retry: true,
  settling: false,
};

export interface DraftCheck {
  id: "comparison" | "deadline" | "maxAge" | "settling" | "approval";
  status: RuleStatus;
  label: string;
  detail: string;
}

const wholeMinutes = (v: string) => /^\d+$/.test(v.trim()) && Number(v) <= 100_000;

export function checkDraft(d: RuleDraft): DraftCheck[] {
  return [
    {
      id: "comparison",
      status: d.comparison === "exact-string" ? "pass" : "fail",
      label: "Comparison is supported",
      detail: d.comparison === "exact-string" ? "exact-string, as the evaluator requires." : `“${d.comparison}” is not supported. The evaluator compares exact strings only.`,
    },
    {
      id: "deadline",
      status: wholeMinutes(d.deadline) ? "pass" : "fail",
      label: "Deadline at or after capture",
      detail: wholeMinutes(d.deadline) ? `${Number(d.deadline)} min after capture.` : "Enter whole minutes, zero or more.",
    },
    {
      id: "maxAge",
      status: wholeMinutes(d.maxAge) ? "pass" : "fail",
      label: "Observation age is a whole number",
      detail: wholeMinutes(d.maxAge) ? `Reads older than ${Number(d.maxAge)} min are not used.` : "Enter whole minutes, zero or more.",
    },
    { id: "settling", status: "pass", label: "Settling is an explicit boolean", detail: `settling_allowed = ${d.settling}` },
    { id: "approval", status: "unknown", label: "Approval binds this version", detail: "Drafts have no approval record, so the evaluator can never use one." },
  ];
}

export const draftIssues = (d: RuleDraft) => checkDraft(d).filter((c) => c.status === "fail").length;

export const sameDraft = (a: RuleDraft | null, b: RuleDraft) =>
  !!a && (Object.keys(b) as (keyof RuleDraft)[]).every((k) => a[k] === b[k]);

/* ---------- Storage ---------- */

const KEY = "flowassert.ruleDraft";

function read(): RuleDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<RuleDraft>;
    if (!p || typeof p !== "object") return null;
    return {
      field: (["company", "email", "phone"] as const).includes(p.field as DraftField) ? (p.field as DraftField) : SEED_DRAFT.field,
      comparison: (["exact-string", "case-insensitive", "trimmed"] as const).includes(p.comparison as DraftComparison) ? (p.comparison as DraftComparison) : SEED_DRAFT.comparison,
      deadline: typeof p.deadline === "string" ? p.deadline : SEED_DRAFT.deadline,
      maxAge: typeof p.maxAge === "string" ? p.maxAge : SEED_DRAFT.maxAge,
      retry: typeof p.retry === "boolean" ? p.retry : SEED_DRAFT.retry,
      settling: typeof p.settling === "boolean" ? p.settling : SEED_DRAFT.settling,
    };
  } catch {
    return null;
  }
}

let saved: RuleDraft | null = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Returns false when browser storage is unavailable (the draft then lives only until reload). */
export function saveRuleDraft(d: RuleDraft): boolean {
  saved = { ...d };
  let persisted = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    persisted = false;
  }
  emit();
  return persisted;
}

export function clearRuleDraft() {
  saved = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSavedDraft(): RuleDraft | null {
  return useSyncExternalStore(subscribe, () => saved);
}

export const DRAFT_FIELD_LABEL: Record<DraftField, string> = { company: "Company name", email: "Email", phone: "Phone" };
export const DRAFT_COMPARISON_LABEL: Record<DraftComparison, string> = { "exact-string": "exact string", "case-insensitive": "case-insensitive", trimmed: "trimmed" };
