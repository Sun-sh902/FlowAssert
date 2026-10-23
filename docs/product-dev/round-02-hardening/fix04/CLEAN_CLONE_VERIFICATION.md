# FIX04 clean-clone verification

The exact candidate commit `a30e4f338d2f363a17924b6fa8a33e4a8b2c329f` was verified from an independent clone made from a
Git bundle, not from the working tree. The driver script ran each step once, in order. Every step's command line and
output is in `evidence/clean-clone-a30e4f3/<step>.log`, with its exit code in `<step>.exit`. Run log:
`evidence/clean-clone-a30e4f3/clean-clone-run.log`.

Run directory: `.dev-runtime/fix04-20261023-s2/` (git-ignored, new for this run; no earlier run directory was reused or
overwritten).

| # | Step (UTC finish) | Command | Exit | Result |
| --- | --- | --- | --- | --- |
| 1 | bundle-create 14:53:43 | `git bundle create …/candidate-a30e4f3.bundle --all` | 0 | SHA-256 `bb8aed6c8a3b672fc6f246dd1e3c793b0428bc6cbee514ad70f621467111b395` |
| 2 | bundle-verify 14:53:43 | `git bundle verify …/candidate-a30e4f3.bundle` | 0 | "The bundle contains these 7 refs", okay |
| 3 | clone 14:53:43 | `git clone --no-hardlinks -b product-dev/round-02-hardening <bundle> clean-clone` | 0 | No shared object files with the repository |
| 4 | detach 14:53:44 | `git checkout --detach a30e4f3…` | 0 | HEAD = candidate |
| 5 | clone-fsck 14:53:44 | `git fsck --full --strict` | 0 | No problems |
| 6 | clone-identity 14:53:44 | `rev-parse HEAD HEAD^{tree}`; repository `rev-parse a30e4f3^{tree}`; `status --porcelain` | 0 | HEAD `a30e4f33…`, tree `d32b7b0e…` in both; worktree clean |
| 7 | bootstrap 14:53:54 | `scripts/dev/bootstrap.sh --harness` | 0 | "BOOTSTRAP OK": pinned Evaluator, contracts and backend source map verified; dev-main (10), dev-single (5), dev-empty (0) archives; chrome 156.0.8078.47, webkit 26.6 |
| 8 | regression 15:01:07 | `FLOWASSERT_PROTECTED_PARENT=/Users/zhangshenghe/Documents scripts/dev/regression.sh fix04-a30e4f3-full` | 0 | **24/24 gates PASS**, "verdict: PASS (all gates)" |
| 9 | matrix 15:02:43 | `cd ui && node scripts/dev/fix04-product-review.mjs <clone>/.dev-runtime/fix04-matrix` | 0 | **200/200 cells PASS**; matrix `identity.json`: commit `a30e4f3…`, status empty |
| 10 | production-build 15:02:48 | `cd ui && npm run build` | 0 | 35 files, 1,079,657 bytes, `index.html` only |
| 11 | lab-absent 15:02:48 | `find dist` for lab, Brand, A/C shells and lab-only fonts | 0 | Nothing found |
| 12 | lab-source-retained 15:02:48 | `git ls-files ui/lab.html ui/src/lab`; `git diff --exit-code e974c6d a30e4f3 -- ui/lab.html ui/src/lab` | 0 | 14 files tracked, byte-identical to FIX03 |
| 13 | clone-final-status 15:02:48 | `git status --porcelain` | 0 | Empty: no step wrote into a tracked file |

## Regression gates (step 8)

`run-identity.tsv`: run `fix04-a30e4f3-full`, commit `a30e4f3…`, `worktree_changes 0`, mode `full`, started
2026-10-23T14:53:54Z, Darwin 27.2.0 arm64.

| Gate | Result | Counts / detail |
| --- | --- | --- |
| backend-pytest | PASS | 247 passed, 0 failed, 0 skipped. The custody test is deselected here and runs in its own gate. |
| backend-inventory | PASS | "pytest inventory: OK (0 problems)" |
| protected-custody | PASS | 1 passed: six genuine protected roots under `/Users/zhangshenghe/Documents` |
| dev-scripts | PASS | Bootstrap/regression/seed script tests |
| pinned-identities | PASS | `problems: []`, backend map `a5d68b75…b34b45` |
| ui-typecheck, ui-lint | PASS | `tsc -b`, `oxlint` |
| ui-vitest (+ inventory) | PASS | 1644 passed, 0 failed, 0 skipped. Includes the 13 optional audit-mutant replays (present, RAN). Inventory OK. |
| browsers | PASS | chrome 156.0.8078.47 and webkit 26.6 OK (mandatory); firefox 155.0 present, not mandatory |
| e2e-static (+ inventory) | PASS | 140 passed, 0 failed, 24 declared skips (opt-in screenshot captures, `FA_CAPTURE=1`). Includes axe (16 views × light/dark × 2 engines) and responsive (22 passed). Two "INTERRUPTED capture after the test's last settle" annotations are the accepted FIX02 design: annotated, not failed. |
| rules-cls-repeat (+ inventory) | PASS | 20 passed |
| rules-cls-probe | PASS | 30 runs, CLS all 0, max 0, page errors 0 (`regression/rules-cls-probe.log`) |
| e2e-workspace (+ inventory) | PASS | 31 passed, 1 declared skip (screenshot capture) |
| e2e-history (+ inventory) | PASS | 68 passed, 8 declared skips (screenshot captures). Real Service history, exact-ID entries, integrity states and the new ledger keyboard assertion (`regression/history-axe-layout-keyboard-*.json`: chromium 226/226 @768, 182/182 @1024; webkit 227/227, 183/183). |
| e2e-lookup (+ inventory) | PASS | 57 passed, 3 declared skips (run-once probes, one visual record) |
| e2e-local (+ inventory) | PASS | 34 passed, 8 declared skips (screenshot captures). Real local Python Service integration. |
| tracked-evidence | PASS | "tracked evidence unchanged (414 lines)": no tracked file under `docs/` or `ui/docs/` changed, none appeared |

Every Playwright skip is declared in `scripts/dev/test-inventory.json` and is listed as SKIP in
FINAL_REGRESSION_SUMMARY.tsv, not counted as a pass. No required test was skipped, missing or retried into a pass
(`flaky: 0` in every report).

## Boundaries

- The harness and browser gates are machine-bound by design: they read accepted historical sources under
  `/Users/zhangshenghe/Documents` and use the fixed ports 4183/4184/5183/8765 (all free at start). A clone on another
  machine would report the custody/harness gates BLOCKED, not PASS.
- This is an implementation-side verification. It is not independent acceptance.
- Session 1's clean-clone run of `e759bd6` (24/24 PASS, `evidence/session1/full-regression-e759bd6-summary.tsv`) is
  superseded by this run.
