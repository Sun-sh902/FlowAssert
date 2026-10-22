/**
 * WIRE MIRROR of the reviewed Phase 0 contract — PROPOSED, NOT IMPLEMENTED, NOT CALLED.
 *
 * Source (read-only): FlowAssert-Integration-Planning/contracts/openapi-v1-proposed.yaml
 *   info.version = 0.1.1-proposed, API family v1. Frozen bundle per the final Phase 0 audit.
 *
 * Scope: only the two Phase 1 candidate endpoints
 *   GET /api/v1/verifications/{id}           -> VerificationRunDTO
 *   GET /api/v1/verifications/{id}/evidence  -> EvidencePageDTO
 * plus the shared Error envelope. Other contract routes (overview, list, workflows) are not mirrored
 * until their screens are separately authorized.
 *
 * Rules for this file:
 *  - It restates the contract. It is not a second schema. Never add, rename or relax a field here;
 *    a change starts in the reviewed contract. `src/test/contract-drift.test.ts` compares the key
 *    lists below, and the declarations themselves (parsed by `src/test/contract/guard.ts`: types,
 *    nullability, enums, consts, $ref targets, nested objects, query parameters), with the OpenAPI
 *    file when that file is present. Keep declarations in the forms that guard reads.
 *  - Wire names stay snake_case. Only a future LOCAL_RESEARCH adapter may read these types; UI
 *    components keep consuming view models (src/domain/view.ts).
 *  - Nothing here decodes, validates or fetches. Decoding and the F004 cross-field checks are Phase 2.
 */

export const CONTRACT_VERSION = "0.1.1-proposed" as const;
export const API_VERSION = "v1" as const;

/** The two read paths the first backend slice exposes. Templates only — no base URL exists. */
export const V1_PATHS = {
  verification: "/api/v1/verifications/{id}",
  evidence: "/api/v1/verifications/{id}/evidence",
} as const;

export type StateDTO = "Verified" | "Mismatch" | "Pending" | "Unverified";
export type RuleStatusDTO = "pass" | "fail" | "unknown";
/** 64 lowercase hex characters. */
export type DigestDTO = string;
/** RFC3339 with offset, or null. */
export type TimestampDTO = string | null;
/** Any JSON value, echoed raw by the evaluator (malformed keys/ticks are preserved, not repaired). */
export type RawJSON = unknown;
export type RawTick = unknown;

export interface CountsDTO {
  Verified: number;
  Mismatch: number;
  Pending: number;
  Unverified: number;
}

export interface MetaDTO {
  api_version: "v1";
  /** MOCK is never a backend claim; the service advertises one configured mode. */
  provider_mode: "LOCAL_RESEARCH" | "LIVE";
  synthetic: boolean;
  generated_at: string;
  contract_version: "0.1.1-proposed";
  workspace_id: string;
}

export interface IdentityDTO {
  id: string;
  workspace_id: string;
  previous_run_id: string | null;
  created_at: string;
}

export interface WorkflowDTO {
  id: string;
  name: string;
  /** Explicit null is allowed; an omitted key is a contract error. */
  n8n_label: string | null;
  source_label: string;
  source_namespace: string;
  destination_system: "HubSpot";
  destination_object: "contacts";
}

export interface EvaluatorIdentityDTO {
  version_label: string;
  source_commit: string;
  model_sha256: DigestDTO;
  workspace_dirty: boolean;
}

export interface TimeMappingDTO {
  kind: "synthetic_affine_v1" | "unmapped";
  origin_iso: TimestampDTO;
  seconds_per_tick: number | null;
}

export interface EventTimesDTO {
  business_obligation_at: TimestampDTO;
  observed_at: TimestampDTO;
  evaluation_at: TimestampDTO;
  deadline: TimestampDTO;
}

export interface EvaluationContextDTO {
  evaluator: EvaluatorIdentityDTO;
  input_evidence_sha256: DigestDTO;
  time_mapping: TimeMappingDTO;
  event_times: EventTimesDTO;
  service_executed_at: TimestampDTO;
}

export interface RuleResultDTO {
  status: RuleStatusDTO;
  reason: string;
  expected?: string;
  actual?: string;
}

/** existence, phone and uniqueness are always present; the other two only when the policy requires them. No email rule. */
export interface RuleMapDTO {
  existence: RuleResultDTO;
  phone: RuleResultDTO;
  uniqueness: RuleResultDTO;
  existed_by_deadline?: RuleResultDTO;
  workflow_execution?: RuleResultDTO;
}

export interface RecordResultDTO {
  key: RawJSON;
  source_row: number;
  state: StateDTO;
  candidate_ids: string[];
  rules: RuleMapDTO;
}

export interface PremiseEvidenceDTO {
  source_provenance_record: boolean;
  source_inventory_record: boolean;
  rule_approval_record: boolean;
  destination_query_total_consistent: boolean;
  observation_clock_trusted: boolean;
}

/** Unchanged evaluator output. Times are raw ticks. */
export interface ResearchResultDTO {
  cohort_state: StateDTO;
  counts: CountsDTO;
  records: RecordResultDTO[];
  expected_total: number | null;
  source_rows_observed: number;
  source_population_known: boolean;
  destination_coverage_sufficient: boolean;
  source_basis_sha256: DigestDTO;
  rule_basis_sha256: DigestDTO;
  observed_at: RawTick;
  deadline: RawTick;
  business_obligation_at: RawTick;
  evaluation_at: RawTick;
  observation_time_valid: boolean;
  destination_page_sequence_valid: boolean;
  destination_page_sequence_reason: string;
  premise_evidence: PremiseEvidenceDTO;
  workflow_execution: "Not assessed";
  business_truth: "Not assessed";
  absence_cause: "Not inferred";
}

export type EvidenceValueState = "present" | "null" | "missing" | "inaccessible" | "unsupported" | "redacted";

export interface EvidenceValueDTO {
  state: EvidenceValueState;
  value: RawJSON;
}

export interface SourceRowContextDTO {
  source_row: number;
  key: RawJSON;
  phone: EvidenceValueDTO;
  display_name: string | null;
  company: string | null;
}

export interface SourceSnapshotDTO {
  evidence_reference_id: string;
  namespace: string | null;
  version: string | null;
  provenance_channel: string | null;
  inventory_method: string | null;
  inventory_eligible_count: number | null;
  rows: SourceRowContextDTO[];
}

export interface DestinationObservationDTO {
  evidence_reference_id: string;
  account: string | null;
  object: string | null;
  access: "ok" | "denied" | "timeout" | "unknown";
  page_count: number;
  query_total: number | null;
  distinct_ids_returned: number;
}

export interface PolicyContextDTO {
  evidence_reference_id: string;
  version: string | null;
  comparison: string | null;
  deadline: RawTick;
  max_age: RawTick;
  retry_viable: boolean | null;
  settling_allowed: boolean | null;
  identity_reliable: boolean | null;
  require_historical_deadline: boolean | null;
  require_execution: boolean | null;
  account: string | null;
  object: string | null;
}

export interface RetryContextDTO {
  window_open_at_evaluation: boolean | null;
  policy_retry_viable: boolean | null;
  pending_source_rows: number[];
  automatic_retry_enabled: false;
  next_attempt_at: null;
}

export interface AssuranceDTO {
  research_authorization: "research_only" | "approved_for_product_use";
  acquisition_authenticity: "not_authenticated" | "not_assessed";
  limitations: string[];
  release_approval_reference: string | null;
}

export type EvidenceAvailability = "available" | "not_collected" | "unavailable" | "redacted" | "expired";

export interface EvidenceReferenceDTO {
  id: string;
  role: "source" | "destination" | "policy" | "evaluation_input";
  media_type: "application/json";
  sha256: DigestDTO | null;
  canonicalization: "python-json-sortkeys-ascii-v1";
  availability: EvidenceAvailability;
  reason: string | null;
  acquisition_kind: "synthetic_local" | "independent_source_read" | "destination_read" | "workflow_context";
  external_authenticity: "not_authenticated" | "not_assessed";
}

export interface DiagnosticDTO {
  path: string;
  code: string;
  message: string;
}

/** 200 body of GET /api/v1/verifications/{id}. */
export interface VerificationRunDTO {
  meta: MetaDTO;
  identity: IdentityDTO;
  workflow: WorkflowDTO;
  evaluation_context: EvaluationContextDTO;
  source_snapshot: SourceSnapshotDTO;
  destination_observation: DestinationObservationDTO;
  policy_context: PolicyContextDTO;
  result: ResearchResultDTO;
  retry_context: RetryContextDTO;
  evidence_references: EvidenceReferenceDTO[];
  assurance: AssuranceDTO;
  diagnostics: DiagnosticDTO[];
  snapshot_id: string;
}

export interface PageDTO {
  snapshot_id: string;
  next_cursor: string | null;
  /** null means "not computed", never zero. */
  total: number | null;
}

export interface EvidenceItemDTO {
  reference: EvidenceReferenceDTO;
  payload: RawJSON;
  payload_reason: string | null;
}

/** 200 body of GET /api/v1/verifications/{id}/evidence. */
export interface EvidencePageDTO {
  meta: MetaDTO;
  run_id: string;
  items: EvidenceItemDTO[];
  page: PageDTO;
}

export interface ErrorDTO {
  error: {
    code: string;
    message: string;
    request_id: string;
    retryable: boolean;
    details: { path: string; code: string }[];
  };
}

/** Query parameters of the two paths, as named on the wire. */
export interface DetailQueryDTO {
  snapshot_id?: string;
}
export interface EvidenceQueryDTO {
  snapshot_id?: string;
  /** 1–100, default 25. */
  limit?: number;
  cursor?: string;
  /** default true; false returns null payloads with reason omitted_by_request. */
  include_payload?: boolean;
}

/* ---------- Key lists for the drift check ----------
 * `Record<keyof T, true>` makes the compiler reject a missing or extra key, so these lists always
 * equal the interfaces above. The drift test compares them with the OpenAPI `properties`.
 */
type Keys<T> = Record<keyof Required<T>, true>;

export const SCHEMA_KEYS = {
  Meta: { api_version: true, provider_mode: true, synthetic: true, generated_at: true, contract_version: true, workspace_id: true } satisfies Keys<MetaDTO>,
  Identity: { id: true, workspace_id: true, previous_run_id: true, created_at: true } satisfies Keys<IdentityDTO>,
  Workflow: { id: true, name: true, n8n_label: true, source_label: true, source_namespace: true, destination_system: true, destination_object: true } satisfies Keys<WorkflowDTO>,
  EvaluatorIdentity: { version_label: true, source_commit: true, model_sha256: true, workspace_dirty: true } satisfies Keys<EvaluatorIdentityDTO>,
  TimeMapping: { kind: true, origin_iso: true, seconds_per_tick: true } satisfies Keys<TimeMappingDTO>,
  EventTimes: { business_obligation_at: true, observed_at: true, evaluation_at: true, deadline: true } satisfies Keys<EventTimesDTO>,
  EvaluationContext: { evaluator: true, input_evidence_sha256: true, time_mapping: true, event_times: true, service_executed_at: true } satisfies Keys<EvaluationContextDTO>,
  RuleResult: { status: true, reason: true, expected: true, actual: true } satisfies Keys<RuleResultDTO>,
  RuleMap: { existence: true, phone: true, uniqueness: true, existed_by_deadline: true, workflow_execution: true } satisfies Keys<RuleMapDTO>,
  RecordResult: { key: true, source_row: true, state: true, candidate_ids: true, rules: true } satisfies Keys<RecordResultDTO>,
  PremiseEvidence: {
    source_provenance_record: true,
    source_inventory_record: true,
    rule_approval_record: true,
    destination_query_total_consistent: true,
    observation_clock_trusted: true,
  } satisfies Keys<PremiseEvidenceDTO>,
  ResearchResult: {
    cohort_state: true,
    counts: true,
    records: true,
    expected_total: true,
    source_rows_observed: true,
    source_population_known: true,
    destination_coverage_sufficient: true,
    source_basis_sha256: true,
    rule_basis_sha256: true,
    observed_at: true,
    deadline: true,
    business_obligation_at: true,
    evaluation_at: true,
    observation_time_valid: true,
    destination_page_sequence_valid: true,
    destination_page_sequence_reason: true,
    premise_evidence: true,
    workflow_execution: true,
    business_truth: true,
    absence_cause: true,
  } satisfies Keys<ResearchResultDTO>,
  EvidenceValue: { state: true, value: true } satisfies Keys<EvidenceValueDTO>,
  SourceRowContext: { source_row: true, key: true, phone: true, display_name: true, company: true } satisfies Keys<SourceRowContextDTO>,
  SourceSnapshot: {
    evidence_reference_id: true,
    namespace: true,
    version: true,
    provenance_channel: true,
    inventory_method: true,
    inventory_eligible_count: true,
    rows: true,
  } satisfies Keys<SourceSnapshotDTO>,
  DestinationObservation: {
    evidence_reference_id: true,
    account: true,
    object: true,
    access: true,
    page_count: true,
    query_total: true,
    distinct_ids_returned: true,
  } satisfies Keys<DestinationObservationDTO>,
  PolicyContext: {
    evidence_reference_id: true,
    version: true,
    comparison: true,
    deadline: true,
    max_age: true,
    retry_viable: true,
    settling_allowed: true,
    identity_reliable: true,
    require_historical_deadline: true,
    require_execution: true,
    account: true,
    object: true,
  } satisfies Keys<PolicyContextDTO>,
  RetryContext: {
    window_open_at_evaluation: true,
    policy_retry_viable: true,
    pending_source_rows: true,
    automatic_retry_enabled: true,
    next_attempt_at: true,
  } satisfies Keys<RetryContextDTO>,
  Assurance: { research_authorization: true, acquisition_authenticity: true, limitations: true, release_approval_reference: true } satisfies Keys<AssuranceDTO>,
  EvidenceReference: {
    id: true,
    role: true,
    media_type: true,
    sha256: true,
    canonicalization: true,
    availability: true,
    reason: true,
    acquisition_kind: true,
    external_authenticity: true,
  } satisfies Keys<EvidenceReferenceDTO>,
  Diagnostic: { path: true, code: true, message: true } satisfies Keys<DiagnosticDTO>,
  VerificationRun: {
    meta: true,
    identity: true,
    workflow: true,
    evaluation_context: true,
    source_snapshot: true,
    destination_observation: true,
    policy_context: true,
    result: true,
    retry_context: true,
    evidence_references: true,
    assurance: true,
    diagnostics: true,
    snapshot_id: true,
  } satisfies Keys<VerificationRunDTO>,
  Page: { snapshot_id: true, next_cursor: true, total: true } satisfies Keys<PageDTO>,
  EvidenceItem: { reference: true, payload: true, payload_reason: true } satisfies Keys<EvidenceItemDTO>,
  EvidencePage: { meta: true, run_id: true, items: true, page: true } satisfies Keys<EvidencePageDTO>,
  Error: { error: true } satisfies Keys<ErrorDTO>,
} as const;

/** Keys that are optional on the wire (absent from the schema's `required`). */
export const OPTIONAL_KEYS: Partial<Record<keyof typeof SCHEMA_KEYS, readonly string[]>> = {
  RuleResult: ["expected", "actual"],
  RuleMap: ["existed_by_deadline", "workflow_execution"],
};
