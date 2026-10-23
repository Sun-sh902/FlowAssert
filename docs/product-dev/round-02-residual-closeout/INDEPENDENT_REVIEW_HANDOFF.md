# Independent review handoff — Round 02 residual closeout

## Implementation disposition: **ROUND 02 RESIDUAL CLOSEOUT — REMEDIATION REQUIRED**

The implementation does not approve its own work. The remediation that remains is **environmental and belongs to the
Owner**. No known product or test defect remains, but the release profile does not pass on this machine:

- `protected-custody` FAILS. On 2026-10-23 at 11:29:31 and 11:39:03 local time, macOS Finder wrote or modified ten
  `.DS_Store` files in four protected historical roots. Git state is equal in all six roots. This closeout may not touch
  those roots, so the gate correctly fails.
- The same Finder activity (`FlowAssert-Phase3A-Service/.venv/.DS_Store`) makes `bootstrap.sh --harness` fail in any
  new clone. A **clean-clone** release profile therefore cannot be prepared on this machine today.

Everything else passed on the exact code commit, see below. After the Owner remediation in
[REMAINING_LIMITATIONS.md](REMAINING_LIMITATIONS.md) §"Environment and custody", the release profile should be re-run
from a fresh clone. That re-run is the remaining evidence.

## What to review

| Item | Value |
| --- | --- |
| Frozen FIX04 candidate | `1caef22693eb87ee483b2de187d74bd73246f106` (`product-dev/round-02-hardening`, unchanged) |
| Candidate code commit | `f287274e70b1a7436741275db7306afae43e942e` (tree `5ea648d95b8760c2d0f66ddada6edafdf5e1b4ea`) |
| Report commit | child of `f287274`; adds only `docs/product-dev/round-02-residual-closeout/**` (see `git log -1`) |
| Branch | `product-dev/round-02-residual-closeout` in `/Users/zhangshenghe/Documents/FlowAssert-Product-Dev` |
| Diff to review | `git diff 1caef22 f287274`: 20 files (`ui/src` 10, `ui/scripts/dev` 2, `ui/e2e-workspace` 1, `scripts/dev` 6 incl. inventory and tests, `README.md`) |
| Implementation bundle | `.dev-runtime/recovery/flowassert-product-dev-residual-impl-f287274.bundle`, SHA-256 `93ac45f8cb7826f8f7ccc581dfb3a2960852fbd41541a7104d7b6132f7bbbb14` |
| Final bundle | `.dev-runtime/recovery/flowassert-product-dev-residual-final-<short>.bundle` + `.sha256`, created after the report commit (hash in the handoff message) |

## Results on `f287274` (implementation-side, not independent)

| Run | Profile / environment | Result |
| --- | --- | --- |
| clean-product-f287274 | product; clean clone; `sandbox-exec` denying all of `~/Documents` | **exit 0**: 21 PASS, 5 NOT RUN (custody, e2e-lookup, e2e-local + inventories) |
| devtree-release-f287274 | release; development tree at the commit, bootstrap-certified runtimes | exit 1: **25 PASS**, 1 FAIL (`protected-custody`, Finder) |
| clean-release-f287274 | release; clean clone | exit 1: 23 PASS, 3 FAIL (custody; `e2e-local` + inventory because `bootstrap --harness` stopped on the Finder `.venv/.DS_Store`); its `e2e-lookup` PASS used an uncertified runtime and is not counted |
| protected_custody.sh | historical custody, standalone | exit 1, ten `.DS_Store` differences (`evidence/custody/`) |

Counts in the passing gates: backend 247; dev scripts 31; Vitest 1664 (incl. 20 new; 13 optional audit replays RAN in
the release runs); e2e-static 140 (+24 declared skips); CLS repeat 20, probe 30/30 at 0 with fonts loaded; e2e-workspace
33 (+1); e2e-history 68 (+8); e2e-lookup 57 (+3); e2e-local 34 (+8); responsive matrix 200/200; tracked evidence
unchanged. Full table: [FINAL_REGRESSION_SUMMARY.tsv](FINAL_REGRESSION_SUMMARY.tsv).

## Focused checks requested

1. **R05**: on `1caef22` vs `f287274`, run `npx vitest run src/test/residual-closeout.test.tsx -t R05` and the
   e2e-workspace test "Overview: a live 404 from the Service…". Confirm a 404 is never "could not be read", and that
   failures, unreachable and pending reads keep their own wording. Challenge whether the corrected
   `workspace.test.tsx:184` assertion was right to change.
2. **R06**: read the tooltip in `HistoryRows.tsx:46` against `decode.ts:45-55` and `history/provider.ts:174`.
3. **R07**: review the render-phase reset in `useProviderRead.ts`/`useHistoryList.ts` for loops or a frame of stale
   data. Run the 90 `evidence-mode-switch-race` tests and the accepted `useProviderRead` tests.
4. **R10**: re-run the negative control (`evidence/cls-control/probe-{old,new}.mjs`, `FA_STRIP_FALLBACK=1
   FA_FONT_DELAY_MS=1500`) against a preview on 4184. Confirm the gate script still fails CLS ≥ 0.1 and page errors.
5. **R02/R13**: run `regression.sh --product` from a clone that cannot read `~/Documents`
   (the sandbox used here: `evidence/clean-clone-product-sandboxed/tools/nodocs.sh`). Break one matrix cell (e.g.
   force an overflow) and confirm `responsive-matrix` and the run fail. Confirm NOT RUN rows never count as PASS.
6. **Custody**: after the Owner restores the roots, run `FLOWASSERT_PROTECTED_PARENT=/Users/zhangshenghe/Documents
   scripts/dev/protected_custody.sh` (expect 0), then a fresh clone with `bootstrap.sh --harness` and
   `regression.sh <label>` (expect 26/26).
7. Challenge the classifications of R04 and R08 (FALSE_POSITIVE), and of R03, R09, R11 and R12 (ACCEPTED_LIMITATION).

## Not done

- No change to the Evaluator, Oracle, contracts, Service, fixtures, protected roots, FIX01–FIX04 reports or accepted
  evidence. No merge, push, remote or external connection. No Round 03 work.
- The Finder `.DS_Store` files were not removed or restored (protected roots).
- Off-device backup: PENDING OWNER DESTINATION.
