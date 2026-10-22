/**
 * Evidence Atelier status language. Every state has a distinct SHAPE, a colour and a label:
 *   Verified   — solid disc
 *   Mismatch   — solid diamond
 *   Pending    — ring with a filled quarter (time elapsing)
 *   Unverified — hatched disc in a dashed ring (no conclusion — never a failure shape)
 * Cohort results use the Seal; record results use cells (see RecordCells).
 */
import { useId } from "react";
import { STACK_ORDER, type RuleStatus, type StateCounts, type VerificationState } from "../../domain/view";
import { cn } from "../../lib/cn";

export const STATE_COPY: Record<VerificationState, { label: string; short: string; meaning: string }> = {
  Verified: {
    label: "Verified",
    short: "Evidence supports every required rule",
    meaning: "The supplied evidence satisfies every required rule for this observation. It does not prove external authenticity or business truth.",
  },
  Mismatch: {
    label: "Mismatch",
    short: "A required rule is shown false",
    meaning: "Supported evidence shows at least one required rule is false — a field differs, a record is absent after the deadline, or a key is duplicated.",
  },
  Pending: {
    label: "Pending",
    short: "Inside a bounded retry window",
    meaning: "Nothing has failed and not everything has passed yet. A bounded retry is still valid before the deadline. Pending is never success.",
  },
  Unverified: {
    label: "Unverified",
    short: "Evidence insufficient for a conclusion",
    meaning: "Available evidence cannot establish Verified or Mismatch, and no waiting window applies. This is not a confirmed failure.",
  },
};

const TONE: Record<VerificationState, { mark: string; ink: string; soft: string; line: string }> = {
  Verified: { mark: "text-verified", ink: "text-verified-ink", soft: "bg-verified-soft", line: "border-verified-line" },
  Mismatch: { mark: "text-mismatch", ink: "text-mismatch-ink", soft: "bg-mismatch-soft", line: "border-mismatch-line" },
  Pending: { mark: "text-pending", ink: "text-pending-ink", soft: "bg-pending-soft", line: "border-pending-line" },
  Unverified: { mark: "text-unverified", ink: "text-unverified-ink", soft: "bg-unverified-soft", line: "border-unverified-line" },
};

export const stateTone = (s: VerificationState) => TONE[s];

export function StatusGlyph({ state, size = 12, className }: { state: VerificationState; size?: number; className?: string }) {
  const clip = useId();
  const common = { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": true, className: cn("shrink-0", TONE[state].mark, className) };
  switch (state) {
    case "Verified":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.5" fill="currentColor" />
        </svg>
      );
    case "Mismatch":
      return (
        <svg {...common}>
          <rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.4" transform="rotate(45 8 8)" fill="currentColor" />
        </svg>
      );
    case "Pending":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.9" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 3.6V8h4.4A4.4 4.4 0 0 0 8 3.6Z" fill="currentColor" />
        </svg>
      );
    case "Unverified":
      return (
        <svg {...common}>
          <clipPath id={clip}>
            <circle cx="8" cy="8" r="5.2" />
          </clipPath>
          <g clipPath={`url(#${clip})`} stroke="currentColor" strokeWidth="1.1">
            <path d="M0 6 6 0M0 10 10 0M0 14 14 0M2 16 16 2M6 16 16 6M10 16 16 10" />
          </g>
          <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.4 1.8" />
        </svg>
      );
  }
}

/** Cohort verdict seal: ruled box, mono small caps, glyph. */
export function Seal({ state, size = "md", className }: { state: VerificationState; size?: "md" | "lg"; className?: string }) {
  return (
    <span className={cn("fa-seal", className)} data-s={state} data-size={size}>
      <StatusGlyph state={state} size={size === "lg" ? 12 : 11} />
      {state}
    </span>
  );
}

/** Compact record-state badge (used for single records and dense lists). */
export function StatusBadge({ state, size = "md", className }: { state: VerificationState; size?: "sm" | "md" | "lg"; className?: string }) {
  if (size === "lg") return <Seal state={state} size="lg" className={className} />;
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium whitespace-nowrap", TONE[state].ink, size === "sm" ? "text-2xs" : "text-xs", className)}>
      <StatusGlyph state={state} size={size === "sm" ? 10 : 11} />
      {STATE_COPY[state].label}
    </span>
  );
}

export function StatusInline({ state, className }: { state: VerificationState; className?: string }) {
  return <StatusBadge state={state} className={className} />;
}

const RULE_COPY: Record<RuleStatus, { label: string; cls: string }> = {
  pass: { label: "Pass", cls: "text-verified-ink" },
  fail: { label: "Fail", cls: "text-mismatch-ink" },
  unknown: { label: "Not assessed", cls: "text-unverified-ink" },
};

/** The assertion operator: = holds, ≠ contradicted, ? not assessed. Drawn, never typed. */
export function Operator({ status, size = 28 }: { status: RuleStatus; size?: number }) {
  const label = { pass: "holds", fail: "is contradicted", unknown: "not assessed" }[status];
  return (
    <span className="fa-op" data-s={status} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
        {status === "pass" && <path d="M2.5 5h9M2.5 9h9" />}
        {status === "fail" && <path d="M2.5 5h9M2.5 9h9M9.5 2 4.5 12" />}
        {status === "unknown" && <path d="M4.6 5a2.4 2.4 0 1 1 3.4 2.2c-.6.3-1 .8-1 1.4v.4M7 11.6v.1" />}
      </svg>
    </span>
  );
}

export function RuleStatusIcon({ status, size = 14 }: { status: RuleStatus; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className={cn("shrink-0", RULE_COPY[status].cls)}>
      {status === "pass" && <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
      {status === "fail" && <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
      {status === "unknown" && <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.2 1.9" />}
    </svg>
  );
}

export function RuleStatusLabel({ status }: { status: RuleStatus }) {
  return <span className={cn("text-xs font-medium", RULE_COPY[status].cls)}>{RULE_COPY[status].label}</span>;
}

/** Non-zero record counts as glyph + number, so distributions never rely on colour. */
export function CountGlyphs({ counts, className, hideZero = true }: { counts: StateCounts; className?: string; hideZero?: boolean }) {
  const shown = STACK_ORDER.filter((s) => !hideZero || counts[s] > 0);
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-mono text-[11px] text-ink-2 tabular", className)}>
      {shown.map((s) => (
        <span key={s} className="inline-flex items-center gap-1" title={`${counts[s]} ${s}`}>
          <StatusGlyph state={s} size={10} />
          {counts[s]}
          <span className="sr-only"> {s}</span>
        </span>
      ))}
    </span>
  );
}
