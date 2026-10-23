# FIX04 implemented changes

Two implementation commits on top of the accepted FIX03 head `e974c6d`. A later report-only commit adds this folder.

| Commit | Content |
| --- | --- |
| `e759bd606cabf73b112aeb1d32ae982c475fa8d5` | Session 1: design lab out of the product build, ComparisonStrip overlap, unused `VerdictPair` |
| `a30e4f338d2f363a17924b6fa8a33e4a8b2c329f` | Session 2 (**release candidate code**): History ledger keyboard reach, register and notice identifier splitting, regression assertion, matrix checks |

## 1. Design lab removed from the production build (`e759bd6`, triage #1)

`ui/vite.config.ts`: the `build.rollupOptions.input` map that added `lab.html` was removed, so Vite's default
`index.html` entry is the only one. `ui/lab.html` and `ui/src/lab/**` are unchanged in Git, and `npm run dev` still
serves `/lab.html` and `/src/lab/main.tsx` (both HTTP 200; `evidence/session1/lab-development.log`). Output shrinks from
73 files / 1,800,693 bytes to 35 files / 1,079,138 bytes. See PRODUCTION_BUILD_REPORT.md.

## 2. ComparisonStrip chips no longer overlap (`e759bd6`, triage #2)

`ui/src/pages/Workspace.tsx` ComparisonStrip: `lg:grid-cols-6` removed. The existing `grid-cols-2 sm:grid-cols-3` layout
stays. The always-shown three states fit one row from 640px up, and rarer states wrap to a second row. No label is
shortened, clipped or hidden.

## 3. Unused `VerdictPair` removed (`e759bd6`, triage #3)

`ui/src/components/workspace/Comparison.tsx`: the unreferenced `VerdictPair` and its sole `ReactNode` import were
removed. No verdict, integrity or diagnostic mapping changed.

## 4. History ledger reachable by keyboard (`a30e4f3`, triage #4, #4a)

`ui/src/components/history/HistoryRows.tsx`: the wide ledger now uses the same mechanism as `EvidenceLedger`. While its
table is wider than its column (measured by `useScrollsHorizontally`), the wrapper is a `role="region"` named
"Archived evaluations table", with `tabIndex=0` and `scrollByKey` (Arrow/Home/End). When it fits (≥1280 with today's
data) it has no role and no Tab stop. `EvidenceLedger.tsx` exports its two existing helpers; their bodies are unchanged.
Row links, arrow-key movement between entries (`useRowKeys`) and the caption are unchanged. On the region,
Home/End scroll; on a link, they still move between entries.

This corrects session 1's uncommitted version, which set `tabIndex={0}` unconditionally.

## 5. Workspace register identifiers are not split (`a30e4f3`, triage #5)

`ui/src/pages/Workspace.tsx` `Register`: rows keep `grid-cols-[110px_minmax(0,1fr)]` below `lg` and from `xl`. In the
`lg` range only (1024–1279px, where the panel is a 4/12 column) they use `lg:grid-cols-1`, so the label sits above a
left-aligned value. No font size, colour, token or content changed.

## 6. AccessNotice facts wrap at spaces (`a30e4f3`, triage: same class as #5)

`ui/src/components/states/AccessStates.tsx`: the facts `<dd>` uses `break-words` instead of `break-all`. `break-all`
breaks every word at any character (`redacte|d,` at 375px). `break-words` wraps at spaces and breaks only a token
longer than the line, so long request paths and digests still cannot overflow (`<dd>` is `min-w-0` in a flex row).
The same `break-all` appears in `Integrity.tsx:135` and `VerificationDetail.tsx:514`. They were not changed because no
split reproduced there in any of the 200 cells (REMAINING_LIMITATIONS.md).

## 7. Regression assertion (`a30e4f3`)

`ui/e2e-history/history.spec.ts`, inside the existing test "accessibility and layout of the history pages … keyboard":

- At 1440 the ledger has no region and no `tabindex`.
- At 768 and 1024 the region exists. Shift+Tab from the first entry focuses it, ArrowRight scrolls it, and End reaches
  the last column (≤1px).
- At 1440 the region is gone again.

The test count is unchanged, so `scripts/dev/test-inventory.json` is unchanged. The assertion was negative-controlled:
with `HistoryRows.tsx` from `e759bd6`, it fails in Chrome and WebKit (`evidence/session2/negative-control-history.log`,
exit 1). With the fix, both pass (`targeted-history.log`, exit 0). No existing assertion was weakened.

## 8. Supplemental visual matrix (`e759bd6`, extended in `a30e4f3`)

`ui/scripts/dev/fix04-product-review.mjs` is a development script, not part of `regression.sh`. It covers 10
route/state scenarios on the real local Service, at 5 widths, in 2 themes, in Chrome and WebKit: 200 cells.
`a30e4f3` adds three checks:

- Every scroll container that hides visible (non-`sr-only`) text must be focusable.
- The History ledger must scroll to its end by keyboard at 768/1024 and add no Tab stop at ≥1280.
- Mono identifiers of 4–32 characters must not be broken between ordinary characters. Breaks after `-`, `/` or `…` are
  recorded as `wrapped`, not failed.

## Not changed

Fonts, type scale, palette and tokens; Evaluator, Oracle, contracts, Service and vendored sources; fixtures and
archives; business rules and verdict/integrity semantics; dependencies; the test inventory; FIX01–FIX03 evidence;
the reviewer workspace. No reset, rebase, amend, push, remote or deployment.
