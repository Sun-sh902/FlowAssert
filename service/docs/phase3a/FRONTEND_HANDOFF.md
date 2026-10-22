# Claude Code — Phase 3A frontend integration handoff

**READY FOR PHASE 3A FRONTEND INTEGRATION** — backend local recommendation, not Owner Acceptance. No frontend development or test has been performed. Do not start Phase3B or live connectors/deployment under this handoff.

Additive contract: `phase3a-1.0.0`, `contracts/openapi-history-v1.yaml`, SHA-256 `f341d8d5ec9da1b933b06efe998c07a1045226500a6b5837e9c8a9ead74bd69f`.
Schema version **1**; migration SHA-256 `b6a09e4f7e79f76f169beac713c9793349ff8012a27b04ddd90705e1b7158f2a`; actual sqlite_master signature SHA-256 `532cc799b791594006fae05ec53cbe6610088ac9676c31184d0e66701a395801`.
Source snapshot SHA-256 `2249569fa3a97fa3ab44aa0ba2088e5fc7ffd264cc8c824d062ae270d7ba6a65` (`SOURCE_MANIFEST.json`); executed implementation SHA-256 `fcf0d1ecda2e5cba67e9298ad8ac8a0bb05ee91833cc45e85ac7fa22ec9ed2fa`; reviewed source-set identity `f042f02d7185371a02af18b9d61d3bc7d357910e38ca2bb4824239862bebdd84`.

Exact identities: evidence/final-identities.json. All code/config/test/contract digests: SOURCE_MANIFEST.json. Original model SHA-256 `b61779e198dd0213b67f8319b77a2daf9feb502dc553784df6d6600e8e3a842d`; original frozen contract `0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230` unchanged. Original app.main/app.service routes and response shapes remain frozen; Phase3A composes them in app.history_api and publishes its separate spec at /history-openapi.json.

```sh
cd /Users/zhangshenghe/Documents/FlowAssert-Phase3A-Service
export PYTHONDONTWRITEBYTECODE=1
export TMPDIR="$PWD/.runtime/tmp"
.venv/bin/python -B archive_cli.py seed
.venv/bin/python -B archive_cli.py check
.venv/bin/python -B run_history.py
# Ctrl-C to stop this owned service.
```

Server is fixed to http://127.0.0.1:8765. Verify the port is free; never kill an unrelated listener. Default SQLite `/Users/zhangshenghe/Documents/FlowAssert-Phase3A-Service/.runtime/delivery/history.sqlite3`; private state0700, database/history key/ephemeral key0600. Launcher validates private state and safely prepares the separate ephemeral key. No auth is claimed. No CORS middleware/allow-origin response is enabled. Use an authorized same-origin dev proxy. Exact accepted Origin header values for history are http://127.0.0.1:5183 and http://127.0.0.1:8765; other Origins get403; Origin absent is allowed for local clients. This is an origin check, not authentication. No frontend proxy/config file was edited here.

| Case | Initial history ID | Stored cohort |
| --- | --- | --- |
| SPEC-001 | `hist_230c08845a2e81335c63d9f4876be867828d0bc0cf8b9cbda155782372c84f12` | Verified |
| SPEC-002 | `hist_51a4d6305b0e7b4b82dbe8b757ecf14060189fc47dd2e2f11e933d4613855425` | Mismatch |
| SPEC-003 | `hist_8c50b8a8a684c221be99f719292c660acad02d84a90a933991dcf3b39f125d1b` | Pending |
| SPEC-004 | `hist_da374150e1a47d18302f6a56a3eaf1001f185155505c6bf761183459180dfc09` | Unverified |
| SPEC-005 | `hist_22ad2174cef10586aedf65dd5d734cc009af28e16cd57df2c7170a5863213c61` | Unverified (12 Verified rows; unknown population) |

There are10 delivery entries after explicit reevaluation testing; preserve both batches. A default seed returns the initial five IDs, does not reevaluate, and leaves historical bytes unchanged. List API must use history_id as the route key, never assume original SPEC ID uniquely identifies an evaluation. Current histories are all workspace ws-synthetic-01 / LOCAL_RESEARCH / synthetic / research_only.

```sh
curl --noproxy '*' 'http://127.0.0.1:8765/api/v1/history?limit=2'
curl --noproxy '*' 'http://127.0.0.1:8765/api/v1/history/hist_22ad2174cef10586aedf65dd5d734cc009af28e16cd57df2c7170a5863213c61'
curl --noproxy '*' 'http://127.0.0.1:8765/api/v1/history/hist_230c08845a2e81335c63d9f4876be867828d0bc0cf8b9cbda155782372c84f12/evidence?limit=1'
```

Use returned next_cursor verbatim with the same limit/filter/payload option; query-encode it. List continuation retains its original high-water snapshot even across new inserts/restart. History evidence continuation binds history_id, persistent snapshot_id, database and payload scope. Optional snapshot_id should be the outer historical value; nested run.snapshot_id is the original catalog snapshot and is a different namespace. Null next_cursor terminates; concatenate evidence reference objects in exactly Detail.run.evidence_references order, with no duplicates, omissions, cycles or cross-history merge. Full historical records/rules are in run.result; do not build them from result_summary/counts. row/cohort verdicts remain distinct. SPEC-005 total is unknown, never0 or12.

Actual full response examples, captured request paths and working continuation tokens: contracts/history-examples.json and evidence/http-closeout/. Files containing list-pinned-continuation, history-after-restart-page2 and list-after-restart demonstrate continuation. Tokens work only with the delivered database/key/scope and are not generic reusable fixtures. The 37 examples were schema-validated; no frontend provider/type-generation validation is implied.

| Error | Meaning / UI obligation |
| --- | --- |
|400 invalid_cursor/cursor_query_conflict/invalid_query | Request failed; never a verdict or stale-run replacement |
|403 origin_not_allowed | Local origin policy refused |
|404 history_not_found | Identifier absent; never invent rows |
|405 method_not_allowed | Read-only API |
|409 history_snapshot_conflict | Explicit history pin conflict; do not fall forward or mix snapshots |
|422 invalid_history_id/invalid_parameter | Malformed ID/path/query |
|500 internal_error | Sanitized request failure |
|503 archive/evidence/schema/key failure | Inspect error.details integrity code; no unqualified Complete/Verified integrity display |
|Old endpoint409 snapshot_unavailable | Original ephemeral restart behavior; discard old evidence pages and explicitly re-read as previously accepted |

A business Verified/Mismatch/Pending/Unverified is an HTTP200 archived result, not retrieval/integrity status. INTEGRITY_VERIFIED refers to exact stored Python canonical bytes and validated archive relationships; failed hashes block200. INTEGRITY_FAILED and INTEGRITY_UNVERIFIABLE are explicit error details. include_payload=false keeps null/omitted_by_request while checking stored content. Do not turn browser canonicalization inability into external-authenticity claims or overwrite the server's verdict. P2-AUD-001/002 handling is documented in ARCHIVE_INTEGRITY_MODEL.md. Successful unavailable-reference HTTP archival was not fabricated and remains untested because no reviewed source fixture supplies it.

Limits: only five reviewed synthetic source shapes; changed evidence/evaluator/contract is a documented conflict, no arbitrary import. No HubSpot/n8n acquisition, customer data, credentials, external provenance proof, administrator-proof immutability, production hardening, key rotation, cloud deployment or frontend acceptance. Historical queries validate stored evidence; they do not rerun/update the result. Software/schema migrations beyond empty0→1 are unsupported and fail closed.

Exact regression command: `.venv/bin/python -B scripts/run_checks.py NEW-LABEL tests` (183 passed/0 failed/0 skipped in final run;88 original regressions). To repeat the real process probe, use fresh paths and retain prior evidence: `.venv/bin/python -B scripts/runtime_probe.py --state "$PWD/.runtime/recheck-NEW" --output "$PWD/docs/phase3a/evidence/http-recheck-NEW"`. This creates a distinct synthetic test database and temporarily owns8765; do not rerun against existing delivery state. The probe never clears existing archives. Documentation is complete; backend work stops here.
