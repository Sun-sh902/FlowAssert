# Phase 1 integrity reconciliation — attempt 01

Date: 2026-10-17 America/New_York.

**REMEDIATION REQUIRED**

## A. Historical failure remains valid

The original complete acceptance run recorded 51 passed, 1 failed, child exit 1. The failed assertion was `test_protected_repository_integrity`, at `tests/test_service.py:218`. Evidence: `evidence/tests-20261018T005815193688Z.{command.json,stdout.log,stderr.log,xml}`. The original `evidence/protected-before.json`, `protected-after.json`, and `protected-comparison.json` remain untouched. Initial equality was genuinely false; this reconciliation does not relabel the historical run clean.

The original report, README, implementation inventory and pre-change verification scripts were additionally archived in `evidence/reconciliation-01/original-service/`. `historical-evidence-lock.json` records hashes of the original top-level evidence files.

## B–C. Root cause and reconciliation

Original UI starting observation → original final observation: 209 changed/added/deleted file entries. The other five protected directories had no differences. The original UI baseline already contained 159 modified/untracked paths; these are separately classified PRE-EXISTING CHANGE and are not newly attributed to the validation window.

The Owner's current instruction explicitly confirms the concurrent Claude frontend task was authorized. Claude's current Phase 2.5 closeout sections F/G/K/L/N, actual current source, Git state, generated-output locations, and hash inventories corroborate the scope of the historical changes. `evidence/reconciliation-01/classification.json` enumerates all 209 entries individually with original-start/original-final/current hashes and the relevant closeout basis. They are classified AUTHORIZED CONCURRENT UI CHANGE for authorization/scope reconciliation. There are no unexplained material source paths in that historical 209-entry set.

The changes cover frontend focus/access styles, browser-aware helper/responsive/configuration code, closeout/test inventory, production build files, browser captures/results, Vitest cache and Playwright output. Actual helper code writes `e2e/.output`, and Playwright configuration specifies `test-results`, browser projects, and a production build before preview. These source observations support the generated-artifact mapping without rerunning or modifying the UI.

At this attempt's first observation, every protected tree and recorded Git field matched the original final observation. This is an observed endpoint equality, not proof that nothing changed between sessions.

Limits: original manifests contain hashes, not archived intermediate content. Per-process authorship and exact intermediate textual edits are not established. Authorization classification uses the Owner's direct statement plus scoped documentary/source corroboration, not timestamps alone. Claude's statements that FlowAssert-Service does not exist are stale and contradicted by the current service; they were not used as evidence of present state. Its report was copied and hashed as `claude-closeout-observed.md`. UI test-quality claims were not independently revalidated.

## D–F. New-window gate failed; no acceptance rerun

The attempted pre-baseline equality gate compared a fresh six-tree observation with `current-observation.json`. It returned exit 1 with `AssertionError: Protected content still changing: stop` before writing the proposed baseline. Thus `evidence/acceptance-02/` is only an empty reserved directory: no `protected-before.json`, no `window.json`, and no valid new baseline identity exist.

A follow-up observation is preserved in `stability-check-after.json`; `stability-failure.json` records its precise differences from this attempt's first observation:

| UI path | Initial hash | Follow-up observation |
| --- | --- | --- |
| `node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json` | `b64ac019370bfcb0bc57d991f4ca7e6083677a1ceba3c91c8453782a3b0fae1f` | `15175da16bc1a1176f2cf08eb9946b7875679d218f29b385092c36ecaee6261c` |
| `test-results/.last-run.json` | `91d1c43004802cd49950d78eb11c8fa7d05da8ffffe219a8b13b2f561bc00903` | absent |

These fresh changes are classified INSUFFICIENT EVIDENCE for exact active writer/authorization attribution: their location is consistent with ongoing frontend tests, but this attempt has no authenticated process receipt for those writes. They independently establish that the required stable window was not available. Even if authorized, they cannot be excluded from the substantive integrity requirement. The other five directories and all recorded Git fields remained equal in this follow-up observation. Ignored-file changes can occur without a porcelain Git status change.

Commands actually executed included `.venv/bin/python -B evidence/reconciliation-01/reconcile.py` (exit 0, 209 historical changes classified) and inline read-only `snapshot()`/equality gate (exit 1). No pytest acceptance invocation or HTTP probe was executed in this attempt. New test pass/fail counts: **NOT RUN**, not 52/0. No predicted result is presented.

A read-only process observation found a UI Vite development server; that alone does not prove any edit or identify the cache writer. It was not stopped or modified.

## G–I. Evaluator, API and F004 evidence

Backend application code, tests, fixtures, frozen contracts and fixed expectations were not changed. Earlier real evaluator, two-endpoint HTTP, static/runtime schema and seven F004 negative results remain historical evidence. They were not rerun in this attempt, so there is no fresh acceptance claim. The evaluator identity and contract identities were rechecked read-only in `identity-and-history-check.json`.

Two service-owned verification utilities were prepared for a future window: `scripts/protected_integrity.py` supports an explicit `FLOWASSERT_INTEGRITY_BASELINE` under service evidence, defaults to the original baseline, and refuses to overwrite existing final observations; `scripts/http_probe.py` supports a new `FLOWASSERT_EVIDENCE_DIR` and refuses to overwrite previous HTTP output. The comparison requirements and original test assertion are unchanged. These utility edits received syntax validation only; execution against a new acceptance window is still outstanding. No expected hash was replaced to make a test pass.

## J–L. Integrity, limitations, next requirement

All historical evidence lock entries still match. Original report copies remain available. Current application/contract/test files match the prior implementation inventory; preparation changes are limited to the two utilities and reconciliation/report artifacts. No protected source or Git metadata was intentionally written; no Git reset, clean, stage, commit, merge or push was issued. No service was launched, deployed or integrated with the UI.

The precise next requirement is for the frontend owner to finish/stop active test or other writing work, including generated caches and test results, and provide a stable handoff window. Do not delete caches to conceal changes. Then capture a separately versioned pre-execution baseline, run the affected integrity test and full acceptance suite, run the real HTTP probe into new output paths, and compare the final six-tree observation against that baseline. Preserve all old and current failures. If writes recur, stop again.

Independent review still requires that completed clean local acceptance window and the complete evidence package. This report is not independent acceptance, research release authorization or Phase 2 authorization. External acquisition authenticity, causality, business truth and production readiness remain unproven. Stop here per the requested stability gate.
