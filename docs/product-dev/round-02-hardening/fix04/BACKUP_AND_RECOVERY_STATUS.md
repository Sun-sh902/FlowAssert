# FIX04 backup and recovery status

## Observed (2026-10-23, session 2)

| Item | Observation |
| --- | --- |
| Git remotes | `git remote -v`: none. None was invented, registered or pushed to. |
| Time Machine | `tmutil destinationinfo`: "No destinations configured". |
| Refs | `main` `e11f4d5`, `product-dev/round-01` `90d3bc7`, `product-dev/round-02` `1d52026`, tag `phase3a-baseline` `e11f4d5` (all unchanged); `product-dev/round-02-hardening` advanced `e974c6d → e759bd6 → a30e4f3 →` report commit, by fast-forward commits only. |
| History rewriting | None: no reset, rebase, amend, force or ref deletion. |

## Existing recovery bundles re-verified

`git bundle verify` exit 0 for every bundle (`evidence/session2/recovery-existing.log`):

| Bundle | SHA-256 | Matches earlier record |
| --- | --- | --- |
| `.dev-runtime/recovery/flowassert-product-dev-pre-fix01-1d52026.bundle` | `8bf0946b…e68f` | yes (FIX01) |
| `.dev-runtime/recovery/flowassert-product-dev-fix01-14a0b77.bundle` | `b684a95b…5fa5a` | yes (FIX01) |
| `.dev-runtime/recovery/flowassert-product-dev-fix01-af65bf4.bundle` | `944a8038…6efc4` | yes (FIX01) |
| `.dev-runtime/recovery/flowassert-product-dev-fix01-final-d34f882.bundle` | `a778da3b…262a84` | — |
| `.dev-runtime/recovery/flowassert-product-dev-fix02-fd92903.bundle` | `b6c9012c…e6db` | — |
| `.dev-runtime/recovery/flowassert-product-dev-fix02-final-203f702.bundle` | `b69b492d…8783a` | — |
| `.dev-runtime/fix04-20261023/candidate-e759bd6.bundle` (session 1) | `f40d3c0e…0da65` | yes (session 1 `recovery/bundle-sha256.txt`) |
| `.dev-runtime/fix04-20261023-s2/candidate-a30e4f3.bundle` | `bb8aed6c8a3b672fc6f246dd1e3c793b0428bc6cbee514ad70f621467111b395` | created here |

## Candidate recovery, proven

The `a30e4f3` bundle was cloned with `--no-hardlinks`, detached at the candidate, and passed `git fsck --full --strict`.
Its tree equals the repository's (`d32b7b0e…`), and it bootstrapped and passed the full regression (CLEAN_CLONE_VERIFICATION.md).
That is a complete restore-and-run proof for the candidate code.

Session 1 also checked the existence and type of every ref's object after a bundle round-trip
(`evidence/session1/recovery/all-ref-objects.json`). Its first attempt wrongly assumed every ref is a commit; the
tool-created `refs/codex/turn-diffs/...` ref points to a tree. That attempt is kept (`all-ref-assumed-commit.json`).

## Final bundle including the report commit

This file is part of the report commit, so it cannot contain that commit's hash or its bundle's digest. After
committing, the implementation creates
`.dev-runtime/recovery/flowassert-product-dev-fix04-final-<short>.bundle` with `--all`. It then runs
`git bundle verify` on it, clones it with `--no-hardlinks`, runs `fsck --full --strict`, compares every ref with the
repository, and writes the SHA-256 next to it as `<bundle>.sha256`. The hash and the result are given in the
handoff message. The reviewer can check them with `shasum -a 256` and `git bundle verify`.

Restore: `git clone -b product-dev/round-02-hardening <bundle> <dir>`.

## Off-device disaster recovery: **BLOCKED**

Every bundle sits on the same disk, inside this repository's git-ignored `.dev-runtime/`. Losing the disk or the
folder loses the history and every bundle. There is still **no off-device copy**: no remote exists, Time Machine has no
destination, and no Owner-approved destination was named. Nothing was copied or published anywhere.

Owner action: copy the final bundle (and optionally `.dev-runtime/recovery/`) to an approved off-device location (an
external volume, a Time Machine target or a private remote). Then record its SHA-256 there and run `git bundle verify`
from that copy.
