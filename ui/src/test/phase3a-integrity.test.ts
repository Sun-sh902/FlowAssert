/**
 * Phase 3A · P2-AUD-001: retrieval and integrity are separate, and nothing but a supported successful
 * comparison is ever "verified" (src/domain/integrity.ts).
 */
import { describe, expect, it } from "vitest";
import type { EvidenceReferenceView } from "../domain/evidence";
import { assessItem, summarizeIntegrity } from "../domain/integrity";

const ref = (over: Partial<EvidenceReferenceView> = {}): EvidenceReferenceView => ({
  id: "R",
  role: "source",
  availability: "available",
  reason: null,
  sha256: "a".repeat(64),
  acquisitionKind: "synthetic_local",
  externalAuthenticity: "not_authenticated",
  payload: { state: "loaded", value: {}, digest: "reproduced" },
  ...over,
});
const svc = (status: "INTEGRITY_VERIFIED" | "INTEGRITY_FAILED" | "INTEGRITY_UNVERIFIABLE") => ({ serviceIntegrity: { status, checkedSha256: status === "INTEGRITY_VERIFIED" ? "a".repeat(64) : null, scope: "evidence_canonical_bytes" as const } });

describe("one item", () => {
  it("archive: verified only when the Service verified AND this browser reproduced the digest", () => {
    expect(assessItem(ref(svc("INTEGRITY_VERIFIED"))).state).toBe("verified");
  });
  it("a browser mismatch is a failure even when the Service said verified", () => {
    const a = assessItem(ref({ ...svc("INTEGRITY_VERIFIED"), payload: { state: "loaded", value: {}, digest: "mismatch" } }));
    expect(a).toMatchObject({ state: "failed", service: "INTEGRITY_VERIFIED", browser: "mismatch" });
  });
  it("a Service INTEGRITY_FAILED is a failure", () => expect(assessItem(ref(svc("INTEGRITY_FAILED"))).state).toBe("failed"));
  it("not checkable in this browser is unverifiable, never verified", () => {
    expect(assessItem(ref({ ...svc("INTEGRITY_VERIFIED"), payload: { state: "loaded", value: {}, digest: "not_checkable" } })).state).toBe("unverifiable");
    expect(assessItem(ref({ ...svc("INTEGRITY_VERIFIED"), payload: { state: "loaded", value: {} } })).state).toBe("unverifiable");
  });
  it("payload omitted by request is unverifiable here, though the Service checked it", () => {
    expect(assessItem(ref({ ...svc("INTEGRITY_VERIFIED"), payload: { state: "omitted", reason: "omitted_by_request" } }))).toMatchObject({ state: "unverifiable", browser: "omitted" });
  });
  it("a reference not available at evaluation is unverifiable, not a mismatch", () => {
    expect(assessItem(ref({ ...svc("INTEGRITY_UNVERIFIABLE"), availability: "unavailable", sha256: null, payload: { state: "unavailable", reason: "denied" } })).state).toBe("unverifiable");
  });
  it("Service unverifiable with a reproduced payload is still not verified", () => expect(assessItem(ref(svc("INTEGRITY_UNVERIFIABLE"))).state).toBe("unverifiable"));
  it("not read yet is pending", () => expect(assessItem(ref({ ...svc("INTEGRITY_VERIFIED"), payload: { state: "not_loaded" } })).state).toBe("pending"));
  it("ephemeral (no Service statement): reproduced in this browser is the only positive", () => {
    expect(assessItem(ref()).state).toBe("verified");
    expect(assessItem(ref({ payload: { state: "loaded", value: {}, digest: "mismatch" } })).state).toBe("failed");
  });
});

describe("the set", () => {
  const v = assessItem(ref(svc("INTEGRITY_VERIFIED")));
  const f = assessItem(ref({ ...svc("INTEGRITY_VERIFIED"), id: "BAD", payload: { state: "loaded", value: {}, digest: "mismatch" } }));
  const u = assessItem(ref({ ...svc("INTEGRITY_VERIFIED"), payload: { state: "omitted", reason: "omitted_by_request" } }));
  const p = assessItem(ref({ payload: { state: "not_loaded" } }));
  it("retrieving every page is not integrity: an incomplete or unchecked set is pending", () => {
    expect(summarizeIntegrity([v, v, p, p], false).state).toBe("pending");
    expect(summarizeIntegrity([v, v, v, v], false).state).toBe("pending");
  });
  it("all verified and retrieval complete → verified", () => expect(summarizeIntegrity([v, v, v, v], true)).toMatchObject({ state: "verified", verified: 4, total: 4 }));
  it("a failure wins immediately and names the reference", () => {
    const s = summarizeIntegrity([v, f, p, p], false);
    expect(s.state).toBe("failed");
    expect(s.failed.map((x) => x.id)).toEqual(["BAD"]);
  });
  it("any unverifiable item makes the complete set unverifiable", () => expect(summarizeIntegrity([v, v, v, u], true).state).toBe("unverifiable"));
  it("an empty set is never verified", () => expect(summarizeIntegrity([], true).state).toBe("unverifiable"));
});
