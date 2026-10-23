#!/bin/sh
# FIX02 final verification: clean clone of the FIX02 commit, bootstrap --harness, affected suites repeated, full regression.
set -u
S="$1"; SHA="$2"; C="$S/c3"; L="$S/final"
mkdir -p "$L"
lsof -nP -iTCP:4183,4184,5183,8765 -sTCP:LISTEN > "$L/ports-before.txt" 2>&1
git clone -q /Users/zhangshenghe/Documents/FlowAssert-Product-Dev "$C" && cd "$C" && git checkout -q -B fix02-final "$SHA"
{ git rev-parse HEAD; git status --porcelain | wc -l; } > "$L/clone-head.txt"
scripts/dev/bootstrap.sh --harness > "$L/bootstrap.out" 2>&1; echo $? > "$L/bootstrap.exit"
cd ui
run() { # run ID ENV... -- config: one affected-suite run with JSON report and inventory
  id="$1"; gate="$2"; shift 2
  env PLAYWRIGHT_JSON_OUTPUT_NAME="$L/$id.json" "$@" --reporter=list,json --output="$L/artifacts/$id" > "$L/$id.log" 2>&1; rc=$?
  /usr/bin/python3 -I -B ../scripts/dev/check_test_inventory.py playwright "$gate" "$L/$id.json" > "$L/$id.inventory" 2>&1; irc=$?
  printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$gate" "$rc" "$irc" "$(grep -E '^\s+[0-9]+ (passed|failed|did not run|skipped|flaky)' "$L/$id.log" | tr -s ' ' | tr '\n' ' ')" >> "$L/affected.tsv"
}
printf 'run_id\tgate\texit\tinventory_exit\tcounts\n' > "$L/affected.tsv"
for i in 1 2 3 4 5; do run "fix02-affected-local-$i" e2e-local FA_BROWSERS=chrome,webkit FA_E2E_EVIDENCE_DIR="$L/ev/local-$i" npx playwright test -c playwright.local.config.ts; done
for i in 1 2 3; do run "fix02-affected-lookup-$i" e2e-lookup FA_BROWSERS=chrome,webkit FA_LOOKUP_EVIDENCE_DIR="$L/ev/lookup-$i" npx playwright test -c playwright.lookup.config.ts; done
run "fix02-affected-history-1" e2e-history FA_BROWSERS=chrome,webkit FA_HISTORY_EVIDENCE_DIR="$L/ev/history-1/e2e" npx playwright test -c playwright.history.config.ts
cd "$C"
git status --porcelain > "$L/status-after-affected.txt"
FLOWASSERT_PROTECTED_PARENT=/Users/zhangshenghe/Documents scripts/dev/regression.sh fix02-final-fd92903 > "$L/regression.out" 2>&1; echo $? > "$L/regression.exit"
git status --porcelain > "$L/status-after-regression.txt"
echo done > "$L/DONE"
