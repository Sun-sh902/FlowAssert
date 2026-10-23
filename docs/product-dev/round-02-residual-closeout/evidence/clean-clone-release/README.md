Clean clone of `f287274e70b1a7436741275db7306afae43e942e` (git clone --no-hardlinks, detached, fsck --full --strict 0,
0 status lines), after the sandboxed product run. Unsandboxed, FLOWASSERT_PROTECTED_PARENT=/Users/zhangshenghe/Documents.

1. `scripts/dev/bootstrap.sh --harness` → exit 1 at stage harness: `prepare_lookup_runtime.py` reported
   ".venv differs from original" because Finder created `FlowAssert-Phase3A-Service/.venv/.DS_Store` at 11:29:31
   (the copy skips `.DS_Store`, the comparison of the original does not). The ID-lookup runtime was copied but never
   certified; the Phase 2 runtime was never prepared.
2. `scripts/dev/regression.sh clean-release-f287274` (run anyway, chained) → exit 1: 23 PASS, 3 FAIL.
   - protected-custody FAIL: the ten Finder `.DS_Store` files in four protected roots (protected-custody.log).
   - e2e-local / e2e-local-inventory FAIL: `ui/.phase2-runtime` absent (step 1); the inventory fails the unexecuted tests.
   - e2e-lookup PASS on the uncertified runtime from step 1. NOT counted as release evidence.
   - Every product gate PASS, including responsive-matrix 200/200 and tracked-evidence.
