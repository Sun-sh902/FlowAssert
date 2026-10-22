# FlowAssert Phase 3A — local persistent verification history

READY FOR PHASE 3A FRONTEND INTEGRATION (backend local recommendation; not Owner Acceptance).

183 tests pass, including88 accepted regressions;204 actual HTTP/process assertions. SQLite schema1. Five reviewed synthetic cases;10 stored evaluations after explicit replay testing. No frontend work, live APIs or deployment.

Start here: [backend report](docs/phase3a/PHASE3A_BACKEND_REPORT.md), [Claude frontend handoff](docs/phase3a/FRONTEND_HANDOFF.md), [additive OpenAPI](contracts/openapi-history-v1.yaml), [source manifest](docs/phase3a/SOURCE_MANIFEST.json).

```sh
cd /Users/zhangshenghe/Documents/FlowAssert-Phase3A-Service
export TMPDIR="$PWD/.runtime/tmp"
export PYTHONDONTWRITEBYTECODE=1
.venv/bin/python -B archive_cli.py seed
.venv/bin/python -B archive_cli.py check
.venv/bin/python -B run_history.py
```

Fixed loopback127.0.0.1:8765; stop with Ctrl-C. Supported current state: .runtime/delivery (0700); database/keys0600. Existing default seed validates/reuses its first five IDs. To record a genuine new batch use seed --reevaluate. No arbitrary import or HTTP write endpoint.

Regression: `.venv/bin/python -B scripts/run_checks.py NEW-LABEL tests`. Use a fresh label to preserve evidence. For real HTTP replay, use scripts/runtime_probe.py with fresh --state and --output paths as documented in the handoff; it refuses to replace existing delivery state.

Original Phase1 reports/files are retained from the accepted source snapshot and describe historical phases; the current Phase3A report above governs this delivery. Pre-final exploratory and deliberately damaged negative databases are retained as test artifacts and must not be substituted for the configured store. Internal hashes authenticate neither external sources nor administrator-controlled data.
