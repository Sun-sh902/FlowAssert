/**
 * Where the unit tests' captured fixtures come from (round 02 hardening FIX01).
 *
 * A suite that needs a fixture resolves it here. The frozen, history and ID-addressability contracts and the history
 * examples are the Service's own pinned copies in this repository (service/contracts: checked by
 * scripts/dev/check_identities.py and fixture-identity.test.ts). The Phase 2 handoff response bodies are expected under
 * fixtures/phase2-handoff/http, each with the SHA-256 the accepted handoff manifest records (phase2-handoff/SOURCE.json).
 * A FLOWASSERT_* variable points a run at another copy, e.g. the accepted read-only originals; it is identity-checked
 * the same way. A missing fixture throws where it is resolved (contracts and examples when the suite loads, handoff
 * bodies on first read), so the suites that need it fail — they are never skipped.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** This file is ui/src/test/fixtures/sources.ts; the test runner provides __dirname (import.meta.url is not file: under jsdom). */
export const REPO_ROOT = resolve(__dirname, "../../../..");

export function requiredFixture(envVar: string, repoPath: string): string {
  const path = process.env[envVar] ?? join(REPO_ROOT, repoPath);
  if (!existsSync(path)) throw new Error(`required test fixture missing: ${path} — restore ${repoPath} or set ${envVar} to an identity-checked copy`);
  return path;
}
