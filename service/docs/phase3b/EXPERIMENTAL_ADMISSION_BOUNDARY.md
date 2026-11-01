# Experimental admission boundary

This workspace has no implemented trusted capture or independent receipt issuer.
`execution_context` and `evidence_receipt` are caller-supplied metadata, not
evidence that capture took place. Matching their fields (`run_id`,
`execution_cwd_sha256`, `source_basis_sha256`, `rule_basis_sha256`) cannot
establish source or destination capture, receipt authenticity, completeness, or
freshness. In particular, `run_id` (`run.identity.id`, e.g. `SPEC-001`–`SPEC-005`)
is a reused verification case ID and is not a unique per-execution identity.

The experimental checks in `evaluate_admission` report specific failures where
they can identify them (`CAPTURE_STALE_REJECTED` / `REJECTED_STALE_RECEIPT`,
`CAPTURE_INCOMPLETE` / `REJECTED_BINDING_MISMATCH`, `CAPTURE_SUBPROCESS_FAILED` /
`REJECTED_INCOMPLETE_EXECUTION`), and otherwise fail closed to
`CAPTURE_INCOMPLETE` / `REJECTED_INCOMPLETE_EXECUTION`. They never return
`CAPTURED_COMPLETE` or `ADMITTED_RUN_BOUND`; `validate_candidate` and
`ArchiveStore.publish` refuse publication of any candidate carrying this
experimental metadata (`HTTP 409`, code equal to the lowercase admission status).
Existing Phase 3A archives without these fields remain `CAPTURE_NOT_IMPLEMENTED`
/ `ADMISSION_NOT_IMPLEMENTED`, stay readable, and keep their original semantics.

Enabling admission requires an independently reviewed capture and receipt
protocol, including an independently supplied unique execution/session identity,
binding to the actual evidence and trusted issuer, complete admission checks,
and replay/negative-control testing against the applicable Phase 3B plans. A
new ID, a self-reported hash, or a passing consistency check alone is not proof
of capture or external authenticity. This file neither authorizes acquisition
nor changes the frozen Phase 1–3A contracts.

> Note (2026-10-31): Phase 3B admission is active in the current code and supersedes the statements above that it is never returned: with a collector receipt authenticated by the archive's signing key, `evaluate_admission` returns `CAPTURED_COMPLETE` / `ADMITTED_RUN_BOUND` and publication accepts it. This is a local, synthetic run binding; it does not establish external authenticity.
