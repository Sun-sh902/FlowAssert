# FlowAssert project closeout

2026-11-01. **Status: closed as a local research prototype.** The Owner said "我想结束FlowAssert并发布至github", then chose private archiving ("准备私有归档"). This is a conversational record, not a signed acceptance.

## Why it stopped

Reaching a first version was estimated at 15 to 22 weeks, and no target-user or real-account evidence existed to justify that work. S1 was prepared but not started. Stopping does not mean the product idea was disproved: it was never tested.

## What exists

- A pinned Evaluator with four result states and fail-closed premises.
- A read-only FastAPI service, an append-only SQLite archive, and exact-ID lookup.
- A React UI for live results, archived results, evidence, and integrity states.
- Local run receipts on an experimental branch, with no G1 grant.
- Regression gates. A clean clone of `1bfc787`, with dependencies reinstalled from lock files, passed the full product profile on 2026-11-01, Chrome and WebKit. Historical custody cannot run outside the original machine. The last release profile that passed was on `ab74927`.

All of the above handles five reviewed synthetic cases only.

The final addition is `offline/`: Evaluator v2 and a command that compares two local CSV files on selected fields under the current-state obligation. It uses stated premises, makes no network requests, has had no independent review, and is not connected to the Service or UI.

## What does not exist

- Any connection to n8n, HubSpot, or Google Sheets, and any capture of external data.
- Configurable rules in the Service, deployment, or login.
- User validation.
- Owner Acceptance or independent review of the Phase 3B work.
- M1 qualification or R3 acceptance. Both remain blocked or not accepted.

## Open items at closure

Listed in `FlowAssert-Active/BACKEND-ACCEPTANCE-20261031/RELEASE-READINESS.md`. They are closed by project stop, not resolved: P3A-AUD-001, R3 seal failures, 108 changed files with no Sol copy, the missing dependency scan, and the unexplained `e2e-lookup` failure.

## Where everything is

| Material | Location |
|---|---|
| Source and history | This repository |
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

## Public release

The Owner then asked for one last push and a public release of everything under Apache 2.0 ("最后再推进一次项目，再准备发布公开版(所有,Apache 2.0)"). This repository is the release scope, without changing its evidence files. Paths in them, including the original username, stay as recorded, because rewriting them would break their digests. The other FlowAssert folders are not part of it.
