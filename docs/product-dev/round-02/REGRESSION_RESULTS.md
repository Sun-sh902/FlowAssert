# Round 02 — regression results

**Verdict: NOT a full regression PASS.** 10 of 12 gates passed; 2 browser gates failed (below).

Authoritative run: `scripts/dev/regression.sh fresh-clone`, executed **in a fresh clone** of commit `86bec55`
after `scripts/dev/bootstrap.sh --harness`, with `FLOWASSERT_PROTECTED_PARENT=/Users/zhangshenghe/Documents`.
Started 2026-10-22T14:01:03Z. Logs, exit codes and probe data: [evidence/regression-fresh-clone/](evidence/regression-fresh-clone/summary.tsv).
No later full regression was run in the main workspace.

| Gate | Exit | Passed | Failed | Skipped | Did not run |
| --- | ---: | ---: | ---: | ---: | ---: |
| backend-pytest (incl. restored `test_protected_repository_integrity`) | 0 | 248 | 0 | 0 | 0 |
| pinned-identities (Evaluator, 4 contracts, 39-file backend map) | 0 | pass | — | — | — |
| ui-typecheck | 0 | — | — | — | — |
| ui-lint | 0 | — | — | — | — |
| ui-vitest | 0 | 1618 | 0 | 0 | 0 |
| e2e-static (Chrome + WebKit; a11y, responsive, keyboard, perf) | 0 | 136 | 0 | 24 | 0 |
| rules-cls-repeat (perf test ×20, Chrome) | 0 | 20 | 0 | 0 | 0 |
| rules-cls-probe (30 cold loads of `#/rules`) | 0 | 30/30 CLS = 0 | 0 | — | — |
| e2e-workspace (real Service; Chrome + WebKit) | 0 | 31 | 0 | 1 | 0 |
| e2e-history (accepted; Chrome + WebKit) | 0 | 68 | 0 | 8 | 0 |
| **e2e-lookup (accepted; Chrome + WebKit)** | **1** | 56 | **1** | 3 | 0 |
| **e2e-local (accepted Phase 2; Chrome + WebKit)** | **1** | 26 | **1** | 8 | **7** |

Skips: browser-specific tests (`test.skip` by project) and the Chrome-only screenshot test in WebKit. The 7 "did not
run" are the serial e2e-local tests after its failure — they are **unexecuted**, not passed.

## Failures

Both: `Error: response.allHeaders: Target page, context or browser has been closed` in the suites' network-capture
helper (`e2e-lookup/support.ts:179`, `e2e-local/support.ts:167`).

| Gate | Test |
| --- | --- |
| e2e-lookup | `[chrome] in-app navigation: legacy x/evidence refusal → lookup link → Back → Forward → Reload` |
| e2e-local | `[chrome] 12 · Service stopped: SERVICE_UNAVAILABLE, no seal, no demo data — then a real read once it is back` |

Mechanism: a response capture is still pending when the page closes — the accepted **F15** harness defect class
(Phase 3A register R05), previously observed in Firefox. Round 02 makes it reachable in Chrome: the live Detail now
also reads its archive list and exact-match candidates, so more requests can be in flight at page close. The
mitigation added in round 02 (waiting for the Detail's archive reads and settling the capture in e2e-local test 12)
passed 3/3 locally but **did not hold** in the fresh-clone run. Not fixed; not re-run to obtain a pass.

## Other execution facts

- `#/rules` CLS: baseline 0.137 on 30/30 cold loads ([evidence/rules-cls/before-30.json](evidence/rules-cls/before-30.json)); after the fix 0 on 30/30 (main workspace and fresh clone) and 20/20 perf-test repeats. Round 01 failure log preserved at `docs/product-dev/evidence/regression/round01-final/e2e-static.log`.
- Restored backend test: passes with the explicit protected parent; fails loudly (`FileNotFoundError`) with the default parent from a checkout outside `~/Documents`; a negative control (one altered baseline digest) fails as required.
- Accepted e2e-history during development: 5 consecutive full Chrome runs → 4 × 34/34, 1 failure (F05/F21, same capture mechanism, then mitigated); F14 and F05/F21 15/15 on `--repeat-each`. One earlier F14 failure was not captured in a retained log and is unexplained.
- Firefox: **not executed** (F15 documented limitation).
- Accessibility: axe WCAG 2.2 AA + best practice, 0 violations on Overview, Verifications, Detail, History, Capture runs — light/dark × 1440/375, Chrome and WebKit (inside e2e-workspace).
- Bootstrap from fresh clone: OK in 9 s (npm 126 packages from lock; venv == `requirements.lock`, 37 distributions; identities; seeds; harness runtimes `problems: []`). Failure diagnostics verified (exit 15 Python missing, exit 16 wrong version). Logs: [evidence/bootstrap-fresh-clone/](evidence/bootstrap-fresh-clone/).
- Protected roots (6 roots, digest + mtime): identical before and after Round 02 ([evidence/protected-roots-custody.json](evidence/protected-roots-custody.json)).
