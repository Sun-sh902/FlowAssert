#!/bin/sh
# Every product-workspace gate, in order, each logged with its exit code and status.
#   scripts/dev/regression.sh LABEL              all gates (needs scripts/dev/bootstrap.sh --harness)
#   scripts/dev/regression.sh --portable LABEL   self-contained gates only (needs scripts/dev/bootstrap.sh): backend,
#                                                identities, typecheck, lint, Vitest — plus the custody check, which
#                                                reports BLOCKED where the protected roots are absent
# Writes $FA_REGRESSION_DIR/LABEL/ (default .dev-runtime/regression, git-ignored): <gate>.log, summary.tsv,
# run-identity.tsv (run ID = LABEL, commit, branch, worktree state), and in full mode every suite's evidence
# (evidence/), Playwright artifacts (artifacts/<gate>/) and JSON reports (<gate>.json). Refuses to reuse a label and
# refuses a run directory inside the repository that git does not ignore.
# Round 02 hardening FIX02: no gate writes into committed evidence — the suites' evidence, screenshot and report
# directories are redirected into the run directory, and the final tracked-evidence gate fails if any tracked file under
# docs/ or ui/docs/ changed or any untracked file appeared there during the run. The Playwright gates are checked
# against scripts/dev/test-inventory.json like the unit-test runners, and the mandatory browsers are probed first.
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
BASE="${FA_REGRESSION_DIR:-$ROOT/.dev-runtime/regression}"
mkdir -p "$BASE" && BASE="$(cd "$BASE" && pwd)"
OUT="$BASE/$LABEL"
[ -e "$OUT" ] && { echo "refusing to reuse $OUT" >&2; exit 1; }
case "$OUT/" in "$ROOT"/*)
  git -C "$ROOT" check-ignore -q "$OUT/" || { echo "refusing $OUT: a run directory inside the repository must be git-ignored (default .dev-runtime/regression)" >&2; exit 1; } ;;
esac
# Decide on lsof's OUTPUT: with several -i selectors its exit status is 1 whenever any one is unmatched, so the
# round 02 status-based check passed unless every port was taken (FIX01).
if [ "$PORTABLE" -eq 0 ] && [ -n "$(lsof -nP -t -iTCP:4183,4184,5183,8765 -sTCP:LISTEN 2>/dev/null)" ]; then
  echo "ports 4183/4184/5183/8765 must be free (stop the dev server, previews and Service):" >&2
  lsof -nP -iTCP:4183,4184,5183,8765 -sTCP:LISTEN >&2; exit 1
fi
mkdir -p "$OUT"
{
  printf 'run_id\t%s\n' "$LABEL"
  printf 'commit\t%s\n' "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
  printf 'branch\t%s\n' "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  printf 'worktree_changes\t%s\n' "$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  printf 'mode\t%s\n' "$([ "$PORTABLE" -eq 1 ] && echo portable || echo full)"
  printf 'started_utc\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'host\t%s\n' "$(uname -srm)"
  printf 'run_dir\t%s\n' "$OUT"
} > "$OUT/run-identity.tsv"
# Tracked evidence: content digest of every tracked file under docs/ and ui/docs/, plus their git status (untracked
# files included). Compared at the end of the run (gate tracked-evidence).
evidence_state() {
  ( cd "$ROOT" && git ls-files -z -- docs ui/docs | xargs -0 shasum -a 256 && git status --porcelain --untracked-files=all -- docs ui/docs | sed 's/^/status /' )
}
evidence_unchanged() {
  evidence_state > "$OUT/tracked-evidence-after.txt"
  diff "$OUT/tracked-evidence-before.txt" "$OUT/tracked-evidence-after.txt" && echo "tracked evidence unchanged ($(wc -l < "$OUT/tracked-evidence-before.txt" | tr -d ' ') lines)"
}
evidence_state > "$OUT/tracked-evidence-before.txt"
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
# pw_gate GATE [ENV=VALUE...] npx playwright test ARGS...: one Playwright run with its own artifacts and JSON report, then its inventory.
pw_gate() {
  g="$1"; shift
  gate "$g" "$ROOT/ui" env PLAYWRIGHT_JSON_OUTPUT_NAME="$OUT/$g.json" "$@" --reporter=list,json --output="$OUT/artifacts/$g"
  gate "$g-inventory" "$ROOT" "$SYS_PY" -I -B scripts/dev/check_test_inventory.py playwright "$g" "$OUT/$g.json"
}
if [ "$PORTABLE" -eq 0 ]; then
  EV="$OUT/evidence"
  unset FA_CAPTURE FA_CAPTURE_DIR
  # Mandatory browsers: Google Chrome (channel chrome) and Playwright WebKit must launch; Firefox information only.
  gate browsers "$ROOT/ui" node scripts/dev/browser-probe.mjs "$OUT/browsers.json"
  pw_gate e2e-static FA_BROWSERS=chrome,webkit FA_STATIC_REPORT_DIR="$EV/e2e-static" npx playwright test
  # Rules layout shift (round 02): the accepted perf test 20 times, then 30 cold-cache loads attributed by source.
  pw_gate rules-cls-repeat FA_STATIC_REPORT_DIR="$EV/rules-cls-repeat" npx playwright test e2e/perf.spec.ts --repeat-each=20
  gate rules-cls-probe "$ROOT/ui" "$ROOT/scripts/dev/rules_cls_probe.sh" "$OUT/rules-cls-probe.json"
  pw_gate e2e-workspace FA_BROWSERS=chrome,webkit FA_WORKSPACE_EVIDENCE_DIR="$EV/e2e-workspace" \
    FA_WORKSPACE_SCREENSHOT_DIR="$EV/e2e-workspace/screenshots" npx playwright test -c playwright.workspace.config.ts
  pw_gate e2e-history FA_BROWSERS=chrome,webkit FA_HISTORY_EVIDENCE_DIR="$EV/e2e-history/e2e" npx playwright test -c playwright.history.config.ts
  pw_gate e2e-lookup FA_BROWSERS=chrome,webkit FA_LOOKUP_EVIDENCE_DIR="$EV/e2e-lookup" npx playwright test -c playwright.lookup.config.ts
  pw_gate e2e-local FA_BROWSERS=chrome,webkit FA_E2E_EVIDENCE_DIR="$EV/e2e-local" npx playwright test -c playwright.local.config.ts
fi
gate tracked-evidence "$ROOT" evidence_unchanged
echo "summary: $OUT/summary.tsv"
if [ "$FAIL" -eq 1 ]; then echo "verdict: FAIL"; exit 1; fi
if [ "$BLOCKED" -eq 1 ]; then echo "verdict: INCOMPLETE — blocked gates did not run; this is not a pass"; exit 3; fi
echo "verdict: PASS ($([ "$PORTABLE" -eq 1 ] && echo 'portable gates only' || echo 'all gates'))"
exit 0
