# Regression profiles (residual closeout R02, R13)

Implementation-side description of `scripts/dev/regression.sh` as changed in the residual closeout. It is not an
acceptance claim.

## What each requirement belongs to

Every gate was traced to what it actually reads (`scripts/dev/bootstrap.sh`, `scripts/dev/prepare_harness_runtime.py`,
`ui/scripts/phase2/prepare_runtime.py`, `ui/scripts/phase3a/prepare_lookup_runtime.py`, the five Playwright configs and
their `support.ts`, `ui/src/test/contract-drift-mutations.test.ts`).

| Class | Requirement | Gates |
| --- | --- | --- |
| A. Product functionality | This repository's UI, its Service (`service/`), pinned Evaluator and contracts | backend-pytest, dev-scripts, pinned-identities, ui-typecheck, ui-lint, ui-vitest, e2e-static, rules-cls-*, e2e-workspace, e2e-history, responsive-matrix |
| B. Local synthetic research fixtures | `service/.runtime/dev-{main,single,empty}` (`scripts/dev/seed.sh`), `ui/.phase3a-runtime` copied from **this** workspace's Service and seeded `ui-{main,empty,corrupt,unverifiable}` (`prepare_harness_runtime.py`, `seed_states.py`, `evaluator_oracle.py`), vendored handoff bodies in `ui/src/test/fixtures/` | e2e-workspace, e2e-history, responsive-matrix, Vitest |
| C. Historical protected-source custody | The six genuine accepted roots under `FLOWASSERT_PROTECTED_PARENT` (`service/evidence/protected-before.json`); the accepted Phase 3A Service (`FlowAssert-Phase3A-Service`) and Phase 2 Service + handoff (`FlowAssert-Service`, `FlowAssert-Phase2-Support`, `FlowAssert-round03-oracle-fix/.../model.py`) at fixed absolute paths | protected-custody, e2e-lookup (ID-lookup runtime copied from the accepted Phase 3A Service), e2e-local (Phase 2 runtime copied from the accepted Phase 2 Service; expected Evaluator traces read from the Phase 2 handoff); optional Vitest replay of the independent UI audit's mutants (`FlowAssert-UI-Review`) |
| D. Browser / runtime | Google Chrome (channel `chrome`), Playwright WebKit, free ports 4183/4184/5183/8765, Python 3.14, system Python 3.9+ | browsers and every browser gate |
| E. Package installation | npm registry (`npm ci` from `ui/package-lock.json`), Python package index (`service/requirements.lock`), Playwright WebKit download | bootstrap only |

Finding: `e2e-history` and the responsive matrix needed only class A/B inputs, but `bootstrap.sh --harness` refused
to prepare anything (exit 30) unless all four class-C sources were readable. A product-only run was therefore
impossible, even though nothing in those gates reads a historical root. Separating them required no change to any
test or to the custody check.

## Profiles

| Profile | Command | Prerequisite | Gates run | Gates listed NOT RUN | Exit 0 means |
| --- | --- | --- | --- | --- | --- |
| Portable | `scripts/dev/regression.sh --portable LABEL` | `scripts/dev/bootstrap.sh` | backend-pytest (+inventory), protected-custody (BLOCKED 77 when the roots are absent, so the run exits 3), dev-scripts, pinned-identities, ui-typecheck, ui-lint, ui-vitest (+inventory), tracked-evidence | none (browser gates are simply not part of it, as before) | the self-contained gates passed **and** custody passed; not a product or release regression |
| Product | `scripts/dev/regression.sh --product LABEL` | `scripts/dev/bootstrap.sh --product-harness` (reads nothing outside the repository) | portable gates except custody, plus browsers, e2e-static (+inv), rules-cls-repeat (+inv), rules-cls-probe, e2e-workspace (+inv), e2e-history (+inv), responsive-matrix (+inv), tracked-evidence | protected-custody, e2e-lookup (+inv), e2e-local (+inv) — written to `summary.tsv` with exit `-` and status `NOT RUN` | every product gate passed; the verdict line says the historical gates did not run and that this is not the complete release regression |
| **Release** (required for release acceptance) | `FLOWASSERT_PROTECTED_PARENT=<parent of the genuine roots> scripts/dev/regression.sh LABEL` | `scripts/dev/bootstrap.sh --harness` and the genuine historical roots | every gate: the product gates plus protected-custody, e2e-lookup (+inv), e2e-local (+inv) | none | every gate passed (26 gates: FIX04's 24 plus responsive-matrix and its inventory) |
| Historical custody only | `FLOWASSERT_PROTECTED_PARENT=<parent> scripts/dev/protected_custody.sh` | `service/.venv` | the restored Phase 3A custody test, unchanged | — | 0 verified · 1 difference or failure · 77 BLOCKED (a root missing or unreadable; never a pass) |
| Complete research environment | Release profile + historical custody on the same machine | as release | as release | — | as release |

Ports 4183/4184/5183/8765 must be free for the product and release profiles. Each run writes only into its own new,
git-ignored directory; `tracked-evidence` fails the run if anything under `docs/` or `ui/docs/` changed.

### Expected outcomes

| Situation | Portable | Product | Release |
| --- | --- | --- | --- |
| This Mac, genuine roots present, harness prepared | exit 0 | exit 0, three historical gates (5 rows with inventories) NOT RUN | exit 0, all gates PASS |
| Clean machine without the historical roots | exit 3 (custody BLOCKED) | exit 0 if the product is sound | not runnable: `bootstrap.sh --harness` stops BLOCKED (exit 30) before writing anything |
| Roots present but altered | exit 1 (custody FAIL) | exit 0 (custody NOT RUN — it is not part of this profile) | exit 1 |

## Changes made

- `scripts/dev/bootstrap.sh --product-harness`: prepares only `ui/.phase3a-runtime` (unchanged scripts, same completion
  marker as `--harness`, so a later `--harness` keeps it) and checks the browsers. `--harness` behaviour, its source
  list and its BLOCKED exit are unchanged.
- `scripts/dev/regression.sh`: `--product` mode; gates outside a profile are written as `NOT RUN`; the
  `responsive-matrix` and `responsive-matrix-inventory` gates were added to the product and release profiles.
- Custody assertions and the custody test are unchanged; nothing substitutes for a missing root.
- `ui/src/test/contract-drift-mutations.test.ts`: the optional audit-mutant replay now looks under
  `FLOWASSERT_PROTECTED_PARENT` (default this checkout's parent) instead of a hard-coded user path (R09).

## Responsive gate

See [RESPONSIVE_GATE_RESULTS.md](RESPONSIVE_GATE_RESULTS.md).

## What no profile claims

- No profile is a cross-machine reproducibility claim for class C: the release profile can run only where the genuine
  roots exist (today, this Mac).
- The product profile is a product regression, not the complete regression: it never certifies custody or the
  Phase 2 / Phase 3A Service runs.
- Firefox, physical screen readers and physical devices are not part of any profile.
