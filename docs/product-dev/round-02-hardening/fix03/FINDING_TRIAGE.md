# FIX03 — Finding triage

**Status:** investigation and fixes complete; regression in REGRESSION_RESULTS.md.

| Item | Value |
| --- | --- |
| Branch / base commit | `product-dev/round-02-hardening` @ `203f70216679a660d561e28c2f85c56991221734` (status clean at start) |
| Date | 2026-10-23 · macOS Darwin 27.2.0 arm64 · Node 26.10.0 · Python 3.14.7 |
| Read-only inputs | `service/vendor/model.py`, `service/contracts/*` (pinned identities PASS before and after), Phase 3A sources |

## Preconditions

| Round | Independent acceptance | Evidence |
| --- | --- | --- |
| FIX01 | **Accepted** — "FIX01 — ACCEPTED FOR FIX02" | `FlowAssert-Product-Review/FIX01/final-audit-01/FINAL_REVIEW.md` (reviewed `d34f882`) |
| FIX02 | **Accepted** — "FIX02 — ACCEPTED FOR FIX03" (reviewed `203f702`, 24/24 gates) | `FlowAssert-Product-Review/FIX02/final-audit-01/FINAL_REVIEW.md` |

FIX02 was still under review when FIX03 started: its lookup suite held ports 5183 and 8765, and no disposition was
written yet. By Owner decision, investigation, fixes and port-free checks went ahead first. The commit and the browser
suites waited until the FIX02 acceptance was written and the ports were free. No process or port of the FIX02 reviewer
was touched. During investigation, real Service output was read in-process (FastAPI `TestClient`, no TCP port) from
this workspace's `dev-main` archive.

## Source of the findings

The findings come from the FIX03 brief; no earlier report in this repository records them. Each was treated as an
unverified claim and checked against the code, the accepted contracts, the pinned Evaluator and real Service output.

## Classification

The brief's five classifications apply. **CONFIRMED** findings are split by how they are reached. *Reachable* means
current Service data or real Service error paths can trigger them. *Latent* means the contract or the Evaluator allows
them, but the five reviewed fixtures don't produce them; each latent finding names its trigger. *Fault-only* means
they are reached only when a provider breaks its contract.

| ID | Finding (as reported) | Classification | Reach | Source location (203f702) | Test |
| --- | --- | --- | --- | --- | --- |
| F-01a | INTEGRITY_UNVERIFIABLE drawn as FAILED (tags) | CONFIRMED | latent — decode admits only VERIFIED archive records in a 200 (`data/history/decode.ts:47`) | `HistoryRows.tsx:46`, `StatusAxes.tsx:76`, `StatusAxes.tsx:93`, `ArchiveMatch.tsx:83` | `fix03.test.tsx` F-01 #1–2 |
| F-01b | UNVERIFIABLE described as an integrity *failure* | CONFIRMED | **reachable** — every Service `fail()` defaults to INTEGRITY_UNVERIFIABLE (`service/app/history_security.py:20`, e.g. `archive_unavailable`) and is sent as `error.details` (`history_api.py:23`) | `StatusAxes.tsx:132-134` (axis note), `:263` (match panel), `:253` (boolean collapse) | F-01 #3–4 |
| F-01c | UNVERIFIABLE on History pages / Workspace | ALREADY_FIXED | — | `HistoryEntry.tsx:48-72`, `History.tsx:331` | `phase3a-history-pages.test.tsx:252`, `:230` |
| F-01d | Integrity state not available to assistive technology | CONFIRMED | reachable — glyph is `aria-hidden`, label "record check · service" names no state | `Integrity.tsx:58-64` | F-01 #5 |
| F-02a | `existed_by_deadline`, `workflow_execution` absent from the main comparison view | CONFIRMED | latent — the five reviewed fixtures set both policy flags `false`; the pinned Evaluator emits them whenever a flag is not `false` (`model.py:112-113, 245-248`) | `ComparisonSheet.tsx:33-72` (rows built only for existence, uniqueness, phone, email) | F-02 #1–2 |
| F-02b | `recordSummary` claims "its phone matches" when phone was not compared | CONFIRMED | latent — genuine Evaluator output (`evidence/evaluator/phone_unknown.json`) | `wireToView.ts:161-162` | F-02 #3 |
| F-02c | `RULE_META` / `recordIssue` misrepresent rules | FALSE_POSITIVE | — | `RULE_META` covers all five keys (`wireToView.ts:34-40`); `recordIssue` falls back to "Insufficient evidence", which is true | F-02 #4 (control) |
| F-03a | AbortError, network failure, malformed response, timeout | ALREADY_FIXED | — | providers return results; only abort rejects (`data/local/provider.ts:113-118`) | `local-provider.test.ts:202, 215, 245`; `phase3a-history-provider.test.ts:179, 191, 195, 202` |
| F-03b | Cancellation race, stale success, retry | ALREADY_FIXED | — | `useLiveCases.ts:51` / `ArchiveMatch.tsx:59` guard on `ctrl.signal.aborted`; re-read is a new generation | `workspace.test.tsx:228, 239`; `local-detail.test.tsx:197, 210`; `phase3a-history-pages.test.tsx:296, 308, 339` |
| F-03c | Candidate detail retrieval failure | ALREADY_FIXED | — | `ArchiveMatch.tsx:39-43, 72-78` | `archive-match.test.tsx:38, 51` |
| F-03d | Non-abort rejection mislabelled *cancelled* / candidate left *reading* forever | CONFIRMED | fault-only — no Service-data trigger is known | `useLiveCases.ts:52-55`, `ArchiveMatch.tsx:60-62` | F-03 #1–2 |
| F-04a | Production Settings claims the DEV-only fixture check ran | CONFIRMED | reachable (every production build) | `Settings.tsx:328` vs `main.tsx:15` | F-04 #5–6 |
| F-04b | History tooltip overclaims cryptographic verification | FALSE_POSITIVE | — | The tooltip (`HistoryRows.tsx:44`) is accurate: `listing()` re-reads every item through `_read()` — candidate digest, canonical bytes, seal, records, evidence (`history_store.py:266-301, 363`); the browser check is the stated digest binding (`decode.ts:46-55`) | — |
| F-04c | Archive unexpected IDs counted but hidden | FALSE_POSITIVE | — | `original_verification_id` schema pattern is `^SPEC-00[1-5]$` (= `KNOWN_LOCAL_CASES`), so an admitted entry is never unexpected; `ArchiveIndex.unexpected` is always empty (dead field, see REMAINING_FINDINGS) | `workspace.test.tsx:91` |
| F-04d | Loading labelled *No result* | CONFIRMED | reachable (every Overview load) | `Workspace.tsx:155` (ledger), `:247` (case group), `:133-136, 141` (headline) | F-04 #1–2 |
| F-04e | Not-found treated as read failure | CONFIRMED on the Detail status axes only | latent — the contract allows a list 404 (`openapi-history-v1.yaml`), the Service does not emit one for the list | `StatusAxes.tsx:248-254, 131-134`; History and Workspace already show NOT_FOUND | F-04 #4 |
| F-04f | Misleading pagination text | CONFIRMED (Workspace register); NOT REPRODUCED (History list) | reachable | `Workspace.tsx:318` "3 pages of 4" | F-04 #3 |
| F-05a | Missing H1 when the Service is unavailable | CONFIRMED (Overview `#/`); NOT REPRODUCED (Verifications, which has a `PageHead` H1) | reachable | `Workspace.tsx:362` → `ArchiveReadState` → `AccessNotice` (h2 default) | F-05 #1 |
| F-05b | CaseExhibits definition-list associations | CONFIRMED | reachable | `Workspace.tsx:292-301` (`dt, dt, dd, dd`) | F-05 #2 |
| F-05c | Theme selector keyboard behaviour | CONFIRMED (rail and Settings specimens); ALREADY correct in `Segmented` | reachable | `AppShell.tsx:141-160`, `Settings.tsx:95-97` (no roving tabindex, no arrow keys) | F-05 #3–4 |
| F-05d | Static Data Provider radio semantics | CONFIRMED | reachable | `Settings.tsx:268-288` (operable radio group with no handler) | `settings.test.tsx` "Provider modes" |
| F-06 | `ui/README.md` inaccurate / dead | CONFIRMED | — | dead links `docs/phase2_5/TEST_INVENTORY.md`, `docs/phase3a/PHASE3A_FRONTEND_REPORT.md`, `docs/screenshots/{v1-atelier,before,after}`; run steps via the Phase 2/3A harness instead of `scripts/dev/`; "five" gate routes (seven exist); Firefox listed; MOCK described as the default | — |

**Totals (by row):** 15 CONFIRMED · 4 ALREADY_FIXED · 3 FALSE_POSITIVE · 0 BLOCKED. NOT REPRODUCED applies to part
of two rows: the History list's pagination text (F-04f) and the Verifications page heading (F-05a).

Every CONFIRMED finding with a test has one in `ui/src/test/fix03.test.tsx`. On `203f702` 20 of its 21 tests fail on
the defect itself (`evidence/reproduction/fix03-tests-on-203f702.log`). The one passing test is the intended control
showing the reviewed fixtures are unchanged. All 21 pass on the fixed tree.

## Handoff to the independent FIX03 reviewer

| Item | Value |
| --- | --- |
| Branch | `product-dev/round-02-hardening` |
| FIX03 commits (linear on `203f702`) | `4f13a13` fixes, tests, README, evidence → `529db23` integrity-tag containment → the reports commit that adds this section (branch head) |
| Code under review | everything under `ui/` and `scripts/dev/test-inventory.json` at `529db23`; the reports commit changes only `docs/product-dev/round-02-hardening/fix03/` |
| Full regression | `fix03-529db23`: PASS (all gates), 24/24 — REGRESSION_RESULTS.md |
| Reproduction | `ui/src/test/fix03.test.tsx` on a `203f702` export: 20 failed, 1 control passed |
| Review workspace | `/Users/zhangshenghe/Documents/FlowAssert-Product-Review/FIX03/` (not created or written by FIX03 development) |

FIX03 stops here. FIX04 was not started.
