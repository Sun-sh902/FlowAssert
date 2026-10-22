/**
 * Internal-consistency checks for demo fixtures. Runs at startup in development
 * (see main.tsx), which blocks rendering if any problem is found.
 * Returns a list of problems; empty means consistent.
 */
import { deriveCohortState, deriveRecordState } from "../research/semantics";
import { RESEARCH_STATES } from "../research/types";
import { DEMO_NOW_ISO, DEMO_WORKFLOWS } from "./fixtures";
import type { DemoRunEnvelope } from "./types";

export function validateDemoRuns(runs: DemoRunEnvelope[]): string[] {
  const problems: string[] = [];
  const nowMs = Date.parse(DEMO_NOW_ISO);
  const ids = new Set<string>();
  let lastEval = -Infinity;

  for (const run of runs) {
    const p = (msg: string) => problems.push(`${run.run_id}: ${msg}`);
    const r = run.result;
    if (ids.has(run.run_id)) p("duplicate run id");
    ids.add(run.run_id);
    if (!DEMO_WORKFLOWS.some((w) => w.id === run.workflow_id)) p("unknown workflow");

    // Chronology: capture <= observation <= evaluation <= demo now; ids follow evaluation order.
    const tick = (t: number | null) => Date.parse(run.tick_origin_iso) + (t ?? NaN) * run.tick_seconds * 1000;
    const cap = tick(r.business_obligation_at);
    const obs = tick(r.observed_at);
    const ev = tick(r.evaluation_at);
    if (!(cap <= obs && obs <= ev)) p("timestamps out of order");
    if (ev > nowMs) p("evaluated after demo clock");
    if (ev < lastEval) p("run ids not in evaluation order");
    lastEval = ev;

    // Counts agree with records.
    for (const s of RESEARCH_STATES) {
      const n = r.records.filter((x) => x.state === s).length;
      if (n !== r.counts[s]) p(`count ${s}=${r.counts[s]} but ${n} records`);
    }
    if (r.source_rows_observed !== r.records.length) p("source_rows_observed disagrees with records");
    if (r.expected_total !== (r.source_population_known ? r.records.length : null)) p("expected_total inconsistent");
    if (r.source_population_known !== r.premise_evidence.source_inventory_record) p("population vs inventory record");

    // Pending must satisfy the modelled retry conditions.
    const windowOpen =
      (r.evaluation_at ?? 0) < (r.deadline ?? 0) && run.policy.retry_viable && run.destination.access !== "denied";
    const canWait = windowOpen && !run.policy.require_execution && !run.policy.require_historical_deadline;

    const keys = new Set<string>();
    for (const rec of r.records) {
      if (keys.has(rec.key)) p(`duplicate key ${rec.key}`);
      keys.add(rec.key);
      const rules = Object.fromEntries(Object.entries(rec.rules).filter(([, v]) => v !== undefined)) as Record<
        string,
        NonNullable<(typeof rec.rules)["existence"]>
      >;
      const derived = deriveRecordState(rules, canWait);
      if (derived !== rec.state) p(`${rec.key} state ${rec.state} but rules imply ${derived}`);
      for (const [name, rule] of Object.entries(rules)) {
        if (rule.expected !== undefined && rule.actual !== undefined) {
          const differs = rule.expected !== rule.actual;
          if (differs !== (rule.status === "fail")) p(`${rec.key}.${name} comparison disagrees with status`);
        }
      }
      if (rec.rules.uniqueness?.status === "fail" && rec.candidate_ids.length < 2) p(`${rec.key} duplicate needs 2+ IDs`);
      if (rec.rules.existence?.status === "fail" && rec.candidate_ids.length > 0) p(`${rec.key} missing but has IDs`);
      if (rec.state === "Pending" && !canWait) p(`${rec.key} Pending without a valid window`);
    }

    const cohort = deriveCohortState(r.records.map((x) => x.state), r.source_population_known);
    if (cohort !== r.cohort_state) p(`cohort ${r.cohort_state} but records imply ${cohort}`);
  }
  return problems;
}
