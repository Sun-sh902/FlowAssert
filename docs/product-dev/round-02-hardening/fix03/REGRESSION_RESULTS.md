# FIX03 — Regression results

**Final: `scripts/dev/regression.sh fix03-529db23` → PASS (all gates), 24/24, 0 FAIL, 0 BLOCKED, exit 0.**
Commit `529db23d4cdf47369059bc0d4db487a5b5a9ed19`, clean tree (`worktree_changes 0`), full mode, ports pre-checked,
2026-10-23T13:26Z, Darwin 27.2.0 arm64. Evidence: `evidence/regression/full-529db23-*`.

## Order of runs

Every run is recorded, including the one that failed.

| # | Run | Tree | Result | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Vitest baseline | `203f702`, clean | 1623 / 1623 passed | `vitest-baseline-203f702.log` |
| 2 | FIX03 tests on the unfixed code | `203f702` export + `fix03.test.tsx` | **20 failed**, 1 passed (the control); every failure is the defect | `../reproduction/fix03-tests-on-203f702.log` |
| 3 | FIX03 tests on the fix | working tree | 21 / 21 passed | `../reproduction/fix03-tests-on-worktree.log` |
| 4 | `regression.sh --portable fix03-portable-worktree` | working tree. It ran while the FIX02 reviewer held ports 5183/8765; portable mode uses no ports. | PASS (portable gates only), 10/10 | `portable-summary.tsv` |
| 5 | `regression.sh fix03-4f13a13` (full) | commit `4f13a13`, clean | **FAIL** — 23 PASS, `e2e-history` + its inventory FAIL. See *Failure on 4f13a13*. | `full-4f13a13-summary.tsv`, `full-4f13a13-e2e-history.log` |
| 6 | the failing test alone after the fix | working tree, CSS change only | 2 / 2 passed (Chrome, WebKit) | `history-layout-test-after-css-fix.log` |
| 7 | `regression.sh fix03-529db23` (full) | commit `529db23`, clean | **PASS (all gates)** | `full-529db23-summary.tsv`, `-console.log`, `-run-identity.tsv`, `-*-inventory.log` |

## Final run, by gate

| Gate | Result | Count |
| --- | --- | --- |
| backend-pytest / backend-inventory | PASS / PASS | 247 passed (1 deselected, as in the inventory) |
| protected-custody | PASS | genuine accepted roots |
| dev-scripts | PASS | |
| pinned-identities | PASS | Evaluator, 4 contracts, examples, backend map unchanged |
| ui-typecheck, ui-lint | PASS | |
| ui-vitest / inventory | PASS / PASS | 1644 passed (1623 + 21 FIX03), 0 failed, 0 skipped; audit-mutant replay RAN |
| browsers | PASS | Chrome + Playwright WebKit |
| e2e-static / inventory | PASS / PASS | 140 passed, 24 skipped as declared in the inventory (Chrome, WebKit) |
| rules-cls-repeat / inventory, rules-cls-probe | PASS | 20 repeats |
| e2e-workspace / inventory | PASS / PASS | 31 passed, 1 declared skip — real Service, four axes |
| e2e-history / inventory | PASS / PASS | 68 passed, 8 declared skips |
| e2e-lookup / inventory | PASS / PASS | 57 passed, 3 declared skips |
| e2e-local / inventory | PASS / PASS | 34 passed, 8 declared skips |
| tracked-evidence | PASS | no tracked `docs/` file changed during the run |

Firefox is not run (as in FIX01/FIX02).

## Failure on 4f13a13

`e2e-history/history.spec.ts:606` failed in Chrome and WebKit:
`light #/local/history/hist_6f7924f0… @375 — expected overflow <= 0, received 220`.

**Cause.** FIX03 added a visually hidden state word (`sr-only`, absolutely positioned) inside `IntegrityTag`. The
evidence ledger renders that tag inside a horizontally scrolling table at 375 px, and the scroller is not positioned,
so the absolute span escaped it and widened the page by 220 px.

**Fix (`529db23`).** `.fa-itag { position: relative }` in `ui/src/styles/atelier.css`, so the span is contained by
its own tag. That one change made the failing test pass in both browsers (run 6), and the next full run passed every
gate (run 7). No test was changed for this.

## The four axes on the real Service

`e2e-workspace` reads the running local Service in Chrome and WebKit. It checks Capture and Admission *Not
implemented*, the Archive axis with the Service's record check, and the Evaluator verdict copied from the live result,
for each of SPEC-001…005. The values match the in-process read recorded in DOMAIN_SEMANTICS_VERIFICATION.md.
