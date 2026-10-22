/**
 * DEMO CONFIGURATION — synthetic, frontend-only.
 *
 * Connections, rule register and provider modes for the Connections / Rules / Settings pages.
 * Nothing here is read from n8n, HubSpot or any source, and nothing is sent anywhere.
 *
 * Rule semantics and reason strings are quoted from the research evaluator
 * (FlowAssert-round03-oracle-fix/experiments/round03/model.py). This module does not
 * evaluate anything; it only describes what the evaluator does.
 */
import { DEMO_ACCOUNT } from "../mocks/builders";
import type { RuleStatus } from "../domain/view";

/* ---------- Connections ---------- */

export type ConnectionRole = "source" | "workflow" | "destination";

export interface Permission {
  id: string;
  label: string;
  /** "required" = needed for the role; "never" = FlowAssert must not hold it. */
  need: "required" | "optional" | "never";
  why: string;
  /** False while the exact provider permission name awaits Phase 0. */
  confirmed: boolean;
}

export interface ConnectionView {
  role: ConnectionRole;
  n: string;
  roleLabel: string;
  name: string;
  provider: string;
  /** One-sentence role statement, serif. */
  stance: string;
  reads: string[];
  neverReads: string[];
  permissions: Permission[];
  status: "not-connected";
  configFields: { label: string; value: string; hint: string }[];
}

export const CONNECTIONS: ConnectionView[] = [
  {
    role: "source",
    n: "A",
    roleLabel: "Independent source",
    name: "Lead intake sheet",
    provider: "Provider not chosen",
    stance: "Read independently of the workflow, so the comparison has a basis the workflow cannot shape.",
    reads: ["Captured rows — key and compared fields", "Capture time and row digest", "Provenance record", "Independent inventory of eligible rows"],
    neverReads: ["The workflow’s own payload or output"],
    permissions: [
      { id: "rows", label: "Read source rows", need: "required", why: "Frozen expectation for each record.", confirmed: false },
      { id: "inventory", label: "Enumerate eligible rows", need: "required", why: "Without it the population stays unknown and the cohort cannot be Verified.", confirmed: false },
      { id: "write", label: "Write to the source", need: "never", why: "Verification is observation only.", confirmed: true },
    ],
    status: "not-connected",
    configFields: [
      { label: "Namespace", value: "intake-sheet/web-form", hint: "Binds captured rows to one obligation" },
      { label: "Key column", value: "lead_key", hint: "Must be unique per row" },
      { label: "Provenance channel", value: "independent-source-read", hint: "workflow-payload is rejected" },
    ],
  },
  {
    role: "workflow",
    n: "B",
    roleLabel: "Workflow under test",
    name: "n8n · Lead Synchronization",
    provider: "n8n",
    stance: "The thing being checked. FlowAssert never takes its word for what happened.",
    reads: ["A display label to group runs"],
    neverReads: ["Execution logs as evidence", "Node output", "Credentials stored in n8n"],
    permissions: [
      { id: "meta", label: "Read workflow name", need: "optional", why: "Labels only. Proposed; not decided.", confirmed: false },
      { id: "exec", label: "Read execution history", need: "never", why: "No execution evidence is used. Workflow execution stays “not assessed”.", confirmed: true },
      { id: "creds", label: "Access n8n credentials", need: "never", why: "FlowAssert holds its own read access to each end.", confirmed: true },
    ],
    status: "not-connected",
    configFields: [{ label: "Workflow label", value: "Lead Synchronization · web form", hint: "Display only" }],
  },
  {
    role: "destination",
    n: "C",
    roleLabel: "Destination",
    name: "HubSpot · contacts",
    provider: "HubSpot",
    stance: "Observed after the deadline and compared, character for character, with the captured source.",
    reads: ["Contacts matching each source key", "Every page of the query and the provider total", "Observation time"],
    neverReads: ["Contacts outside the bound account and object"],
    permissions: [
      { id: "contacts-read", label: "crm.objects.contacts.read", need: "required", why: "Read contacts by key property across all pages.", confirmed: false },
      { id: "contacts-write", label: "crm.objects.contacts.write", need: "never", why: "FlowAssert never edits the CRM. Fixes happen outside it.", confirmed: true },
    ],
    status: "not-connected",
    configFields: [
      { label: "Account", value: DEMO_ACCOUNT, hint: "Must equal the rule policy account" },
      { label: "Object", value: "contacts", hint: "Must equal the rule policy object" },
      { label: "Key property", value: "lead_key", hint: "Matched against the source key" },
    ],
  },
];

/* ---------- Rules ---------- */

export type RuleProvenance = "research" | "proposed" | "draft";

export interface RuleOutcome {
  status: RuleStatus;
  when: string;
  /** Exact evaluator reason string (research rules only). */
  reason: string;
}

export interface RuleEntry {
  id: string;
  label: string;
  provenance: RuleProvenance;
  kind: string;
  /** The assertion, stated as a sentence. */
  assertion: string;
  expr: { left: string; op: "=" | "∃" | "≤ 1" | "?"; right: string };
  required: string;
  outcomes: RuleOutcome[];
  note?: string;
}

export const RULES: RuleEntry[] = [
  {
    id: "existence",
    label: "Record exists",
    provenance: "research",
    kind: "existence",
    assertion: "A HubSpot contact carrying the source key is reliably observed.",
    expr: { left: "source.key", op: "∃", right: "hubspot.contacts[key]" },
    required: "Always",
    outcomes: [
      { status: "pass", when: "One or more reliable candidates observed", reason: "reliable candidate observed" },
      { status: "fail", when: "Complete read at or after the deadline finds no candidate", reason: "expected key not found at observation at or after deadline" },
      { status: "unknown", when: "Before the deadline, or absence cannot be established", reason: "waiting window or insufficient absence evidence" },
    ],
  },
  {
    id: "uniqueness",
    label: "One per key",
    provenance: "research",
    kind: "uniqueness",
    assertion: "Exactly one HubSpot contact carries each source key.",
    expr: { left: "count(hubspot.contacts[key])", op: "≤ 1", right: "" },
    required: "Always",
    outcomes: [
      { status: "pass", when: "Single candidate and the destination read is complete", reason: "complete relevant synthetic inventory" },
      { status: "fail", when: "Two or more distinct contact IDs share the key", reason: "distinct IDs violate configured key uniqueness" },
      { status: "unknown", when: "Coverage cannot be shown complete", reason: "insufficient evidence" },
    ],
  },
  {
    id: "phone",
    label: "Phone",
    provenance: "research",
    kind: "field · exact string",
    assertion: "The HubSpot phone equals the captured source phone, character for character.",
    expr: { left: "source.phone", op: "=", right: "hubspot.phone" },
    required: "Always",
    outcomes: [
      { status: "pass", when: "Both values readable and identical", reason: "exact string comparison" },
      { status: "fail", when: "Both values readable and different", reason: "exact string comparison" },
      { status: "unknown", when: "Value missing, unreadable, or settling still allowed", reason: "missing, null, inaccessible, or unsupported phone type" },
    ],
    note: "No hidden normalisation: “+1 415 555 1025” and “4155551025” differ.",
  },
  {
    id: "existed_by_deadline",
    label: "Existed by deadline",
    provenance: "research",
    kind: "historical",
    assertion: "The contact already existed when the deadline passed.",
    expr: { left: "hubspot.contacts[key] @ deadline", op: "?", right: "" },
    required: "Unless the policy sets it explicitly false",
    outcomes: [{ status: "unknown", when: "Always — a later read cannot reconstruct the past", reason: "current read cannot reconstruct historical deadline" }],
    note: "Fail-closed: anything other than an explicit false keeps this rule required, which holds the record at Unverified.",
  },
  {
    id: "workflow_execution",
    label: "Workflow executed",
    provenance: "research",
    kind: "execution",
    assertion: "n8n actually ran and wrote these records.",
    expr: { left: "n8n.execution", op: "?", right: "" },
    required: "Unless the policy sets it explicitly false",
    outcomes: [{ status: "unknown", when: "Always — no execution evidence is read", reason: "Approach B contains no execution evidence" }],
  },
  {
    id: "email",
    label: "Email",
    provenance: "proposed",
    kind: "field · exact string",
    assertion: "The HubSpot email equals the captured source email, character for character.",
    expr: { left: "source.email", op: "=", right: "hubspot.email" },
    required: "Proposed — same kind as phone",
    outcomes: [
      { status: "pass", when: "Both values readable and identical", reason: "—" },
      { status: "fail", when: "Both values readable and different", reason: "—" },
      { status: "unknown", when: "Value missing or unreadable", reason: "—" },
    ],
    note: "A frontend proposal. The research evaluator does not evaluate email; its outcomes here are illustrative.",
  },
];

export interface PolicyView {
  version: string;
  workflow: string;
  deadlineMin: number;
  maxAgeMin: number;
  retryViable: boolean;
  settlingAllowed: boolean;
  requireHistorical: boolean;
  requireExecution: boolean;
  account: string;
  object: string;
}

/** Demo policy for the web-form workflow (mirrors src/mocks/fixtures.ts WEB). */
export const DEMO_POLICY: PolicyView = {
  version: "web-lead-sync-v3",
  workflow: "Web form leads",
  deadlineMin: 120,
  maxAgeMin: 15,
  retryViable: true,
  settlingAllowed: false,
  requireHistorical: false,
  requireExecution: false,
  account: DEMO_ACCOUNT,
  object: "contacts",
};
