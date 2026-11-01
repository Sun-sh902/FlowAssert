/**
 * Frontend view models. UI components depend only on these types.
 * Produced by src/adapters/researchToView.ts.
 */

export type VerificationState = "Verified" | "Mismatch" | "Pending" | "Unverified";
export const STATES: readonly VerificationState[] = ["Verified", "Mismatch", "Pending", "Unverified"];
/** Order used wherever states are stacked or listed by attention priority. */
export const STACK_ORDER: readonly VerificationState[] = ["Verified", "Pending", "Unverified", "Mismatch"];

export type RuleStatus = "pass" | "fail" | "unknown";
export type StateCounts = Record<VerificationState, number>;

export interface WorkflowView {
  id: string;
  name: string;
  /** `workflow.n8n_label`: required and nullable in the contract. Null is kept as null — never a fallback string. */
  n8nLabel: string | null;
  sourceLabel: string;
  sourceNamespace: string;
  destinationLabel: string;
}

export interface RuleView {
  id: string;
  label: string;
  kind: "existence" | "uniqueness" | "field" | "historical" | "execution";
  status: RuleStatus;
  /** Plain-language explanation for the status. */
  explanation: string;
  /** Exact reason string from the evaluator. */
  reasonRaw: string;
  /** True for rules the research model does not evaluate (frontend proposal). */
  proposed: boolean;
}

/** `destination_observation.access` in the contract. MOCK fixtures use only "ok" and "denied". */
export type DestinationAccess = "ok" | "denied" | "timeout" | "unknown";

export interface FieldComparisonView {
  field: string;
  label: string;
  source: string | null;
  destination: string | null;
  status: RuleStatus;
  note: string;
}

export interface RecordView {
  /** UI row identity: `runId + ":" + sourceRow`. React keys, selection and focus use this, never the raw key. */
  rowId: string;
  /** Display text of the evaluator's raw key. A non-string raw key is shown as JSON, and flagged. */
  key: string;
  /** True when the raw key is not a plain string (malformed research echo). It is shown, never repaired. */
  keyMalformed: boolean;
  sourceRow: number;
  /** Supplied display name; null when the source supplied none. Any fallback is presentation only. */
  displayName: string | null;
  company: string | null;
  state: VerificationState;
  summary: string;
  /** Short issue label for lists, e.g. "Phone differs". */
  issue: string | null;
  candidateIds: string[];
  rules: RuleView[];
  fields: FieldComparisonView[];
  rulesPassed: number;
  rulesTotal: number;
}

export type PremiseSupport = "supported" | "not-supported";

export interface PremiseView {
  id: string;
  label: string;
  support: PremiseSupport;
  detail: string;
}

export interface TimelineEventView {
  id: string;
  /** RFC3339 instant, or null when the time is unavailable. A null event has no axis position. */
  at: string | null;
  label: string;
  detail: string;
  tone: "neutral" | "brand" | "deadline";
  /** Later than the run's reference clock (MOCK: fixed demo clock; LOCAL_RESEARCH: evaluation instant). */
  future: boolean;
}

export interface TechnicalEntry {
  label: string;
  value: string;
  mono?: boolean;
  hint?: string;
}

export interface RunView {
  id: string;
  workflow: WorkflowView;
  previousRunId: string | null;
  state: VerificationState;
  counts: StateCounts;
  recordsEvaluated: number;
  /** Records with at least one rule the evaluator marked unknown (derived from rule statuses). */
  recordsNotFullyAssessed: number;
  expectedTotal: number | null;
  populationKnown: boolean;
  coverageSufficient: boolean;
  accessDenied: boolean;
  destinationAccess: DestinationAccess;
  /** Mapped event instants. Null means unavailable — never tick zero, receipt time or the browser clock. */
  capturedAt: string | null;
  observedAt: string | null;
  evaluatedAt: string | null;
  deadline: string | null;
  /** LOCAL_RESEARCH copies `retry_context.window_open_at_evaluation`; null = not stated. An open window is not retry eligibility. */
  windowOpen: boolean | null;
  retryViable: boolean | null;
  headline: string;
  explanation: string;
  reasons: string[];
  nextStep: string;
  issueBreakdown: { label: string; count: number }[];
  premises: PremiseView[];
  notEstablished: { label: string; value: string; detail: string }[];
  timeline: TimelineEventView[];
  technical: { group: string; entries: TechnicalEntry[] }[];
  records: RecordView[];
  /** Facts that exist only for a run read from the local Python Service; null for MOCK. */
  local: LocalRunFacts | null;
  /**
   * Capture and admission, as the Service reported them on a live read; only src/adapters/phase3bToView.ts sets this,
   * after admission. Null or absent means no statement was read (MOCK, or an archived run, whose statement is on its
   * HistorySummaryView): the axes then stay "not implemented".
   */
  phase3b?: import("./statusAxes").Phase3BView | null;
}

/** Identity, provenance and assurance of a LOCAL_RESEARCH run, copied from the response. */
export interface LocalRunFacts {
  providerMode: "LOCAL_RESEARCH";
  synthetic: boolean;
  workspaceId: string;
  contractVersion: string;
  apiVersion: string;
  snapshotId: string;
  generatedAt: string;
  createdAt: string;
  serviceExecutedAt: string | null;
  evaluator: { versionLabel: string; sourceCommit: string; modelSha256: string; workspaceDirty: boolean };
  inputEvidenceSha256: string;
  /**
   * The evaluator's raw `result`, as Python canonical JSON (sorted keys, ASCII, compact) — the same text the
   * Service hashes. Null when this browser cannot reproduce it exactly (e.g. a float it cannot round-trip).
   * Used only to say whether two results are byte-identical; never to derive a verdict.
   */
  resultCanonical: string | null;
  timeMapping: { kind: "synthetic_affine_v1" | "unmapped"; originIso: string | null; secondsPerTick: number | null };
  assurance: {
    researchAuthorization: "research_only" | "approved_for_product_use";
    acquisitionAuthenticity: "not_authenticated" | "not_assessed";
    limitations: string[];
    releaseApprovalReference: string | null;
  };
  diagnostics: { path: string; code: string; message: string }[];
  evidenceReferences: import("./evidence").EvidenceReferenceView[];
  pendingSourceRows: number[];
  automaticRetryEnabled: false;
  workflowExecution: string;
  businessTruth: string;
  absenceCause: string;
}
