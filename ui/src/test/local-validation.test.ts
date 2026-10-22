/**
 * Phase 2 runtime admission: the frozen-schema validator and the F004 cross-field checks.
 * Inputs are the real HTTP bodies captured by the Codex handoff (read-only); every mutation below is a
 * deliberate corruption that must be refused — never repaired into a successful verification.
 */
import { describe, expect, it } from "vitest";
import { ACCEPTED_EVALUATOR } from "../data/local/config";
import { canonicalJson, checkPayloadDigest } from "../data/local/canonical";
import { decodeErrorEnvelope, decodeEvidencePage, decodeVerificationRun } from "../data/local/decode";
import { SCHEMA_SOURCE, validateSchema } from "../data/local/schema";
import { CASE_IDS, captured, handoffPresent } from "./local/fakeService";

describe("embedded frozen schemas", () => {
  it("are the 33 reachable schemas of the frozen 0.1.1-proposed contract, by digest", () => {
    expect(SCHEMA_SOURCE.count).toBe(33);
    expect(SCHEMA_SOURCE.contractVersion).toBe("0.1.1-proposed");
    expect(SCHEMA_SOURCE.sha256).toBe("0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230");
  });

  it("refuses a schema name outside the authorized slice", () => {
    expect(validateSchema("Overview", {})).toHaveLength(1);
  });
});

describe.skipIf(!handoffPresent)("schema validation of real captured responses", () => {
  for (const id of CASE_IDS) {
    it(`${id}: Detail, full evidence and every limit=1 page validate`, () => {
      expect(validateSchema("VerificationRun", captured(`${id}-detail`))).toEqual([]);
      expect(validateSchema("EvidencePage", captured(`${id}-evidence`))).toEqual([]);
      for (const n of [1, 2, 3, 4]) expect(validateSchema("EvidencePage", captured(`${id}-page-${n}`))).toEqual([]);
    });
  }

  it("validates every captured error envelope", () => {
    for (const n of ["invalid-id", "invalid-cursor", "unavailable-snapshot", "cursor-query-conflict", "cursor-snapshot-conflict", "invalid-limit", "unknown-query", "duplicate-query", "restart-old-cursor", "service-unavailable-detail", "service-unavailable-evidence"])
      expect(decodeErrorEnvelope(captured(n)), n).not.toBeNull();
    expect(decodeErrorEnvelope(captured("connection-refused"))).toBeNull(); // an OS error record, not an envelope
  });

  const mutate = (fn: (d: any) => void) => {
    const d = captured("SPEC-004-detail");
    fn(d);
    return validateSchema("VerificationRun", d);
  };

  it("accepts the contract's nulls where they are allowed", () => {
    expect(mutate((d) => (d.workflow.n8n_label = null))).toEqual([]);
    expect(mutate((d) => (d.workflow.n8n_label = ""))).toEqual([]);
    expect(mutate((d) => (d.result.expected_total = null))).toEqual([]);
    expect(mutate((d) => (d.retry_context.window_open_at_evaluation = null))).toEqual([]);
    expect(mutate((d) => (d.evaluation_context.event_times.deadline = null))).toEqual([]);
    expect(mutate((d) => (d.result.records[0].key = { malformed: true }))).toEqual([]); // RawJSON
  });

  it("refuses a missing required key, even one whose value may be null", () => {
    expect(mutate((d) => delete d.workflow.n8n_label)[0]!.message).toMatch(/missing required key "n8n_label"/);
    expect(mutate((d) => delete d.result.expected_total)).not.toEqual([]);
    expect(mutate((d) => delete d.snapshot_id)).not.toEqual([]);
  });

  it("refuses null where the contract forbids it, wrong types, unknown enums and extra keys", () => {
    expect(mutate((d) => (d.result.cohort_state = null))).not.toEqual([]);
    expect(mutate((d) => (d.result.cohort_state = "Passed"))).not.toEqual([]);
    expect(mutate((d) => (d.result.records[0].state = "verified"))).not.toEqual([]);
    expect(mutate((d) => (d.result.records[0].rules.phone.status = "ok"))).not.toEqual([]);
    expect(mutate((d) => (d.result.records[0].rules.email = { status: "pass", reason: "x" }))).not.toEqual([]); // no email rule
    expect(mutate((d) => (d.result.counts.Verified = "1"))).not.toEqual([]);
    expect(mutate((d) => (d.result.counts.Verified = -1))).not.toEqual([]);
    expect(mutate((d) => (d.meta.provider_mode = "MOCK"))).not.toEqual([]);
    expect(mutate((d) => (d.meta.contract_version = "0.2.0"))).not.toEqual([]);
    expect(mutate((d) => (d.extra = true))).not.toEqual([]);
    expect(mutate((d) => (d.result.source_basis_sha256 = "ABC"))).not.toEqual([]);
    expect(mutate((d) => (d.identity.created_at = "yesterday"))).not.toEqual([]);
    expect(mutate((d) => (d.retry_context.automatic_retry_enabled = true))).not.toEqual([]);
    expect(mutate((d) => (d.evidence_references = []))).not.toEqual([]);
  });

  it("allows an absent optional RuleResult.expected/actual but refuses a non-string one", () => {
    expect(mutate((d) => delete d.result.records[0].rules.phone.expected)).toEqual([]);
    expect(mutate((d) => (d.result.records[0].rules.phone.expected = null))).not.toEqual([]);
  });
});

describe.skipIf(!handoffPresent)("F004 admission of a Detail", () => {
  const decode = (fn: (d: any) => void = () => {}, id = "SPEC-005") => {
    const d = captured(`${id}-detail`);
    fn(d);
    return decodeVerificationRun(d, { id });
  };
  const code = (r: ReturnType<typeof decode>) => (r.ok ? "ok" : r.code);

  it("admits all five captured Details unchanged", () => {
    for (const id of CASE_IDS) expect(code(decode(() => {}, id)), id).toBe("ok");
  });

  it("refuses scope, identity and evaluator contradictions", () => {
    expect(code(decode((d) => (d.meta.provider_mode = "LIVE")))).toBe("scope_conflict");
    expect(code(decode((d) => (d.meta.workspace_id = "ws-other")))).toBe("scope_conflict");
    expect(code(decode((d) => (d.meta.synthetic = false)))).toBe("scope_conflict");
    expect(code(decode((d) => (d.identity.id = "SPEC-001")))).toBe("identity_conflict");
    expect(code(decode((d) => (d.evaluation_context.evaluator.model_sha256 = "0".repeat(64))))).toBe("evaluator_identity_conflict");
    expect(code(decode((d) => (d.evaluation_context.evaluator.workspace_dirty = false)))).toBe("evaluator_identity_conflict");
    const pinned = captured("SPEC-005-detail");
    expect(decodeVerificationRun(pinned, { id: "SPEC-005", snapshotId: "snapshot-other" })).toMatchObject({ ok: false, code: "snapshot_conflict" });
  });

  it("refuses counts that disagree with the records instead of recounting them", () => {
    expect(code(decode((d) => (d.result.counts = { Verified: 11, Mismatch: 1, Pending: 0, Unverified: 0 })))).toBe("counts_conflict");
    expect(code(decode((d) => (d.result.records[3].state = "Mismatch")))).toBe("counts_conflict");
  });

  it("refuses reordered, missing or re-keyed rows", () => {
    expect(code(decode((d) => d.result.records.reverse()))).toBe("row_inventory_conflict");
    expect(code(decode((d) => (d.result.source_rows_observed = 13)))).toBe("row_inventory_conflict");
    expect(code(decode((d) => (d.source_snapshot.rows[2].key = "SYN-999")))).toBe("row_inventory_conflict");
    expect(code(decode((d) => (d.source_snapshot.rows[0].phone = { state: "missing", value: "+1" })))).toBe("row_inventory_conflict");
  });

  it("refuses an invented total for an unknown population", () => {
    expect(code(decode((d) => (d.result.expected_total = 12)))).toBe("population_conflict");
  });

  it("refuses reference contradictions", () => {
    expect(code(decode((d) => (d.evidence_references[1].id = d.evidence_references[0].id)))).toBe("reference_conflict");
    expect(code(decode((d) => (d.evaluation_context.input_evidence_sha256 = "a".repeat(64))))).toBe("reference_conflict");
    expect(code(decode((d) => (d.source_snapshot.evidence_reference_id = "SPEC-005-policy")))).toBe("reference_conflict");
    expect(code(decode((d) => (d.evidence_references[0].external_authenticity = "not_assessed")))).toBe("reference_conflict");
  });

  it("refuses event times that contradict their ticks, and missing time diagnostics", () => {
    expect(code(decode((d) => (d.evaluation_context.event_times.observed_at = "2026-10-16T14:00:00Z")))).toBe("time_mapping_conflict");
    expect(code(decode((d) => (d.evaluation_context.event_times.deadline = null)))).toBe("time_mapping_conflict");
    expect(code(decode((d) => (d.diagnostics = []), "SPEC-004"))).toBe("time_mapping_conflict"); // observed_at is null → missing_time_tick required
    expect(code(decode((d) => (d.evaluation_context.event_times.observed_at = "2026-10-16T14:05:00Z"), "SPEC-004"))).toBe("time_mapping_conflict"); // no zero/receipt substitute
  });

  it("refuses retry and assurance claims the evaluator did not make", () => {
    expect(code(decode((d) => (d.retry_context.pending_source_rows = []), "SPEC-003"))).toBe("retry_conflict");
    expect(code(decode((d) => (d.retry_context.policy_retry_viable = false)))).toBe("retry_conflict");
    expect(code(decode((d) => (d.assurance.research_authorization = "approved_for_product_use")))).toBe("assurance_conflict");
    expect(code(decode((d) => (d.assurance.release_approval_reference = "REL-1")))).toBe("assurance_conflict");
  });

  it("never edits the body it admits", () => {
    const d = captured("SPEC-005-detail");
    const before = JSON.stringify(d);
    const r = decodeVerificationRun(d, { id: "SPEC-005" });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(d)).toBe(before);
  });

  it("pins the accepted evaluator identity from the handoff", () => {
    expect(captured("SPEC-001-detail").evaluation_context.evaluator).toEqual(ACCEPTED_EVALUATOR);
  });
});

describe.skipIf(!handoffPresent)("F004 admission of an evidence page", () => {
  const page = (name = "SPEC-001-page-1") => captured(name);
  const req = (p: any, over: Partial<{ includePayload: boolean; limit: number; snapshotId: string }> = {}) =>
    decodeEvidencePage(p, { id: p.run_id, snapshotId: p.page.snapshot_id, includePayload: true, limit: 1, ...over });

  it("admits every captured page for its own request", () => {
    for (const id of CASE_IDS) for (const n of [1, 2, 3, 4]) expect(req(page(`${id}-page-${n}`)).ok).toBe(true);
    const omitted = captured("payload-omitted");
    expect(decodeEvidencePage(omitted, { id: "SPEC-004", snapshotId: omitted.page.snapshot_id, includePayload: false, limit: 25 }).ok).toBe(true);
  });

  it("refuses a page from another snapshot, run or scope", () => {
    expect(req(page(), { snapshotId: "snapshot-other" })).toMatchObject({ ok: false, code: "snapshot_conflict" });
    const p = page();
    p.run_id = "SPEC-002";
    expect(decodeEvidencePage(p, { id: "SPEC-001", snapshotId: p.page.snapshot_id, includePayload: true, limit: 1 })).toMatchObject({ ok: false, code: "identity_conflict" });
    const q = page();
    q.meta.provider_mode = "LIVE";
    expect(req(q)).toMatchObject({ ok: false, code: "scope_conflict" });
  });

  it("refuses more items than requested and payload bindings that contradict the request", () => {
    expect(req(captured("SPEC-001-evidence"), { limit: 2 })).toMatchObject({ ok: false, code: "page_conflict" });
    expect(req(page(), { includePayload: false })).toMatchObject({ ok: false, code: "payload_binding_conflict" });
    const p = page();
    p.items[0].payload = null;
    expect(req(p)).toMatchObject({ ok: false, code: "payload_binding_conflict" });
  });
});

describe("canonical digest (python-json-sortkeys-ascii-v1)", () => {
  it("matches Python's escaping and key order", () => {
    // Python: json.dumps({"b":"é\x7f😀\n\x01","a":[1,None,True]}, sort_keys=True, separators=(",",":"), ensure_ascii=True)
    expect(canonicalJson({ b: "é\u007f😀\n\u0001", a: [1, null, true] })).toBe('{"a":[1,null,true],"b":"\\u00e9\\u007f\\ud83d\\ude00\\n\\u0001"}');
  });

  it("declines values it cannot reproduce exactly instead of guessing", async () => {
    expect(canonicalJson({ x: 1.5 })).toBeNull();
    expect(await checkPayloadDigest({ x: 1.5 }, "a".repeat(64))).toBe("not_checkable");
    expect(await checkPayloadDigest({ x: 1 }, null)).toBe("not_checkable");
  });

  it.skipIf(!handoffPresent)("reproduces the reference SHA-256 of every captured payload", async () => {
    for (const id of CASE_IDS)
      for (const item of captured(`${id}-evidence`).items) expect(await checkPayloadDigest(item.payload, item.reference.sha256), item.reference.id).toBe("reproduced");
  });

  it.skipIf(!handoffPresent)("reports a changed payload as not reproduced", async () => {
    const item = captured("SPEC-002-evidence").items[1];
    item.payload.access = "denied";
    expect(await checkPayloadDigest(item.payload, item.reference.sha256)).toBe("mismatch");
  });
});
