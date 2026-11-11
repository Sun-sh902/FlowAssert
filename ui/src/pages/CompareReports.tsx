/**
 * Comparing two saved reports (#/check/compare?earlier=ID&later=ID): the two reports, then any premise difference and
 * any changed file, then the classes of offline/compare.ts with their counts, then the records of each class, then
 * what could not be matched. A comparison is a view of two observations, not a new verdict: every state shown is one
 * a report gives, every class is a list of records (never a score or a trend), and the words say what each report
 * recorded, never that a problem was fixed or that a record is correct.
 *
 * Both reports are read again from their original bytes. Two reports that are not comparable are refused with the
 * reasons, and nothing of a comparison is shown.
 */
import { ArrowLeftRight } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { RecordExplorer } from "../components/report/Explorer";
import { ANY, EXPLORER_PARAMS } from "../offline/explore";
import { PREMISE_LABEL, Value, yesNo } from "../components/report/ReportParts";
import { StorageProblem } from "../components/report/Storage";
import { PageHead, SectionHead } from "../components/ui/atelier";
import { buttonClass } from "../components/ui/primitives";
import { RuleStatusIcon, RuleStatusLabel, StatusBadge, StatusGlyph } from "../components/ui/status";
import { CLASSES, DESTINATION_ONLY_CLASSES, compareReports, type Comparison, type ComparisonResult, type DestinationOnlyChange, type NotComparableCode, type RecordChange, type RecordClass, type Unmatched } from "../offline/compare";
import type { Counts, State } from "../offline/evaluator";
import { pyRepr } from "../offline/pystr";
import { SHOWN_RECORDS } from "../offline/runner";
import { storeOfSaved, type SavedReport, type StatedPremise } from "../offline/savedReport";
import { useAllFontFaces } from "../lib/fonts";
import { href, useLocation, useReplaceParams } from "../lib/router";
import { useReportStore } from "../lib/savedReports";
import { BackToSaved, Provenance, obtainedText, openEntry, type Opened } from "./SavedReports";

type Pair = { earlier: Exclude<Opened, null>; later: Exclude<Opened, null> };
type Load = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; error: unknown } | { kind: "ready"; pair: Pair };

const SHOWN_STATES = ["Verified", "Mismatch", "Unverified"] as const;

const CLASS_TEXT: Record<RecordClass, { title: string; body: string }> = {
  "became-problem": { title: "Became a problem", body: "Verified in the earlier report, not Verified in the later report." },
  "stopped-problem": { title: "Stopped being a problem", body: "Not Verified in the earlier report, Verified in the later report." },
  "still-problem": { title: "Still a problem", body: "Not Verified in either report. The two states may differ." },
  "still-verified": { title: "Verified in both reports", body: "Verified in the earlier report and in the later report." },
  "only-earlier": { title: "Only in the earlier source", body: "The later report’s source has no record with this key." },
  "only-later": { title: "Only in the later source", body: "The earlier report’s source has no record with this key." },
};

const DESTINATION_ONLY_TEXT: Record<(typeof DESTINATION_ONLY_CLASSES)[number], { title: string; body: string }> = {
  "still-problem": { title: "Destination-only in both reports", body: "A destination key that is not in the source, in both reports." },
  "only-earlier": { title: "Destination-only in the earlier report only", body: "The later report does not list this destination key as destination-only." },
  "only-later": { title: "Destination-only in the later report only", body: "The earlier report does not list this destination key as destination-only." },
};

const REFUSAL_TEXT: Record<NotComparableCode, string> = {
  "different-key": "The key columns differ.",
  "different-fields": "The compared fields differ.",
  "different-rules": "The rules differ.",
  "different-scope": "The scope differs.",
  "different-comparison": "The comparison differs.",
  "different-source": "The source differs: a CSV file in one report and a Google Sheets range in the other, or two different ranges.",
  redacted: "A report is redacted, so its keys cannot be matched.",
  "same-report": "The two are the same report.",
};

/* ---------- Pieces ---------- */

function States({ earlier, later }: { earlier: State | null | undefined; later: State | null | undefined }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="text-ink-3">earlier</span>
      {earlier ? <StatusBadge state={earlier} /> : <span className="text-ink-3">no record</span>}
      <span aria-hidden className="text-ink-4">
        →
      </span>
      <span className="text-ink-3">later</span>
      {later ? <StatusBadge state={later} /> : <span className="text-ink-3">no record</span>}
    </span>
  );
}

function Counted({ counts }: { counts: Counts }) {
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {SHOWN_STATES.map((s) => (
        <div key={s} className="flex items-center gap-1.5">
          <StatusGlyph state={s} size={10} />
          <dt className="text-ink-2">{s}</dt>
          <dd className="font-mono tabular text-ink" data-count={s}>
            {counts[s]}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ReportCard({ role, opened }: { role: "earlier" | "later"; opened: Exclude<Opened, null> }) {
  const { entry } = opened;
  return (
    <div className="surface min-w-0 rounded-md px-4 py-3" data-report={role}>
      <p className="kicker">{role === "earlier" ? "Earlier report" : "Later report"}</p>
      <p className="mt-1.5 text-sm">
        <span className="text-ink-3">evaluated at </span>
        <Value>{entry.summary.evaluatedAt}</Value>
      </p>
      <p className="mt-1 text-xs text-ink-2">
        <span>{obtainedText(entry.obtained)}</span>
        {entry.obtained.kind === "imported" && (
          <>
            {" · "}
            <Value className="text-ink-2">{entry.obtained.fileName}</Value>
          </>
        )}
      </p>
      {"read" in opened && (
        <p className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-ink-3">batch result</span>
          <StatusBadge state={opened.read.report.cohort_state} />
        </p>
      )}
      <div className="mt-2">
        <Provenance obtained={entry.obtained} compact />
      </div>
    </div>
  );
}

const stated = (p: StatedPremise | null) => (p === null ? "not in this report" : yesNo(p.stated));

function PremiseRow({ name, earlier, later, statedDiffers, originDiffers }: { name: string; earlier: StatedPremise | null; later: StatedPremise | null; statedDiffers: boolean; originDiffers: boolean }) {
  return (
    <li className="min-w-0 border-t border-line-subtle py-2 first:border-t-0" data-premise-difference={name}>
      <p className="text-xs text-ink-2">
        {PREMISE_LABEL[name] ?? name} <span className="font-mono text-[10.5px] text-ink-4">{name}</span>
      </p>
      <dl className="mt-1 grid gap-x-3 gap-y-0.5 font-mono text-[11.5px] sm:grid-cols-[70px_minmax(0,1fr)]">
        {(
          [
            ["earlier", earlier],
            ["later", later],
          ] as const
        ).map(([role, p]) => (
          <div key={role} className="contents">
            <dt className="text-ink-3">{role}</dt>
            <dd className="flex flex-wrap gap-x-3 text-ink">
              <span>
                <span className="text-ink-3">stated </span>
                <span className={statedDiffers ? "font-semibold" : undefined}>{stated(p)}</span>
              </span>
              {p && (
                <span>
                  <span className="text-ink-3">origin </span>
                  <span data-no-translate className={originDiffers ? "font-semibold" : undefined}>
                    {p.origin}
                  </span>
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 text-ink-2">{children}</dd>
    </>
  );
}

const changedText = (changed: boolean) => (changed ? "changed" : "the same in both reports");
const yesNoPair = (a: boolean, b: boolean) => `${a ? "yes" : "no"} → ${b ? "yes" : "no"}`;

function Before({ c }: { c: Comparison }) {
  const statedDiffer = c.premiseDifferences.some((d) => d.stated);
  return (
    <section aria-labelledby="before-h" data-testid="before-counts">
      <SectionHead id="before-h" title="Premises and files" aside="read this before the counts" />
      <div className="grid gap-4">
        {c.premiseDifferences.length > 0 && (
          <div className="min-w-0 rounded-md border-2 border-unverified-line px-4 py-3" data-testid="premise-differences">
            <h3 className="text-sm font-semibold text-ink">{statedDiffer ? "The two reports state different premises" : "The premises were stated in different places"}</h3>
            <p className="mt-0.5 text-xs leading-[1.5] text-ink-3">
              {statedDiffer
                ? "A change below may come from the premises and not from the data. FlowAssert does not verify either report’s premises."
                : "Each premise has the same stated value in both reports; only where it was stated differs. FlowAssert does not verify either report’s premises."}
            </p>
            <ul className="mt-2">
              {c.premiseDifferences.map((d) => (
                <PremiseRow key={d.name} name={d.name} earlier={d.earlier} later={d.later} statedDiffers={d.stated} originDiffers={d.origin} />
              ))}
            </ul>
          </div>
        )}
        {c.sameFilesSamePremises && (
          <p className="rounded-md border border-line px-4 py-3 text-sm text-ink-2" data-testid="same-files">
            The two reports describe the same files under the same premises.
          </p>
        )}
        <dl className="surface grid gap-x-3 gap-y-1 rounded-md px-4 py-3 text-xs sm:grid-cols-[230px_minmax(0,1fr)]">
          <Fact label={c.sheetSource ? "Source rows (Google Sheets range)" : "Source file"}>
            <span data-digest="source">{changedText(c.digests.source.changed)}</span>
            {c.digests.source.changed && (
              <span className="block">
                <Value className="text-ink-3">{`${c.digests.source.earlier} → ${c.digests.source.later}`}</Value>
              </span>
            )}
          </Fact>
          <Fact label="Destination file">
            <span data-digest="destination">{changedText(c.digests.destination.changed)}</span>
            {c.digests.destination.changed && (
              <span className="block">
                <Value className="text-ink-3">{`${c.digests.destination.earlier} → ${c.digests.destination.later}`}</Value>
              </span>
            )}
          </Fact>
          <Fact label="Batch result">
            <span className="inline-flex flex-wrap items-center gap-2">
              <StatusBadge state={c.cohortState.earlier} />
              <span aria-hidden className="text-ink-4">
                →
              </span>
              <StatusBadge state={c.cohortState.later} />
            </span>
          </Fact>
          <Fact label="Counts in the earlier report">
            <Counted counts={c.counts.earlier} />
          </Fact>
          <Fact label="Counts in the later report">
            <Counted counts={c.counts.later} />
          </Fact>
          {c.destinationOnlyCounts && (
            <>
              <Fact label="Destination-only, earlier">
                <Counted counts={c.destinationOnlyCounts.earlier} />
              </Fact>
              <Fact label="Destination-only, later">
                <Counted counts={c.destinationOnlyCounts.later} />
              </Fact>
            </>
          )}
          <Fact label="Source rows">
            <span className="font-mono">{`${c.sourceRowsObserved.earlier} → ${c.sourceRowsObserved.later}`}</span>
          </Fact>
          <Fact label="Source population known">
            <span>{yesNoPair(c.sourcePopulationKnown.earlier, c.sourcePopulationKnown.later)}</span>
          </Fact>
          <Fact label="Destination coverage sufficient">
            <span>{yesNoPair(c.destinationCoverageSufficient.earlier, c.destinationCoverageSufficient.later)}</span>
          </Fact>
          <Fact label="Details">
            <Value className="text-ink-2">{`${c.details.earlier} → ${c.details.later}`}</Value>
          </Fact>
        </dl>
      </div>
    </section>
  );
}

function RuleChanges({ change }: { change: RecordChange }) {
  if (change.earlier === null || change.later === null) return null;
  if (change.rules === null)
    return <p className="mt-1.5 text-xs text-ink-3">Rule-level changes are not available for this record: a report with details problems lists only the state of a Verified record.</p>;
  if (!change.rules.length && !change.candidates) return <p className="mt-1.5 text-xs text-ink-3">Every rule result is the same in both reports.</p>;
  return (
    <ul className="mt-1.5">
      {change.candidates && <li className="border-t border-line-subtle py-1.5 text-xs text-ink-2 first:border-t-0">{`Destination rows with this key: ${change.candidates[0]} → ${change.candidates[1]}`}</li>}
      {change.rules.map((r) => (
        <li key={r.rule} className="grid gap-1 border-t border-line-subtle py-1.5 first:border-t-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <Value className="text-ink-2">{r.rule}</Value>
            <span className="inline-flex items-center gap-1">
              <RuleStatusIcon status={r.earlier.status} />
              <RuleStatusLabel status={r.earlier.status} />
            </span>
            <span aria-hidden className="text-ink-4">
              →
            </span>
            <span className="inline-flex items-center gap-1">
              <RuleStatusIcon status={r.later.status} />
              <RuleStatusLabel status={r.later.status} />
            </span>
          </div>
          {(r.changed.includes("expected") || r.changed.includes("actual")) && (
            <div className="grid gap-0.5 text-xs sm:grid-cols-[150px_minmax(0,1fr)]">
              {r.changed.includes("expected") && (
                <>
                  <span className="text-ink-3">Source value</span>
                  <Value>{`${pyRepr(r.earlier.expected ?? null)} → ${pyRepr(r.later.expected ?? null)}`}</Value>
                </>
              )}
              {r.changed.includes("actual") && (
                <>
                  <span className="text-ink-3">Destination value</span>
                  <Value>{`${pyRepr(r.earlier.actual ?? null)} → ${pyRepr(r.later.actual ?? null)}`}</Value>
                </>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Rows({ change }: { change: { earlier: { source_row: number } | null; later: { source_row: number } | null } }) {
  return (
    <>
      {change.earlier && <span className="text-xs text-ink-3">{" · "}<span>{`record ${change.earlier.source_row + 1} of the earlier report`}</span></span>}
      {change.later && <span className="text-xs text-ink-3">{" · "}<span>{`record ${change.later.source_row + 1} of the later report`}</span></span>}
    </>
  );
}

function Limited({ count }: { count: number }) {
  return count > SHOWN_RECORDS ? <p className="mt-2 text-xs text-ink-3">{`The first ${SHOWN_RECORDS} of ${count} are listed here.`}</p> : null;
}

function ClassList({ cls, changes }: { cls: RecordClass; changes: RecordChange[] }) {
  const text = CLASS_TEXT[cls];
  return (
    <section aria-labelledby={`class-${cls}`} data-class={cls}>
      <h3 id={`class-${cls}`} className="serif text-xl text-ink">{`${text.title} (${changes.length})`}</h3>
      <p className="mt-0.5 text-xs text-ink-3">{text.body}</p>
      {changes.length > 0 && (
        <ul className="mt-2 grid gap-2">
          {changes.slice(0, SHOWN_RECORDS).map((c) => (
            <li key={c.key} className="surface min-w-0 rounded-md px-4 py-2.5" data-key={c.key}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-sm text-ink">
                  <Value>{c.key}</Value>
                  <Rows change={c} />
                </p>
                <States earlier={c.earlier?.state} later={c.later?.state} />
              </div>
              <RuleChanges change={c} />
            </li>
          ))}
        </ul>
      )}
      <Limited count={changes.length} />
    </section>
  );
}

function DestinationOnlyClass({ cls, changes }: { cls: (typeof DESTINATION_ONLY_CLASSES)[number]; changes: DestinationOnlyChange[] }) {
  const text = DESTINATION_ONLY_TEXT[cls];
  return (
    <section aria-labelledby={`destination-only-${cls}`} data-destination-only-class={cls}>
      <h3 id={`destination-only-${cls}`} className="serif text-xl text-ink">{`${text.title} (${changes.length})`}</h3>
      <p className="mt-0.5 text-xs text-ink-3">{text.body}</p>
      {changes.length > 0 && (
        <ul className="mt-2 grid gap-2">
          {changes.slice(0, SHOWN_RECORDS).map((c) => (
            <li key={c.key} className="surface flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md px-4 py-2.5 text-sm" data-key={c.key}>
              <Value>{c.key}</Value>
              <States earlier={c.earlier?.state} later={c.later?.state} />
            </li>
          ))}
        </ul>
      )}
      <Limited count={changes.length} />
    </section>
  );
}

function unmatchedReason(u: Unmatched) {
  if (u.reason === "no-key") return "no key: the record cannot be matched";
  const { earlier, later } = u.records!;
  return `the key is on ${earlier} records of the earlier report and ${later} of the later one`;
}

function Classes({ c }: { c: Comparison }) {
  const only = c.destinationOnly;
  return (
    <>
      <section aria-labelledby="classes-h">
        <SectionHead id="classes-h" title="Records by class" aside="what each report recorded" />
        <p className="mb-3 max-w-[70ch] text-sm text-ink-2">Each record keeps the state its report gives. A class says what the two reports recorded, not why a state changed.</p>
        <dl className="surface grid gap-x-6 gap-y-1 rounded-md px-4 py-3 text-sm sm:grid-cols-2" data-testid="class-counts">
          {CLASSES.map((cls) => (
            <div key={cls} className="flex items-baseline justify-between gap-3 border-t border-line-subtle py-1 first:border-t-0 sm:[&:nth-child(2)]:border-t-0">
              <dt className="text-ink-2">{CLASS_TEXT[cls].title}</dt>
              <dd className="font-mono tabular text-ink" data-class-count={cls}>
                {c.records[cls].length}
              </dd>
            </div>
          ))}
          {only &&
            DESTINATION_ONLY_CLASSES.map((cls) => (
              <div key={`d-${cls}`} className="flex items-baseline justify-between gap-3 border-t border-line-subtle py-1">
                <dt className="text-ink-2">{DESTINATION_ONLY_TEXT[cls].title}</dt>
                <dd className="font-mono tabular text-ink" data-destination-only-count={cls}>
                  {only[cls].length}
                </dd>
              </div>
            ))}
          <div className="flex items-baseline justify-between gap-3 border-t border-line-subtle py-1">
            <dt className="text-ink-2">Not matched</dt>
            <dd className="font-mono tabular text-ink" data-class-count="not-matched">
              {c.unmatched.length}
            </dd>
          </div>
        </dl>
        {c.ruleLevelUnavailable > 0 && (
          <p className="mt-2 max-w-[70ch] text-xs text-ink-3" data-testid="rule-level-unavailable">
            {c.ruleLevelUnavailable === 1
              ? "For 1 record in both reports, rule-level changes are not available: a report with details problems lists only the state of a Verified record, so only the states are compared."
              : `For ${c.ruleLevelUnavailable} records in both reports, rule-level changes are not available: a report with details problems lists only the state of a Verified record, so only the states are compared.`}
          </p>
        )}
      </section>

      <div className="grid gap-8">
        {CLASSES.map((cls) => (
          <ClassList key={cls} cls={cls} changes={c.records[cls]} />
        ))}
        {only && DESTINATION_ONLY_CLASSES.map((cls) => <DestinationOnlyClass key={cls} cls={cls} changes={only[cls]} />)}
      </div>

      <section aria-labelledby="unmatched-h" data-testid="unmatched">
        <SectionHead id="unmatched-h" title={`Not matched (${c.unmatched.length})`} aside="nothing is guessed" />
        {c.unmatched.length === 0 ? (
          <p className="text-sm text-ink-3">Every record has a key found on one record at most in each report.</p>
        ) : (
          <>
            <ul className="grid gap-2">
              {c.unmatched.slice(0, SHOWN_RECORDS).map((u) => (
                <li key={`${u.report}-${u.source_row}`} className="surface flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    {u.key === null ? <span className="text-ink-3">no key</span> : <Value>{u.key}</Value>}
                    <span className="text-xs text-ink-3">
                      {" · "}
                      <span>{`record ${u.source_row + 1} of the ${u.report} report`}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge state={u.state} />
                    <span className="text-xs text-ink-3">{unmatchedReason(u)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Limited count={c.unmatched.length} />
          </>
        )}
      </section>
    </>
  );
}

/** Either report's records, in the result explorer the saved report page has; the side shown is in the address. */
function BothExplored({ earlier, later, ids }: { earlier: SavedReport; later: SavedReport; ids: { earlier: string; later: string } }) {
  const { params } = useLocation();
  const replace = useReplaceParams("/check/compare", ids);
  const side = params.get("side") === "later" ? "later" : "earlier";
  const report = side === "earlier" ? earlier : later;
  const store = useMemo(() => storeOfSaved(report), [report]);
  const problems = report.records.filter((r) => r.state !== "Verified").length;
  const id = useId();
  const show = (next: "earlier" | "later") => replace({ side: next === "later" ? "later" : null, ...Object.fromEntries(EXPLORER_PARAMS.map((p) => [p, null])) });
  return (
    <section aria-labelledby="both-explore-h" data-testid="compare-explorer">
      <SectionHead id="both-explore-h" title="Explore the records of either report" aside="as each report records them" />
      <fieldset className="min-w-0">
        <legend className="text-xs font-medium text-ink-2">Report</legend>
        <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {(["earlier", "later"] as const).map((r) => (
            <label key={r} className="inline-flex items-center gap-2">
              <input type="radio" name={`${id}-side`} checked={side === r} onChange={() => show(r)} className="accent-(--fa-ink)" data-testid={`explore-${r}`} />
              <span>{r === "earlier" ? "The earlier report" : "The later report"}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <RecordExplorer
        key={side}
        store={store}
        params={params}
        replace={(p) => replace({ side: side === "later" ? "later" : null, ...p })}
        start={problems ? { ...ANY, state: "not-verified" } : ANY}
        label={side === "earlier" ? "Records of the earlier report" : "Records of the later report"}
        level={3}
      />
    </section>
  );
}

/* ---------- The page ---------- */

export function CompareReportsPage({ earlier, later }: { earlier: string | null; later: string | null }) {
  useAllFontFaces();
  const store = useReportStore();
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    if (!earlier || !later) {
      setLoad({ kind: "missing" });
      return;
    }
    setLoad({ kind: "loading" });
    Promise.all([openEntry(store, earlier), openEntry(store, later)]).then(
      ([a, b]) => live && setLoad(a && b ? { kind: "ready", pair: { earlier: a, later: b } } : { kind: "missing" }),
      (error: unknown) => live && setLoad({ kind: "failed", error }),
    );
    return () => void (live = false);
  }, [store, earlier, later]);

  const head = (
    <PageHead
      kicker="Check in this browser · two saved reports"
      title="Comparing two reports"
      lede={
        <p>
          A comparison is a view of two observations, not a new verdict. It says what each report recorded under the premises each one states. Neither report is authenticated, and
          comparing them does not authenticate them.
        </p>
      }
    />
  );

  if (load.kind !== "ready") {
    return (
      <div className="grid gap-6">
        {head}
        {load.kind === "loading" && (
          <p role="status" className="text-sm text-ink-3">
            Reading the two saved reports…
          </p>
        )}
        {load.kind === "missing" && (
          <p className="text-sm text-ink-2" data-testid="compare-missing">
            Choose two saved reports to compare. One of the reports this address names is not in this browser.
          </p>
        )}
        {load.kind === "failed" && (
          <p className="text-sm text-mismatch-ink" data-testid="storage-unavailable">
            <span>Saved reports are not available in this browser. </span>
            <StorageProblem error={load.error} />
          </p>
        )}
        <BackToSaved />
      </div>
    );
  }

  const { pair } = load;
  const unreadable = (["earlier", "later"] as const).filter((role) => "refused" in pair[role]);
  let result: ComparisonResult | null = null;
  if (!unreadable.length && "read" in pair.earlier && "read" in pair.later) result = compareReports(pair.earlier.read.report, pair.later.read.report);
  const swap = href("/check/compare", { earlier: later, later: earlier });

  return (
    <div className="grid gap-10">
      {head}
      <section aria-labelledby="two-h">
        <SectionHead id="two-h" title="The two reports" aside="compared in this order" />
        <div className="grid gap-3 md:grid-cols-2">
          <ReportCard role="earlier" opened={pair.earlier} />
          <ReportCard role="later" opened={pair.later} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a href={swap} className={buttonClass("default", "sm")} data-testid="swap">
            <ArrowLeftRight size={13} aria-hidden />
            Swap earlier and later
          </a>
          {result?.comparable && result.order === "reversed" && (
            <p className="text-xs text-unverified-ink" data-testid="order-reversed">
              Swapped: the report compared as earlier was evaluated after the one compared as later.
            </p>
          )}
          {result?.comparable && result.order === "same-time" && <p className="text-xs text-ink-3">Both reports have the same evaluation time.</p>}
        </div>
      </section>

      {unreadable.length > 0 && (
        <section aria-labelledby="refused-h" className="rounded-md border-2 border-mismatch-line px-4 py-3" data-testid="not-comparable">
          <h2 id="refused-h" className="text-sm font-semibold text-mismatch-ink">
            No comparison is shown: a saved entry is not a valid FlowAssert report any more.
          </h2>
          <ul className="mt-1.5 grid gap-1 text-xs">
            {unreadable.map((role) => {
              const opened = pair[role];
              return "refused" in opened ? (
                <li key={role}>
                  <Value className="text-mismatch-ink">{opened.refused.message}</Value>
                </li>
              ) : null;
            })}
          </ul>
        </section>
      )}

      {result && !result.comparable && (
        <section aria-labelledby="refused-h" className="rounded-md border-2 border-mismatch-line px-4 py-3" data-testid="not-comparable">
          <h2 id="refused-h" className="text-sm font-semibold text-mismatch-ink">
            These two reports cannot be compared, so no comparison is shown.
          </h2>
          <ul className="mt-1.5 grid gap-1.5 text-xs">
            {result.reasons.map((r) => (
              <li key={r.code} data-reason={r.code}>
                <span className="text-ink">{REFUSAL_TEXT[r.code]}</span>{" "}
                <Value className="text-ink-2">{r.message}</Value>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result?.comparable && (
        <>
          <Before c={result} />
          <Classes c={result} />
        </>
      )}
      {"read" in pair.earlier && "read" in pair.later && earlier && later && <BothExplored earlier={pair.earlier.read.report} later={pair.later.read.report} ids={{ earlier, later }} />}
      <BackToSaved />
    </div>
  );
}
