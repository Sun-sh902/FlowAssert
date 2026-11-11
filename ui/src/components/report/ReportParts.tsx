/**
 * The parts of a result the CSV check page shows, shared with the saved reports pages (#/check/reports): the stated
 * premises with their origins, the notices printed beside the counts, and what the result means (offline/explain.ts).
 * The records are in the result explorer (./Explorer.tsx). Values from the files are marked data-no-translate, so the
 * Chinese interface never alters them.
 */
import { useId, type ReactNode } from "react";
import type { Premise } from "../../offline/evaluator";
import type { Explanation, Part } from "../../offline/explain";
import type { ResultView } from "../../offline/runner";
import { cn } from "../../lib/cn";

export const PREMISE_LABEL: Record<string, string> = {
  source_complete: "The source file is the whole batch",
  destination_complete: "The destination export covers the whole object",
  source_count: "Source total in the original system",
  destination_count: "Destination total in the original system",
  allow_identical_content: "The two identical files come from different systems",
};

export function Value({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code data-no-translate className={cn("font-mono text-[12px] break-all whitespace-pre-wrap text-ink", className)}>
      {children}
    </code>
  );
}

export const yesNo = (v: boolean | number | bigint | null | undefined) => (v === null || v === undefined ? "none" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

export function Premises({ premises }: { premises: [string, Premise][] }) {
  return (
    <section aria-labelledby="premises-h" className="min-w-0 rounded-md border-2 border-unverified-line px-4 py-3">
      <h3 id="premises-h" className="text-sm font-semibold text-ink">
        Stated premises
      </h3>
      <p className="mt-0.5 text-xs text-ink-3">FlowAssert does not verify these statements. A wrong statement gives a wrong result.</p>
      <dl className="mt-2 grid gap-2">
        {premises.map(([name, p]) => (
          <div key={name} className="min-w-0 border-t border-line-subtle pt-2" data-premise={name}>
            <dt className="text-xs text-ink-2">
              {PREMISE_LABEL[name] ?? name} <span className="font-mono text-[10.5px] text-ink-4">{name}</span>
            </dt>
            <dd className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11.5px] text-ink">
              <span>
                <span className="text-ink-3">stated </span>
                {yesNo(p.stated)}
              </span>
              {"observed" in p && (
                <span>
                  <span className="text-ink-3">rows in file </span>
                  {String(p.observed)}
                </span>
              )}
              {"matched" in p && (
                <span>
                  <span className="text-ink-3">matched </span>
                  {yesNo(p.matched)}
                </span>
              )}
              <span>
                <span className="text-ink-3">origin </span>
                <span data-no-translate>{p.origin}</span>
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Notices({ view }: { view: ResultView }) {
  const lines: string[] = [];
  for (const [name, p] of view.premises) {
    if (p.matched !== false) continue;
    lines.push(
      name === "source_count"
        ? `Source count stated ${String(p.stated)}, file has ${p.observed} rows: the batch cannot be Verified.`
        : `Destination count stated ${String(p.stated)}, file has ${p.observed} rows: absence and uniqueness stay unknown.`,
    );
  }
  if (!view.populationKnown) lines.push("Source population unknown: the batch cannot be Verified.");
  if (!view.coverageSufficient) lines.push("Destination coverage not established: absence and uniqueness stay unknown.");
  if (view.destinationOnly) {
    const n = view.destinationOnlyCount;
    lines.push(
      !n
        ? "Destination-only: 0 records not in the source."
        : view.populationKnown
          ? `Destination-only: ${n} records not in the source, each a Mismatch.`
          : `Destination-only: ${n} records not in the source, listed without a conclusion.`,
    );
  }
  if (view.inputs.some(([k, v]) => k === "identical_content" && v === true)) lines.push("Source and destination files were identical (allowed in this check).");
  if (!lines.length) return null;
  return (
    <ul className="mt-3 grid gap-1 text-sm text-ink-2">
      {lines.map((line) => (
        <li key={line} className="flex gap-2">
          <span aria-hidden className="text-ink-4">
            —
          </span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

function Parts({ parts }: { parts: readonly Part[] }) {
  return (
    <>
      {parts.map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : <Value key={i} className="text-[0.92em] text-inherit">{p.value}</Value>))}
    </>
  );
}

/**
 * "What this result means": points read from the report (offline/explain.ts), beside the result and never part of it.
 * They say what the report shows and what would settle what it leaves open; they add no conclusion.
 */
export function ResultExplanation({ explanation }: { explanation: Explanation }) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-h`} className="mt-8 max-w-[78ch] rounded-md border border-line px-4 py-3 sm:px-5" data-testid="explanation" data-explains={explanation.state}>
      <h3 id={`${id}-h`} className="serif text-xl text-ink">
        What this result means
      </h3>
      <p className="mt-1 text-sm text-ink">{explanation.lead}</p>
      <ul className="mt-2 grid gap-2 text-sm text-ink-2">
        {explanation.points.map((p) => (
          <li key={p.id} className="flex gap-2" data-point={p.id}>
            <span aria-hidden className="text-ink-4">
              —
            </span>
            <span className="min-w-0">
              <span>
                <Parts parts={p.text} />
              </span>
              {p.detail && (
                <span className="mt-0.5 block text-xs leading-[1.5] text-ink-3">
                  <Parts parts={p.detail} />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {explanation.more > 0 && (
        <p className="mt-2 text-xs text-ink-3" data-testid="explanation-more">
          {explanation.more === 1 ? "1 more point is left out here; the records below show every reason." : `${explanation.more} more points are left out here; the records below show every reason.`}
        </p>
      )}
      <p className="mt-2 border-t border-line-subtle pt-2 text-xs text-ink-3">Read from this report, which it does not change. It adds no conclusion of its own.</p>
    </section>
  );
}
