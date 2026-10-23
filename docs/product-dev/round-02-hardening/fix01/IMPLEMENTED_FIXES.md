# FIX01 — implemented fixes

Commits on `product-dev/round-02-hardening` (parent `1d52026`):

| Commit | Content |
| --- | --- |
| `14a0b77c65ea3e4b897d8ed7a2efb97b261547fd` | All fixes below except the pre-check correction |
| `af65bf4d13492a65d64dc699adfc4de1bd36b693` | Regression port pre-check decides on `lsof` output (F15, F19) |
| this report's commit | Reports and evidence only (`docs/product-dev/round-02-hardening/fix01/`) |

Unchanged: the pinned Evaluator, the four contracts, the 39-file backend map (`a5d68b75…4b45`, `check_identities.py` problems `[]`),
every file of the accepted backend (including `tests/test_service.py::test_protected_repository_integrity` and its assertion),
`service/evidence/protected-before.json` and its pinned digest `a12bc4b2…`, the accepted harness scripts under `ui/scripts/`,
all application source. No custom-baseline logic was added or changed (`baseline_path()` untouched).

## A. Portable tests vs historical custody (F02, F03, F18)

- `scripts/dev/protected_custody.sh` (new): runs only the restored custody test, unchanged, under `FLOWASSERT_PROTECTED_PARENT`
  (default: the checkout's parent). It first lists every root named in `protected-before.json`; if any is missing or
  unreadable it prints them and exits **77 = BLOCKED** without running anything. Nothing is substituted.
- `regression.sh`: `backend-pytest` deselects that one test and writes JUnit XML; new gate `protected-custody`.
  Gate status `PASS` / `BLOCKED` (77) / `FAIL`; overall exit 0 pass, 1 fail, **3 = blocked gates, not a pass**.
  New `--portable` mode runs only the self-contained gates (+ custody, which reports BLOCKED where roots are absent).

## B. Frontend false green (F04–F07)

- `ui/src/test/fixtures/sources.ts` (new) `requiredFixture(env, repoPath)`: resolves a fixture inside the repository (or the
  `FLOWASSERT_*` override) and throws if it is missing.
- Contracts and history examples: the Service's own pinned copies in `service/contracts/` (byte-identical to the accepted
  originals; cross-checked, see CLEAN_CLONE_PROOF). Contract paths moved to `contract/fixtures.ts`.
- Phase 2 handoff bodies: **50 files vendored, with the Owner's approval in this session**, into
  `ui/src/test/fixtures/phase2-handoff/http/` (248 KB; synthetic cases SPEC-001..005, loopback URLs only, no credentials).
  Each was copied byte for byte and checked against the accepted handoff manifest
  (`FlowAssert-Phase2-Support/evidence/artifact-manifest.json`, SHA-256 `e5c8f018…a818`, also recorded by
  `FlowAssert-Phase2-Review/evidence/source-integrity/snapshot-final.json`). Per-file digests: `phase2-handoff/SOURCE.json`.
  `fakeService.ts` resolves the copy on first read, so a missing copy fails exactly the tests that read it.
- 46 of the 47 `describe.skipIf`/`it.skipIf` presence guards and their `present ? … : …` fallbacks removed (17 files; the one
  kept is the optional audit replay below); the silent
  `if (existsSync(HISTORY_CONTRACT))` assertion is unconditional (F06).
- `fixture-identity.test.ts` (new, 5 tests): whichever copy a run uses must equal the accepted backend source map
  (contracts, history examples) or the handoff manifest (bodies, exact file set).
- Kept optional, explicitly: replay of the independent UI audit's 12 mutant files (`FlowAssert-UI-Review/…/mutants`,
  `FLOWASSERT_DRIFT_MUTANTS`) — historical evidence outside the repository. Absent or unreadable → one skipped test,
  reported **NOT RUN** by the inventory check. The 79 in-repo drift-sensitivity mutations always run.

## C. Inventory guard (F07)

- `scripts/dev/test-inventory.json` (new): 36 Vitest files with exact required counts (1610 required + 13 optional), 247 portable
  backend tests, the custody test's node ID.
- `scripts/dev/check_test_inventory.py` (new, stdlib, runs under the system Python): FAIL on a missing, unlisted or unloadable
  suite, a changed count, or any skipped/failed required test; optional group → RAN / NOT RUN. Gates `backend-inventory` and
  `ui-vitest-inventory`. Run against the original false-green report it reports 98 problems.

## D. Reliability (F08–F16)

| Finding | Change |
| --- | --- |
| F08 directory symlinks | `protected_integrity.snapshot()` also records `link:<target>` for directory symlinks (not followed). Real directories add no entry, so maps of trees without directory symlinks are unchanged — the custody test still passes on the genuine roots. |
| F09 venv version | Existing `service/.venv` must run Python 3.14, else `py-env` exit 21 "remove service/.venv and rerun". |
| F10 partial seed | `seed.sh` verifies every state, new or existing, with the Service's read-only `check` (SQLite `mode=ro`; state unchanged, verified by stat) and the exact count (dev-main 10, dev-single 5, dev-empty 0); otherwise exit 3. |
| F11 partial harness | Bootstrap keeps a harness runtime only if it recorded completing it (`.dev-runtime/bootstrap/harness-<name>.complete`, removed before a rebuild); otherwise exit 31. **Effect on an existing workspace:** runtimes built before this change have no record, so `--harness` asks to remove and rebuild them once. |
| F12 system Python | Declared; `FA_SYSTEM_PYTHON` (default `/usr/bin/python3`) checked in `tools` (exit 17). `curl` declared and checked (exit 18). |
| F13 harness sources | Declared in the header; pre-checked before anything is written: **BLOCKED**, exit 30, listing each unreadable source and pointing to `--portable`. |
| F14, F16 probe gate | `scripts/dev/rules_cls_probe.sh` (new): refuses an occupied 4184, starts `vite preview` directly, proves the listener PID is that process and that it serves this build's `dist/index.html`, stops only that PID. |
| F15, F19 pre-check | Full mode checks 4183, 4184, 5183 and 8765, deciding on listed PIDs (`lsof -t -iTCP:4183,4184,5183,8765`), not exit status. |

Also: `README.md` run/verify sections updated (bootstrap, `--portable`, statuses, the two non-portable checks).
New `scripts/dev/tests/test_dev_scripts.py` (9 tests, gate `dev-scripts`): symlink add/retarget/remove, real dirs and file links
unchanged, missing root raises; inventory checker accepts complete runs, reports NOT RUN, fails skipped/missing/unlisted/unloaded
suites and a custody test inside the portable gate.
