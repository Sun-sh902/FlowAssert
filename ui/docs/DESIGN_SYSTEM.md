# FlowAssert Design System — v1.0 "Evidence Atelier"

Approved direction C (2026-10-16). Tokens live in `src/styles/tokens.css`. Tailwind mapping and
utilities are in `src/styles/index.css`, and shared component classes are in
`src/styles/atelier.css`. Components never use raw hex values.

## Principles

1. **Show the evidence, not a dashboard.** Every workflow is drawn as a trace from source to HubSpot,
   with one square per record.
2. **Conclusions are serif, the interface is sans, evidence is mono.** Instrument Serif is used only
   for verdicts and section titles at 20px or larger. Instrument Sans is used for interface text. IBM
   Plex Mono is used for every observed value, identifier, time and namespace.
3. **Uncertainty is a hatch, not a hue.** Unverified and unknown regions are drawn as diagonal
   hatching over neutral graphite, so "no conclusion" can never read as a colour-coded result.
4. **Cohort and record results never share a mark.** Cohort results use the **seal** (a ruled box in
   mono caps). Record results use **cells**, **strips** or glyph counts.
5. **Ledger structure instead of card stacks.** Use 1.5px ink rules at the top and bottom, hairline
   rows between, and sheets with a faint lift.

## Themes

| | Paper (light) | Night ledger (dark) |
| --- | --- | --- |
| Canvas / sheet / sunken | `#f3efe6` / `#fbf9f4` / `#ece6d9` | `#14120e` / `#1c1915` / `#110f0c` |
| Ink 1–4 | `#1d1b16` `#4b473e` `#6d675a` `#a39c8b` | `#ece6d8` `#bdb5a4` `#8f8777` `#645e52` |
| Ledger rule | carbon `#1d1b16` | bone `#cfc7b5` |
| Brand (assertion indigo) | `#2f3590` | `#9aa2ff` |
| Verified / Mismatch / Pending | `#2d6a46` / `#b8391c` / `#9c6b0c` | `#4ba26f` / `#e2654a` / `#cf962b` |
| Unverified (neutral + hatch) | `#57534a` | `#8a8476` |

The dark theme is composed rather than inverted: sheets are lighter than the canvas, there is a 1px
top highlight, the indigo is lifted, and the hatch is redrawn in bone at lower opacity.

**Contrast (WCAG):**

| Pair | Ratio |
| --- | --- |
| Light ink-3 on paper (after tuning) | ≥ 4.5 |
| Light status inks on sheet | 5.8–7.7 |
| Dark status inks on sheet | 7.6–9.1 |

ink-4 is reserved for disabled or decorative use.

**Palette validator** (stacking order Verified → Pending → Unverified → Mismatch): graphite fails the
chroma floor **by design**, because the hatch is its code. Adjacent CVD pairs sit in the "legal only
with secondary encoding" band, and every pair also differs in form: solid, outlined, hatched or
diamond.

## Typography

| Role | Face | Size |
| --- | --- | --- |
| Page verdict | Instrument Serif | 34px mobile / 40px Overview / 44px Detail |
| Section title | Instrument Serif | 28px (`text-2xl`) |
| Sheet title | Instrument Serif | 22px |
| Body | Instrument Sans | 13.5–15px |
| Evidence values, IDs, times | IBM Plex Mono | 11–19px |
| Kicker | IBM Plex Mono caps, +8% tracking | 10.5px — evidence metadata only |
| Ledger numerals | Instrument Serif, tabular | 30px |

## Marks and glyphs

- **Logo: evidence trace.** An open source node and a solid destination node, crossed by the indigo
  assertion tick. Below 20px a heavier simplified geometry is used (the favicon and mobile bar).
- **State glyphs:**
  - Verified: solid disc
  - Mismatch: solid diamond
  - Pending: ring with a filled quarter
  - Unverified: hatched disc in a dashed ring
- **Operator** (`Operator`): drawn **=** holds, **≠** contradicted (filled), **?** not assessed
  (dashed and hatched). It sits on a vertical spine between the source and HubSpot columns.

## Components

| Component | File |
| --- | --- |
| `Seal`, `StatusGlyph`, `StatusBadge`, `Operator`, `RuleStatusIcon`, `CountGlyphs` | `components/ui/status.tsx` |
| `RecordCells` (one square per record; strip above 120 records; open tail when the total is unknown) | `components/records/RecordCells.tsx` |
| `Trace` | `components/runs/Trace.tsx` |
| `RunsTable`, `RecordResults` | `components/runs/RunsTable.tsx` |
| `DailyRegister` (strips, tooltip, table view) | `components/charts/DailyRegister.tsx` |
| `ComparisonSheet`, `DiffValue` | `components/detail/` |
| `Panel`, `FilterChips`, `SearchField`, `Disclosure`, `EmptyState`, `Tag` | `components/ui/primitives.tsx` |
| `AppShell`, `Logo` | `components/shell/AppShell.tsx` |
| `PageHead`, `SectionHead`, `DemoStamp`, `ProvenanceMark`, `OpenSeal`, `Segmented`, `Switch`, `PrefRow` (Phase 2) | `components/ui/atelier.tsx` |

Phase 2 marks (all neutral — none uses a state colour or the hatch, which stay reserved for results):

- **Demo stamp** — dashed register box in mono caps: preview-only content, nothing is sent.
- **Open seal** — dashed seal for "Not connected" / "Identified only". A connection status is never a verdict.
- **Provenance** — solid ink square = research-supported rule, indigo outline = proposed, dotted = demo draft.
- **Custody diagram** — the logo at page scale: open source node, dashed "under test" n8n box, solid HubSpot
  node, with the indigo comparison arc and assertion tick spanning source → destination, bypassing n8n.
- **Theme specimens** — `[data-theme]` on any element re-scopes the palette, so Settings renders real paper
  and night-ledger plates side by side.

## Motion

Motion is limited to a 180ms fade/rise on revealed content, 110ms colour transitions, and a 1px lift
on record cells on hover. Everything is disabled under `prefers-reduced-motion`.

## Accessibility conventions

- skip link and landmark navigation and main regions
- one `h1` per page
- visible indigo focus ring, inset on table rows and list items
- `aria-current` on navigation and the selected record
- `aria-pressed` on filters
- theme as a `radiogroup`
- the drawer is a dialog: Esc closes it and focus returns to the menu button
- the record list supports ↑/↓, and record cells are a mouse shortcut to the same list
- the chart has a table view
- unavailable sections are `aria-disabled` and are not links
