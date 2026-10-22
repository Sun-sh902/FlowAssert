# v1.0 Production Rebuild — Direction C "Evidence Atelier"

Date: 2026-10-16. This executes `docs/design-lab/PRODUCTION_REBUILD_PLAN.md` after Direction C was
approved.

| | |
| --- | --- |
| Rollback point | git `main` @ `80eca02`, tag **`v0.2-rollback`** (v0.2 UI, docs, design lab) |
| Scope | Presentation only: tokens, fonts, shell, Overview, Verifications, Verification detail, unavailable notice |
| Unchanged | `src/research`, `src/mocks`, `src/adapters`, `src/domain`, `src/data`, router, theme hook. The only additions are the v0.2 derived `recordsNotFullyAssessed` and the mapping-doc line for it |
| Screens | `docs/screenshots/v1-atelier/` (12 captures, light and dark, 375 / 768 / 1440) |

## What changed

- **Tokens.**
  - Paper theme and a separately composed **night ledger** dark theme.
  - New `--fa-rule` (ledger ink rule) and `--fa-hatch` / `--fa-hatch-soft`.
  - Status palette re-validated; light ink-3 darkened to pass 4.5:1 on paper.
- **Fonts.** Instrument Serif, Instrument Sans and IBM Plex Mono (all OFL), applied by rule:
  conclusions in serif, interface in sans, evidence in mono. JetBrains Mono was uninstalled. Inter and
  Newsreader remain only for the design-lab brand board.
- **Shell.**
  - Numbered index rail (01 Overview / 02 Verifications).
  - Trace wordmark, plus a heavier 16px mark and favicon.
  - Dashed, non-interactive "Not in this preview" items.
  - Demo-register stamp.
  - Top bar with breadcrumbs, the fixed clock and "What's real?".
- **Overview.**
  - Serif verdict built from cohort counts, beside a record ledger.
  - **Traces**: source node → one square per record → HubSpot, with the cohort seal.
  - **Exhibits** grouped by action (investigate, restore evidence, wait).
  - **Daily register** strips with tooltips and a table view.
  - State key.
- **Verifications.** Serif header, then a ledger table: cohort result as a seal, record results as
  glyph counts plus a strip with an open tail when the total is unknown, then evaluated times.
  Filters, search and URL sync are unchanged.
- **Verification detail.**
  - Serif verdict and ruled case facts.
  - **Procession**: Source → Observation → Comparison → Evidence → Verdict, with all text derived from
    the run.
  - Record index (clickable cells + search + filters + ↑/↓ list).
  - **Comparison sheet** on the operator spine (= / ≠ / ?), with character-level diff marks.
  - "What the evidence supports" and the hatched "What remains unknown".
  - Proportional evidence-in-time axis.
  - Next step and technical metadata.
- **Scaling.** `RecordCells` switches to an aggregate strip above 120 records per run. No demo run
  reaches that, so the mode is code-only and has not been rendered.
- **Removed.** `RecordInspector`, `StateBar` and `TrendChart` were replaced by `ComparisonSheet`,
  `RecordCells` and `DailyRegister`.

## Verification

| Check | Result |
| --- | --- |
| `npx tsc -b` | 0 errors |
| `npm run build` | Success (app and design lab) |
| `oxlint src` | No output |
| Startup fixture check | "Demo fixtures consistent: 16 runs checked" |
| Horizontal overflow | None at 375 and 768 (Overview, Detail, Verifications); runs table fits its panel at 768 (735 ≤ 736) |
| Cohort filter (Mismatch) | 4 rows, chip pressed |
| Search | URL-synced, focus kept, empty state shown |
| Detail ↑/↓ | Selection and focus move together (1038 → 1052 → 1061) |
| Detail cell click | Selects the record (LEAD-1067) |
| Disclosure | `aria-expanded=true` |
| Theme | Paper / Night ledger / System applied and persisted |
| Mobile drawer | Opens; Esc closes it and returns focus |
| Research repository | HEAD, status, diff and full-tree hashes match the original snapshot |

Defects found while reviewing the renders, and fixed:

| Defect | Fix |
| --- | --- |
| Stale CSS after a save-order race | Dev server restarted |
| Rail version label wrapped | Shortened |
| Sheet header columns shifted (an `sr-only` grid item) | Replaced with a placeholder cell |
| Record list grew unbounded on tall windows | Height capped at 760px |
| Runs table 15px wider than its panel at 768 | Column minimum reduced |

## Semantics checklist (all pages)

- [x] Four states with distinct shapes (disc, diamond, quarter ring, hatched dashed ring) and labels.
- [x] Cohort results (seal) are separate from record results (cells / strips / counts).
- [x] An unknown expected total is drawn as an open tail and stated in words. VR-2023 shows all 12
      Verified records with the cohort Unverified, plus an explicit note.
- [x] "Not fully assessed" appears in the case facts, procession, unknowns panel and exhibits.
- [x] "Consistent is not authenticated" appears on every case.
- [x] The evaluator's "Not assessed / Not inferred" statements are shown verbatim.
- [x] The email rule is labelled "proposed rule".
- [x] Demo identification: rail stamp, fixed clock, and "What's real?".
- [x] No confidence scores and no live-API claims.

## Known limitations

- The aggregate-strip mode for runs over 120 records has not been exercised with real data.
- Instrument Serif is condensed. It is used only at 20px or larger; there is no automated legibility
  test.
- No automated accessibility audit, screen-reader, Safari or Firefox pass.
- Light Pending and Unverified marks rely on form plus label, not colour contrast alone. This is by
  design and documented.
- Headless captures use the browser's `preferredColorScheme`. The in-app toggle was verified
  separately.
