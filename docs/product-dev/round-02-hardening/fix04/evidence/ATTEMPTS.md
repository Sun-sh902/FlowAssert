# FIX04 session 2 execution record

Date: 2026-10-23 (America/New_York). Session 1's record is `session1/ATTEMPTS-session1.md`. No failed or superseded run
was deleted or overwritten. Every run wrote to a new directory under `.dev-runtime/fix04-20261023-s2/`.

1. **Entry state.** HEAD `e759bd6` on `product-dev/round-02-hardening`. Uncommitted were `HistoryRows.tsx`,
   `EvidenceLedger.tsx`, `fix04-product-review.mjs` and an untracked `fix04/` with three draft reports. Session 1's
   evidence and its clean clone of `e759bd6` were found under `.dev-runtime/fix04-20261023/`. The session 1 clone was
   still clean at `e759bd6`. The six reviewer reports re-hashed equal to `session1/before/review-source-hashes.json`.
2. **Pending fix reviewed, not trusted.** Session 1's WebKit table probes disagreed (`regionScroll` 226 vs 0), and its
   pending change made the region a Tab stop at every width. The change was rewritten to the conditional
   `EvidenceLedger` pattern.
3. **Targeted test.** History "accessibility and layout … keyboard" test, extended. Chrome + WebKit: 2 passed, exit 0
   (`session2/targeted-history.log`).
4. **Negative control.** The same test with `HistoryRows.tsx` from `e759bd6`: 2 failed (region count 0 ≠ 1), exit 1
   (`negative-control-history.log`). The file was restored and verified with `cmp`.
5. **Stale build discovered.** The next all-routes overflow probe showed History `tabIndex -1`, because the negative
   control's web server had rebuilt `dist` from the pre-fix file. That probe is kept as the pre-fix measurement
   (`overflow-probe-before.log`). After `npm run build`, the text-extent probe showed the regions in place
   (`overflow-text-probe-after.log`). It also showed that the 9px Verifications overflow hides only `sr-only` text.
6. **Matrix `matrix-worktree`** (HistoryRows fix, generic scroll-container check): 200/200, exit 0. Visual inspection of
   the WebKit dark 1024 Overview then exposed the register mid-token splits, which no automated check had flagged.
7. **Register fix and split check added.** `matrix-register-before` (Chrome, `Workspace.tsx` from `e759bd6`) exit 1, and
   `matrix-worktree-2` exit 1: 124/200. The first split check also failed normal hyphen/ellipsis wraps, so it was a
   harness defect, not a product failure. The check was refined to fail only breaks between ordinary characters.
8. **Refined runs.** `matrix-register-before-refined` (Chrome, 100 cells): 96 pass. It fails Overview 1024 light/dark
   (`INTEGRITY_|VERIFIED`, `research_o|nly`) and `#/states` 375 light/dark (`redacte|d,`, pre-existing `break-all`).
   `matrix-worktree-refined`: 196/200, only the `#/states` 375 split remaining.
9. **AccessNotice fix** (`break-all` → `break-words`). Final typecheck, lint, Vitest (37 files / 1644 tests) and build:
   all exit 0. `matrix-precommit`: 200/200, exit 0.
10. **Candidate commit** `a30e4f3`. Clean-clone driver: bundle, clone, detach, fsck, identity, bootstrap `--harness`,
    full regression (24/24 PASS), matrix (200/200), production build, lab checks, final status. Every step exit 0
    (`clean-clone-a30e4f3/`).
11. **Recovery.** All existing bundles verified (`session2/recovery-existing.log`). The final bundle is created after
    the report commit (BACKUP_AND_RECOVERY_STATUS.md).

During every run, the ports were checked free before start, and each runner stopped only the processes it started.
Nothing was pushed, deployed or connected externally.
