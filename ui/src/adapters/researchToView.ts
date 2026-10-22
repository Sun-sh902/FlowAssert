/**
 * Adapter boundary: research-shaped evaluator output (+ proposed run envelope) → view models.
 *
 * This is the only module that reads src/research types or src/mocks envelopes.
 * It interprets nothing beyond what the result already states: copy is selected from
 * the evaluator's own rule statuses and reason strings, never recomputed from evidence.
 */
import type { RuleStatus, StateCounts, VerificationState } from "../domain/view";
import type {
  FieldComparisonView,
  PremiseView,
  RecordView,
  RuleView,
  RunView,
  TechnicalEntry,
  TimelineEventView,
  WorkflowView,
} from "../domain/view";
import { DEMO_NOW_MS, formatDateTime, formatDuration, formatTime, plural } from "../lib/format";
import { DEMO_WORKFLOWS } from "../mocks/fixtures";
import type { DemoRunEnvelope, DemoSourceRow, DemoWorkflow } from "../mocks/types";
import type { ResearchRecordResult, ResearchRule, ResearchRuleName } from "../research/types";

/* ---------- workflow ---------- */

export function toWorkflowView(w: DemoWorkflow): WorkflowView {
  return {
    id: w.id,
    name: w.name,
    n8nLabel: w.n8nLabel,
    sourceLabel: w.sourceSystem,
    sourceNamespace: w.sourceNamespace,
    destinationLabel: `${w.destinationSystem} ${w.destinationObject}`,
  };
}

/* ---------- rules ---------- */

const RULE_META: Record<ResearchRuleName, { label: string; kind: RuleView["kind"]; proposed: boolean; order: number }> = {
  existence: { label: "Record exists in HubSpot", kind: "existence", proposed: false, order: 0 },
  uniqueness: { label: "One contact per source key", kind: "uniqueness", proposed: false, order: 1 },
  phone: { label: "Phone matches source", kind: "field", proposed: false, order: 2 },
  email: { label: "Email matches source", kind: "field", proposed: true, order: 3 },
  existed_by_deadline: { label: "Existed by deadline", kind: "historical", proposed: false, order: 4 },
  workflow_execution: { label: "Workflow execution", kind: "execution", proposed: false, order: 5 },
};

interface RunContext {
  windowOpen: boolean;
  accessDenied: boolean;
  deadlineLabel: string;
}

function explainRule(name: ResearchRuleName, rule: ResearchRule, rec: ResearchRecordResult, ctx: RunContext): string {
  switch (rule.reason) {
    case "reliable candidate observed":
      return "One HubSpot contact carries this source key.";
    case "reliable candidates observed":
      return `${rec.candidate_ids.length} HubSpot contacts carry this source key.`;
    case "complete relevant synthetic inventory":
      return "The destination read was complete for this key and only one contact matched.";
    case "distinct IDs violate configured key uniqueness":
      return `${rec.candidate_ids.length} distinct contacts share a key the policy requires to be unique.`;
    case "exact string comparison":
      return rule.status === "pass"
        ? "HubSpot value is identical to the captured source value."
        : "HubSpot value differs from the captured source value. Exact comparison — no hidden normalisation.";
    case "no arbitrary candidate selected":
      return "Not compared. With more than one candidate, FlowAssert does not pick one.";
    case "expected key not found at observation at or after deadline":
      return "No contact with this key was found in a complete read taken after the deadline.";
    case "waiting window or insufficient absence evidence":
      return ctx.windowOpen
        ? `Not observed yet. The sync window is open until ${ctx.deadlineLabel}, so absence is not a conclusion.`
        : "Not found, but the read was not complete enough to establish absence.";
    case "destination binding, access, freshness, clock trust, or coherence unavailable":
      return ctx.accessDenied
        ? "HubSpot could not be read (access denied). No destination evidence exists for this rule."
        : "Destination evidence was not usable for this observation.";
    case "insufficient evidence":
      if (name === "uniqueness" && rec.candidate_ids.length === 1)
        return "Not assessed. HubSpot's reported total disagreed with the rows returned, so other matches may exist.";
      return "Not assessed. The evidence for this rule is incomplete.";
    default:
      return rule.status === "unknown" ? `Not assessed: ${rule.reason}.` : rule.reason;
  }
}

function toRules(rec: ResearchRecordResult, ctx: RunContext): RuleView[] {
  return (Object.entries(rec.rules) as [ResearchRuleName, ResearchRule | undefined][])
    .filter((e): e is [ResearchRuleName, ResearchRule] => e[1] !== undefined)
    .sort(([a], [b]) => RULE_META[a].order - RULE_META[b].order)
    .map(([name, rule]) => ({
      id: name,
      label: RULE_META[name].label,
      kind: RULE_META[name].kind,
      status: rule.status,
      explanation: explainRule(name, rule, rec, ctx),
      reasonRaw: rule.reason,
      proposed: RULE_META[name].proposed,
    }));
}

function toFields(rec: ResearchRecordResult, row: DemoSourceRow | undefined): FieldComparisonView[] {
  const field = (name: "phone" | "email", label: string): FieldComparisonView => {
    const rule = rec.rules[name];
    const status: RuleStatus = rule?.status ?? "unknown";
    const hasValues = rule?.expected !== undefined && rule.actual !== undefined;
    return {
      field: name,
      label,
      source: rule?.expected ?? row?.[name] ?? null,
      destination: hasValues ? (rule?.actual ?? null) : null,
      status,
      note: hasValues
        ? status === "pass"
          ? "Identical"
          : rule?.actual === ""
            ? "Empty in HubSpot"
            : "Differs"
        : rec.candidate_ids.length > 1
          ? "Multiple candidates"
          : rec.candidate_ids.length === 0
            ? "Not observed"
            : "Not compared",
    };
  };
  return [field("phone", "Phone"), field("email", "Email")];
}

function recordIssue(rec: ResearchRecordResult, ctx: RunContext): string | null {
  const r = rec.rules;
  if (rec.state === "Verified") return null;
  if (r.uniqueness?.status === "fail") return "Duplicate contacts";
  if (r.existence?.status === "fail") return "Missing after deadline";
  const fieldFails = (["phone", "email"] as const).filter((f) => r[f]?.status === "fail");
  if (fieldFails.length) return fieldFails.map((f) => (f === "phone" ? "Phone" : "Email")).join(" & ") + " differs";
  if (rec.state === "Pending") return "Not observed yet";
  if (ctx.accessDenied) return "HubSpot unreadable";
  if (r.uniqueness?.status === "unknown" && r.existence?.status === "pass") return "Uniqueness unassessed";
  return "Insufficient evidence";
}

function recordSummary(rec: ResearchRecordResult, rules: RuleView[], ctx: RunContext): string {
  const r = rec.rules;
  const unknown = rules.filter((x) => x.status === "unknown").length;
  const tail = unknown && rec.state === "Mismatch" ? ` ${plural(unknown, "other rule")} could not be assessed.` : "";
  if (rec.state === "Verified") return `All ${rules.length} required rules passed at this observation.`;
  if (r.uniqueness?.status === "fail")
    return `${rec.candidate_ids.length} HubSpot contacts share source key ${rec.key}, which must be unique.${tail}`;
  if (r.existence?.status === "fail")
    return `No HubSpot contact with key ${rec.key} was found in a complete read after the deadline.${tail}`;
  for (const f of ["phone", "email"] as const) {
    const rule = r[f];
    if (rule?.status === "fail") {
      const actual = rule.actual === "" ? "an empty value" : `“${rule.actual}”`;
      return `HubSpot ${f} is ${actual}; the captured source has “${rule.expected}”.${tail}`;
    }
  }
  if (rec.state === "Pending") return `No contact observed yet. The sync window stays open until ${ctx.deadlineLabel}.`;
  if (ctx.accessDenied) return "HubSpot could not be read during this observation, so no rule could be assessed.";
  if (r.uniqueness?.status === "unknown" && r.existence?.status === "pass")
    return "The contact exists and its fields match, but uniqueness could not be assessed because the destination read was incomplete.";
  return "Available evidence is insufficient to reach Verified or Mismatch.";
}

function toRecord(runId: string, rec: ResearchRecordResult, row: DemoSourceRow | undefined, ctx: RunContext): RecordView {
  const rules = toRules(rec, ctx);
  return {
    rowId: `${runId}:${rec.source_row}`,
    key: rec.key,
    keyMalformed: false,
    sourceRow: rec.source_row,
    displayName: row?.name ?? null,
    company: row?.company || null,
    state: rec.state,
    summary: recordSummary(rec, rules, ctx),
    issue: recordIssue(rec, ctx),
    candidateIds: rec.candidate_ids,
    rules,
    fields: toFields(rec, row),
    rulesPassed: rules.filter((x) => x.status === "pass").length,
    rulesTotal: rules.length,
  };
}

/* ---------- run ---------- */

function headlineFor(state: VerificationState, c: StateCounts, n: number, populationKnown: boolean, accessDenied: boolean): string {
  switch (state) {
    case "Verified":
      return `All ${n} records match the source cohort.`;
    case "Mismatch":
      return `${c.Mismatch} of ${n} records ${c.Mismatch === 1 ? "doesn’t" : "don’t"} match the source cohort.`;
    case "Pending":
      return `${c.Pending} of ${n} records are still inside the sync window.`;
    case "Unverified":
      if (accessDenied) return "HubSpot could not be read for this observation.";
      if (!populationKnown && c.Verified === n) return `All ${n} visible records match — but the source total is unconfirmed.`;
      return `${c.Unverified} of ${n} records lack sufficient evidence.`;
  }
}

export function toRunView(env: DemoRunEnvelope): RunView {
  const r = env.result;
  const workflowDemo = DEMO_WORKFLOWS.find((w) => w.id === env.workflow_id);
  if (!workflowDemo) throw new Error(`Unknown workflow ${env.workflow_id}`);
  const workflow = toWorkflowView(workflowDemo);

  const at = (tick: number | null) =>
    new Date(Date.parse(env.tick_origin_iso) + (tick ?? 0) * env.tick_seconds * 1000).toISOString();
  const capturedAt = at(r.business_obligation_at);
  const observedAt = at(r.observed_at);
  const evaluatedAt = at(r.evaluation_at);
  const deadline = at(r.deadline);
  const accessDenied = env.destination.access === "denied";
  const windowOpen = (r.evaluation_at ?? 0) < (r.deadline ?? 0) && env.policy.retry_viable && !accessDenied;
  const ctx: RunContext = { windowOpen, accessDenied, deadlineLabel: formatTime(deadline) };

  const rowsByKey = new Map(env.source_rows.map((row) => [row.key, row]));
  const records = r.records.map((rec) => toRecord(env.run_id, rec, rowsByKey.get(rec.key), ctx));
  const n = records.length;
  const c = r.counts;

  const issueCounts = new Map<string, number>();
  for (const rec of records) if (rec.issue) issueCounts.set(rec.issue, (issueCounts.get(rec.issue) ?? 0) + 1);
  const issueBreakdown = [...issueCounts].map(([label, count]) => ({ label, count }));

  // Why — strictly restating what the result says.
  const reasons: string[] = [];
  const recordsWith = (pred: (x: RecordView) => boolean) => records.filter(pred).length;
  const fieldDiff = recordsWith((x) => x.rules.some((rl) => rl.kind === "field" && rl.status === "fail"));
  const missing = recordsWith((x) => x.rules.some((rl) => rl.kind === "existence" && rl.status === "fail"));
  const dup = recordsWith((x) => x.rules.some((rl) => rl.kind === "uniqueness" && rl.status === "fail"));
  if (fieldDiff) reasons.push(`${plural(fieldDiff, "record")} with a field value that differs from the source.`);
  if (missing) reasons.push(`${plural(missing, "record")} not found in a complete read after the deadline.`);
  if (dup) reasons.push(`${plural(dup, "source key")} matched more than one HubSpot contact.`);
  if (c.Pending) reasons.push(`${plural(c.Pending, "record")} not observed yet, with a retry still viable before ${formatTime(deadline)}.`);
  if (accessDenied) reasons.push("HubSpot read access was denied, so no destination evidence was collected.");
  else if (!r.destination_coverage_sufficient)
    reasons.push("HubSpot’s reported match total disagreed with the rows returned, so uniqueness could not be assessed.");
  if (c.Unverified && !accessDenied && r.destination_coverage_sufficient)
    reasons.push(`${plural(c.Unverified, "record")} could not be assessed.`);
  reasons.push(
    r.source_population_known
      ? `Source population confirmed by an independent inventory of ${plural(r.expected_total ?? n, "eligible member")}.`
      : "No independent inventory record, so the number of records that should exist is unknown.",
  );

  const explanation: Record<VerificationState, string> = {
    Verified: "Every record in the captured cohort satisfied all required rules at this observation, and the source population was confirmed complete.",
    Mismatch: "At least one required rule is shown false by the evidence. A Mismatch cohort does not mean every other rule was assessed.",
    Pending: "No rule has failed and not every rule has passed yet. A bounded retry is still valid before the deadline.",
    Unverified: accessDenied
      ? "Without destination evidence, neither Verified nor Mismatch can be established. This is not a confirmed failure."
      : !r.source_population_known
        ? "Each visible record passed, but without an independent inventory the cohort cannot be shown complete. Row results do not add up to a cohort result."
        : "Available evidence is insufficient to establish Verified or Mismatch, and no valid waiting window remains.",
  };

  const nextStep: Record<VerificationState, string> = {
    Verified: "No action needed. This describes this observation only and does not establish later correctness.",
    Mismatch: "Inspect the affected records, correct the workflow or CRM outside FlowAssert, then request a new observation. Acknowledging an issue never changes its state.",
    Pending: `Wait for a later observation before ${formatTime(deadline)}. Records still absent after the deadline become Mismatch only if lookup coverage is complete; otherwise Unverified.`,
    Unverified: accessDenied
      ? "Restore HubSpot read access for the connected account, then request a new observation."
      : !r.source_population_known
        ? "Provide an independent inventory of eligible source members so the expected total can be confirmed."
        : "Restore the missing evidence, then request a new observation.",
  };

  const ageMin = ((r.evaluation_at ?? 0) - (r.observed_at ?? 0)) * (env.tick_seconds / 60);
  const pe = r.premise_evidence;
  const premises: PremiseView[] = [
    {
      id: "provenance",
      label: "Source independence",
      support: pe.source_provenance_record ? "supported" : "not-supported",
      detail: pe.source_provenance_record
        ? `Captured by an independent read of ${workflow.sourceLabel}, not from workflow output. Capture time and row digest are consistent.`
        : "No consistent provenance record. Workflow-reported values cannot establish Verified.",
    },
    {
      id: "inventory",
      label: "Population completeness",
      support: pe.source_inventory_record ? "supported" : "not-supported",
      detail: pe.source_inventory_record
        ? `Independent enumeration found ${env.source.inventory_eligible_count} eligible members, matching the captured rows.`
        : "No independent inventory record. The expected total is unknown, so the cohort cannot be Verified.",
    },
    {
      id: "approval",
      label: "Rule approval",
      support: pe.rule_approval_record ? "supported" : "not-supported",
      detail: pe.rule_approval_record
        ? `Approval record binds rule version ${env.policy.version} with exact-string comparison.`
        : "Approval record missing or bound to a different rule version.",
    },
    {
      id: "coverage",
      label: "Destination coverage",
      support: pe.destination_query_total_consistent ? "supported" : "not-supported",
      detail: accessDenied
        ? "No response — read access was denied."
        : pe.destination_query_total_consistent
          ? `HubSpot reported ${env.destination.query_total} matches; ${env.destination.distinct_ids_returned} distinct contacts returned across ${plural(env.destination.page_count, "page")}.`
          : `HubSpot reported ${env.destination.query_total} matches but returned ${env.destination.distinct_ids_returned} distinct contacts. A match may be hidden.`,
    },
    {
      id: "clock",
      label: "Observation timing",
      support: pe.observation_clock_trusted && r.observation_time_valid ? "supported" : "not-supported",
      detail: `Observation clock declared trusted. Read was ${formatDuration(ageMin)} old at evaluation (limit ${formatDuration(env.policy.max_age * (env.tick_seconds / 60))}).`,
    },
  ];

  const notEstablished = [
    { label: "Workflow execution", value: r.workflow_execution, detail: "No execution evidence is used. A result does not show that n8n ran or wrote these records." },
    { label: "Business truth", value: r.business_truth, detail: "Comparison is against the captured source. If the source itself is wrong, records can still be Verified." },
    { label: "Absence cause", value: r.absence_cause, detail: "A missing record is not attributed to a workflow failure or any other cause." },
    { label: "Evidence authenticity", value: "Not authenticated", detail: "Premise records are inputs. Internally consistent fabricated evidence would still produce Verified." },
    {
      label: "Delivery by deadline",
      value: env.policy.require_historical_deadline ? "Required — cannot pass" : "Not required by this policy",
      detail: "A later read cannot reconstruct whether a record existed at the deadline.",
    },
  ];

  const events: Omit<TimelineEventView, "future">[] = [
    { id: "captured", at: capturedAt, label: "Source cohort captured", detail: `${plural(n, "row")} read independently from ${workflow.sourceNamespace}. Sync window starts.`, tone: "neutral" },
    { id: "deadline", at: deadline, label: "Sync deadline", detail: "After this, an unobserved record can be Mismatch — if the read is complete.", tone: "deadline" },
    {
      id: "observed",
      at: observedAt,
      label: accessDenied ? "HubSpot read attempted" : "HubSpot observed",
      detail: accessDenied ? "Access denied; no contacts returned." : `${plural(env.destination.distinct_ids_returned, "contact")} returned across ${plural(env.destination.page_count, "page")}.`,
      tone: "neutral",
    },
    { id: "evaluated", at: evaluatedAt, label: "Evidence evaluated", detail: `Cohort result: ${r.cohort_state}.`, tone: "brand" },
  ];
  // Demo fixtures always carry all four instants; `at` is typed nullable for LOCAL_RESEARCH runs.
  const ms = (at: string | null) => (at === null ? Number.POSITIVE_INFINITY : Date.parse(at));
  const timeline = events
    .sort((a, b) => ms(a.at) - ms(b.at) || (a.id === "deadline" ? 1 : -1))
    .map((e) => ({ ...e, future: e.at !== null && Date.parse(e.at) > DEMO_NOW_MS }));

  const yes = (b: boolean) => (b ? "true" : "false");
  const tech = (label: string, value: string, mono = true, hint?: string): TechnicalEntry => ({ label, value, mono, hint });
  const technical = [
    {
      group: "Policy",
      entries: [
        tech("version", env.policy.version),
        tech("comparison", env.policy.comparison),
        tech("deadline", `tick ${r.deadline}`, true, formatDateTime(deadline)),
        tech("max_age", `${env.policy.max_age} ticks`),
        tech("retry_viable", yes(env.policy.retry_viable)),
        tech("settling_allowed", yes(env.policy.settling_allowed)),
        tech("identity_reliable", yes(env.policy.identity_reliable)),
        tech("require_historical_deadline", yes(env.policy.require_historical_deadline)),
        tech("require_execution", yes(env.policy.require_execution)),
      ],
    },
    {
      group: "Source",
      entries: [
        tech("namespace", env.source.namespace),
        tech("version", env.source.version),
        tech("provenance.channel", env.source.provenance_channel ?? "—"),
        tech("inventory.method", env.source.inventory_method ?? "missing"),
        tech("source_population_known", yes(r.source_population_known)),
        tech("expected_total", r.expected_total === null ? "null" : String(r.expected_total)),
        tech("source_basis_sha256", r.source_basis_sha256, true, "Demo digest"),
      ],
    },
    {
      group: "Destination",
      entries: [
        tech("account", env.destination.account),
        tech("object", env.destination.object),
        tech("access", env.destination.access),
        tech("pages", String(env.destination.page_count)),
        tech("query_total", env.destination.query_total === null ? "null" : String(env.destination.query_total)),
        tech("distinct ids returned", String(env.destination.distinct_ids_returned)),
        tech("page sequence", r.destination_page_sequence_reason),
        tech("coverage_sufficient", yes(r.destination_coverage_sufficient)),
      ],
    },
    {
      group: "Evaluation",
      entries: [
        tech("business_obligation_at", `tick ${r.business_obligation_at}`, true, formatDateTime(capturedAt)),
        tech("observed_at", `tick ${r.observed_at}`, true, formatDateTime(observedAt)),
        tech("evaluation_at", `tick ${r.evaluation_at}`, true, formatDateTime(evaluatedAt)),
        tech("tick mapping", `1 tick = ${env.tick_seconds}s from ${env.tick_origin_iso}`, true, "Frontend-only"),
        tech("rule_basis_sha256", r.rule_basis_sha256, true, "Demo digest"),
      ],
    },
  ];

  return {
    id: env.run_id,
    workflow,
    previousRunId: env.previous_run_id,
    state: r.cohort_state,
    counts: c,
    recordsEvaluated: n,
    recordsNotFullyAssessed: records.filter((x) => x.rules.some((rl) => rl.status === "unknown")).length,
    expectedTotal: r.expected_total,
    populationKnown: r.source_population_known,
    coverageSufficient: r.destination_coverage_sufficient,
    accessDenied,
    destinationAccess: env.destination.access,
    capturedAt,
    observedAt,
    evaluatedAt,
    deadline,
    windowOpen,
    retryViable: env.policy.retry_viable,
    headline: headlineFor(r.cohort_state, c, n, r.source_population_known, accessDenied),
    explanation: explanation[r.cohort_state],
    reasons,
    nextStep: nextStep[r.cohort_state],
    issueBreakdown,
    premises,
    notEstablished,
    timeline,
    technical,
    records,
    local: null,
  };
}
