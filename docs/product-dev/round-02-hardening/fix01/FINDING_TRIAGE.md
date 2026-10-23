# FIX01 — finding triage

Starting point: `product-dev/round-02` at `1d52026683c22c2e69542084cf889774d507cd7e` (Round 02 closeout), parent
`86bec5554688fb5bbe02a376c76c1017e40352cf` (implementation), tag `phase3a-baseline` → `e11f4d56589ca7fa9361ef31012733f92a630d0b`.
No newer commit existed. Every reproduction ran in a disposable clone recovered from a Git bundle, outside
`~/Documents`, unless marked otherwise. "Siblings unreadable" = `evidence/repro/nosib` (macOS `sandbox-exec` denying every
read/write under `/Users/zhangshenghe/Documents`: reads fail with EPERM). "Siblings absent" = every fixture variable pointed
at a nonexistent path (ENOENT, what another machine sees).

Evidence paths are relative to `evidence/`. `before-1d52026/` = original code, `after-14a0b77/` and `final-af65bf4/` = fixed.

## Sources of findings

| Source | Status |
| --- | --- |
| `ROUND_02_REPORT.md`, `REGRESSION_RESULTS.md`, `KNOWN_LIMITATIONS.md` (B1–B8), Round 02 fresh-clone evidence | Read. B3, B4, B7 are triaged below; B1, B2, B5, B6 are browser/evidence items for FIX02; B8 is unchanged (see REMAINING_RISKS). |
| The Owner's two independent audit reports | **BLOCKED — not available locally.** `/Users/zhangshenghe/Documents/FlowAssert-Product-Review/` does not exist; no Round 02 audit report was found under `~/Documents`, `~/Downloads`, `~/Desktop` (searched 2026-10-23). The findings below are the FIX01 brief's list plus what verification found; none is claimed to close an audit item by number. |
| Current scripts and tests | Read and executed. |

## Session state found at start

A previous session (same task, interrupted by an API authentication error at 00:43) had created
`product-dev/round-02-hardening` at `1d52026`, the bundle `.dev-runtime/recovery/flowassert-product-dev-pre-fix01-1d52026.bundle`,
and left one uncommitted edit (`service/scripts/protected_integrity.py`, directory symlinks). No process held files in the
repository. I re-verified the bundle (SHA-256 `8bf0946b…fa5a`, `git bundle verify` OK, 5 refs), reproduced every finding myself
before accepting the edit, and built on that branch. No commit was reset, rebased or amended.

## Findings

| ID | Finding | Disposition | Source location | Actual behavior (before) | Reproduction | Exit | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F01 | No verified recoverable backup | **CONFIRMED** (off-device: **BLOCKED**) | `git remote -v` (empty); `tmutil destinationinfo` | No remote; Time Machine "No destinations configured"; iCloud Drive sync disabled. No bundle existed before this task. | see BACKUP_AND_RECOVERY.md | — | `after-14a0b77/fsck.out`, `ref-match.txt` |
| F02 | Backend regression gate mixes portable tests with the historical custody check | **CONFIRMED** | `scripts/dev/regression.sh:34-35` (round 02) | Clean clone, siblings unreadable: 247 passed, 1 failed (`FileNotFoundError: protected root …/FlowAssert-round03-oracle-fix is missing`); gate exit 1 | `nosib env … FLOWASSERT_PROTECTED_PARENT=<clone parent> .venv/bin/python -m pytest tests` | 1 | `before-1d52026/pytest-gate.out` |
| F03 | Round 02 "fresh-clone" regression does not prove portability | **CONFIRMED** | `round-02/REGRESSION_RESULTS.md:8-9` | The run used `FLOWASSERT_PROTECTED_PARENT=/Users/zhangshenghe/Documents` and the fixture defaults (absolute sibling paths) on the original machine; F02/F04/F05 show the same commit fails or false-greens without the siblings | as F02, F04 | — | `before-1d52026/*` |
| F04 | **Vitest false green** when sibling folders are absent | **CONFIRMED** | `ui/src/test/local/fakeService.ts:12-13`, `fakeHistoryService.ts:13-14`, `contract/fixtures.ts:7`, `history-contract-drift.test.ts:25`, `lookup-contract-drift.test.ts:23,25` (absolute defaults) + 47 `describe.skipIf`/`it.skipIf` guards in 17 files | Exit **0**: 1606 tests, 809 passed, **797 skipped**; the 12 audit-mutant tests not even collected (1618 with siblings) | `nosib env FLOWASSERT_*=/nonexistent/… npx vitest run` | 0 | `before-1d52026/vitest-siblings-absent.summary.txt`, `inventory-check-of-siblings-absent-run.txt` (98 problems) |
| F05 | Same suites when siblings exist but are unreadable | **CONFIRMED** | same | Exit 1: only 870 tests collected, 66 failed, 11 files failed to load (EPERM); `existsSync` true but read denied | `nosib npx vitest run` | 1 | `before-1d52026/vitest-siblings-unreadable.summary.txt` |
| F06 | Silent conditional assertion | **CONFIRMED** | `ui/src/test/lookup-contract-drift.test.ts:97` | `if (existsSync(HISTORY_CONTRACT)) expect(…)` — the history digest check is skipped without a trace when the file is absent | inspection; covered by F04 run | — | source line |
| F07 | No mandatory test inventory | **CONFIRMED** | `scripts/dev/regression.sh` (round 02) | Gates used only the runner's exit code; skipped or uncollected tests counted as green (F04) | F04 | 0 | `before-1d52026/inventory-check-of-siblings-absent-run.txt` |
| F08 | Directory symlink blind spot in the protected-integrity snapshot | **CONFIRMED** | `service/scripts/protected_integrity.py:29-32` (round 02) | `os.walk(followlinks=False)` lists a directory symlink in `dirs`, never in `names`: adding, retargeting or removing one changed nothing | `.venv/bin/python -I -B repro/symlink.py service <tmp>` | 1 | `before-1d52026/symlink.out` |
| F09 | Existing venv's Python version not checked | **CONFIRMED** | `scripts/dev/bootstrap.sh:53-54` (round 02) | A Python **3.12** `service/.venv` with the exact lock: `BOOTSTRAP OK` (Service requires 3.14) | `repro/venv.sh <clone>` | 0 | `before-1d52026/venv.out` |
| F10 | Incomplete synthetic seed accepted | **CONFIRMED** | `scripts/dev/seed.sh:24-29` (round 02) | `dev-main` interrupted after `seed` (5 evaluations, `--reevaluate` never ran): `seed.sh` "all states exist; nothing written" (0); bootstrap "dev-main (10 evaluations)" OK | `repro/seed.sh <clone>` | 0 | `before-1d52026/seed.out` |
| F11 | Incomplete harness runtime accepted | **CONFIRMED** | `scripts/dev/bootstrap.sh:79` (round 02) | Empty `ui/.phase3a-runtime/FlowAssert-Phase3A-Service` (0 files): "exists — kept", "harness runtimes ready", exit 0 | mkdir it, `bootstrap.sh --harness` (siblings present) | 0 | `before-1d52026/harness-partial.out` |
| F12 | Undeclared `/usr/bin/python3` dependency; misleading failure | **CONFIRMED** | `scripts/dev/bootstrap.sh:69,80-88`, `regression.sh:36` (round 02) | Not in the declared tools. Without it: `/usr/bin/python3: Operation not permitted`, reported as "the workspace no longer matches the accepted pinned identities" | `repro/nosyspy.sh <clone>` | 126 | `before-1d52026/nosyspy.out` |
| F13 | `--harness` needs sibling sources at absolute paths; fails mid-stage with a traceback | **CONFIRMED** (known: KNOWN_LIMITATIONS B3) | `ui/scripts/phase3a/prepare_lookup_runtime.py:25`, `ui/scripts/phase2/prepare_runtime.py:21-23` | `PermissionError` traceback after `ui/.phase3a-runtime` was already written | `nosib bootstrap.sh --harness` | 1 | `before-1d52026/harness.out` |
| F14 | Rules CLS probe gate measures whatever listens on 4184 | **CONFIRMED** | `scripts/dev/regression.sh:43-46` (round 02) | Unrelated page on 127.0.0.1:4184: `--strictPort` failure hidden in a background job; 30 loads of the unrelated page measured, CLS 0, gate **exit 0** | `repro/port.sh <clone> <out>` | 0 | `before-1d52026/port.out` |
| F15 | Regression port pre-check ineffective | **CONFIRMED** | `scripts/dev/regression.sh:15` (round 02) | Listed only 5183/8765 (4183 and 4184 also used). And `lsof` with several `-i` selectors exits 1 when any one is unmatched, so with only 5183 taken the check said "free" | listener on 5183, the round 02 `if lsof …` line | — | `before-1d52026/port-precheck.out` |
| F16 | `pkill -f 'vite preview --port 4184'` can stop an unrelated process | **CONFIRMED** (known: B7) | `scripts/dev/regression.sh:45` (round 02) | A process whose command line contains that text was killed | `final-af65bf4/port-use-checks.txt` | — | same |
| F17 | Dev server / Service port conflict detection | **FALSE_POSITIVE** (already correct) | `ui/vite.config.ts:79` (`strictPort: true`), `scripts/dev/service.sh:11-13` | 5183 occupied: `npm run dev` → "Port 5183 is already in use", exit 1. 8765 occupied: `service.sh` refuses, exit 1. Playwright configs: `strictPort` + `reuseExistingServer: false` (inspection) | see evidence | 1 / 1 | `final-af65bf4/port-use-checks.txt` |
| F18 | B4: restored integrity test needs `FLOWASSERT_PROTECTED_PARENT` | **CONFIRMED**, resolved by separation (F02) | `service/scripts/protected_integrity.py:10` | Default parent = this checkout's parent; absent roots → loud `FileNotFoundError` (correct, not silent) — but it failed the whole backend gate | F02 | 1 | `before-1d52026/pytest-gate.out` |
| F19 | My own first fix (`14a0b77`) kept the `lsof` exit-status flaw | **CONFIRMED** during verification, **fixed in `af65bf4`** | `scripts/dev/regression.sh` at `14a0b77` | With only 4184 taken, full mode ran every gate; the probe gate itself refused (second line of defence) | listener on 4184, `regression.sh LABEL` | 1 | `after-14a0b77/precheck-defect-run/` |

Not reproduced, not claimed: none. Browser failures B1/B2/B5 (F15 capture-after-close) are **out of scope** (FIX02) and
were not run as a regression verdict.
