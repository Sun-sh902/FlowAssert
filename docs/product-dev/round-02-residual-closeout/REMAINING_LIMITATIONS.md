# Remaining limitations

Implementation-side. Independent acceptance of this closeout is pending; nothing here is an acceptance claim.

## Environment and custody

- **Protected custody currently FAILS on this Mac, for a reason outside this repository.** macOS Finder wrote or
  modified ten `.DS_Store` files inside four protected historical roots on 2026-10-23 at 11:29:31 and 11:39:03 local time
  (after `verify-full-20261023` had passed custody at about 11:13):
  `FlowAssert-UI/{.DS_Store, .git/.DS_Store, .phase2-runtime/.DS_Store, docs/.DS_Store, node_modules/.DS_Store, src/.DS_Store}`,
  `FlowAssert-Integration-Planning/.DS_Store`, `FlowAssert-Integration-Review/evidence/.DS_Store`,
  `FlowAssert-Integration-Final-Audit/{.DS_Store, evidence/.DS_Store}`. Git state is equal in all six roots; only these
  Finder metadata files differ from the accepted baseline (`service/evidence/protected-before.json`). Five are listed in
  that baseline and now have different bytes (`FlowAssert-UI/{.DS_Store, docs/, src/, node_modules/}.DS_Store`,
  `FlowAssert-Integration-Planning/.DS_Store`); five are new (`FlowAssert-UI/.git/.DS_Store`,
  `FlowAssert-UI/.phase2-runtime/.DS_Store`, `FlowAssert-Integration-Review/evidence/.DS_Store`,
  `FlowAssert-Integration-Final-Audit/{.DS_Store, evidence/.DS_Store}`). Exact list with times:
  `evidence/custody/custody-difference-files.tsv`. This closeout may not modify protected roots, so they were left as
  found and the gate reports FAIL, as it should.
- **The same Finder activity broke the release harness preparation.** `FlowAssert-Phase3A-Service/.venv/.DS_Store`
  (created 11:29:31) makes the accepted `ui/scripts/phase3a/prepare_lookup_runtime.py` report ".venv differs from
  original" (it skips `.DS_Store` when copying but not when listing the original). So `bootstrap.sh --harness` now fails
  in any new clone, and a clean-clone release run is not possible on this machine until the Owner acts. The dev tree's
  ID-lookup and Phase 2 runtimes were prepared and certified by bootstrap before that time and were used for the
  release-profile run on the exact commit.
- Owner action, without opening those folders in Finder: restore the five baseline `.DS_Store` files to their accepted
  bytes (e.g. from an accepted backup) and remove the five new ones and `FlowAssert-Phase3A-Service/.venv/.DS_Store`
  (and the other new `.DS_Store` files under `FlowAssert-Phase3A-Service`, which the harness copy check may also hit).
  Then run `FLOWASSERT_PROTECTED_PARENT=/Users/zhangshenghe/Documents scripts/dev/protected_custody.sh` (expect exit 0),
  then a fresh clone with `bootstrap.sh --harness` and the release profile. Any further Finder browsing of a protected
  root will produce the same result.
- The release profile, historical custody and `e2e-lookup` / `e2e-local` run only where the genuine historical roots
  exist (today, this Mac). The product profile is the cross-machine product regression; it is not the complete one.
- Fixed ports 4183/4184/5183/8765. Chrome is the self-updating stable channel (recorded per run), not a pinned binary.

## Recovery

- **OFF-DEVICE BACKUP PENDING OWNER DESTINATION.** No remote, no Time Machine destination, no external volume. Every
  bundle is on the internal disk in this repository's git-ignored `.dev-runtime/recovery/`.
- `main` stays at the Phase 3A baseline; delivery is branch-based (R03).

## Product semantics left as they are

- A user-cancelled live read with nothing else read still yields the headline "No current result could be read."
  The case rows say "read cancelled". The finding did not name cancelled reads, so this was not changed.
- `useEvidenceAcquisition` has the same "provider not in the lifecycle" shape fixed in R07. Its reads are keyed by the
  run's snapshot and it is mounted only inside keyed Detail routes, so no supported path swaps its provider. Not changed.
- `ArchiveIndex.unexpected` is unreachable under the accepted contract and is not rendered. If a future contract
  admits more case IDs, the Overview must show those entries before such a contract is accepted.
- Optional Evaluator rules (`existed_by_deadline`, `workflow_execution`) are always `unknown` in the pinned Evaluator.
  A future pass/fail would show the status word in the observed column. Revisit only with a contract change (R11).
- The production JavaScript is one chunk above Vite's 500 kB warning (R12). No budget exists; not split.

## Coverage not run

- Firefox, physical VoiceOver/NVDA sessions and physical devices: NOT RUN. Chrome/WebKit keyboard, DOM names and axe
  are bounded evidence, not an assistive-technology certification.
- The responsive matrix proves its checked properties for today's synthetic content at five widths in resized desktop
  viewports. Longer IDs, more cases or new copy can wrap differently. Hyphen/ellipsis wraps are recorded, not failed
  (FIX04 decision).
- Thirty zero-CLS cold loads and twenty repeats are observations on one machine, not a stability guarantee.

## Retained from FIX01–FIX04

- The bootstrap harness checks its completion marker and directory, not deep runtime integrity.
- The pytest inventory is count-based.
- A capture read interrupted after a test's final settle is annotated, not failed.
- Historical missing Round 02 traces are not recreated.
- Untracked empty `FIX0n/final-audit-01/` folders at the repository root are Owner housekeeping.
