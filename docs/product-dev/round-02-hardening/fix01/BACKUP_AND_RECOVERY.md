# FIX01 — backup and recovery

## Observed state (2026-10-23, before any change)

| Item | Observation |
| --- | --- |
| Remotes | `git remote -v`: none. No remote was invented or registered; nothing was pushed. |
| Branches / tags | `main` `e11f4d5`, `product-dev/round-01` `90d3bc7`, `product-dev/round-02` `1d52026`, tag `phase3a-baseline` → `e11f4d5`; `product-dev/round-02-hardening` `1d52026` (created by the interrupted previous session). Single worktree, no stash. |
| Existing bundles | Only an unrelated 2026-10-15 bundle in `FlowAssert-backup-20261015-103328` (older project, different history). |
| Time Machine | `tmutil destinationinfo`: "No destinations configured"; `tmutil latestbackup`: cannot mount a destination. |
| iCloud Drive | `brctl status`: sync disabled ("app not installed"); `~/Documents` is not synced. |
| Conclusion | **No verified recoverable backup existed.** Absence of an observable backup is not proof that none exists elsewhere; none could be verified. |

## Local recovery proof (done)

| Bundle (`.dev-runtime/recovery/`, gitignored) | SHA-256 | Refs | Verified |
| --- | --- | --- | --- |
| `flowassert-product-dev-pre-fix01-1d52026.bundle` | `8bf0946b02e7c6a22ae5e125d8bf609b277a63241ae7217dfd3b026caf49e68f` | 5 (all, pre-FIX01) | `git bundle verify` OK; cloned (`cr-before`), HEAD `1d52026` |
| `flowassert-product-dev-fix01-14a0b77.bundle` | `b684a95b23d8d30bfa9a4d3a77629144a1a6ca0a483fb4dfd7c8cf1f58d5fa5a` | 5 + hardening `14a0b77` | verify OK; clone `fsck --full --strict` clean; every ref equal; 707 = 707 objects; HEAD tree equal |
| `flowassert-product-dev-fix01-af65bf4.bundle` | `944a8038d5edf474e0d1e28d99ade6ea7f0be068477bb640e9f1f27293a6efc4` | 5 + hardening `af65bf4` | verify OK; clone `fsck` clean; all final verification ran in this clone |
| Final bundle including the report commit | see the handoff message | all refs | verified after the report commit |

Recover: `git clone -b product-dev/round-02-hardening <bundle> <dir>` then
`git -C <dir> fetch origin '+refs/heads/*:refs/remotes/origin/*' '+refs/tags/*:refs/tags/*'`.

## Off-device disaster recovery — **BLOCKED**

The bundles are on the same disk, inside the repository directory: deleting or losing the repository or the disk loses them
too. **There is no off-device copy.** Creating one needs a destination the Owner approves (an external volume, Time Machine
target, or a private remote); none was named, so nothing was copied or published. Suggested Owner action: copy the final
bundle to an approved off-device location and record its SHA-256 there.

## Remote collaboration / PR — **not available**

No remote exists; no PR can be opened. The independent reviewer can work from the final bundle (`git clone` as above).
