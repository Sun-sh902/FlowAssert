> Reconciliation update (2026-10-17): **REMEDIATION REQUIRED**. Historical UI changes were reconciled, but a fresh pre-baseline stability gate detected two new generated-file changes. No valid new baseline or acceptance rerun was completed. See `INTEGRITY_RECONCILIATION_REPORT.md`. The original report below is preserved verbatim.

# Phase 1 implementation report

Date: 2026-10-17 America/New_York. Recommendation: **REMEDIATION REQUIRED**.

The implementation candidate is functional locally, but the required protected-tree integrity acceptance failed. Stage H is not passed. No Phase 1 independent acceptance, production readiness, or Phase 2 authorization is claimed. No new implementation proceeded after discovering that failure; remaining writes document the observed state and blocker.

## A–D. Environment, preflight, contract and implementation identities

The service directory existed and was empty before work. All writes and installations were confined to `/Users/zhangshenghe/Documents/FlowAssert-Service`. No worktree, branch change, staging, commit, merge or push was performed. Python is 3.14.7; FastAPI 0.143.3, Pydantic 2.14.1, uvicorn 0.54.0. Full dependency identity: `requirements.lock`.

All 17 planning documents matched the actual final-audit snapshot hashes before implementation. The contract version is `0.1.1-proposed`. Bundle SHA-256: `719d2df7e4f182efaf55a8009ffa1b5608dcff261a910b87cb20527d0e60c647`.

| Contract | SHA-256 |
| --- | --- |
| OpenAPI | `0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230` |
| Verification examples | `92ea5a883acf903e90543552eec279b1a32ab42403eee37384ca6c1ab6f7b20b` |
| Frontend provider | `aa275b2c7f4a04b52f04d30a8e7a8f181614a161a57873317c30946a4865312a` |

All architecture hashes are recorded in `evidence/preflight.json`. Authority: `FlowAssert-Integration-Final-Audit/evidence/contract-snapshot.json`, `FINAL_PHASE0_ACCEPTANCE_AUDIT.md`, and `round-02/FINAL_PHASE0_ACCEPTANCE_AUDIT.md` / `CONTRACT_FREEZE_CANDIDATE.md`. The Owner's current request supplies bounded implementation authorization; the audit itself is not an approval record.

Evaluator: research HEAD `4deddb323ad0f1f00b2c369a7b141dc04c95f8fa`, branch `fix/round03-5-review-fixes`, dirty research workspace retained. `experiments/round03/model.py` SHA-256 `b61779e198dd0213b67f8319b77a2daf9feb502dc553784df6d6600e8e3a842d`. Only standard-library imports are needed by this evaluator. Source bytes are verified before compilation and invocation, and checked again afterward. Compilation executes the checked bytes without writing protected bytecode. No Oracle or research runner is in the serving path.

Frontend HEAD `e529077d474f364e834c28dd29f728c823bd4d6e`, main. Unlike the old audit's clean frontend, it was already dirty at this run's start. Full initial and final file and Git observations are preserved. Further concurrent changes were observed; origin was not independently authenticated.

Exact implementation inventory and file hashes: `IMPLEMENTATION_INVENTORY.json`. Main modules: `app/identity.py`, `adapter.py`, `validation.py`, `service.py`, generated `models.py`, `main.py`; launcher `run.py`; five fixtures; frozen contract copies; tests and three verification utilities plus type generator. No later-phase infrastructure was scaffolded.

## E–G. Evaluator and endpoint evidence

| Run | Row states | Cohort | Detail / Evidence real HTTP |
| --- | --- | --- | --- |
| SPEC-001 | Verified | Verified | 200 / 200 |
| SPEC-002 | Mismatch | Mismatch | 200 / 200 |
| SPEC-003 | Pending | Pending | 200 / 200 |
| SPEC-004 | Unverified | Unverified | 200 / 200 |
| SPEC-005 | 12 Verified | Unverified | 200 / 200 |

Raw results, every ordered row and rule, cohort, count and population value equal the independently authored reviewed examples. Results come from actual evaluator calls; the approved response templates supply reviewed context, while their result is replaced with actual output and compared before publication. The service does not provide a general importer. Startup evaluates once per fixture; repeated GETs do not evaluate again. Original input objects remain unchanged.

`evidence/http/receipt.json` records the actual child PID, argv, cwd and responses. `evidence/http/*-detail.json` and `*-evidence.json` retain actual payloads. UTC execution instants around 2026-10-18 00:57:50Z correspond to 2026-10-17 20:57:50 EDT. Synthetic display times retain their original explicit mapping. The process was terminated after verification (recorded exit -15); this is probe shutdown, not a failed test command.

The catalogue stores serialized immutable bundles with integrity seals. Snapshot identity binds published context/result/evidence membership. Each GET checks source identity and stored bytes, then runtime bindings; corrupt content returns 503. Input/source/policy/reference hashes are verified. Evidence pagination preserves exact reference order and validates HMAC-bound cursors. Unknown population remains null, never zero.

## H–J. Runtime validation, conformance and automated tests

All seven schema-permitted F004 negatives exercise the real validator and the real FastAPI request path. Each is rejected as an operational 503 when encountered in a stored response: unmapped/nonnull parameters; affine/null parameters; present/null field; missing/invented field; product-use/no approval; unknown population/zero total; unavailable evidence/nonnull payload. Additional product-use/invented approval reference is also rejected. This prototype permits only research_only, not any product-use approval.

Static OpenAPI 3.1 validation passed for both the frozen original specification and the two-route advertised specification. Actual success/error responses were checked with Draft 2020-12 JSON Schema and format validation, plus strict generated Pydantic models on success routes. This is separate from semantic equality with the evaluator and from the F004 application checks.

Final suite: **51 passed, 1 failed**. Failed test: `test_protected_repository_integrity`. Earlier 40-test and 51-test runs are retained; they predate adding the full protected-tree acceptance check and do not supersede the final failure. Final runner exits 1 and retains argv/PID/cwd/exit/stdout/stderr/JUnit XML under `evidence/tests-*`. A Starlette/httpx deprecation warning is retained; it did not cause failure.

Tests cover source/version rejection, genuine adapter loading, all five result/rule comparisons, unknown population, null/invalid/unmapped time, input caps and safe integers, hashes, snapshot conflict/restart/immutability, reference ordering and payload omission, missing run, 400/404/409/422/500/503, schema required fields, synthetic labels, no permissive CORS, and protected integrity. HTTP status alone is never the success criterion. The actual loopback probe separately validates ten successful response bodies plus 400/404/409/422 response bodies.

## K–L. Local security and protected integrity

The supported launcher binds only `127.0.0.1:8765`. `evidence/http/listener.txt` captures the actual PID's listener. No writable HTTP endpoint, arbitrary evaluator path, filesystem fetch, credentials, live connector, authentication system or permissive CORS exists. Dependency installation was into the isolated venv; no HubSpot/n8n or real customer data was accessed. This is local security verification, not a comprehensive security audit.

Research, Planning, Initial Review, Reassessment, and Final Audit trees have zero observed file/Git differences. **Frontend is changed**, including `src/styles/atelier.css`, e2e sources, frontend readiness documents, build outputs and browser evidence. `evidence/protected-before.json`, `protected-after.json`, and `protected-comparison.json` preserve exact inventories. No backend tool command wrote to that directory. Concurrent external work is consistent with the user's stated frontend ownership, but attribution is unverified. No reset, repair, rollback or silent rebaseline was attempted.

Integrity observation covers file bytes (including ignored/generated files and in-tree Git files), file symlink targets, HEAD, branch and porcelain state. It does not prove absence of transient write-and-restore, directory metadata preservation, or external linked Git administration byte identity. Therefore the report does not overclaim whole-machine non-mutation.

## M–P. Handoff, limits, next gate, final state

`README.md` records the interface, exact IDs, actual response locations, snapshot/errors/provenance and startup/shutdown information. It is an information-only draft; formal readiness is withheld because Stage H failed. No instruction or message was sent to Claude, and no frontend integration was performed.

Limitations: supplied-evidence consistency does not authenticate external acquisition. Internally consistent fabricated evidence can still pass the research evaluator. Hashes, rule agreement and local HTTP cannot prove business truth, workflow execution, causality, completeness of external acquisition, or release approval. Research version remains unapproved for product use. Five synthetic fixtures and memory-only state are the entire service scope; no durability, live provider or production readiness is claimed. Browser-to-service rendering was not tested. Independent review remains outstanding.

Smallest next correction: review and attribute the observed frontend changes with its owner and explicitly agree a stable protected-tree baseline or an approved concurrency-aware integrity criterion, then rerun the affected acceptance checks. Preserve the original baseline/failure. Do not revert frontend work or waive/relabel this failure silently. Backend application tests do not currently require a verdict-engine change.

Phase 2 requires Phase 1 independent acceptance and separate Owner authorization. This report grants neither. The service directory is not a Git repository; no repository was initialized and no Git mutation was performed. All new deliverables remain in FlowAssert-Service. The probe listener was shut down. Stop after this local verification and blocker report.
