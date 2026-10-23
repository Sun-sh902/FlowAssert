# FIX04 product UI verification

## Method

`ui/scripts/dev/fix04-product-review.mjs` serves the production build with `vite preview` on 127.0.0.1:5183. It runs the
real local Python Service on 127.0.0.1:8765 in four states, owning only the processes it starts:

- `dev-main`
- stopped (Service unavailable)
- `ui-corrupt`
- `ui-unverifiable`

It drives Chrome (installed stable, 156.0.8078.47) and Playwright WebKit (26.6). There is no response interception and no
fixture mutation.

| Scenario | Route | Archive state |
| --- | --- | --- |
| Overview (incl. ComparisonStrip, register) | `#/` | dev-main |
| Verifications | `#/verifications` | dev-main |
| Verification Detail | `#/local/verifications/SPEC-005` | dev-main |
| History | `#/local/history` | dev-main |
| Archived Detail (all evidence pages read) | `#/local/history/<newest>` | dev-main |
| Rules | `#/rules` | dev-main |
| States specimens (MOCK) | `#/states` | dev-main |
| Service unavailable | `#/` | Service stopped |
| Integrity failed | `#/local/history/<damaged>` | ui-corrupt |
| Integrity unverifiable | `#/local/history/<damaged>` | ui-unverifiable |

Each scenario runs at 375, 768, 1024, 1280 and 1440px, in light and dark, in both engines: **200 cells**. Each cell
records a full-page screenshot, computed type of up to 90 visible text elements, page scroll width, visible H1s,
ComparisonStrip chip intersections, clipped status text, every horizontal scroll container (overflow, focusability,
visible text past its edge), forced identifier splits and soft wraps, axe (WCAG 2.0/2.1 A/AA, `[data-ornament]`
excluded as in every accepted suite), page errors and every request URL. On Overview it also records 12 Tab stops with
`:focus-visible` and ring/outline styles.

A cell fails on any of the following:

- page horizontal overflow
- a visible H1 count other than 1
- a chip overlap
- clipped status text
- a scroll container that hides visible text without being focusable
- History not keyboard-scrollable at 768/1024, or a History Tab stop at ≥1280
- a forced identifier split
- any axe violation
- a page error
- an off-origin request
- a focus stop without a visible indicator

## Results

| Run | Commit / tree | Cells | Pass | Fail | Exit |
| --- | --- | --- | --- | --- | --- |
| **Clean clone** (`evidence/clean-clone-a30e4f3/matrix/`) | `a30e4f3`, clean | 200 | **200** | 0 | 0 |
| **Pre-commit** (`evidence/session2/matrix-precommit-*`) | identical tree, worktree | 200 | **200** | 0 | 0 |
| Before, register (`matrix-register-before-refined-*`) | `a30e4f3` source with `Workspace.tsx` from `e759bd6`; Chrome only | 100 | 96 | 4 | 1 |
| Session 1 baseline (`evidence/session1/before/matrix-corrected-summary.json`) | `e974c6d`; Chrome only, no keyboard/split checks | 90 | 88 | 2 | 1 |

Per-cell data: `evidence/clean-clone-a30e4f3/matrix/cells.tsv` (200 rows), `evidence/session2/matrix-precommit-cells.tsv`,
`evidence/session2/matrix-register-before-refined-cells.tsv`. The full results JSON and all 208 clean-clone screenshots
(200 cells + 8 keyboard-scrolled History views) are retained under `.dev-runtime/`, with SHA-256 hashes in
`evidence/RETAINED_OUTPUTS_SHA256.txt`.

## What was checked, and what was found

**ComparisonStrip and status chips around 1024.** Baseline Chrome 1024 light/dark had two overlapping chip pairs each
(`screenshots/before-strip-1024-chrome-light.jpg`). At 1280 the chips spilled into the column gap
(`before-strip-1280-chrome-light.jpg`). After `e759bd6` there are 0 overlaps in all 400 cells (pre-commit and clean
clone). Seals, integrity tags and comparison chips have no clipped text in any cell.

**Horizontal overflow and tables.** No page scrolls horizontally in any cell. Every table wider than its column is a
named, focusable region that scrolls by keyboard:

- the evidence ledgers at 375 and 768 (already the case)
- the History ledger at 768/1024 (fixed in `a30e4f3`): clean clone, both engines and themes, the region reaches
  `scrollLeft = maxScroll` (226/182) with `:focus-visible`; `screenshots/after-history-*-keyboard-scrolled.jpg`

The Verifications case table at 1024 overflows by 9px of padding only; the only text past its edge is `sr-only`.

**Typography (Evidence Atelier).** Computed type across all cells:

| Use | Family | Sizes |
| --- | --- | --- |
| Body, table text, navigation | Instrument Sans | 12–15px (most 13–13.5px) |
| Headings, metrics | Instrument Serif | 21–30px |
| Evidence metadata, IDs, kickers, status words | IBM Plex Mono | 10.5–11px (10px for the capture/admission labels), up to 14px |

Body text, tables, navigation and status indicators were legible in the inspected screenshots in both themes, and axe
contrast passes in every cell. The warm charcoal / paper surfaces, editorial serif hierarchy, restrained coral accent
and mono evidence metadata are unchanged; no token was changed. Two confirmed readability defects were fixed:

- Workspace register at 1024–1279: mono values split mid-token (`INTEGRITY_|VERIFIED`, `research_o|nly`); before
  `screenshots/before-register-1024-dark.jpg`, after `after-register-strip-1024-chrome-dark.jpg`
- AccessNotice facts at 375: `redacte|d,` (`before-`/`after-states-375-chrome-light.jpg`)

Soft wraps at a hyphen or truncation ellipsis (for example the fixture slugs and short digests in the 1024 case table)
are listed per cell but are not defects: every character stays visible and in order.

**Focus visibility and keyboard.** All Overview Tab stops in every cell have a visible indicator. WebKit uses Option+Tab
for links, as Safari does. The History region shows the focus ring. The history e2e test now also proves the region is
reached with Shift+Tab, scrolled with ArrowRight and End, and absent at 1440. Existing entry-to-entry arrow keys are
unchanged.

**Responsive navigation.** At 375/768 the shell uses the drawer (accepted; covered by `e2e-static` "mobile drawer"
axe and `responsive.spec.ts`, 22/22 passed). At ≥1024 the sidebar is shown. No cell overflowed.

**Service unavailable and integrity states.** The SERVICE_UNAVAILABLE, INTEGRITY_FAILED and INTEGRITY_UNVERIFIABLE
cells pass at every width, theme and engine. Their notices and facts stay fully visible, and no verdict is shown for
them (asserted by the e2e-history/e2e-local suites).

**Headings.** Exactly one visible H1 in every cell, including `#/states` (FIX03 R-N3 does not reproduce).

**Network.** No request outside 127.0.0.1:5183 in any cell.

## Screenshots committed (`evidence/session2/screenshots/`, recompressed for the repository)

| Before | After |
| --- | --- |
| `before-strip-1024-chrome-light.jpg` (chips overlap) | `after-overview-1024-webkit-light.jpg`, `after-register-strip-1024-chrome-dark.jpg` |
| `before-strip-1280-chrome-light.jpg` (chips spill into gap) | — |
| `before-register-1024-dark.jpg` (register splits) | `after-register-strip-1024-chrome-dark.jpg` |
| `before-states-375-chrome-light.jpg` (`redacte|d,`) | `after-states-375-chrome-light.jpg` |
| — | `after-history-768-webkit-light-keyboard-scrolled.jpg`, `after-history-1024-webkit-dark-keyboard-scrolled.jpg` |

Additional after views: `after-webkit-dark-375-overview`, `after-webkit-light-375-detail`,
`after-chrome-dark-1440-verifications`, `after-webkit-dark-1024-verifications`, `after-webkit-light-1280-rules`,
`after-chrome-dark-768-unavailable`, `after-webkit-light-1024-ui-corrupt`, `after-chrome-light-1440-archived-detail`.
These come from the pre-commit run; the clean-clone run's 208 originals are hashed.

## Limits

These are resized desktop browser viewports, not physical devices. Firefox and screen readers were not run. The
matrix proves the checked properties for today's synthetic data and content. It is not a proof for all possible future
content (REMAINING_LIMITATIONS.md).
