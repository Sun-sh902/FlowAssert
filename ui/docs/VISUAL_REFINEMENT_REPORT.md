# Visual Refinement Report — UI v0.2

Date 2026-10-16. Scope: visual refinement only. No new features, and no changes to verdict semantics,
aggregation, fixtures or the research-to-frontend mapping. Before: `docs/screenshots/before/`
(19 files). After: `docs/screenshots/after/` (20 files).

## A. Design weaknesses identified

| # | Weakness | Root cause |
| --- | --- | --- |
| 1 | Weak identity | Generic logo; brand colour used only on focus rings |
| 2 | Repetitive rectangles (dark) | Every block was a bordered card on a near-identical background; dark panels were barely lighter than the canvas |
| 3 | Metrics read as a data grid | Boxed cells, "1 cohort" mixed into record metrics |
| 4 | Monotonous table rhythm | Uppercase eyebrow headers, two-line rows everywhere, colour-only bars |
| 5 | Bars could be read as cohort results | A fully green bar beside an Unverified badge, with no label saying which was which |
| 6 | Connections placeholder felt unfinished | Large centred empty page linked from navigation |
| 7 | Repeated demo notices | Banner, sidebar card, "Demo" tag and demo-clock line all said the same thing |
| 8 | Weak type hierarchy | 36px serif page titles competed with data; all-caps labels everywhere |
| 9 | Surface and interaction polish | Same border on every surface; hover states inconsistent; ⊢-style details missing |

## B. Visual changes made

**Identity.** New mark: the logical turnstile ⊢ ("asserts"). The vertical stroke is the evidence
boundary and the cobalt stroke is the assertion that follows from it. The same mark leads the
"Primary reason" on the detail page. The comparison table uses assertion operators
(**=**, **≠**, **?**) between source and HubSpot values. A source → destination trace chip
(`intake-sheet/web-form ─▶ HubSpot contacts`) heads each detail page.

**Typography rule.** Serif is reserved for *conclusions* (the Overview verdict sentence and the detail
verdict). Page titles are now Inter 600 at 24px. Data is in sans with tabular numerals; evidence and
identifiers are in mono. Section and column labels are sentence case (`.label`). All-caps is no longer
used for labels.

**Overview.**
- Page identity ("Overview") is separated from the dynamic verdict, which now sits inside the summary
  panel at 24px rather than 36px.
- Metrics are a hairline-separated row inside the same panel rather than boxed cells, with 26px
  tabular numerals.
- Record results and cohort results are split explicitly. A "Cohort results" strip carries the note
  "A cohort can be Unverified even when all its records are Verified."
- Needs attention is grouped as **Confirmed mismatch**, **Insufficient evidence** and **Pending**,
  each with an action hint. Mismatch rows show issue chips (glyph + label + count).
- The Workflows panel has a legend ("Badge = cohort result · bar = record results"), glyph counts on
  every bar, and an "Earlier cohorts" trail.
- When the expected total is unknown, the bar ends in a **dashed open cap** and reads "12 · total
  unknown". A green bar therefore never looks complete for an Unverified cohort.

**Verifications.**
- Sentence-case headers.
- Columns renamed "Cohort result" and "Record results".
- 52px rows with a mono run ID, and the source namespace in mono under the workflow name.
- Glyph counts above each bar, so bars are never colour-only.
- A chevron appears on row hover, with an inset focus ring.
- Absolute timestamps appear from `lg` up; the table sits in a scroll-safe wrapper.
- On mobile, each run is a card.

**Verification detail.**
- A 3px status rail replaces the thick top bar, and the verdict is 24/30px serif.
- A **Primary reason** line (⊢) is followed by secondary reasons.
- The next step is set inline in a tinted callout.
- The facts column sits on a sunken surface and adds **"Not fully assessed: N records"** (derived
  from rule statuses), so unresolved uncertainty is visible at a glance.
- Record rows are 40px with a brand selection rail.
- In the comparison, values diverge at highlighted characters with a ≠ operator chip. Emails wrap
  after "@" instead of mid-word.
- Evidence support became a ledger ("5 of 5 consistent") instead of six cards. "Consistent is not
  authenticated" stays as a dashed footer.
- "What this run does not establish" uses compact rows.

**Shell.**
- Sidebar: brand, a dashed "Demo workspace · Synthetic data" chip, the primary nav, and a "Not in
  this preview" group whose items are disabled (lock icon, `aria-disabled`).
- Footer: version and theme switch.
- The research card was removed.
- The demo banner is one slim line that includes the frozen clock.
- Touch targets are 40px on mobile.

**Connections (Option A).** Connections is visibly unavailable in navigation and is no longer a link.
A direct URL shows only a compact "Connections is not available" notice with a one-line conceptual
note.

## C. Design-token changes (`src/styles/tokens.css`, `src/styles/index.css`)

- Added primitive scales (`--graphite-0…950`, `--cobalt-50…700`). Semantic tokens now reference them.
- Light theme: canvas `#f5f6f8`, hairline borders `graphite-150`, new `--fa-border-subtle` for inner
  dividers, translucent `--fa-hover` / `--fa-active`.
- Dark theme, composed separately rather than inverted:
  - elevation by luminance (canvas `#0b0c0f` < surface `#121418` < raised `#181b20`)
  - translucent white borders
  - a 1px top highlight (`--fa-highlight`) instead of shadows
  - translucent status tints
- New tokens: `--fa-nav-active`, `--fa-ring-inset`, `--fa-highlight`, motion
  (`--fa-dur-fast` 110ms, `--fa-dur` 180ms, `--fa-ease`).
- Type scale retuned: 11/12/13/14/16/18/24/30, plus `--text-metric` at 26px.
- New utilities: `.label`, `.metric`, `.surface`, `.mono-id`. `.display` now uses `text-wrap: balance`.
- Status hues are unchanged: the validated palette and its glyph pairing are kept.

## D. Component changes

| Component | Change |
| --- | --- |
| `Logo` | ⊢ turnstile mark; favicon updated |
| `AssertMark` (new) | SVG ⊢ for in-text use; renders identically in every font |
| `CountGlyphs` (new) | Non-zero state counts as glyph + number |
| `RecordResults` (new, exported from RunsTable) | Glyph counts + bar + total / "total unknown" |
| `StateBar` | `unknownTotal` dashed open cap |
| `Panel`, `FilterChips`, `SearchField`, buttons, `Fact`, `Tag` | `.surface`, subtle dividers, sentence-case labels, calmer active chip, sunken search well, motion tokens |
| `StatusBadge` | 22px height, tighter tracking |
| `RunsTable` | Column semantics, row rhythm, hover chevron, inset focus, responsive time column |
| `RecordInspector` / `DiffValue` | `Operator` (=/≠/?) column, mobile stacked operator, "@" wrap points |
| `AppShell` | Sidebar restructure, disabled unavailable items, single demo notice |
| `Preview` | Compact unavailable notice |
| Adapter | Derived `recordsNotFullyAssessed`; two shorter field-note strings. No semantic change |

## E. Screenshots

| View | Before | After |
| --- | --- | --- |
| Overview dark 1440 | `before/dark-overview-1440.jpg` | `after/dark-overview-1440.jpg` |
| Overview light | `before/desktop-overview-top.jpg` | `after/light-overview-1440.jpg`, `after/light-overview-1280.jpg` |
| Verifications | `before/dark-verifications-1440.jpg` | `after/light-verifications-1440.jpg`, `after/dark-verifications-768.jpg` |
| Detail | `before/light-detail-1440.jpg` | `after/light-detail-mismatch-1440.jpg`, `after/dark-detail-*.jpg` |
| Connections | `before/dark-connections-1440.jpg` | `after/dark-connections-notice-1440.jpg` |
| Mobile | `before/mobile-*.jpg` | `after/*-375.*`, `after/dark-drawer-375.jpg` |

Two after-shots predate tiny follow-up fixes:
- `light-overview-375.jpg` still shows the label "Records evaluated" (now "Records").
- `light-workflows-375.jpg` shows the narrower 20px unknown-total cap (now 32px).

## F. Interaction regression results (rendered app)

| Interaction | Result |
| --- | --- |
| Fixture consistency check at startup | Pass: "16 runs checked" |
| Cohort filter (Mismatch) via URL and chips | Pass: 4 rows; chip `aria-pressed` |
| Search, URL sync, focus retained | Pass: `q=webinar` → 1 row; focus stays in field |
| Empty state + Clear filters | Pass |
| Record ↑/↓ keyboard selection | Pass: selection and focus move together (LEAD-1038 → 1061) |
| Technical metadata disclosure | Pass: `aria-expanded=true` |
| Theme Light/Dark/System | Pass: `data-theme` applied, persisted |
| Mobile drawer: open, Esc, focus return | Pass |
| Unavailable nav items | Pass: 2 links, 3 `aria-disabled` items |
| Copy run ID, record click scroll-into-view | Unchanged code paths; not re-tested this round |

## G. Responsive review

Horizontal overflow, measured as `scrollWidth` against viewport width:

| Width | Result |
| --- | --- |
| 375 | Overview, Verifications, Detail: none |
| 768 | Overview, Verifications, Detail: none |
| 1280 / 1440 | Inspected visually |

Defects found and fixed during review:

| Defect | Fix |
| --- | --- |
| Verifications table clipped at 768 | Scroll wrapper; absolute time only from `lg` |
| Metric labels wrapped at 768 | Short labels; 5 columns from `md` |
| Compact Recent-runs names wrapped | Truncated with title |
| Record-list names truncated at 1280 | List width restored |
| Emails broke mid-word | Wrap at "@"; 54px mobile label column |
| ⊢ rendered as a fallback glyph | SVG mark |
| Sidebar footer wrapped | Shorter text |
| Mobile search field narrow | Panel actions fill width below `sm` |

## H. Light / dark review

Both themes were inspected on Overview, Verifications, Detail and Connections. Dark uses luminance
elevation and translucent borders; light uses white panels on a cool canvas with hairlines. Status
glyph shapes and labels are identical in both themes.

## I. Typecheck and build

`tsc -b`: 0 errors. `vite build`: success, JS 320.5 kB (96.9 kB gzip). `oxlint src`: no output.

## J. Remaining visual limitations

- Desktop captures are downscaled by the browser pane, so fine detail was checked at mobile 2× scale
  and through DOM measurement.
- No automated accessibility audit or screen-reader pass. Light pending mark contrast is still below
  3:1; it is mitigated by glyph, label and table view.
- At 768px the "Records" metric context wraps to two lines.
- On narrow panels, the Evidence-support count sits on its own line.
- Safari and Firefox were not tested.

## K. Research repository integrity

The HEAD, `git status`, `git diff` hash and full-tree file hash all match the snapshot taken before
the first UI iteration:
- branch `fix/round03-5-review-fixes`
- HEAD `4deddb3`
- the pre-existing dirty files are untouched

Nothing was written to the research repository.
