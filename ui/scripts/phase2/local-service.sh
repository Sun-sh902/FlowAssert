#!/bin/sh
# Run this workspace's current Service, frozen v1 routes only (run.py), from its identity-checked runtime copy
# (ui/.phase3a-runtime, built by scripts/dev/prepare_harness_runtime.py), in the foreground. The Service fixes host
# 127.0.0.1 and port 8765 itself. Stop with Ctrl-C or SIGTERM to this PID. The cursor key lives in ui/.phase3a-runtime/
# local-state and outlives a restart, as the suite's restart tests need.
set -eu
UI="$(cd "$(dirname "$0")/../.." && pwd)"
RT="$UI/.phase3a-runtime/FlowAssert-Phase3A-Service"
STATE="$UI/.phase3a-runtime/local-state"
[ -d "$RT" ] || { echo "missing runtime copy; run scripts/dev/bootstrap.sh --product-harness" >&2; exit 2; }
if lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port 8765 already has a listener; not starting (never kill an unknown process)" >&2
  exit 1
fi
mkdir -p "$STATE/tmp"
chmod 700 "$STATE" "$STATE/tmp"
cd "$RT"
exec env FLOWASSERT_CURSOR_KEY_FILE="$STATE/keys/cursor-hmac.key" PYTHONDONTWRITEBYTECODE=1 TMPDIR="$STATE/tmp" LC_ALL=C \
  .venv/bin/python -B run.py
