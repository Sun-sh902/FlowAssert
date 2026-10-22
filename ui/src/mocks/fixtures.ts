/**
 * DEMO FIXTURES — synthetic. No record here was read from n8n, HubSpot or any source.
 *
 * Scenarios are chosen to exercise distinctions the research model makes:
 *  - field differences, absence after deadline and key duplicates (Mismatch)
 *  - absence inside an open, retry-viable window (Pending)
 *  - every row Verified while the source population is unknown (cohort Unverified)
 *  - destination read denied (all rows Unverified, never Pending — cf. E5-denied-no-pending)
 *  - provider total inconsistent with returned rows (uniqueness unassessed → Unverified,
 *    while a field difference is still a Mismatch — cf. E4-duplicates-partial)
 */
import { buildRun, type BuiltRun, type RunSpec } from "./builders";
import type { DemoRunEnvelope, DemoWorkflow } from "./types";

/** Fixed demo clock. Relative times in the UI are computed against this, not the real clock. */
export const DEMO_NOW_ISO = "2026-10-16T14:30:00Z";

export const DEMO_WORKFLOWS: DemoWorkflow[] = [
  {
    id: "wf-web-form",
    name: "Web form leads",
    n8nLabel: "Lead Synchronization · web form",
    sourceSystem: "Lead intake sheet",
    sourceNamespace: "intake-sheet/web-form",
    destinationSystem: "HubSpot",
    destinationObject: "contacts",
  },
  {
    id: "wf-trade-shows",
    name: "Trade show badge scans",
    n8nLabel: "Events import · Q4 shows",
    sourceSystem: "Lead intake sheet",
    sourceNamespace: "intake-sheet/trade-shows",
    destinationSystem: "HubSpot",
    destinationObject: "contacts",
  },
  {
    id: "wf-partner",
    name: "Partner referrals",
    n8nLabel: "Partner portal sync",
    sourceSystem: "Partner portal export",
    sourceNamespace: "partner-portal/referrals",
    destinationSystem: "HubSpot",
    destinationObject: "contacts",
  },
  {
    id: "wf-webinar",
    name: "Webinar registrations",
    n8nLabel: "Webinar → CRM",
    sourceSystem: "Lead intake sheet",
    sourceNamespace: "intake-sheet/webinars",
    destinationSystem: "HubSpot",
    destinationObject: "contacts",
  },
  {
    id: "wf-newsletter",
    name: "Newsletter sign-ups",
    n8nLabel: "Newsletter opt-ins",
    sourceSystem: "Lead intake sheet",
    sourceNamespace: "intake-sheet/newsletter",
    destinationSystem: "HubSpot",
    destinationObject: "contacts",
  },
];

const wf = (id: string): DemoWorkflow => {
  const found = DEMO_WORKFLOWS.find((w) => w.id === id);
  if (!found) throw new Error(`Unknown demo workflow ${id}`);
  return found;
};

const web = wf("wf-web-form");
const shows = wf("wf-trade-shows");
const partner = wf("wf-partner");
const webinar = wf("wf-webinar");
const newsletter = wf("wf-newsletter");

const WEB = { keyPrefix: "LEAD", deadlineAfter: 120, observedAfter: 152, evaluatedAfter: 155, maxAge: 15, retryViable: true, policyVersion: "web-lead-sync-v3" };
const SHOWS = { keyPrefix: "EVT", deadlineAfter: 120, observedAfter: 150, evaluatedAfter: 153, maxAge: 15, retryViable: true, policyVersion: "event-sync-v2" };
const PARTNER = { keyPrefix: "REF", deadlineAfter: 120, observedAfter: 140, evaluatedAfter: 142, maxAge: 15, retryViable: true, policyVersion: "partner-sync-v1" };
const WEBINAR = { keyPrefix: "WBN", deadlineAfter: 90, observedAfter: 95, evaluatedAfter: 96, maxAge: 15, retryViable: true, policyVersion: "webinar-sync-v2" };
const NEWS = { keyPrefix: "NWS", deadlineAfter: 60, observedAfter: 75, evaluatedAfter: 76, maxAge: 15, retryViable: true, policyVersion: "newsletter-sync-v1" };

const SPECS: RunSpec[] = [
  // ---- 12 Oct
  { workflow: web, ...WEB, capturedIso: "2026-10-12T11:30:00Z", firstKey: 846, rowCount: 38 },
  { workflow: webinar, ...WEBINAR, capturedIso: "2026-10-12T07:00:00Z", firstKey: 301, rowCount: 15 },
  // ---- 13 Oct
  { workflow: web, ...WEB, capturedIso: "2026-10-13T11:30:00Z", firstKey: 884, rowCount: 40 },
  { workflow: newsletter, ...NEWS, capturedIso: "2026-10-13T10:00:00Z", firstKey: 5120, rowCount: 17 },
  {
    workflow: shows, ...SHOWS, capturedIso: "2026-10-13T16:00:00Z", firstKey: 2210, rowCount: 58,
    rows: { 40: { kind: "absent" } },
  },
  // ---- 14 Oct
  {
    workflow: web, ...WEB, capturedIso: "2026-10-14T11:30:00Z", firstKey: 924, rowCount: 51,
    rows: { 12: { kind: "email-differs", destinationEmail: "" } },
  },
  {
    workflow: webinar, ...WEBINAR, capturedIso: "2026-10-14T07:00:00Z", firstKey: 316, rowCount: 18,
    queryTotalSurplus: 1,
    rows: { 5: { kind: "phone-differs", destinationPhone: "4155550321" } },
  },
  // ---- 15 Oct
  { workflow: web, ...WEB, capturedIso: "2026-10-15T11:30:00Z", firstKey: 985, rowCount: 46 },
  { workflow: partner, ...PARTNER, capturedIso: "2026-10-15T08:45:00Z", firstKey: 77, rowCount: 9, keyDigits: 3 },
  { workflow: newsletter, ...NEWS, capturedIso: "2026-10-15T10:00:00Z", firstKey: 5137, rowCount: 19 },
  { workflow: shows, ...SHOWS, capturedIso: "2026-10-15T16:00:00Z", firstKey: 2268, rowCount: 64 },
  // ---- 16 Oct (latest per workflow)
  {
    workflow: webinar, ...WEBINAR, capturedIso: "2026-10-16T07:00:00Z", firstKey: 334, rowCount: 20,
    access: "denied",
  },
  {
    workflow: partner, ...PARTNER, capturedIso: "2026-10-16T08:45:00Z", firstKey: 86, rowCount: 12, keyDigits: 3,
    inventoryMissing: true,
  },
  { workflow: newsletter, ...NEWS, capturedIso: "2026-10-16T10:00:00Z", firstKey: 5156, rowCount: 22 },
  {
    workflow: web, ...WEB, capturedIso: "2026-10-16T11:30:00Z", firstKey: 1031, rowCount: 48,
    rows: {
      7: { kind: "phone-differs", destinationPhone: "restaurant" },
      21: { kind: "phone-differs", destinationPhone: "+1 415 555 1025" },
      30: { kind: "absent" },
      36: { kind: "duplicate" },
    },
  },
  {
    workflow: shows, ...SHOWS, capturedIso: "2026-10-16T13:40:00Z", firstKey: 2332, rowCount: 30,
    observedAfter: 40, evaluatedAfter: 42,
    rows: { 4: { kind: "absent" }, 11: { kind: "absent" }, 19: { kind: "absent" }, 27: { kind: "absent" } },
  },
];

function assignIds(built: BuiltRun[]): DemoRunEnvelope[] {
  const ordered = [...built].sort((a, b) => a.evaluatedMs - b.evaluatedMs);
  const lastByWorkflow = new Map<string, string>();
  return ordered.map((b, i) => {
    const runId = `VR-${2011 + i}`;
    const previous = lastByWorkflow.get(b.spec.workflow.id) ?? null;
    lastByWorkflow.set(b.spec.workflow.id, runId);
    return { ...b.envelope, run_id: runId, previous_run_id: previous };
  });
}

/** All demo runs, oldest first. */
export const DEMO_RUNS: DemoRunEnvelope[] = assignIds(SPECS.map(buildRun));
