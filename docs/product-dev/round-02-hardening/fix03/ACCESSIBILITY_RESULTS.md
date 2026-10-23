# FIX03 — Accessibility results

Results come from the rendered DOM in jsdom (Vitest, Testing Library roles) and from the browser suites on `529db23`.
`e2e-static` covers axe light/dark on every page, keyboard, responsive and remediation; `e2e-history` covers axe and
overflow at 375–1440 px on the History pages. Both pass in Chrome and WebKit (REGRESSION_RESULTS.md).

| Check | Before (203f702) | After | Standard | Test |
| --- | --- | --- | --- | --- |
| H1 when the Service is unavailable — Overview `#/` | none: the page is one `AccessNotice` with an `h2` | the notice title "The local Service is unavailable" is the `h1` | WCAG 2.4.6 / 1.3.1 heading structure | F-05 #1 |
| H1 when the Service is unavailable — Verifications | `PageHead` H1 present | unchanged | — | NOT REPRODUCED |
| CaseExhibits result pairs | `dl` children `dt Live, dt Archived, dd, dd`: both terms describe both values | `dl > div(dt Live, dd) + div(dt Archived, dd)` (HTML-valid grouping), same two-column layout | HTML `dl` content model; WCAG 1.3.1 | F-05 #2 |
| Theme selector — rail | 3 `role=radio` buttons, all Tab stops, no arrow keys | one Tab stop (checked radio), arrows move selection and focus, wrapping | WAI-ARIA APG radio group | F-05 #3 |
| Theme selector — Settings specimens | same defect | same pattern | WAI-ARIA APG radio group | F-05 #4 |
| Segmented controls (Density, Motion, …) | already correct | logic moved, unchanged | — | `settings.test.tsx:36` (passing) |
| Data provider register | `role=radiogroup` with `role=radio` divs, one focusable, no click or key handler | `ul aria-label="Data provider"` with three `li`, `aria-current` on the active mode, no Tab stop | ARIA: do not expose an inoperable widget role | `settings.test.tsx` "Provider modes" |
| Integrity tag state for assistive technology | glyph `aria-hidden`; "record check · service" names no state | visually hidden "Integrity verified:" / "failed:" / "unverifiable:" before the label | WCAG 1.1.1 / 1.3.1 | F-01 #5 |
| Accessible state labels — verdict axis, comparison operators, history rows | `NoVerdictMark` text, `Operator` `role=img` labels "holds / is contradicted / not assessed", row `aria-label` | unchanged | — | existing `workspace.test.tsx:102`, `detail.test.tsx` |

## Effect on existing browser checks (verified on 529db23)

- `e2e/responsive.spec.ts` "touch targets at 375px" measures only focusable targets (`tabIndex !== -1`). With roving
  tabindex, the two unchecked rail theme buttons drop out of that measurement. Their size is unchanged; the report will
  list fewer targets.
- `e2e/remediation.spec.ts:76` focuses the checked rail theme radio, which is still `tabIndex 0`.
- `e2e-local/local-research.spec.ts:385` now finds the Data provider register by role `list` (passing).
- Regression found and fixed: the hidden state word first overflowed the History entry page at 375 px by 220 px
  (`4f13a13`, `e2e-history` FAIL). `.fa-itag` is now `position: relative` (`529db23`, PASS).
