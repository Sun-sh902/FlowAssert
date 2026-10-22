# Evidence Atelier — Phase 2.5 frontend readiness

Date: 2026-10-17.

**Outcome: READY FOR PHASE 2 INTEGRATION REVIEW.** This is a recommendation for review only. It does not authorize Phase 2.

## Scope

- Frontend quality and integration preparation only.
- No HTTP request is made.
- FlowAssert-Service was not contacted. It does not exist on disk.
- No Python, contract or other repository was modified.
- Nothing was staged, committed or pushed.
- The approved art direction was preserved. The visual changes are listed in §F.4.

| | |
| --- | --- |
| Base | `main` @ `e529077` (v1.1), clean working tree at start |
| Writable workspace | `/Users/zhangshenghe/Documents/FlowAssert-UI` only |
| Contract read | `openapi-v1-proposed.yaml` `0.1.1-proposed` and `frontend-provider-contract.md`. Hashes are in [the checklist](phase2_5/API_INTEGRATION_CHECKLIST.md) |
| Evidence | [`docs/phase2_5/evidence/`](phase2_5/evidence/). The four runs are `run-00-baseline`, `run-01-initial` (with the failures it found), `run-02-final` (Chrome) and `run-03-cross-browser` (Chrome, WebKit and the Firefox attempt, 2026-10-18) |

---

## Baseline (before any change)

| Item | Observed |
| --- | --- |
| Git | `main`, clean, HEAD `e529077`; tags `v0.2-rollback`, `v1.0` |
| Routes | `#/`, `#/verifications`, `#/verifications/:id`, `#/connections`, `#/rules`, `#/settings` (hash router) |
| Provider | `src/data/provider.ts`: synchronous `VerificationProvider` with a MOCK-only `activeProvider`. Pages import `store.ts` directly |
| Research types and adapter | `src/research/types.ts` and `src/adapters/researchToView.ts`. This is the only module that reads research shapes |
| Semantics | `src/research/semantics.ts` restates the precedence for the fixture check only |
| Theme and preferences | Shared external stores in `lib/theme.ts` and `lib/prefs.ts` |
| Rule draft | `data/ruleDraft.ts` (`localStorage`) |
| Automated tests | **None.** No test runner was installed |
| Screenshots | `docs/screenshots/{before,after,v1-atelier,phase2}` |
| Prior accessibility work | Manual focus walk only. No axe, screen-reader, Safari or Firefox testing |
| Checks | `tsc -b` exit 0, `oxlint` exit 0, `npm run build` OK. Main JS 128.94 KB (gzip 34.74 KB) |
| Concurrent edits | None observed in this repository during the session |

---

## A. Updated frontend tests

There are 11 Vitest files (132 tests) and 6 Playwright specs (37 tests in Chrome, plus 12 capture tests).

- **Final run:** all passed.
- **First browser run:** 20 failed, all of them real defects that are fixed below. Its evidence is preserved in `run-01-initial`.

## B. Automated test inventory

See [`phase2_5/TEST_INVENTORY.md`](phase2_5/TEST_INVENTORY.md). It maps all 21 required coverage items to the asserting tests. It also lists each new dev dependency and why it is needed.

## C. Reusable asynchronous state components

Eight data-access states are defined in `src/data/access.ts`: LOADING, EMPTY, REQUEST_ERROR, NOT_FOUND, PARTIAL_DATA, STALE_SNAPSHOT, EVIDENCE_UNAVAILABLE and SERVICE_UNAVAILABLE.

- They are a separate type and vocabulary from the four verdicts.
- A test proves the two share no word.

| Component | File | Purpose |
| --- | --- | --- |
| `AccessMark` | `components/states/AccessStates.tsx` | The logo's trace (source node → line → destination), drawn as interrupted, dotted, doubled or missing. Neutral ink only. It never uses a verdict colour, glyph or hatch |
| `AccessNotice` | same | A ruled slip with kicker, "Data access · not a verdict" stamp, serif title, identity ledger, actions, and a fixed line: `verdict · none`. Failures use `role="alert"`; other states use `role="status"` |
| `CancelledNotice`, `RetryButton`, `AccessStamp` | same | Cancellation (publishes nothing) and a retry affordance |
| `DetailSkeleton` | `components/states/Skeletons.tsx` | The real Detail composition with its values withheld. No record cells are drawn, because the count is unknown. The seal reads "reading". `aria-busy` with a polite status. The breath animation stops under reduced motion |
| `PartialTraces` | same | Overview traces where some runs were read. Read runs use the production `Trace`. Unread runs get a cell-less void track and no verdict seal, and the header says "n of m read" |
| `EvidenceLedger` | `components/states/EvidenceLedger.tsx` | Stored availability (`available`, `not_collected`, `unavailable`, `redacted`, `expired`), each with a shape and a word, beside what this read managed |
| `useProviderRead` | `lib/useProviderRead.ts` | Request sequence and AbortController. A superseded response is dropped. A response from another snapshot is refused as STALE_SNAPSHOT with no data. A provider exception becomes REQUEST_ERROR. Unmount aborts |

### Demonstration

- **Specimen page.** `#/states` ("Interface states", linked from Settings §4) has 10 simulated plates. One is a live read whose outcome can be chosen and then cancelled or retried.
  - Every plate is stamped "Simulated · no request is made".
  - Ready results are the unchanged demo runs.
  - The page is lazy-loaded, so it costs the main bundle nothing.
- **Detail not-found.** The real Detail page now uses the NOT_FOUND state for an unknown run ID.

### Mandatory distinctions, enforced by tests

- A failed request never renders a verdict. The notice says "This is not Unverified".
- Missing evidence says "never as a Mismatch". The stored verdict is shown unchanged.
- A stale or superseded response cannot overwrite the admitted result.
- A partial set draws no cells for unread runs. Counts are never turned into records.

## D. Provider boundary assessment

```
Data source ─▶ Provider adapter ─▶ View models ─▶ Evidence Atelier components
 MOCK fixtures   mockReadProvider     RunView         unchanged pages (sync store)
 (future) HTTP   [not implemented]    EvidencePageView access-state components
```

**Implemented:**

- `FlowAssertReadProvider`, with `getVerification(id, {snapshotId}, signal)` and `getEvidence(id, query, signal)`, returning the contract's `ProviderResult` union.
- `getReadProvider(mode)`:
  - MOCK wraps the store, so the same objects are returned.
  - LOCAL_RESEARCH and LIVE return `SERVICE_UNAVAILABLE` / `provider_mode_unavailable`, with **no fallback to MOCK**.
- `capabilities` follow the contract. MOCK declares `readEvidence: false`, because the fixtures carry no references.
- A wire mirror of the two endpoint DTOs, `src/data/contract/v1.ts`. It is not a competing schema: a compile-time key list plus `contract-drift.test.ts` compares 26 schemas against the reviewed OpenAPI file.

**Deliberately not done:**

- No fetch, base URL, decoder, retries, cache or Overview hydration.
- No page was switched to the async surface. That is the authorized Phase 2 slice.
- `research/semantics.ts` is still used only by the MOCK fixture validator. No production path imports it.

**Assessment:**

- The seam is clean. Components already depend only on view models.
- The remaining coupling is in `researchToView.ts` and `main.tsx` (demo registry, demo clock, fixture check). Those must stay MOCK-only (checklist gap G8).

## E. API integration readiness checklist

See [`phase2_5/API_INTEGRATION_CHECKLIST.md`](phase2_5/API_INTEGRATION_CHECKLIST.md). For every field Verification Detail needs, it records: API source, transformation, nullability, missing-evidence behaviour, trust class and whether the field is presentation-only. It also lists gaps G1–G8 that the authorized slice must close: nullable times, nullable `n8nLabel`, `rowId`, a copied `windowOpen`, the snapshot clock, timeout/unknown access, authenticity taken from `assurance`, and MOCK-only imports.

### Contract observations for the Codex/backend workflow

No material backend contract problem was found. Two points need review alignment:

1. **The provider-sketch error variant has no classification field.**
   - The sketch's `{kind:"error", code, message, requestId, retryable}` cannot tell a snapshot conflict (409) apart from an outage or an evidence integrity failure (503).
   - The frontend adds `access: AccessFailure` and a proposed mapping in `classifyHttpFailure`:
     - no response or provider unavailable → SERVICE_UNAVAILABLE
     - 409 → STALE_SNAPSHOT
     - 503 on evidence → EVIDENCE_UNAVAILABLE
     - 503 on a run → SERVICE_UNAVAILABLE
     - everything else → REQUEST_ERROR
   - This only interprets the status codes the contract already defines. It needs no backend change, but it is an addition to the sketch and should be acknowledged in the next contract review.
2. **`DestinationObservation.access` allows `timeout` and `unknown`.** The current UI only words `denied`. This is a frontend copy gap (G6), not a contract defect.

## F. Accessibility findings

Tooling: axe-core 4.13.0 in Chrome 155, with WCAG 2.0/2.1/2.2 A and AA rules plus best practice. Supporting checks:

- a programmatic focus walk (210 Tab stops),
- touch-target measurement at 375px,
- reduced-motion emulation,
- RTL and user-event keyboard tests.

### F.1 Confirmed issues found and fixed

| # | Issue | Where | Fix |
| --- | --- | --- | --- |
| 1 | Mobile drawer (`aria-modal`) had no focus trap: Tab reached the page behind it | `AppShell` | Tab and Shift+Tab cycle inside the drawer; Escape and focus restore kept. Unit- and browser-tested |
| 2 | Informative small text in `ink-4` at 2.59:1 (light) and 2.72:1 (dark): rule-group hints, "contacts", rule-pass counts, approval reason, "never runs", "· required", diagram labels, "Configure", version, placeholders | Rules, Trace, Detail, Connections, shell, search | Changed to `ink-3` (≥ 4.5:1) |
| 3 | `ink-3` text on tinted rows at 4.02–4.45:1: the selected record name, the selected rule kind, and secondary text on Mismatch comparison rows | Detail, Rules, ComparisonSheet | Changed to `ink-2` on those tinted rows only |
| 4 | Page content outside landmarks: the top bar's crumbs, demo clock and "What's real?" | `AppShell` | Breadcrumb `nav`, a "Demo register" region and a labelled region for the details. The mobile bar is a `header` |
| 5 | The draft editor's focus underline (1.5px) is snapped to 1px by Chrome at device-pixel-ratio 1, leaving a faint indicator | `atelier.css .fa-field` | 2px on focus, with 1px padding compensation so nothing moves |
| 6 | Small standalone text targets were 18–22px tall at 375px | 10 links and buttons | An invisible `.fa-hit` pseudo-element extends each to ≥ 24px; the type does not move |
| 7 | **Found in WebKit:** with Safari's default keyboard setting (Tab reaches form fields only), Tab left the open drawer for the search field behind it. The trap intercepted Tab only at its first and last items | `AppShell` | The trap now handles every Tab and Shift+Tab itself, cycling through the drawer's links and buttons, so it holds whatever the browser's own Tab order is |

Final result:

- axe: **0 violations** on 7 routes × 2 themes, plus the open drawer.
- Focus walk: no element lacks a visible indicator.
- Touch targets: in Chrome, none under 24×24 at 375px. In WebKit, one: the native `<select>` in the draft editor is 309×20, because WebKit ignores `min-height` on native selects. It passes WCAG 2.5.8 through the spacing exception: a 24px circle centred on it touches no other target. The target test now implements that exception exactly and reports which targets rely on it.
- All of the above hold in both Chrome and WebKit.

### F.2 Accepted exception, not hidden

Ordinal ornaments are kept in `ink-4`:

- nav numerals `01–05`,
- Settings and States `§n` marks,
- Overview Roman numerals.

They are `aria-hidden`, carry no information, and are marked `data-ornament`. WCAG 1.4.3 exempts pure decoration. The axe run excludes only `[data-ornament]`, and this report lists them. The Connections register letters A/B/C are referenced elsewhere ("compares A with C"), so they were treated as informative and fixed.

### F.3 Not performed

- No screen-reader testing (VoiceOver, NVDA, JAWS). Full screen-reader compatibility is **not claimed**.
- Live regions and roles were verified structurally, not by listening.
- No zoom or text-spacing (1.4.12) audit.

### F.4 Visual changes made to the approved design

All are small:

- the ink tone changes in rows 2–3 of §F.1,
- the 2px field focus underline,
- the drawer can scroll when it is taller than the viewport,
- the Settings §4 link card to Interface states,
- the "awaiting phase 0" tag now reads "reserved · phase 2" (Phase 0 is accepted),
- the new NOT_FOUND treatment on Detail.

No layout, typography, palette token, trace, seal, operator or composition was changed.

The brief describes a "coral brand accent". In the shipped tokens the brand accent is **indigo** (`--fa-brand` #2f3590 / #9aa2ff) and coral is the **Mismatch** tone. This was left as built. Flag it if the brief was meant to change it.

## G. Browser compatibility findings

The Firefox and WebKit builds were installed with `npx playwright install firefox webkit` on 2026-10-18. Together they take about 590 MB in `~/Library/Caches/ms-playwright`, outside the workspace. The whole e2e suite was then run per browser.

| Browser | Status | Result | Evidence (`run-03-cross-browser/`) |
| --- | --- | --- | --- |
| Chromium — Google Chrome 155.0.8059.82 (Playwright `channel: chrome`) | **TESTED** | 37/37 pass | `e2e-chrome-webkit-final.log` |
| WebKit — Playwright WebKit 26.6 (build 2359), the engine behind Safari | **TESTED** | 37/37 pass, after the two fixes below | `e2e-chrome-webkit-final.log`, `*-webkit-*.json` |
| Firefox — Playwright Firefox 155.0 (build 1543) | **NOT TESTED** — installed, but cannot start on this machine | 0 run: every launch exits immediately | `e2e-all.log`, `e2e-all-rerun.log`, `e2e-firefox.log`, `firefox-launch-probe.log` |
| Safari.app 27.2 itself | **NOT TESTED** directly | Automating it needs "Allow Remote Automation", a system setting that was not changed. WebKit above is the same engine, but not the same app | — |
| Chromium — Claude built-in browser pane | Manually reviewed during development | Light and dark, 375 and 1440 | — |

The checks run per browser:

- layout and overflow at five widths and two themes,
- axe on 7 routes × 2 themes plus the open drawer,
- the focus walk (210 stops),
- the skip link, the drawer trap, and theme and preference persistence across reloads,
- reduced motion (device setting and in-app preference),
- the simulated read's live region,
- console and network cleanliness,
- the 24px target size at 375px,
- DOM size and paint timing.

WebKit and Chrome produce identical results for overflow, axe, focus stops (210 each) and DOM size.

### Found in WebKit and fixed

1. **Drawer focus trap.** Under Safari's default "Tab reaches form fields only" behaviour, focus escaped the modal drawer. The trap now moves focus itself on every Tab (§F.1 row 7). Before the fix this was a real escape for Safari users; it is now covered in both engines.
2. **Draft-editor select at 20px.** WebKit draws the native select shorter than Chrome and ignores `min-height` on it. Restyling the native control would have changed the approved look in every browser. The target is instead recorded as passing through the WCAG 2.5.8 spacing exception, and the test checks that exception (§F).

### Harness adjustments

These make the checks browser-aware. No assertion was relaxed.

- WebKit uses Option+Tab, Safari's key for reaching every item, for the skip-link check and the focus walk. Plain Tab there skips links and buttons by design.
- Reports are now written per browser.
- CLS is reported as `null` in WebKit, because the Layout Instability API is Chromium-only. It is never reported as 0.
- `open()` waits for the page heading, so the lazy `#/states` route is fully rendered before any check.

### Why Firefox could not be tested

Every Firefox launch prints `Could not find profile folder.` and exits. This happened with:

- the Playwright temp profile,
- explicit profile folders in `/var/folders`, `/private/tmp` and `~/Library/Caches`,
- no profile at all,
- runs inside and outside the agent's shell sandbox.

The machine runs macOS 27.2 (build 26B5101f, a pre-release). The most likely cause is that this Playwright Firefox build is incompatible with the OS. That was not verified further, and no workaround such as another Playwright version or a system Firefox was attempted, because either would mean changing pinned dependencies or installing more software. To retry later, on a supported macOS or with a newer Playwright:

```bash
FA_BROWSERS=chrome,firefox,webkit npm run test:e2e
```

Firefox-relevant CSS, from code review only: Tailwind 4's floor (Firefox 128+), `mask`, `contain: inline-size`, `clip-path`, `text-wrap: balance`, `100dvh` and `:focus-visible` all ship in current Firefox. This is not a substitute for a test run.

## H. Responsive quality findings

The check covered 7 routes × 375 / 768 / 1024 / 1280 / 1440 × light and dark. It found no page-level horizontal overflow and no element past the viewport. The JSON per width is in `run-02-final/responsive-*.json`.

- **Defect found and fixed.** The new Interface states page overflowed to 610px at 375px. The evidence table's 560px minimum propagated through an unconstrained grid track.
  - Fixed inside the component (`contain: inline-size`), so any future consumer is safe.
  - The page grid track is also constrained.
- **Existing pages.** No overflow at any width.
  - Tables become stacked lists below 768px.
  - The comparison sheet becomes stacked rows below 640px.
  - The custody diagram becomes a vertical list below 768px.
- **Observation, not changed.** At 1024px the Overview verdict sentence wraps to five lines, because the 340px ledger column appears from `lg`. It is legible, and changing it would alter the approved composition.
- Full-page captures for all combinations are written locally to `e2e/.output/screens` (git-ignored). A curated set is in §J.

## I. Performance observations

Measured on the production build via local preview, Chrome, unthrottled, one machine (`run-02-final/perf.json`).

| Route | DOM nodes | CLS | FCP (ms) |
| --- | --- | --- | --- |
| Overview (cold) | 622 | 0.051 | 100 |
| Verifications | 1006 | 0 | 44 |
| Detail (VR-2025, 48 records) | 1022 | 0 | 60 |
| Connections | 316 | 0 | 80 |
| Rules | 470 | 0 | 64 |
| Settings | 515 | 0 | 44 |
| Interface states | 943 | 0 | 28 |

**Bundle:**

- Main JS 139.99 KB (gzip 38.20 KB), against a baseline of 128.94 KB (34.74 KB). The +11 KB is the access-state notice and the async provider seam.
- The specimen page is a separate 24.3 KB chunk.
- One regression was found and fixed: before code-splitting the page and splitting the state components into three modules, main JS was 163.4 KB.

**Observations, not changed:**

- Verifications and Detail render both the wide and the narrow layout and hide one with CSS. This roughly doubles DOM nodes, but they stay around 1,000. Switching layouts in JS would risk the responsive design for no measured benefit.
- Cold-load CLS of 0.051 comes from the web-font swap. It is under the 0.1 threshold.
- No speculative caching or list virtualisation was added. History hydration (N001) was not implemented.

## J. Final screenshots

Location: `docs/screenshots/phase2_5/` — 50 PNGs, light and dark. They are reproducible with:

```bash
FA_CAPTURE=1 npx playwright test e2e/screenshots.spec.ts
```

- **Access states at 1440:**
  - `*-state-live`, `*-state-live-loading`
  - `*-state-loading`, `*-state-empty`, `*-state-error`
  - `*-state-notfound`, `*-state-partial`, `*-state-stale`
  - `*-state-evidence`, `*-state-service`, `*-state-cancelled`
  - `*-states-head`
- **At 375:** `*-state-error`, `*-state-partial`, `*-state-evidence`.
- **Detail not-found:** `*-detail-not-found-1440x900`.
- **Regression views:**
  - Overview at 1440 and 375
  - Detail at 1440 and 375
  - Verifications at 1024
  - Connections at 768
  - Rules at 1280
  - Settings at 1440
- **Drawer:** `*-drawer-focus-trap-375`.

## K. Exact changed-file inventory

Modified (21):

```
.gitignore                     test output folders
README.md                      check commands, layout entries for the new folders and report
package.json, package-lock.json  scripts + 7 pinned dev dependencies
tsconfig.json, tsconfig.app.json, tsconfig.node.json   test/e2e projects
src/App.tsx                    #/states route (lazy), crumbs, hit areas
src/lib/router.ts              "states" route
src/data/provider.ts           async read provider, MOCK + unavailable modes
src/components/shell/AppShell.tsx   drawer focus trap (explicit on every Tab; WebKit fix), landmarks, contrast, hit area
src/components/detail/ComparisonSheet.tsx   contrast on Mismatch rows
src/components/runs/Trace.tsx  contrast, hit area
src/components/charts/DailyRegister.tsx  hit area
src/components/ui/primitives.tsx placeholder contrast
src/pages/VerificationDetail.tsx NOT_FOUND access state, contrast, hit areas
src/pages/Overview.tsx         ornament mark, hit area
src/pages/Connections.tsx      contrast, hit area
src/pages/Rules.tsx            contrast, hit area
src/pages/Settings.tsx         link to Interface states, tag copy, ornament marks
src/styles/atelier.css         access-state styles, field focus 2px, .fa-hit
```

New:

```
src/data/access.ts  src/data/contract/v1.ts  src/domain/evidence.ts  src/lib/useProviderRead.ts
src/mocks/scenarios.ts  src/pages/States.tsx
src/components/states/{AccessStates,Skeletons,EvidenceLedger}.tsx
src/test/{setup.ts,render.tsx} + 11 *.test.ts(x)
e2e/{helpers.ts,responsive,a11y,interactions,perf,screenshots}.spec.ts
vitest.config.ts  playwright.config.ts  tsconfig.test.json
docs/PHASE2_5_FRONTEND_READINESS.md  docs/phase2_5/{TEST_INVENTORY,API_INTEGRATION_CHECKLIST}.md
docs/phase2_5/evidence/** (incl. run-03-cross-browser)  docs/screenshots/phase2_5/** (50 PNG + 6 WebKit JPG in webkit/)
```

Existing design documentation (DESIGN_SYSTEM, PHASE2_UI, V1_ATELIER_REBUILD and the others) was not edited. README.md only gained the check commands and layout entries.

## L. Build and test results (final run)

| Command | Outcome | Log |
| --- | --- | --- |
| `npx tsc -b` (app, node, test projects) | exit 0 | `run-02-final/typecheck.log` |
| `npx oxlint src e2e` | exit 0, no findings | `lint.log` |
| `npm run build` | exit 0 | `build.log` |
| `npm run test:fixtures` (existing validator) | 8/8 passed | `fixtures.log` |
| Dev startup fixture check | Console: "Demo fixtures consistent: 16 runs checked." | — |
| `npm test` | 132/132 passed (11 files) | `unit.log` |
| `npm run test:e2e` (Chrome) | 37/37 passed | `e2e-chrome.log` |
| `FA_BROWSERS=chrome,webkit npm run test:e2e` (2026-10-18) | **74/74 passed** (37 Chrome + 37 WebKit); the 24 skips are the capture-only spec | `run-03-cross-browser/e2e-chrome-webkit-final.log` |
| Re-check after the cross-browser fixes: `tsc -b`, `oxlint src e2e`, `npm test`, `npm run build` | exit 0 / exit 0 / 132 of 132 / exit 0 | `run-03-cross-browser/*.log` |
| `FA_CAPTURE=1 …screenshots.spec.ts` | 12/12 passed | `screenshots.log` |
| Firefox (installed 2026-10-18) | **Not run** — the browser cannot start on macOS 27.2 | `run-03-cross-browser/firefox-launch-probe.log` |

The first browser run (`run-01-initial`) had 20 failures:

- 16 axe failures: 10 were contrast and landmark issues. The other 6 (overview, detail and connections, both themes) crashed on a harness bug before auditing; once rerun they found the same contrast class.
- 2 overflow failures: States at 375px.
- 1 focus-visibility failure: the draft fields.
- 1 live-region locator failure.

Each was fixed in the product or in the harness, as described above, and nothing was relaxed to pass. One product bug was also caught by a unit test: when pinned to a snapshot, the read hook refused error results, which carry no snapshot. The admission rule now snapshot-checks only results that carry data.

## M. Backend integration dependencies

1. Owner authorization of Phase 1 (G01/G02) and a working FlowAssert-Service. The service directory is absent today.
2. Phase 1 independent review of the two endpoints, including the F004 cross-field validators, snapshot echo, and 404/409/503 behaviour.
3. Owner authorization of Phase 2 (U01) before any HTTP code, typed DTO decoder or page switch.
4. Review acknowledgement of the error `access` classification (§E.1).
5. The frontend gaps G1–G8 in the checklist, done in the authorized slice.
6. Overview hydration (U02) and the optional full-history resource limits (N001). Neither was implemented here, by design.
7. Live data (L01/L02) stays out of scope.

## N. Source integrity and Git status

**FlowAssert-UI:**

- Branch `main`, HEAD `e529077`, unchanged.
- Nothing staged or committed; the working tree is listed in §K.
- `dist/`, `test-results/` and `e2e/.output/` are git-ignored.

**Protected projects** (read only, never written):

| Project | State |
| --- | --- |
| `FlowAssert-Integration-Planning` | Not a git repository. Contract hashes are recorded in the checklist |
| `FlowAssert-Integration-Final-Audit` | Not a git repository. Read only |
| `FlowAssert-round03-oracle-fix` | Branch `fix/round03-5-review-fixes` @ `4deddb3`. It has 15 uncommitted modifications, **all dated 2026-10-16 12:16 to 2026-10-17 00:29, before this session**. This session did not touch them |
| `FlowAssert-Service` | Absent. Not created and not contacted |

- No git worktrees were created. No global git configuration was changed.
- Browser binaries: none until 2026-10-18. Then, at the Owner's request, Playwright Firefox and WebKit were installed into `~/Library/Caches/ms-playwright`, outside the workspace.
- The only network traffic in the browser tests was to `localhost:4183` (asserted).

---

**READY FOR PHASE 2 INTEGRATION REVIEW.** Remaining limitations:

- Firefox is NOT TESTED: it is installed but cannot start on this macOS pre-release. Chrome and WebKit are tested.
- Safari.app itself is not automated; its engine, WebKit, is.
- No screen-reader pass was performed.

Phase 2 is not authorized by this report. Waiting for Owner review.
