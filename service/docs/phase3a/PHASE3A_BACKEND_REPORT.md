# Phase 3A backend implementation report

**READY FOR PHASE 3A FRONTEND INTEGRATION**

This is a locally validated backend recommendation, not independent acceptance or Owner Acceptance. Phase3B, frontend implementation, live APIs and deployment were not started. Authorization came from the Owner's current specification and applied only to this isolated workspace.

Additive contract: `phase3a-1.0.0`, `contracts/openapi-history-v1.yaml`, SHA-256 `f341d8d5ec9da1b933b06efe998c07a1045226500a6b5837e9c8a9ead74bd69f`.
Schema version **1**; migration SHA-256 `b6a09e4f7e79f76f169beac713c9793349ff8012a27b04ddd90705e1b7158f2a`; actual sqlite_master signature SHA-256 `532cc799b791594006fae05ec53cbe6610088ac9676c31184d0e66701a395801`.
Source snapshot SHA-256 `2249569fa3a97fa3ab44aa0ba2088e5fc7ffd264cc8c824d062ae270d7ba6a65` (`SOURCE_MANIFEST.json`); executed implementation SHA-256 `fcf0d1ecda2e5cba67e9298ad8ac8a0bb05ee91833cc45e85ac7fa22ec9ed2fa`; reviewed source-set identity `f042f02d7185371a02af18b9d61d3bc7d357910e38ca2bb4824239862bebdd84`.

Implemented: local SQLite immutable verification/evidence history; atomic controlled evaluator-backed CLI seed/re-evaluation; persistent historical snapshots; three additive GETs; signed stable history/evidence pagination across restart; exact Python-byte evidence integrity; schema/relationship validation; safe local filesystem/runtime handling; machine OpenAPI/examples; complete frontend handoff. Existing accepted business endpoints retain their original code/shape/restart behavior (only local evaluator path relocated).

Current validation: **183 pytest passed /0 failed /0 skipped /0 errors**, including **88/88 original Phase1/2 regression tests** and 95 new history tests. **204 real HTTP/process assertions**,45 captures,37 validated contract examples,0 example failures. Exact command receipts bind argv/PID/cwd/exits/streams. Real server restart proves old cursor409 alongside historical cursor200. Genuine mid-transaction child exit73 and retry are tested. One dependency deprecation warning remains. No frontend test claim is made.

The delivery database has10 immutable evaluations: five reviewed cases initially archived, followed by five explicit actual reevaluations for pagination/restart tests. Default seed safely reuses the original first five. All business results originate from pinned Python execution and direct replay, with independent fixed verdict expectations. SPEC005 preserves12 Verified records /Unverified cohort /unknown population.

| Case | First history ID | Cohort |
| --- | --- | --- |
| SPEC-001 | `hist_230c08845a2e81335c63d9f4876be867828d0bc0cf8b9cbda155782372c84f12` | Verified |
| SPEC-002 | `hist_51a4d6305b0e7b4b82dbe8b757ecf14060189fc47dd2e2f11e933d4613855425` | Mismatch |
| SPEC-003 | `hist_8c50b8a8a684c221be99f719292c660acad02d84a90a933991dcf3b39f125d1b` | Pending |
| SPEC-004 | `hist_da374150e1a47d18302f6a56a3eaf1001f185155505c6bf761183459180dfc09` | Unverified |
| SPEC-005 | `hist_22ad2174cef10586aedf65dd5d734cc009af28e16cd57df2c7170a5863213c61` | Unverified (12 Verified rows; unknown population) |

## Required backend matrix (current local evidence)

| ID | Requirement | Evidence |
| --- | --- | --- |
| A01 | Accepted baseline identity | test_A01_A33_baseline; baseline-source.json |
| A02 | Original API compatibility | 88 unchanged original tests; test_A02_old_and_composed_app_same_catalog_shape; real HTTP |
| A03–A06 | Five evaluator results / rows / cohort / SPEC005 | test_A03_A06_direct_evaluator_archive ×5; direct-evaluator-comparisons.json |
| A07 | Transaction atomicity | test_A07_A26_transaction_exception_and_crash, three fault points |
| A08 | SQLite restart persistence | real process A→B; all first five Detail bodies byte-equivalent as JSON |
| A09–A10 | Uniqueness and idempotency | test_A09_A10_A15_idempotency_and_new_evaluation; guarded CLI repeats |
| A11–A12 | Changed evidence/evaluator identity | test_A11_A12_changed_inputs_documented_conflict ×3;409 admission conflict |
| A13–A16 | Record/reference/snapshot/evidence order | test_A13_A16_ordered_evidence ×10; original snapshot digest/membership; HTTP continuation |
| A17 | Concurrent insert pagination | test_A17_new_inserts_during_list_pagination; real HTTP CLI insert between pages |
| A18 | Invalid history IDs | test_A18_invalid_ids ×10; actual encoded-dot request |
| A19–A21 | Tampering/cross-history/cross-query | test_A19_A21_cursor_bindings ×8; cross_filter; strict_cursor; real HTTP |
| A22 | Missing evidence | test_deleted_reference_stops_publication_and_read; missing payload mutation; no fabricated unavailable source |
| A23–A25 | Corrupt/digest/schema-invalid content | test_A14_A22_A25_mutations ×10; updated_outer_hash; real negative HTTP |
| A26 | Interrupted transaction | actual os._exit73, journal recovery, repeat seed |
| A27 | Reopen/migration | test_A27_reopen_migrations; test_migration_rollback |
| A28 | SQL constraints | test_A28_constraints_and_immutability; FK ON/UNIQUE/PK/nonnegative constraints in schema |
| A29–A30 | Malformed HTTP / structured errors | test_A29_A30_malformed_list ×8; methods_origins_snapshots; real statuses/captures |
| A31 | Old ephemeral restart409 | original cursor tests; actual A→B ephemeral-restart-409.json |
| A32 | No unauthorized outbound traffic | test-only guarded CLI/server socket audits;0 external attempts; no OS-wide monitoring claim |
| A33 | Evaluator unchanged | baseline test; vendor SHA equals original pinned model |
| A34 | Protected workspaces unchanged | eleven-root before/after/final hashes+metadata+Git comparison |

## Gate1/Gate2 self-review counterexamples

1. Same case/different evaluator: explicit unsupported identity conflict, no overwrite.
2. Crash after parent/before evidence: real exit73 rolls back and retry commits full five-case batch.
3. Cursor at foreign history:400 query conflict; no evidence disclosed.
4. Insert during listing: cursor high water excludes all newly inserted archives; existing order unchanged.
5. Correct digest/wrong snapshot: complete original snapshot digest/membership plus table binding refuse it.
6. Post-publication database mutation: guards reject supported writes; bypassed guards still encounter candidate/header/reference/schema checks, including sealed sequence.
7. Unknown population rewritten0: both original digest and rehashed-semantic mutation fail; no invented population.
8. Restart between evidence pages: historical200 at original persistent snapshot; old ephemeral409 remains.
9. Repeated CLI seed: same five IDs, evaluations=0; explicit reevaluation adds five distinct IDs.
10. Accidental old Detail extension: original app.main bytes unchanged; returned frozen shape contains no history fields; original88 tests pass.

Confirmed issues found during implementation were corrected within the isolated backend scope: SPEC004 diagnostic projection compared to actual accepted behavior; complete original snapshot membership was added; sequence was included in the header seal; SQL schema introspection now uses a literal underscore in the reserved sqlite_ prefix rather than a LIKE wildcard. No evaluator/frozen contract/accepted repository correction was needed. Earlier failures and pre-final results remain historical evidence; final assertions apply to final source only.

## Integrity, process and scope boundaries

11 protected workspaces:0 changed objects in before/after comparison; Git state/external administration unchanged. Final readback result is in evidence/protected-comparison-final.json. No source hardlinks, shared-worktree state, protected test execution, commits/merges/pushes or reset/clean actions. Keys/database stay isolated. Three final HTTP service processes are stopped; no8765 listener remains. Network-guard observations show0 unauthorized external connects for controlled entries.

Limits: only five reviewed synthetic source shapes; changed evaluator/evidence/contract imports are explicit conflicts. No external authenticity, acquisition proof, administrator-proof immutability, production multi-user/durability guarantee, rotation, general migration framework, cloud system, customer data or telemetry. Missing-at-evaluation unavailable archive HTTP success has no reviewed fixture and is NOT TESTED; pure uncertainty handling and unexpected missing required evidence are tested. Physical power-loss, large archive scale, OS-wide egress capture and frontend behavior are not verified. No missing evidence or verdict was fabricated to fill those gaps.

Frontend handoff: `docs/phase3a/FRONTEND_HANDOFF.md`. Mandatory documents and machine contract are present; actual examples and exact identities accompany them. Backend work stops after handoff. This is not Owner Acceptance.
