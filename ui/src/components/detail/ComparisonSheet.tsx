import { Info } from "lucide-react";
import type { ReactNode } from "react";
import type { RecordView, RuleStatus, RunView } from "../../domain/view";
import { cn } from "../../lib/cn";
import { plural } from "../../lib/format";
import { Disclosure, Tag } from "../ui/primitives";
import { Operator, StatusBadge } from "../ui/status";
import { DiffValue } from "./FieldDiff";

interface Row {
  id: string;
  label: string;
  sub: string;
  status: RuleStatus;
  src: ReactNode;
  dst: ReactNode;
  note: string;
  proposed?: boolean;
}

/**
 * The comparison sheet: what the captured source expected and what HubSpot showed, aligned on an
 * operator spine (= holds, ≠ contradicted, ? not assessed). One row per required rule.
 */
export function ComparisonSheet({ record, run }: { record: RecordView; run: RunView }) {
  const rule = (id: string) => record.rules.find((r) => r.id === id);
  const field = (id: string) => record.fields.find((f) => f.field === id);
  const none = (text: string) => <span className="font-sans text-xs text-ink-3 italic">{text}</span>;
  const unknown = record.rules.filter((r) => r.status === "unknown").length;
  // Secondary text on the tinted Mismatch rows steps up one ink to keep 4.5:1 contrast.
  const muted = (r: Row) => (r.status === "fail" ? "text-ink-2" : "text-ink-3");

  const rows: Row[] = [];
  const exists = rule("existence");
  if (exists)
    rows.push({
      id: "existence",
      label: "Record exists",
      sub: "key lookup",
      status: exists.status,
      src: record.key,
      dst: record.candidateIds.length
        ? record.candidateIds.join(", ")
        : none(run.destinationAccess !== "ok" ? "not readable" : record.state === "Pending" ? "not observed yet" : "no contact with this key"),
      note: exists.explanation,
    });
  const unique = rule("uniqueness");
  if (unique)
    rows.push({
      id: "uniqueness",
      label: "One per key",
      sub: "uniqueness",
      status: unique.status,
      src: "unique key",
      dst: run.destinationAccess !== "ok" ? none("not readable") : plural(record.candidateIds.length, "contact"),
      note: unique.explanation,
    });
  for (const f of ["phone", "email"] as const) {
    const fv = field(f);
    const rl = rule(f);
    if (!fv || !rl) continue;
    rows.push({
      id: f,
      label: fv.label,
      sub: rl.proposed ? "proposed rule" : "exact string",
      status: fv.status,
      src: <DiffValue value={fv.source} other={fv.destination} side="source" />,
      dst: <DiffValue value={fv.destination} other={fv.source} side="destination" />,
      note: rl.explanation,
      proposed: rl.proposed,
    });
  }

  return (
    <article aria-labelledby="sheet-title" className="fade-in" key={record.rowId}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 pt-5 pb-4 sm:px-6">
        <div className="min-w-0">
          <p className="kicker">Comparison sheet · source row {record.sourceRow + 1}</p>
          <h3 id="sheet-title" className={cn("mt-1.5 font-mono text-[19px] font-medium tracking-[-0.02em] text-ink", record.keyMalformed && "italic")}>
            {record.key}
          </h3>
          <p className="text-xs text-ink-3">
            {record.displayName ?? <span className="italic">No name supplied</span>}
            {record.company && ` · ${record.company}`}
          </p>
        </div>
        <StatusBadge state={record.state} />
      </header>

      <div className="border-b border-line px-5 py-3.5 sm:px-6">
        <p className="font-display text-[21px] leading-[1.3] text-ink">{record.summary}</p>
        {record.state === "Mismatch" && unknown > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-3">
            <Info size={13} aria-hidden className="mt-px shrink-0" />
            Mismatch is established by the failing rule. It does not mean every other rule was assessed.
          </p>
        )}
        {record.state === "Verified" && !run.populationKnown && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-unverified-ink">
            <Info size={13} aria-hidden className="mt-px shrink-0" />
            This record is Verified, but the cohort is Unverified: the source total is not confirmed.
          </p>
        )}
      </div>

      {/* Wide: four-column sheet on the operator spine */}
      <div className="hidden sm:block">
        <div className="grid grid-cols-[112px_minmax(0,1fr)_52px_minmax(0,1fr)] border-b border-line px-6 py-2.5">
          <span className="kicker">Assertion</span>
          <span className="kicker">Source cohort · expected</span>
          <span aria-hidden />
          <span className="kicker">HubSpot · observed</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.id}
            className={cn(
              "grid grid-cols-[112px_minmax(0,1fr)_52px_minmax(0,1fr)] border-b border-line-subtle px-6 last:border-0",
              r.status === "fail" && "bg-[linear-gradient(90deg,transparent,var(--fa-mismatch-soft)_30%,var(--fa-mismatch-soft)_70%,transparent)]",
            )}
          >
            <p className="py-3.5 text-sm font-semibold text-ink">
              {r.label}
              <span className="mt-0.5 block text-[11px] font-normal text-ink-3">{r.proposed ? <Tag>proposed rule</Tag> : r.sub}</span>
            </p>
            <p className={cn("fa-diff py-3.5 pr-3 font-mono text-[13px] leading-[1.45] [overflow-wrap:break-word] text-ink", r.status === "unknown" && "text-ink-2")} data-side="src">
              {r.src}
            </p>
            <div className="fa-spine py-3">
              <Operator status={r.status} />
            </div>
            <p className={cn("fa-diff py-3.5 font-mono text-[13px] leading-[1.45] [overflow-wrap:break-word] text-ink", r.status === "unknown" && "text-ink-2")} data-side="dst">
              {r.dst}
            </p>
            <p className={cn("col-start-2 col-end-5 -mt-1.5 pb-3 text-xs", muted(r))}>{r.note}</p>
          </div>
        ))}
      </div>

      {/* Narrow: stacked rows with the operator between source and HubSpot */}
      <ul className="divide-y divide-line-subtle sm:hidden">
        {rows.map((r) => (
          <li key={r.id} className={cn("px-4 py-3", r.status === "fail" && "bg-mismatch-soft")}>
            <p className="flex items-center justify-between text-sm font-semibold text-ink">
              {r.label}
              <span className={cn("font-mono text-[10.5px] font-normal", muted(r))}>{r.proposed ? "proposed rule" : r.sub}</span>
            </p>
            <dl className="mt-2 grid grid-cols-[58px_1fr] items-center gap-x-2 gap-y-1.5 font-mono text-xs">
              <dt className={cn("font-sans", muted(r))}>Source</dt>
              <dd className="fa-diff [overflow-wrap:break-word] text-ink" data-side="src">
                {r.src}
              </dd>
              <dt className="sr-only">Comparison</dt>
              <dd className="col-start-2">
                <Operator status={r.status} size={24} />
              </dd>
              <dt className={cn("font-sans", muted(r))}>HubSpot</dt>
              <dd className="fa-diff [overflow-wrap:break-word] text-ink" data-side="dst">
                {r.dst}
              </dd>
            </dl>
            <p className={cn("mt-2 text-xs", muted(r))}>{r.note}</p>
          </li>
        ))}
      </ul>

      <div className="border-t border-line px-5 sm:px-6">
        <Disclosure summary="Evaluator reason strings" meta={`${record.rulesPassed} of ${record.rulesTotal} passed`}>
          <dl className="mb-3 space-y-1.5 rounded-sm bg-sunken p-3 font-mono text-[11px]">
            {record.rules.map((r) => (
              <div key={r.id} className="flex flex-wrap gap-x-2">
                <dt className="text-ink-3">
                  rules.{r.id}.{r.status}
                </dt>
                <dd className="text-ink-2">“{r.reasonRaw}”</dd>
              </div>
            ))}
          </dl>
        </Disclosure>
      </div>
    </article>
  );
}
