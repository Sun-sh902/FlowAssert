import type { RunView } from "../../domain/view";
import { formatTime } from "../../lib/format";
import { href } from "../../lib/router";
import { RecordCells } from "../records/RecordCells";
import { Seal } from "../ui/status";

/**
 * One workflow's latest run as an evidence trace: captured source cohort → every record → HubSpot.
 * The seal is the COHORT result; the cells are RECORD results.
 */
export function Trace({ run }: { run: RunView }) {
  return (
    <li className="fa-row grid gap-x-6 gap-y-3 border-b border-line-subtle py-[18px] last:border-0 lg:grid-cols-[200px_minmax(0,1fr)_150px] lg:items-center">
      <div className="flex items-start justify-between gap-3 lg:block">
        <div className="min-w-0">
          <p className="text-md leading-5 font-semibold tracking-[-0.005em] text-ink">{run.workflow.name}</p>
          <p className="mono-id mt-0.5 truncate text-[11px] text-ink-3">{run.workflow.sourceNamespace}</p>
        </div>
        <span className="lg:hidden">
          <Seal state={run.state} />
        </span>
      </div>

      <div className="min-w-0">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="fa-trace-line">
            <i className="fa-node-src" aria-hidden />
            <div className="fa-track">
              <RecordCells run={run} />
            </div>
            <i className="fa-node-dst" aria-hidden />
          </div>
          <p className="mono-id text-[11px] leading-tight text-ink-2">
            HubSpot
            <span className="block text-ink-3">contacts</span>
          </p>
        </div>
        <div className="mt-1.5 flex flex-wrap justify-between gap-x-4 font-mono text-[10.5px] text-ink-3">
          <span>
            {run.recordsEvaluated} captured {formatTime(run.capturedAt)}
            {run.expectedTotal === null ? <span className="text-unverified-ink"> · expected total unknown</span> : ` · of ${run.expectedTotal} expected`}
          </span>
          <span>
            {run.accessDenied ? "read denied" : "observed"} {formatTime(run.observedAt)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 lg:grid lg:justify-items-end">
        <span className="hidden lg:inline-flex">
          <Seal state={run.state} />
        </span>
        <a href={href(`/verifications/${run.id}`)} className="fa-hit rounded-xs text-xs text-ink-3 hover:text-brand">
          Open <span className="mono-id">{run.id}</span> →
        </a>
      </div>
    </li>
  );
}
