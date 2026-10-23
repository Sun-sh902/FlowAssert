# FIX02 — Rules CLS verification

**Disposition: ALREADY_FIXED.** The Round 02 fix (`86bec55`, metric-matched fallback faces in `ui/src/styles/index.css`)
holds on this machine today. No layout, font or CSS file was changed in FIX02. Threshold unchanged: CLS < 0.1.

## History

| When | Run | Result |
| --- | --- | --- |
| Round 01 | `docs/product-dev/evidence/regression/round01-final/e2e-static.log` | perf.spec `rules` **0.137** — FAIL |
| Round 02 before fix | `round-02/evidence/rules-cls/before-30.json` | 30/30 cold loads 0.137. Source: one shift at ~120 ms of the page head and the grid below it, coinciding with the web-font `loadingdone` |
| Round 02 after fix | `round-02/evidence/rules-cls/after-30.json`, `regression-fresh-clone/rules-cls-*` | 30/30 = 0; perf ×20 passed |

## Independent runs on d34f882 (unmodified clean clone, before any FIX02 change)

Environment: macOS 27.2 (Darwin arm64) · Node 26.10.0 · Playwright 1.63.0 · **Google Chrome 156.0.8078.47** (channel
`chrome`, the browser every suite uses; Playwright's bundled Chromium r1243 is not installed and not used) · WebKit 26.6
(r2359) · viewport 1440×900 · `vite preview` production build.

| Check | Command (in `ui/`) | Workers | Cache | Result |
| --- | --- | ---: | --- | --- |
| Regression gate `rules-cls-repeat` | `npx playwright test e2e/perf.spec.ts --repeat-each=20` | 5 (default) | one page per repeat: first route cold, `#/rules` (5th route) warm | **20/20 passed** |
| Same, no concurrency | `… --repeat-each=20 --workers=1` | 1 | same | **20/20 passed** |
| Regression gate `rules-cls-probe` | `../scripts/dev/rules_cls_probe.sh OUT.json` | 1 | new context per load → **cold** | **30/30 CLS = 0**, 0 shift entries |
| Full static suite (CLS under load) | `FA_BROWSERS=chrome,webkit npx playwright test` | 5 | — | **136 passed, 24 declared skips**, 0 failed |

Evidence: `evidence/before-d34f882/cls/` (`json-report-stats.tsv` carries each report's worker count, projects and start time).

Measurement details from the cold probe (30 loads): first contentful paint median 64 ms (60–332). The fonts
`loadingdone` event comes at a median of 57 ms, and includes the three fallback faces ("Instrument Serif Fallback" normal
and italic, "Instrument Sans Fallback"). Layout-shift entries: none.

Font readiness: perf.spec waits for `document.fonts.ready` and 500 ms before reading CLS; the probe waits 800 ms after
load and records every `layout-shift` entry with its sources and every `loadingdone` event, so a regression is
attributed, not guessed. Navigation timing: each route is loaded from `about:blank`, never as a same-document hash change.

Page errors: the Round 02 tooling did not record them (FIX02 finding G07). The FIX02 regression run records them per
perf repeat and per probe load. All were empty; see `REGRESSION_SUMMARY.tsv`.

## Negative control — is the measurement still sensitive?

In the scratch clone only, the two fallback families were removed from `--font-sans` / `--font-display`
(`evidence/before-d34f882/cls-negative-control/control.diff`, reverted afterwards; clone status clean):

| Check | Result |
| --- | --- |
| Cold probe, 30 loads | **30/30 CLS = 0.137**, gate exit 1. Same sources as Round 01/02: `div.grid…` 375→343, `div.min-w-0` (page head) 242→200 px tall, `section` Rule register 117→85 |
| perf.spec ×5 | **4 failed (0.137), 1 passed** |

So the probe and the threshold still detect the original defect on Chrome 156. The warm-cache perf test is weaker: it
missed the regression in 1 of 5 repeats. That is why the cold-load probe remains a separate gate.

## Report identity and custody (changed in FIX02 — reporting only)

- perf.spec wrote one file `e2e/.output/perf-<browser>.json` for all 20 parallel repeats (each overwrote the last), with
  no browser version, repeat or page-error record, into a directory that keeps stale files from earlier runs. It now
  writes `perf-<browser>[-repeatN].json` with project, browser version, repeat index, viewport, cache description and
  page errors. Under the regression, it writes into the run's own directory (`FA_STATIC_REPORT_DIR`).
- A page error on the measured page now fails perf.spec (soft assertion) and the probe gate, since a page that failed to
  render cannot shift (CLS would read a false 0). Proof: an injected error on `#/rules` passed at d34f882 (exit 0, not
  recorded) and fails after the change, naming the error (`before-d34f882/perf-page-error/`, `after-helper-fix/perf-page-error/`).
- `transferredKB` is unchanged. It counts bytes over the network only (cached resources report 0), so after the first
  route it is not a page weight. That is now stated in perf.spec's header; no current document relies on it.
