#!/bin/sh
# Product round 01 — every gate, in order, each logged with its exit code.
#   scripts/dev/regression.sh LABEL
# Writes docs/product-dev/evidence/regression/LABEL/{<gate>.log, summary.tsv}. Refuses to reuse a label.
# Needs: seeded workspace states (scripts/dev/seed.sh) and the accepted-harness runtimes
#   (ui/scripts/phase3a/prepare_runtime.py + seed_states.py + evaluator_oracle.py,
#    ui/scripts/phase3a/prepare_lookup_runtime.py, ui/scripts/phase2/prepare_runtime.py).
# Ports 5183 and 8765 must be free: the browser suites own their servers.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="${1:?usage: regression.sh LABEL}"
OUT="$ROOT/docs/product-dev/evidence/regression/$LABEL"
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
# test_protected_repository_integrity is bound to the ORIGINAL checkout location (it walks sibling repositories
# through ROOT.parent and reads evidence/protected-before.json, a historical evidence tree not copied here).
# Custody of the protected roots is checked separately for this round (docs/product-dev/ROUND_01_REPORT.md).
gate backend-pytest "$SVC" env LC_ALL=C PYTHONDONTWRITEBYTECODE=1 TMPDIR="$SVC/.runtime/tmp" \
  .venv/bin/python -B -m pytest -p no:cacheprovider --basetemp="$SVC/.runtime/tmp/regression-$LABEL" -q tests \
  --deselect tests/test_service.py::test_protected_repository_integrity
gate pinned-identities "$ROOT" /usr/bin/python3 -I -B scripts/dev/check_identities.py
gate ui-typecheck "$ROOT/ui" npx tsc -b
gate ui-lint "$ROOT/ui" npx oxlint
gate ui-vitest "$ROOT/ui" npx vitest run
gate e2e-static "$ROOT/ui" npx playwright test
gate e2e-workspace "$ROOT/ui" env FA_BROWSERS=chrome,webkit npx playwright test -c playwright.workspace.config.ts
gate e2e-history "$ROOT/ui" npx playwright test -c playwright.history.config.ts
gate e2e-lookup "$ROOT/ui" npx playwright test -c playwright.lookup.config.ts
gate e2e-local "$ROOT/ui" npx playwright test -c playwright.local.config.ts
echo "summary: $OUT/summary.tsv"
exit $FAIL
