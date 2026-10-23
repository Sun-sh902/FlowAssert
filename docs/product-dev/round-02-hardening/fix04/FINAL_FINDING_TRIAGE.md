# FIX04 final finding triage

Date: 2026-10-23 (America/New_York). Implementation-side triage; this is not independent acceptance.

Entry baseline: `e974c6dfc258c1fda6700db7a87c2a1331ed40ca` (FIX03 final), branch `product-dev/round-02-hardening`, clean at
entry to the first FIX04 session. Verified ancestry: `1d52026 → d34f882 → 203f702 → 4f13a13 → 529db23 → e974c6d`
(`git merge-base --is-ancestor`, logs in `evidence/session1/before/ancestor-*.log`).

FIX04 ran in two sessions. Session 1 committed `e759bd6` and then found a WebKit keyboard defect it had not fixed
(uncommitted work only). Session 2 re-verified everything session 1 claimed instead of trusting it, corrected
the pending fix, found one more readability defect, and produced the final candidate. Both sessions' attempts,
including failed probes, are kept (`evidence/session1/ATTEMPTS-session1.md`, `evidence/ATTEMPTS.md`).

Sources read: the FIX01, FIX02 and FIX03 independent `FINAL_REVIEW.md` and `REMAINING_RISKS.md` in
`/Users/zhangshenghe/Documents/FlowAssert-Product-Review/FIX0{1,2,3}/final-audit-01/`. Session 2 re-hashed all six
against `evidence/session1/before/review-source-hashes.json`: all unchanged.

## Classification

| # | Finding | Class | Evidence and action |
| --- | --- | --- | --- |
| 1 | Design lab ships in the normal production build | CONFIRMED → fixed in `e759bd6` | Baseline `vite.config.ts` listed `lab.html` as a Rollup input. Baseline output: 73 files, 1,800,693 bytes, including `lab.html`, the A/C prototypes, Brand chunks and lab-only fonts (Inter, Inter Tight, Martian Mono, Newsreader). Candidate output: 35 files, 1,079,138 bytes, `index.html` only. Lab sources are unchanged in Git and still served by the dev server. See PRODUCTION_BUILD_REPORT.md. |
| 2 | ComparisonStrip chips overlap at 1024px | CONFIRMED → fixed in `e759bd6` | Baseline Chrome light/dark at 1024: two overlapping chip pairs each (`evidence/session1/before/matrix-corrected-summary.json`, screenshot `evidence/session2/screenshots/before-strip-1024-chrome-light.jpg`). At 1280 the same 6-column grid made the chips spill out of their cells (≈9px of the 24px gap left; `before-strip-1280-chrome-light.jpg`). Removing `lg:grid-cols-6` keeps the existing 3-column layout. With the three always-shown states it is still one row at every width ≥640px. Pre-commit and clean-clone matrices: 0 chip overlaps in all 200 cells each. |
| 3 | `VerdictPair` duplicate renderer unused | CONFIRMED → removed in `e759bd6` | `rg -n VerdictPair ui/src ui/e2e*` finds nothing (exit 1). It had no import, caller, registry or barrel use. The used `LiveVerdict`/`ArchivedVerdict` are unchanged. |
| 4 | **History ledger: right-hand columns cannot be reached by keyboard in WebKit at 768–1279px** (found in session 1 after `e759bd6`) | CONFIRMED → fixed in the candidate | The wide ledger (`md:block`) is 226px wider than its column at 768 and 182px wider at 1024. The *Archived* time column, and at 768 part of the *Archive record* integrity tag, sit past the edge. Row links do not reveal them, and WebKit does not scroll an overflow container from a focused link. Pre-fix measurement (`e759bd6`, WebKit 768): `scrollLeft 0 / maxScroll 226`, last cell right edge 961 vs container 735 (`evidence/session1/table-scroll.log`). Session 2 pre-fix probe: tabIndex −1 and no role in both engines (`evidence/session2/overflow-probe-before.log`). Fix: the existing `EvidenceLedger` pattern, a named focusable region with arrow/Home/End scrolling, active **only while the ledger overflows**. |
| 4a | Session 1's pending fix for #4 made the region a Tab stop at every width | CONFIRMED (in uncommitted work) → corrected | Unconditional `tabIndex={0}` added a useless Tab stop at ≥1280, where nothing scrolls. That is inconsistent with `EvidenceLedger`, which adds the stop only while it scrolls (UIA-007 asserts this). Session 2 reuses `useScrollsHorizontally`. |
| 4b | Session 1's two post-fix WebKit probes disagreed (`regionScroll` 226 vs 0) | Explained (harness) | Session 2 reproduced the cause: Playwright's history web server rebuilds `dist`, so a probe that runs after a different build measures whatever was built last. Every session 2 browser measurement records the build it ran against. No product defect. |
| 5 | **Workspace register: mono identifiers split mid-token at 1024–1279px** (found in session 2) | CONFIRMED → fixed in the candidate | In the `lg` range the register is a 4/12 column. A fixed 110px label leaves each value ≈110px, so `break-words` cuts `INTEGRITY_VERIFIED`, `research_only`, `0.1.1-proposed` and similar values between ordinary characters (screenshot `evidence/session2/screenshots/before-register-1024-dark.jpg`). Fix: in the `lg` range only, each label sits above its value. Two columns return at `xl`. No token, font or colour change. |
| 6 | Verifications case table overflows by 9px at 1024 | NOT_REPRODUCED as a defect | Text-extent measurement: the only glyphs beyond the edge are the `sr-only` "(diagnostic comparison, not a verdict)" suffix. The 9px is the last column's right padding, and no visible text is hidden. The table stays as it is. |
| 7 | Hyphen/ellipsis wrapping of IDs in narrow columns (e.g. `fixture A-` / `verified`, `hist_7d621c0c…` / `d6fe` in the 1024 case table) | NOT a defect (recorded) | Normal break opportunities. Every character remains visible and in order. Forcing `nowrap` would widen the 1024 table's minimum width and push the Comparison column off-screen, which is worse. All occurrences are listed per cell (`wrapped`) in the matrix results for the reviewer. |
| 8 | FIX03 R-N3: `#/states` has no H1 | FALSE_POSITIVE today | Pre-commit and clean-clone matrices: exactly one visible `main h1` on `#/states` in all 20 cells (2 engines × 2 themes × 5 widths). `States` renders `PageHead`, which renders `h1`. The page was not edited. |
| 9 | FIX03 R-N1: future optional-rule `pass`/`fail` wording | NOT_REPRODUCED (latent) | `ComparisonSheet.tsx` copies the status. The pinned `service/vendor/model.py` emits only `unknown` for both optional rules. Adding fallback wording would invent semantics for an Evaluator output that does not exist. No change; disclosed in REMAINING_LIMITATIONS.md. |
| 10 | FIX03 R-N5: borderline 4.49:1 Mismatch seal (WebKit, `#/states`) | NOT_REPRODUCED | 0 axe violations in all 200 pre-commit and 200 clean-clone matrix cells (including WebKit light `#/states` at all widths) and in the regression suites. No speculative token change. |
| 11 | FIX03 R-N4: `[data-ornament]` contrast | Accepted design decision | `aria-hidden` decoration, excluded from axe by every accepted suite. Unchanged. |
| 12 | FIX03 R-03: `ArchiveIndex.unexpected` is dead | Not proven unused → retained | `src/test/workspace.test.tsx:93` asserts it as a "never drop unknown IDs" invariant. Removing it means deleting an accepted assertion for no behaviour gain. |
| 13 | FIX03 R-04: INCONCLUSIVE `meaning` string never rendered | Retained | It is copy data in `COMPARISON_COPY`, not logic. Removing one field from a copy table is discretionary. |
| 14 | General typography / readability at all five widths | NOT_REPRODUCED beyond #2, #4, #5 | Rendered screenshots were inspected (both engines and themes). Computed font family/size/line-height were recorded per cell. The tokens stay. |
| 15 | FIX01 fixture/custody/bootstrap/recovery safeguards | ALREADY_FIXED (accepted `d34f882`) | Rechecked by the clean-clone full regression (backend, inventory, custody, identities, dev scripts). No change. |
| 16 | FIX02 capture lifecycle, mandatory inventory, evidence isolation, CLS/fonts | ALREADY_FIXED (accepted `203f702`) | Rechecked by the full regression (inventory gates, CLS repeat + probe, tracked-evidence gate). No change. |
| 17 | FIX03 integrity, five rule categories, async states, a11y | ALREADY_FIXED (accepted `e974c6d`) | Rechecked by Vitest and all browser suites. No change. |
| 18 | Firefox and physical screen-reader coverage | BLOCKED for any broader claim | NOT RUN (accepted nonblocking limitation). DOM/axe/keyboard results are not a VoiceOver/NVDA claim. |
| 19 | Off-device backup | BLOCKED | No remote or Time Machine destination exists (`git remote -v` empty, `tmutil destinationinfo`: none). See BACKUP_AND_RECOVERY_STATUS.md. |
| 20 | Untracked empty `FIX0n/final-audit-01/` folders at the repo root (FIX03 R-N8) | Owner housekeeping | `FIX04/final-audit-01/` (empty, created 01:05, before FIX04 began) is still there. It was not created or removed by FIX04. |

No Evaluator, Oracle, contract, protected source, Service code, fixture, historical evidence file, accepted test
expectation or reviewer workspace was modified.
