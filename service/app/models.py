# Generated from frozen OpenAPI; regenerate with scripts/generate_models.py.
from __future__ import annotations
from typing import Literal, Union
from pydantic import BaseModel, ConfigDict, JsonValue

State = Literal['Verified', 'Mismatch', 'Pending', 'Unverified']
RuleStatus = Literal['pass', 'fail', 'unknown']
Digest = str
Timestamp = Union[str, None]
RawJSON = JsonValue
RawTick = JsonValue

class Counts(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    Verified: int
    Mismatch: int
    Pending: int
    Unverified: int

class Meta(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    api_version: Literal['v1']
    provider_mode: Literal['LOCAL_RESEARCH', 'LIVE']
    synthetic: bool
    generated_at: str
    contract_version: Literal['0.1.1-proposed']
    workspace_id: str

class Identity(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    id: str
    workspace_id: str
    previous_run_id: Union[str, None]
    created_at: str

class Workflow(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    id: str
    name: str
    n8n_label: Union[str, None]
    source_label: str
    source_namespace: str
    destination_system: Literal['HubSpot']
    destination_object: Literal['contacts']

class EvaluatorIdentity(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    version_label: str
    source_commit: str
    model_sha256: Digest
    workspace_dirty: bool

class TimeMapping(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    kind: Literal['synthetic_affine_v1', 'unmapped']
    origin_iso: Timestamp
    seconds_per_tick: Union[int, None]

class EventTimes(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    business_obligation_at: Timestamp
    observed_at: Timestamp
    evaluation_at: Timestamp
    deadline: Timestamp

class EvaluationContext(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    evaluator: EvaluatorIdentity
    input_evidence_sha256: Digest
    time_mapping: TimeMapping
    event_times: EventTimes
    service_executed_at: Timestamp

class RuleResult(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    status: RuleStatus
    reason: str
    expected: str = None
    actual: str = None

class RuleMap(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    existence: RuleResult
    phone: RuleResult
    uniqueness: RuleResult
    existed_by_deadline: RuleResult = None
    workflow_execution: RuleResult = None

class RecordResult(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    key: RawJSON
    source_row: int
    state: State
    candidate_ids: list[str]
    rules: RuleMap

class PremiseEvidence(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    source_provenance_record: bool
    source_inventory_record: bool
    rule_approval_record: bool
    destination_query_total_consistent: bool
    observation_clock_trusted: bool

class ResearchResult(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    cohort_state: State
    counts: Counts
    records: list[RecordResult]
    expected_total: Union[int, None]
    source_rows_observed: int
    source_population_known: bool
    destination_coverage_sufficient: bool
    source_basis_sha256: Digest
    rule_basis_sha256: Digest
    observed_at: RawTick
    deadline: RawTick
    business_obligation_at: RawTick
    evaluation_at: RawTick
    observation_time_valid: bool
    destination_page_sequence_valid: bool
    destination_page_sequence_reason: str
    premise_evidence: PremiseEvidence
    workflow_execution: Literal['Not assessed']
    business_truth: Literal['Not assessed']
    absence_cause: Literal['Not inferred']

class ResultSummary(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    cohort_state: State
    counts: Counts
    expected_total: Union[int, None]
    source_rows_observed: int
    source_population_known: bool
    records_not_fully_assessed: int

class EvidenceValue(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    state: Literal['present', 'null', 'missing', 'inaccessible', 'unsupported', 'redacted']
    value: RawJSON

class SourceRowContext(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    source_row: int
    key: RawJSON
    phone: EvidenceValue
    display_name: Union[str, None]
    company: Union[str, None]

class SourceSnapshot(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    evidence_reference_id: str
    namespace: Union[str, None]
    version: Union[str, None]
    provenance_channel: Union[str, None]
    inventory_method: Union[str, None]
    inventory_eligible_count: Union[int, None]
    rows: list[SourceRowContext]

class DestinationObservation(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    evidence_reference_id: str
    account: Union[str, None]
    object: Union[str, None]
    access: Literal['ok', 'denied', 'timeout', 'unknown']
    page_count: int
    query_total: Union[int, None]
    distinct_ids_returned: int

class PolicyContext(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    evidence_reference_id: str
    version: Union[str, None]
    comparison: Union[str, None]
    deadline: RawTick
    max_age: RawTick
    retry_viable: Union[bool, None]
    settling_allowed: Union[bool, None]
    identity_reliable: Union[bool, None]
    require_historical_deadline: Union[bool, None]
    require_execution: Union[bool, None]
    account: Union[str, None]
    object: Union[str, None]

class RetryContext(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    window_open_at_evaluation: Union[bool, None]
    policy_retry_viable: Union[bool, None]
    pending_source_rows: list[int]
    automatic_retry_enabled: Literal[False]
    next_attempt_at: None

class Assurance(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    research_authorization: Literal['research_only', 'approved_for_product_use']
    acquisition_authenticity: Literal['not_authenticated', 'not_assessed']
    limitations: list[str]
    release_approval_reference: Union[str, None]

class EvidenceReference(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    id: str
    role: Literal['source', 'destination', 'policy', 'evaluation_input']
    media_type: Literal['application/json']
    sha256: Union[str, None]
    canonicalization: Literal['python-json-sortkeys-ascii-v1']
    availability: Literal['available', 'not_collected', 'unavailable', 'redacted', 'expired']
    reason: Union[str, None]
    acquisition_kind: Literal['synthetic_local', 'independent_source_read', 'destination_read', 'workflow_context']
    external_authenticity: Literal['not_authenticated', 'not_assessed']

class Diagnostic(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    path: str
    code: str
    message: str

class VerificationRun(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    meta: Meta
    identity: Identity
    workflow: Workflow
    evaluation_context: EvaluationContext
    source_snapshot: SourceSnapshot
    destination_observation: DestinationObservation
    policy_context: PolicyContext
    result: ResearchResult
    retry_context: RetryContext
    evidence_references: list[EvidenceReference]
    assurance: Assurance
    diagnostics: list[Diagnostic]
    snapshot_id: str

class RunSummary(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    identity: Identity
    workflow: Workflow
    evaluation_context: EvaluationContext
    result: ResultSummary
    assurance: Assurance

class Page(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    snapshot_id: str
    next_cursor: Union[str, None]
    total: Union[int, None]

class VerificationList(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    meta: Meta
    items: list[RunSummary]
    page: Page
    filter_counts: Counts

class WorkflowList(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    meta: Meta
    items: list[Workflow]
    page: Page

class TrendDay(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    day: str
    counts: Counts
    runs: int

class OverviewScope(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    latest_selection: Literal['latest_run_per_workflow']
    trend_selection: Literal['all_runs_in_range']
    evaluated_from: Timestamp
    evaluated_to: Timestamp

class Overview(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    meta: Meta
    snapshot_id: str
    scope: OverviewScope
    workflow_count: int
    cohort_counts: Counts
    record_counts: Counts
    last_evaluated_at: Timestamp
    latest_runs: list[RunSummary]
    trend: list[TrendDay]
    unbucketed_run_count: int

class EvidenceItem(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    reference: EvidenceReference
    payload: RawJSON
    payload_reason: Union[str, None]

class EvidencePage(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    meta: Meta
    run_id: str
    items: list[EvidenceItem]
    page: Page

class Error(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    error: dict[str, JsonValue]

Counts.model_rebuild()
Meta.model_rebuild()
Identity.model_rebuild()
Workflow.model_rebuild()
EvaluatorIdentity.model_rebuild()
TimeMapping.model_rebuild()
EventTimes.model_rebuild()
EvaluationContext.model_rebuild()
RuleResult.model_rebuild()
RuleMap.model_rebuild()
RecordResult.model_rebuild()
PremiseEvidence.model_rebuild()
ResearchResult.model_rebuild()
ResultSummary.model_rebuild()
EvidenceValue.model_rebuild()
SourceRowContext.model_rebuild()
SourceSnapshot.model_rebuild()
DestinationObservation.model_rebuild()
PolicyContext.model_rebuild()
RetryContext.model_rebuild()
Assurance.model_rebuild()
EvidenceReference.model_rebuild()
Diagnostic.model_rebuild()
VerificationRun.model_rebuild()
RunSummary.model_rebuild()
Page.model_rebuild()
VerificationList.model_rebuild()
WorkflowList.model_rebuild()
TrendDay.model_rebuild()
OverviewScope.model_rebuild()
Overview.model_rebuild()
EvidenceItem.model_rebuild()
EvidencePage.model_rebuild()
Error.model_rebuild()
