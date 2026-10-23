# FIX02 — browser failure root cause

Commit examined: `d34f882284141dd520f0ffb457b0985f50425c55` (FIX01, accepted). Every run below used a disposable clean
clone of that commit under the session scratchpad (`c1` = unmodified, `c2` = with the FIX02 changes), after
`scripts/dev/bootstrap.sh --harness` (exit 0). Evidence paths are relative to `evidence/`.

## The two Round 02 failures

| Gate | Test | Round 02 error |
| --- | --- | --- |
| e2e-lookup | `[chrome] in-app navigation: legacy x/evidence refusal → lookup link → Back → Forward → Reload` | `response.allHeaders: Target page, context or browser has been closed` at `e2e-lookup/support.ts:179` |
| e2e-local | `[chrome] 12 · Service stopped: SERVICE_UNAVAILABLE, no seal, no demo data — then a real read once it is back` | same, at `e2e-local/support.ts:167` |

**Round 02 traces: not available (BLOCKED).** Both configs ran with `trace: "off"` (the lookup config records traces
only with `FA_TRACE`, which the regression did not set), and the Round 02 fresh clone lived in a previous session's
scratchpad that no longer exists. Only the logs survive
(`docs/product-dev/round-02/evidence/regression-fresh-clone/e2e-{lookup,local}.log`). The cause was therefore
established by reproducing the failures with their original assertions, with an event log added to the capture helper.

## Method

`tools/diag.py` patches only the two capture helpers in the scratch clone. It logs each `/api/` response event, body
failure, header read result, `settle()` call (with the number of captures it snapshots) and page close, each with a
millisecond timestamp, the test that **owns** the capture and the test **running** when the event fired. No spec,
assertion, timeout or app file was touched. `tools/late.py` lists the responses that arrived after a test's last
`settle()`.

## Reproduction on d34f882 (original assertions)

| Run set | Command (in `c1/ui`) | Result |
| --- | --- | --- |
| e2e-local ×10 | `FA_DIAG_LOG=… FA_E2E_EVIDENCE_DIR=… FA_BROWSERS=chrome,webkit npx playwright test -c playwright.local.config.ts` | **6 of 10 runs failed** (exit 1). Runs 1–2: test 12 itself failed, 7 did not run. Runs 4–6: the *next* test (`12 · real 503 …`) failed, 6 did not run. Run 3: the next test failed in Chrome **and WebKit**, 12 did not run. Runs 7–10: 34 passed. (`before-d34f882/browser-failures/local-summary.txt`) |
| e2e-lookup ×6 | `FA_DIAG_LOG=… FA_LOOKUP_EVIDENCE_DIR=… FA_BROWSERS=chrome,webkit npx playwright test -c playwright.lookup.config.ts` | **1 of 6 runs failed** (run 6): the in-app navigation test, Chrome, the Round 02 error verbatim (`lookup-summary.txt`, `lookup-run-6.log`). |
| lookup test alone ×30 | `… -g "in-app navigation" --repeat-each=30` (Chrome, `FA_TRACE=1`) | 30 passed: the timing window needs the full suite's load (`lookup-isolated-repeat30.log`). |

### What the event log shows

e2e-local run 1, test 12, Chrome (`local-diag-1.jsonl`, times in ms):

```
4353 response 0  /api/v1/verifications/SPEC-002            502   (Service stopped: the proxy answers)
4380 settle      snapshot=1
4677 response 1  /api/v1/verifications/SPEC-002            200   ("Read again")
4693 response 2  /api/v1/history?limit=4&verification_id=SPEC-002  404
4693 settle      snapshot=3                                       ← the test's last settle()
4697 response 3  /api/v1/verifications/SPEC-002/evidence?…&limit=2  200   ← 4 ms later, not in the snapshot
4700 page-close                                                    ← test ended, Playwright closes the page
4700 body-failed 3   "response.body: Test ended."                  (caught by the helper)
4700 HEADERS-FAILED 3 "response.allHeaders: Target page, context or browser has been closed"  (not caught)
```

e2e-lookup run 6, in-app navigation, Chrome (`lookup-diag-6.jsonl`): after the final Reload the Detail read
(`verification-lookup`) arrives at 6402, `settle()` snapshots 5 captures at 6424, the reloaded Detail's first
`verification-evidence` page arrives at 6427, the page closes at 6431, the header read fails at 6432. Same sequence.

All eight failed captures were the **Detail's automatic first evidence page**: seven in the six failing e2e-local runs
(run 3 failed in Chrome and WebKit) and one in e2e-lookup. Each arrived 1–4 ms after the test's last `settle()` and
2–4 ms before the page closed (`late-responses-all-runs.txt`). Owner and reporting test: the owner itself in e2e-local
runs 1–2 and in e2e-lookup; the next test in e2e-local runs 3–6. In the passing runs that response arrived after the close (no response event, nothing to
read). Test 10 shows the same latent window every run (a response ~40 ms after its last `settle()`), but its reads
finished before the close.

## Root cause

**Incorrect request-lifecycle handling in the test harness's network capture, exposed by test teardown.**
In `captureNetwork` (identical in `e2e-lookup/support.ts`, `e2e-local/support.ts` and `e2e-history/support.ts`):

1. Every `/api/` response starts an asynchronous read (`res.body()`, then `res.allHeaders()`) as a **floating promise**.
2. `settle()` was `Promise.all(pending)`: it awaits only the reads started **before** it was called.
3. The body read is in `try/catch`; the header read is not.

The test's assertions pass. It ends, and Playwright closes the page with a read still in flight. `body()` fails ("Test
ended", caught) and `allHeaders()` rejects with `Target page, context or browser has been closed`. That rejection belongs
to no awaited promise, so it is an **unhandled rejection**. Playwright reports it against whichever test is running when
it fires: the owner during its own teardown (Round 02, runs 1–2), or the next test (runs 3–6). That test was falsely
reported as failed.

Classification of the candidate causes:

| Candidate | Verdict | Evidence |
| --- | --- | --- |
| Pending network capture / request-lifecycle handling | **Root cause** | floating read + snapshot-only `settle()` + uncaught `allHeaders()` |
| Test teardown | **Trigger** | the page close that interrupts the read is Playwright's fixture teardown after the last assertion |
| Test isolation | **Consequence** | the rejection fires in the next test in 4 of 6 failing e2e-local runs; serial mode then stops the file |
| Browser process shutdown | Not the cause | only the page/context closes; the same browser runs the following tests |
| Genuine application behavior | Not a defect | the late request is the Detail's designed first evidence read; its response was 200 and correct; the tests never assert on it |
| Firefox F15 | **Not assumed** | same mechanism class as the accepted F15 register entry (R05), but reproduced here in **Chrome and WebKit** on its own evidence |

## Why seven Phase 2 tests did not execute

`e2e-local/local-research.spec.ts` sets `test.describe.configure({ mode: "serial" })` for the whole file. In serial
mode Playwright stops the group at the first failure: later tests are reported "did not run", and the worker restarts
for the next project. In Round 02 test 12 failed, so its seven Chrome successors were never executed: `12 · real 503`,
`404`, `13 · malformed responses`, `cancellation and late responses`, `14 · UIA-009`, `mode separation`, and
`accessibility and layout`. That is **neither a defect of those tests nor worker teardown**. They were blocked by the
preceding (false) failure. The four Chrome screenshot tests counted as "skipped" are the declared `FA_CAPTURE` skips.

Their own results after the fix: every one executed and passed in every after-fix run — e2e-local ×10 (`after-helper-fix/browser-failures/local-summary.txt`: 34 passed, 8 declared skips, 0 did not run, each run) and the final clean-clone regression (`REGRESSION_SUMMARY.tsv`, `e2e-local` per-test inventory).

## Fix (smallest correct, no exception swallowed)

`ui/e2e/capture-lifecycle.ts`, used by the three `captureNetwork` helpers:

- each read is tracked in a set until it settles;
- `settle()` waits until **no** read is in flight, including reads that start while it waits, and throws the first read error;
- a read cut off by the page closing (Playwright's target-closed error; the client class is not exported and is named
  `Error`, so it is matched by its fixed message) is **recorded**: listed in `interrupted`, annotated
  `capture-interrupted-by-close` on the owning test, printed on stderr, listed by the Playwright inventory gate, and it
  **fails** any later `settle()`;
- any other read error that no `settle()` awaits still rejects unhandled and fails the run, as before.

Two test-level waits make the two tests stop ending mid-read, so their network records are complete. Test 12 waits for the
re-read Detail's evidence status. The lookup navigation test waits for the reloaded Detail's retrieval status. Each uses the
suites' existing idiom `/more pages remain|All evidence pages retrieved/`. No assertion was changed or removed.

### Deterministic proof

`ui/e2e/capture-lifecycle.spec.ts` (static suite) serves a response whose headers arrive at once and whose body is held
3 s, closes the page during the read, and uses the real `e2e-local` `captureNetwork`:

| Code | Result |
| --- | --- |
| d34f882 (original helper) | **fails** in Chrome and WebKit with `response.allHeaders: Target page, context or browser has been closed` (`before-d34f882/capture-lifecycle-spec.log`) |
| FIX02 | passes 20/20 (Chrome + WebKit × 5 repeats); the interruption is printed and annotated; `settle()` rejects naming the URL |

### Repeat runs after the helper fix (before the two test-level waits)

| Run set | Result |
| --- | --- |
| e2e-local ×10 | **10/10 exit 0**, 34 passed, 8 declared skips, 0 did not run each. The interrupted read was recorded in 9 of 10 runs, always test 12's evidence page. The two test-level waits above were added because of this. |
| e2e-lookup ×6 | **6/6 exit 0**, 57 passed, 3 declared skips each, 0 interrupted |

Final verification with both changes: the clean-clone regression in `REGRESSION_SUMMARY.tsv`.
