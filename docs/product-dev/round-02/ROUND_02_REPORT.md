# Product development round 02 — closeout

**Status: implemented; regression NOT fully passing (2 failing browser gates). Hardening blockers open.**

## Source control

| Item | Value |
| --- | --- |
| Branch | `product-dev/round-02`, created from verified Round 01 HEAD `90d3bc7` (clean tree, single worktree) |
| Implementation commit | `86bec55` |
| Closeout commit | adds this report set and the fresh-clone evidence (see `git log`) |
| Tags | `phase3a-baseline` → `e11f4d5` (unchanged) |
| Pushed / merged | No |

## Implemented

| Requirement | Result |
| --- | --- |
| Live vs archived comparison | Overview and Verifications read each known case's live Detail (≤ 2 in flight, cancellable, per-case errors) beside one complete archive read. States: same input · agrees / differs, different input, no live result, not archived, Service unavailable, inconclusive. Diagnostic only; never a verdict, never Unverified for missing data. |
| Exact Detail → Archive match | Identity match only (no times/labels). None → says so with differing fields; one → navigable; several → all listed, none chosen; each candidate's archived Detail checked for retrieval/integrity and byte-identical result. |
| Rules layout shift | Mechanism measured (font swap reflowing the page head, −42 px). Metric-matched fallback faces. 0.137 → 0 on 30/30 cold loads; threshold 0.1 unchanged. |
| Evidence Atelier UI | Overview: live/archived ledger, comparison strip, attention-ordered cases. Verifications: labelled capture/admission, live and archived verdict columns, comparison column, 375 px cards. Detail: verdict first, then trace, axes, archive match, records. History entry links to the current result. |
| Service status | Built from existing reads + explicit Check (`GET /api/v1/history?limit=1`). Reachable / Unavailable / Checking / Request failure / Stale / Not checked. No polling, no new endpoint. |
| Fresh-clone setup | `scripts/dev/bootstrap.sh [--harness]` verified from an empty clone. Machine-bound limits in KNOWN_LIMITATIONS.md (B3). |
| Restored backend test | Restored with explicit parent and pinned baseline; assertions unchanged; passes; negative control fails. |
| Protected sources | Unchanged (6 roots, digest + mtime). |

Screenshots: `screenshots/before/` (Round 01 UI), `screenshots/after/` (pre-final), `screenshots/after-fresh-clone/` (commit `86bec55`).

## Regression

See [REGRESSION_RESULTS.md](REGRESSION_RESULTS.md): backend 248/0, Vitest 1618/0, static e2e 136/0, Rules CLS 20/20 + 30/30, workspace e2e 31/0, history 68/0, **lookup 56 passed / 1 failed**, **Phase 2 local 26 passed / 1 failed / 7 did not run**. Firefox not run.

## Open

Blockers B1–B8 and product limitations: [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). Audit findings were not available in this session and remain to be reconciled in the Round 02 hardening task. Round 03 not started.
