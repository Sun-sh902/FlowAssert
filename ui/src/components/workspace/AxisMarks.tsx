/**
 * The marks of the capture and admission axes. Kept apart from StatusAxes.tsx so that rows and verdict cells can
 * use them without depending on the ledger.
 *
 * What is drawn comes only from the canonical axis objects (src/domain/statusAxes.ts): a caller-built axis fails closed
 * to "not implemented", and no label is taken from a response. Outcomes use the brand indigo and neutral inks only.
 * The verdict colours stay the evaluator's, and coral stays the business Mismatch: an admission refusal is neither.
 */
import { ADMISSION_NOT_IMPLEMENTED, CAPTURE_NOT_IMPLEMENTED, deriveAdmissionAxis, hasReportedOutcome, isCanonicalAxis, type AdmissionAxis, type CaptureAxis, type Phase3BView } from "../../domain/statusAxes";
import { cn } from "../../lib/cn";

/** A dashed, empty frame: nothing exists to have a state. */
function NotImplementedMark() {
  return (
    <span data-axis-na className="inline-flex h-[22px] items-center whitespace-nowrap gap-1.5 rounded-xs border border-dashed border-line-strong px-1.5 font-mono text-[10.5px] tracking-[0.06em] text-ink-3 uppercase">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <rect x="1" y="1" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.6 1.4" />
      </svg>
      Not implemented
    </span>
  );
}

/** A filled square is a reported completion, a half-filled one an unfinished run, a struck one a refusal. */
function OutcomeGlyph({ tone }: { tone: CaptureAxis["tone"] }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="shrink-0">
      <rect x="1" y="1" width="8" height="8" rx="1" fill={tone === "positive" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.2" />
      {tone === "warning" && <rect x="1" y="5" width="8" height="4" fill="currentColor" />}
      {tone === "refused" && <path d="M1.5 8.5 8.5 1.5" stroke="currentColor" strokeWidth="1.2" />}
    </svg>
  );
}

/** One capture or admission status. A forged axis is drawn as not implemented. */
export function CaptureValue({ axis }: { axis: CaptureAxis | AdmissionAxis }) {
  if (!isCanonicalAxis(axis) || axis.kind === "NOT_IMPLEMENTED") return <NotImplementedMark />;
  return (
    <span
      data-axis-outcome={axis.status}
      data-axis-tone={axis.tone}
      title={axis.status}
      className={cn(
        "inline-flex min-h-[22px] items-center gap-1.5 rounded-xs border px-1.5 font-mono text-[10.5px] tracking-[0.06em] uppercase",
        axis.tone === "positive" ? "border-brand-line bg-brand-soft text-brand-ink" : "border-line-strong text-ink-2",
      )}
    >
      <OutcomeGlyph tone={axis.tone} />
      {axis.label}
    </span>
  );
}

/** The ledger note for an axis: its own basis, or the not-implemented basis when the axis is not canonical. */
export function axisNote(axis: CaptureAxis | AdmissionAxis): string {
  if (isCanonicalAxis(axis)) return axis.basis;
  return axis.axis === "capture" ? CAPTURE_NOT_IMPLEMENTED.basis : ADMISSION_NOT_IMPLEMENTED.basis;
}

/** An archived evaluation's admission outcome, beside its other facts. Nothing at all when none was reported. */
export function ReportedAdmission({ facts, className }: { facts?: Phase3BView | null; className?: string }) {
  if (!hasReportedOutcome(facts)) return null;
  return (
    <span className={cn("block", className)} data-reported-admission>
      <CaptureValue axis={deriveAdmissionAxis(facts)} />
    </span>
  );
}
