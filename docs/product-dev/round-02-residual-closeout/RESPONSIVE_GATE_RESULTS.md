# Responsive gate results (R13)

Implementation-side.

## What the gate is

`scripts/dev/regression.sh` (product and release profiles) runs, from `ui/`:

1. `responsive-matrix`: `npx vite build && node scripts/dev/fix04-product-review.mjs <run dir>/evidence/responsive-matrix`
   — builds this checkout, starts its own `vite preview` on 5183 (refused unless it serves this `dist/index.html`,
   whose SHA-256 is recorded with the commit) and its own Services on 8765, and stops only those processes.
2. `responsive-matrix-inventory`: `scripts/dev/check_test_inventory.py matrix responsive-matrix results.json` against
   `scripts/dev/test-inventory.json` → `matrix.responsive-matrix`.

The matrix reuses FIX04's script; no second suite was written. Its assertions were not changed.

## Coverage (inventoried, exact)

| Axis | Values |
| --- | --- |
| Engines | Google Chrome (channel `chrome`) 156.0.8078.47, Playwright WebKit 26.6 |
| Themes | light, dark |
| Widths | 375, 768, 1024, 1280, 1440 (height 900) |
| Scenarios (10) | `overview` `#/`, `verifications`, `detail` (SPEC-005), `history` `#/local/history`, `archived-detail` (all evidence read, integrity verified), `rules`, `states` — on the real Service `dev-main`; `unavailable` (Service stopped); `ui-corrupt` (INTEGRITY_FAILED entry) and `ui-unverifiable` (INTEGRITY_UNVERIFIABLE entry) on the seeded history runtime |
| Cells | 2 × 2 × 5 × 10 = 200 |

## Assertions per cell (a problem fails the cell; a failed cell fails the gate)

- no horizontal page overflow (`scrollWidth ≤ width`)
- exactly one visible `main h1`
- no comparison-chip overlap; no clipped status text (`[data-comparison]`, `.fa-seal`, `.fa-itag`)
- no monospaced identifier of 4–32 characters split between ordinary characters (hyphen, slash and ellipsis breaks are
  recorded as `wrapped`, not failed: FIX04 decision)
- no scroll container that hides visible text while not keyboard-focusable
- axe-core WCAG 2.0/2.1 A and AA: zero violations (aria-hidden `[data-ornament]` excluded, as in every accepted suite)
- no page error; no request outside `http://127.0.0.1:5183/`
- Overview: the first 12 Tab stops (Option+Tab in WebKit) each show a visible focus indicator
- History at 768 and 1024: the "Archived evaluations table" region is focusable and ArrowRight scrolls it to its end;
  at other widths it adds no Tab stop

The inventory check additionally fails a run when a cell is missing, duplicated or unlisted, or when a cell lacks the
results of its checks (layout, axe, scrollers, focus; `tableScroll` at 768/1024; 12 focus stops on the Overview), so a
screenshot-only cell cannot pass.

## Results on `f287274e70b1a7436741275db7306afae43e942e`

| Run | Environment | responsive-matrix | inventory |
| --- | --- | --- | --- |
| clean-product-f287274 | clean clone, sandbox denying all of `~/Documents` | exit 0 | 200 of 200 cells passed |
| clean-release-f287274 | clean clone, unsandboxed | exit 0 | 200 of 200 cells passed |
| devtree-release-f287274 | development tree at the commit | exit 0 | 200 of 200 cells passed |
| residual-precommit-1 | development tree, uncommitted identical code | exit 0 | 200 of 200 cells passed |

Per-cell table (problems, axe violations, page width, H1 count, recorded wraps, table scroll):
`evidence/clean-clone-product-sandboxed/matrix-cells.tsv`; matrix `summary.json`, `identity.json` (commit, clean
status, `dist/index.html` digest) and `processes.json` (preview SIGINT, Services exit 0) next to it.

## Failure propagation, verified

- The matrix script exits 1 on any problem or a cell count ≠ 200 (unchanged FIX04 logic); `gate` records FAIL and the
  run exits 1.
- Checker on real data: FIX04's clean-clone results → OK; FIX04's real pre-fix results
  (`matrix-register-before`, split identifiers etc.) → FAIL with 138 problems.
- Checker on mutated copies of real results: a missing cell, a duplicate, an injected axe problem, a cell without axe
  results, a History cell without keyboard scroll → each FAIL (`scripts/dev/tests/test_dev_scripts.py`, 9 tests).
- Output isolation: run-specific directory under the git-ignored run dir; `tracked-evidence` PASS in every run.
- Ports: the regression refuses to start with 4183/4184/5183/8765 occupied; the matrix also refuses 5183/8765. After
  every run: no listener on any of them.

## Cost

About 1.6 minutes per run on this Mac, build included (16:38:00→16:39:36Z and 16:54:00→16:55:37Z), both engines.
That is small next to the browser suites, so no separate fast/release split was needed for it. It is part of the product and release profiles. The portable
profile does not run browsers at all, as before. **Release acceptance requires the release profile, which includes the
matrix.** No previously accepted release coverage was removed: the release profile is FIX04's 24 gates plus these 2.

## Not claimed

Resized desktop viewports, not physical devices; today's synthetic content only; axe is not an assistive-technology
certification; Firefox not run.
