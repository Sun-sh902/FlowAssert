import { useMemo } from "react";
import { RunsTable } from "../components/runs/RunsTable";
import { EmptyState, FilterChips, Panel, SearchField, buttonClass } from "../components/ui/primitives";
import { StatusGlyph } from "../components/ui/status";
import { STATES, type RunView, type VerificationState } from "../domain/view";
import { runs } from "../data/store";
import { useReplaceParams, type Location } from "../lib/router";
import { matchesSearch, normalizeQuery } from "../lib/search";

type Filter = "all" | VerificationState;

/**
 * Runs whose ID, workflow name, n8n label or source namespace contain the query. The label may be
 * null (contract `workflow.n8n_label`); a null label is skipped, never searched as its fallback text.
 * Order is preserved; nothing is copied or changed.
 */
export function searchRuns(list: readonly RunView[], q: string): RunView[] {
  if (!normalizeQuery(q)) return [...list];
  return list.filter((r) => matchesSearch(q, [r.id, r.workflow.name, r.workflow.n8nLabel, r.workflow.sourceNamespace]));
}

export function Verifications({ location }: { location: Location }) {
  const setParams = useReplaceParams("/demo/verifications");
  const stateParam = location.params.get("state");
  const filter: Filter = STATES.includes(stateParam as VerificationState) ? (stateParam as VerificationState) : "all";
  const q = location.params.get("q") ?? "";

  const searched = useMemo(() => searchRuns(runs, q), [q]);
  const visible = filter === "all" ? searched : searched.filter((r) => r.state === filter);

  const update = (next: { state?: Filter; q?: string }) =>
    setParams({ state: (next.state ?? filter) === "all" ? null : (next.state ?? filter), q: next.q ?? q });

  return (
    <div className="space-y-7">
      <header className="max-w-3xl">
        <p className="kicker">Cases · {runs.length} verification runs</p>
        <h1 className="display mt-3 text-[34px] leading-[1.05] text-ink sm:text-[40px]">Every comparison, on the record.</h1>
        <p className="mt-3 max-w-[640px] text-md leading-[1.55] text-ink-2">
          Each run compares one captured source cohort with one HubSpot observation. Filters apply to the cohort result; record results
          inside a run can differ.
        </p>
      </header>

      <Panel
        title={
          <span className="tabular">
            {visible.length} <span className="text-ink-3">of {runs.length} runs</span>
          </span>
        }
        actions={
          <SearchField
            value={q}
            onChange={(v) => update({ q: v })}
            label="Search runs"
            placeholder="Run ID or workflow"
            className="w-full sm:w-64"
          />
        }
      >
        <div className="border-b border-line-subtle px-3 py-2.5 sm:px-4">
          <FilterChips<Filter>
            label="Filter by cohort result"
            value={filter}
            onChange={(v) => update({ state: v })}
            options={[
              { value: "all", label: "All", count: searched.length },
              ...STATES.map((s) => ({
                value: s as Filter,
                label: s,
                count: searched.filter((r) => r.state === s).length,
                icon: <StatusGlyph state={s} size={11} />,
              })),
            ]}
          />
        </div>
        {visible.length ? (
          <RunsTable runs={visible} caption="Verification runs" />
        ) : (
          <EmptyState
            title="No runs match"
            body={q ? `Nothing matches “${q}”${filter !== "all" ? ` with result ${filter}` : ""}.` : `No run has the cohort result ${filter}.`}
            action={
              <button type="button" className={buttonClass()} onClick={() => setParams({})}>
                Clear filters
              </button>
            }
          />
        )}
      </Panel>
    </div>
  );
}
