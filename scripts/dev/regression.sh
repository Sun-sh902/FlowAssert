#!/bin/sh
# Every product-workspace gate, in order, each logged with its exit code and status.
#   scripts/dev/regression.sh LABEL              all gates (needs scripts/dev/bootstrap.sh --harness)
#   scripts/dev/regression.sh --portable LABEL   self-contained gates only (needs scripts/dev/bootstrap.sh): backend,
#                                                identities, typecheck, lint, Vitest — plus the custody check, which
#                                                reports BLOCKED where the protected roots are absent
# Writes $FA_REGRESSION_DIR/LABEL/{<gate>.log, summary.tsv} (default docs/product-dev/evidence/regression).
# Refuses to reuse a label.
# Gate status: PASS (exit 0) · BLOCKED (exit 77: a required historical source is absent; the check did NOT run) · FAIL.
# Exit: 0 every gate passed · 1 any gate failed · 3 nothing failed but a gate was BLOCKED (not a pass).
# Round 02 hardening FIX01: the protected-source custody check is its own gate (scripts/dev/protected_custody.sh), not
# part of the portable backend tests; both test runners are checked against scripts/dev/test-inventory.json so a
# skipped or missing test cannot pass as green; the Rules probe owns and verifies its port.
# Firefox is not run: the accepted F15 Firefox test-harness defect is documented and unfixed.
# Full mode: ports 4183, 4184, 5183 and 8765 must be free — the browser suites and the probe own their servers.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORTABLE=0
[ "${1:-}" = "--portable" ] && { PORTABLE=1; shift; }
LABEL="${1:?usage: regression.sh [--portable] LABEL}"
SYS_PY="${FA_SYSTEM_PYTHON:-/usr/bin/python3}"
OUT="${FA_REGRESSION_DIR:-$ROOT/docs/product-dev/evidence/regression}/$LABEL"
[ -e "$OUT" ] && { echo "refusing to reuse $OUT" >&2; exit 1; }
# Decide on lsof's OUTPUT: with several -i selectors its exit status is 1 whenever any one is unmatched, so the
# round 02 status-based check passed unless every port was taken (FIX01).
if [ "$PORTABLE" -eq 0 ] && [ -n "$(lsof -nP -t -iTCP:4183,4184,5183,8765 -sTCP:LISTEN 2>/dev/null)" ]; then
  echo "ports 4183/4184/5183/8765 must be free (stop the dev server, previews and Service):" >&2
  lsof -nP -iTCP:4183,4184,5183,8765 -sTCP:LISTEN >&2; exit 1
fi
mkdir -p "$OUT"
printf 'gate\texit\tstatus\tstarted_utc\tcommand\n' > "$OUT/summary.tsv"
FAIL=0
BLOCKED=0
gate() {
  name="$1"; dir="$2"; shift 2
  start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ( cd "$dir" && "$@" ) > "$OUT/$name.log" 2>&1
  rc=$?
  case "$rc" in 0) status=PASS ;; 77) status=BLOCKED; BLOCKED=1 ;; *) status=FAIL; FAIL=1 ;; esac
  printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$rc" "$status" "$start" "$*" >> "$OUT/summary.tsv"
  printf '%-22s exit %-3s %s\n' "$name" "$rc" "$status"
}
SVC="$ROOT/service"
mkdir -p "$SVC/.runtime/tmp" && chmod 700 "$SVC/.runtime" "$SVC/.runtime/tmp"
# Portable backend tests: everything except the historical custody test, which needs the genuine protected roots.
gate backend-pytest "$SVC" env LC_ALL=C PYTHONDONTWRITEBYTECODE=1 TMPDIR="$SVC/.runtime/tmp" \
  .venv/bin/python -B -m pytest -p no:cacheprovider --basetemp="$SVC/.runtime/tmp/regression-$LABEL" -q \
  --deselect tests/test_service.py::test_protected_repository_integrity --junitxml="$OUT/backend-pytest.xml" tests
gate backend-inventory "$ROOT" "$SYS_PY" -I -B scripts/dev/check_test_inventory.py pytest "$OUT/backend-pytest.xml"
# Historical custody: the restored test, unchanged, against the accepted roots under FLOWASSERT_PROTECTED_PARENT
# (default: this checkout's parent). BLOCKED, never substituted, where they are absent.
gate protected-custody "$ROOT" scripts/dev/protected_custody.sh --basetemp="$SVC/.runtime/tmp/regression-$LABEL-custody"
gate dev-scripts "$ROOT" "$SVC/.venv/bin/python" -B -m pytest -p no:cacheprovider -q --basetemp="$SVC/.runtime/tmp/regression-$LABEL-dev" scripts/dev/tests
gate pinned-identities "$ROOT" "$SYS_PY" -I -B scripts/dev/check_identities.py
gate ui-typecheck "$ROOT/ui" npx tsc -b
gate ui-lint "$ROOT/ui" npx oxlint
gate ui-vitest "$ROOT/ui" npx vitest run --reporter=default --reporter=json --outputFile="$OUT/ui-vitest.json"
gate ui-vitest-inventory "$ROOT" "$SYS_PY" -I -B scripts/dev/check_test_inventory.py vitest "$OUT/ui-vitest.json"
if [ "$PORTABLE" -eq 0 ]; then
  gate e2e-static "$ROOT/ui" env FA_BROWSERS=chrome,webkit npx playwright test
  # Rules layout shift (round 02): the accepted perf test 20 times, then 30 cold-cache loads attributed by source.
  gate rules-cls-repeat "$ROOT/ui" npx playwright test e2e/perf.spec.ts --repeat-each=20
  gate rules-cls-probe "$ROOT/ui" "$ROOT/scripts/dev/rules_cls_probe.sh" "$OUT/rules-cls-probe.json"
  gate e2e-workspace "$ROOT/ui" env FA_BROWSERS=chrome,webkit npx playwright test -c playwright.workspace.config.ts
  gate e2e-history "$ROOT/ui" env FA_BROWSERS=chrome,webkit npx playwright test -c playwright.history.config.ts
  gate e2e-lookup "$ROOT/ui" env FA_BROWSERS=chrome,webkit npx playwright test -c playwright.lookup.config.ts
  gate e2e-local "$ROOT/ui" env FA_BROWSERS=chrome,webkit npx playwright test -c playwright.local.config.ts
fi
echo "summary: $OUT/summary.tsv"
if [ "$FAIL" -eq 1 ]; then echo "verdict: FAIL"; exit 1; fi
if [ "$BLOCKED" -eq 1 ]; then echo "verdict: INCOMPLETE — blocked gates did not run; this is not a pass"; exit 3; fi
echo "verdict: PASS ($([ "$PORTABLE" -eq 1 ] && echo 'portable gates only' || echo 'all gates'))"
exit 0
