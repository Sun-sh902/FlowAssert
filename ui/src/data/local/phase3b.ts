/**
 * Admission of the Phase 3B additive fields (src/data/contract/phase3b.ts).
 *
 * The frozen schemas are closed, so these fields are set aside first and the remaining body goes through the
 * accepted decoder unchanged (phase3bSplit). They are then judged here, on their own, as a whole:
 *   - all absent          the read carries no Phase 3B statement: nothing is established (a frozen-shape body, or an
 *                         archive read before Phase 3B). The axes stay "not implemented".
 *   - otherwise           both statuses are required, each from the contract's enum, and the pair must be one the
 *                         Service's evaluate_admission can produce. `run_bound_metadata` is closed and fully typed.
 *   - ADMITTED_RUN_BOUND  needs metadata that shows the work finished cleanly, and on a Detail its source and rule
 *                         digests must be the evaluated run's own.
 * A failed check refuses the whole body, like every other admission failure: nothing is repaired or defaulted, and
 * a status alone is never upgraded or downgraded. This is the only path by which a status reaches a view model.
 *
 * These checks compare what the Service reported. They do not authenticate it: a run-bound admission is the
 * Service's own statement, and it establishes no verdict, nothing about the source, and no external authenticity.
 */
import { ADMISSION_STATUSES, CAPTURE_STATUSES, RUN_BOUND_FIELDS, type AdmissionStatusDTO, type CaptureStatusDTO, type Phase3BFieldsDTO } from "../contract/phase3b";

const FIELDS = ["capture_status", "admission_status", "run_bound_metadata"] as const;
const SHA256 = /^[0-9a-f]{64}$/;

/** Every pair evaluate_admission (service/app/history_store.py) can return. Any other pairing contradicts itself. */
export const PHASE3B_PAIRS: readonly (readonly [CaptureStatusDTO, AdmissionStatusDTO])[] = [
  ["CAPTURE_NOT_IMPLEMENTED", "ADMISSION_NOT_IMPLEMENTED"],
  ["CAPTURED_COMPLETE", "ADMITTED_RUN_BOUND"],
  ["CAPTURE_INCOMPLETE", "REJECTED_INCOMPLETE_EXECUTION"],
  ["CAPTURE_INCOMPLETE", "REJECTED_BINDING_MISMATCH"],
  ["CAPTURE_STALE_REJECTED", "REJECTED_STALE_RECEIPT"],
  ["CAPTURE_SUBPROCESS_FAILED", "REJECTED_INCOMPLETE_EXECUTION"],
];

export interface Phase3BSplit {
  /** The body without the additive fields: exactly what the frozen schema must admit. */
  frozen: unknown;
  /** The additive fields present (own members only), or null when there are none. */
  fields: Record<string, unknown> | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Sets the additive fields aside. Anything that is not an object passes through for the schema to refuse. */
export function phase3bSplit(body: unknown): Phase3BSplit {
  if (!isObject(body)) return { frozen: body, fields: null };
  const frozen = { ...body };
  const fields: Record<string, unknown> = {};
  let found = false;
  for (const name of FIELDS)
    if (Object.hasOwn(body, name)) {
      fields[name] = body[name];
      delete frozen[name];
      found = true;
    }
  return { frozen, fields: found ? fields : null };
}

const natural = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;

function metadataProblems(meta: unknown, at: string): string[] {
  if (!isObject(meta)) return [`${at}run_bound_metadata is not an object`];
  const p: string[] = [];
  for (const key of Object.keys(meta)) if (!(RUN_BOUND_FIELDS as readonly string[]).includes(key)) p.push(`${at}run_bound_metadata carries undeclared member ${key}`);
  for (const key of RUN_BOUND_FIELDS) if (!Object.hasOwn(meta, key)) p.push(`${at}run_bound_metadata.${key} is missing`);
  if (p.length) return p;
  if (typeof meta.run_id !== "string" || meta.run_id === "") p.push(`${at}run_bound_metadata.run_id is not a non-empty string`);
  for (const key of ["execution_cwd_sha256", "source_basis_sha256", "rule_basis_sha256"] as const) {
    const digest = meta[key];
    if (typeof digest !== "string" || !SHA256.test(digest)) p.push(`${at}run_bound_metadata.${key} is not a lower-case SHA-256`);
  }
  for (const key of ["started_mono_ns", "completed_mono_ns", "subprocess_failures"] as const) if (!natural(meta[key])) p.push(`${at}run_bound_metadata.${key} is not a non-negative integer`);
  if (typeof meta.verifier_work_completed !== "boolean") p.push(`${at}run_bound_metadata.verifier_work_completed is not a boolean`);
  if (meta.outer_exit_status !== null && !Number.isInteger(meta.outer_exit_status)) p.push(`${at}run_bound_metadata.outer_exit_status is neither an integer nor null`);
  return p;
}

/** The run a Detail's fields are bound to. A list item has no run, so its digests cannot be compared there. */
export interface Phase3BBasis {
  source_basis_sha256: string;
  rule_basis_sha256: string;
}

/**
 * Why these fields cannot be admitted (empty when they can). `fields` comes from phase3bSplit. `basis` is the
 * evaluated run's own digests, when the body carries that run.
 */
export function phase3bProblems(fields: Record<string, unknown> | null, at = "", basis?: Phase3BBasis): string[] {
  if (fields === null) return [];
  const capture = fields.capture_status as CaptureStatusDTO;
  const admission = fields.admission_status as AdmissionStatusDTO;
  const p: string[] = [];
  if (!CAPTURE_STATUSES.includes(capture)) p.push(`${at}capture_status ${JSON.stringify(capture) ?? "is absent"} is not a contract value`);
  if (!ADMISSION_STATUSES.includes(admission)) p.push(`${at}admission_status ${JSON.stringify(admission) ?? "is absent"} is not a contract value`);
  if (p.length) return p;
  if (!PHASE3B_PAIRS.some(([c, a]) => c === capture && a === admission)) return [`${at}capture_status ${capture} cannot accompany admission_status ${admission}`];

  const hasMeta = Object.hasOwn(fields, "run_bound_metadata");
  if (hasMeta) {
    const bad = metadataProblems(fields.run_bound_metadata, at);
    if (bad.length) return bad;
  }
  if (admission === "ADMISSION_NOT_IMPLEMENTED" && hasMeta) return [`${at}run_bound_metadata accompanies ${admission}`];
  if (admission !== "ADMITTED_RUN_BOUND") return [];
  if (!hasMeta) return [`${at}${admission} carries no run_bound_metadata`];
  const m = fields.run_bound_metadata as NonNullable<Phase3BFieldsDTO["run_bound_metadata"]>;
  if (m.verifier_work_completed !== true) p.push(`${at}${admission} but verifier_work_completed is false`);
  if (m.outer_exit_status !== 0) p.push(`${at}${admission} but outer_exit_status is ${m.outer_exit_status}`);
  if (m.subprocess_failures !== 0) p.push(`${at}${admission} but subprocess_failures is ${m.subprocess_failures}`);
  if (m.completed_mono_ns < m.started_mono_ns) p.push(`${at}${admission} but the run completed before it started`);
  if (basis && m.source_basis_sha256 !== basis.source_basis_sha256) p.push(`${at}${admission} but source_basis_sha256 is not the evaluated run's`);
  if (basis && m.rule_basis_sha256 !== basis.rule_basis_sha256) p.push(`${at}${admission} but rule_basis_sha256 is not the evaluated run's`);
  return p;
}
