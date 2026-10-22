/**
 * DEMO DATA ENVELOPE — FRONTEND-ONLY.
 *
 * The research evaluator returns a cohort result with integer ticks and no notion of
 * workflows, run IDs or wall-clock time. A future backend would have to wrap it with
 * this kind of context. Everything in this file is a PROPOSAL used to drive the demo;
 * only `result` mirrors an existing research structure.
 */
import type {
  ResearchCohortResult,
  ResearchDestinationInput,
  ResearchPolicy,
  ResearchSourceInput,
} from "../research/types";

export interface DemoWorkflow {
  id: string;
  /** Business name shown in the UI. */
  name: string;
  /** Proposed n8n workflow label. No n8n connection exists. */
  n8nLabel: string;
  sourceSystem: string;
  sourceNamespace: string;
  destinationSystem: "HubSpot";
  destinationObject: "contacts";
}

/** Display-only columns of a captured source row. Only `key` and `phone` exist in research rows. */
export interface DemoSourceRow {
  key: string;
  name: string;
  company: string;
  phone: string;
  email: string;
}

export interface DemoRunEnvelope {
  run_id: string;
  workflow_id: string;
  previous_run_id: string | null;
  /** Wall-clock instant that research tick 0 maps to. Frontend-only. */
  tick_origin_iso: string;
  /** Seconds per research tick. Frontend-only. */
  tick_seconds: number;
  policy: ResearchPolicy;
  source: ResearchSourceInput;
  destination: ResearchDestinationInput;
  source_rows: DemoSourceRow[];
  /** Mirrors model.py `evaluate()` output. */
  result: ResearchCohortResult;
}
