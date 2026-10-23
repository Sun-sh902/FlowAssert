# Backup and recovery status (R01, R03)

Implementation-side, 2026-10-23.

## Three separate facts

| Question | Answer |
| --- | --- |
| Is there a Git remote? | **No** (`git remote -v`: empty). None was invented, registered or pushed to. |
| Is the full Git history recoverable? | **Yes, from this disk**: verified bundles, restored by clone and `fsck --full --strict` (below). |
| Is there an off-device disaster-recovery copy? | **No — OFF-DEVICE BACKUP PENDING OWNER DESTINATION.** Time Machine: "No destinations configured". `/Volumes`: only the internal disk. No previously authorized off-device destination is named in any report. Nothing was copied anywhere. |

## FIX04 bundle, independently re-verified

`.dev-runtime/recovery/flowassert-product-dev-fix04-final-1caef22.bundle`: SHA-256
`7a31ea68465c2941fffcad8acb2599f29f132e36af6f4be3da039521b400ec4f` (equal to its `.sha256` sidecar and to the reported
value); `git bundle verify` exit 0, complete history; refs equal to the repository's at the start of this closeout
(`evidence/preflight/refs-at-start.tsv`).

## Implementation-commit bundle and restore proof

| Item | Value |
| --- | --- |
| Bundle | `.dev-runtime/recovery/flowassert-product-dev-residual-impl-f287274.bundle` (`git bundle create --all`) |
| SHA-256 | `93ac45f8cb7826f8f7ccc581dfb3a2960852fbd41541a7104d7b6132f7bbbb14` (sidecar `.sha256`) |
| `git bundle verify` | exit 0 |
| Restore | `git clone --no-hardlinks -b product-dev/round-02-residual-closeout <bundle> <scratch dir>` → exit 0 |
| `git fsck --full --strict` | exit 0 |
| Restored HEAD / tree | `f287274e70b1a7436741275db7306afae43e942e` / `5ea648d95b8760c2d0f66ddada6edafdf5e1b4ea` = repository's |
| Refs | bundle heads identical to every repository ref (`evidence/recovery/impl-bundle-refs-vs-repo.diff` empty) |
| Ancestry | `1caef22` is an ancestor of the restored HEAD |

The separate clean-clone runs (`evidence/clean-clone-*`) were made from a `--no-hardlinks` clone of the same commit.

## Final bundle (after the report commit)

This file is part of the report commit, so it cannot contain that commit's hash or its bundle's digest. After the
report commit the implementation creates `.dev-runtime/recovery/flowassert-product-dev-residual-final-<short>.bundle`
with `--all`, verifies it, restores it with `--no-hardlinks`, runs `fsck --full --strict`, compares every ref and
writes `<bundle>.sha256`. The hash and results are given in the handoff message; check with `shasum -a 256` and
`git bundle verify`.

Restore: `git clone -b product-dev/round-02-residual-closeout <bundle> <dir>`.

## Refs and delivery state (R03)

| Ref | Commit | Changed by this closeout |
| --- | --- | --- |
| `main` | `e11f4d56589ca7fa9361ef31012733f92a630d0b` (Phase 3A baseline) | no |
| tag `phase3a-baseline` | `e11f4d5…` | no |
| `product-dev/round-01` | `90d3bc75b4d1a1e55adb8b2962c1da10a08cc88c` | no |
| `product-dev/round-02` | `1d52026683c22c2e69542084cf889774d507cd7e` | no |
| `product-dev/round-02-hardening` (frozen FIX04) | `1caef22693eb87ee483b2de187d74bd73246f106` | no |
| `product-dev/round-02-residual-closeout` | `1caef22` → `f287274` (code) → report commit | created here, fast-forward commits only |

History relationship: `main` → … → `1d52026` → FIX01 `d34f882` → FIX02 `203f702` → FIX03 `e974c6d` → FIX04 `e759bd6`,
`a30e4f3`, `1caef22` → closeout `f287274` → report commit (intermediate FIX commits omitted; all linear). No reset, rebase, amend, force, merge, push or ref deletion.
One temporary detached worktree (scratch, at `1caef22`, used for the browser "before" reproduction) was added and then
removed with `git worktree remove`; it held no commits.

Delivery is branch-based. No accepted document requires `main`. Future integration prerequisites: independent
acceptance of this closeout; the Owner's decision to integrate; an off-device copy first; then fast-forwarding `main` to
the accepted commit (it is a descendant, so no merge commit is needed).

## Owner action

Copy the final bundle (and optionally `.dev-runtime/recovery/`) to an approved off-device location (an external volume,
a Time Machine target or a private remote), record its SHA-256 there and run `git bundle verify` from that copy.
