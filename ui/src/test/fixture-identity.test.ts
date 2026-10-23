/**
 * Identity of every captured fixture the unit tests read (round 02 hardening FIX01). Whichever copy a run uses — the
 * repository's own or a FLOWASSERT_* override — must be byte-identical to the accepted sources:
 *  - contracts and history examples: the digests in the accepted backend source map (39 files, a5d68b75…4b45),
 *    service/docs/phase3a/id-addressability-remediation-03/evidence/source-identities.json;
 *  - Phase 2 handoff bodies: exactly the files and SHA-256 the handoff manifest records (fixtures/phase2-handoff/SOURCE.json).
 * A missing fixture fails here and in every suite that reads it; nothing is skipped.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRACT, HISTORY_CONTRACT, LOOKUP_CONTRACT } from "./contract/fixtures";
import { HISTORY_EXAMPLES } from "./local/fakeHistoryService";
import { handoffHttp } from "./local/fakeService";
import handoff from "./fixtures/phase2-handoff/SOURCE.json";
import { REPO_ROOT } from "./fixtures/sources";

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const backendMap = JSON.parse(readFileSync(join(REPO_ROOT, "service/docs/phase3a/id-addressability-remediation-03/evidence/source-identities.json"), "utf8")) as {
  files: Record<string, string>;
};

describe("captured fixtures are the accepted bytes", () => {
  it.each([
    ["contracts/openapi-v1-proposed.yaml", CONTRACT],
    ["contracts/openapi-history-v1.yaml", HISTORY_CONTRACT],
    ["contracts/openapi-id-addressability-v1.yaml", LOOKUP_CONTRACT],
    ["contracts/history-examples.json", HISTORY_EXAMPLES],
  ])("%s matches the accepted backend source map", (mapped, path) => {
    expect(backendMap.files[mapped]).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(path)).toBe(backendMap.files[mapped]);
  });

  it("the Phase 2 handoff bodies are exactly the manifest's files, each with its recorded SHA-256", () => {
    const dir = handoffHttp();
    // SOURCE.json selection: every response body — the accepted original also holds receipts and index.json.
    const names = readdirSync(dir).filter((n) => n.endsWith(".json") && !n.endsWith(".receipt.json") && n !== "index.json").sort();
    expect(names).toEqual(Object.keys(handoff.files).sort());
    expect(names).toHaveLength(50);
    for (const n of names) expect(sha256(join(dir, n)), n).toBe(handoff.files[n as keyof typeof handoff.files].sha256);
  });
});
