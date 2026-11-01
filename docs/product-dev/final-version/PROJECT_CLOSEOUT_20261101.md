# FlowAssert project closeout

2026-11-01. **Status: closed as a local research prototype.** The Owner said "我想结束FlowAssert并发布至github", then chose private archiving ("准备私有归档"). This is a conversational record, not a signed acceptance.

## Why it stopped

Reaching a first version was estimated at 15 to 22 weeks, and no target-user or real-account evidence existed to justify that work. S1 was prepared but not started. Stopping does not mean the product idea was disproved: it was never tested.

## What exists

- A pinned Evaluator with four result states and fail-closed premises.
- A read-only FastAPI service, an append-only SQLite archive, and exact-ID lookup.
- A React UI for live results, archived results, evidence, and integrity states.
- Local run receipts on an experimental branch, with no G1 grant.
- Regression gates. The last portable run passed on 2026-11-01. The last full browser release run passed on `ab74927`.

All of it handles five reviewed synthetic cases only.

## What does not exist

- Any connection to n8n, HubSpot, or Google Sheets, and any capture of external data.
- Configurable rules, verification of arbitrary input, deployment, or login.
- User validation.
- Owner Acceptance or independent review of the Phase 3B work.
- M1 qualification or R3 acceptance. Both remain blocked or not accepted.

## Open items at closure

Listed in `FlowAssert-Active/BACKEND-ACCEPTANCE-20261031/RELEASE-READINESS.md`. They are closed by project stop, not resolved: P3A-AUD-001, R3 seal failures, 108 changed files with no Sol copy, the missing dependency scan, and the unexplained `e2e-lookup` failure.

## Where everything is

| Material | Location |
|---|---|
| Source and history | This repository; private GitHub archive once pushed |
| Git bundle | `FlowAssert-Active/BACKUPS-20261101/` |
| 37 restored originals | Local `Documents`, and Sol |
| Active working copies and acceptance records | `FlowAssert-Active`, not on Sol or GitHub at this writing |
| Recovery reports | `FlowAssert-Recovery-Reports`, `FlowAssert-Restoration-Reports`, not on Sol at this writing |
| Folder guide | [FILE_MAP_20261101.md](FILE_MAP_20261101.md) |

Secrets and local state are not in Git: `service/.runtime/`, `service/.state/`, and `.dev-runtime/` are ignored.

## To restart

1. Read [PRODUCT_DEFINITION_v0.2.md](PRODUCT_DEFINITION_v0.2.md) and [OWNER_DECISIONS_20261101.md](OWNER_DECISIONS_20261101.md).
2. Start with [S1_VALIDATION_PLAN.md](S1_VALIDATION_PLAN.md): interviews first, no product code.
3. Run `scripts/dev/bootstrap.sh`, then `scripts/dev/regression.sh --portable NEW-LABEL`.

A public release, if ever wanted, should be a new repository without this history. This one has personal paths, author emails, and internal governance records, and it has no license.
