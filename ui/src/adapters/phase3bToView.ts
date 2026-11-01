/**
 * Phase 3B adapter: admitted additive fields (src/data/local/phase3b.ts) → view model. Copies, never derives a status.
 *
 * The one computed value is the elapsed time between two reported monotonic readings. The readings are kept as
 * decimal text from the response's own lexemes: time.monotonic_ns() passes Number.MAX_SAFE_INTEGER on a host up for
 * about 104 days, where JSON.parse would silently round them. A reading that cannot be stated exactly is null.
 */
import type { Phase3BFieldsDTO } from "../data/contract/phase3b";
import { losslessAt, type Lossless } from "../data/local/canonical";
import type { Phase3BView, RunBoundMetadataView } from "../domain/statusAxes";

export interface MonoLexemes {
  started?: string;
  completed?: string;
}

/** The two readings' lexemes at `at` (the object holding run_bound_metadata) in a lossless parse of the same body. */
export function monoLexemes(tree: Lossless | undefined, at: (string | number)[]): MonoLexemes {
  const lexeme = (field: string) => {
    const node = losslessAt(tree, [...at, "run_bound_metadata", field]);
    return node !== null && typeof node === "object" && node.k === "num" ? node.lex : undefined;
  };
  return { started: lexeme("started_mono_ns"), completed: lexeme("completed_mono_ns") };
}

const exact = (lexeme: string | undefined, parsed: number): string | null => (lexeme !== undefined && /^(0|[1-9][0-9]*)$/.test(lexeme) ? lexeme : Number.isSafeInteger(parsed) ? String(parsed) : null);

function toRunBoundView(m: NonNullable<Phase3BFieldsDTO["run_bound_metadata"]>, lexemes: MonoLexemes): RunBoundMetadataView {
  const started = exact(lexemes.started, m.started_mono_ns);
  const completed = exact(lexemes.completed, m.completed_mono_ns);
  return {
    runId: m.run_id,
    executionCwdSha256: m.execution_cwd_sha256,
    sourceBasisSha256: m.source_basis_sha256,
    ruleBasisSha256: m.rule_basis_sha256,
    startedMonoNs: started,
    completedMonoNs: completed,
    elapsedNs: started !== null && completed !== null ? String(BigInt(completed) - BigInt(started)) : null,
    verifierWorkCompleted: m.verifier_work_completed,
    outerExitStatus: m.outer_exit_status,
    subprocessFailures: m.subprocess_failures,
  };
}

/** Null when the body made no Phase 3B statement. Call only with fields the decoder admitted. */
export function toPhase3BView(fields: Partial<Phase3BFieldsDTO>, lexemes: MonoLexemes = {}): Phase3BView | null {
  if (fields.capture_status === undefined || fields.admission_status === undefined) return null;
  return {
    captureStatus: fields.capture_status,
    admissionStatus: fields.admission_status,
    runBound: fields.run_bound_metadata ? toRunBoundView(fields.run_bound_metadata, lexemes) : null,
  };
}
