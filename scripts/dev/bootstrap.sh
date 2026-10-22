#!/bin/sh
# Reproduce the FlowAssert product development environment from a clean clone of this repository.
#
#   scripts/dev/bootstrap.sh            frontend deps, Python env, identity checks, synthetic archives
#   scripts/dev/bootstrap.sh --harness  + the accepted E2E harness runtimes (needed by scripts/dev/regression.sh)
#
# Stages, in order; the first failing stage stops the run with its name, exit code and a hint:
#   tools      node ≥ 20, npm, git, lsof, Python 3.14 (FA_PYTHON, default python3.14); uv used if present
#   ui-deps    npm ci in ui/ — exactly ui/package-lock.json, clean node_modules
#   py-env     service/.venv from service/requirements.lock (--no-deps: the exact pinned set), then
#              `pip freeze` must equal the lock (no drift, nothing extra)
#   identity   scripts/dev/check_identities.py — pinned Evaluator, frozen contracts, accepted backend source map
#   fixtures   scripts/dev/seed.sh — synthetic SQLite archives dev-main, dev-single, dev-empty, via the Service's own CLI
#   harness    (--harness) ui/.phase3a-runtime from this workspace (scripts/dev/prepare_harness_runtime.py) and its
#              seeded states and evaluator oracle; ID-lookup and Phase 2 runtimes from the accepted read-only sources
# Package downloads come from the npm and Python package indexes only. Nothing contacts n8n, HubSpot or any
# provider system, no credential is read, and the accepted Phase 3A sources are only read.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="${FA_PYTHON:-python3.14}"
HARNESS=0
[ "${1:-}" = "--harness" ] && HARNESS=1
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
command -v "$PY" >/dev/null || fail tools 15 "$PY not found — the Service requires Python 3.14 (pyproject.toml); set FA_PYTHON"
"$PY" -c 'import sys; sys.exit(0 if sys.version_info[:2]==(3,14) else 1)' || fail tools 16 "$PY is not Python 3.14"
echo "node $(node -v) · npm $(npm -v) · $("$PY" --version) · uv $(command -v uv >/dev/null && uv --version | cut -d' ' -f2 || echo 'absent, using pip')"

stage ui-deps
run ui-deps "npm ci failed — check registry access or the npm cache; ui/package-lock.json is authoritative" sh -c "cd '$ROOT/ui' && npm ci --no-audit --no-fund"
echo "ui/node_modules installed from package-lock.json"

stage py-env
VENV="$ROOT/service/.venv"
if [ -e "$VENV" ]; then
  echo "service/.venv exists — verifying it instead of recreating"
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
run identity "the workspace no longer matches the accepted pinned identities — do not run the Service until resolved" /usr/bin/python3 -I -B "$ROOT/scripts/dev/check_identities.py"
echo "pinned Evaluator, contracts and backend source map verified"

stage fixtures
run fixtures "the Service's seed pipeline failed" "$ROOT/scripts/dev/seed.sh"
echo "synthetic archives in service/.runtime: dev-main (10 evaluations), dev-single (5), dev-empty — only missing ones were created"

if [ "$HARNESS" -eq 1 ]; then
  stage harness
  UI="$ROOT/ui"
  if [ -d "$UI/.phase3a-runtime/FlowAssert-Phase3A-Service" ]; then echo "ui/.phase3a-runtime exists — kept"; else
    run harness "harness runtime refused (identity or copy check)" /usr/bin/python3 -I -B "$ROOT/scripts/dev/prepare_harness_runtime.py"
    run harness "harness seed states failed" /usr/bin/python3 -I -B "$UI/scripts/phase3a/seed_states.py"
    run harness "evaluator oracle failed" "$UI/.phase3a-runtime/FlowAssert-Phase3A-Service/.venv/bin/python" -I -B "$UI/scripts/phase3a/evaluator_oracle.py"
  fi
  if [ -d "$UI/.phase3a-lookup-runtime" ]; then echo "ui/.phase3a-lookup-runtime exists — kept"; else
    run harness "ID-lookup runtime refused (reads the accepted FlowAssert-Phase3A-Service read-only)" /usr/bin/python3 -I -B "$UI/scripts/phase3a/prepare_lookup_runtime.py"
  fi
  if [ -d "$UI/.phase2-runtime" ]; then echo "ui/.phase2-runtime exists — kept"; else
    run harness "Phase 2 runtime refused (reads the accepted FlowAssert-Service read-only)" /usr/bin/python3 -I -B "$UI/scripts/phase2/prepare_runtime.py"
  fi
  if ! ls "$HOME/Library/Caches/ms-playwright" 2>/dev/null | grep -q '^webkit'; then
    echo "note: Playwright WebKit is not installed (npx playwright install webkit); WebKit suites will not run"
  fi
  echo "harness runtimes ready"
fi

cat <<EOF

BOOTSTRAP OK
  Service:     scripts/dev/service.sh                 (127.0.0.1:8765; FA_STATE=dev-empty for the empty archive)
  UI:          cd ui && npm run dev                   (http://127.0.0.1:5183)
  Regression:  scripts/dev/regression.sh LABEL        (needs --harness; ports 5183/8765 free)
EOF
