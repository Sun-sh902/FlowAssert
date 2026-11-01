# FlowAssert Phase 3A — local persistent verification history

The archived Phase 3A report records a historical frontend-integration recommendation, not acceptance of the modified workspace. This Service remains local, offline and limited to synthetic cases; it has no live API integration or deployment. SQLite schema version is 1. Current checks and source identities are maintained in the product workspace.

Start here: [backend report](docs/phase3a/PHASE3A_BACKEND_REPORT.md), [Claude frontend handoff](docs/phase3a/FRONTEND_HANDOFF.md), [additive OpenAPI](contracts/openapi-history-v1.yaml), [ID-addressability OpenAPI](contracts/openapi-id-addressability-v1.yaml), [historical source manifest](docs/phase3a/SOURCE_MANIFEST.json), [current backend identity](../scripts/dev/backend-current-identity.json), [Phase 3B experimental admission boundary](docs/phase3b/EXPERIMENTAL_ADMISSION_BOUNDARY.md).

```sh
# Product workspace entrypoints (from repository root):
scripts/dev/seed.sh                         # seeds/verifies .runtime/{dev-main,dev-single,dev-empty}
scripts/dev/service.sh                      # runs run_history.py via scripts/guarded_entry.py on 127.0.0.1:8765

# Direct service CLI (from service/ with an explicit --state):
cd service
export TMPDIR="$PWD/.runtime/tmp"
export PYTHONDONTWRITEBYTECODE=1
.venv/bin/python -B archive_cli.py --state .runtime/dev-main seed
.venv/bin/python -B archive_cli.py --state .runtime/dev-main check
```

Fixed loopback `127.0.0.1:8765`; stop with Ctrl-C. Supported private runtime directories use mode `0700`; database and key files use `0600` (standalone default state: `.runtime/delivery`; product workspace states: `.runtime/dev-main`, `.runtime/dev-single`, `.runtime/dev-empty`). A default seed validates/reuses the first five IDs for its current source set. To record a genuine new batch use `seed --reevaluate`. No arbitrary import or HTTP write endpoint.

Seed reuse is scoped to a source-set identity, which includes the executed backend implementation. After an implementation change, the first default `seed` for that new source set performs five actual evaluations and adds a new batch even without `--reevaluate`; subsequent default seeds reuse that new batch. Existing archives retain their original provenance. `--reevaluate` explicitly adds another batch for the current source set.

Phase 3B local admission fields are available on `GET /api/v1/history/verifications` and `GET /api/v1/history/verifications/{history_id}`. For live verification detail and the exact-ID `/api/v1/verification-lookup` endpoint, request `phase3b=true` to receive the extension. The original endpoints and their default responses retain the frozen schemas, which prohibit additional JSON properties. `phase3b=false` uses the original representation. Legacy records and the current live fixture catalog return `capture_status: "CAPTURE_NOT_IMPLEMENTED"` and `admission_status: "ADMISSION_NOT_IMPLEMENTED"`. Old authenticated execution receipts that do not bind the evaluator and full run/snapshot are also downgraded to those statuses on read and cannot be republished. Existing state is not automatically rewritten.

`capture_status` values are `CAPTURED_COMPLETE`, `CAPTURE_INCOMPLETE`, `CAPTURE_STALE_REJECTED`, `CAPTURE_SUBPROCESS_FAILED`, and `CAPTURE_NOT_IMPLEMENTED`. `admission_status` values are `ADMITTED_RUN_BOUND`, `REJECTED_STALE_RECEIPT`, `REJECTED_INCOMPLETE_EXECUTION`, `REJECTED_BINDING_MISMATCH`, and `ADMISSION_NOT_IMPLEMENTED`. When present, `run_bound_metadata` contains `run_id`, `execution_cwd_sha256`, `source_basis_sha256`, `rule_basis_sha256`, `started_mono_ns`, `completed_mono_ns`, `verifier_work_completed`, `outer_exit_status`, and `subprocess_failures`; it does not expose receipt authentication material. The collector only invokes the checked pinned evaluator. The retained `subprocess_failures` field does not indicate general subprocess monitoring; the current evaluator launches no subprocesses. Local admission is not external capture or authenticity.

Regression: run `../scripts/dev/regression.sh --portable NEW-LABEL` from the product workspace root (or run `.venv/bin/python -B -m pytest -p no:cacheprovider --basetemp=.runtime/tmp/NEW-LABEL --deselect tests/test_service.py::test_protected_repository_integrity tests`). Do not run `scripts/run_checks.py` for routine regressions, as it writes into the historical `docs/phase3a/evidence/` directory. For real HTTP replay, use `scripts/runtime_probe.py` with fresh `--state` and `--output` paths outside committed evidence; it refuses to replace existing delivery state.

Original Phase 1 reports/files are retained from the accepted source snapshot and describe historical phases; the Phase 3A report above describes the historical accepted baseline, not acceptance of subsequent modifications. Pre-final exploratory and deliberately damaged negative databases are retained as test artifacts and must not be substituted for the configured store. Internal hashes authenticate neither external sources nor administrator-controlled data.
