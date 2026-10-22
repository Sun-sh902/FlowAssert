/**
 * TypeScript mirror of the research evaluator's contract.
 *
 * Source of truth (read-only): FlowAssert-round03-oracle-fix/experiments/round03/model.py
 *   - `evaluate(e)` return value  -> ResearchCohortResult
 *   - `records[]` entries          -> ResearchRecordResult
 *   - `rules[name]`                -> ResearchRule
 *   - `e["policy"]` input subset   -> ResearchPolicy
 *
 * Field names are kept in snake_case on purpose: this layer documents the research
 * format and must not be imported by UI components. Only `src/adapters/` reads it.
 */

export const RESEARCH_STATES = ["Verified", "Mismatch", "Pending", "Unverified"] as const;
export type ResearchState = (typeof RESEARCH_STATES)[number];

export type ResearchRuleStatus = "pass" | "fail" | "unknown";

/** model.py: `rules[name] = dict(status=..., reason=..., **detail)` */
export interface ResearchRule {
  status: ResearchRuleStatus;
  reason: string;
  /** Present on field rules when both values were readable. */
  expected?: string;
  actual?: string;
}

/**
 * Rule names produced by model.py: existence, phone, uniqueness, and — only when the
 * policy does not explicitly set them false — existed_by_deadline, workflow_execution.
 * `email` is a FRONTEND-PROPOSED field rule of the same exact-string kind as `phone`;
 * the research model does not evaluate it (see docs/RESEARCH_TO_FRONTEND_MAPPING.md).
 */
export type ResearchRuleName =
  | "existence"
  | "phone"
  | "uniqueness"
  | "existed_by_deadline"
  | "workflow_execution"
  | "email";

export interface ResearchRecordResult {
  key: string;
  source_row: number;
  state: ResearchState;
  candidate_ids: string[];
  rules: Partial<Record<ResearchRuleName, ResearchRule>>;
}

export interface ResearchPremiseEvidence {
  source_provenance_record: boolean;
  source_inventory_record: boolean;
  rule_approval_record: boolean;
  destination_query_total_consistent: boolean;
  observation_clock_trusted: boolean;
}

/** Exact output shape of model.py `evaluate()` (Round03.5). Times are integer ticks. */
export interface ResearchCohortResult {
  cohort_state: ResearchState;
  counts: Record<ResearchState, number>;
  records: ResearchRecordResult[];
  expected_total: number | null;
  source_rows_observed: number;
  source_population_known: boolean;
  destination_coverage_sufficient: boolean;
  source_basis_sha256: string;
  rule_basis_sha256: string;
  observed_at: number | null;
  deadline: number | null;
  business_obligation_at: number | null;
  evaluation_at: number | null;
  observation_time_valid: boolean;
  destination_page_sequence_valid: boolean;
  destination_page_sequence_reason: string;
  premise_evidence: ResearchPremiseEvidence;
  workflow_execution: "Not assessed";
  business_truth: "Not assessed";
  absence_cause: "Not inferred";
}

/** Subset of the evaluator *input* `policy` object that the UI needs to explain a result. */
export interface ResearchPolicy {
  version: string;
  comparison: "exact-string";
  deadline: number;
  max_age: number;
  retry_viable: boolean;
  settling_allowed: boolean;
  identity_reliable: boolean;
  require_historical_deadline: boolean;
  require_execution: boolean;
  account: string;
  object: string;
}

/** Subset of the evaluator *input* `destination` object. */
export interface ResearchDestinationInput {
  account: string;
  object: string;
  access: "ok" | "denied" | "timeout";
  page_count: number;
  /** Provider-reported match count; null when no response was obtained. */
  query_total: number | null;
  distinct_ids_returned: number;
}

/** Subset of the evaluator *input* `source` object. */
export interface ResearchSourceInput {
  namespace: string;
  captured_at: number;
  version: string;
  provenance_channel: "independent-source-read" | "workflow-payload" | null;
  inventory_method: "independent-enumeration" | null;
  inventory_eligible_count: number | null;
}
