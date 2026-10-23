# FIX03 — Confirmed fixes

**Status: DRAFT, in the working tree on top of `203f702`, not committed** (FIX02 acceptance outstanding; see
FINDING_TRIAGE.md). 18 tracked files modified and 1 test file added; no Service, contract, Evaluator or `docs/`
evidence file changed.

Every fix is the smallest change that removes the confirmed defect. No React code computes, overrides or infers a
verdict; no capability was added.

| ID | Fix | Files | Proved by |
| --- | --- | --- | --- |
| F-01a | One mapping from the Service statement to an integrity state — `serviceIntegrityState()` — used by the four tags that collapsed every non-VERIFIED status to `failed`. | `domain/integrity.ts`, `components/history/HistoryRows.tsx`, `components/workspace/StatusAxes.tsx`, `components/workspace/ArchiveMatch.tsx` | F-01 #1–2 |
| F-01b | The archive axis keeps the reported outcome (`integrity: "INTEGRITY_FAILED" \| "INTEGRITY_UNVERIFIABLE" \| null`, was `boolean`). Its note, the match panel text and a new integrity tag say *integrity failure* only for FAILED, and *could not verify the stored archive* for UNVERIFIABLE. | `domain/statusAxes.ts`, `components/workspace/StatusAxes.tsx` | F-01 #3–4 |
| F-01d | `IntegrityTag` adds a visually hidden state word ("Integrity verified: …"); the glyph stays `aria-hidden`. | `components/integrity/Integrity.tsx` | F-01 #5 |
| F-02a | The comparison sheet adds one row for each historical/execution rule the Evaluator returned, with the Evaluator's status and explanation. The source cell says "required by policy" and the HubSpot cell "not assessed". No email or sixth rule is created; the reviewed fixtures render as before. | `components/detail/ComparisonSheet.tsx` | F-02 #1–2, #4 |
| F-02b | `recordSummary` says "its phone matches" only when the phone rule passed; otherwise it lists the rules that could not be assessed, by their labels. The exact earlier sentence is kept for its one true case. | `adapters/wireToView.ts` | F-02 #3–4 |
| F-03d | A provider rejection that is not an abort becomes a failure with code `client_error`: the live case is *failed* (not *cancelled*) and the candidate check settles as *retrieval failed* (it no longer stays *reading*). Abort handling is unchanged. | `lib/useLiveCases.ts`, `components/workspace/ArchiveMatch.tsx` | F-03 #1–2 |
| F-04a | The production build shows "Fixture check · not run in this build" (the startup check is DEV-only; the test suite checks the same runs). The dev server keeps "N runs consistent". | `pages/Settings.tsx` | F-04 #5–6 |
| F-04d | Cases still being read are not counted under *No result* (the ledger shows "·") and are listed under "Current result being read", not "No current result". The headline says "No current result has been read yet." until reads finish, and "N are still being read" beside settled results. | `pages/Workspace.tsx` | F-04 #1–2; existing `workspace.test.tsx:170, 228` unchanged and passing |
| F-04e | A list 404 on the Detail status axes is its own archive state, NOT_FOUND ("Archive list not found … not a verdict, and not an empty archive"), not *Archive unavailable / read failure*. | `domain/statusAxes.ts`, `components/workspace/StatusAxes.tsx` | F-04 #4 |
| F-04f | The register reads "10 entries · 3 pages · 4 per page" (was "3 pages of 4"). | `pages/Workspace.tsx` | F-04 #3 |
| F-05a | When the whole Overview is the Service-unavailable notice, its title is the page's H1. `ArchiveReadState` takes `headingLevel`, default 2; Verifications keeps its `PageHead` H1. | `pages/Workspace.tsx` | F-05 #1 |
| F-05b | Each term is grouped with its own description: `dl > div > (dt, dd)` for Live and Archived; the layout is unchanged. | `pages/Workspace.tsx` | F-05 #2 |
| F-05c | Both theme selectors follow the WAI-ARIA radio-group pattern: one Tab stop on the checked radio, arrow keys move selection and focus. The logic was moved unchanged out of `Segmented` into `useRadioGroupKeys`, which all three now share. | `components/ui/atelier.tsx`, `components/shell/AppShell.tsx`, `pages/Settings.tsx` | F-05 #3–4; existing `settings.test.tsx:36` (Segmented arrows) passing |
| F-05d | The Data provider register is a list (`ul`/`li`, `aria-current` on the active mode), not a radio group that cannot be operated; it is no longer a Tab stop. The visible state tags are unchanged. | `pages/Settings.tsx`; tests `src/test/settings.test.tsx`, `e2e-local/local-research.spec.ts` (locator only) | `settings.test.tsx` "Provider modes" |
| F-06 | `ui/README.md` rewritten against the actual files: `scripts/dev/` bootstrap/service/regression, the route table, the seven gate routes, Chrome+WebKit (no Firefox), `--harness` for the accepted suites, the current layout. Dead links removed; the stale "proposed next iteration" list dropped. Nothing claims external provider access, capture or admission. | `ui/README.md` | manual check, see *README verification* |

Test bookkeeping: `ui/src/test/fix03.test.tsx` (21 tests) is added to `scripts/dev/test-inventory.json`.
`workspace.test.tsx:121` changes the literal `integrity: false` to `null` for the new type.

## README verification

Every path and command in the new README was checked to exist in this commit: `scripts/dev/{bootstrap,service,regression}.sh`,
`server/localApiGate.ts` (seven GET operations, lines 9–15), the npm scripts `test:e2e`, `test:e2e:workspace`,
`test:e2e:local` and `test:e2e:history` (`ui/package.json`), `playwright.lookup.config.ts`, `src/test/fixtures.test.ts`
and `scripts/dev/test-inventory.json`. The browser list was checked too: Chrome and WebKit for every Playwright group,
with `rules-cls-repeat` Chrome-only and no Firefox.
