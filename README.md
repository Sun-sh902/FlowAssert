# FlowAssert — product development workspace

Local product development on the Owner-accepted Phase 3A UI and Python Service.
**LOCAL / OFFLINE / SYNTHETIC RESEARCH ONLY.** No live n8n or HubSpot, no credentials, no capture pipeline,
no Phase 3B-1 work. The pinned Python Evaluator is the only source of business verdicts.

| Path | What |
| --- | --- |
| `ui/` | React 19 + Vite UI (Evidence Atelier). Copied from the accepted `FlowAssert-Phase3A-UI`. |
| `service/` | Python Service (FastAPI, SQLite archive, pinned Evaluator). Copied from the accepted `FlowAssert-Phase3A-Service`. |
| `scripts/dev/` | Seed, run, identity check and full regression for this workspace. |
| `docs/product-dev/` | Source identities, round reports, screenshots, test evidence. |

Baseline commit `phase3a-baseline` holds the accepted bytes. Identities: [docs/product-dev/SOURCE_IDENTITIES.json](docs/product-dev/SOURCE_IDENTITIES.json).

## Run it

On a fresh clone run `scripts/dev/bootstrap.sh` once: it checks the tools (Node 20+, Python 3.14, a system
Python 3 for the read-only checks), installs `ui/node_modules` from the lock file and `service/.venv` from
`service/requirements.lock`, verifies the pinned identities and seeds the synthetic archives. Each stage names its
failure and log.

```sh
scripts/dev/seed.sh                 # synthetic SQLite archives dev-main (10), dev-single (5), dev-empty; verifies existing ones
scripts/dev/service.sh              # Service on 127.0.0.1:8765   (FA_STATE=dev-empty for the empty archive)
cd ui && npm run dev                # UI on http://127.0.0.1:5183
```

| Page | Address | Data |
| --- | --- | --- |
| Overview | `#/` | Service archive (real) |
| Verifications | `#/verifications` | Service archive (real); each case opens its live Detail |
| Verification Detail + Evidence | `#/local/verifications/SPEC-00N` | Service, live read |
| History | `#/local/history` | Service archive (real) |
| Capture runs | `#/capture` | not implemented — no action offered |
| Connections, Rules, Settings | `#/connections` … | MOCK configuration demo |
| Demo overview / runs | `#/demo`, `#/demo/verifications` | MOCK demo |

Stop the Service with Ctrl-C. With it stopped, the workspace pages show *Service unavailable* — never demo data.

## Verify it

```sh
/usr/bin/python3 -I -B scripts/dev/check_identities.py   # pinned Evaluator, frozen contracts, backend source map
scripts/dev/regression.sh --portable NEW-LABEL            # self-contained gates: backend, identities, typecheck, lint, Vitest
scripts/dev/regression.sh --product NEW-LABEL             # + Chrome/WebKit suites, CLS, responsive matrix (bootstrap.sh --product-harness)
scripts/dev/regression.sh NEW-LABEL                       # release: every gate; logs, exit codes, evidence in .dev-runtime/regression/NEW-LABEL/
```

Release acceptance requires the release profile. The product profile reads nothing outside this repository and lists
historical custody, `e2e-lookup` and `e2e-local` as NOT RUN; see
[REGRESSION_PROFILES.md](docs/product-dev/round-02-residual-closeout/REGRESSION_PROFILES.md).

A run writes only into its own git-ignored directory (`run-identity.tsv` names the commit). No gate writes into
`docs/`: the final `tracked-evidence` gate fails if any tracked file there changed. To keep a run as evidence, copy
it into `docs/` deliberately and commit it.

Gate status is PASS, FAIL, BLOCKED or NOT RUN (outside the profile); a run with a BLOCKED gate exits 3 and is not a pass. Every test runner
(pytest, Vitest, Playwright) is checked against `scripts/dev/test-inventory.json`, so a skipped, missing or unexecuted
test fails the run. The browser gates need Google Chrome and Playwright WebKit (`cd ui && npx playwright install
webkit`); `bootstrap.sh --harness` launches both and stops if either fails. Firefox is not run. Unit-test fixtures are
in the repository and identity-checked (`ui/src/test/fixtures/`, `service/contracts/`).

Two checks need sources outside this repository:
- **Protected-source custody** (`scripts/dev/protected_custody.sh`, gate `protected-custody`) compares the genuine
  accepted roots under `FLOWASSERT_PROTECTED_PARENT` (default: this checkout's parent); BLOCKED where they are absent.
- **The accepted ID-lookup and Phase 2 browser suites** (`e2e-lookup`, `e2e-local`) need their isolated runtimes:
  `scripts/dev/bootstrap.sh --harness`, which reads the accepted read-only sources at fixed absolute paths and stops
  BLOCKED if they are absent. The history runtime, built from this workspace's own Service, needs only
  `--product-harness`.
  See [docs/product-dev/ROUND_01_REPORT.md](docs/product-dev/ROUND_01_REPORT.md).
