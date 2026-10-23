# Confirmed fixes

Implementation-side. Every change below corresponds to a CONFIRMED finding in
[FINAL_FINDING_TRIAGE.md](FINAL_FINDING_TRIAGE.md), except the R04 comment and the R09 improvement, which are marked
as such. Before results were taken on unchanged `1caef22` sources (same tests, `.dev-runtime/residual-closeout-20261023/before/`,
summarized in `evidence/before-after/`). After results are on the implementation commit (see
[FINAL_REGRESSION_SUMMARY.tsv](FINAL_REGRESSION_SUMMARY.tsv)).

No Evaluator, Oracle, contract, Service, fixture, protected source, historical report or accepted evidence file was
changed. One accepted test expectation was corrected because it asserted the R05 defect (below).

## R05 — not_found is not a failed read

| File | Change |
| --- | --- |
| `ui/src/pages/Workspace.tsx` (`Statement`) | Counts `not_found` and transport failures separately from other failures. Headlines: all not found → "The Service holds no current result for these cases."; nothing read with some not found → "No current result was read." + per-kind tail; tail parts "has/have no current result at the Service", "could not be read", "could not reach the Service". Unchanged: reading → "No current result has been read yet."; only failures → "No current result could be read." |
| `ui/src/pages/Workspace.tsx` (`Register`) | "Live reads": a 404 counts as answered, shown "(N not found)". |
| `ui/src/test/workspace.test.tsx:184` | Accepted assertion `/one could not be read/` for a 404 `run_not_found` replaced by `/one has no current result at the Service/` and `not /could not be read/`. The old assertion encoded the defect; the test's other assertions (LIVE_MISSING, archived seal only, "no current result") are unchanged. |
| `ui/src/test/residual-closeout.test.tsx` | R05 scenarios 1, 2, 3, 4, 4b, 5, 5b, 6. |
| `ui/e2e-workspace/workspace.spec.ts` | Browser test with the real Service's own 404 body (Chrome + WebKit); 2 entries added to `scripts/dev/test-inventory.json`. |

Root cause: `notRead = cases − ready − reading` treated every other live outcome as a read failure, and the Register
counted only `ready` as an answer.

Before / after: unit 5 of 8 failed → 8 of 8 pass (scenarios 1 and 4b were already correct; 4 is a control, see
note). Browser: on `1caef22`, Chrome and WebKit render "… one is verified, one could not be read." → after: "… one
has no current result at the Service.", 2/2 pass.
Note: scenario 4's first version failed on `1caef22` because the harness failed only the live reads while the archive
answered. That was a test error, not a product result. The corrected test, with the archive unreachable too, passes before and after
(`before/residual-before-test4-corrected.log`).

## R06 — record check tooltip

| File | Change |
| --- | --- |
| `ui/src/components/history/HistoryRows.tsx:46` | Tooltip says the browser did not recompute the digest and only checked it against the entry's history/archive/snapshot IDs; payload digests are recomputed on the entry page. |
| `ui/src/test/residual-closeout.test.tsx` | R06 assertion (also asserts the unchanged accessible tag text). |

Root cause: copy that implied a browser digest check in a product where "this browser" + digest otherwise means a real
`crypto.subtle` SHA-256. Before: 1 failed → after: 1 pass.

## R07 — provider replacement

| File | Change |
| --- | --- |
| `ui/src/lib/useProviderRead.ts` | New optional `source` (the provider object). A changed `source` resets the state to idle during render (the old provider's result is never committed under the new one), and is an effect dependency, so the previous read is cancelled (sequence bump + abort) and a new read starts. Without `source`, behaviour is identical to before. |
| `ui/src/lib/useHistoryList.ts` | A changed provider restarts the list view (plan, chain, refusal) and passes `source`. |
| `ui/src/pages/History.tsx`, `ui/src/pages/VerificationDetail.tsx` | Pass `source: provider` to their single read. |
| `ui/src/test/residual-closeout.test.tsx` | 5 `useProviderRead` + 3 `useHistoryList` tests (positive, late answer, failure, unmount, stable-provider controls). |

Root cause: `load` was read through a ref and the effect depended only on `key`, so the provider identity was invisible
to the lifecycle.
Before: 6 of 8 failed (the two stable-provider controls passed) → after: 8 of 8 pass. All 90
`evidence-mode-switch-race` and the accepted `useProviderRead` tests in `access-states.test.tsx` still pass.

## R10 — CLS probe readiness

| File | Change |
| --- | --- |
| `ui/scripts/dev/cls-probe.mjs` | After the unchanged 800 ms, waits for `document.fonts.ready`, two animation frames and 300 ms more. The observer is the same buffered observer, never reset, so earlier shifts are kept. Records `fontsAtWindowEnd`, `fontsAtEnd`, `lastFontLoadMs`, `observedMs`. |
| `scripts/dev/rules_cls_probe.sh` | Also fails a load whose fonts were not loaded when it was measured. Threshold (< 0.1), 30 cold loads, page-error rule unchanged. |

Root cause: a fixed window with no readiness bound.
Before / after: the negative control in [FINAL_FINDING_TRIAGE.md](FINAL_FINDING_TRIAGE.md) §R10 — with the fallback
removed and fonts delayed 1500 ms, the `1caef22` probe reported CLS 0 on 5/5 loads (shift missed). The new probe
reported 0.136 on 5/5. With the accepted CSS, both report 0, so the accepted font/layout fix is preserved.

## R02 / R13 — profiles and the responsive gate

| File | Change |
| --- | --- |
| `scripts/dev/bootstrap.sh` | `--product-harness`: prepares only the history runtime copied from this workspace, then the browser check. `--harness` unchanged. |
| `scripts/dev/regression.sh` | `--product` profile; NOT RUN rows for gates outside a profile; gates `responsive-matrix` and `responsive-matrix-inventory` in the product and release profiles. |
| `ui/scripts/dev/fix04-product-review.mjs` | Accepts any new absolute output directory (git-ignored if inside the repository); refuses a preview that does not serve this `dist/index.html`; records its SHA-256. Assertions unchanged. |
| `scripts/dev/check_test_inventory.py` | `matrix GATE results.json`: the exact 200-cell set, each once, no problem, each cell's checks present. |
| `scripts/dev/test-inventory.json` | `matrix.responsive-matrix` (engines, themes, widths, scenarios, keyboard-scroll widths, 12 focus stops); new Vitest file (20); 2 new e2e-workspace tests; optional-group text (R09). |
| `scripts/dev/tests/test_dev_scripts.py` | 9 tests of the matrix inventory (22 → 31). |
| `README.md` | Profiles and NOT RUN status. |

Before: the matrix was not called by any profile. Checker validation: FIX04's real clean-clone results → OK
(200/200); FIX04's real pre-fix results → FAIL (138 problems); mutated copies (missing cell, duplicate, problem, axe
absent, keyboard scroll absent) → FAIL each.

## Not a confirmed defect, changed anyway (low risk, recorded)

- R04: `ui/src/data/workspace/archiveIndex.ts:44-48` comment corrected (no behaviour). Tests: decoder refusal of
  SPEC-009, control, Overview with a SPEC-009 page — pass before and after.
- R09: `ui/src/test/contract-drift-mutations.test.ts` default path derived from `FLOWASSERT_PROTECTED_PARENT`.

## Measured, not changed (R12)

Entry JS 636,981 B (179,319 B gzip-9), CSS 75,708 B, 35 files (`evidence/build/dist-manifest.json`, `vite-build.log`);
cold first route 295 kB transferred, FCP 124–184 ms on loopback. No accepted budget exists and no user-visible defect was
reproduced, so no code was split and the warning threshold was not raised. Low-risk boundaries if a budget is set later:
route-level `lazy()` for the MOCK demo pages, Rules/Settings and the History/lookup pages (`States` already is).
