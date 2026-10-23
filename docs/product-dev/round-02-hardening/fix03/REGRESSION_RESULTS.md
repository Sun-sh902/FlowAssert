# FIX03 — Regression results

**Status: PARTIAL — port-free gates only.** The Owner chose to run only port-free checks until FIX02 is independently
accepted. During this work the FIX02 reviewer's Playwright lookup suite was holding ports 5183 and 8765, so every
browser suite and the full regression are **NOT RUN**. Nothing below is reported as a pass for them.

## Run

| Gate | Tree | Result | Evidence |
| --- | --- | --- | --- |
| Vitest, baseline | `203f702`, clean | 1623 / 1623 passed | `evidence/regression/vitest-baseline-203f702.log` |
| FIX03 tests on the unfixed code | `203f702` export + `fix03.test.tsx` | **20 failed**, 1 passed (the control) — each failure is the defect | `evidence/reproduction/fix03-tests-on-203f702.log` |
| FIX03 tests on the fix | working tree | 21 / 21 passed | `evidence/reproduction/fix03-tests-on-worktree.log` |
| `scripts/dev/regression.sh --portable fix03-portable-worktree` | working tree (18 tracked changes + new files) | **PASS (portable gates only)**: backend-pytest, backend-inventory, protected-custody, dev-scripts, pinned-identities, ui-typecheck, ui-lint, ui-vitest (1644 = 1623 + 21), ui-vitest-inventory, tracked-evidence | `evidence/regression/portable-summary.tsv`, `portable-run-identity.tsv` |
| Vitest JSON + inventory | working tree | 1644 passed, 0 failed, 0 skipped; audit-mutant replay RAN (13); inventory OK | `evidence/regression/vitest-worktree.json` |

The pinned Evaluator, the four contracts and the history examples are byte-identical to the accepted sources
(`pinned-identities`, `protected-custody` PASS). No file under `service/` changed.

## Not run (pending FIX02 acceptance and free ports)

| Gate | Why it matters for FIX03 |
| --- | --- |
| `e2e-static` (Chrome, WebKit) | axe on Overview/Settings after the heading, `dl`, radio-group and list changes; keyboard; touch targets |
| `e2e-workspace` (Chrome, WebKit) | real Service: four axes, register text, case groups, record check on the Detail |
| `e2e-history`, `e2e-lookup` | `IntegrityTag` wording and the shared integrity mapping on real Service data |
| `e2e-local` | the changed Data provider locator |
| `rules-cls-repeat`, `rules-cls-probe` | unaffected by FIX03; part of the full run |
| Full `scripts/dev/regression.sh LABEL` | every gate together, with the port pre-check |

To complete: once FIX02 is accepted and ports 4183/4184/5183/8765 are free, run
`scripts/dev/regression.sh fix03-<sha>` on the commit, then copy its `summary.tsv` and `run-identity.tsv` here.
