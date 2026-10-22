import { useId, useState } from "react";
import type { TrendDay } from "../../data/store";
import { STACK_ORDER } from "../../domain/view";
import { formatDay } from "../../lib/format";
import { StatusGlyph } from "../ui/status";

/**
 * Records evaluated per UTC day as proportional strips (same encoding as record cells:
 * solid, outlined, hatched). Per-row hover/focus tooltip and a table view.
 */
export function DailyRegister({ days }: { days: TrendDay[] }) {
  const [active, setActive] = useState<string | null>(null);
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();
  const total = (d: TrendDay) => STACK_ORDER.reduce((n, s) => n + d.counts[s], 0);
  const max = Math.max(1, ...days.map(total));

  return (
    <div>
      {!asTable ? (
        <ul>
          {days.map((d) => {
            const t = total(d);
            return (
              <li
                key={d.iso}
                tabIndex={0}
                aria-label={`${formatDay(d.iso)}: ${t} records in ${d.runs} runs. ${STACK_ORDER.map((s) => `${d.counts[s]} ${s}`).join(", ")}.`}
                onMouseEnter={() => setActive(d.iso)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(d.iso)}
                onBlur={() => setActive(null)}
                className="relative grid grid-cols-[52px_minmax(0,1fr)_40px] items-center gap-3 border-b border-dotted border-line py-2.5 outline-none last:border-0 focus-visible:bg-hover"
              >
                <span className="font-mono text-[11px] text-ink-2">{formatDay(d.iso)}</span>
                <span className="fa-strip" style={{ height: 14, width: `${(t / max) * 100}%` }}>
                  {STACK_ORDER.filter((s) => d.counts[s]).map((s) => (
                    <span key={s} data-s={s} style={{ flexGrow: d.counts[s], flexBasis: 0 }} />
                  ))}
                </span>
                <span className="text-right font-mono text-[11px] text-ink-3">{t}</span>
                {active === d.iso && (
                  <span role="tooltip" className="pointer-events-none absolute top-full left-14 z-10 mt-1 w-44 rounded-sm border border-line bg-raised p-2.5 text-xs shadow-pop">
                    <span className="block font-medium text-ink">
                      {formatDay(d.iso)} · {d.runs} {d.runs === 1 ? "run" : "runs"}
                    </span>
                    {[...STACK_ORDER].reverse().map((s) => (
                      <span key={s} className="mt-1 flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-ink-2">
                          <StatusGlyph state={s} size={10} />
                          {s}
                        </span>
                        <span className="font-mono text-ink">{d.counts[s]}</span>
                      </span>
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <table id={tableId} className="w-full text-sm">
          <caption className="sr-only">Records evaluated per UTC day</caption>
          <thead>
            <tr className="label border-b border-line text-left">
              <th scope="col" className="py-2 pr-2 font-medium">Day</th>
              <th scope="col" className="py-2 pr-2 text-right font-medium">Runs</th>
              {STACK_ORDER.map((s) => (
                <th key={s} scope="col" className="py-2 pr-2 text-right font-medium">{s}</th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {days.map((d) => (
              <tr key={d.iso} className="border-b border-line-subtle last:border-0">
                <th scope="row" className="py-2 pr-2 text-left font-normal text-ink">{formatDay(d.iso)}</th>
                <td className="py-2 pr-2 text-right text-ink-2">{d.runs}</td>
                {STACK_ORDER.map((s) => (
                  <td key={s} className="py-2 pr-2 text-right text-ink-2">{d.counts[s]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="text-xs text-ink-3">Each day is a newly captured cohort; a record counts once per run that evaluated it.</p>
        <button
          type="button"
          aria-expanded={asTable}
          aria-controls={tableId}
          onClick={() => setAsTable((v) => !v)}
          className="fa-hit shrink-0 rounded-xs text-xs font-medium text-ink-2 underline decoration-line-strong underline-offset-[3px] hover:text-ink"
        >
          {asTable ? "Show strips" : "View as table"}
        </button>
      </div>
    </div>
  );
}
