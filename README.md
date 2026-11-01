# FlowAssert — product development workspace

Local product development on the Owner-accepted Phase 3A UI and Python Service. This repository is the current
development entry point.
**LOCAL / OFFLINE / SYNTHETIC RESEARCH ONLY.** No live n8n or HubSpot, no credentials, and no capture of external data.
The experimental local collector re-runs the pinned Evaluator on reviewed fixtures; it is not Phase 3B-1 work and has no
G1 grant. The pinned Python Evaluator is the only source of business verdicts.

Direction and decisions: [docs/product-dev/final-version/](docs/product-dev/final-version/).

| Path | What |
| --- | --- |
| `ui/` | React 19 + Vite UI (Evidence Atelier). Copied from the accepted `FlowAssert-Phase3A-UI`. |
| `service/` | Python Service (FastAPI, SQLite archive, pinned Evaluator). Copied from the accepted `FlowAssert-Phase3A-Service`. |
| `scripts/dev/` | Seed, run, identity check and full regression for this workspace. |
| `docs/product-dev/` | Source identities, round reports, screenshots, test evidence. |

Baseline commit `phase3a-baseline` holds the accepted bytes. Identities: [docs/product-dev/SOURCE_IDENTITIES.json](docs/product-dev/SOURCE_IDENTITIES.json).

## Run it

On a fresh clone run `scripts/dev/bootstrap.sh` once: it checks the tools (Node 22.12+ in the 22.x line,
24.x, or 26+; developed with 26.10; Python 3.14; a system
Python 3 for the read-only checks), installs `ui/node_modules` from the lock file and `service/.venv` from
`service/requirements.lock`, verifies the pinned identities and seeds the synthetic archives. Each stage names its
failure and log.

```sh
scripts/dev/seed.sh                 # synthetic SQLite archives dev-main (10), dev-single (5), dev-empty, dev-run-bound (6); verifies existing ones
scripts/dev/service.sh              # Service on 127.0.0.1:8765   (FA_STATE=dev-single | dev-empty | dev-run-bound for the other archives)
cd ui && npm run dev                # UI on http://127.0.0.1:5183
```

| Page | Address | Data |
| --- | --- | --- |
| Overview | `#/` | Service live results + archive (real) |
| Verifications | `#/verifications` (also `#/local/verifications`) | Service live results + archive (real); each case opens its live Detail |
| Verification Detail + Evidence | `#/local/verifications/SPEC-00N` | Service, live read |
| Detail by exact ID | `#/local/verification-lookup?verification_id=…` | Service, ID-lookup routes |
| History | `#/local/history`, `#/local/history/:historyId` | Service archive (real) |
| Capture runs | `#/capture` | not implemented — no action offered |
| Connections, Rules, Settings | `#/connections`, `#/rules`, `#/settings` | MOCK configuration demo |
| Demo overview / runs | `#/demo`, `#/demo/verifications` | MOCK demo |
| Interface states | `#/states` | simulated access states, never verdicts |

Stop the Service with Ctrl-C. With it stopped, the workspace pages show *Service unavailable* — never demo data.

## Verify it

```sh
/usr/bin/python3 -I -B scripts/dev/check_identities.py   # pinned Evaluator, frozen contracts, current backend source map
scripts/dev/regression.sh --portable NEW-LABEL            # self-contained gates: backend, identities, typecheck, lint, Vitest
scripts/dev/regression.sh --product NEW-LABEL             # + every Chrome/WebKit suite, CLS, responsive matrix (bootstrap.sh --product-harness)
scripts/dev/regression.sh NEW-LABEL                       # release: + historical custody; logs, exit codes, evidence in .dev-runtime/regression/NEW-LABEL/
```

Release acceptance requires the release profile. The product profile reads nothing outside this repository and lists
historical custody as NOT RUN; see
[REGRESSION_PROFILES.md](docs/product-dev/round-02-residual-closeout/REGRESSION_PROFILES.md).

A run writes only into its own git-ignored directory (`run-identity.tsv` names the commit). No gate writes into
`docs/`: the final `tracked-evidence` gate fails if any tracked file there changed. To keep a run as evidence, copy
it into `docs/` deliberately and commit it.

Gate status is PASS, FAIL, BLOCKED or NOT RUN (outside the profile); a run with a BLOCKED gate exits 3 and is not a pass. Every test runner
(pytest, Vitest, Playwright) and the 200-cell responsive matrix are checked against `scripts/dev/test-inventory.json`, so a skipped, missing or unexecuted
test or cell fails the run. The browser gates need Google Chrome and Playwright WebKit (`cd ui && npx playwright install
webkit`); `bootstrap.sh --product-harness` and `bootstrap.sh --harness` launch both and stop if either fails. Firefox is not run. Unit-test fixtures are
in the repository and identity-checked (`ui/src/test/fixtures/`, `service/contracts/`).

Two checks need sources outside this repository:
- **Protected-source custody** compares the genuine roots under `FLOWASSERT_PROTECTED_PARENT` (default: this checkout's
  parent); BLOCKED where they are absent. Gate `protected-custody` runs `scripts/dev/protected_custody_reconciled.sh`
  against the Owner-approved 2026-10-31 baseline. `scripts/dev/protected_custody.sh` still compares the historical
  baseline, which fails and is recorded as informational. A pass shows no change since that approval, not unbroken custody.
- **The ID-lookup and frozen-route browser suites** (`e2e-lookup`, `e2e-local`) run on the same runtime as `e2e-history`:
  the identity-checked copy of this workspace's Service, built by `scripts/dev/bootstrap.sh --product-harness`. They no
  longer use the historical Service copies, which refuse `phase3b=true`.
  See [docs/product-dev/ROUND_01_REPORT.md](docs/product-dev/ROUND_01_REPORT.md).

The current Service source identity is recorded separately in `scripts/dev/backend-current-identity.json`;
its map differs from the historical Phase 3A acceptance after the backend remediation and the Phase 3B
experimental local execution and admission boundary ([service/docs/phase3b/EXPERIMENTAL_ADMISSION_BOUNDARY.md](service/docs/phase3b/EXPERIMENTAL_ADMISSION_BOUNDARY.md)).
The UI reads the capture and admission fields the Service reports (`phase3b=true` on the two live Detail reads, and
`/api/v1/history/verifications*` for the archive), admits them in `ui/src/data/local/phase3b.ts`, and shows them on their
own status axes. They are the Service's own statements about a local synthetic run: never a verdict, and no proof of
capture or authenticity outside this Service. The reviewed fixtures report *Not implemented*. The historical
acceptance record is retained as evidence and does not confer acceptance on the modified code.
