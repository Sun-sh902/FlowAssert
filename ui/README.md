# FlowAssert UI

Frontend for **FlowAssert**, an evidence-based workflow verification product in its offline research stage, in the
product development workspace (see the [workspace README](../README.md)). **LOCAL / OFFLINE / SYNTHETIC RESEARCH ONLY.**

Two data sources, never mixed on one page:

- **LOCAL_RESEARCH** — the workspace pages (`#/`, `#/verifications`, `#/local/…`) read the local Python Service on
  `127.0.0.1:8765` over HTTP: the five reviewed synthetic cases, their live results and the local SQLite archive.
  Verdicts are the pinned Python evaluator's, copied unchanged. Without the Service these pages show
  *Service unavailable* — never demo data.
- **MOCK** — the demo pages (`#/demo`, `#/demo/verifications`) and the configuration pages (`#/connections`, `#/rules`,
  `#/settings`) use hand-built synthetic fixtures. Nothing is read from any service and nothing is sent.

There is no live n8n or HubSpot connection, no credentials, no capture pipeline and no evidence admission in this build;
the Capture and Admission status axes say *Not implemented*.

## Run locally

Requires Node 20+ (developed with Node 26.10, npm 11.19). From the workspace root, once on a fresh clone:

```bash
scripts/dev/bootstrap.sh            # tools, ui/node_modules, service/.venv, pinned identities, synthetic archives
```

Then, in two terminals:

```bash
scripts/dev/service.sh              # Service on 127.0.0.1:8765 (FA_STATE=dev-single | dev-empty for the other archives)
cd ui && npm run dev                # UI on http://127.0.0.1:5183
```

The dev and preview servers forward only seven exact GET routes to the Service, through `server/localApiGate.ts`
(the frozen v1 Detail and evidence routes, the three Phase 3A history routes and the two ID-lookup routes); every other
`/api` request is refused there. `npm run dev` also checks every MOCK demo fixture against the research state
precedence at startup and shows an error instead of the app if one is inconsistent (dev server only; the production
build does not run this check — `src/test/fixtures.test.ts` does).

| Page | Address | Data |
| --- | --- | --- |
| Overview | `#/` | LOCAL_RESEARCH — live results and the archive |
| Verifications | `#/verifications` (also `#/local/verifications`) | LOCAL_RESEARCH |
| Verification Detail + evidence | `#/local/verifications/SPEC-00N` | LOCAL_RESEARCH, live read |
| Detail by exact ID | `#/local/verification-lookup?verification_id=…` | LOCAL_RESEARCH, ID-lookup routes |
| History | `#/local/history`, `#/local/history/:historyId` | LOCAL_RESEARCH — the SQLite archive |
| Capture runs | `#/capture` | not implemented — no action offered |
| Demo overview / runs | `#/demo`, `#/demo/verifications` | MOCK |
| Connections, Rules, Settings | `#/connections`, `#/rules`, `#/settings` | MOCK configuration demo |
| Interface states | `#/states` | simulated access states, never verdicts |

## Checks

```bash
npm run typecheck && npm run lint && npm test
```

`npm test` runs the Vitest component and unit suites; the required fixtures are in the repository
(`src/test/fixtures/`, `../service/contracts/`) and identity-checked.

Browser suites (Playwright; locally installed Google Chrome by default, `FA_BROWSERS=chrome,webkit` adds WebKit;
Firefox is not run in this workspace):

```bash
FA_BROWSERS=chrome,webkit npm run test:e2e             # static build: responsive, axe accessibility, keyboard, performance
FA_BROWSERS=chrome,webkit npm run test:e2e:workspace   # real Service: starts and stops scripts/dev/service.sh itself
```

`test:e2e`, `test:e2e:workspace` and the other suites own ports 4183, 4184, 5183 and 8765; stop the dev server and the
Service first. The accepted Phase 2 / Phase 3A suites (`test:e2e:local`, `test:e2e:history`, the lookup suite) need
their isolated runtimes, provisioned by `scripts/dev/bootstrap.sh --harness`; that step reads the accepted read-only
sources at fixed absolute paths outside this repository and stops BLOCKED if they are absent.

Every gate, with exit codes, logs and the test inventory (`scripts/dev/test-inventory.json`) checked so that a skipped
or missing test fails the run:

```bash
scripts/dev/regression.sh --portable LABEL   # self-contained gates (no browsers, no ports)
scripts/dev/regression.sh LABEL              # every gate, including the browser suites
```

## What is in this build

| Area | Status |
| --- | --- |
| Design system (tokens, type, status glyphs, components) | Implemented |
| App shell (sidebar, mobile drawer, Service status, light/dark/system theme) | Implemented |
| Overview and Verifications (five known cases; live beside archived; four status axes) | Implemented, LOCAL_RESEARCH |
| Verification Detail, evidence, exact-ID lookup | Implemented, LOCAL_RESEARCH |
| History (archive list, archived Detail, archived evidence; retrieval and integrity reported separately) | Implemented, LOCAL_RESEARCH |
| Capture runs, evidence admission | Not implemented — stated as such, no action offered |
| Demo overview and runs | MOCK demo |
| Connections, Rules, Settings | MOCK configuration demo: synthetic data, nothing connected, nothing sent — see `docs/PHASE2_UI.md` |

## Project layout

```
src/
  research/   TypeScript mirror of model.py output + state-precedence mirror (no evaluation)
  mocks/      MOCK run envelope, deterministic fixture builders, consistency validator
  adapters/   wire / research shapes → view models (no verdict is computed)
  domain/     View-model types: runs, history, evidence integrity, the four status axes
  data/       contract/ (wire mirrors of the frozen v1, history and lookup contracts), local/ and history/ (LOCAL_RESEARCH
              providers and decoders), workspace/ (archive index, live-vs-archive comparison), MOCK store and demo configuration
  lib/        hash router, read lifecycles (useProviderRead, useHistoryList, useLiveCases), theme and preferences
  components/ ui · shell · states · integrity · detail · history · local · workspace · charts · runs
  pages/      Workspace (Overview, Verifications, Capture), VerificationDetail, History, Settings, Rules, Connections, States, demo pages
  styles/     tokens.css (design tokens), index.css (Tailwind theme mapping)
  test/       Vitest suites and their fixtures; browser suites live in e2e*/
server/       localApiGate.ts — the dev/preview gate to the local Service
docs/         design system, information architecture, product understanding, Phase 2 / 2.5 / 3A reports and evidence
```

Round reports, screenshots and test evidence for this workspace are in `../docs/product-dev/`.

Stack: React 19, TypeScript (strict), Vite 8, Tailwind CSS 4, lucide-react, self-hosted fonts (Instrument Serif,
Instrument Sans, IBM Plex Mono via Fontsource; all SIL OFL 1.1). The design lab (`lab.html`) additionally uses Inter
Tight, Martian Mono, Inter and Newsreader. No router, UI-kit or animation library was added: a small hash router and
native semantics were sufficient.

## Known limitations

1. **All data is synthetic.** The five reviewed cases are synthetic fixtures shipped with the Service; MOCK names,
   emails, run IDs, times and digests are demo values.
2. **Email comparison is a proposed rule, MOCK only.** The evaluator compares only `phone`; the demo tags its email rule
   "Proposed rule". LOCAL_RESEARCH pages show exactly the rules the evaluator returned.
3. **"Verified" is not authenticated.** Internally consistent fabricated evidence would still be Verified under the
   current contract; an integrity "verified" is internal consistency of values the Service supplied, never a claim of
   authentic external acquisition.
4. **No actions.** Capture, admission, acknowledgement, recheck, alerts and links into HubSpot are absent because
   nothing could perform them.
5. **Review coverage.** Automated axe checks, keyboard checks and responsive checks run in Chrome and WebKit; Firefox and
   screen readers are not tested.
6. The research project is not production-ready: its release is blocked pending independent review.
