# Round 02 — changed files

Implementation commit `86bec55` on `product-dev/round-02` (parent `90d3bc7`, Round 01). `git diff --name-status 90d3bc7..86bec55`, excluding `docs/product-dev/round-02/`. Accepted Phase 3A sources, the pinned Evaluator and the contracts are unchanged (`scripts/dev/check_identities.py`: no problems).

| Status | File | Change |
| --- | --- | --- |
| A | scripts/dev/bootstrap.sh | Fresh-clone setup: tools, `npm ci`, venv from lock (freeze == lock), identities, seeds, `--harness` runtimes |
| A | scripts/dev/prepare_harness_runtime.py | Harness runtime from the workspace Service, checked against final accepted identities |
| M | scripts/dev/regression.sh | Restored backend test, Chrome + WebKit, Rules CLS repeat + probe gates, configurable evidence dir |
| M | scripts/dev/seed.sh, scripts/dev/service.sh | `dev-single` state; create only missing states |
| A | service/evidence/protected-before.json | Accepted baseline (SHA-256 `a12bc4b2…`), byte copy |
| M | service/scripts/protected_integrity.py | Explicit protected parent, pinned baseline digest, C-locale git, missing root fails |
| A | ui/src/data/workspace/comparison.ts | Identity, comparison states, exact match, result relation (pure) |
| A | ui/src/data/serviceStatus.ts | Status store and exchange classification |
| A | ui/src/lib/useLiveCases.ts, ui/src/lib/useWorkspaceCases.ts | Bounded live reads + archive read per case |
| A | ui/src/components/workspace/Comparison.tsx | Comparison chip, live/archived verdict cells, summary counts |
| A | ui/src/components/workspace/ArchiveMatch.tsx | Detail → Archive exact match panel |
| A | ui/src/components/shell/ServiceStatus.tsx | Top-bar Service status + Check |
| M | ui/src/pages/Workspace.tsx | Overview and Verifications rebuilt around live vs archived |
| M | ui/src/pages/VerificationDetail.tsx, ui/src/pages/History.tsx | Status slot after the verdict; archive match; "1 row supplied"; link to current result |
| M | ui/src/components/workspace/StatusAxes.tsx | Single archive read feeds axes + match; settledness attributes |
| M | ui/src/components/shell/AppShell.tsx | Static host text replaced by ServiceStatus |
| M | ui/src/data/local/provider.ts | `exchange` reports outcomes to the status store |
| M | ui/src/adapters/wireToView.ts, ui/src/domain/view.ts | `resultCanonical` on local run facts |
| M | ui/src/styles/index.css | Metric-matched fallback faces (Rules CLS fix) |
| A | ui/scripts/dev/cls-probe.mjs | Layout-shift attribution probe |
| A | ui/src/test/comparison.test.ts, ui/src/test/archive-match.test.tsx | New unit/component tests |
| M | ui/src/test/workspace.test.tsx | Rewritten for live + archive model |
| M | ui/e2e-workspace/support.ts, ui/e2e-workspace/workspace.spec.ts | dev-single, match, status, comparison, after screenshots |
| M | ui/e2e-history/history.spec.ts | F20 permits exactly this case's candidate Details; F21 settles reads before close |
| M | ui/e2e-local/local-research.spec.ts | Mode-separation expectation; `waitForCase` waits for archive reads; settle in test 12 |

No accepted test was deleted. 31 files, +18 554 / −529 (the bulk is the 2.4 MB baseline JSON).
