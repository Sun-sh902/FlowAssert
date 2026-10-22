import { STACK_ORDER, type RunView } from "../../domain/view";
import { cn } from "../../lib/cn";

/** Above this many records a run is drawn as an aggregate strip instead of one square per record. */
export const CELL_LIMIT = 120;

function describe(run: RunView) {
  const parts = STACK_ORDER.filter((s) => run.counts[s]).map((s) => `${run.counts[s]} ${s}`);
  return `${run.recordsEvaluated} records: ${parts.join(", ")}${run.expectedTotal === null ? "; expected total unknown" : ""}`;
}

/**
 * Record results for one run. One square per record in capture order; an open tail of rings
 * when the expected total is unknown (more source records may exist). Large cohorts fall back
 * to a proportional strip in the same visual language.
 */
export function RecordCells({ run, className, forceStrip = false }: { run: RunView; className?: string; forceStrip?: boolean }) {
  const unknown = run.expectedTotal === null;
  if (forceStrip || run.recordsEvaluated > CELL_LIMIT) {
    return (
      <div className={cn("fa-strip", className)} role="img" aria-label={describe(run)}>
        {STACK_ORDER.filter((s) => run.counts[s]).map((s) => (
          <span key={s} data-s={s} style={{ flexGrow: run.counts[s], flexBasis: 0 }} />
        ))}
        {unknown && <span data-s="unknown" title="Expected total unknown" />}
      </div>
    );
  }
  const ordered = [...run.records].sort((a, b) => a.sourceRow - b.sourceRow);
  return (
    <div className={cn("fa-cells", className)} role="img" aria-label={describe(run)}>
      {ordered.map((r) => (
        <i key={r.rowId} className="fa-cell" data-s={r.state} />
      ))}
      {unknown && [0, 1, 2].map((i) => <i key={`u${i}`} className="fa-cell" data-s="unknown" title="Expected total unknown" />)}
    </div>
  );
}
