/**
 * Display-consistency mirror of the research state precedence.
 *
 * This is NOT a verification engine. It does not read evidence. It restates the two
 * aggregation rules from experiments/round03/model.py so that hand-built demo
 * fixtures can be checked for internal consistency (see src/mocks/validate.ts):
 *
 *   state(rules, can_wait)            -> deriveRecordState
 *   cohort block at end of evaluate() -> deriveCohortState
 *
 * If model.py changes, these must be updated from it — never simplified.
 */
import type { ResearchRule, ResearchState } from "./types";

export function deriveRecordState(
  rules: Record<string, ResearchRule>,
  canWait: boolean,
): ResearchState {
  const values = Object.values(rules).map((r) => r.status);
  if (values.includes("fail")) return "Mismatch";
  if (values.length > 0 && values.every((v) => v === "pass")) return "Verified";
  return canWait ? "Pending" : "Unverified";
}

export function deriveCohortState(
  recordStates: ResearchState[],
  populationKnown: boolean,
): ResearchState {
  const count = (s: ResearchState) => recordStates.filter((x) => x === s).length;
  if (count("Mismatch") > 0) return "Mismatch";
  if (!populationKnown || recordStates.length === 0) return "Unverified";
  if (count("Verified") === recordStates.length) return "Verified";
  if (count("Unverified") > 0) return "Unverified";
  return "Pending";
}
