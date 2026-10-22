/**
 * Live ↔ archived comparison and exact Detail → Archive matching (product round 02). Pure.
 *
 * IDENTITY. Two results are about the same evaluation input when ALL of these are equal:
 *   verification ID · workspace · input_evidence_sha256 · evaluator model_sha256 · evaluator source_commit ·
 *   original contract (live `meta.contract_version` maps to the archive's `original_contract_sha256` only through
 *   the one pinned pair 0.1.1-proposed ↔ 0688d55d…; any other version cannot be mapped and is not comparable).
 * The catalog snapshot ID is shown but is NOT part of identity: the Service derives it from the whole catalog
 * including execution timestamps (service/app/service.py), so it changes on every Service start and a live and an
 * archived snapshot are equal only when both come from the same publication. Times and verdict labels are never
 * used to match anything.
 *
 * RESULT. With equal identity, the live and archived results are compared field by field (cohort, counts,
 * expected total, population known) and, where both are available, as Python canonical JSON of the whole result.
 * A difference is a DIAGNOSTIC about two Service outputs — never a business Mismatch, never a new verdict.
 *
 * MISSING. A missing live result is LIVE_MISSING, a missing archive entry is ARCHIVE_MISSING, a read that did not
 * complete is SERVICE_UNAVAILABLE or INCONCLUSIVE. None of them is ever mapped to Unverified.
 */
import type { HistorySummaryView } from "../../domain/history";
import type { RunView, StateCounts } from "../../domain/view";
import { HISTORY_SCOPE } from "../history/config";
import { LOCAL_SCOPE } from "../local/config";

export interface EvaluationIdentity {
  verificationId: string;
  workspaceId: string;
  inputEvidenceSha256: string;
  evaluatorModelSha256: string;
  evaluatorSourceCommit: string;
  /** The frozen contract's digest; null when a live contract version cannot be mapped through the pinned pair. */
  contractSha256: string | null;
  /** Shown, never matched on. */
  snapshotId: string;
}

export const IDENTITY_FIELDS = ["verificationId", "workspaceId", "inputEvidenceSha256", "evaluatorModelSha256", "evaluatorSourceCommit", "contractSha256"] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

export const IDENTITY_LABEL: Record<IdentityField, string> = {
  verificationId: "verification ID",
  workspaceId: "workspace",
  inputEvidenceSha256: "input evidence",
  evaluatorModelSha256: "evaluator model",
  evaluatorSourceCommit: "evaluator source",
  contractSha256: "contract",
};

/** The one contract pairing this build knows (handoff + accepted baseline). */
const CONTRACT_PAIR: Record<string, string> = { [LOCAL_SCOPE.contractVersion]: HISTORY_SCOPE.originalContractSha256 };

export function liveIdentity(run: RunView): EvaluationIdentity | null {
  const l = run.local;
  if (!l) return null;
  return {
    verificationId: run.id,
    workspaceId: l.workspaceId,
    inputEvidenceSha256: l.inputEvidenceSha256,
    evaluatorModelSha256: l.evaluator.modelSha256,
    evaluatorSourceCommit: l.evaluator.sourceCommit,
    contractSha256: CONTRACT_PAIR[l.contractVersion] ?? null,
    snapshotId: l.snapshotId,
  };
}

export function archivedIdentity(e: HistorySummaryView): EvaluationIdentity {
  return {
    verificationId: e.verificationId,
    workspaceId: e.workspaceId,
    inputEvidenceSha256: e.inputEvidenceSha256,
    evaluatorModelSha256: e.evaluator.modelSha256,
    evaluatorSourceCommit: e.evaluator.sourceCommit,
    contractSha256: e.originalContractSha256,
    snapshotId: e.originalSnapshotId,
  };
}

/** Identity fields that differ. An unmappable contract (null) always differs. */
export function identityDifferences(a: EvaluationIdentity, b: EvaluationIdentity): IdentityField[] {
  return IDENTITY_FIELDS.filter((f) => a[f] === null || b[f] === null || a[f] !== b[f]);
}

export interface ResultSummary {
  cohort: RunView["state"];
  counts: StateCounts;
  expectedTotal: number | null;
  populationKnown: boolean;
}

export const RESULT_FIELD_LABEL = { cohort: "cohort result", counts: "record counts", expectedTotal: "expected total", populationKnown: "population known" } as const;
export type ResultField = keyof typeof RESULT_FIELD_LABEL;

export const liveSummary = (r: RunView): ResultSummary => ({ cohort: r.state, counts: r.counts, expectedTotal: r.expectedTotal, populationKnown: r.populationKnown });
export const archivedSummary = (e: HistorySummaryView): ResultSummary => ({ cohort: e.result.cohort, counts: e.result.counts, expectedTotal: e.result.expectedTotal, populationKnown: e.result.populationKnown });

export function resultDifferences(a: ResultSummary, b: ResultSummary): ResultField[] {
  const out: ResultField[] = [];
  if (a.cohort !== b.cohort) out.push("cohort");
  if ((["Verified", "Mismatch", "Pending", "Unverified"] as const).some((s) => a.counts[s] !== b.counts[s])) out.push("counts");
  if (a.expectedTotal !== b.expectedTotal) out.push("expectedTotal");
  if (a.populationKnown !== b.populationKnown) out.push("populationKnown");
  return out;
}

/* ---------- One case: what was read on each side ---------- */

export type SideFailure = { code: string; message: string; transport: boolean; integrity: boolean };

export type LiveSide =
  | { kind: "reading" }
  | { kind: "ready"; run: RunView }
  | { kind: "not_found" }
  | { kind: "failed"; failure: SideFailure }
  | { kind: "cancelled" };

export type ArchiveSide =
  | { kind: "reading" }
  /** The archive list was read completely; `entries` are this case's, newest archive entry first. */
  | { kind: "ready"; entries: HistorySummaryView[] }
  | { kind: "failed"; failure: SideFailure }
  | { kind: "cancelled" };

export type ComparisonState =
  | "READING"
  | "SAME_INPUT_AGREE"
  | "SAME_INPUT_DIFFER"
  | "DIFFERENT_INPUT"
  | "LIVE_MISSING"
  | "ARCHIVE_MISSING"
  | "SERVICE_UNAVAILABLE"
  | "INCONCLUSIVE";

export interface CaseComparison {
  state: ComparisonState;
  /** The newest archived entry the live result was compared with (archive order), when there is one. */
  archived: HistorySummaryView | null;
  identityDiffers: IdentityField[];
  resultDiffers: ResultField[];
  /** Live and archived catalog snapshots: equal only within one Service publication. Null when not both read. */
  sameSnapshot: boolean | null;
  reason: string;
}

const none = (): Pick<CaseComparison, "identityDiffers" | "resultDiffers" | "sameSnapshot"> => ({ identityDiffers: [], resultDiffers: [], sameSnapshot: null });

export function compareCase(live: LiveSide, archive: ArchiveSide): CaseComparison {
  const archived = archive.kind === "ready" ? (archive.entries[0] ?? null) : null;
  if (live.kind === "reading" || archive.kind === "reading") return { state: "READING", archived, ...none(), reason: "Reading the live result and the archive." };
  const failures = [live.kind === "failed" ? live.failure : null, archive.kind === "failed" ? archive.failure : null].filter((f): f is SideFailure => f !== null);
  if (failures.length > 0) {
    const transport = failures.some((f) => f.transport && !f.integrity);
    return {
      state: transport ? "SERVICE_UNAVAILABLE" : "INCONCLUSIVE",
      archived,
      ...none(),
      reason: failures.map((f) => f.message).join(" "),
    };
  }
  if (live.kind === "cancelled" || archive.kind === "cancelled") return { state: "INCONCLUSIVE", archived, ...none(), reason: "A read was cancelled; nothing was compared." };
  if (live.kind === "not_found")
    return {
      state: "LIVE_MISSING",
      archived,
      ...none(),
      reason: archived ? "The Service has no current result for this ID; an archived evaluation exists." : "The Service has no current result for this ID, and the archive holds none.",
    };
  if (live.kind !== "ready") return { state: "INCONCLUSIVE", archived, ...none(), reason: "No live result was read." };
  if (!archived) return { state: "ARCHIVE_MISSING", archived: null, ...none(), reason: "The archive was read completely and holds no evaluation of this case." };
  const li = liveIdentity(live.run);
  if (!li) return { state: "INCONCLUSIVE", archived, ...none(), reason: "The live result carries no Service identity." };
  const ai = archivedIdentity(archived);
  const sameSnapshot = li.snapshotId === ai.snapshotId;
  const identityDiffers = identityDifferences(li, ai);
  if (identityDiffers.length > 0)
    return {
      state: "DIFFERENT_INPUT",
      archived,
      identityDiffers,
      resultDiffers: [],
      sameSnapshot,
      reason: `Not comparable: ${identityDiffers.map((f) => IDENTITY_LABEL[f]).join(", ")} differ${identityDiffers.length === 1 ? "s" : ""}.`,
    };
  const resultDiffers = resultDifferences(liveSummary(live.run), archivedSummary(archived));
  return resultDiffers.length === 0
    ? { state: "SAME_INPUT_AGREE", archived, identityDiffers, resultDiffers, sameSnapshot, reason: "Same input, same evaluator, same contract: the result summaries are equal." }
    : {
        state: "SAME_INPUT_DIFFER",
        archived,
        identityDiffers,
        resultDiffers,
        sameSnapshot,
        reason: `Same input, but the ${resultDiffers.map((f) => RESULT_FIELD_LABEL[f]).join(", ")} differ. Diagnostic only — not a verdict.`,
      };
}

/* ---------- Exact Detail → Archive matching ---------- */

export type ArchiveMatch =
  | { kind: "none"; considered: number; nearest: { entry: HistorySummaryView; differs: IdentityField[] }[] }
  | { kind: "one"; entry: HistorySummaryView }
  /** Several archived evaluations of exactly this input. None is chosen; all are listed, in archive order. */
  | { kind: "many"; entries: HistorySummaryView[] };

/** Archived entries whose identity equals the live result's exactly. Entries of other verification IDs never match. */
export function matchArchive(run: RunView, entries: readonly HistorySummaryView[]): ArchiveMatch {
  const li = liveIdentity(run);
  if (!li) return { kind: "none", considered: entries.length, nearest: [] };
  const scored = entries.map((entry) => ({ entry, differs: identityDifferences(li, archivedIdentity(entry)) }));
  const exact = scored.filter((s) => s.differs.length === 0).map((s) => s.entry);
  if (exact.length === 1) return { kind: "one", entry: exact[0]! };
  if (exact.length > 1) return { kind: "many", entries: exact };
  return { kind: "none", considered: entries.length, nearest: scored.filter((s) => s.entry.verificationId === run.id) };
}

/** Byte-level result relation for an exact match, from both results' Python canonical JSON. */
export function resultRelation(live: RunView, archivedRun: RunView): "identical" | "different" | "not_checkable" {
  const a = live.local?.resultCanonical ?? null;
  const b = archivedRun.local?.resultCanonical ?? null;
  if (a === null || b === null) return "not_checkable";
  return a === b ? "identical" : "different";
}
