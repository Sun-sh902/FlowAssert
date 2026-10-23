# FIX02 — browser provisioning

## What the suites actually launch

| Name in configs | Launch | Required by Playwright 1.63.0 (`node_modules/playwright-core/browsers.json`) | Found and launched here |
| --- | --- | --- | --- |
| `chrome` (all five configs, all regression gates) | `channel: "chrome"`: the **installed Google Chrome** | none (Chromium r1243 / 153.0.8010.12 is Playwright's bundled build, **not used** and not installed) | Google Chrome **156.0.8078.47** — launched, page loaded |
| `webkit` | Playwright WebKit | r**2359** (26.6); override r2251 only for mac14 | `~/Library/Caches/ms-playwright/webkit-2359` — **26.6** launched, page loaded |
| `firefox` | Playwright Firefox | r1543 (155.0) | `firefox-1543` — 155.0 **launches** a blank page here, but its suites were not run (below) |

Launch capability was verified by launching each browser, loading a page and reading the result — not from directory
names (`tools/launch-probe.mjs`, then `ui/scripts/dev/browser-probe.mjs`; `after-helper-fix/provisioning/browsers-ok.json`).

## Defect found (CONFIRMED — G11)

`scripts/dev/bootstrap.sh --harness` at d34f882 decided WebKit availability with
`ls "$HOME/Library/Caches/ms-playwright" | grep -q '^webkit'`, only printed a note, and never checked Google Chrome:

- any directory starting with `webkit` passed, whatever its revision;
- it inspected `$HOME/Library/Caches/ms-playwright`, while Playwright resolves `PLAYWRIGHT_BROWSERS_PATH` when set;
- a missing browser was a "note", and the note said WebKit suites "will not run". In fact the regression requests
  `FA_BROWSERS=chrome,webkit` and those tests **fail at launch**.

Reproduction (clean clone of d34f882, `PLAYWRIGHT_BROWSERS_PATH=<empty dir>`): bootstrap printed **BOOTSTRAP OK**, exit 0,
with no note at all. The same environment's WebKit perf test then failed with `browserType.launch: Executable doesn't
exist …/webkit-2359/pw_run.sh` (`before-d34f882/provisioning/`).

## Fix

- `ui/scripts/dev/browser-probe.mjs` launches **chrome (channel) and webkit as mandatory** and Firefox for information.
  It records Playwright's version, the revisions `browsers.json` requires, and each browser's version, user agent and
  executable, then exits 1 if a mandatory browser does not launch.
- `bootstrap.sh --harness` runs it after preparing the runtimes and stops with **exit 32** and an install hint. On
  success it prints both versions. Same reproduction after the fix: exit 32, naming WebKit
  (`after-helper-fix/provisioning/bootstrap-no-webkit.out`); with the real browsers: exit 0 (`bootstrap-ok.out`).
- `regression.sh` (full mode) runs the same probe as its first browser gate `browsers` and keeps `browsers.json` in the
  run directory, so every run records the exact browser versions it used.

Bootstrap and regression now agree: both require exactly `chrome` + `webkit`, the set every browser gate passes in
`FA_BROWSERS`. Mandatory coverage was not reduced.

## Firefox

**NOT RUN** — not mandatory, and not claimed. Firefox 155 (r1543) now launches a blank page on macOS 27.2 here, so the
old note "could not start" (`ui/playwright.config.ts` comment, Phase 2.5) no longer describes this machine. But no
Firefox suite was executed in FIX02, so the accepted F15 Firefox limitation has not been independently re-verified.
The capture-lifecycle fix addresses the mechanism F15 was attributed to, which makes a dedicated Firefox run a
reasonable next step (REMAINING_RISKS.md).
