/**
 * Archived evaluations as a ruled ledger (md+) or stacked entries (narrow), in exactly the order the
 * archive returned them — newest archive entry first. Nothing is sorted, grouped or merged here.
 *
 * Every value shown is a field of the additive contract's HistorySummary: case, history ID, cohort
 * result and counts (result_summary), expected total (null → "total unknown", never 0 or the row
 * count), evaluator digest, archive time and the archive record's integrity statement. No field is
 * invented to fill a column.
 */
import { ChevronRight } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import type { HistorySummaryView } from "../../domain/history";
import { serviceIntegrityState } from "../../domain/integrity";
import { formatDateTime, plural, shortDigest } from "../../lib/format";
import { href } from "../../lib/router";
import { IntegrityTag } from "../integrity/Integrity";
import { CountGlyphs, Seal } from "../ui/status";

export const shortHistoryId = (id: string) => `${id.slice(0, 13)}…${id.slice(-4)}`;

const rowsOf = (e: HistorySummaryView) => e.result.counts.Verified + e.result.counts.Mismatch + e.result.counts.Pending + e.result.counts.Unverified;

/** Records and expected total, copied. An unknown population stays unknown. */
export function ArchivedRecordResults({ entry, className }: { entry: HistorySummaryView; className?: string }) {
  const n = rowsOf(entry);
  return (
    <span className={className}>
      <CountGlyphs counts={entry.result.counts} />
      <span className="mt-1 block font-mono text-[10.5px] text-ink-3">
        {entry.result.expectedTotal === null ? (
          <span className="text-unverified-ink">{plural(n, "record")} · total unknown</span>
        ) : (
          `${plural(n, "record")} · ${entry.result.expectedTotal} expected`
        )}
      </span>
    </span>
  );
}

/** The archive record's own integrity statement, attributed to the Service (the list carries no evidence payloads). */
export function RecordCheck({ entry }: { entry: HistorySummaryView }) {
  const ok = entry.integrity.status === "INTEGRITY_VERIFIED";
  return (
    <span
      title="The Service re-verified this archive’s stored candidate bytes and relationships when it answered (scope archive_candidate_and_relationships). This browser confirmed that the reported digest names this entry. Evidence payloads are checked on the entry’s page."
    >
      <IntegrityTag state={serviceIntegrityState(entry.integrity.status)}>{ok ? "record check · service" : entry.integrity.status}</IntegrityTag>
    </span>
  );
}

const label = (e: HistorySummaryView) =>
  `${e.verificationId}, archived evaluation ${e.historyId}. Cohort result ${e.result.cohort}. ${plural(rowsOf(e), "record")}${e.result.expectedTotal === null ? ", total unknown" : `, ${e.result.expectedTotal} expected`}. Archived ${formatDateTime(e.archivedAt)}.`;

/**
 * Arrow keys move between entries; Home and End jump to the first and last. Tab order is unchanged.
 * Movement stays inside the layout that holds the focused entry (the wide ledger or the narrow list).
 */
function useRowKeys() {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (ev: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) return;
    const layout = (document.activeElement as HTMLElement | null)?.closest("[data-history-layout]");
    if (!layout || !ref.current?.contains(layout)) return;
    const links = [...layout.querySelectorAll<HTMLAnchorElement>("a[data-history-link]")];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (i === -1) return;
    ev.preventDefault();
    const next = ev.key === "Home" ? 0 : ev.key === "End" ? links.length - 1 : Math.min(links.length - 1, Math.max(0, i + (ev.key === "ArrowDown" ? 1 : -1)));
    links[next]?.focus();
  };
  return { ref, onKeyDown };
}

export function HistoryRows({ entries, caption }: { entries: HistorySummaryView[]; caption: string }) {
  const keys = useRowKeys();
  return (
    <div ref={keys.ref} onKeyDown={keys.onKeyDown}>
      <div className="hidden overflow-x-auto md:block" data-history-layout="wide">
        <table className="w-full text-sm" data-history-table>
          <caption className="sr-only">{caption}. Use the arrow keys to move between entries.</caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="kicker py-2.5 pr-4 pl-5 font-normal">
                Archived evaluation
              </th>
              <th scope="col" className="kicker py-2.5 pr-4 font-normal">
                Cohort result
              </th>
              <th scope="col" className="kicker py-2.5 pr-4 font-normal">
                Record results
              </th>
              <th scope="col" className="kicker py-2.5 pr-4 font-normal">
                Archive record
              </th>
              <th scope="col" className="kicker py-2.5 pr-5 text-right font-normal">
                Archived
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.historyId} data-history-id={e.historyId} className="fa-row group relative border-b border-line-subtle transition-colors duration-(--fa-dur-fast) last:border-0 hover:bg-hover">
                <td className="h-[62px] py-2 pr-4 pl-5 align-middle">
                  <a
                    data-history-link
                    href={href(`/local/history/${e.historyId}`)}
                    aria-label={label(e)}
                    className="mono-id block font-medium whitespace-nowrap text-ink group-hover:text-ink after:absolute after:inset-0 after:content-[''] focus-visible:shadow-none focus-visible:after:shadow-(--fa-ring-inset)"
                  >
                    {e.verificationId}
                  </a>
                  <span className="mono-id block text-[10.5px] whitespace-nowrap text-ink-3" title={e.historyId}>
                    {shortHistoryId(e.historyId)} · eval {shortDigest(e.evaluator.modelSha256).slice(0, 8)}
                  </span>
                </td>
                <td className="py-2 pr-4 align-middle">
                  <Seal state={e.result.cohort} />
                </td>
                <td className="py-2 pr-4 align-middle">
                  <ArchivedRecordResults entry={e} className="block min-w-[150px]" />
                </td>
                <td className="py-2 pr-4 align-middle">
                  <RecordCheck entry={e} />
                </td>
                <td className="py-2 pr-5 text-right align-middle whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono text-[11px] text-ink-2 tabular">{formatDateTime(e.archivedAt)}</span>
                    <ChevronRight size={14} aria-hidden className="-mr-1 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line-subtle md:hidden" aria-label={caption} data-history-layout="narrow">
        {entries.map((e) => (
          <li key={e.historyId} data-history-id={e.historyId}>
            <a data-history-link href={href(`/local/history/${e.historyId}`)} aria-label={label(e)} className="block px-4 py-3.5 active:bg-active">
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="mono-id block font-medium text-ink">{e.verificationId}</span>
                  <span className="mono-id block truncate text-[10.5px] text-ink-3">{shortHistoryId(e.historyId)}</span>
                  <span className="mono-id block text-[10.5px] text-ink-3">archived {formatDateTime(e.archivedAt)}</span>
                </span>
                <Seal state={e.result.cohort} />
              </span>
              <span className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                <ArchivedRecordResults entry={e} />
                <RecordCheck entry={e} />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The list while its first page is read: the ledger's rules with values withheld. No row is drawn as data. */
export function HistoryRowsSkeleton() {
  return (
    <div aria-busy="true" data-access="LOADING" className="px-4 py-2 sm:px-5">
      <p role="status" className="sr-only">
        Reading the archive list from the local service. No entry is shown until the read completes.
      </p>
      <ul aria-hidden className="divide-y divide-line-subtle">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="grid h-[62px] grid-cols-[minmax(0,1fr)_96px] items-center gap-4 md:grid-cols-[180px_110px_minmax(0,1fr)_140px]">
            <span className="grid gap-1.5">
              <span className="fa-skel fa-breathe" data-size="text" style={{ width: "72px" }} />
              <span className="fa-skel fa-breathe" data-size="text" style={{ width: `${[120, 104, 132, 96][i]}px` }} />
            </span>
            <span className="fa-seal w-fit" data-s="reading">
              reading
            </span>
            <span className="fa-skel fa-breathe hidden md:block" data-size="text" style={{ width: "60%" }} />
            <span className="fa-skel fa-breathe hidden md:block" data-size="text" style={{ width: "120px" }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
