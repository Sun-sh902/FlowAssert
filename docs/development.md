# Development

English | [简体中文](development.zh-CN.md)

How FlowAssert is built and tested, and how to run the Service and UI locally. These sections were in the [README](../README.md) until 0.5.0 and are unchanged, apart from relative links, which now start from `docs/`.

- [Quick start: run the Service and UI](#quick-start-run-the-service-and-ui)
- [Architecture](#architecture)
- [Backend](#backend)
- [Frontend](#frontend)
- [Testing](#testing)
- [Extending it](#extending-it)
- [Repository layout](#repository-layout)
- [Project history](#project-history)

## Quick start: run the Service and UI

### Requirements

| Tool | Version |
| --- | --- |
| Python | 3.14, for the Service |
| System Python 3 | `/usr/bin/python3`, for isolated read-only checks |
| Node.js | 22.12+ in the 22 line, 24, or 26+ |
| npm, git, lsof, curl | Any recent version |
| Google Chrome and Playwright WebKit | Browser test suites only |

It was developed and tested on macOS on Apple silicon. Other platforms are untested.

### Install

```sh
scripts/dev/bootstrap.sh
```

This installs exact dependencies from the lock files, verifies pinned file identities, and creates the synthetic archives. Each stage names its failure and log. If `python3.14` is not on your `PATH`, point to it:

```sh
FA_PYTHON=/path/to/python3.14 scripts/dev/bootstrap.sh
```

### Run

In one terminal:

```sh
scripts/dev/service.sh
```

In another:

```sh
cd ui
npm run dev
```

Open <http://127.0.0.1:5183>. Stop either process with Ctrl-C. With the Service stopped, the pages show *Service unavailable*, never demo data.

Choose a different archive with `FA_STATE`:

| State | Contents |
| --- | --- |
| `dev-main` (default) | 10 archived evaluations: 5 cases, 2 batches |
| `dev-single` | 5 archived evaluations, one per case |
| `dev-empty` | A valid empty archive |
| `dev-run-bound` | 6 archived evaluations; the newest `SPEC-001` has a local receipt |

```sh
FA_STATE=dev-run-bound scripts/dev/service.sh
```

### Pages

| Page | Address | Data |
| --- | --- | --- |
| Overview | `#/` | Service |
| Verifications | `#/verifications` | Service |
| Verification detail and evidence | `#/local/verifications/SPEC-001` | Service |
| Detail by exact ID | `#/local/verification-lookup?verification_id=SPEC-001` | Service |
| History | `#/local/history` | Service archive |
| Capture runs | `#/capture` | Not implemented |
| Connections, Rules, Settings | `#/connections`, `#/rules`, `#/settings` | Mock |
| Demo | `#/demo`, `#/demo/verifications` | Mock |
| Interface states | `#/states` | Simulated |

In the UI, **live** means the result computed from a fixture when the Service started. It is not a fresh observation of any external system.

## Architecture

```text
Browser (React, hash routes)
   │  relative /api/v1/...  GET only
   ▼
Vite API gate (dev and preview only; exact route and query allowlist)
   │
   ▼
FastAPI Service on 127.0.0.1:8765
   ├─ Catalog: five results computed at startup, held in memory
   └─ ArchiveStore: append-only SQLite
          ▲ written only by local commands
archive_cli.py, seed_run_bound.py ──> pinned Evaluator

flowassert-verify (offline/)   separate; local CSV files only
```

There is no write route over HTTP. A static UI build has no gate, so its Service pages show *Service unavailable*.

The two evaluators are separate. The Service and UI use the frozen Evaluator v1, whose digest is pinned. `offline/` uses Evaluator v2, which supports selected fields and has had no independent review. The tests check that the two agree on the cases they share.

## Backend

Python 3.14, FastAPI, Pydantic, jsonschema and SQLite. Source is in `service/`.

### Modules

| File | Role |
| --- | --- |
| `app/main.py` | Application, frozen Detail and Evidence routes, error envelope, boundary middleware |
| `app/service.py` | Catalog, startup evaluation, signed evidence pagination |
| `app/adapter.py` | Calls the pinned Evaluator and checks its input was not changed |
| `app/identity.py` | Canonical JSON, digests, and pinned source identity checks |
| `app/validation.py` | Frozen schema validation and cross-field invariants |
| `app/models.py` | Pydantic models generated from the frozen OpenAPI |
| `app/history_api.py` | History routes |
| `app/history_store.py` | SQLite archive, publication, integrity checks, admission |
| `app/history_security.py` | Private files, signing keys, history cursors |
| `app/verification_lookup.py` | Exact-ID query routes |
| `app/local_boundary.py` | Host and Origin checks |
| `app/execution_collector.py` | Experimental run in a separate process, with an HMAC receipt |
| `app/admission_models.py`, `app/admission_serialization.py` | Experimental status types and their public form |
| `archive_cli.py` | Local `init`, `seed` and `check` commands |
| `run_history.py` | Supported launcher, with all routes |
| `run.py` | Frozen Phase 1 launcher, with two routes |

### HTTP API

All routes are GET and are served only on loopback.

| Route | Purpose |
| --- | --- |
| `/api/v1/verifications/{id}` | One result. `?phase3b=true` adds capture and admission fields |
| `/api/v1/verifications/{id}/evidence` | Its evidence, paged |
| `/api/v1/verification-lookup?verification_id=` | The same Detail, with the ID as query data |
| `/api/v1/verification-evidence?verification_id=` | The same evidence, with the ID as query data |
| `/api/v1/history` | Archive list, frozen form |
| `/api/v1/history/{history_id}` | One archived evaluation, frozen form |
| `/api/v1/history/{history_id}/evidence` | Its archived evidence |
| `/api/v1/history/verifications` | Archive list with experimental status fields |
| `/api/v1/history/verifications/{history_id}` | Archived evaluation with those fields |
| `/api/v1/history/verifications/{history_id}/evidence` | Archived evidence; the UI gate does not forward this route |

Contracts are in [`service/contracts/`](../service/contracts/). Errors use one envelope:

```json
{
  "error": {
    "code": "run_not_found",
    "message": "Offline request could not be completed.",
    "request_id": "…",
    "retryable": false,
    "details": []
  }
}
```

| Status | Meaning |
| --- | --- |
| 400 | Bad query, or forged or mismatched cursor |
| 403 | Host or Origin refused |
| 404 | Not found |
| 409 | Snapshot conflict or expired snapshot |
| 422 | Invalid parameter |
| 503 | Source identity, integrity, or archive failure |

### Snapshots and cursors

| Namespace | Example | Lifetime |
| --- | --- | --- |
| Catalog | `snapshot-…` | Changes on every Service start, because it includes execution times |
| History | `history-snapshot_…` | Permanent; derived from the archived content |
| History list | `list_…` | Fixes one list view at a high-water mark |

Cursors are HMAC-signed and bound to their query scope. A forged cursor returns 400. An authentic cursor whose snapshot has gone returns 409.

### Archive

`service/migrations/001.sql` defines `archive_meta`, `archives`, `records`, `evidence` and `seed_sets`.

- Triggers block changes to published content and any deletion.
- Publication moves from `BUILDING` to `PUBLISHED` in one transaction, and replays the Evaluator first.
- `history_id` is `hist_` plus the SHA-256 of the canonical candidate.
- Each read checks file safety, schema, content digests, and record and evidence relationships.
- A failed check returns 503 with an integrity outcome, never partial data.

An archive candidate must semantically equal a reviewed fixture, so nothing outside the five cases can be archived.

### Experimental receipts

`execution_collector.py` runs the Evaluator in a separate process and signs a receipt binding input, result, Evaluator digest, context, and the full candidate. Only `scripts/dev/seed_run_bound.py` calls it; no HTTP route does.

`CAPTURED_COMPLETE` and `ADMITTED_RUN_BOUND` mean only that these local checks passed. The key sits on the same host, so a receipt cannot prove external capture. Live reads always report *Not implemented*. See [EXPERIMENTAL_ADMISSION_BOUNDARY.md](../service/docs/phase3b/EXPERIMENTAL_ADMISSION_BOUNDARY.md).

## Frontend

React 19, TypeScript, Vite and Tailwind, in `ui/`. The design system is called Evidence Atelier ([DESIGN_SYSTEM.md](../ui/docs/DESIGN_SYSTEM.md)).

The frontend never calculates a verdict. It receives, validates, and displays what the Service reports.

### Data flow

```text
exchange       GET only, no credentials, no redirects, time and size limits
  ▼
decode         frozen schema, then cross-field checks; refuse the whole body on any failure
  ▼
adapter        wire data to view models
  ▼
hook           request order, cancellation, snapshot pinning
  ▼
page
```

| Path | Role |
| --- | --- |
| `ui/server/localApiGate.ts` | Dev and preview API allowlist |
| `ui/src/data/local/` | Service provider, decoding, canonical JSON, ID rules, evidence chain |
| `ui/src/data/history/` | Archive provider, decoding, list chain |
| `ui/src/data/workspace/` | Live and archived comparison |
| `ui/src/data/contract/` | Wire types and exact schema copies |
| `ui/src/domain/` | View models, status axes, integrity rules |
| `ui/src/adapters/` | Wire data to view models |
| `ui/src/lib/` | Router, read lifecycle hooks, formatting |
| `ui/src/pages/`, `ui/src/components/` | Interface |
| `ui/src/mocks/` | Demo fixtures |
| `ui/src/lab/` | Design experiments, outside the product build |

### Separate vocabularies

These are kept apart so that one kind of problem is never reported as another.

| Vocabulary | Values | Question |
| --- | --- | --- |
| Verdict | 4 states | What is the business result? |
| Access state | 8 states, such as `LOADING` and `SERVICE_UNAVAILABLE` | How did this read go? |
| Integrity | `verified`, `failed`, `unverifiable`, `pending` | Does content match its digests? |
| Status axes | Capture, Admission, Archive, Verdict | What happened at each step? |
| Comparison | 8 states, such as `SAME_INPUT_AGREE` | How does live relate to archived? |

So a stopped Service shows `NO_VERDICT`, not Unverified. A difference between live and archived results is a diagnostic, not a Mismatch.

### Interface language

The interface is English by default. The `EN` and `中文` switch at the bottom of the rail stores the choice in this browser and reloads the page.

Simplified Chinese is a presentation layer in `ui/src/i18n/`. A catalogue keyed by the English source translates interface text and accessible names. It never touches providers, decoders or view models. Evaluator reasons, the Service's assurance statements, identifiers, digests, evidence values and technical validator diagnostics stay exactly as supplied.

### Integrity and read behavior

- Evidence pages must concatenate to exactly the references the Detail lists. Duplicates, gaps, reordering and cursor cycles are refused.
- The browser rebuilds Python's canonical JSON from a lossless parse and recomputes SHA-256. If it cannot reproduce the bytes, the result is `not_checkable`, never a pass.
- Monotonic clock readings stay as decimal text, because they can exceed JavaScript's safe integers.
- There is no polling, caching, or automatic retry. Live reads run at most two at a time, and late answers are dropped.

A matching digest shows that two values from the same Service agree. It proves nothing about origin.

## Testing

| Layer | Tool | Scope |
| --- | --- | --- |
| Backend | pytest | Over 300 tests on routes, archive, cursors, receipts, failure paths |
| Scripts and offline check | pytest | Dev tooling, CSV check, agreement with Evaluator v1 |
| Frontend | Vitest | Over 1,800 tests, including contract drift, hostile responses and the Chinese interface |
| Browser | Playwright | Chrome and WebKit suites for workspace, history, lookup, gate security, accessibility |
| Layout | Custom | 200-cell responsive matrix and layout-shift checks |
| Identity | `check_identities.py` | Pinned Evaluator, contracts, and backend source map |

Run a profile:

```sh
scripts/dev/regression.sh --portable NEW-LABEL   # backend, identities, typecheck, lint, Vitest
scripts/dev/regression.sh --product NEW-LABEL    # plus every browser suite and the matrix
scripts/dev/regression.sh NEW-LABEL              # release: plus historical custody
```

The browser profiles first need:

```sh
scripts/dev/bootstrap.sh --product-harness
cd ui && npx playwright install webkit
```

Gate status is PASS, FAIL, BLOCKED or NOT RUN. A run with a BLOCKED gate exits 3 and is not a pass. Test counts are checked against `scripts/dev/test-inventory.json`, so a skipped or missing test fails the run. Results go to `.dev-runtime/regression/LABEL/`.

**In your clone**, the `protected-custody` gate reports BLOCKED because it compares sibling folders from the original machine. Those folders are not published. Use `--product` for the fullest check that works elsewhere.

## Extending it

The Service was built to fail on anything unreviewed, so several limits are deliberate and hardcoded:

| Limit | Location |
| --- | --- |
| Only `phone`, only exact comparison | `service/vendor/model.py`, `app/models.py`, contracts |
| Five cases, `SPEC-00[1-5]` | `app/history_api.py`, `app/history_store.py`, `ui/src/data/local/config.ts` |
| One workspace, `ws-synthetic-01` | `app/validation.py`, UI scope checks |
| Synthetic provenance only | `app/validation.py`, history contract |
| Archive must equal a reviewed fixture | `validate_candidate` in `app/history_store.py` |
| Pinned Evaluator identity | `app/identity.py`, `ui/src/data/local/config.ts` |

Changing `model.py` makes the Service return 503 until the pins are updated, which is intended.

The planned route to real data is in [docs/product-dev/final-version/](../docs/product-dev/final-version/): [product definition v0.2](../docs/product-dev/final-version/PRODUCT_DEFINITION_v0.2.md) and the [validation plan](../docs/product-dev/final-version/S1_VALIDATION_PLAN.md). It recommends testing with users and read-only sandbox accounts before writing connectors. `offline/flowassert_offline/evaluator_v2.py` is the first step toward configurable rules.

## Repository layout

```text
offline/                     Installable CSV check and Evaluator v2
action.yml, action/          GitHub Action around the offline check
examples/n8n/                n8n workflow with the packaged browser check
service/
  app/                       FastAPI application
  vendor/model.py            Pinned Evaluator v1
  contracts/                 OpenAPI contracts and reviewed examples
  fixtures/                  Five synthetic cases
  migrations/                SQLite schema
  tests/                     Backend tests
  baseline/                  Accepted Phase 1 bytes, used by tests
  evidence/                  File-identity baselines
  docs/                      Backend design records
ui/
  src/                       Application
  server/                    Dev API gate
  e2e*/                      Browser tests
  scripts/                   Harness and evidence tools
  docs/                      Design and integration notes
scripts/dev/                 Bootstrap, seed, run, regression
docs/readme/                 Screenshots used by the READMEs
docs/product-dev/            Reports, screenshots, raw test evidence
```

Most of `docs/product-dev/` and `service/evidence/` is the project's raw development record, published unchanged. Paths in it name the original machine and do not exist elsewhere. Rewriting them would break recorded digests.

Useful starting points:

| Topic | Document |
| --- | --- |
| Project closure | [PROJECT_CLOSEOUT_20261101.md](../docs/product-dev/final-version/PROJECT_CLOSEOUT_20261101.md) |
| Archive design | [ARCHIVE_INTEGRITY_MODEL.md](../service/docs/phase3a/ARCHIVE_INTEGRITY_MODEL.md), [SQLITE_SCHEMA.md](../service/docs/phase3a/SQLITE_SCHEMA.md) |
| Snapshots and cursors | [SNAPSHOT_AND_CURSOR_MODEL.md](../service/docs/phase3a/SNAPSHOT_AND_CURSOR_MODEL.md) |
| Backend decisions | [ARCHITECTURE_DECISIONS.md](../service/docs/phase3a/ARCHITECTURE_DECISIONS.md) |
| Frontend contract | [frontend-provider-contract.md](../service/contracts/frontend-provider-contract.md) |
| UI structure | [INFORMATION_ARCHITECTURE.md](../ui/docs/INFORMATION_ARCHITECTURE.md) |
| Regression profiles | [REGRESSION_PROFILES.md](../docs/product-dev/round-02-residual-closeout/REGRESSION_PROFILES.md) |

## Project history

| Date (2026) | Milestone |
| --- | --- |
| Oct 13 | Product definition, feasibility study, trust-model experiments |
| Oct 16–17 | Evidence Atelier UI, integration planning, first Service |
| Oct 20 | Phase 3A accepted by the Owner, for local synthetic research only, with one legacy exception |
| Oct 22–23 | Phase 3B planning accepted, without authorizing implementation; product rounds 1 and 2 |
| Oct 24–27 | Trusted Runner preparation; installation stopped at administrator sign-in |
| Oct 29 | Machine rebuilt; 452,602 files restored from an external drive |
| Oct 31 | Experimental local receipts and record reconciliation |
| Nov 1 | Offline CSV check, Chinese interface, public release; maintenance continues |

Much of the development and review used AI coding assistants under one Owner. In these records, "independent review" means a separate role or session as far as the records show. It does not mean a third-party audit.

The Phase 3B work on this branch has no Owner acceptance and no independent review. Separate preparation materials for hardened capture were kept privately and are not in this repository.
