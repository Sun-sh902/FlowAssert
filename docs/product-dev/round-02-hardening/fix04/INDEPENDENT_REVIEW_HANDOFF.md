# FIX04 independent review handoff

**Implementation disposition: FIX04 — READY FOR INDEPENDENT ACCEPTANCE.** This is not an acceptance claim; the
independent reviewer decides.

## What to review

| Item | Value |
| --- | --- |
| Candidate code commit | `a30e4f338d2f363a17924b6fa8a33e4a8b2c329f` (tree `d32b7b0ee5881b9ab41e1b77ba5599790539afce`) |
| Report commit | Child of `a30e4f3`; changes only `docs/product-dev/round-02-hardening/fix04/**` (see `git log -1`, handoff message) |
| Branch | `product-dev/round-02-hardening` in `/Users/zhangshenghe/Documents/FlowAssert-Product-Dev` |
| Diff to review | `git diff e974c6d a30e4f3`: 8 files under `ui/` (RELEASE_CANDIDATE_IDENTITY.md) |
| Candidate bundle | `.dev-runtime/fix04-20261023-s2/candidate-a30e4f3.bundle`, SHA-256 `bb8aed6c…b395` |
| Final bundle | `.dev-runtime/recovery/flowassert-product-dev-fix04-final-<short>.bundle` + `.sha256` (created after the report commit) |
| Reviewer workspace | `/Users/zhangshenghe/Documents/FlowAssert-Product-Review/FIX04/` (does not exist yet; never created or written by the implementation) |

## Fixes to verify (IMPLEMENTED_FIXES.md)

1. Design lab out of the production build (`e759bd6`). `npm run build` → `dist` has only `index.html`, 35 files.
   `npm run dev` still serves `/lab.html`.
2. ComparisonStrip: no chip overlap at 1024 (`e759bd6`).
3. `VerdictPair` removed, unreferenced (`e759bd6`).
4. History ledger at 768–1279: in **WebKit**, Shift+Tab from the first entry reaches the "Archived evaluations table"
   region, and Arrow/End scroll to the *Archived* column. At ≥1280 there is no extra Tab stop (`a30e4f3`).
5. Workspace register at 1024–1279: no mono value split mid-token (`a30e4f3`).
6. AccessNotice facts: wrap at spaces (`#/states` 375, "not collected, redacted, expired") (`a30e4f3`).

## Suggested independent checks

- Re-run from a fresh clone of the bundle in your own directory:
  1. `scripts/dev/bootstrap.sh --harness`
  2. `FLOWASSERT_PROTECTED_PARENT=/Users/zhangshenghe/Documents scripts/dev/regression.sh <label>`

  Ports 4183/4184/5183/8765 must be free.
- Negative control for #4: with `ui/src/components/history/HistoryRows.tsx` from `e759bd6`, the history test
  "accessibility and layout of the history pages" must fail. Implementation result: 2 failed, exit 1.
- Supplemental matrix: `cd ui && npm run build && node scripts/dev/fix04-product-review.mjs <new absolute dir inside the clone>`
  (exits 1 on any problem; 200 cells).
- Manually in Safari at ~1024px, open `#/local/history`, press Tab into the table and use the arrow keys. Note that Safari
  needs Option+Tab to reach links.
- Challenge the judgement calls (FINAL_FINDING_TRIAGE.md #6, #7, #12, #13, and the hyphen/ellipsis wraps in
  REMAINING_LIMITATIONS.md).

## Implementation results (not independent)

| Check | Result |
| --- | --- |
| Clean clone of `a30e4f3`: bundle verify, `--no-hardlinks` clone, fsck strict, tree identity | PASS |
| Bootstrap `--harness` | PASS |
| Full regression, 24 gates (backend 247, Vitest 1644, Chrome+WebKit suites, real Service, history/exact-ID, CLS 30×0, axe, responsive, inventories, tracked evidence) | **24/24 PASS** |
| Supplemental matrix (10 scenarios × 5 widths × 2 themes × 2 engines) | **200/200 PASS** (clean clone and pre-commit) |
| Production build | 35 files, index.html only |
| Declared skips (screenshot captures, run-once probes) | 44, all inventory-declared, reported as SKIP |
| Firefox, screen readers, physical devices | NOT RUN |
| Off-device backup | BLOCKED |

Full table: FINAL_REGRESSION_SUMMARY.tsv. Process record, including failed and superseded runs:
`evidence/ATTEMPTS.md` and `evidence/session1/ATTEMPTS-session1.md`.

## Not done

- No Round 03 work.
- No changes to the Evaluator, Oracle, contracts, Service, fixtures, accepted evidence, test inventory or reviewer
  workspace.
- No push, remote, deployment or external connection.
