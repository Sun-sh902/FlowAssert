# Phase 3A additive API contract — implemented, locally validated

Additive contract: `phase3a-1.0.0`, `contracts/openapi-history-v1.yaml`, SHA-256 `f341d8d5ec9da1b933b06efe998c07a1045226500a6b5837e9c8a9ead74bd69f`.
Schema version **1**; migration SHA-256 `b6a09e4f7e79f76f169beac713c9793349ff8012a27b04ddd90705e1b7158f2a`; actual sqlite_master signature SHA-256 `532cc799b791594006fae05ec53cbe6610088ac9676c31184d0e66701a395801`.
Source snapshot SHA-256 `2249569fa3a97fa3ab44aa0ba2088e5fc7ffd264cc8c824d062ae270d7ba6a65` (`SOURCE_MANIFEST.json`); executed implementation SHA-256 `fcf0d1ecda2e5cba67e9298ad8ac8a0bb05ee91833cc45e85ac7fa22ec9ed2fa`; reviewed source-set identity `f042f02d7185371a02af18b9d61d3bc7d357910e38ca2bb4824239862bebdd84`.

The filename was required by the task; these three additive operations are implemented and tested locally. This is not Owner Acceptance. Frozen `contracts/openapi-v1-proposed.yaml` remains `0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230`. Its response shapes and `/openapi.json` remain unchanged; `/history-openapi.json` advertises the separate extension. No route conflicts with the accepted two-operation slice or frozen proposed five-path document.

| Method/path | Parameters | Success |
| --- | --- | --- |
| GET /api/v1/history | limit 1–100/default25; opaque cursor ≤2048; optional verification_id SPEC-001…005 | HistoryList, descending archive sequence, pinned high-water list snapshot |
| GET /api/v1/history/{history_id} | history_id `hist_` +64 lowercase hex; optional snapshot_id ≤128 | HistoryDetail with full original `run` |
| GET /api/v1/history/{history_id}/evidence | ID; snapshot_id; limit 1–100/default25; cursor; include_payload exact true/false/defaulttrue | HistoryEvidencePage, four original ordered references for this reviewed scope |

No request bodies, update, delete, live-ingestion or write HTTP operations. Unknown/duplicate query parameters →400; malformed bounded parameters →422. IDs are identifiers, never paths/SQL. Dot segments, slash/backslash tricks and residual percent escapes are rejected. Missing history →404; explicit historical snapshot conflict →409. POST/PUT/PATCH/DELETE on a resource →405.

Every success field is required unless the machine contract says otherwise. HistorySummary contains history/archive/persistent snapshot/original snapshot/verification/workspace identities, actual archive_created_at, pinned evaluator, original contract digest, input digest, synthetic provenance, result_summary, and integrity. Detail adds the unchanged original VerificationRun as `run`; its original `run.snapshot_id` is deliberately different from the persistent outer snapshot_id. Four business verdict strings are copied, with row/cohort separate. Nullable expected_total remains null for unknown population. Original optional rule expected/actual keys and raw JSON values are preserved without coercion.

HistoryList page has snapshot_id, next_cursor (string/null), total (archive-entry count, never population). Empty initialized archive →200 items=[], total=0, cursor=null. Missing database →503, with no automatic HTTP initialization. Evidence page repeats all binding identities; items contain original reference/payload/payload_reason plus explicit integrity. Payload omission is null/omitted_by_request, while the server still checks stored bytes. Null next_cursor terminates. Full Detail records are not paged; current bounded maximum is200 inherited source rows. Current fixture evidence inventory is exactly4 and publication enforces it; no large-history capacity benchmark is claimed.

Errors use the unchanged frozen envelope `error.{code,message,request_id,retryable,details}`, with details entries {path,code}, no business verdict. 400 cursor/query,403 origin,404 missing,405 method,409 snapshot,422 parameter,500 sanitized internal,503 unavailable/corrupt/schema-invalid. For integrity errors details[0] is {path:"archive",code:"INTEGRITY_FAILED" or "INTEGRITY_UNVERIFIABLE"}. retryable=true only for503; this does not authorize automatic retry/re-evaluation or imply corruption will self-heal. No 401/auth/rate-limiter guarantee is introduced. All data/error responses use no-store.

`contracts/history-examples.json` contains **37** examples extracted from actual final HTTP captures, all validated against the relevant response schemas (0 failures). `evidence/contract-examples-validation.json` records the contract digest. Do not infer external authenticity from these synthetic outputs.
