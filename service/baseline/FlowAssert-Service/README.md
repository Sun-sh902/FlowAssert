> Latest reconciliation: stable-window gate failed again before a new acceptance baseline was created. No new acceptance suite was run. See `INTEGRITY_RECONCILIATION_REPORT.md`; historical results below remain historical.

# FlowAssert offline service — Phase 1 implementation candidate

**REMEDIATION REQUIRED.** The final local suite has 51 passing tests and one failing protected-tree integrity test. The frontend changed during this run; the initial baseline and failure are preserved. This is not independent acceptance or production approval. Stop at local verification; Phase 2 is not authorized here.

This service executes the exact pinned research `model.evaluate(e)` for five reviewed synthetic cases at startup, publishes a memory-only snapshot, and serves two read-only endpoints. It does not invoke the Oracle. Inputs are fixed service-owned fixtures checked against the frozen reviewed package; there is no HTTP import or evaluation endpoint.

## Local startup and shutdown

Tested runtime: Python 3.14.7. All installed dependencies live in `.venv`; exact versions are in `requirements.lock`.

```sh
cd /Users/zhangshenghe/Documents/FlowAssert-Service
.venv/bin/python -B run.py
```

Base URL: `http://127.0.0.1:8765`. The supported launcher fixes the host to loopback. Press Ctrl-C in that terminal to stop. The verification probe's server was stopped; no server is intentionally left running. Recreate the environment only inside this directory with `python3 -m venv .venv` and `.venv/bin/pip install --no-cache-dir -r requirements.lock` if needed.

```sh
.venv/bin/python -B scripts/verify.py
.venv/bin/python -B scripts/http_probe.py
.venv/bin/python -B scripts/protected_integrity.py
```

The integrity check intentionally still compares against the original baseline. It must not be made green by silently replacing that baseline.

## Information for a future frontend handoff

This is information only, not clearance to integrate. Formal handoff readiness is withheld at Stage H.

- `GET /api/v1/verifications/{id}`: optional `snapshot_id`.
- `GET /api/v1/verifications/{id}/evidence`: optional `snapshot_id`, `limit` (1–100, default 25), `cursor`, `include_payload` (true by default).
- IDs: SPEC-001 Verified; SPEC-002 Mismatch; SPEC-003 Pending; SPEC-004 Unverified; SPEC-005 twelve Verified rows with an Unverified cohort and null expected total.
- Contract: `0.1.1-proposed`, API `v1`; frozen schemas and provider contract are in `contracts/`. Only the two implemented business paths are advertised by `/openapi.json`; original five-path contract is preserved unchanged.
- Actual process responses are in `evidence/http/SPEC-00*-detail.json` and `*-evidence.json`, including execution wall-clock timestamps and exact synthetic evidence.
- Pin evidence requests to the Detail `snapshot_id`. Read all pages in order. Cursors are integrity checked and bound to scope, run, snapshot, limit and payload option. Never merge snapshots. Restart creates new run execution receipts and a new snapshot; the prior explicit snapshot is unavailable (409). In-memory history is not durable.
- 400: invalid/changed cursor query or unknown/duplicate query parameter. 404: run missing in selected scope. 409: snapshot conflict/unavailable. 422: malformed parameter or offline input scope limit. 500: sanitized unexpected service failure. 503: unavailable/invalid bound source, evidence or response. Errors contain no business verdict. 401/403 are reserved, unimplemented; no rate limiter is claimed.
- `include_payload=false` returns null payload and `omitted_by_request`; availability is unchanged. Unavailable evidence has null payload and a reason. A denied-read receipt can be available while observation evidence is insufficient.
- Preserve LOCAL_RESEARCH / synthetic / research_only. Display “Local research · synthetic · unapproved research version”. Null timestamps remain null; mapped times are synthetic, while `service_executed_at` is actual service execution time. No external observation authenticity is established.
- CORS is disabled. No browser integration or cross-origin setup has been authorized or tested. Any later origin policy requires the separately authorized integration step.

See `PHASE1_REPORT.md` for the completion boundary and `IMPLEMENTATION_INVENTORY.json` for exact files and hashes.
