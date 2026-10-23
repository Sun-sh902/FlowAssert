/**
 * Evidence-integrity presentation (Phase 3A, P2-AUD-001) — a third vocabulary beside verdicts and
 * access states, defined in src/domain/integrity.ts:
 *   Verdicts      Verified · Mismatch · Pending · Unverified — seal, state colour, glyph (components/ui/status)
 *   Access states how a read went — the interrupted trace (components/states/AccessStates)
 *   Integrity     whether stored content is consistent with its digests — two linked evidence squares
 * These components never render a verdict seal, a verdict colour or the hatch, and an integrity
 * "verified" is never drawn with the Verified green.
 */
import { useId, type ReactNode } from "react";
import type { IntegrityState, IntegritySummary } from "../../domain/integrity";
import { cn } from "../../lib/cn";

export const INTEGRITY_WORD: Record<IntegrityState, string> = {
  verified: "Integrity verified",
  failed: "Integrity failed",
  unverifiable: "Integrity unverifiable",
  pending: "Integrity not established",
};

/** Stored bytes (left) → digest (right), linked by the comparison. */
export function IntegrityGlyph({ state, size = 22, className }: { state: IntegrityState; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 22 12" width={size} height={(size * 12) / 22} aria-hidden className={cn("shrink-0 overflow-visible", className)} fill="none" stroke="currentColor" strokeLinecap="round">
      <rect x="1" y="2" width="7" height="8" rx="1" strokeWidth="1.4" />
      {state === "verified" && (
        <>
          <path d="M9.3 5H12.7M9.3 7H12.7" strokeWidth="1.2" />
          <rect x="14" y="2" width="7" height="8" rx="1" fill="currentColor" strokeWidth="1.4" />
        </>
      )}
      {state === "failed" && (
        <>
          <path d="M9.2 6H10.2M11.8 6H12.8M10 9 12 3" strokeWidth="1.3" />
          <rect x="14" y="2" width="7" height="8" rx="1" fill="currentColor" strokeWidth="1.4" />
        </>
      )}
      {state === "unverifiable" && (
        <>
          <path d="M9.3 6H12.7" strokeWidth="1.1" strokeDasharray="0.1 2" />
          <rect x="14" y="2" width="7" height="8" rx="1" strokeWidth="1.2" strokeDasharray="1.6 1.3" />
        </>
      )}
      {state === "pending" && <rect x="14" y="2" width="7" height="8" rx="1" strokeWidth="1.1" strokeDasharray="0.1 1.9" />}
    </svg>
  );
}

export function IntegritySeal({ state, children, className }: { state: IntegrityState; children?: ReactNode; className?: string }) {
  return (
    <span className={cn("fa-iseal", className)} data-i={state}>
      <IntegrityGlyph state={state} size={20} />
      {children ?? INTEGRITY_WORD[state]}
    </span>
  );
}

/** The glyph carries the state visually; the visually hidden word carries it for assistive technology. */
export function IntegrityTag({ state, children }: { state: IntegrityState; children: ReactNode }) {
  return (
    <span className="fa-itag" data-i={state}>
      <IntegrityGlyph state={state} size={16} />
      <span className="sr-only">{INTEGRITY_WORD[state]}: </span>
      {children}
    </span>
  );
}

/**
 * The retrieval/integrity pair, inside ONE polite live region: what was retrieved, and separately
 * whether it is internally consistent. The two are never merged into one success line.
 */
export function EvidenceStatus({ retrieval, integrity, integrityState }: { retrieval: string; integrity: string; integrityState: IntegrityState }) {
  return (
    // basis-full below md: in the wrapping control row the pair takes its own line, so the value column never collapses.
    <div role="status" aria-live="polite" className="min-w-0 flex-1 basis-full md:basis-0">
      <dl className="fa-evstatus">
        <dt>Retrieval</dt>
        <dd data-retrieval>{retrieval}</dd>
        <dt>Integrity</dt>
        <dd data-integrity={integrityState} data-i={integrityState}>
          {integrity}
        </dd>
      </dl>
    </div>
  );
}

export type IntegrityFact = [label: string, value: ReactNode];

/**
 * A conspicuous slip for an integrity outcome that is not success: `failed` interrupts (alert) with an
 * inverted band; `unverifiable` is a dashed slip (status). Both say plainly that this is not a verdict.
 */
export function IntegrityNotice({
  outcome,
  title,
  body,
  facts,
  actions,
  headingLevel = 2,
  verdictLine,
  className,
}: {
  outcome: "failed" | "unverifiable";
  title: ReactNode;
  body: ReactNode;
  facts?: IntegrityFact[];
  actions?: ReactNode;
  headingLevel?: 1 | 2 | 3;
  verdictLine: ReactNode;
  className?: string;
}) {
  const id = useId();
  const H = `h${headingLevel}` as const;
  return (
    <section aria-labelledby={id} role={outcome === "failed" ? "alert" : "status"} data-integrity-notice={outcome} data-i={outcome} className={cn("fa-inotice fade-in rounded-lg", className)}>
      <div className="fa-inotice-band">
        <span className="inline-flex items-center gap-2">
          <IntegrityGlyph state={outcome} size={22} />
          {outcome === "failed" ? "Integrity check failed" : "Integrity could not be established"}
        </span>
        <span>Evidence integrity · not a verdict</span>
      </div>
      <div className="px-5 pt-4 pb-5 sm:px-7">
        <H id={id} className="serif text-[24px] leading-[1.18] text-ink sm:text-[26px]">
          {title}
        </H>
        <div className="mt-2 max-w-[66ch] text-sm leading-[1.6] text-ink-2">{body}</div>
        {facts && facts.length > 0 && (
          <dl className="fa-ledger mt-4 max-w-[620px] text-[12.5px]">
            {facts.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 py-[6px]">
                <dt className="text-ink-3">{k}</dt>
                <dd className="min-w-0 text-right font-mono text-[11.5px] break-all text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {actions && <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>}
        <p className="mt-4 font-mono text-[10.5px] text-ink-3">{verdictLine}</p>
      </div>
    </section>
  );
}

/** Integrity line text shared by the archived and the ephemeral evidence panels. */
export function integrityText(s: IntegritySummary, mode: "archive" | "ephemeral", retrievalStopped: boolean): string {
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join(", ");
  if (s.state === "failed")
    return mode === "archive"
      ? `Integrity failed · ${ids(s.failed)} — content failed internal consistency verification`
      : `Digest mismatch · ${ids(s.failed)} — sha256 not reproduced in this browser`;
  if (s.state === "pending") {
    if (retrievalStopped) return mode === "archive" ? "Integrity not established · evidence retrieval stopped" : "Payload digests not checked · evidence read stopped";
    return mode === "archive"
      ? `Integrity not established yet · ${s.verified} of ${s.total} references verified so far`
      : `Payload digests not yet checked · ${s.verified} of ${s.total} reproduced so far`;
  }
  if (s.state === "unverifiable") {
    const why = s.unverifiable[0]?.reason ?? "no supported comparison";
    return mode === "archive"
      ? `Integrity unverifiable · ${s.unverifiable.length} of ${s.total} references not verified (${why})`
      : `Payload digests not checked for ${s.unverifiable.length} of ${s.total} references (${why})`;
  }
  return mode === "archive"
    ? `Stored-content integrity verified · ${s.verified} of ${s.total} references — the Service’s stored-byte check and this browser’s SHA-256 agree`
    : `Payload digests reproduced in this browser · ${s.verified} of ${s.total} — internal consistency only`;
}
