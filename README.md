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

Requires Node 20+ and the copied dependencies (`ui/node_modules`, `service/.venv`, both gitignored; on a fresh
clone copy them from the accepted repositories, or `npm ci` / install `service/requirements.lock`).

```sh
scripts/dev/seed.sh                 # once: synthetic SQLite archives dev-main (10 evaluations) and dev-empty
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
scripts/dev/regression.sh NEW-LABEL                       # every gate; logs + exit codes in docs/product-dev/evidence/regression/
```

The accepted browser suites need their isolated runtimes once (inside `ui/`, all gitignored):
`scripts/phase3a/prepare_runtime.py`, `seed_states.py`, `evaluator_oracle.py`, `prepare_lookup_runtime.py`,
`scripts/phase2/prepare_runtime.py`. See [docs/product-dev/ROUND_01_REPORT.md](docs/product-dev/ROUND_01_REPORT.md).
