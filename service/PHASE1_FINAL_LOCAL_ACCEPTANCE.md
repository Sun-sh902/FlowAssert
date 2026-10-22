# Phase 1 final local acceptance

**READY FOR PHASE 1 INDEPENDENT REVIEW**

Date: 2026-10-17 America/New_York. Controlled execution: 2026-10-17T21:45:49.528301-04:00 through 2026-10-17T21:45:54.788254-04:00. This is implementation-owner local validation, not independent acceptance or production approval.

## A. Historical failure history

The original 51-pass/1-fail execution (exit 1) remains valid for its original window. Its integrity assertion detected 209 concurrent frontend differences. The first reconciliation classified those changes against authorized frontend work. A subsequent pre-baseline attempt stopped when Vitest cache and Playwright last-run state changed; it did not run a new acceptance suite. Original reports, snapshots, differences, assertions, logs and exit receipts are unchanged. The new execution uses a separately versioned baseline; it does not retrospectively make either earlier window clean.

## B. Claude closeout reconciliation

The final closeout manifest was verified against actual bytes and sizes: 21 modified tracked, 202 new untracked and 17 ignored evidence-log entries (240 total). For modified entries, HEAD hashes were also checked. The complete 10,089-file post-check manifest matches current content after canonicalizing only the documented symlink label from symlink: to link:. Targets were independently captured with lstat/readlink; no file content was normalized. Nine new closeout files explain the remaining paths, including six check logs. All eight externally listed hashes in closeout section 9 match; the report itself was separately hashed.

Closeout manifest SHA-256: `8c743e8af1088dc68cb11b98ec29e9a53f4ec93f57dafe649af490283c8df2a6`. Full-tree manifest SHA-256: `dc2b88f2cda957cc9a1e73b2e29f7bd70942585d6b4cee0eed5a6c22d045518b`. Machine-readable evidence: `evidence/acceptance-03/closeout-verification.json`.

The supplied UI logs record 132 unit tests and 74 Chrome/WebKit checks passing, with 24 capture-only skips; their hashes and recorded counts were inspected, not rerun by this backend task. Firefox remains NOT TESTED, and Safari.app itself and screen readers remain unverified. UI test quality/independent acceptance is not inferred. Existing source confirms unavailable LOCAL_RESEARCH/LIVE providers rather than actual HTTP integration; no new frontend integration was performed here.

Compared with the backend historical final snapshot, 37 regenerated artifacts and nine closeout additions precede this new baseline. Every delta is enumerated in integrity-summary.json with both identities and supported classification. The 37 bytes match the documented post-check manifest. No timestamp-only attribution is used; exact per-process authorship remains outside the evidence.

## C–E. New baseline, concurrency and two-layer observations

Legacy-compatible baseline: `evidence/acceptance-03/before-legacy.json`, SHA-256 `02c38380f7f4ff5211cbee3a2ead73ed7d08565fad39d936dcb969c4fbe8447d`. Supplementary baseline: `before-full.json`, SHA-256 `f7e9627a84ecf47215b01a44f9ed6e16ffcd2ace19ab83ae6df0bf4da3b56031`.

All six roots are recorded by absolute path. The full snapshot includes regular-file hashes/size/mode/mtime/uid/gid, directory metadata, symlink type/target/mode/mtime, Git branch/HEAD/status, staged index entries, ignored-file inventory, and complete per-repository and common Git administration trees, including index bytes. Access times are deliberately excluded because read-only inspection may update them. Filesystem traversal does not follow directory symlinks into unrelated trees. The original suite separately preserves its original file/symlink/Git comparisons.

No known frontend test/build writer was observed. Resident Claude hosts and an existing idle Vite server were recorded without termination; a resident process alone is not evidence of active work. The Owner freeze statement, closeout and consecutive stable snapshots support this window. This does not establish that no future writer can start.

Layer A: every protected source, test, configuration, lockfile, architecture document, audit artifact, manifest, ignored evidence log and relevant Git metadata stayed unchanged. Layer B: every observed filesystem object also stayed unchanged, including caches, build outputs and generated test artifacts. Zero differences means no generated-artifact exception was needed. No directory was excluded based on .gitignore. The closeout recommendation to broadly exclude generated paths was not adopted.

| Protected root | Original-suite file entries | Full filesystem objects | Window differences |
| --- | ---: | ---: | ---: |
| FlowAssert-round03-oracle-fix | 996 | 1207 | 0 |
| FlowAssert-UI | 10098 | 10930 | 0 |
| FlowAssert-Integration-Planning | 18 | 21 | 0 |
| FlowAssert-Integration-Review | 560 | 875 | 0 |
| FlowAssert-Integration-Reassessment | 42 | 44 | 0 |
| FlowAssert-Integration-Final-Audit | 182 | 189 | 0 |

Immediate post-suite, post-HTTP and report-closeout comparisons all reported zero differences. Full baseline and final snapshot hashes are equal. Equality covers the measured endpoints; it cannot prove no undetected transient write-and-restore.

## F–G. Commands and actual results

Existing `tests/test_service.py`, all fixed expectations, application code and pre-existing integrity implementation were unchanged. The first complete acceptance attempt in this window passed. No acceptance-harness correction or regression-test change was necessary. The supplemental observer and process runner are new service-owned evidence utilities, not replacements for acceptance tests.

Environment overrides: `PYTHONDONTWRITEBYTECODE=1`, `FLOWASSERT_INTEGRITY_BASELINE=/Users/zhangshenghe/Documents/FlowAssert-Service/evidence/acceptance-03/before-legacy.json`, `FLOWASSERT_EVIDENCE_DIR=/Users/zhangshenghe/Documents/FlowAssert-Service/evidence/acceptance-03`. Commands, cwd, PID, start/end UTC, baseline hashes, stdout/stderr and exit status are in each `*.command.json`.

- `suite`: `/Users/zhangshenghe/Documents/FlowAssert-Service/.venv/bin/python -B -m pytest -q -p no:cacheprovider --junitxml=/Users/zhangshenghe/Documents/FlowAssert-Service/evidence/acceptance-03/suite.xml` — exit 0.
- `post-suite-observation`: `/Users/zhangshenghe/Documents/FlowAssert-Service/.venv/bin/python -B /Users/zhangshenghe/Documents/FlowAssert-Service/evidence/acceptance-03/observe.py post-suite before` — exit 0.
- `http-probe`: `/Users/zhangshenghe/Documents/FlowAssert-Service/.venv/bin/python -B scripts/http_probe.py` — exit 0.
- `final-observation`: `/Users/zhangshenghe/Documents/FlowAssert-Service/.venv/bin/python -B /Users/zhangshenghe/Documents/FlowAssert-Service/evidence/acceptance-03/observe.py final before` — exit 0.

**52 passed, 0 failed, 0 errors.** One existing Starlette/httpx deprecation warning is preserved. `suite.xml` and `test-inventory.json` enumerate the test cases; `suite.stdout.log` retains pytest output. No frontend tests, build, dependency installation or cache cleaning was run.

Two preliminary observation-helper errors were resolved before acceptance: ps output contained non-UTF-8 bytes (decode with replacement for process display only); an untracked-manifest placeholder was incorrectly treated as a HEAD hash (restrict HEAD comparison to status M). The failed helper source is retained as verify_closeout-attempt1.py. Neither error changed a protected file, expected verdict, integrity assertion or acceptance result. These are not hidden backend-suite failures.

## H–K. Backend semantic, HTTP and runtime evidence

The actual pinned model was invoked for all five cases; adapter invocation and input immutability tests passed. Complete raw results, ordered record states, cohort states and rule outcomes match the pre-authored reviewed examples. Unknown population preserves null expected_total and twelve Verified rows with an Unverified cohort. Tests cover missing/invalid/unmapped ticks, synthetic display mapping, genuine service execution time, and synthetic/research_only labels.

| ID | Ordered row verdicts | Cohort | Actual loopback Detail/Evidence |
| --- | --- | --- | --- |
| SPEC-001 | Verified | Verified | 200 / 200 |
| SPEC-002 | Mismatch | Mismatch | 200 / 200 |
| SPEC-003 | Pending | Pending | 200 / 200 |
| SPEC-004 | Unverified | Unverified | 200 / 200 |
| SPEC-005 | 12 Verified | Unverified | 200 / 200 |

The real uvicorn child, PID 20779, bound only 127.0.0.1:8765 as captured by lsof in `http/listener.txt`. Actual response JSON, evaluator result hashes and execution instants are preserved in `http/`. The probe shut it down afterward; child exit -15 records intentional termination, while the probe command exited 0. No service is intentionally left running.

Static OpenAPI validation passed for the frozen specification and advertised two-route specification. Actual HTTP application responses passed Draft 2020-12 schema/format validation and typed success-response validation. These checks are distinct from raw evaluator equality and runtime semantic validation. HTTP errors 400/404/409/422/500/503 are tested; source-version and content corruption fail operationally instead of returning a business verdict. No permissive CORS or write endpoint was introduced.

All seven F004 controls passed through real runtime validation and the FastAPI application: unmapped affine parameters; affine null parameters; present/null field; missing/invented value; product-use without bound approval; unknown population/zero total; unavailable reference/non-null payload. Invalid stored envelopes return 503. Additional invented product approval is rejected. Fixed expectations were not regenerated.

Snapshot restart/conflict and immutable content, source/input/policy/reference digests, source/context/row/count integrity, exact evidence order, pagination cursor authentication and query binding, requested payload omission, denied-read receipt distinction, missing runs, input scope limits, and safe integers were tested. Real loopback probes validate ten success bodies plus four error bodies, not HTTP status alone.

## L–N. Research, UI, contracts and preservation

Research model SHA-256 `b61779e198dd0213b67f8319b77a2daf9feb502dc553784df6d6600e8e3a842d`; HEAD `4deddb323ad0f1f00b2c369a7b141dc04c95f8fa`; branch `fix/round03-5-review-fixes`. Existing dirty research state (11 modified, four untracked) was retained. The Oracle is not in the serving path.

UI HEAD `e529077d474f364e834c28dd29f728c823bd4d6e`, branch main. Its authorized dirty working tree, including all nine closeout additions, is the protected identity, not the older HEAD tree. Git branch/HEAD/status/index/admin content remained stable; staged diff remained empty.

All 17 Phase 0 planning/contract hashes match the accepted audit snapshot. Contract version remains 0.1.1-proposed. OpenAPI: `0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230`; examples: `92ea5a883acf903e90543552eec279b1a32ab42403eee37384ca6c1ab6f7b20b`; provider: `aa275b2c7f4a04b52f04d30a8e7a8f181614a161a57873317c30946a4865312a`. Architecture and independent-audit file identities are fully covered by the baseline and integrity-summary.json.

All 77 pre-existing service files selected by the historical lock remained byte-identical, including reports, old failures and old HTTP evidence. Venv files and bytecode were excluded from this service-history lock, not from any protected-tree comparison.

## O–R. Limits, independent review, final status and inventory

IMPLEMENTED: the existing bounded offline service. TESTED LOCALLY: this 52-test suite, real loopback HTTP and complete protected-tree equality. INDEPENDENTLY REVIEWED: prior Phase 0 contract snapshot only; this Phase 1 candidate still needs an independent reviewer. NOT YET VERIFIED: production operation, live acquisition authenticity, browser/backend integration, durability and external business truth.

The supplied-evidence forgery limitation remains: internally consistent fabricated inputs can pass the research model. SHA-256 consistency and local tests do not authenticate acquisition, workflow execution, causality, external completeness or production authorization. Research authorization remains research_only.

An independent Phase 1 reviewer can now inspect the unchanged candidate, pinned sources/contracts, fixed expectations, full snapshots and new process receipts. Phase 2 requires separate Owner authorization after independent acceptance. No approvals were fabricated. No live credentials or production connections were used.

Service is not a Git repository (`rev-parse` exit 128). No repository was initialized, no protected Git metadata was intentionally changed, and no stage/commit/merge/push/reset/clean occurred. Existing PHASE1_REPORT.md, INTEGRITY_RECONCILIATION_REPORT.md and README.md were not rewritten. New files only: this report and `evidence/acceptance-03/**`; exact paths and hashes are in `evidence/acceptance-03/service-changes.json` (self excluded to avoid a recursive hash).

**READY FOR PHASE 1 INDEPENDENT REVIEW**
