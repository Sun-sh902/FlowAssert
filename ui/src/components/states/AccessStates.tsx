/**
 * Data-access state presentation — Evidence Atelier vocabulary for "how the read went".
 *
 * These components never render a verdict seal, a state glyph, a state colour or hatching:
 * those belong to the evaluator's four results. Access states are drawn as the FlowAssert trace
 * itself — source node, line, destination node — interrupted, dotted or doubled.
 */
import { RotateCcw } from "lucide-react";
import { useId, type ReactNode } from "react";
import { ACCESS_COPY, type AccessState } from "../../data/access";
import { cn } from "../../lib/cn";
import { buttonClass } from "../ui/primitives";

/* ---------- Mark: the logo's trace, telling what happened to the read ---------- */

export function AccessMark({ kind, size = 48, className }: { kind: AccessState | "CANCELLED"; size?: number; className?: string }) {
  const faint = "var(--fa-ink-4)";
  const src = <rect x="2.75" y="8.75" width="7.5" height="7.5" rx="1.2" fill="var(--fa-surface)" stroke="currentColor" strokeWidth="1.6" />;
  const dst = <rect x="37.5" y="8" width="8.5" height="8.5" rx="1.4" fill="currentColor" />;
  const dstOpen = (dash?: string) => (
    <rect x="38.25" y="8.75" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray={dash} />
  );
  const line = (x1 = 10.25, x2 = 37.5, dash?: string, stroke = "currentColor") => (
    <path d={`M${x1} 12.5H${x2}`} stroke={stroke} strokeWidth="1.4" strokeDasharray={dash} />
  );
  let body: ReactNode;
  switch (kind) {
    case "LOADING":
      body = (
        <>
          {src}
          <g className="fa-breathe">{line(10.25, 37.5, "2 2.6", faint)}</g>
          {dstOpen("2 1.6")}
        </>
      );
      break;
    case "EMPTY":
      body = (
        <>
          {src}
          {line(10.25, 19, undefined, faint)}
          <rect x="20.5" y="9.5" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.3 1.3" />
          {line(28, 37.5, undefined, faint)}
          {dst}
        </>
      );
      break;
    case "REQUEST_ERROR":
      body = (
        <>
          {src}
          {line(10.25, 20.5)}
          <path d="M22.4 16.5 25.2 8.5M25.8 16.5 28.6 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          {line(30.5, 37.5)}
          {dst}
        </>
      );
      break;
    case "NOT_FOUND":
      body = (
        <>
          {src}
          {line(10.25, 37.5, "1.4 2.2")}
          {dstOpen("1.2 1.6")}
        </>
      );
      break;
    case "PARTIAL_DATA":
      body = (
        <>
          {src}
          {line(10.25, 37.5, undefined, faint)}
          {[13.5, 18.5].map((x) => (
            <rect key={x} x={x} y="10" width="4" height="5" rx="0.8" fill="currentColor" />
          ))}
          {[23.5, 28.5].map((x) => (
            <rect key={x} x={x} y="10" width="4" height="5" rx="0.8" fill="var(--fa-surface)" stroke="currentColor" strokeWidth="0.9" strokeDasharray="1 1" />
          ))}
          {dst}
        </>
      );
      break;
    case "STALE_SNAPSHOT":
      body = (
        <>
          {src}
          {line()}
          <rect x="40.5" y="5" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.6" />
          <rect x="37.5" y="8" width="8.5" height="8.5" rx="1.4" fill="currentColor" stroke="var(--fa-surface)" strokeWidth="1.2" />
        </>
      );
      break;
    case "EVIDENCE_UNAVAILABLE":
      body = (
        <>
          {src}
          {line(10.25, 18.5)}
          <rect x="19.5" y="8.5" width="9" height="8" rx="1" fill="var(--fa-surface)" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.2 1.4" />
          {line(29.5, 37.5)}
          {dst}
        </>
      );
      break;
    case "SERVICE_UNAVAILABLE":
      body = (
        <>
          <rect x="2.75" y="8.75" width="7.5" height="7.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.5" />
          {line(13, 34.5, "0.1 3.2", "currentColor")}
          {dstOpen("2 1.5")}
        </>
      );
      break;
    case "CANCELLED":
      body = (
        <>
          {src}
          {line(10.25, 24, undefined, faint)}
          <path d="M25.5 8.5v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          {dstOpen("2 1.6")}
        </>
      );
      break;
  }
  return (
    <svg viewBox="0 0 48 25" width={size} height={(size * 25) / 48} aria-hidden className={cn("fa-access-mark shrink-0 overflow-visible", className)} strokeLinecap="round">
      {body}
    </svg>
  );
}

/** Stamp that separates a data-access state from a verdict. */
export function AccessStamp({ children = "Data access · not a verdict" }: { children?: ReactNode }) {
  return <span className="fa-accessstamp">{children}</span>;
}

export function RetryButton({ onRetry, label = "Retry the read" }: { onRetry: () => void; label?: string }) {
  return (
    <button type="button" onClick={onRetry} className={buttonClass("default", "sm")}>
      <RotateCcw size={12} aria-hidden /> {label}
    </button>
  );
}

const DASHED: AccessState[] = ["NOT_FOUND", "SERVICE_UNAVAILABLE", "EVIDENCE_UNAVAILABLE", "EMPTY"];
/** Failures interrupt; everything else is a polite status. */
const ALERTS: AccessState[] = ["REQUEST_ERROR", "SERVICE_UNAVAILABLE", "STALE_SNAPSHOT"];

export type Fact = [label: string, value: ReactNode];

/**
 * A ruled slip that states what happened to the read, the identities involved, and — always —
 * that no verdict was produced by it.
 */
export function AccessNotice({
  state,
  title,
  body,
  facts,
  actions,
  className,
  headingLevel = 2,
}: {
  state: AccessState;
  title?: ReactNode;
  body?: ReactNode;
  facts?: Fact[];
  actions?: ReactNode;
  className?: string;
  /** 1 when the notice is the whole page (Detail NOT_FOUND), so the document still has a top-level heading. */
  headingLevel?: 1 | 2 | 3;
}) {
  const id = useId();
  const copy = ACCESS_COPY[state];
  const H = `h${headingLevel}` as const;
  return (
    <section
      aria-labelledby={id}
      role={ALERTS.includes(state) ? "alert" : "status"}
      data-access={state}
      data-line={DASHED.includes(state) ? "dashed" : undefined}
      className={cn("fa-access fade-in rounded-lg", className)}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-7 gap-y-4 px-5 pt-5 pb-5 sm:grid-cols-[64px_minmax(0,1fr)] sm:px-7 sm:pt-6">
        <div className="pt-1.5">
          <AccessMark kind={state} size={56} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="kicker">{copy.label}</p>
            <AccessStamp />
          </div>
          <H id={id} className="serif mt-2 text-[26px] leading-[1.15] text-ink sm:text-[28px]">
            {title ?? copy.title}
          </H>
          <p className="mt-2 max-w-[64ch] text-sm leading-[1.6] text-ink-2">{body ?? copy.body}</p>
          {facts && facts.length > 0 && (
            <dl className="fa-ledger mt-4 max-w-[560px] text-[12.5px]">
              {facts.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 py-[6px]">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="min-w-0 text-right font-mono text-[11.5px] break-words text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {actions && <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>}
          <p className="mt-4 font-mono text-[10.5px] text-ink-3">
            verdict · <span className="text-ink-2">none</span> — Verified, Mismatch, Pending and Unverified describe evidence; this describes a read.
          </p>
        </div>
      </div>
    </section>
  );
}

/** A read the user stopped. Nothing was published. */
export function CancelledNotice({ onRetry, what = "the run" }: { onRetry?: () => void; what?: string }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-dashed border-line-strong px-4 py-3">
      <AccessMark kind="CANCELLED" size={36} />
      <p className="min-w-0 flex-1 text-sm text-ink-2">
        <b className="font-semibold text-ink">Read cancelled.</b> Nothing from {what} was shown or kept. No verdict.
      </p>
      {onRetry && <RetryButton onRetry={onRetry} label="Read again" />}
    </div>
  );
}
