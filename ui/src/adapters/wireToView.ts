/**
 * LOCAL_RESEARCH adapter: an admitted VerificationRunDTO (src/data/local/decode.ts) → view models.
 *
 * Follows docs/phase2_5/API_INTEGRATION_CHECKLIST.md (closing gaps G1–G8):
 *  - cohort state, record states, counts and every rule status/reason are copied, never derived;
 *  - records keep the service's capture order; row identity is `runId:source_row` (G3);
 *  - times come only from `evaluation_context.event_times`; null stays null (G1), with no tick-zero,
 *    receipt-time or browser-time substitute; "future" is measured against the evaluation instant (G5);
 *  - the sync window is copied from `retry_context.window_open_at_evaluation` (G4);
 *  - every destination access value has copy (G6); authenticity comes from `assurance` (G7);
 *  - nothing here imports the demo fixtures, the demo clock or the MOCK adapter (G8).
 * Copy (headline, explanation, summaries) is presentation selected from copied values; it never
 * creates a failure or a pass that the evaluator did not return.
 */
import type { EvidenceReferenceDTO, RecordResultDTO, RuleResultDTO, VerificationRunDTO } from "../data/contract/v1";
import type { EvidenceReferenceView } from "../domain/evidence";
import type {
  DestinationAccess,
  FieldComparisonView,
  PremiseView,
  RecordView,
  RuleView,
  RunView,
  StateCounts,
  TechnicalEntry,
  TimelineEventView,
  VerificationState,
} from "../domain/view";
import { formatDateTime, formatDuration, plural } from "../lib/format";

type RuleName = keyof VerificationRunDTO["result"]["records"][number]["rules"];

const RULE_META: Record<RuleName, { label: string; kind: RuleView["kind"]; order: number }> = {
  existence: { label: "Record exists in HubSpot", kind: "existence", order: 0 },
  uniqueness: { label: "One contact per source key", kind: "uniqueness", order: 1 },
  phone: { label: "Phone matches source", kind: "field", order: 2 },
  existed_by_deadline: { label: "Existed by deadline", kind: "historical", order: 4 },
  workflow_execution: { label: "Workflow execution", kind: "execution", order: 5 },
};

/** Display text for the evaluator's raw key. A non-string key is shown as JSON and flagged; it is never coerced. */
export function keyText(raw: unknown): { text: string; malformed: boolean } {
  if (typeof raw === "string") return { text: raw, malformed: false };
  return { text: JSON.stringify(raw) ?? String(raw), malformed: true };
}

const ACCESS_PHRASE: Record<DestinationAccess, string> = {
  ok: "HubSpot read",
  denied: "HubSpot read denied",
  timeout: "HubSpot read timed out",
  unknown: "HubSpot access unknown",
};

interface Ctx {
  access: DestinationAccess;
  windowOpen: boolean | null;
}

function explainRule(name: RuleName, rule: RuleResultDTO, rec: RecordResultDTO, ctx: Ctx): string {
  switch (rule.reason) {
    case "reliable candidate observed":
      return "One HubSpot contact carries this source key.";
    case "reliable candidates observed":
      return `${rec.candidate_ids.length} HubSpot contacts carry this source key.`;
    case "complete relevant synthetic inventory":
      return "The supplied destination read was complete for this key and only one contact matched.";
    case "distinct IDs violate configured key uniqueness":
      return `${rec.candidate_ids.length} distinct contacts share a key the policy requires to be unique.`;
    case "exact string comparison":
      return rule.status === "pass"
        ? "HubSpot value is identical to the captured source value."
        : "HubSpot value differs from the captured source value. Exact comparison — no hidden normalisation.";
    case "no arbitrary candidate selected":
      return "Not compared. With more than one candidate, FlowAssert does not pick one.";
    case "waiting window or insufficient absence evidence":
      return ctx.windowOpen === true
        ? "Not observed. The window was open at evaluation, so absence is not a conclusion."
        : "Not observed, and the evidence is not complete enough to establish absence.";
    case "destination binding, access, freshness, clock trust, or coherence unavailable":
      return ctx.access === "ok"
        ? "Destination evidence was not usable for this observation."
        : `${ACCESS_PHRASE[ctx.access]}. No usable destination evidence exists for this rule.`;
    case "insufficient evidence":
      return name === "uniqueness" && rec.candidate_ids.length === 1
        ? "Not assessed. The destination read was not complete enough to rule out other matches."
        : "Not assessed. The evidence for this rule is incomplete.";
    default:
      // Unknown reason strings are quoted, never paraphrased into a different claim.
      return rule.status === "unknown" ? `Not assessed: “${rule.reason}”.` : `“${rule.reason}”`;
  }
}

function toRules(rec: RecordResultDTO, ctx: Ctx): RuleView[] {
  return (Object.entries(rec.rules) as [RuleName, RuleResultDTO | undefined][])
    .filter((e): e is [RuleName, RuleResultDTO] => e[1] !== undefined)
    .sort(([a], [b]) => RULE_META[a].order - RULE_META[b].order)
    .map(([name, rule]) => ({
      id: name,
      label: RULE_META[name].label,
      kind: RULE_META[name].kind,
      status: rule.status,
      explanation: explainRule(name, rule, rec, ctx),
      reasonRaw: rule.reason,
      proposed: false, // no proposed rules in LOCAL_RESEARCH; the email rule exists only in MOCK
    }));
}

function toFields(rec: RecordResultDTO, row: VerificationRunDTO["source_snapshot"]["rows"][number] | undefined): FieldComparisonView[] {
  const rule = rec.rules.phone;
  const supplied = row?.phone.state === "present" && typeof row.phone.value === "string" ? row.phone.value : null;
  const hasValues = rule.expected !== undefined && rule.actual !== undefined;
  return [
    {
      field: "phone",
      label: "Phone",
      source: rule.expected ?? supplied,
      destination: rule.actual ?? null,
      status: rule.status,
      note: hasValues
        ? rule.status === "pass"
          ? "Identical"
          : rule.actual === ""
            ? "Empty in HubSpot"
            : "Differs"
        : rec.candidate_ids.length > 1
          ? "Multiple candidates"
          : rec.candidate_ids.length === 0
            ? "Not observed"
            : `Not compared${row && row.phone.state !== "present" ? ` · source value ${row.phone.state}` : ""}`,
    },
  ];
}

function recordIssue(rec: RecordResultDTO, ctx: Ctx): string | null {
  const r = rec.rules;
  if (rec.state === "Verified") return null;
  if (r.uniqueness.status === "fail") return "Duplicate contacts";
  if (r.existence.status === "fail") return "Missing after deadline";
  if (r.phone.status === "fail") return "Phone differs";
  if (rec.state === "Pending") return "Not observed yet";
  if (ctx.access !== "ok") return ctx.access === "denied" ? "HubSpot unreadable" : ctx.access === "timeout" ? "HubSpot read timed out" : "HubSpot access unknown";
  if (r.uniqueness.status === "unknown" && r.existence.status === "pass") return "Uniqueness unassessed";
  return "Insufficient evidence";
}

function recordSummary(rec: RecordResultDTO, key: string, rules: RuleView[], ctx: Ctx): string {
  const r = rec.rules;
  const unknown = rules.filter((x) => x.status === "unknown").length;
  const tail = unknown && rec.state === "Mismatch" ? ` ${plural(unknown, "other rule")} could not be assessed.` : "";
  if (rec.state === "Verified") return `All ${rules.length} required rules passed at this observation.`;
  if (r.uniqueness.status === "fail") return `${rec.candidate_ids.length} HubSpot contacts share source key ${key}, which must be unique.${tail}`;
  if (r.existence.status === "fail") return `No HubSpot contact with key ${key} was found in a complete read after the deadline.${tail}`;
  if (r.phone.status === "fail") {
    const actual = r.phone.actual === undefined ? "not exposed" : r.phone.actual === "" ? "an empty value" : `“${r.phone.actual}”`;
    const expected = r.phone.expected === undefined ? "a value not exposed by the evaluator" : `“${r.phone.expected}”`;
    return `HubSpot phone is ${actual}; the captured source has ${expected}.${tail}`;
  }
  if (rec.state === "Pending") return "No contact observed yet. The evaluator returned Pending; nothing here schedules another observation.";
  if (ctx.access !== "ok") return `${ACCESS_PHRASE[ctx.access]} during this observation, so no rule could be assessed.`;
  if (r.uniqueness.status === "unknown" && r.existence.status === "pass")
    return "The contact exists and its phone matches, but uniqueness could not be assessed because the destination read was incomplete.";
  return "Available evidence is insufficient to reach Verified or Mismatch.";
}

function headlineFor(state: VerificationState, c: StateCounts, n: number, populationKnown: boolean, access: DestinationAccess): string {
  switch (state) {
    case "Verified":
      return `All ${n} records match the source cohort.`;
    case "Mismatch":
      return `${c.Mismatch} of ${n} records ${c.Mismatch === 1 ? "doesn’t" : "don’t"} match the source cohort.`;
    case "Pending":
      return `${c.Pending} of ${n} records are not observed yet.`;
    case "Unverified":
      if (access !== "ok") return `${ACCESS_PHRASE[access]} for this observation.`;
      if (!populationKnown && c.Verified === n) return `All ${n} visible records match — but the source total is unconfirmed.`;
      return `${c.Unverified} of ${n} records lack sufficient evidence.`;
  }
}

export function toEvidenceReferenceView(ref: EvidenceReferenceDTO): EvidenceReferenceView {
  return {
    id: ref.id,
    role: ref.role,
    availability: ref.availability,
    reason: ref.reason,
    sha256: ref.sha256,
    acquisitionKind: ref.acquisition_kind,
    externalAuthenticity: ref.external_authenticity,
    mediaType: ref.media_type,
    canonicalization: ref.canonicalization,
    payload: { state: "not_loaded" },
  };
}

const rawText = (v: unknown) => (v === undefined ? "absent" : JSON.stringify(v));
const yes = (b: boolean | null) => (b === null ? "null" : b ? "true" : "false");
const tech = (label: string, value: string, mono = true, hint?: string): TechnicalEntry => ({ label, value, mono, hint });
const orNull = (v: string | number | null) => (v === null ? "null" : String(v));

export function wireToRunView(dto: VerificationRunDTO): RunView {
  const r = dto.result;
  const ctxDto = dto.evaluation_context;
  const times = ctxDto.event_times;
  const access = dto.destination_observation.access;
  const windowOpen = dto.retry_context.window_open_at_evaluation;
  const ctx: Ctx = { access, windowOpen };
  const runId = dto.identity.id;

  const rows = dto.source_snapshot.rows;
  const rowByIndex = new Map(rows.map((row) => [row.source_row, row]));
  const records: RecordView[] = r.records.map((rec) => {
    const row = rowByIndex.get(rec.source_row); // joined by source_row, never by key
    const rules = toRules(rec, ctx);
    const { text, malformed } = keyText(rec.key);
    return {
      rowId: `${runId}:${rec.source_row}`,
      key: text,
      keyMalformed: malformed,
      sourceRow: rec.source_row,
      displayName: row?.display_name ?? null,
      company: row?.company ?? null,
      state: rec.state,
      summary: recordSummary(rec, text, rules, ctx),
      issue: recordIssue(rec, ctx),
      candidateIds: [...rec.candidate_ids],
      rules,
      fields: toFields(rec, row),
      rulesPassed: rules.filter((x) => x.status === "pass").length,
      rulesTotal: rules.length,
    };
  });
  const n = records.length;
  const c = { ...r.counts };

  const issueCounts = new Map<string, number>();
  for (const rec of records) if (rec.issue) issueCounts.set(rec.issue, (issueCounts.get(rec.issue) ?? 0) + 1);

  const recordsWith = (pred: (x: RecordView) => boolean) => records.filter(pred).length;
  const reasons: string[] = [];
  const fieldDiff = recordsWith((x) => x.rules.some((rl) => rl.kind === "field" && rl.status === "fail"));
  const missing = recordsWith((x) => x.rules.some((rl) => rl.kind === "existence" && rl.status === "fail"));
  const dup = recordsWith((x) => x.rules.some((rl) => rl.kind === "uniqueness" && rl.status === "fail"));
  if (fieldDiff) reasons.push(`${plural(fieldDiff, "record")} with a phone value that differs from the source.`);
  if (missing) reasons.push(`${plural(missing, "record")} not found in a complete read after the deadline.`);
  if (dup) reasons.push(`${plural(dup, "source key")} matched more than one HubSpot contact.`);
  if (c.Pending) reasons.push(`${plural(c.Pending, "record")} not observed yet${windowOpen === true ? "; the window was open at evaluation" : ""}.`);
  if (access !== "ok") reasons.push(`${ACCESS_PHRASE[access]} in the supplied evidence, so no usable destination evidence exists.`);
  else if (!r.destination_coverage_sufficient) reasons.push("Destination coverage was not sufficient, so some rules could not be assessed.");
  if (c.Unverified && access === "ok" && r.destination_coverage_sufficient) reasons.push(`${plural(c.Unverified, "record")} could not be assessed.`);
  reasons.push(
    r.source_population_known
      ? `Source population confirmed by an inventory record${r.expected_total === null ? "" : ` of ${plural(r.expected_total, "eligible member")}`}.`
      : "No inventory record, so the number of records that should exist is unknown.",
  );

  const explanation: Record<VerificationState, string> = {
    Verified:
      "Every record in the captured cohort satisfied all required rules at this observation, and the source population was confirmed complete — under the supplied synthetic premises.",
    Mismatch: "At least one required rule is shown false by the evidence. A Mismatch cohort does not mean every other rule was assessed.",
    Pending: "No rule has failed and not every rule has passed yet. The evaluator returned Pending; no retry is scheduled by this service.",
    Unverified:
      access !== "ok"
        ? "Without usable destination evidence, neither Verified nor Mismatch can be established. This is not a confirmed failure."
        : !r.source_population_known
          ? "Each visible record passed, but without an inventory the cohort cannot be shown complete. Row results do not add up to a cohort result."
          : "Available evidence is insufficient to establish Verified or Mismatch.",
  };
  const nextStep: Record<VerificationState, string> = {
    Verified: "No action needed. This describes one synthetic observation under supplied premises; it does not establish later correctness.",
    Mismatch: "Inspect the affected records. This local research service cannot request a new observation; reading again returns the stored result.",
    Pending: "There is no scheduler or automatic retry here, and a later browser clock does not change this saved verdict.",
    Unverified:
      access !== "ok"
        ? "Usable destination evidence would be needed. This service performs no live read."
        : !r.source_population_known
          ? "An independent inventory of eligible source members would be needed to confirm the expected total. This service cannot acquire one."
          : "Restoring the missing evidence would be needed. This service performs no acquisition.",
  };

  const pe = r.premise_evidence;
  const ss = dto.source_snapshot;
  const dobs = dto.destination_observation;
  const pol = dto.policy_context;
  const observedAge =
    times.observed_at !== null && times.evaluation_at !== null ? (Date.parse(times.evaluation_at) - Date.parse(times.observed_at)) / 60000 : null;
  const premises: PremiseView[] = [
    {
      id: "provenance",
      label: "Source independence",
      support: pe.source_provenance_record ? "supported" : "not-supported",
      detail: pe.source_provenance_record
        ? `A provenance record states the rows came from ${ss.provenance_channel ?? "an unnamed channel"}, not from workflow output. Consistent — not authenticated.`
        : "No consistent provenance record. Workflow-reported values cannot establish Verified.",
    },
    {
      id: "inventory",
      label: "Population completeness",
      support: pe.source_inventory_record ? "supported" : "not-supported",
      detail: pe.source_inventory_record
        ? `An inventory record (${ss.inventory_method ?? "method not stated"}) lists ${ss.inventory_eligible_count === null ? "an unstated number of" : ss.inventory_eligible_count} eligible members.`
        : "No inventory record. The expected total is unknown, so the cohort cannot be Verified.",
    },
    {
      id: "approval",
      label: "Rule approval",
      support: pe.rule_approval_record ? "supported" : "not-supported",
      detail: pe.rule_approval_record
        ? `An approval record binds rule version ${pol.version ?? "(not stated)"} with ${pol.comparison ?? "an unstated"} comparison.`
        : "Approval record missing or bound to a different rule version.",
    },
    {
      id: "coverage",
      label: "Destination coverage",
      support: pe.destination_query_total_consistent ? "supported" : "not-supported",
      detail:
        access !== "ok"
          ? `${ACCESS_PHRASE[access]}; no rows were usable.`
          : pe.destination_query_total_consistent
            ? `HubSpot reported ${orNull(dobs.query_total)} matches; ${dobs.distinct_ids_returned} distinct contacts returned across ${plural(dobs.page_count, "page")}.`
            : `HubSpot reported ${orNull(dobs.query_total)} matches but returned ${dobs.distinct_ids_returned} distinct contacts. A match may be hidden.`,
    },
    {
      id: "clock",
      label: "Observation timing",
      support: pe.observation_clock_trusted && r.observation_time_valid ? "supported" : "not-supported",
      detail:
        observedAge === null
          ? "Observation time unavailable, so no age is computed. Nothing is substituted for it."
          : `Observation clock ${pe.observation_clock_trusted ? "declared trusted" : "not trusted"}. Read was ${formatDuration(observedAge)} old at evaluation (max_age ${rawText(pol.max_age)} ticks).`,
    },
  ];

  const a = dto.assurance;
  const notEstablished = [
    { label: "Workflow execution", value: r.workflow_execution, detail: "No execution evidence is used. A result does not show that n8n ran or wrote these records." },
    { label: "Business truth", value: r.business_truth, detail: "Comparison is against the captured source. If the source itself is wrong, records can still be Verified." },
    { label: "Absence cause", value: r.absence_cause, detail: "A missing record is not attributed to a workflow failure or any other cause." },
    {
      label: "Evidence authenticity",
      value: a.acquisition_authenticity === "not_authenticated" ? "Not authenticated" : "Not assessed",
      detail: "From the response's assurance block. Premise records are inputs; internally consistent fabricated evidence would still produce Verified.",
    },
    {
      label: "Delivery by deadline",
      value: pol.require_historical_deadline === null ? "Not stated" : pol.require_historical_deadline ? "Required — cannot pass" : "Not required by this policy",
      detail: "A later read cannot reconstruct whether a record existed at the deadline.",
    },
  ];

  const diagFor = (field: string) => dto.diagnostics.find((d) => d.path === `result.${field}`);
  const unavailable = (field: string) => {
    const d = diagFor(field);
    return d ? ` Time unavailable (${d.code}).` : "";
  };
  const events: Omit<TimelineEventView, "future">[] = [
    {
      id: "captured",
      at: times.business_obligation_at,
      label: "Source cohort captured",
      detail: `${plural(n, "row")} supplied from ${ss.namespace ?? dto.workflow.source_namespace}.${unavailable("business_obligation_at")}`,
      tone: "neutral",
    },
    { id: "deadline", at: times.deadline, label: "Sync deadline", detail: `Policy deadline, mapped from its research tick.${unavailable("deadline")}`, tone: "deadline" },
    {
      id: "observed",
      at: times.observed_at,
      label: access === "ok" ? "HubSpot observed" : ACCESS_PHRASE[access],
      detail: `${access === "ok" ? `${plural(dobs.distinct_ids_returned, "contact")} returned across ${plural(dobs.page_count, "page")}.` : "No usable contacts returned."}${unavailable("observed_at")}`,
      tone: "neutral",
    },
    { id: "evaluated", at: times.evaluation_at, label: "Evidence evaluated", detail: `Cohort result: ${r.cohort_state}.${unavailable("evaluation_at")}`, tone: "brand" },
  ];
  const ms = (at: string | null) => (at === null ? Number.POSITIVE_INFINITY : Date.parse(at));
  const evalMs = times.evaluation_at === null ? null : Date.parse(times.evaluation_at);
  const timeline = events
    .sort((x, y) => ms(x.at) - ms(y.at) || (x.id === "deadline" ? 1 : -1))
    .map((e) => ({ ...e, future: e.at !== null && evalMs !== null && Date.parse(e.at) > evalMs }));

  const tick = (raw: unknown, mapped: string | null) => tech(String(""), `tick ${rawText(raw)}`, true, mapped === null ? "unmapped" : formatDateTime(mapped));
  const mapping = ctxDto.time_mapping;
  const technical = [
    {
      group: "Policy",
      entries: [
        tech("version", pol.version ?? "null"),
        tech("comparison", pol.comparison ?? "null"),
        tech("deadline", `tick ${rawText(pol.deadline)}`),
        tech("max_age", `${rawText(pol.max_age)} ticks`),
        tech("retry_viable", yes(pol.retry_viable)),
        tech("settling_allowed", yes(pol.settling_allowed)),
        tech("identity_reliable", yes(pol.identity_reliable)),
        tech("require_historical_deadline", yes(pol.require_historical_deadline)),
        tech("require_execution", yes(pol.require_execution)),
        tech("account", pol.account ?? "null"),
        tech("object", pol.object ?? "null"),
      ],
    },
    {
      group: "Source",
      entries: [
        tech("namespace", ss.namespace ?? "null"),
        tech("version", ss.version ?? "null"),
        tech("provenance.channel", ss.provenance_channel ?? "null"),
        tech("inventory.method", ss.inventory_method ?? "null"),
        tech("inventory_eligible_count", orNull(ss.inventory_eligible_count)),
        tech("source_population_known", yes(r.source_population_known)),
        tech("expected_total", orNull(r.expected_total)),
        tech("source_rows_observed", String(r.source_rows_observed)),
        tech("source_basis_sha256", r.source_basis_sha256),
      ],
    },
    {
      group: "Destination",
      entries: [
        tech("account", dobs.account ?? "null"),
        tech("object", dobs.object ?? "null"),
        tech("access", dobs.access),
        tech("pages", String(dobs.page_count)),
        tech("query_total", orNull(dobs.query_total)),
        tech("distinct ids returned", String(dobs.distinct_ids_returned)),
        tech("page sequence", r.destination_page_sequence_reason),
        tech("page_sequence_valid", yes(r.destination_page_sequence_valid)),
        tech("coverage_sufficient", yes(r.destination_coverage_sufficient)),
      ],
    },
    {
      group: "Evaluation",
      entries: [
        { ...tick(r.business_obligation_at, times.business_obligation_at), label: "business_obligation_at" },
        { ...tick(r.observed_at, times.observed_at), label: "observed_at" },
        { ...tick(r.evaluation_at, times.evaluation_at), label: "evaluation_at" },
        { ...tick(r.deadline, times.deadline), label: "deadline" },
        tech(
          "time_mapping",
          mapping.kind === "unmapped" ? "unmapped" : `${mapping.kind} · 1 tick = ${orNull(mapping.seconds_per_tick)} s from ${orNull(mapping.origin_iso)}`,
          true,
          "Synthetic mapping",
        ),
        tech("observation_time_valid", yes(r.observation_time_valid)),
        tech("window_open_at_evaluation", yes(windowOpen)),
        tech("policy_retry_viable", yes(dto.retry_context.policy_retry_viable)),
        tech("automatic_retry_enabled", yes(dto.retry_context.automatic_retry_enabled)),
        tech("rule_basis_sha256", r.rule_basis_sha256),
        tech("input_evidence_sha256", ctxDto.input_evidence_sha256),
        tech("service_executed_at", orNull(ctxDto.service_executed_at), true, "Wall time of the local run"),
      ],
    },
    {
      group: "Evaluator",
      entries: [
        tech("version_label", ctxDto.evaluator.version_label, false),
        tech("source_commit", ctxDto.evaluator.source_commit),
        tech("model_sha256", ctxDto.evaluator.model_sha256),
        tech("workspace_dirty", yes(ctxDto.evaluator.workspace_dirty)),
      ],
    },
    {
      group: "Response",
      entries: [
        tech("provider_mode", dto.meta.provider_mode),
        tech("synthetic", yes(dto.meta.synthetic)),
        tech("workspace_id", dto.meta.workspace_id),
        tech("contract_version", dto.meta.contract_version),
        tech("api_version", dto.meta.api_version),
        tech("snapshot_id", dto.snapshot_id),
        tech("generated_at", dto.meta.generated_at),
        tech("research_authorization", a.research_authorization),
        tech("acquisition_authenticity", a.acquisition_authenticity),
      ],
    },
  ];

  return {
    id: runId,
    workflow: {
      id: dto.workflow.id,
      name: dto.workflow.name,
      n8nLabel: dto.workflow.n8n_label,
      sourceLabel: dto.workflow.source_label,
      sourceNamespace: dto.workflow.source_namespace,
      destinationLabel: `${dto.workflow.destination_system} ${dto.workflow.destination_object}`,
    },
    previousRunId: dto.identity.previous_run_id,
    state: r.cohort_state,
    counts: c,
    recordsEvaluated: n,
    recordsNotFullyAssessed: records.filter((x) => x.rules.some((rl) => rl.status === "unknown")).length,
    expectedTotal: r.expected_total,
    populationKnown: r.source_population_known,
    coverageSufficient: r.destination_coverage_sufficient,
    accessDenied: access === "denied",
    destinationAccess: access,
    capturedAt: times.business_obligation_at,
    observedAt: times.observed_at,
    evaluatedAt: times.evaluation_at,
    deadline: times.deadline,
    windowOpen,
    retryViable: dto.retry_context.policy_retry_viable,
    headline: headlineFor(r.cohort_state, c, n, r.source_population_known, access),
    explanation: explanation[r.cohort_state],
    reasons,
    nextStep: nextStep[r.cohort_state],
    issueBreakdown: [...issueCounts].map(([label, count]) => ({ label, count })),
    premises,
    notEstablished,
    timeline,
    technical,
    records,
    local: {
      providerMode: dto.meta.provider_mode as "LOCAL_RESEARCH",
      synthetic: dto.meta.synthetic,
      workspaceId: dto.meta.workspace_id,
      contractVersion: dto.meta.contract_version,
      apiVersion: dto.meta.api_version,
      snapshotId: dto.snapshot_id,
      generatedAt: dto.meta.generated_at,
      createdAt: dto.identity.created_at,
      serviceExecutedAt: ctxDto.service_executed_at,
      evaluator: {
        versionLabel: ctxDto.evaluator.version_label,
        sourceCommit: ctxDto.evaluator.source_commit,
        modelSha256: ctxDto.evaluator.model_sha256,
        workspaceDirty: ctxDto.evaluator.workspace_dirty,
      },
      inputEvidenceSha256: ctxDto.input_evidence_sha256,
      timeMapping: { kind: mapping.kind, originIso: mapping.origin_iso, secondsPerTick: mapping.seconds_per_tick },
      assurance: {
        researchAuthorization: a.research_authorization,
        acquisitionAuthenticity: a.acquisition_authenticity,
        limitations: [...a.limitations],
        releaseApprovalReference: a.release_approval_reference,
      },
      diagnostics: dto.diagnostics.map((d) => ({ ...d })),
      evidenceReferences: dto.evidence_references.map(toEvidenceReferenceView),
      pendingSourceRows: [...dto.retry_context.pending_source_rows],
      automaticRetryEnabled: false,
      workflowExecution: r.workflow_execution,
      businessTruth: r.business_truth,
      absenceCause: r.absence_cause,
    },
  };
}
