# FlowAssert UI — first iteration

Frontend prototype for **FlowAssert**, an evidence-based workflow verification product in its
offline research stage. The demo pages show **synthetic demo data** (MOCK) modelled on the research
evaluator's contract. Since Phase 2, the separate **Local research** pages (`#/local/…`) read the
accepted local Python service over HTTP — still synthetic input, an unapproved research version, no
authentication and no live n8n or HubSpot connection.

The research repository (`../FlowAssert-round03-oracle-fix`) was used read-only as the source of truth
and was not modified.

## Run locally

Requires Node 20+ (developed with Node 26.10, npm 11.19).

```bash
npm install
```

```bash
npm run dev
```

Open <http://127.0.0.1:5183>. Production build:

```bash
npm run build
```

Checks (Phase 2.5):

```bash
npm run typecheck && npm run lint && npm test
```

```bash
npm run test:e2e
```

`npm test` runs the Vitest component and unit suites. `npm run test:e2e` builds the app and runs the Playwright browser checks
(responsive, axe accessibility, keyboard, performance) in the locally installed Chrome. See
`docs/PHASE2_5_FRONTEND_READINESS.md` and `docs/phase2_5/TEST_INVENTORY.md`.

`npm run dev` validates every demo fixture against the research state precedence at startup and shows
an error instead of the app if anything is inconsistent.

### Local research pages (Phase 2)

The dev and preview servers proxy `/api/v1` (only) to the local service on `127.0.0.1:8765`. Prepare the
isolated exact-source copy of the accepted service once, then run it next to `npm run dev`:

```bash
/usr/bin/python3 -I -B scripts/phase2/prepare_runtime.py
```

```bash
npm run service:local
```

Open <http://127.0.0.1:5183/#/local/verifications>. Without the service, local pages show *Service
unavailable* — never demo data. Real end-to-end checks (they start and stop the service themselves):

```bash
FA_BROWSERS=chrome,webkit npm run test:e2e:local
```

See `docs/PHASE2_INTEGRATION_REPORT.md`.

## What is in this iteration

| Area | Status |
| --- | --- |
| Design system (tokens, type, status glyphs, components) | Implemented |
| App shell (sidebar, mobile drawer, demo banner, light/dark/system theme) | Implemented |
| Overview | Implemented |
| Verifications list (filter + search) | Implemented (lightweight) |
| Verification detail | Implemented |
| Connections, Rules, Settings | Implemented as demo configuration pages (Phase 2): synthetic data, nothing connected, nothing sent — see `docs/PHASE2_UI.md` |

## Project layout

```
src/
  research/   TypeScript mirror of model.py output + state-precedence mirror (no evaluation)
  mocks/      Proposed run envelope, deterministic fixture builders, consistency validator
  adapters/   research shape → view models (the only module that reads both)
  domain/     View-model types used by components
  data/       Read-only demo store, provider seam (MOCK only; async read surface prepared), data-access states,
              contract/ wire mirror of the reviewed v1 Detail and evidence DTOs, demo configuration, local draft rule
  components/states/  Data-access state presentation (loading, error, partial, stale, evidence unavailable…)
  test/       Vitest suites; browser checks live in e2e/
  components/ ui · charts · runs · detail · shell
  pages/      Overview, Verifications, VerificationDetail, Connections, Rules, Settings, States (#/states specimens)
  styles/     tokens.css (design tokens), index.css (Tailwind theme mapping)
docs/
  PRODUCT_UNDERSTANDING.md       What exists vs. proposed vs. mocked, with source references
  INFORMATION_ARCHITECTURE.md    Navigation review and journeys
  DESIGN_SYSTEM.md               Tokens, type, glyphs, components, a11y conventions
  RESEARCH_TO_FRONTEND_MAPPING.md Field-level mapping and proposed interface
  PHASE2_UI.md                   Connections, Rules, Settings: scope, interactions, limits, Phase 0 dependencies
  PHASE2_5_FRONTEND_READINESS.md Phase 2.5: tests, access states, provider boundary, a11y/responsive/browser findings
  VISUAL_REVIEW.md               Iteration 1 rendered review
  VISUAL_REFINEMENT_REPORT.md    v0.2 visual refinement: changes, tokens, regressions, responsive review
  V1_ATELIER_REBUILD.md          v1.0 production rebuild in Direction C (Evidence Atelier)
  design-lab/                    Art-direction exploration, approved direction, rebuild plan
  screenshots/v1-atelier/        Current UI (light, dark, 375/768/1440)
  screenshots/before, after/     v0.1 → v0.2 history
```

Stack: React 19, TypeScript (strict), Vite 8, Tailwind CSS 4, lucide-react, self-hosted fonts
(Instrument Serif, Instrument Sans, IBM Plex Mono via Fontsource; all SIL OFL 1.1). The design lab
(`lab.html`) additionally uses Inter Tight, Martian Mono, Inter and Newsreader. No router, UI-kit or animation library was
added: a small hash router and native semantics were sufficient.

## Known limitations

1. **All data is synthetic.** Names, emails, run IDs, wall-clock times and digests are demo values.
   Digests look like SHA-256 but are placeholders.
2. **Email comparison is a proposed rule.** The research model compares only `phone`; the UI tags the
   email rule "Proposed rule".
3. **Time mapping is frontend-only.** The model uses integer ticks; the demo maps 1 tick = 60 s from
   the source capture instant. A fixed demo clock (16 Oct 2026 14:30 UTC) keeps relative times
   consistent.
4. **"Verified" is not authenticated.** Internally consistent fabricated evidence would still be
   Verified under the current contract; the UI states this on every detail page.
5. **No actions.** Acknowledge, request recheck, alerts and links into HubSpot are intentionally
   absent because nothing could perform them.
6. **Review coverage.** Visual review was done in a Chromium-based pane at 375 / 1280 / 1440px; no
   automated accessibility audit, screen-reader, Safari or Firefox testing (see
   `docs/VISUAL_REVIEW.md`).
7. The research project is not production-ready: its release is blocked pending independent review.

## Proposed next UI iteration

1. **Recheck & acknowledgement flows** (UI only, against a mocked queue): new observation preserves the
   earlier one; acknowledgement never changes state; changed rule versions are flagged.
2. **Record history** across runs for a source key, to show persistence of a discrepancy.
3. ~~Connections and Rules~~ — built as demo pages in Phase 2 (`docs/PHASE2_UI.md`).
4. **First-use setup walkthrough** from `USER_EXPERIENCE.md` §2 as a clickable prototype for
   usability testing.
5. Automated a11y (axe) and visual-regression checks in CI; tablet layout pass.
6. Replace `src/data/store.ts` with a typed client once a backend contract is approved.

## Phase 3A — local verification history (LOCAL_RESEARCH)

**07 History** (`#/local/history`, `#/local/history/:historyId`) reads archived evaluations from the
Phase 3A Service's local SQLite archive over HTTP — list, archived Detail and archived evidence, with
retrieval and integrity reported separately. Report and design: [docs/phase3a/PHASE3A_FRONTEND_REPORT.md](docs/phase3a/PHASE3A_FRONTEND_REPORT.md).
The dev/preview servers forward only five exact GET routes through `server/localApiGate.ts`.

```bash
/usr/bin/python3 -I -B scripts/phase3a/prepare_runtime.py   # isolated, verified copy of the Phase 3A Service
/usr/bin/python3 -I -B scripts/phase3a/seed_states.py       # archives via the reviewed seed pipeline
FA_HISTORY_STATE=ui-main scripts/phase3a/history-service.sh  # 127.0.0.1:8765, Ctrl-C to stop
npm run dev                                                   # 127.0.0.1:5183
FA_BROWSERS=chrome,webkit,firefox npm run test:e2e:history    # real-service E2E (owns the Service itself)
scripts/phase3a/final_regression.sh                           # every gate, logged with exit codes
```
