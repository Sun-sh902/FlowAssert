# FIX01 — clean-clone proof

## Environment

- Clone recovered from `.dev-runtime/recovery/flowassert-product-dev-fix01-af65bf4.bundle` (SHA-256 `944a8038…fc4`) into
  `/private/tmp/claude-501/…/scratchpad/cr-final/FlowAssert-Product-Dev`. HEAD `af65bf4d13492a65d64dc699adfc4de1bd36b693`,
  `git fsck --full --strict` clean, clean working tree. The clone's parent directory contains only the clone
  (`final-af65bf4/parent-listing.txt`).
- Every run below, unless marked "genuine sources", ran under `evidence/repro/nosib`: all reads and writes under
  `/Users/zhangshenghe/Documents` denied, so no historical sibling folder, accepted source or this workspace is reachable.
- Run directories were outside the repository (`FA_REGRESSION_DIR=<scratchpad>/runs/<label>`); committed evidence was not written.
- macOS Darwin 27.2.0 arm64 · Node 26.10.0 · npm 11.19.1 · Python 3.14.7 · system Python 3.9.6 · uv 0.12.9 · git 2.56.0.
- The report commit adds only files under `docs/product-dev/round-02-hardening/fix01/`; code is identical to `af65bf4`.

## Results (af65bf4, siblings unreadable)

| Step | Command | Exit | Result | Evidence |
| --- | --- | ---: | --- | --- |
| Bootstrap | `nosib scripts/dev/bootstrap.sh` | 0 | tools, ui-deps (npm ci), py-env (37 distributions == lock), identity, fixtures (dev-main 10, dev-single 5, dev-empty 0, verified) | `final-af65bf4/bootstrap.out` |
| Portable regression | `nosib env FA_REGRESSION_DIR=… scripts/dev/regression.sh --portable fix01-final-nosiblings` | **3** | every portable gate PASS; `protected-custody` **BLOCKED**; verdict "INCOMPLETE — not a pass" | `final-af65bf4/regression-fix01-final-nosiblings/summary.tsv` |
| · backend-pytest | (gate) | 0 | 247 passed, 1 deselected (custody) | `…/backend-pytest.log` |
| · backend-inventory | (gate) | 0 | 247 portable, custody separate — OK | `…/backend-inventory.log` |
| · protected-custody | (gate) | 77 | BLOCKED: all 6 roots `FileNotFoundError` under the clone's parent; nothing substituted | `…/protected-custody.log` |
| · dev-scripts | (gate) | 0 | 9 passed | `…/dev-scripts.log` |
| · pinned-identities | (gate) | 0 | Evaluator, 4 contracts, backend map `a5d68b75…4b45`; problems `[]` | `…/pinned-identities.log` |
| · ui-typecheck, ui-lint | (gates) | 0, 0 | | `…/ui-typecheck.log`, `…/ui-lint.log` |
| · ui-vitest | (gate) | 0 | 36 files; **1610 passed, 1 skipped** (the optional audit replay) | `…/ui-vitest.log` |
| · ui-vitest-inventory | (gate) | 0 | OK; `NOT RUN … independent audit mutants` (category B) | `…/ui-vitest-inventory.log` |
| Custody, genuine sources | `FLOWASSERT_PROTECTED_PARENT=/Users/zhangshenghe/Documents scripts/dev/protected_custody.sh` (no sandbox) | 0 | 1 passed — unchanged assertion, symlink-aware snapshot | `final-af65bf4/custody-genuine.out` |

The same portable run on the first fix commit `14a0b77` gave the identical gate results (`after-14a0b77/regression-fix01-clean-clone-nosiblings/`).

## Fixture identity and negative controls (14a0b77 clone; fixture code identical in af65bf4)

| Check | Exit | Result | Evidence |
| --- | ---: | --- | --- |
| Vitest with every `FLOWASSERT_*` pointed at the accepted originals (genuine sources) | 0 | 1623/1623; audit replay RAN (13); inventory OK — the in-repo fixtures and the originals give identical results, and `fixture-identity.test.ts` passed against both | `after-14a0b77/vitest-xcheck-accepted.summary.txt` |
| Audit mutants absent (`FLOWASSERT_DRIFT_MUTANTS=/nonexistent`) | 0 | NOT RUN reported; inventory OK | `after-14a0b77/vitest-mutants-enoent.summary.txt` |
| Handoff copy missing (`FLOWASSERT_HANDOFF_HTTP=/nonexistent`) | 1 | 212 tests **fail** explicitly (0 skipped); inventory FAIL | `after-14a0b77/vitest-handoff-missing.summary.txt` |
| One byte appended to a vendored body | 1 | `fixture-identity` fails naming `SPEC-003-page-2.json` and both digests | `after-14a0b77/tamper.out` |

## Reliability fixes, replayed (same scripts as before; `evidence/repro/`)

| Check | Before (1d52026) | After |
| --- | --- | --- |
| Directory symlink add / retarget / remove | not detected, exit 1 | detected, exit 0 (`after-14a0b77/symlink.out`) |
| Python 3.12 venv | BOOTSTRAP OK | `py-env` exit 21 (`after-14a0b77/venv.out`) |
| dev-main interrupted after `seed` | accepted, "10 evaluations" | `seed.sh` exit 3 "5 archived evaluations, expected 10"; bootstrap `fixtures` exit 3 (`after-14a0b77/seed.out`) |
| Empty `.phase3a-runtime` (genuine sources) | exit 0 "harness runtimes ready" | exit 31, nothing further built (`final-af65bf4/harness-partial.out`); full build exit 0 with 3 completion records, rerun exit 0 "kept" (`harness-build.out`, `harness-rerun.out`) |
| `/usr/bin/python3` not executable | exit 126 "identities no longer match" | `tools` exit 17 naming the system Python (`after-14a0b77/nosyspy.out`) |
| `--harness` without sibling sources | `PermissionError` traceback after writing | exit 30 BLOCKED, four sources listed, no runtime written (`after-14a0b77/harness-blocked.out`) |
| Unrelated server on 4184, probe gate | measured it, exit 0 | refused, exit 1, nothing measured, unrelated server alive (`after-14a0b77/port-gate.out`) |
| One port of 4183/4184/5183/8765 taken, full regression | 5183 alone not detected | each alone refused, exit 1, no run directory (`final-af65bf4/port-precheck.out`) |
| Probe gate, port free (genuine Chrome) | — | measured its own pid, `dist/index.html` matched, 30/30 CLS 0, exit 0, no listener left (`final-af65bf4/rules-cls-probe.out`) |

## Protected sources

- Six Phase 3A custody roots (`docs/product-dev/evidence/custody/custody.py`, digest + mtime): map digests equal to the Round 01
  and Round 02 records (`final-af65bf4/phase3a-roots-custody.txt`).
- Six Phase 3A Service baseline roots (`protected-before.json`): custody test PASS on the genuine roots (above).
- No file, link or directory in any other `~/Documents/FlowAssert*` folder changed after 2026-10-23 00:20 EDT (`find -newermt`).
