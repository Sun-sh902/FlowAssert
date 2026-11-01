#!/bin/sh
# Reproduce the FlowAssert product development environment from a clean clone of this repository.
#
#   scripts/dev/bootstrap.sh            frontend deps, Python env, identity checks, synthetic archives
#   scripts/dev/bootstrap.sh --product-harness   (--harness is the same)
#                                       + the E2E runtime built from THIS workspace's Service and the browsers (needed
#                                       by scripts/dev/regression.sh); reads nothing outside this repository.
#
# Stages, in order; the first failing stage stops the run with its name, exit code and a hint:
#   tools      Node 22.12+ (22.x), 24.x or 26+, npm, git, lsof, curl, Python 3.14
#              (FA_PYTHON, default python3.14); uv used if present;
#              a system Python 3 (FA_SYSTEM_PYTHON, default /usr/bin/python3) that runs the read-only identity,
#              inventory and harness scripts isolated (-I) from the workspace venv
#   ui-deps    npm ci in ui/ — exactly ui/package-lock.json, clean node_modules
#   py-env     service/.venv from service/requirements.lock (--no-deps: the exact pinned set), then
#              `pip freeze` must equal the lock (no drift, nothing extra); an existing venv must also be Python 3.14
#   identity   scripts/dev/check_identities.py — pinned Evaluator, frozen contracts, current backend source map (historical acceptance retained separately)
#   fixtures   scripts/dev/seed.sh — synthetic SQLite archives dev-main, dev-single, dev-empty, dev-run-bound, via the Service's own code;
#              every state is verified complete (an interrupted seed is refused, not reported ready)
#   harness    (--product-harness | --harness) ui/.phase3a-runtime from this workspace (scripts/dev/prepare_harness_runtime.py)
#              and its seeded states and evaluator oracle. A runtime is kept on a rerun only if this stage recorded
#              completing it; a partial one is refused (exit 31). Then the mandatory browsers (Google Chrome channel, Playwright WebKit) must launch
#              (ui/scripts/dev/browser-probe.mjs), else exit 32.
# Nothing outside this repository is read. Tested on macOS (Darwin, arm64).
# Package downloads come from the npm and Python package indexes only. Nothing contacts n8n, HubSpot or any
# provider system, and no credential is read.
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
command -v node >/dev/null || fail tools 10 "node not found — install Node 22.12+ (22.x), 24.x or 26+ (developed with 26.10)"
NODE_VERSION="$(node -p 'process.versions.node')"
# The locked Vitest 5 range is ^22.12.0 || ^24.0.0 || >=26.0.0; Vite also supports these releases.
node -e '
  const version = process.versions.node;
  const [major, minor] = version.split(".").map(Number);
  const supported = /^[0-9]+\.[0-9]+\.[0-9]+$/.test(version) &&
    ((major === 22 && minor >= 12) || major === 24 || major >= 26);
  process.exit(supported ? 0 : 1);
' || fail tools 11 "node $NODE_VERSION is unsupported — Node 22.12+ (22.x), 24.x or 26+ required"
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
run identity "the workspace no longer matches its pinned current identities — do not run the Service until resolved" "$SYS_PY" -I -B "$ROOT/scripts/dev/check_identities.py"
echo "pinned Evaluator, contracts and backend source map verified"

stage fixtures
run fixtures "the Service's seed pipeline failed or found an incomplete state (see the log)" "$ROOT/scripts/dev/seed.sh"
echo "synthetic archives in service/.runtime verified: dev-main (10 evaluations), dev-single (5), dev-empty (0), dev-run-bound (6) — only missing ones were created"

if [ "$HARNESS" -eq 1 ] || [ "$PRODUCT_HARNESS" -eq 1 ]; then
  stage harness
  UI="$ROOT/ui"
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
  # FIX02: the browsers the regression requires (chrome = installed Google Chrome, webkit = Playwright WebKit) must
  # actually launch; a directory name under ms-playwright proved nothing. Firefox is probed for information only.
  node "$UI/scripts/dev/browser-probe.mjs" "$LOG/browsers.json" >> "$LOG/harness.log" 2>&1 || {
    tail -n 5 "$LOG/harness.log" >&2
    fail harness 32 "a mandatory browser does not launch — install Google Chrome, then: cd ui && npx playwright install webkit (report: $LOG/browsers.json)"
  }
  grep -E '^OK +(chrome|webkit) ' "$LOG/harness.log" | tail -n 2 | sed 's/^OK */browser /'
  echo "harness runtime ready: the identity-checked copy of this workspace's Service, shared by the history, lookup and local suites"
fi

cat <<EOF

BOOTSTRAP OK
  Service:     scripts/dev/service.sh                 (127.0.0.1:8765; FA_STATE=dev-empty for the empty archive)
  UI:          cd ui && npm run dev                   (http://127.0.0.1:5183)
  Regression:  scripts/dev/regression.sh --portable LABEL   (self-contained gates)
               scripts/dev/regression.sh --product LABEL    (product gates incl. browsers and matrix; needs --product-harness)
               scripts/dev/regression.sh LABEL              (release: all gates and historical custody; ports 4183/4184/5183/8765 free)
EOF
