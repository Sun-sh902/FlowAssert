# Production Rebuild Plan — Direction C · Evidence Atelier

Approved: Direction C (2026-10-16). This is a **plan only**: nothing in the production app has changed.
Scope stays at the first-iteration surface: shell, Overview, Verifications, Verification Detail and
the unavailable-section notice. No new features, APIs or semantics.

## 1. What stays exactly as it is

| Layer | Files | Rule |
| --- | --- | --- |
| Research mirror and state precedence | `src/research/*` | Untouched |
| Demo fixtures and the startup consistency check | `src/mocks/*` | Untouched; the check must still pass ("16 runs checked") |
| Adapter and view models | `src/adapters/*`, `src/domain/view.ts` | Unchanged. New display needs are derived inside components or as additive view fields, documented in the mapping doc |
| Store, router, theme hook | `src/data/store.ts`, `src/lib/router.ts`, `src/lib/theme.ts` | Unchanged. Routes, query params (`state`, `q`, `record`) and keyboard behaviour stay the same |
| Research repository | — | Read-only; integrity is re-checked at the end |

The rebuild only replaces **presentation**: tokens, CSS, components and pages.

## 2. Design decisions to settle while building

These are the known weaknesses of C, with how I propose to resolve each.

1. **Record squares don't scale.**
   - Draw one square per record up to 120 records per run (today's largest is 64).
   - Above that, switch to an **aggregate strip**: proportional state segments plus a "show records"
     toggle, using the same visual language.
   - Demo data never triggers this mode, so I'll exercise it with a dev-only story rather than by
     changing fixtures.
2. **Dark theme.** Compose a separate "night ledger" theme rather than an inversion:
   - warm graphite paper `#16140f` → sheet `#1d1a15`
   - bone ink `#ece6d8`
   - indigo lifted to `#9aa2ff`
   - status inks re-tuned for contrast, and the hatch redrawn in bone at lower opacity
   - validate the status palette in both themes with the dataviz validator (green and red never
     adjacent)
3. **Vertical cost of the serif hero.**
   - Overview hero: 40px, with a two-tone single statement capped at two lines.
   - Detail verdict: 44px.
   - The facts ledger moves beside the verdict so the fold still shows the five-step procession.
4. **Overused mono small caps.** Keep mono kickers for evidence metadata only (IDs, times,
   namespaces). Section labels go back to sentence-case Instrument Sans. Target about a third fewer
   kickers.
5. **Mark at 16px.** Thicken strokes and simplify the C trace mark for a 16px variant (favicon and
   collapsed rail). Keep the 24px+ master.
6. **Accessibility.**
   - The hatch counts as a non-colour cue, but every state still keeps its glyph and label.
   - Light pending ochre `#9c6b0c` must pass 4.5:1 as text on the sheet colour; re-tune it if not.
   - Clickable record squares get a 24px hit area (visual 18px) and keyboard arrow navigation, as the
     current list has.

## 3. Token migration

Replace `src/styles/tokens.css` semantics with the C system while keeping the **token names that
components already use**, so the main pass is a remap rather than a rewrite.

| Existing token | C value (light) | Notes |
| --- | --- | --- |
| `--fa-canvas` / `--fa-surface` / `--fa-surface-sunken` | paper `#f3efe6` / sheet `#fbf9f4` / `#ebe5d8` | |
| `--fa-ink` … `--fa-ink-4` | `#1d1b16` … `#aaa392` | |
| `--fa-border` / `--fa-border-subtle` / `--fa-border-strong` | `#d8d0bf` / `#e5dfd1` / ink (ledger rules) | |
| `--fa-brand` | indigo ink `#2f3590` | |
| Status marks | `#2d6a46` / `#b8391c` / `#9c6b0c` / graphite `#57534a` | |
| New: `--fa-hatch`, `--fa-hatch-soft` | diagonal hatch | Unverified, unknown regions |

Typography:
- `--font-display`: Instrument Serif (verdicts only)
- `--font-sans`: Instrument Sans
- `--font-mono`: IBM Plex Mono (evidence values)
- Inter, Newsreader and JetBrains Mono are removed from the app bundle once nothing references them.

## 4. Component work

| Component | Change |
| --- | --- |
| `AppShell` | Numbered index rail; trace wordmark; dashed "not in this preview" items; demo stamp; slim top bar with crumbs and fixed clock. Mobile drawer and focus handling as today |
| `status.tsx` | Glyphs redrawn in C geometry (hatched Unverified). New `Seal` for cohort verdicts. `StatusBadge` kept for dense tables |
| New `RecordCells` | Square-per-record with an unknown-total tail; aggregate mode above the threshold |
| New `Trace` | Source node → cells → HubSpot node, with meta line and seal |
| `StateBar`, `TrendChart` | Restyled as the C "daily register" strips. The chart keeps its tooltip and "view as table" |
| `RunsTable` | Ledger styling. Columns: Cohort result as a seal-lite, Record results as mini cells or strip |
| New `Procession` | The five steps from source to verdict. Text is derived from `RunView` (premises, technical entries); nothing is invented |
| `RecordInspector` → `ComparisonSheet` | Operator spine (= / ≠ / ?), rule notes, diff marks. Mobile stacks with the operator between values |
| `EvidenceSupport` / `NotEstablished` | "What the evidence supports" ledger and hatched "What remains unknown" panel |
| Timeline | Proportional evidence-in-time axis with lettered markers; a list fallback on mobile |
| `Preview` | Compact notice restyled |

## 5. Pages

1. **Overview:** hero verdict and record ledger → Traces → Requires attention (exhibits) and the
   daily register → state key. Cohort counts stay visibly separate from record counts.
2. **Verifications:** a ledger-style runs table with the existing filters, search, URL sync and empty
   state.
3. **Verification Detail:** verdict and facts → procession → record index and comparison sheet →
   supports / unknown → evidence in time → collapsible technical metadata (kept from today).
4. **Unavailable sections:** the compact notice; navigation entries stay non-interactive.

## 6. Responsive targets

| Width | Treatment |
| --- | --- |
| 1440 / 1280 | Full composition |
| 768 | The rail collapses to the drawer. Trace rows stack (name above, trace below). The procession becomes a 2-column grid |
| 375 | Traces show cells wrapped below the name. The comparison sheet stacks. The procession becomes a vertical list. The time axis becomes a list. No horizontal overflow |

## 7. Sequence and gates

| Phase | Work | Gate before moving on |
| --- | --- | --- |
| 1 | Tokens, fonts, dark "night ledger" theme, palette validation | Validator results recorded; both themes render on the current pages |
| 2 | Shell and status primitives (glyphs, seal, cells, 16px mark) | Navigation, drawer, theme switch and focus work at 375–1440 |
| 3 | Overview | Rendered review in both themes at all four widths |
| 4 | Verifications | Filter, search, URL and empty-state regression |
| 5 | Verification Detail | Selection by click and ↑/↓, disclosures, and the semantics checklist below |
| 6 | Clean-up | Remove unused fonts and styles. Update the design-system, refinement and mapping docs |
| 7 | Final review | Before/after screenshots, `tsc -b`, `npm run build`, fixture check, research-repo integrity |

**Semantics checklist, run per page:**
- The four states use distinct shapes.
- Cohort results are visually separate from record results.
- An unknown total is drawn as an open tail and stated in words.
- "Not fully assessed" is visible.
- "Consistent ≠ authenticated" is visible.
- The evaluator's disclaimers appear verbatim.
- The email rule is labelled proposed.
- The demo is identified.
- No confidence scores and no live-API claims.

## 8. Preservation

- I'll keep the current v0.2 UI available for comparison by **tagging a copy of the current source**
  under `docs/screenshots/before-c/` (screenshots) and leaving `lab.html` in place.
- Nothing is committed or pushed unless you ask. The workspace is not a git repository; if you want a
  rollback point, I can `git init` and commit the v0.2 state first. That's your call.

## 9. Effort and risk

- Roughly the size of the first iteration: about 15–20 component files touched, with no data-layer
  changes.
- **Main risks:**
  - the dark theme's character (it may need one review round)
  - the serif's legibility at small sizes (it is restricted to ≥ 20px)
  - long detail pages on mobile

## Open choices for you

1. Should I create a rollback point first (`git init` and commit the v0.2 state)? **Recommended: yes.**
2. Dark theme: should the night ledger ship now, or should production be light-only for this pass?
   **Recommended: ship it now**; both themes exist today, and dropping one would be a regression.
