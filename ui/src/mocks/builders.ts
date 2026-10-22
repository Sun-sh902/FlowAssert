/**
 * Deterministic demo-fixture authoring.
 *
 * Each scenario is described in business terms (which rows are absent, duplicated or
 * differ) and the builder writes the rule outcomes and reason strings that
 * experiments/round03/model.py produces for that situation. Record and cohort states
 * are then derived with the precedence mirror in src/research/semantics.ts, and
 * src/mocks/validate.ts re-checks everything. No evidence is evaluated here.
 */
import { deriveCohortState, deriveRecordState } from "../research/semantics";
import type {
  ResearchCohortResult,
  ResearchRecordResult,
  ResearchRule,
  ResearchState,
} from "../research/types";
import type { DemoRunEnvelope, DemoSourceRow, DemoWorkflow } from "./types";

/* ---------- deterministic helpers ---------- */

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: string) {
  let a = hashString(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Demo digest: looks like SHA-256 hex, is NOT a hash of anything. Labelled in the UI. */
export function demoDigest(seed: string): string {
  const r = rng(seed);
  let out = "";
  while (out.length < 64) out += Math.floor(r() * 16).toString(16);
  return out;
}

const FIRST = [
  "Maya", "Jonas", "Priya", "Daniel", "Lea", "Omar", "Sofia", "Kenji", "Ana", "Felix",
  "Nadia", "Theo", "Ines", "Marcus", "Hana", "Lucas", "Amara", "Rafael", "Elif", "Noah",
  "Clara", "Idris", "June", "Mateo", "Yara", "Emil", "Zoe", "Arjun", "Mila", "Tomas",
];
const LAST = [
  "Ortiz", "Lindqvist", "Raman", "Okafor", "Brandt", "Haddad", "Moreau", "Sato", "Costa",
  "Weber", "Novak", "Aydin", "Fischer", "Kowalski", "Mensah", "Park", "Rossi", "Silva",
  "Varga", "Jensen", "Duarte", "Nakamura", "Bauer", "Khan", "Laurent", "Ivanova",
];
const COMPANIES = [
  ["Northwind Studio", "northwind.example"],
  ["Lattice Dental", "latticedental.example"],
  ["Harbor & Pine", "harborpine.example"],
  ["Kestrel Logistics", "kestrel.example"],
  ["Copperleaf Bakery", "copperleaf.example"],
  ["Meridian Legal", "meridianlegal.example"],
  ["Aster Clinic", "asterclinic.example"],
  ["Bluefield Realty", "bluefield.example"],
  ["Quarry Fitness", "quarryfit.example"],
  ["Tidewater Coffee", "tidewater.example"],
] as const;

/* ---------- scenario specification ---------- */

export type RowScenario =
  | { kind: "phone-differs"; destinationPhone: string }
  | { kind: "email-differs"; destinationEmail: string }
  | { kind: "absent" }
  | { kind: "duplicate" };

export interface RunSpec {
  workflow: DemoWorkflow;
  /** Wall-clock source-capture instant (research tick 0). */
  capturedIso: string;
  keyPrefix: string;
  firstKey: number;
  keyDigits?: number;
  rowCount: number;
  /** Ticks are minutes in the demo. */
  deadlineAfter: number;
  observedAfter: number;
  evaluatedAfter: number;
  maxAge: number;
  retryViable: boolean;
  access?: "ok" | "denied";
  /** Provider total exceeds distinct rows returned (hidden/unreturned match). */
  queryTotalSurplus?: number;
  /** Independent inventory record absent → population unknown. */
  inventoryMissing?: boolean;
  policyVersion: string;
  rows?: Record<number, RowScenario>;
}

export const DEMO_ACCOUNT = "demo-portal-0000";
export const TICK_SECONDS = 60;

function rule(status: ResearchRule["status"], reason: string, detail?: { expected: string; actual: string }): ResearchRule {
  return detail ? { status, reason, ...detail } : { status, reason };
}

function sourceRow(spec: RunSpec, index: number): DemoSourceRow {
  const r = rng(`${spec.workflow.id}:${spec.capturedIso}:${index}`);
  const first = FIRST[Math.floor(r() * FIRST.length)] ?? "Alex";
  const last = LAST[Math.floor(r() * LAST.length)] ?? "Doe";
  const company = COMPANIES[Math.floor(r() * COMPANIES.length)] ?? COMPANIES[0];
  const keyNumber = spec.firstKey + index;
  const key = `${spec.keyPrefix}-${String(keyNumber).padStart(spec.keyDigits ?? 4, "0")}`;
  const line = String(keyNumber % 10000).padStart(4, "0");
  return {
    key,
    name: `${first} ${last}`,
    company: company[0],
    phone: `+1 415 555 ${line}`,
    email: `${first}.${last}@${company[1]}`.toLowerCase(),
  };
}

export interface BuiltRun {
  spec: RunSpec;
  envelope: Omit<DemoRunEnvelope, "run_id" | "previous_run_id">;
  evaluatedMs: number;
}

export function buildRun(spec: RunSpec): BuiltRun {
  const access = spec.access ?? "ok";
  const capturedAt = 0;
  const deadline = spec.deadlineAfter;
  const observedAt = spec.observedAfter;
  const now = spec.evaluatedAfter;

  const rows = Array.from({ length: spec.rowCount }, (_, i) => sourceRow(spec, i));

  // Destination facts, as the acquisition layer would report them.
  const fresh = now - observedAt <= spec.maxAge;
  const positiveOk = access === "ok" && fresh;
  let distinctIds = 0;
  for (let i = 0; i < rows.length; i++) {
    const s = spec.rows?.[i];
    if (s?.kind === "absent") continue;
    distinctIds += s?.kind === "duplicate" ? 2 : 1;
  }
  if (!positiveOk) distinctIds = 0;
  const queryTotal = access === "ok" ? distinctIds + (spec.queryTotalSurplus ?? 0) : null;
  const queryTotalOk = queryTotal !== null && queryTotal === distinctIds;
  const pageCount = access === "ok" ? Math.max(1, Math.ceil(distinctIds / 20)) : 0;
  const coverageOk = positiveOk && queryTotalOk;
  const window = now < deadline && spec.retryViable;
  // Demo policies set require_historical_deadline / require_execution to false explicitly.
  const canWait = window && access !== "denied";

  let contactSeq = hashString(spec.workflow.id + spec.capturedIso) % 60000 + 20000;
  const nextContact = () => `CONTACT-${contactSeq++}`;

  const records: ResearchRecordResult[] = rows.map((row, i) => {
    const scenario = spec.rows?.[i];
    const rules: Record<string, ResearchRule> = {};
    let candidates: string[] = [];

    if (!positiveOk) {
      const reason = "destination binding, access, freshness, clock trust, or coherence unavailable";
      rules.existence = rule("unknown", reason);
      rules.phone = rule("unknown", reason);
      rules.uniqueness = rule("unknown", reason);
      rules.email = rule("unknown", reason);
    } else if (scenario?.kind === "duplicate") {
      candidates = [nextContact(), nextContact()];
      rules.existence = rule("pass", "reliable candidates observed");
      rules.phone = rule("unknown", "no arbitrary candidate selected");
      rules.uniqueness = rule("fail", "distinct IDs violate configured key uniqueness");
      rules.email = rule("unknown", "no arbitrary candidate selected");
    } else if (scenario?.kind === "absent") {
      if (coverageOk && observedAt >= deadline) {
        rules.existence = rule("fail", "expected key not found at observation at or after deadline");
      } else {
        rules.existence = rule("unknown", "waiting window or insufficient absence evidence");
      }
      rules.phone = rule("unknown", "insufficient evidence");
      rules.uniqueness = rule("unknown", "insufficient evidence");
      rules.email = rule("unknown", "insufficient evidence");
    } else {
      candidates = [nextContact()];
      const destPhone = scenario?.kind === "phone-differs" ? scenario.destinationPhone : row.phone;
      const destEmail = scenario?.kind === "email-differs" ? scenario.destinationEmail : row.email;
      rules.existence = rule("pass", "reliable candidate observed");
      rules.phone = rule(destPhone === row.phone ? "pass" : "fail", "exact string comparison", {
        expected: row.phone,
        actual: destPhone,
      });
      rules.uniqueness = coverageOk
        ? rule("pass", "complete relevant synthetic inventory")
        : rule("unknown", "insufficient evidence");
      rules.email = rule(destEmail === row.email ? "pass" : "fail", "exact string comparison", {
        expected: row.email,
        actual: destEmail,
      });
    }

    return {
      key: row.key,
      source_row: i,
      state: deriveRecordState(rules, canWait),
      candidate_ids: candidates.sort(),
      rules,
    };
  });

  const states = records.map((r) => r.state);
  const tally = (s: ResearchState) => states.filter((x) => x === s).length;
  const populationKnown = !spec.inventoryMissing && rows.length > 0;

  const seed = `${spec.workflow.id}:${spec.capturedIso}`;
  const result: ResearchCohortResult = {
    cohort_state: deriveCohortState(states, populationKnown),
    counts: {
      Verified: tally("Verified"),
      Mismatch: tally("Mismatch"),
      Pending: tally("Pending"),
      Unverified: tally("Unverified"),
    },
    records,
    expected_total: populationKnown ? rows.length : null,
    source_rows_observed: rows.length,
    source_population_known: populationKnown,
    destination_coverage_sufficient: coverageOk,
    source_basis_sha256: demoDigest(`${seed}:source`),
    rule_basis_sha256: demoDigest(`${spec.policyVersion}:rule`),
    observed_at: observedAt,
    deadline,
    business_obligation_at: capturedAt,
    evaluation_at: now,
    observation_time_valid: true,
    destination_page_sequence_valid: true,
    destination_page_sequence_reason: "valid reachable page sequence",
    premise_evidence: {
      source_provenance_record: true,
      source_inventory_record: !spec.inventoryMissing,
      rule_approval_record: true,
      destination_query_total_consistent: queryTotalOk,
      observation_clock_trusted: true,
    },
    workflow_execution: "Not assessed",
    business_truth: "Not assessed",
    absence_cause: "Not inferred",
  };

  const originMs = Date.parse(spec.capturedIso);
  return {
    spec,
    evaluatedMs: originMs + now * TICK_SECONDS * 1000,
    envelope: {
      workflow_id: spec.workflow.id,
      tick_origin_iso: spec.capturedIso,
      tick_seconds: TICK_SECONDS,
      policy: {
        version: spec.policyVersion,
        comparison: "exact-string",
        deadline,
        max_age: spec.maxAge,
        retry_viable: spec.retryViable,
        settling_allowed: false,
        identity_reliable: true,
        require_historical_deadline: false,
        require_execution: false,
        account: DEMO_ACCOUNT,
        object: "contacts",
      },
      source: {
        namespace: spec.workflow.sourceNamespace,
        captured_at: capturedAt,
        version: "v1",
        provenance_channel: "independent-source-read",
        inventory_method: spec.inventoryMissing ? null : "independent-enumeration",
        inventory_eligible_count: spec.inventoryMissing ? null : rows.length,
      },
      destination: {
        account: DEMO_ACCOUNT,
        object: "contacts",
        access,
        page_count: pageCount,
        query_total: queryTotal,
        distinct_ids_returned: distinctIds,
      },
      source_rows: rows,
      result,
    },
  };
}
