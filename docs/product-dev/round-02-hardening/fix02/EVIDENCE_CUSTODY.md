# FIX02 — regression evidence custody

## Every report writer, at d34f882

| Writer | Default destination | Tracked? | Under `regression.sh` at d34f882 | Disposition |
| --- | --- | --- | --- | --- |
| `regression.sh` gate logs, `summary.tsv` | `docs/product-dev/evidence/regression/<LABEL>/` | directory tracked (`round01-final/`) | new label → new **untracked files inside the tracked tree**; reuse refused (no overwrite) | **CONFIRMED (G09)** — moved |
| `e2e-workspace` `writeEvidence` (axe, custody, overview requests) | `docs/product-dev/round-02/evidence/e2e-workspace/` | **yes** | not redirected → **overwrote committed Round 02 evidence** | **CONFIRMED (G08)** |
| `e2e-workspace` screenshots (`SHOTS`; tests run unconditionally, Chrome) | `docs/product-dev/round-02/screenshots/after/` | **yes** | not redirected → **overwrote committed screenshots** | **CONFIRMED (G08)** |
| `e2e-history` `writeEvidence` (+ `../proxy/`) | `ui/docs/phase3a/evidence/e2e` | ignored | shared across runs, not per run | redirected per run |
| `e2e-lookup` `writeEvidence`, backend receipts, visual record | `ui/docs/phase3a/id-addressability-remediation-03/evidence/e2e` | ignored | shared across runs | redirected per run |
| `e2e-local` `writeEvidence` | `ui/docs/phase2/evidence/e2e` | ignored | shared across runs | redirected per run |
| static `writeReport` (axe, perf, responsive, focus …) | `ui/e2e/.output/` | ignored | shared; **20 parallel perf repeats wrote one file**; stale files from earlier runs remain beside new ones | **CONFIRMED (G06)** — per-repeat names, per-run directory |
| `rules_cls_probe.sh` / `cls-probe.mjs` | path given by the gate (`$OUT/rules-cls-probe.json`) | follows `$OUT` | per run | page errors and browser version added (G07) |
| `FA_CAPTURE` screenshot specs (static, history, local) | `ui/docs/screenshots/…` | untracked, not ignored | skipped (FA_CAPTURE unset) | unchanged; the regression now also `unset`s FA_CAPTURE/FA_CAPTURE_DIR |
| Playwright `outputDir` (error-context, traces) | `ui/test-results*` | ignored | wiped at the start of the next run, so failure artifacts were lost (the Round 02 traces were lost this way, BROWSER_FAILURE_ROOT_CAUSE.md) | kept per run: `--output $OUT/artifacts/<gate>` |

## Reproduction of the overwrite (G08)

Clean clone of d34f882, the regression's own gate command, nothing else:

```
cd ui && env FA_BROWSERS=chrome,webkit npx playwright test -c playwright.workspace.config.ts   # exit 0, 31 passed, 1 skipped
git status --porcelain
```

Result (`evidence/before-d34f882/custody/`): **17 tracked files rewritten** — 2 JSON
(`round-02/evidence/e2e-workspace/custody-chrome.json`, `overview-requests-chrome.json`) and 15 PNGs under
`round-02/screenshots/after/` — plus 6 new untracked files in that tracked directory. `tracked-docs.diff` lists the 17
changed SHA-256 values. The gate exited 0, so nothing reported it. The clone was restored with `git checkout -- docs &&
git clean -fd docs`. The main workspace was never used for this run, and its tracked evidence is unchanged.

The committed Round 02 evidence itself is consistent with the Round 02 report. `e2e-workspace-fresh-clone/` and
`screenshots/after-fresh-clone/` were written by redirected runs. Round 02 B6 already records that
`screenshots/after/` predates the final label fix. FIX02 changes none of these historical files.

## Fix

- `regression.sh`: the default run directory is now the git-ignored `.dev-runtime/regression/<LABEL>/`. A run directory
  inside the repository that git does not ignore is refused, and a reused label is refused as before.
  `run-identity.tsv` records the run ID (= label), full commit, branch, number of worktree changes, mode, start time,
  host and directory.
- Full mode redirects every suite into the run: `FA_STATIC_REPORT_DIR`, `FA_WORKSPACE_EVIDENCE_DIR`,
  `FA_WORKSPACE_SCREENSHOT_DIR`, `FA_HISTORY_EVIDENCE_DIR`, `FA_LOOKUP_EVIDENCE_DIR`, `FA_E2E_EVIDENCE_DIR` →
  `$OUT/evidence/<gate>/`. Playwright artifacts go to `$OUT/artifacts/<gate>/`, JSON reports to `$OUT/<gate>.json`.
  Every gate has its own directory, so parallel workers of one gate never share a report file with another gate.
- New last gate **`tracked-evidence`**: SHA-256 of every tracked file under `docs/` and `ui/docs/`, plus `git status`
  of both (untracked included), before the first gate and after the last. Any difference fails the run.
- `e2e-workspace/support.ts`: the defaults are now `ui/test-results-evidence/e2e-workspace[/screenshots]` (ignored). A
  direct `npx playwright test -c playwright.workspace.config.ts` can no longer rewrite committed evidence either; writing
  to `docs/` needs an explicit environment variable.
- `perf.spec.ts`: one report per project and repeat, with identity (CLS_VERIFICATION.md).

## Verified after the fix

- Clean-clone full regression: the `tracked-evidence` gate **PASS**; `git status --porcelain` in the clone **empty**
  after the run (`REGRESSION_SUMMARY.tsv`).
- Main workspace tracked evidence: `git diff --stat 1d52026 HEAD -- docs/product-dev/round-02 docs/product-dev/evidence`
  is empty at the FIX02 commits. No historical Round 02 or Round 01 artifact was modified.
