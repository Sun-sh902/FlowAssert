# FlowAssert — Art Direction Exploration

Status: **concepts for review — awaiting your selection.** Nothing here replaces the production UI.

| | |
| --- | --- |
| Lab entry | `lab.html` (isolated Vite page; own CSS and fonts, lazy-loaded per direction) |
| Preview routes (dev server) | `http://localhost:5183/lab.html#/a/overview`, `#/a/detail`, `#/c/overview`, `#/c/detail`, `#/brand` |
| Production app | `http://localhost:5183/#/` — unchanged (v0.2) |
| Screens | `docs/design-lab/screens/` — 1440×900 first views + full-page 1440-wide captures (headless Chrome, 1× scale) |
| Data | Production view models via `src/lab/data.ts` — same demo runs, same semantics |

## A. Visual reference research

Inspected live in the browser on 2026-10-16. Mobbin returned **403 Forbidden**; it was not
inspected. SaaSFrame, Refero and Awwwards were not visited, so no claims are made about them.

| Reference | What I actually saw | Principle worth learning |
| --- | --- | --- |
| Linear (linear.app) | Near-black canvas; panels separated by luminance, not borders. Headline set in two tones (white lead, grey continuation). Mono "FIG 0.1"-style figure labels. Product UI framed under a soft top light. | Hierarchy by **light**, not lines. A two-tone sentence can carry the lead and its qualification in one line. |
| Stripe (stripe.com) | Visible vertical column guides framing content. A live-looking mono figure ("1.73326387%") inside editorial copy. Two-tone headline again. Restrained use of one big gradient. | Show the **grid as a material**. Precise numerals in mono read as measured fact. |
| Attio (attio.com) | Crisp light product shell on white. Faint vertical hairline texture and a lilac atmospheric wash behind the app frame. Very quiet chrome. | Light themes get depth from **atmosphere and texture**, not shadows. Keep the chrome silent. |
| Mercury (mercury.com) | Wide-tracked uppercase wordmark. Calm, photographic atmosphere. Minimal UI chrome on the marketing surface. | A **wordmark-led** identity with generous tracking reads as trustworthy and financial. |
| Raycast (raycast.com) | Dark page; the hero type fades in on load. Rounded floating nav capsule. Very little colour. | Motion and contrast **reveal** content rather than decorate it. |

These are marketing surfaces of each product, not their logged-in apps. I treated them as
evidence of typographic and material principles, not as layouts to copy.

## B. Three art directions

### A — Precision Instrument (prototyped)

1. **Concept:** FlowAssert as a measuring instrument. Every workflow is a channel; every record is a
   pulse on a calibrated scale; cohort results are indicator lamps.
2. **Personality:** exact, quiet, engineered; serious without being militaristic.
3. **Colour:** optical-glass blacks (`#05070a` → `#131924`); light only where there is signal. Ion
   blue `#8ab4ff` is the brand and focus colour and never marks a state. Mint / coral / amber are the
   lit status colours. **Unverified is an unlit, dotted lamp.**
4. **Type:** Inter Tight for the interface; **Martian Mono** (wide, engineered) for every number,
   identifier and scale label.
5. **Mark:** *Calibration bracket*: two measuring corners frame a reading line.
6. **Surface:** glass panels with a 1px top highlight, graticule grids on measuring surfaces, and
   glow reserved for failures.
7. **Layout:** 76px icon rail, readout band, full-width channel bank, log + history.
8. **Navigation:** labelled icon rail. Unavailable sections are dimmed and not interactive.
9. **Data viz:**
   - all channels share one 0–50 record scale
   - per-record pulses; pending pulses are half-height and unverified pulses are dashed
   - a proportional evidence-window "scope" on the detail page
   - an exceptions × rules test matrix
10. **Signature elements:**
    - channel pulses
    - annunciator tiles
    - Δ probe squares between source and HubSpot values
    - glowing red evidence rail on the verdict

### B — Editorial Intelligence (specimen only, on the brand board)

1. **Concept:** the daily verification report as a well-edited front page. Findings lead, evidence
   follows.
2. **Personality:** articulate, confident, calm.
3. **Colour:** newsprint `#f6f4ef`, carbon ink, persimmon brand `#c2410c`.
4. **Type:** Newsreader Display for ledes and large old-style figures; Inter for everything
   actionable.
5. **Mark:** *Ruled A*: the crossbar runs out of the letter as a ruled line.
6. **Surface:** paper with no cards; columns and rules only.
7. **Layout:** asymmetric 8/4 columns with a big lede and marginal notes.
8. **Navigation:** a top masthead.
9. **Data viz:** small multiples and inline sparklines inside sentences.
10. **Signature:** the lede sentence and old-style hero numerals.

**Why it wasn't prototyped:**
- Its strongest ideas (a serif lede and ruled columns) overlap with C.
- Its persimmon brand colour sits too close to Mismatch red.
- It risks becoming a marketing page rather than a daily tool.

### C — Evidence Atelier (prototyped)

1. **Concept:** an investigation workspace. Each workflow is drawn as a **trace from source to
   HubSpot**, with every record shown as a square on it. The detail page is a case file that walks
   Source → Observation → Comparison → Evidence → Verdict.
2. **Personality:** forensic, intelligent, humane; a lab notebook rather than a dashboard.
3. **Colour:**
   - warm paper `#f3efe6` and sheet `#fbf9f4`, carbon ink, and an indigo-ink assertion accent `#2f3590`
   - the indigo is used for the brand mark, selection, and the source side of a diff
   - deep green, vermilion and ochre for states
   - **Unverified is a hatch, not a hue**, so "no conclusion" can never be mistaken for a colour-coded
     result
4. **Type:** **Instrument Serif** for verdicts only ("conclusions are set in the serif"), Instrument
   Sans for the interface, **IBM Plex Mono for every observed value** ("evidence always looks like
   evidence").
5. **Mark:** *Evidence trace*: an open source node and a solid destination node, crossed by the
   assertion tick.
6. **Surface:**
   - paper with a soft top light
   - ruled ledgers (1.5px ink rules top and bottom, like an accounting ledger)
   - sheets with a faint lift
   - ruled-box verdict seals
7. **Layout:**
   - a numbered index rail
   - an editorial hero verdict beside a record ledger
   - the trace register
   - exhibits (Roman numerals) and a daily register
8. **Navigation:** "01 Register / 02 Cases", and a "Not in this preview" group shown as dashes.
9. **Data viz:**
   - a square per record on each trace
   - a dashed open tail when the expected total is unknown
   - daily strips
   - a clickable record index
   - a proportional "evidence in time" axis with the sync window hatched
10. **Signature elements:**
    - the five-step source → verdict procession
    - the **operator spine** (=, ≠, ? on a vertical rule between source and HubSpot)
    - hatched "What remains unknown" panel
    - seals

## C–D. Rendered high-fidelity screens

| Direction | Overview | Verification detail |
| --- | --- | --- |
| A · Precision Instrument | `screens/A-overview-viewport-1440x900.png`, `A-overview-fullpage-1440.png` | `screens/A-detail-viewport-1440x900.png`, `A-detail-fullpage-1440.png` |
| C · Evidence Atelier | `screens/C-overview-viewport-1440x900.png`, `C-overview-fullpage-1440.png` | `screens/C-detail-viewport-1440x900.png`, `C-detail-fullpage-1440.png` |

The detail concepts are interactive: selecting any record pulse (A) or square (C) re-renders the
comparison for that record. I checked this with LEAD-1061 and LEAD-1067.

## E–F. Brand, type and colour

`screens/brand-board-fullpage-1440.png` (route `#/brand`) covers:
- all four marks at 48 / 24 / 16 px on light and dark
- type specimens for A, B and C
- palettes for all three directions

All fonts are SIL OFL 1.1, self-hosted via Fontsource; licences were checked with `npm view`.

## Semantics preserved in both concepts

- Same four states, each with a distinct shape and not colour alone.
- Cohort results (lamp or seal) are kept visually separate from record results (pulses or squares).
- An unknown expected total is drawn as a dashed open tail and labelled "expected ?".
- VR-2023 still reads "all 12 visible records passed" while the cohort stays Unverified.
- "Not fully assessed" records are surfaced.
- "Consistent ≠ authenticated" is stated.
- The evaluator's "Not assessed / Not inferred" statements appear verbatim.
- No confidence scores and no live-API claims.
- The email rule is labelled "proposed".

## I. Visual evaluation (design-review judgement, not measurement)

| Criterion (weight) | A · Precision Instrument | C · Evidence Atelier |
| --- | --- | --- |
| Visual originality (25%) | 6.5 — pulses and annunciators are distinctive, but dark-glass "instrument" is familiar territory | 8.5 — traces, operator spine and hatch-as-uncertainty are specific to FlowAssert |
| Typographic craft (20%) | 7 — Martian Mono readouts are striking; uppercase mono captions are overused and get noisy | 8.5 — the serif-for-verdicts / mono-for-evidence rule is clear and expressive; mono kickers are slightly overused |
| Composition (20%) | 7.5 — strong band + channel bank; the evidence-window panel is under-filled | 8 — confident hero and procession; the detail page is long (≈2060px) |
| Product clarity (15%) | 8 — a calibrated scale makes channels comparable; the test matrix is excellent | 8 — the procession answers "what / why / what's unknown" in order |
| Brand coherence (10%) | 7 — bracket mark relates loosely to pulses | 8.5 — mark, traces, spine and seals form one system |
| Detail execution (10%) | 7.5 — the time-scope labels crowd when events cluster | 7.5 — exhibit tags wrap; the 16px mark is busy |
| **Weighted** | **≈ 7.2** | **≈ 8.2** |

### Weaknesses to resolve before adoption

**A — Precision Instrument**
- The identity is dark-only; a light theme is undesigned.
- Glow can fatigue in all-day use.
- Martian Mono is wide and eats horizontal space.
- One pulse per record won't scale past roughly 200 records per run without aggregation.

**C — Evidence Atelier**
- One square per record needs an aggregate/zoom mode for large cohorts.
- The serif hero costs vertical space.
- Warm paper may read as "editorial" rather than "tool" to some users.
- A dark theme still has to be composed.
- Mono small-caps labels should be reduced by about a third.

## J. Recommendation

**Direction C — Evidence Atelier**, borrowing A's discipline of putting every channel on a shared,
calibrated scale.

C is the only direction where the product's purpose is visible without the logo:
- the source → HubSpot trace
- the = / ≠ / ? operator spine
- uncertainty drawn as hatching

Its rule that conclusions are serif, data sans and evidence mono is also a type system that the
whole product can follow.

**The decision is yours.** If you prefer A's density and dark-first character for daily operators,
the same semantic layer works unchanged.

## K–L. Preservation

- The production app (`index.html`, `src/` outside `src/lab/`) is unchanged by this exploration.
  Additions:
  - `lab.html` and `src/lab/**`
  - a second Rollup input in `vite.config.ts`
  - five OFL font packages
- `npx tsc -b` passes and `npm run build` emits both `index.html` and `lab.html`.
- The research repository matches the original snapshot: same HEAD `4deddb3`, `git status`, diff hash
  and full-tree hash.
