import { ChevronRight } from "lucide-react";
import type { RunView } from "../../domain/view";
import { formatDateTime, relativeToDemoNow } from "../../lib/format";
import { href } from "../../lib/router";
import { RecordCells } from "../records/RecordCells";
import { CountGlyphs, Seal } from "../ui/status";

/** Record-level results: glyph counts + proportional strip. Kept visually distinct from the cohort seal. */
export function RecordResults({ run, className }: { run: RunView; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-3 whitespace-nowrap">
        <CountGlyphs counts={run.counts} />
        <span className="font-mono text-[10.5px] text-ink-3">
          {run.expectedTotal === null ? <span className="text-unverified-ink">{run.recordsEvaluated} · total unknown</span> : `${run.recordsEvaluated} records`}
        </span>
      </div>
      <RecordCells run={run} forceStrip />
    </div>
  );
}

/** Runs as a ruled ledger on wide screens, stacked entries on narrow ones. Rows link to the case. */
export function RunsTable({ runs, caption }: { runs: RunView[]; caption: string }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="kicker py-2.5 pr-4 pl-5 font-normal">Run</th>
              <th scope="col" className="kicker py-2.5 pr-4 font-normal">Workflow</th>
              <th scope="col" className="kicker py-2.5 pr-4 font-normal">Cohort result</th>
              <th scope="col" className="kicker py-2.5 pr-4 font-normal lg:w-[30%]">Record results</th>
              <th scope="col" className="kicker py-2.5 pr-5 text-right font-normal">Evaluated</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="fa-row group relative border-b border-line-subtle transition-colors duration-(--fa-dur-fast) last:border-0 hover:bg-hover">
                <td className="h-[58px] py-2 pr-4 pl-5 align-middle">
                  <a
                    href={href(`/demo/verifications/${run.id}`)}
                    className="mono-id font-medium whitespace-nowrap text-ink-2 group-hover:text-ink after:absolute after:inset-0 after:content-[''] focus-visible:shadow-none focus-visible:after:shadow-(--fa-ring-inset)"
                  >
                    {run.id}
                  </a>
                </td>
                <td className="py-2 pr-4 align-middle">
                  <p className="leading-5 font-semibold text-ink">{run.workflow.name}</p>
                  <p className="mono-id truncate text-[10.5px] text-ink-3">{run.workflow.sourceNamespace}</p>
                </td>
                <td className="py-2 pr-4 align-middle">
                  <Seal state={run.state} />
                </td>
                <td className="py-2 pr-4 align-middle">
                  <RecordResults run={run} className="max-w-[280px] min-w-[136px]" />
                </td>
                <td className="py-2 pr-5 text-right align-middle whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <span>
                      <span className="block leading-5 text-ink-2 tabular" title={formatDateTime(run.evaluatedAt)}>
                        {relativeToDemoNow(run.evaluatedAt)}
                      </span>
                      <span className="hidden font-mono text-[10.5px] text-ink-3 lg:block">{formatDateTime(run.evaluatedAt)}</span>
                    </span>
                    <ChevronRight size={14} aria-hidden className="-mr-1 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line-subtle md:hidden" aria-label={caption}>
        {runs.map((run) => (
          <li key={run.id}>
            <a href={href(`/demo/verifications/${run.id}`)} className="block px-4 py-3.5 active:bg-active">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-md font-semibold text-ink">{run.workflow.name}</span>
                  <span className="mono-id text-[10.5px] text-ink-3">
                    {run.id} · {relativeToDemoNow(run.evaluatedAt)}
                  </span>
                </span>
                <Seal state={run.state} />
              </div>
              <RecordResults run={run} className="mt-3" />
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
