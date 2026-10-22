# Visual Review — First Iteration

Reviewed 2026-10-16 in the Claude desktop app's built-in browser against the local Vite dev server
(`http://localhost:5183`). Screenshots are in `docs/screenshots/` (desktop captures are downscaled by
the browser pane to 800px wide).

## Viewports and themes inspected

| Viewport | Theme | Pages |
| --- | --- | --- |
| 1440 × 900 | Light | Overview; detail VR-2025 (Mismatch), VR-2023 (population unknown), VR-2026 (Pending) |
| 1440 × 900 | Dark (via system preference) | Overview; detail VR-2022 (access denied) |
| 1280 × 860 | Light | Verifications with filter, search and empty state |
| 375 × 812 | Light | Overview, detail, record selection, navigation drawer |

Horizontal overflow was measured with `document.documentElement.scrollWidth` at 375px on Overview and
Detail: 375 = viewport width, no overflow.

## Interactions verified in the rendered app

- Hash navigation between Overview, Verifications, detail, preview pages; scroll resets to top.
- Theme: Light / Dark / System radio buttons apply `data-theme` and persist to `localStorage`.
- Verifications: state filter chips (counts 9/4/1/2 of 16), search (URL-synced, focus kept), empty
  state with "Clear filters".
- Detail: record filter chips, search, selection via click (scrolls inspector into view on mobile)
  and ↑/↓ keys (focus follows selection), disclosures for reason strings and technical metadata.
- Mobile drawer: opens, Esc closes, focus returns to the menu button.
- Fixture consistency check passes at startup ("16 runs checked").

## Defects found and fixed during review

| Defect | Fix |
| --- | --- |
| Recent-runs table cramped in the 7-column slot: run IDs wrapped, "total unknown" broke | `compact` table mode, `whitespace-nowrap` IDs, single-line count label |
| Attention detail read "2 phone differs" | Changed to "Phone differs (2) · …" |
| Focus ring drawn across the top of `<main>` after navigation | Suppressed ring on the programmatically focused landmark |
| Evidence-card status labels wrapped beside titles at 3 columns | Status moved under the title |
| "Not required by this policy" wrapped in narrow column | Widened value column |
| Source-vs-HubSpot table collided at 375px | Stacked layout below `sm` |
| Demo banner took four lines on mobile | Short copy below `sm` |
| ↑/↓ changed selection but focus stayed on the previous row | Focus moved in an effect after render |

`desktop-overview-top.jpg` was captured before the phrasing fix; the other screenshots reflect the
fixed state of each area they show.

## Not verified

- No automated accessibility audit (axe/Lighthouse) was run; checks above are manual.
- Real screen-reader behaviour was not tested.
- Tablet (768px) was not screenshotted; layout breakpoints were exercised at 375, 1280 and 1440.
- Safari and Firefox were not tested (Chromium-based pane only).
