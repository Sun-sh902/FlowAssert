# FIX04 release candidate identity

| Item | Value |
| --- | --- |
| Repository | `/Users/zhangshenghe/Documents/FlowAssert-Product-Dev` (only writable implementation workspace) |
| Branch | `product-dev/round-02-hardening` |
| **Candidate code commit** | **`a30e4f338d2f363a17924b6fa8a33e4a8b2c329f`** |
| Candidate tree | `d32b7b0ee5881b9ab41e1b77ba5599790539afce` (equal in the clean clone) |
| Parent | `e759bd606cabf73b112aeb1d32ae982c475fa8d5` (FIX04 session 1) → `e974c6dfc258c1fda6700db7a87c2a1331ed40ca` (accepted FIX03) |
| Report commit | The commit that adds this folder, directly on top of `a30e4f3`. It changes only `docs/product-dev/round-02-hardening/fix04/**`; its hash is given in the handoff message and in `git log`. |
| Author / date | Sun-sh902, 2026-10-23 10:53:18 −0400 |

## Ancestry (verified with `git merge-base --is-ancestor <x> a30e4f3`, all true)

`1d52026` (Round 02 closeout) → `d34f882` (FIX01 accepted) → `203f702` (FIX02 accepted) → `4f13a13`, `529db23`
(FIX03 implementation) → `e974c6d` (FIX03 accepted) → `e759bd6` → `a30e4f3`.

No commit was reset, rebased, amended or rewritten. Other refs are unchanged: `main` `e11f4d5`,
`product-dev/round-01` `90d3bc7`, `product-dev/round-02` `1d52026`, tag `phase3a-baseline` `e11f4d5`.

## Change scope `e974c6d..a30e4f3`

```
 ui/e2e-history/history.spec.ts              |  23 +++++
 ui/scripts/dev/fix04-product-review.mjs     | 146 ++++++++++++++++++++++++++++
 ui/src/components/history/HistoryRows.tsx   |  12 ++-
 ui/src/components/states/AccessStates.tsx   |   2 +-
 ui/src/components/states/EvidenceLedger.tsx |   4 +-
 ui/src/components/workspace/Comparison.tsx  |  14 ---
 ui/src/pages/Workspace.tsx                  |   8 +-
 ui/vite.config.ts                           |   9 +-
 8 files changed, 190 insertions(+), 28 deletions(-)
```

`git diff --name-only e974c6d a30e4f3 -- service contracts scripts/dev/test-inventory.json ui/docs docs/product-dev/round-02-hardening/fix0[123]`
returns nothing. The candidate changes no Service, vendored Evaluator, contract, test inventory, committed UI
evidence or FIX01–FIX03 report.

## Toolchain recorded by the clean-clone run

Darwin 27.2.0 arm64. Node 26.10.0. Chrome 156.0.8078.47 (installed stable channel). Playwright WebKit 26.6. Firefox
155.0 present but not run (not mandatory). Python (Service venv) 3.14. Backend source map
`a5d68b75d67624e22223fa8ee9328447d96e639001dfac8cea271e4331b34b45` (pinned-identities gate, `problems: []`).

## Candidate recovery bundle

`.dev-runtime/fix04-20261023-s2/candidate-a30e4f3.bundle`, SHA-256
`bb8aed6c8a3b672fc6f246dd1e3c793b0428bc6cbee514ad70f621467111b395`, `git bundle verify` OK. The clean clone was made
from it. See BACKUP_AND_RECOVERY_STATUS.md for the final bundle that includes the report commit.
