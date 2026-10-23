# FIX02 — finding triage

## Starting point

| Item | Value |
| --- | --- |
| Branch | `product-dev/round-02-hardening` |
| Accepted FIX01 commit | `d34f882284141dd520f0ffb457b0985f50425c55`, "FIX01 — ACCEPTED FOR FIX02" (`/Users/zhangshenghe/Documents/FlowAssert-Product-Review/FIX01/final-audit-01/FINAL_REVIEW.md`, frozen SHA identical) |
| HEAD at start | `d34f882…` — equal to the accepted commit; `git status` clean |
| Round 02 closeout | `1d52026` ancestor of HEAD; no file under `docs/product-dev/round-02/`, `docs/product-dev/evidence/` or `docs/product-dev/screenshots/` modified (`git diff --stat 1d52026 HEAD` on those paths: empty, before and after FIX02) |
| Owner audit reports | Not supplied (as in FIX01 R2 / reviewer N-7). The findings below come from the FIX02 brief, Round 02 B1–B8, FIX01 open items and what verification found. None is claimed to close an audit item by number. |
| FIX02 commits | code `fd92903ec294b35416d435601f5342fcdca7a625`; reports on top (docs only) |

Every reproduction ran in a disposable clean clone of `d34f882` in the session scratchpad, after
`scripts/dev/bootstrap.sh --harness` (exit 0). The main workspace was not used to run suites. Evidence paths are
relative to `evidence/`.

## Findings

| ID | Finding | Disposition | Actual behavior at d34f882 | Reproduction | Evidence |
| --- | --- | --- | --- | --- | --- |
| G01 | e2e-lookup `[chrome] in-app navigation …` "Target page, context or browser has been closed" (Round 02 B1) | **CONFIRMED** — harness defect, fixed | 1 of 6 full-suite runs failed with the Round 02 error verbatim; the reloaded Detail's first evidence response arrived 3 ms after the last `settle()`, page closed 4 ms later, `allHeaders()` rejected unhandled | `FA_BROWSERS=chrome,webkit npx playwright test -c playwright.lookup.config.ts` ×6 with the diagnostic helper log | `before-d34f882/browser-failures/lookup-*` · BROWSER_FAILURE_ROOT_CAUSE.md |
| G02 | e2e-local `[chrome] 12 · Service stopped …` same error (B1) | **CONFIRMED** — same defect, fixed | 6 of 10 full-suite runs failed (Chrome; once also WebKit). The error fired in test 12 (2×) or in the next test (4×) | `… -c playwright.local.config.ts` ×10 | `before-d34f882/browser-failures/local-*` |
| G03 | Seven Phase 2 tests did not execute (B1) | **CONFIRMED** cause: serial-mode stop after the (false) failure, not worker teardown and not those tests | file-level `test.describe.configure({ mode: "serial" })`; 6–12 tests "did not run" per failing run | as G02 | BROWSER_FAILURE_ROOT_CAUSE.md §"Why seven…"; after the fix every one executes (REGRESSION_SUMMARY.tsv) |
| G04 | B2: "F15 now reachable in Chrome" | **CONFIRMED, reclassified**: request-lifecycle defect in the shared capture helper, reproduced in Chrome **and WebKit**; not assumed to be F15 | floating capture promise + snapshot-only `settle()` + uncaught `allHeaders()` in `e2e-lookup`, `e2e-local`, `e2e-history` `support.ts` | deterministic spec `ui/e2e/capture-lifecycle.spec.ts`: fails on d34f882 in both browsers | `before-d34f882/capture-lifecycle-spec.log` |
| G05 | B5: one unexplained e2e-history F14 failure (Round 02 development) | **NOT_REPRODUCED** | no retained log; e2e-history passed in every FIX02 run. Its helper had the same G04 pattern (now fixed), but no evidence ties the Round 02 failure to it | — | REMAINING_RISKS.md |
| G06 | perf report writing: 20 parallel repeats overwrite one file; stale files persist; no identity | **CONFIRMED**, fixed | `e2e/.output/perf-<browser>.json` written by every repeat; no browser version/repeat/viewport; `e2e/.output` keeps files of earlier runs (main workspace: `perf-chromium.json` from 2026-10-22) | inspection + clone `e2e/.output` after two runs | CLS_VERIFICATION.md |
| G07 | Page errors not recorded in CLS measurements | **CONFIRMED**, fixed | page error injected on `#/rules`: perf.spec exit 0, report without the error | diagnostic init script in scratch clone | `before-d34f882/perf-page-error/` → `after-helper-fix/perf-page-error/` (exit 1, error named) |
| G08 | Regression overwrites committed evidence | **CONFIRMED**, fixed | the regression's own e2e-workspace command rewrote **17 tracked files** (2 JSON, 15 PNG in `round-02/evidence/e2e-workspace`, `round-02/screenshots/after`) + 6 new files; gate exit 0 | `env FA_BROWSERS=chrome,webkit npx playwright test -c playwright.workspace.config.ts`; `git status` | `before-d34f882/custody/` · EVIDENCE_CUSTODY.md |
| G09 | Regression default run directory inside the tracked tree; no run identity | **CONFIRMED** (no overwrite: label reuse was already refused), fixed | default `docs/product-dev/evidence/regression/<LABEL>` → untracked files in `docs/`; commit not recorded | inspection | EVIDENCE_CUSTODY.md |
| G10 | Playwright gates green on exit code only | **CONFIRMED**, fixed | mandatory perf test switched to `test.skip`: `rules-cls-repeat` command exit **0**, "20 skipped" | diagnostic edit in scratch clone | `before-d34f882/playwright-skip/` |
| G11 | Browser provisioning inferred from a directory name; Chrome unchecked | **CONFIRMED**, fixed | `PLAYWRIGHT_BROWSERS_PATH=<empty>`: bootstrap `--harness` **BOOTSTRAP OK** (exit 0, no note); WebKit test then fails at launch | see BROWSER_PROVISIONING.md | `before-d34f882/provisioning/` |
| G12 | Rules CLS (Round 01 0.137) | **ALREADY_FIXED** (Round 02 `86bec55`); no layout/font change | perf ×20 (5 workers) 20/20, ×20 (1 worker) 20/20, cold probe 30/30 = 0, full static 136/0; negative control 0.137 on 30/30 | CLS_VERIFICATION.md | `before-d34f882/cls*` |
| G13 | `transferredKB` claims | **ALREADY_FIXED** / no code defect | metric unchanged (network bytes only, cache = 0). No current document relies on it; its meaning is now stated in perf.spec | `grep -rn transferredKB` | CLS_VERIFICATION.md |
| G14 | Custom integrity baseline (`FLOWASSERT_INTEGRITY_BASELINE`) | **ALREADY_FIXED** (FIX01 R9 decision kept) | unchanged since FIX01; used by no gate; not touched | inspection | — |
| G15 | FIX01 report-writing changes (summary status, BLOCKED exit 3, inventories) | **ALREADY_FIXED** — preserved | all kept; FIX02 adds gates without changing their semantics | dev-script tests 22/22 | — |
| G16 | Round 02 browser traces | **BLOCKED** | never written (`trace: "off"` / FA_TRACE unset) and the Round 02 clone no longer exists; only logs survive | — | BROWSER_FAILURE_ROOT_CAUSE.md; failure artifacts are now kept per run (`$OUT/artifacts/<gate>`) |
| G17 | Firefox | **NOT RUN** (not mandatory) | 155 (r1543) launches a blank page here; no Firefox suite executed | `ui/scripts/dev/browser-probe.mjs` | BROWSER_PROVISIONING.md |

No code was changed for G05, G12, G13, G14, G15, G16 or G17.

## Code changes (commit `fd92903`)

| File | For |
| --- | --- |
| `ui/e2e/capture-lifecycle.ts` (new), `ui/e2e-{lookup,local,history}/support.ts` | G01–G04 |
| `ui/e2e/capture-lifecycle.spec.ts` (new) | G04 deterministic regression test |
| `ui/e2e-local/local-research.spec.ts`, `ui/e2e-lookup/lookup.spec.ts` | G01/G02: one wait each for the Detail's first evidence read before the final `settle()`; no assertion changed |
| `scripts/dev/regression.sh` | G08, G09, G10, G11 (browsers gate), tracked-evidence gate |
| `ui/e2e-workspace/support.ts` | G08 (ignored defaults) |
| `scripts/dev/check_test_inventory.py`, `scripts/dev/test-inventory.json`, `scripts/dev/tests/test_dev_scripts.py` | G10 (+13 tests) |
| `ui/scripts/dev/browser-probe.mjs` (new), `scripts/dev/bootstrap.sh` | G11 |
| `ui/e2e/perf.spec.ts`, `ui/e2e/helpers.ts`, `ui/scripts/dev/cls-probe.mjs`, `scripts/dev/rules_cls_probe.sh` | G06, G07 |
| `README.md` | run directory, inventories, browsers |

Not changed: application source (`ui/src/**`), CSS and fonts, the Service, contracts, pinned identities, Playwright
configs, accepted harness scripts under `ui/scripts/phase2|phase3a`, every historical evidence file.
