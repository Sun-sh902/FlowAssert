#!/bin/sh
# Phase 2 final regression: runs each gate once, logs it, and records the exact command and exit code.
# Output: docs/phase2/evidence/runs/final/<n>-<name>.log and commands.json. Does not stop on failure.
set -u
UI="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$UI/docs/phase2/evidence/runs/final"
mkdir -p "$OUT"
cd "$UI"
JSON="$OUT/commands.json"
printf '[\n' > "$JSON"
n=0
run() {
  name="$1"; shift
  n=$((n + 1))
  log="$OUT/$(printf '%02d' $n)-$name.log"
  start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  sh -c "$*" > "$log" 2>&1
  code=$?
  end=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  [ $n -gt 1 ] && printf ',\n' >> "$JSON"
  printf '  {"n": %d, "name": "%s", "command": "%s", "exit": %d, "started": "%s", "finished": "%s", "log": "%s"}' \
    $n "$name" "$(printf '%s' "$*" | sed 's/"/\\"/g')" $code "$start" "$end" "$(basename "$log")" >> "$JSON"
  echo "$name exit=$code"
}
run typecheck "npx tsc -b"
run lint "npm run lint"
run build "npm run build"
run fixtures "npm run test:fixtures"
run unit "npm test"
run contract-drift "npx vitest run src/test/contract-drift.test.ts src/test/contract-drift-mutations.test.ts src/test/contract-drift-runtime.test.ts"
run e2e-chrome-webkit "FA_BROWSERS=chrome,webkit npm run test:e2e"
run e2e-firefox "FA_BROWSERS=firefox npm run test:e2e"
run e2e-local-chrome-webkit-firefox "FA_BROWSERS=chrome,webkit,firefox npm run test:e2e:local"
run service-listener-after "if lsof -nP -iTCP:8765 -sTCP:LISTEN; then exit 1; else echo 'no listener on 8765'; fi"
printf '\n]\n' >> "$JSON"
