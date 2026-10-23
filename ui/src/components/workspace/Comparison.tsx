/**
 * Live ↔ archived comparison presentation (product round 02). A comparison is a DIAGNOSTIC about two Service
 * outputs: it is drawn with operator glyphs (=, ≠, ⇄) in ink — never a verdict colour, the Mismatch diamond or the
 * Unverified hatch — and every chip says "diagnostic" to assistive technology.
 */
import type { ComparisonState, LiveSide, ResultSummary } from "../../data/workspace/comparison";
import type { HistorySummaryView } from "../../domain/history";
import { cn } from "../../lib/cn";
import { formatDateTime, plural, shortDigest } from "../../lib/format";
import { href } from "../../lib/router";
import { shortHistoryId } from "../history/HistoryRows";
import { CountGlyphs, Seal } from "../ui/status";
import { NoVerdictMark } from "./StatusAxes";

export const COMPARISON_COPY: Record<ComparisonState, { label: string; glyph: string; meaning: string }> = {
  READING: { label: "Comparing", glyph: "…", meaning: "Reading the live result and the archive." },
  SAME_INPUT_AGREE: { label: "Same input · agrees", glyph: "=", meaning: "Same input, evaluator and contract; the live and archived result summaries are equal." },
  SAME_INPUT_DIFFER: {
    label: "Same input · differs",
    glyph: "≠",
    meaning: "Same input, evaluator and contract, but the two Service outputs differ. A diagnostic — not a business Mismatch.",
  },
  DIFFERENT_INPUT: { label: "Different input", glyph: "⇄", meaning: "Input, evaluator or contract differ, so the two results are not comparable." },
  LIVE_MISSING: { label: "No live result", glyph: "—", meaning: "The Service returned no current result for this ID. Missing is not Unverified." },
  ARCHIVE_MISSING: { label: "Not archived", glyph: "—", meaning: "The archive holds no evaluation of this case to compare with." },
  SERVICE_UNAVAILABLE: { label: "Service unavailable", glyph: "∅", meaning: "A read did not reach the Service. Nothing was compared." },
  INCONCLUSIVE: { label: "Inconclusive", glyph: "?", meaning: "A read was refused, cancelled or failed an integrity check. Nothing was compared." },
};

/** `muted`: a legend entry with no cases (a zero count) — neutral, never emphasised. */
export function ComparisonChip({ state, className, muted = false }: { state: ComparisonState; className?: string; muted?: boolean }) {
  const c = COMPARISON_COPY[state];
  const dashed = !muted && (state === "LIVE_MISSING" || state === "ARCHIVE_MISSING" || state === "SERVICE_UNAVAILABLE" || state === "INCONCLUSIVE");
  return (
    <span
      data-comparison={state}
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded-xs border px-1.5 font-mono text-[10.5px] tracking-[0.04em] whitespace-nowrap",
        muted && "border-line text-ink-3",
        !muted && state === "SAME_INPUT_AGREE" && "border-line-strong text-ink",
        !muted && state === "SAME_INPUT_DIFFER" && "border-brand-line bg-brand-soft text-brand-ink",
        !muted && state === "DIFFERENT_INPUT" && "border-line-strong text-ink-2",
        dashed && "border-dashed border-line-strong text-ink-3",
        state === "READING" && "fa-breathe border-line text-ink-3",
        className,
      )}
    >
      <span aria-hidden className="w-2.5 text-center text-[12px] leading-none">
        {c.glyph}
      </span>
      {c.label}
      <span className="sr-only"> (diagnostic comparison, not a verdict)</span>
    </span>
  );
}

/** The live side's verdict cell: the copied seal, or why there is none. */
export function LiveVerdict({ side, compact = false }: { side: LiveSide; compact?: boolean }) {
  if (side.kind === "ready")
    return (
      <span className="grid justify-items-start gap-1">
        <Seal state={side.run.state} />
        {!compact && side.run.local && (
          <span className="font-mono text-[10.5px] leading-[1.45] text-ink-3">
            executed {side.run.local.serviceExecutedAt ? formatDateTime(side.run.local.serviceExecutedAt) : "time not stated"}
            <span className="block" title={side.run.local.inputEvidenceSha256}>
              input {shortDigest(side.run.local.inputEvidenceSha256)}
            </span>
          </span>
        )}
      </span>
    );
  return (
    <span className="grid justify-items-start gap-1">
      <NoVerdictMark />
      <span className="font-mono text-[10.5px] text-ink-3">
        {side.kind === "reading" ? "reading…" : side.kind === "not_found" ? "no current result" : side.kind === "cancelled" ? "read cancelled" : side.failure.code}
      </span>
    </span>
  );
}

export function ArchivedVerdict({ entry, state, compact = false }: { entry: HistorySummaryView | null; state: "reading" | "ready" | "failed" | "cancelled"; compact?: boolean }) {
  if (entry)
    return (
      <span className="grid justify-items-start gap-1">
        <Seal state={entry.result.cohort} />
        {!compact && (
          <span className="font-mono text-[10.5px] leading-[1.45] text-ink-3">
            archived {formatDateTime(entry.archivedAt)}
            <a href={href(`/local/history/${entry.historyId}`)} className="fa-hit relative z-10 block rounded-xs underline decoration-line-strong underline-offset-2 hover:text-ink" title={entry.historyId}>
              {shortHistoryId(entry.historyId)}
            </a>
          </span>
        )}
      </span>
    );
  return (
    <span className="grid justify-items-start gap-1">
      <NoVerdictMark />
      <span className="font-mono text-[10.5px] text-ink-3">{state === "reading" ? "reading archive…" : state === "ready" ? "not archived" : state === "cancelled" ? "read cancelled" : "archive not read"}</span>
    </span>
  );
}

/** Record counts and expected total of a copied result summary. An unknown population stays unknown. */
export function SummaryCounts({ summary, className }: { summary: ResultSummary; className?: string }) {
  const n = summary.counts.Verified + summary.counts.Mismatch + summary.counts.Pending + summary.counts.Unverified;
  return (
    <span className={className}>
      <CountGlyphs counts={summary.counts} />
      <span className="mt-1 block font-mono text-[10.5px] text-ink-3">
        {summary.expectedTotal === null ? <span className="text-unverified-ink">{plural(n, "record")} · total unknown</span> : `${plural(n, "record")} · ${summary.expectedTotal} expected`}
      </span>
    </span>
  );
}
