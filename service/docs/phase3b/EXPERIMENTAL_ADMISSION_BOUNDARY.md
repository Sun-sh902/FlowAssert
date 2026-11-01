# Experimental local execution and admission boundary

This workspace remains local, offline, and restricted to reviewed synthetic
fixtures. It does not implement trusted acquisition or an independent external
receipt issuer. Nothing here authenticates external data or establishes a live
n8n/HubSpot capture.

For a new run-bound record the `ExecutionCollector` accepts a candidate template
and a working directory, never a caller-selected evaluator or command. In its
worker it loads the pinned evaluator from digest-checked bytes, executes it,
checks the source bytes again and records the execution time. The collector
constructs a fresh run and snapshot from that result and time. This snapshot is
a constructed mixed basis: it replaces the selected case in the template basis
and retains the other four members. It does not claim the other cases were
re-executed in this collector run. `collect_batch` instead re-executes all five
reviewed cases and binds them to one shared snapshot; if any execution fails, the
batch yields no candidate. `scripts/dev/seed_run_bound.py STATE --all` uses it.
Each local HMAC
receipt binds the input, result, pinned evaluator digest, execution context, full candidate, including run, snapshot basis, contracts and refreshed current
provenance. The source map is checked before and after collection. Archive publication independently replays the
pinned evaluator and validates the reviewed fixtures and candidate relationships,
and refuses repeated use of a run ID. The binding depends on trusted service
code, its evaluator, and its local signing key; it is not an OS sandbox or an
attestation against a user who can change that code or key. The collector does
not monitor arbitrary child processes; the present pinned evaluator does not
launch any. The retained `subprocess_failures` field is not evidence of general
subprocess monitoring.

Old locally authenticated execution receipts lacked an evaluator identity and
complete run/snapshot binding. Existing archived records are still integrity
checked and readable, but their capture and admission statuses are downgraded to
`CAPTURE_NOT_IMPLEMENTED` / `ADMISSION_NOT_IMPLEMENTED`; these receipts cannot
be used to publish a new record. Archives predating execution metadata retain
the same status. Existing state is not automatically rewritten. A fresh
`dev-run-bound` state created by `scripts/dev/seed.sh` demonstrates the new
binding. Existing state with that name is deliberately preserved and may contain
an older downgraded record.

For new records, `CAPTURED_COMPLETE` / `ADMITTED_RUN_BOUND` mean that these
local checks passed, not that an external source was captured or authenticated.
The frozen Phase 1–3A HTTP representations retain their original schemas.
