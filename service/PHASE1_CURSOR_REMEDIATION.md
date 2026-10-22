# Phase 1 cursor remediation — P1-AUD-001

**READY FOR FOCUSED INDEPENDENT REASSESSMENT**

Date: 2026-10-18 (UTC window 02:08–02:16). Implementation-owner remediation and local testing only. This is not independent acceptance, Owner acceptance, Phase 2 authorization or a production claim. Nothing was staged, committed, merged, pushed or deployed. Evidence Atelier was not touched and no frontend command was run.

## A. Independent finding

`FlowAssert-Service-Review/FINDINGS.md` P1-AUD-001 (Medium / P2), with `PHASE1_INDEPENDENT_AUDIT.md`, `API_CONTRACT_REVIEW.md` (runtime error category FAIL) and `ACCEPTANCE_MATRIX.md` (items 1, 6, 9, 10, 12, 16 FAIL). Reproduction evidence: `evidence/restart-cursor.json` (ASGI), `evidence/loopback-v2-responses.json` and `loopback-v2-receipts.json` (real processes, PIDs 21538 / 21542). After a restart, a cursor the service had issued got **400 `invalid_cursor`**, both alone and with its original `snapshot_id`. The same old snapshot with no cursor correctly got 409. None of the auditor's files were modified.

## B. Root cause (confirmed in source)

1. `app/service.py:17` (pre-change) — `self._key = secrets.token_bytes(32)` ran for every `Catalog`. `app/main.py` lifespan builds one `Catalog` per process, so the cursor HMAC key existed only in that process.
2. `app/service.py:78–83` (pre-change) — `evidence()` called `_decode(cursor)` before `read()` checked snapshot availability. `_decode` checked the old cursor's HMAC against the new process's key, and that check failed (`service.py:67–73`). The failure raised `ServiceError(400,'invalid_cursor')`, so the 409 path in `read()` was never reached.

Other hypotheses, checked: snapshot identity and its lookup are correct. Each restart re-evaluates, records new `service_executed_at` values and so publishes a new content-addressed snapshot, and `read()` returns 409 for the old one. Catalog metadata is complete. Error classification for cursors from the current process was already correct. The defect was purely the lost verification material: a cursor the service really issued could not be told apart from a forged one.

Pre-change sources are preserved byte-for-byte in `evidence/cursor-remediation/pre-change-source/` (`service.py` SHA-256 `e6822e90…6c3956096`).

## C. Frozen contract requirement

`contracts/frontend-provider-contract.md:119` (SHA-256 `aa275b2c…5312a`, identical to Planning) states:

- Cursors bind workspace, mode, contract version, full query, evidence run and include_payload, plus the immutable snapshot.
- Reusing a cursor with changed filters is **400**. An expired or unavailable snapshot is **409**. An explicit `snapshot_id` that conflicts with the cursor is **409**.
- Cursor contents are integrity checked: "do not trust decoded client values".

`openapi-v1-proposed.yaml` (SHA-256 `0688d55d…1c230`) defines evidence 400 as "Invalid cursor, unknown parameter or unsupported sort" and 409 as "Expired query snapshot…". It also says "Never fall forward to a newer snapshot", and `x-behavioral-invariants` requires "expired snapshot returns 409". The contract defines **no cursor TTL**: a cursor expires only when its bound snapshot is no longer served. The UI maps 409 to STALE_SNAPSHOT and 400 to REQUEST_ERROR.

## D. Why the old behavior returned 400

The service could only recognise its own cursors while the issuing process was alive. After a restart, every cursor looked unauthenticated, and returning 400 for an unauthenticated cursor is correct. To return 409, the service has to be able to prove the cursor is authentic after the restart. Simply checking the snapshot first, or classifying every bad cursor as 409, would mean trusting unverified client fields. The contract forbids that.

## E. Corrected behavior

The cursor key now outlives a single process. `cursor_key()` (`app/service.py`) loads a 32-byte key from `.state/cursor-hmac.key` inside this workspace, or from the path in `FLOWASSERT_CURSOR_KEY_FILE`:

- The key is created once, atomically: a random hex value goes to an `O_EXCL|O_NOFOLLOW` temp file, which is then hard-linked into place. The directory is 0700 and the file 0600.
- It is read with `O_NOFOLLOW`. The file must be a regular file owned by the current user with no group or other permission bits, and must hold exactly 64 lowercase hex characters.
- Any other state fails closed with 503 `cursor_key_unavailable` at startup. Both routes then return 503 with no verdict, the same treatment as a source-identity failure. The key is **never silently regenerated**.

Nothing else changed: cursor format, HMAC-SHA256, scope binding, check order, offsets, snapshot identity and pagination. Validation order for a request with a cursor:

| Order | Check | Result on failure |
| --- | --- | --- |
| 1 | Structure + HMAC (authenticity) | 400 `invalid_cursor` |
| 2 | Signed scope equals the request: run, limit, include_payload, workspace, mode, contract | 400 `cursor_query_conflict` |
| 3 | Explicit `snapshot_id` equals the cursor's signed snapshot | 409 `snapshot_conflict` |
| 4 | Signed snapshot is the one served now | 409 `snapshot_unavailable` |

Precedence decision: an unauthentic cursor is 400 even when the explicit `snapshot_id` is also stale. FINDINGS suggested checking an explicit unavailable snapshot before decoding. That is no longer needed for authentic cursors, and integrity-first never lets an unverified cursor influence classification. The contract does not set a precedence. Reassessment should confirm this choice.

Bindings preserved: run, workspace, snapshot, contract version, limit (pagination scope), include_payload (payload mode) and offset are all inside the HMAC. No fall-forward: changing the signed snapshot to the current one gives 400. No replacement snapshot or cursor is ever created.

## F. Changed-file inventory (FlowAssert-Service only)

| File | Change | SHA-256 after |
| --- | --- | --- |
| `app/service.py` | Modified: `cursor_key()`, `KEY_FILE_ENV`, `DEFAULT_KEY_FILE`; one line in `Catalog.__init__` | `f37971f5f4b3ceea5e6e7e66f65ae1eb6678572663d1d6f0cf5f66d15218fd1e` |
| `.gitignore` | Appended `.state/` | `c05109367a693e7b1b3f9ac91a2dee5b605549e533c87ce9a6316c3767db979a` |
| `tests/conftest.py` | New: autouse fixture pointing the key to a pytest temp dir | `068adb6f8bd9143bfb2e79e397a905b510cfbee19489fb1e23c2e37fabe46749` |
| `tests/test_cursor_restart.py` | New: 36 regression cases | `042391b2a6603c4da89e37c086bdc8b213275ebc29b0124ad6a2bd6f589666d5` |
| `scripts/restart_probe.py` | New: real two-process probe | `485f8dd6391d24b68f9270ab3a836f2f14e66e1cee8bb28cc2fab7b6aa4df1e6` |
| `.state/cursor-hmac.key` | Generated at runtime by the first real launcher process (0600, 64 bytes). Secret; not reproduced here | — |
| `PHASE1_CURSOR_REMEDIATION.md` | This report | — |
| `evidence/cursor-remediation/**` | New evidence, receipts, observer and recorder scripts, pre-change copies | — |

Unchanged: `app/main.py`, `adapter.py`, `identity.py`, `validation.py`, `models.py`, `tests/test_service.py` (SHA-256 `c2200cf0…899c956096`, same as before), fixtures, `contracts/*`, `run.py`, `scripts/http_probe.py`, `protected_integrity.py`, `verify.py`, README, all prior reports and evidence. The observer's service-tree diff (`final-comparison.json`) lists exactly the rows above, plus mtime changes on the parent directory entries.

## G. Regression tests added (`tests/test_cursor_restart.py`, 36 cases)

Expected statuses and codes are written as constants taken from contract line 119 and the OpenAPI definitions. Every error case checks the Error schema, the exact code, `retryable=false`, `details=[]`, no `items`/`result`/`page`, and `Cache-Control: no-store`.

| Required case | Test | Expected |
| --- | --- | --- |
| A valid before restart; K multi-page; L digests | `test_valid_cursor_before_restart` ×24 (SPEC-001/004/005 × limit 1–4 × payload true/false) | 200; full Detail order; snapshot/meta echo; digest or `omitted_by_request` |
| B valid after restart, snapshot available | `test_valid_cursor_after_restart_with_snapshot_available` | 200, page identical to pre-restart page 2 |
| C previously valid, snapshot unavailable | `test_previous_cursor_after_restart_snapshot_unavailable` | 409 `snapshot_unavailable` (cursor alone and with old snapshot) |
| D malformed | `test_cursor_rejections_in_process` (9 variants) | 400 `invalid_cursor` |
| E tampered (in process and after restart, incl. snapshot rewritten to current) | `test_cursor_rejections_in_process`, `test_tampered_cursor_after_restart_rejected` | 400 `invalid_cursor` |
| F different run | both in-process and after restart | 400 `cursor_query_conflict` |
| G different snapshot | explicit `snapshot-other`; after restart explicit new snapshot + old cursor | 409 `snapshot_conflict` |
| H incompatible query (limit) | in process and after restart | 400 `cursor_query_conflict` |
| I incompatible payload mode | in process | 400 `cursor_query_conflict` |
| J expired (contract semantics: snapshot no longer served) | `test_cursor_for_replaced_snapshot_is_expired` | 409 `snapshot_unavailable` |
| M structured errors | all of the above | Error schema + exact code |
| Lost key (verification material gone) | `test_cursor_from_another_key_is_invalid` | 400 `invalid_cursor` |
| Key handling | `test_cursor_key_file_properties`; `test_unusable_cursor_key_fails_closed` ×5 (short, non-hex, 0640, symlink, directory) | 0600 / 0700, not in responses, not regenerated; 503 `cursor_key_unavailable` on both routes |

Case B in the ASGI tests uses a fixed evaluation clock (`patch('app.adapter.datetime')`), so both catalogs produce byte-identical content and therefore the same content-addressed snapshot. The real model still runs five times on the second startup. In the real launcher, B **cannot occur**, because every restart records a new `service_executed_at` and so publishes a new snapshot. The test exercises the verification logic and is not a production claim.

Test-first evidence: on the **unmodified** code the new file ran **27 passed / 9 failed**. Example failures: `assert 400 == 409` with body `invalid_cursor`, and the key tests (no key file existed). See `evidence/cursor-remediation/pre-fix-new-tests.{log,xml}`. After the fix: 36 / 36 passed.

## H. ASGI reproduction

The ASGI "restart" exits the first `TestClient` context, which runs lifespan shutdown and discards the catalog. It then builds a new `create_app()` and enters a new lifespan, which creates a new `Catalog`, re-evaluates through the real model and publishes a new snapshot. The key file is shared between the two. Results after the fix: old cursor gets 409 `snapshot_unavailable`, old cursor + old snapshot gets 409, old cursor + new snapshot gets 409 `snapshot_conflict`, and tampered gets 400. This is an application-level restart, not a process restart; section I covers the process restart.

## I. Real process restart (HTTP)

Command: `.venv/bin/python -B scripts/restart_probe.py`, run through `evidence/cursor-remediation/record.py`, exit 0. Receipt: `restart-probe.command.json`. Details: `restart-http/receipt.json`, `server-{1,2}.log`, `listener-{1,2}.txt`. The launcher ran with its default configuration and no `FLOWASSERT_CURSOR_KEY_FILE`, bound only to 127.0.0.1:8765 (from `lsof`). No proxy was used and no external host was contacted.

| Step | Observation |
| --- | --- |
| First start | PID 22166, started 02:12:21.170749Z, ready .394338Z, listener 127.0.0.1:8765 only |
| Initial evidence request | `SPEC-001/evidence?limit=1&snapshot_id=snapshot-5aa0a449…7752c` gives 200 and `next_cursor` (recorded in the receipt) |
| Continuation in process | 200; item = Detail reference #2; payload digest matches |
| First shutdown | SIGTERM, exit -15 at .564639Z; port re-bindable |
| Second start | PID 22169, started .567338Z, ready .795275Z; new snapshot ≠ old |
| Old cursor only | **409 `snapshot_unavailable`**, request_id `255b0093-b791-4be5-9b61-36f897f238fa` |
| Old cursor + old snapshot | **409 `snapshot_unavailable`**, `35c7df6c-d90f-4d93-9942-b1bad118832e` |
| Old snapshot, no cursor | 409 `snapshot_unavailable`, `551040c6-…` |
| Old cursor + new snapshot | 409 `snapshot_conflict`, `62b7b103-…` |
| Old cursor, tampered signature | 400 `invalid_cursor`, `34a797cc-…` |
| Malformed cursor | 400 `invalid_cursor`, `f3a6d99f-…` |
| Old cursor, different run / limit / payload mode | 400 `cursor_query_conflict` (`f9ed047b-…`, `dc710433-…`, `4e957a70-…`) |
| Fresh pagination on new snapshot | 4 × 200; complete Detail order; all digests match |
| Second shutdown | SIGTERM, exit -15 at .981348Z; port re-bindable; no listener left |

The key file mode was 0600. The probe checked that the key's hex text does not appear in any server log, response or the receipt (`key_absent_from_logs_and_responses: true`). The auditor's original 400 evidence was not touched.

## J. Complete backend regression

| Run | Command / receipt | Result |
| --- | --- | --- |
| Historical acceptance-03 | `evidence/acceptance-03/suite.xml` | **52 passed / 0 failed** (unchanged, still valid) |
| Remediation run 1 | `suite.command.json` (exit 1) | 87 passed / **1 failed**: `test_protected_repository_integrity` |
| Remediation run 2 | `suite-c-locale.command.json` (exit 0), `LC_ALL=C LANGUAGE=C` | **88 passed / 0 failed**, 1 pre-existing Starlette deprecation warning |
| Original HTTP probe, attempt 1 | `http-probe.command.json` (exit 1) | `EADDRINUSE` before start: TCP TIME_WAIT from the restart probe, no listener (same harness condition the auditor recorded) |
| Original HTTP probe, retry | `http-probe-retry.command.json` (exit 0) | PID 22284; 10 success + 4 error bodies schema-valid; exit -15 |

Both suite runs used `FLOWASSERT_INTEGRITY_BASELINE=evidence/acceptance-03/before-legacy.json` (SHA-256 `02c38380…e8447d`), the baseline under which 52/0 was recorded. Run 1 failed only because Git's error text came out in a different language. In the four non-repository roots, `git rev-parse` returned exit 128 in both the baseline and this run, but the message read `fatal: not a git repository…` in the baseline and the Chinese `致命错误：不是 Git 仓库…` here, because this host's Git selected Chinese messages with `LANG` unset. File differences: 0 in every root. Run 2 pinned the C locale, which restores the baseline's message language. No test, baseline or expectation was edited. The failed run's logs and XML are kept as they were.

`test-inventory.json`: all 52 original test IDs are present and pass. 36 cases were added, all in `tests.test_cursor_restart`. Original tests still cover the five evaluator examples (complete raw equality, row/cohort verdicts), Detail and Evidence, pagination, payload omission, corruption, version drift, OpenAPI, local scope, sanitised errors and evaluator source identity.

## K. F004 preservation

The six-case `test_f004_runtime` set, `test_f004_unavailable_payload` and the seven `test_f004_through_http` / `test_unavailable_payload_through_http` HTTP controls all pass unchanged in run 2. `validation.py` is unchanged. The pinned model is still SHA-256 `b61779e1…e3a842d`.

## L. Contract compatibility

- No route, parameter, schema, status code or cursor format was changed or added.
- `/openapi.json` still advertises the same two operations (`test_openapi_and_scope` passes).
- Every new error body validates against the frozen `Error` schema.
- `cursor_key_unavailable` is a new code value under the existing 503 meaning ("integrity or version lock unavailable"). `Error.code` is a free string.
- Contract bundle hashes are unchanged: OpenAPI `0688d55d…`, examples `92ea5a88…`, provider `aa275b2c…`.

## M. Protected repository integrity

Observer: `evidence/cursor-remediation/observe.py`. It is read-only, does not follow directory symlinks, does not exclude ignored files, and does not record atime. It covers the seven protected roots and this service tree. For each root it records every object's type, mode, mtime, uid/gid, size and SHA-256, plus Git HEAD/branch/status (including ignored files), index entries, staged diff and the external Git admin/common trees.

- Baseline `before-full.json`: SHA-256 `1d27351a…edf0e`, taken at 02:08:53Z before any code edit.
- Final `final-full.json`: SHA-256 `9f412b80…db37f`.
- `final-comparison.json`: SHA-256 `03e68b56…4dbd`.

Object counts: Service-Review 253, UI 10,930, round03-oracle-fix 1,207, Planning 21, Integration-Review 875, Reassessment 44, Final-Audit 189. **Protected differences: 0.** The legacy checker (six roots) also reports 0 file differences and Git-equal under the C locale.

The final observation hashes the service tree, so `final-full.json` contains a SHA-256 of `.state/cursor-hmac.key`. That is a hash of a 256-bit random value, not the key itself. Equality covers only the measured endpoints; it cannot rule out a transient write that was restored in between.

## N. Remaining limitations

- **Design decision for reassessment:** the persistent local key file is new runtime state. It holds only integrity material: no runs, evidence or history are persisted, and the catalog stays memory-only. It is not a database or a provider credential. It is still a secret at rest, with no rotation, no OS secret store and no multi-host sharing. Production key management needs the Owner decision named in `05_EVIDENCE_TRUST_BOUNDARIES.md`.
- If the key file is deleted or replaced between runs, older cursors cannot be authenticated and correctly get 400 `invalid_cursor`, not 409. Clients should re-read from the first page either way.
- A real restart never keeps a snapshot available (new execution timestamps every time), so case B was only exercised at ASGI level with a fixed clock.
- An unusable key file now also makes the Detail route return 503. This only happens when the key file is misconfigured or damaged.
- Two processes starting at once both converge on one key through the hard-link creation step. That race was not stress-tested.
- Precedence of 400 (unauthentic cursor) over 409 (stale explicit snapshot) is an implementer choice; see E.
- Browser→service integration, durability, authentication and live acquisition remain NOT TESTED or out of scope, as before.

## O. Prerequisites for independent reassessment

1. Re-run the auditor's `loopback_repro.py` against this candidate, plus an independent cursor-forgery and rebinding sweep.
2. Accept or reject the persistent local key file as the bounded mechanism (N, first bullet) and the 400-over-409 precedence (E).
3. Run the suite under a pinned locale, or account for the localized Git stderr in the legacy integrity checker.
4. Confirm the frontend STALE_SNAPSHOT recovery path now receives 409 after a restart.
5. Re-verify protected-tree integrity against a new independent baseline.

Phase 1 is **not** independently accepted by this report. Phase 2 is not authorized.

**READY FOR FOCUSED INDEPENDENT REASSESSMENT**
