/**
 * Read-only demo data access. A future backend client would replace this module;
 * components would keep consuming the same view models.
 */
import { toRunView, toWorkflowView } from "../adapters/researchToView";
import { STATES, type RunView, type StateCounts, type WorkflowView } from "../domain/view";
import { DEMO_RUNS, DEMO_WORKFLOWS } from "../mocks/fixtures";

const emptyCounts = (): StateCounts => ({ Verified: 0, Mismatch: 0, Pending: 0, Unverified: 0 });

/** Newest first. */
export const runs: RunView[] = DEMO_RUNS.map(toRunView).reverse();
export const workflows: WorkflowView[] = DEMO_WORKFLOWS.map(toWorkflowView);

export function getRun(id: string): RunView | undefined {
  return runs.find((r) => r.id === id);
}

export interface WorkflowSummary {
  workflow: WorkflowView;
  latest: RunView;
  history: RunView[];
}

export const workflowSummaries: WorkflowSummary[] = workflows
  .map((workflow) => {
    const history = runs.filter((r) => r.workflow.id === workflow.id);
    const latest = history[0];
    return latest ? { workflow, latest, history } : null;
  })
  .filter((x): x is WorkflowSummary => x !== null);

export const latestRuns: RunView[] = workflowSummaries.map((w) => w.latest);

export function sumCounts(list: RunView[]): StateCounts {
  const c = emptyCounts();
  for (const r of list) for (const s of STATES) c[s] += r.counts[s];
  return c;
}

export function cohortCounts(list: RunView[]): StateCounts {
  const c = emptyCounts();
  for (const r of list) c[r.state] += 1;
  return c;
}

export interface TrendDay {
  day: string;
  iso: string;
  counts: StateCounts;
  runs: number;
}

/** Record outcomes per UTC evaluation day, derived from the same runs shown in tables. */
export const trend: TrendDay[] = (() => {
  const byDay = new Map<string, TrendDay>();
  for (const r of [...runs].reverse()) {
    if (r.evaluatedAt === null) continue; // demo fixtures always have one; never bucket an unavailable time
    const iso = r.evaluatedAt.slice(0, 10);
    const entry = byDay.get(iso) ?? { day: iso, iso, counts: emptyCounts(), runs: 0 };
    for (const s of STATES) entry.counts[s] += r.counts[s];
    entry.runs += 1;
    byDay.set(iso, entry);
  }
  return [...byDay.values()];
})();

export const lastEvaluatedAt: string = runs[0]?.evaluatedAt ?? "";
