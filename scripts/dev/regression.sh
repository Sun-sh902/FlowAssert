#!/bin/sh
# Every product-workspace gate, in order, each logged with its exit code.
#   scripts/dev/regression.sh LABEL
# Writes $FA_REGRESSION_DIR/LABEL/{<gate>.log, summary.tsv} (default docs/product-dev/evidence/regression).
# Refuses to reuse a label.
# Needs: scripts/dev/bootstrap.sh --harness (dependencies, seeded workspace states, accepted-harness runtimes).
# Firefox is not run: the accepted F15 Firefox test-harness defect is documented and unfixed.
# Ports 5183 and 8765 must be free: the browser suites own their servers.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="${1:?usage: regression.sh LABEL}"
OUT="${FA_REGRESSION_DIR:-$ROOT/docs/product-dev/evidence/regression}/$LABEL"
[ -e "$OUT" ] && { echo "refusing to reuse $OUT" >&2; exit 1; }
mkdir -p "$OUT"
if lsof -nP -iTCP:8765 -iTCP:5183 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ports 5183/8765 must be free (stop the dev server and Service)" >&2; exit 1
fi
printf 'gate\texit\tstarted_utc\tcommand\n' > "$OUT/summary.tsv"
FAIL=0
gate() {
  name="$1"; dir="$2"; shift 2
  start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ( cd "$dir" && "$@" ) > "$OUT/$name.log" 2>&1
  rc=$?
  printf '%s\t%s\t%s\t%s\n' "$name" "$rc" "$start" "$*" >> "$OUT/summary.tsv"
  printf '%-22s exit %s\n' "$name" "$rc"
  [ "$rc" -eq 0 ] || FAIL=1
}
SVC="$ROOT/service"
mkdir -p "$SVC/.runtime/tmp" && chmod 700 "$SVC/.runtime" "$SVC/.runtime/tmp"
# test_protected_repository_integrity (round 02: restored) compares the accepted protected roots, named in
# service/evidence/protected-before.json (pinned digest a12bc4b2…), under an EXPLICIT parent directory.
PROTECTED_PARENT="${FLOWASSERT_PROTECTED_PARENT:-$(dirname "$ROOT")}"
gate backend-pytest "$SVC" env LC_ALL=C PYTHONDONTWRITEBYTECODE=1 TMPDIR="$SVC/.runtime/tmp" FLOWASSERT_PROTECTED_PARENT="$PROTECTED_PARENT" \
  .venv/bin/python -B -m pytest -p no:cacheprovider --basetemp="$SVC/.runtime/tmp/regression-$LABEL" -q tests
gate pinned-identities "$ROOT" /usr/bin/python3 -I -B scripts/dev/check_identities.py
gate ui-typecheck "$ROOT/ui" npx tsc -b
gate ui-lint "$ROOT/ui" npx oxlint
gate ui-vitest "$ROOT/ui" npx vitest run
gate e2e-static "$ROOT/ui" env FA_BROWSERS=chrome,webkit npx playwright test
# Rules layout shift (round 02): the accepted perf test 20 times, then 30 cold-cache loads attributed by source.
gate rules-cls-repeat "$ROOT/ui" npx playwright test e2e/perf.spec.ts --repeat-each=20
gate rules-cls-probe "$ROOT/ui" sh -c "npx vite build >/dev/null && (npx vite preview --port 4184 --strictPort >/dev/null 2>&1 &); \
  for i in 1 2 3 4 5 6 7 8 9 10; do curl -s --noproxy '*' -o /dev/null http://127.0.0.1:4184/ && break; sleep 1; done; \
  node scripts/dev/cls-probe.mjs http://127.0.0.1:4184/ '#/rules' 30 '$OUT/rules-cls-probe.json'; rc=\$?; pkill -f 'vite preview --port 4184'; \
  node -e 'const r=require(process.argv[1]); process.exit(r.some(x=>x.cls>=0.1)?1:0)' '$OUT/rules-cls-probe.json' && exit \$rc"
gate e2e-workspace "$ROOT/ui" env FA_BROWSERS=chrome,webkit npx playwright test -c playwright.workspace.config.ts
gate e2e-history "$ROOT/ui" env FA_BROWSERS=chrome,webkit npx playwright test -c playwright.history.config.ts
gate e2e-lookup "$ROOT/ui" env FA_BROWSERS=chrome,webkit npx playwright test -c playwright.lookup.config.ts
gate e2e-local "$ROOT/ui" env FA_BROWSERS=chrome,webkit npx playwright test -c playwright.local.config.ts
echo "summary: $OUT/summary.tsv"
exit $FAIL
