#!/bin/sh
# Reproduce the FlowAssert product development environment from a clean clone of this repository.
#
#   scripts/dev/bootstrap.sh            frontend deps, Python env, identity checks, synthetic archives
#   scripts/dev/bootstrap.sh --harness  + the accepted E2E harness runtimes (needed by scripts/dev/regression.sh)
#   scripts/dev/bootstrap.sh --product-harness
#                                       + only the history runtime built from THIS workspace's Service and the browsers
#                                       (needed by scripts/dev/regression.sh --product); reads nothing outside this
#                                       repository. A later --harness keeps that runtime and adds the historical ones.
#
# Stages, in order; the first failing stage stops the run with its name, exit code and a hint:
#   tools      node ≥ 20, npm, git, lsof, curl, Python 3.14 (FA_PYTHON, default python3.14); uv used if present;
#              a system Python 3 (FA_SYSTEM_PYTHON, default /usr/bin/python3) that runs the read-only identity,
#              inventory and harness scripts isolated (-I) from the workspace venv
#   ui-deps    npm ci in ui/ — exactly ui/package-lock.json, clean node_modules
#   py-env     service/.venv from service/requirements.lock (--no-deps: the exact pinned set), then
#              `pip freeze` must equal the lock (no drift, nothing extra); an existing venv must also be Python 3.14
#   identity   scripts/dev/check_identities.py — pinned Evaluator, frozen contracts, accepted backend source map
#   fixtures   scripts/dev/seed.sh — synthetic SQLite archives dev-main, dev-single, dev-empty, via the Service's own CLI;
#              every state is verified complete (an interrupted seed is refused, not reported ready)
#   harness    (--harness) ui/.phase3a-runtime from this workspace (scripts/dev/prepare_harness_runtime.py) and its
#              seeded states and evaluator oracle; ID-lookup and Phase 2 runtimes from the accepted read-only sources.
#              Machine-bound: the accepted harness scripts read those sources at fixed absolute paths (HARNESS_SOURCES
#              below). If any is absent the stage stops BLOCKED (exit 30) before writing anything. A runtime is kept
#              on a rerun only if this stage recorded completing it; a partial one is refused (exit 31). Then the
#              mandatory browsers (Google Chrome channel, Playwright WebKit) must launch (ui/scripts/dev/browser-probe.mjs),
#              else exit 32.
# Without --harness nothing outside this repository is read. Tested on macOS (Darwin, arm64).
# Package downloads come from the npm and Python package indexes only. Nothing contacts n8n, HubSpot or any
# provider system, no credential is read, and the accepted Phase 3A sources are only read.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="${FA_PYTHON:-python3.14}"
SYS_PY="${FA_SYSTEM_PYTHON:-/usr/bin/python3}"
HARNESS=0
PRODUCT_HARNESS=0
case "${1:-}" in --harness) HARNESS=1 ;; --product-harness) PRODUCT_HARNESS=1 ;; esac
LOG="$ROOT/.dev-runtime/bootstrap"
mkdir -p "$LOG"

stage() { printf '\n== %s\n' "$1"; }
fail() { printf '\nBOOTSTRAP FAILED at stage "%s" (exit %s)\n  %s\n  log: %s\n' "$1" "$2" "$3" "$LOG/$1.log" >&2; exit "$2"; }
run() { # run STAGE HINT CMD... — stream to the stage log, fail with the hint
  name="$1"; hint="$2"; shift 2
  "$@" >> "$LOG/$name.log" 2>&1
  rc=$?
  [ "$rc" -eq 0 ] || { tail -n 20 "$LOG/$name.log" >&2; fail "$name" "$rc" "$hint"; }
}

stage tools
: > "$LOG/tools.log"
command -v node >/dev/null || fail tools 10 "node not found — install Node 20+ (developed with 26.10)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail tools 11 "node $NODE_MAJOR is too old — Node 20+ required"
command -v npm >/dev/null || fail tools 12 "npm not found"
command -v git >/dev/null || fail tools 13 "git not found"
command -v lsof >/dev/null || fail tools 14 "lsof not found (used to refuse starting over an unknown listener)"
command -v curl >/dev/null || fail tools 18 "curl not found (used by the regression's Rules probe gate)"
"$SYS_PY" -I -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null || fail tools 17 "system Python $SYS_PY is missing, not executable or older than 3.9 — set FA_SYSTEM_PYTHON to a Python 3.9+"
command -v "$PY" >/dev/null || fail tools 15 "$PY not found — the Service requires Python 3.14 (pyproject.toml); set FA_PYTHON"
"$PY" -c 'import sys; sys.exit(0 if sys.version_info[:2]==(3,14) else 1)' || fail tools 16 "$PY is not Python 3.14"
echo "node $(node -v) · npm $(npm -v) · $("$PY" --version) · system $("$SYS_PY" --version 2>&1) · uv $(command -v uv >/dev/null && uv --version | cut -d' ' -f2 || echo 'absent, using pip')"

stage ui-deps
run ui-deps "npm ci failed — check registry access or the npm cache; ui/package-lock.json is authoritative" sh -c "cd '$ROOT/ui' && npm ci --no-audit --no-fund"
echo "ui/node_modules installed from package-lock.json"

stage py-env
VENV="$ROOT/service/.venv"
if [ -e "$VENV" ]; then
  echo "service/.venv exists — verifying it instead of recreating"
  "$VENV/bin/python" -c 'import sys; sys.exit(0 if sys.version_info[:2]==(3,14) else 1)' 2>/dev/null \
    || fail py-env 21 "service/.venv is not a working Python 3.14 venv ($("$VENV/bin/python" --version 2>&1)) — remove service/.venv and rerun"
else
  run py-env "could not create the venv with $PY" "$PY" -m venv "$VENV"
  if command -v uv >/dev/null; then
    run py-env "dependency install failed — check access to the Python package index" uv pip install --python "$VENV/bin/python" --no-deps -r "$ROOT/service/requirements.lock"
  else
    run py-env "dependency install failed — check access to the Python package index" "$VENV/bin/python" -m pip install --no-deps -r "$ROOT/service/requirements.lock"
  fi
fi
FREEZE="$("$VENV/bin/python" -m pip freeze 2>>"$LOG/py-env.log" | tr 'A-Z_' 'a-z-' | sort)"
LOCK="$(grep -v '^#' "$ROOT/service/requirements.lock" | grep . | tr 'A-Z_' 'a-z-' | sort)"
[ "$FREEZE" = "$LOCK" ] || { printf '%s\n' "$FREEZE" > "$LOG/py-env.freeze"; fail py-env 20 "installed distributions differ from service/requirements.lock (see $LOG/py-env.freeze); remove service/.venv and rerun"; }
echo "service/.venv == requirements.lock ($(printf '%s\n' "$LOCK" | wc -l | tr -d ' ') distributions)"

stage identity
run identity "the workspace no longer matches the accepted pinned identities — do not run the Service until resolved" "$SYS_PY" -I -B "$ROOT/scripts/dev/check_identities.py"
echo "pinned Evaluator, contracts and backend source map verified"

stage fixtures
run fixtures "the Service's seed pipeline failed or found an incomplete state (see the log)" "$ROOT/scripts/dev/seed.sh"
echo "synthetic archives in service/.runtime verified: dev-main (10 evaluations), dev-single (5), dev-empty (0) — only missing ones were created"

if [ "$HARNESS" -eq 1 ] || [ "$PRODUCT_HARNESS" -eq 1 ]; then
  stage harness
  UI="$ROOT/ui"
  # The accepted read-only sources the unchanged harness scripts read, at their fixed absolute paths (--harness only;
  # --product-harness prepares only the runtime copied from this workspace and never reads them).
  HARNESS_SOURCES="/Users/zhangshenghe/Documents/FlowAssert-Phase3A-Service/docs/phase3a/id-addressability-remediation-03/evidence/source-identities.json
/Users/zhangshenghe/Documents/FlowAssert-Service
/Users/zhangshenghe/Documents/FlowAssert-round03-oracle-fix/experiments/round03/model.py
/Users/zhangshenghe/Documents/FlowAssert-Phase2-Support/evidence/identity/accepted-source-comparison.json"
  ABSENT="$([ "$HARNESS" -eq 1 ] && printf '%s\n' "$HARNESS_SOURCES" | while IFS= read -r p; do [ -r "$p" ] || echo "    $p"; done)"
  [ -z "$ABSENT" ] || fail harness 30 "BLOCKED: the accepted read-only harness sources are not readable on this machine:
$ABSENT
  The browser regression gates cannot be prepared here; the portable gates need no harness (regression.sh --portable)."
  # runtime NAME DIR — keep DIR only if this stage recorded completing it; otherwise refuse a partial runtime.
  runtime() {
    if [ -e "$LOG/harness-$1.complete" ] && [ -d "$2" ]; then echo "${2#$ROOT/} exists and was completed by bootstrap — kept"; return 1; fi
    [ -e "$2" ] && fail harness 31 "${2#$ROOT/} exists but bootstrap never recorded completing it (interrupted, or made by hand) — remove ${2#$ROOT/} and rerun"
    rm -f "$LOG/harness-$1.complete"; return 0
  }
  if runtime phase3a "$UI/.phase3a-runtime"; then
    run harness "harness runtime refused (identity or copy check)" "$SYS_PY" -I -B "$ROOT/scripts/dev/prepare_harness_runtime.py"
    run harness "harness seed states failed" "$SYS_PY" -I -B "$UI/scripts/phase3a/seed_states.py"
    run harness "evaluator oracle failed" "$UI/.phase3a-runtime/FlowAssert-Phase3A-Service/.venv/bin/python" -I -B "$UI/scripts/phase3a/evaluator_oracle.py"
    : > "$LOG/harness-phase3a.complete"
  fi
  if [ "$HARNESS" -eq 1 ] && runtime lookup "$UI/.phase3a-lookup-runtime"; then
    run harness "ID-lookup runtime refused (reads the accepted FlowAssert-Phase3A-Service read-only)" "$SYS_PY" -I -B "$UI/scripts/phase3a/prepare_lookup_runtime.py"
    : > "$LOG/harness-lookup.complete"
  fi
  if [ "$HARNESS" -eq 1 ] && runtime phase2 "$UI/.phase2-runtime"; then
    run harness "Phase 2 runtime refused (reads the accepted FlowAssert-Service read-only)" "$SYS_PY" -I -B "$UI/scripts/phase2/prepare_runtime.py"
    : > "$LOG/harness-phase2.complete"
  fi
  # FIX02: the browsers the regression requires (chrome = installed Google Chrome, webkit = Playwright WebKit) must
  # actually launch; a directory name under ms-playwright proved nothing. Firefox is probed for information only.
  node "$UI/scripts/dev/browser-probe.mjs" "$LOG/browsers.json" >> "$LOG/harness.log" 2>&1 || {
    tail -n 5 "$LOG/harness.log" >&2
    fail harness 32 "a mandatory browser does not launch — install Google Chrome, then: cd ui && npx playwright install webkit (report: $LOG/browsers.json)"
  }
  grep -E '^OK +(chrome|webkit) ' "$LOG/harness.log" | tail -n 2 | sed 's/^OK */browser /'
  echo "harness runtimes ready ($([ "$HARNESS" -eq 1 ] && echo 'history, ID-lookup, Phase 2' || echo 'history only — product profile'))"
fi

cat <<EOF

BOOTSTRAP OK
  Service:     scripts/dev/service.sh                 (127.0.0.1:8765; FA_STATE=dev-empty for the empty archive)
  UI:          cd ui && npm run dev                   (http://127.0.0.1:5183)
  Regression:  scripts/dev/regression.sh --portable LABEL   (self-contained gates)
               scripts/dev/regression.sh --product LABEL    (product gates incl. browsers and matrix; needs --product-harness)
               scripts/dev/regression.sh LABEL              (release: all gates; needs --harness; ports 4183/4184/5183/8765 free)
EOF
