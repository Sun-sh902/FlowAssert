# Round 02 residual closeout — final finding triage

Implementation-side triage, 2026-10-23 (America/New_York). This is not independent acceptance.

**Starting point.** Frozen FIX04 candidate `1caef22693eb87ee483b2de187d74bd73246f106` (tree
`7fbca4773af7ed2dad61e53a6791e276ebde3e4c`), branch `product-dev/round-02-hardening`, clean (0 status lines). FIX04
code commits `e759bd606cabf73b112aeb1d32ae982c475fa8d5` and `a30e4f338d2f363a17924b6fa8a33e4a8b2c329f` are ancestors of
it. New branch `product-dev/round-02-residual-closeout` was created at `1caef22`; the hardening branch was not moved
(`evidence/preflight/`).

**Preflight observations.**

- Concurrent activity: three idle Codex REPL processes had their working directory in the empty, git-ignored
  `FIX04/final-audit-01/`. The sibling review workspace `FlowAssert-Product-Review/FIX04/final-audit-01` held a
  reviewer regression of `1caef22` that had stopped at 15:25Z mid-gate (`rules-cls-repeat`); no test, browser or
  Service process was alive. A full regression `verify-full-20261023` (15:12–15:20Z, 24/24 PASS) existed in this
  repository's `.dev-runtime/regression/`. No process was writing to the repository. Nothing was stopped or removed.
- Sources read: FIX04 `FINAL_FINDING_TRIAGE.md`, `REMAINING_LIMITATIONS.md`, `BACKUP_AND_RECOVERY_STATUS.md`,
  `PRODUCTION_BUILD_REPORT.md`, `INDEPENDENT_REVIEW_HANDOFF.md`; FIX01–FIX03 independent `FINAL_REVIEW.md` in
  `FlowAssert-Product-Review/FIX0{1,2,3}/final-audit-01/` (read only).
- 613 tracked files under `docs/` and `ui/docs/` were hashed at start (`evidence/preflight/tracked-evidence-sha256-at-start.txt`).

Run-specific raw outputs are under `.dev-runtime/residual-closeout-20261023/` (git-ignored). Summaries needed for review
are copied into `evidence/`.

## Summary

| ID | Finding | Classification | Action |
| --- | --- | --- | --- |
| R01 | No remote; bundles on the same disk | ACCEPTED_LIMITATION (delivery/DR); local recovery verified | New bundle + restore proof; **OFF-DEVICE BACKUP PENDING OWNER DESTINATION** |
| R02 | Portable vs historical full regression | CONFIRMED (a product-only browser run was impossible) | `bootstrap.sh --product-harness`, `regression.sh --product`; custody untouched |
| R03 | `main` points at the Phase 3A baseline | ACCEPTED_LIMITATION (delivery state, not a software defect) | Documented; `main` untouched |
| R04 | `ArchiveIndex.unexpected` not rendered | FALSE_POSITIVE as a defect (unreachable); comment CONFIRMED inaccurate | Comment corrected; negative tests added |
| R05 | not_found grouped with failed reads | CONFIRMED | Statement and Register corrected; 8 unit + 2 browser tests |
| R06 | RecordCheck tooltip implies a browser digest check | CONFIRMED (wording) | Tooltip states the actual operation; regression assertion |
| R07 | Provider replacement under the same key not re-read | CONFIRMED (hook contract; unreachable in today's routes) | `source` option; list view resets; 8 hook tests |
| R08 | Read-state components can return null | FALSE_POSITIVE (unreachable under supported providers) | No change |
| R09 | Optional mutant fixtures at an absolute path | ACCEPTED_LIMITATION (optional, honest NOT RUN); low-risk improvement applied | Default derived from `FLOWASSERT_PROTECTED_PARENT` |
| R10 | CLS probe ends after a fixed 800 ms | CONFIRMED (probe gate only; authoritative test unaffected) | Window extended to font readiness; negative control |
| R11 | Future optional-rule pass/fail wording | ACCEPTED_LIMITATION (future contract extension) | No change |
| R12 | One ≈636 kB JavaScript chunk | ACCEPTED_LIMITATION (optimization opportunity; no budget) | Measured; no code change |
| R13 | 200-cell matrix not in the regression | CONFIRMED | Matrix is a gate of the product and release profiles with a cell inventory |

## R01 — Git recovery and off-device backup

- Files: `.dev-runtime/recovery/` (git-ignored); `git remote -v`; `tmutil destinationinfo`; `/Volumes`.
- Expected: recoverable full history; an off-device copy if an authorized destination exists.
- Actual: `shasum -a 256 .dev-runtime/recovery/flowassert-product-dev-fix04-final-1caef22.bundle` =
  `7a31ea68465c2941fffcad8acb2599f29f132e36af6f4be3da039521b400ec4f`, equal to its `.sha256` sidecar and the reported
  value. `git bundle verify` exit 0, "records a complete history", 7 refs identical to the repository's refs
  (`main`, `product-dev/round-01`, `product-dev/round-02`, `product-dev/round-02-hardening` = `1caef22`, tag
  `phase3a-baseline`, `HEAD`, and one tool-created `refs/codex/turn-diffs/...` ref). Remotes: 0. Time Machine: "No
  destinations configured". `/Volumes`: only the internal disk. No previously authorized off-device destination is
  named in any report.
- Impact: Git history is recoverable from this disk; a disk or folder loss loses everything.
- Classification: ACCEPTED_LIMITATION — three separate facts: (1) no remote (by design; no external service registered),
  (2) recoverable history (verified), (3) no off-device disaster-recovery copy (**PENDING OWNER DESTINATION**).
- Resolution: final bundle and restore proof in [BACKUP_AND_RECOVERY_STATUS.md](BACKUP_AND_RECOVERY_STATUS.md).

## R02 — Portable versus historical full regression

- Files: `scripts/dev/regression.sh:22-116` (FIX04), `scripts/dev/bootstrap.sh:90-130` (FIX04),
  `scripts/dev/prepare_harness_runtime.py`, `ui/scripts/phase2/prepare_runtime.py:21-23`,
  `ui/scripts/phase3a/prepare_lookup_runtime.py:25`, `ui/e2e-local/support.ts:21`.
- Expected: the browser product checks can run without the historical roots, with custody a separately named gate.
- Actual: `e2e-history` uses `ui/.phase3a-runtime`, which `prepare_harness_runtime.py` copies from **this**
  workspace's `service/`. The matrix uses the same runtime and `scripts/dev/service.sh`. Neither reads a historical
  root. But `bootstrap.sh --harness` stopped with exit 30 before preparing anything unless all four historical
  sources were readable, so `e2e-history`, and with it any product browser run, depended on class-C inputs it does
  not use. `e2e-lookup` and `e2e-local` genuinely require the accepted Phase 3A and Phase 2 Services and the Phase 2
  handoff traces (class C).
- Classification: CONFIRMED (environment coupling), not a product defect.
- Resolution: product profile (see [REGRESSION_PROFILES.md](REGRESSION_PROFILES.md)). Custody: unchanged, BLOCKED
  (77) when absent, not run in the product profile and listed as NOT RUN. Verified: a clean clone of `f287274` ran
  `bootstrap.sh --product-harness` and `regression.sh --product` entirely under `sandbox-exec` denying every read and
  write under `~/Documents` (all historical roots and the development tree): exit 0, 21 gates PASS, 5 NOT RUN
  (`evidence/clean-clone-product-sandboxed/`). Under that sandbox the information-only Firefox launch of
  `browser-probe.mjs` hung; it was terminated by a narrow watcher (`tools/firefox-watch.sh`, log kept), and Firefox is
  recorded as absent/not mandatory. Unsandboxed, Firefox launches as before.

## R03 — Delivery branch and main

- Refs: `main` = `phase3a-baseline` = `e11f4d56589ca7fa9361ef31012733f92a630d0b`; `product-dev/round-02-hardening` =
  `1caef22`; new `product-dev/round-02-residual-closeout` (final SHAs in
  [INDEPENDENT_REVIEW_HANDOFF.md](INDEPENDENT_REVIEW_HANDOFF.md)). `main` is an ancestor of both.
- No accepted document requires delivery on `main` (`git grep` over `docs/product-dev/**/*.md` and `README.md`: the
  only mention is FIX01's ref table).
- Classification: ACCEPTED_LIMITATION (delivery state). `main` was not merged, pushed, moved or rewritten.
- Future integration prerequisites: independent acceptance of this closeout, an Owner decision to integrate, then a
  fast-forward of `main` to the accepted commit (it is a descendant), and an off-device copy first.

## R04 — `ArchiveIndex.unexpected`

- Files: `ui/src/data/workspace/archiveIndex.ts:44-45,79` (FIX04), `ui/src/data/contract/history.schemas.json`
  (`original_verification_id` pattern `^SPEC-00[1-5]$`, copied verbatim from `service/contracts/openapi-history-v1.yaml:1970-1973`),
  `ui/src/data/history/decode.ts:31-34` (schema refusal), `ui/src/lib/useArchiveIndex.ts:29` (the only production
  caller of `indexArchive`, fed by `useHistoryList`'s admitted chain).
- Expected: an out-of-contract ID either cannot arrive, or is shown without being promoted into the five cases.
- Actual: the only supported path to `indexArchive` is a list page that passed `decodeHistoryList`. A page with
  `SPEC-009` is refused whole as `schema_invalid` (new test, passes on `1caef22` too). The Overview then shows the
  archive as not read and no counts. `unexpected` is reachable only through direct construction in a unit test
  (`workspace.test.tsx:93`). The comment "kept visible, never dropped" was false: nothing renders it.
- Classification: FALSE_POSITIVE for a hidden-record defect; the source comment was inaccurate.
- Resolution: comment corrected (`archiveIndex.ts:44-48`). Runtime validation untouched; Workspace not redesigned.
  Negative tests: decoder refusal, unchanged-page control, Overview with a SPEC-009 page (`residual-closeout.test.tsx`, R04).

## R05 — not_found versus failed reads

- Files: `ui/src/pages/Workspace.tsx:132-138` (FIX04 `Statement`), `:326-330` (`Register`); `ui/src/lib/useLiveCases.ts:17-24`
  (`liveSideOf`: 404 → `not_found`); `ui/src/data/local/provider.ts:150` (404 + envelope → `not_found`).
- Expected: a Service 404 is "no current result", distinct from a failed or unreachable read.
- Actual (`1caef22`): `notRead = cases − ready − reading`, so `not_found`, failed, unreachable and cancelled all
  became "could not be read"; all five `not_found` gave the headline "No current result could be read.". The
  Register counted only `ready` as "answered", although a 404 is the Service's answer. The accepted test
  `workspace.test.tsx:184` asserted "one could not be read" for a `run_not_found` 404, so it encoded the defect.
- Reproduction (before): `residual-closeout.test.tsx` R05 on unchanged sources — scenarios 2, 3, 5, 5b, 6 failed with
  e.g. `expected 'No current result could be read.' to be 'The Service holds no current result f…'`. Browser: the new
  e2e-workspace test replays the real Service's own 404 body (`GET /api/v1/verifications/SPEC-999` through the gate →
  404 `run_not_found`) for SPEC-003. On a `1caef22` worktree, Chrome and WebKit both rendered `… one is verified, one
  could not be read.`
- Production reachability: the product Service always holds the five runs, so a known-case 404 does not occur with the
  seeded states. It is a supported provider outcome (`LiveSide.not_found`), already named correctly by the comparison
  (`LIVE_MISSING`) and the case group "No current result", but contradicted by the headline.
- Classification: CONFIRMED.
- Resolution: see [CONFIRMED_FIXES.md](CONFIRMED_FIXES.md) §R05. No backend or Verdict change.

## R06 — RecordCheck tooltip

- Files: `ui/src/components/history/HistoryRows.tsx:42-51`; `ui/src/data/history/decode.ts:45-55` (`recordBinding`);
  `ui/src/data/history/provider.ts:174` and `ui/src/data/local/canonical.ts:307-325` (`checkPayloadDigest` /
  `crypto.subtle.digest`); `service/app/history_store.py:266-301` (`_read`).
- What happens where:
  - Service: on every read it recomputes SHA-256 of the stored candidate bytes, compares it with `candidate_sha256`,
    checks canonical form, identity bindings, the header seal, records and evidence rows (`history_store.py:273-299`).
  - Browser, History list row: no hash is computed. `recordBinding` checks that `integrity.status` is
    `INTEGRITY_VERIFIED`, that `checked_sha256` equals the digest embedded in `history_id`, and that `archive_id` and
    `snapshot_id` carry the same digest.
  - Browser, entry page: each received evidence payload is canonicalized and hashed with `crypto.subtle` and compared
    with its reference's `sha256` (`history/provider.ts:174`).
- Actual wording: "This browser confirmed that the reported digest names this entry." In this product "this browser"
  + digest elsewhere means a real SHA-256 computed in the browser (`HistoryEntry.tsx:177,415`, `Integrity.tsx:167`), so
  the sentence reads as a browser digest check that never happens. FIX03's reviewer judged it not false (F-04b); it is
  ambiguous rather than false, and the fix is one sentence.
- Classification: CONFIRMED (wording ambiguity).
- Resolution: tooltip now credits the digest check to the Service and says the browser did not recompute it and only
  compared it with the entry's IDs; the payload sentence says those digests are recomputed in the browser on the entry
  page. Visible text and the tag's assistive-technology name ("Integrity verified: record check · service") unchanged.
  Regression assertion in `residual-closeout.test.tsx` R06 (fails on `1caef22`).

## R07 — Provider replacement and stale reads

- Files: `ui/src/lib/useProviderRead.ts:111-119` (FIX04 effect deps `[auto, key, read]`; `load` kept in a ref),
  `ui/src/lib/useHistoryList.ts:24-41`.
- Reproduction (before), `residual-closeout.test.tsx` R07 on `1caef22`: with provider A then B under key `k`, B was
  never called and A's data stayed as B's (`expected {VR-2025…} not to be {VR-2025…}`); with A pending, switching to
  B left the state `loading` from A; a failing B never settled; `useHistoryList` kept A's four entries under B
  (`expected [ …(4) ] to have a length of +0`) and kept A's second page cursor. Controls passed: a stable provider
  read once across re-renders.
- Production reachability: providers are module singletons (`history/provider.ts:190-192`,
  `local/provider.ts:278-286`), and the two Detail routes that use different providers are separately keyed
  elements (`App.tsx:177-178`), so the app never swaps a provider under one key today.
- Classification: CONFIRMED at the hook-contract level (latent in the app).
- Resolution: [CONFIRMED_FIXES.md](CONFIRMED_FIXES.md) §R07. Same-provider behaviour unchanged (tested); provider
  contracts unchanged.
- Not changed: `useEvidenceAcquisition` (same pattern) keys its reads by run snapshot and is mounted only inside the
  keyed Detail routes; left as is and recorded in [REMAINING_LIMITATIONS.md](REMAINING_LIMITATIONS.md).

## R08 — Defensive null rendering

- Files: `ui/src/components/local/LocalResearch.tsx:44-110`, `ui/src/components/history/HistoryEntry.tsx:82-171`;
  callers `pages/VerificationDetail.tsx:636`, `pages/History.tsx:301`.
- Null is returned only for a settled `ready`/`partial` result that the caller did not render: (a) `partial`, (b)
  `ready` with `run.local === null`, (c) a History Detail whose `historyId` differs from the route.
- Supported paths: no provider ever returns `partial` (`kind: "partial"` appears only in the type in `data/access.ts:52`);
  `wireToView.ts:513` always sets `local` for LOCAL_RESEARCH runs (`local: null` exists only in the MOCK adapter
  `researchToView.ts:430`, which these routes never use); `decode.ts:96` refuses a Detail whose `history_id` is not
  the requested one (`identity_conflict`). All valid `ready` states render (covered by the accepted Detail and History
  suites).
- Classification: FALSE_POSITIVE (unreachable under the accepted decoder and providers). No change, as FIX03 also
  concluded.

## R09 — Optional contract-drift mutant fixtures

- File: `ui/src/test/contract-drift-mutations.test.ts:19` (FIX04: default
  `/Users/zhangshenghe/Documents/FlowAssert-UI-Review/evidence/contract/mutants`, override `FLOWASSERT_DRIFT_MUTANTS`).
- Actual: the folder exists here (12 mutants). The group is declared optional in `scripts/dev/test-inventory.json`;
  absent → 1 declared skip → `NOT RUN` from `check_test_inventory.py`, never PASS. Mandatory drift coverage is the 79
  in-repository mutations, unaffected.
- Classification: ACCEPTED_LIMITATION. The mutants are the independent audit's own evidence; they were not copied.
- Low-risk improvement applied: the default is now `FlowAssert-UI-Review/...` under `FLOWASSERT_PROTECTED_PARENT`
  (default this checkout's parent), the same variable the custody gate uses. Verified: with the genuine parent 92
  tests (13 replays RAN); with `FLOWASSERT_PROTECTED_PARENT=/nonexistent` 79 passed + 1 skipped (NOT RUN).

## R10 — CLS probe font readiness

- Files: `ui/scripts/dev/cls-probe.mjs:40-44` (FIX04: `goto`, then a fixed 800 ms, then read), `scripts/dev/rules_cls_probe.sh`;
  authoritative `ui/e2e/perf.spec.ts:13-61` with `e2e/helpers.ts:25-40`.
- Authoritative test: buffered observer from document start, `open()` awaits `document.fonts.ready`, then 500 ms.
  Not affected.
- Probe gate: buffered observer, but the window ended 800 ms after `load` regardless of font state, and the font state
  at the end was not recorded. Observed font completion on this Mac: 67–84 ms (`verify-full-20261023`), so today's
  margin is large; the method itself had no bound.
- Negative control (`evidence/cls-control/`): probe copies with every font response delayed 1500 ms and, separately,
  the accepted metric-matched serif fallback removed from the served CSS (restoring the Round 02 swap shift):

  | Fallback | Font delay | `1caef22` probe CLS (5 loads) | New probe CLS | New probe: fonts not loaded at 800 ms |
  | --- | --- | --- | --- | --- |
  | accepted | 0 | 0 ×5 | 0 ×5 | 0 |
  | accepted | 1500 ms | 0 ×5 | 0 ×5 | 5 |
  | removed | 0 | 0.136 ×5 | 0.136 ×5 | 0 |
  | removed | 1500 ms | **0 ×5 (shift missed)** | **0.136 ×5** | 5 |

- Classification: CONFIRMED (measurement gap in the probe gate).
- Resolution: [CONFIRMED_FIXES.md](CONFIRMED_FIXES.md) §R10. Threshold 0.1, 30 cold loads and the 800 ms minimum are unchanged.
  Thirty zero-CLS loads remain an observation on one machine, not a stability guarantee.

## R11 — Future optional Evaluator rule states

- Files: `service/vendor/model.py:245-248` (pinned, `b61779e1…a842d`): `existed_by_deadline` →
  `{"status": "unknown", ...}`, `workflow_execution` → `{"status": "unknown", ...}` unconditionally, with no expected or
  actual values; `ui/src/components/detail/ComparisonSheet.tsx:73-82`.
- Actual: every valid accepted output is `unknown` and renders "required by policy" / "not assessed". A pass/fail for
  these rules does not exist in the pinned Evaluator, and no source/destination evidence value exists to show.
- Classification: ACCEPTED_LIMITATION (future contract extension). No UI invention, Evaluator untouched, no sixth rule.

## R12 — Production JavaScript bundle size

- Production build of `f287274` in the clean clone (`evidence/build/`): 35 files, 1,080,533 bytes, `index.html` only.
  Critical path from `index.html`: `assets/index-*.js` 636,981 B (179,319 B gzip-9; Vite: 181.36 kB gzip) and
  `assets/index-*.css` 75,708 B (14,990 B gzip-9). One lazy route chunk (`States-*.js`, 14,177 B). Fonts 352,412 B,
  loaded by the CSS on demand. Vite's 500 kB warning is printed for the JS entry.
- Measured page behaviour (release run, `rules-cls-repeat`, 20 repeats, Chrome, loopback, no throttling,
  `evidence/devtree-release/rules-cls-repeat-perf.json`): first route cold, 295 kB transferred, first contentful paint
  124–184 ms; all routes CLS 0.
- No accepted performance budget exists (`git grep` for budget/chunk limits: only the CLS 0.1 budget). The warning
  predates FIX04 (the same code was split across shared chunks with the lab entry).
- Classification: ACCEPTED_LIMITATION (optimization opportunity). No speculative splitting; the warning threshold was not
  changed.

## R13 — 200-cell responsive matrix

- Files: `ui/scripts/dev/fix04-product-review.mjs`, `scripts/dev/regression.sh` (FIX04: not called).
- Assessment as a gate: the matrix makes real assertions per cell (overflow, one visible H1, chip overlap, clipped
  status text, mid-token identifier splits, keyboard-unreachable scroll containers, axe WCAG 2.1 A/AA, page errors,
  off-origin requests, visible focus on 12 Overview Tab stops, History table keyboard scroll at 768/1024) and exits 1
  on any problem or a cell count other than 200. Gaps for gate use: it measured whatever `dist/` held (no build, no
  proof that the preview served that build), it refused output directories outside the repository, and nothing
  checked the cell set itself.
- Classification: CONFIRMED.
- Resolution: [RESPONSIVE_GATE_RESULTS.md](RESPONSIVE_GATE_RESULTS.md).
