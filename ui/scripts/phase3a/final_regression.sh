#!/bin/sh
# Phase 3A final regression: runs each gate once, logs it, and records the exact command and exit code.
# Output: docs/phase3a/evidence/runs/<RUN>/<n>-<name>.log and commands.json (RUN defaults to "final").
# Does not stop on failure. Accepted Phase 2 evidence is never written: the Phase 2 real-service suite is
# redirected with FA_E2E_EVIDENCE_DIR, and MOCK screenshot capture is not enabled.
set -u
UI="$(cd "$(dirname "$0")/../.." && pwd)"
RUN="${1:-final}"
OUT="$UI/docs/phase3a/evidence/runs/$RUN"
mkdir -p "$OUT" "$UI/.phase3a-tmp"
cd "$UI"
export TMPDIR="$UI/.phase3a-tmp"
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
run listeners-before "lsof -nP -iTCP:8765 -iTCP:5183 -iTCP:4183 -iTCP:4184 -sTCP:LISTEN && exit 1 || echo 'no listener on 8765/5183/4183/4184'"
run typecheck "npx tsc -b"
run lint "npm run lint"
run build "npm run build"
run fixtures "npm run test:fixtures"
run unit "npm test"
run contract-drift-phase2 "npx vitest run src/test/contract-drift.test.ts src/test/contract-drift-mutations.test.ts src/test/contract-drift-runtime.test.ts"
run contract-drift-history "npx vitest run src/test/history-contract-drift.test.ts"
run unit-phase3a "npx vitest run src/test/phase3a-ids.test.ts src/test/phase3a-canonical.test.ts src/test/phase3a-integrity.test.ts src/test/phase3a-gate.test.ts src/test/phase3a-history-decode.test.ts src/test/phase3a-history-provider.test.ts src/test/phase3a-history-pages.test.tsx"
run e2e-mock-chrome-webkit "FA_BROWSERS=chrome,webkit npm run test:e2e"
run e2e-mock-firefox "FA_BROWSERS=firefox npm run test:e2e"
run e2e-phase2-local-chrome-webkit-firefox "FA_E2E_EVIDENCE_DIR=$UI/docs/phase3a/evidence/regression/phase2-e2e FA_BROWSERS=chrome,webkit,firefox npm run test:e2e:local"
run e2e-history-chrome-webkit-firefox "FA_BROWSERS=chrome,webkit,firefox npm run test:e2e:history"
run listeners-after "lsof -nP -iTCP:8765 -iTCP:5183 -iTCP:4183 -iTCP:4184 -sTCP:LISTEN && exit 1 || echo 'no listener on 8765/5183/4183/4184'"
printf '\n]\n' >> "$JSON"
