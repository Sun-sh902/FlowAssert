# FIX01 — test execution matrix

Status words: **PASS** executed and passed · **FAIL** executed and failed · **BLOCKED** required source absent, did not run ·
**NOT RUN** optional historical evidence absent, reported · **OUT OF SCOPE** not attempted in FIX01.

## Portable (category A — must execute anywhere; required)

| Suite | Tests | Before, clean clone, siblings absent (1d52026) | After, clean clone, siblings unreadable (af65bf4) |
| --- | ---: | --- | --- |
| Backend pytest (portable set) | 247 | 247 passed, but gate exit 1 (custody test mixed in) | **PASS** 247 |
| Backend inventory | — | did not exist | **PASS** |
| Dev-script tests | 9 | did not exist | **PASS** 9 |
| Pinned identities | — | PASS | **PASS** |
| UI typecheck / lint | — | not re-run before | **PASS** / **PASS** |
| Vitest, required | 1610 | exit 0 with **797 skipped**, 12 not collected (false green) | **PASS** 1610, 0 skipped |
| Vitest inventory | — | did not exist (applied afterwards to that run: FAIL, 98 problems) | **PASS** |

Required Vitest files (count = required tests; all executed after the fix):
access-states 23 · archive-match 4 · comparison 12 · connections 5 · contract-drift-mutations 79 · contract-drift-runtime 3 ·
contract-drift 32 · detail 15 · evidence-mode-switch-race 90 · **fixture-identity 5 (new)** · fixtures 8 · history-contract-drift 19 ·
local-detail 24 · local-provider 30 · local-validation 29 · lookup-addressability 120 · lookup-contract-drift 19 · lookup-detail 10 ·
lookup-gate 102 · overview 10 · p3a-aud-002-validator 224 · phase3a-canonical 12 · phase3a-gate 130 · phase3a-history-decode 55 ·
phase3a-history-pages 86 · phase3a-history-provider 103 · phase3a-ids 240 · phase3a-integrity 14 · provider 15 · remediation 26 ·
rules 10 · settings 7 · shell 7 · uia009-nullable-label 14 · verifications 7 · workspace 21.
Source of truth: `scripts/dev/test-inventory.json`.

## Historical / external (category B — needs genuine sources outside the repository)

| Check | Without the sources | With the genuine sources (this machine) |
| --- | --- | --- |
| Protected-source custody (`test_protected_repository_integrity`, 6 roots, baseline `a12bc4b2…`) | **BLOCKED** (exit 77, roots listed) | **PASS** 1/1 |
| Independent UI audit mutant replay (13 tests) | **NOT RUN** (reported) | **PASS** 13/13 (RAN) |
| Fixture cross-check against the accepted originals (`FLOWASSERT_*` overrides) | n/a | **PASS** 1623/1623 |
| Phase 3A custody maps (`custody.py`, 6 roots) | n/a | **PASS** — equal to Round 01/02 records |
| `bootstrap.sh --harness` | **BLOCKED** (exit 30) | **PASS** (build + idempotent rerun) |

## Browser gates — OUT OF SCOPE (FIX02)

e2e-static, rules-cls-repeat, e2e-workspace, e2e-history, e2e-lookup, e2e-local, Firefox: **not run as a regression verdict
in FIX01.** Two incidental facts, not a verdict: (1) the rewritten `rules_cls_probe.sh` gate ran once on its own, PASS 30/30
CLS 0; (2) during the 14a0b77 pre-check defect (F19) the full gate list ran in a clone without harness runtimes —
e2e-history, e2e-lookup and e2e-local failed for that reason (`after-14a0b77/precheck-defect-run/summary.tsv`).
**The Round 02 regression is not declared green.** Known browser failures B1/B2 remain open.
