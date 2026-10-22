#!/bin/sh
# Run the isolated exact-source copy of the accepted FlowAssert Service in the foreground.
# Launch command adapted from FlowAssert-Phase2-Support/LOCAL_RUNTIME_GUIDE.md; only paths differ.
# The Service fixes host 127.0.0.1 and port 8765 itself (run.py). Stop with Ctrl-C or SIGTERM to this PID.
# Prepare the runtime once with: /usr/bin/python3 -I -B scripts/phase2/prepare_runtime.py
set -eu
UI="$(cd "$(dirname "$0")/../.." && pwd)"
RT="$UI/.phase2-runtime"
if lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port 8765 already has a listener; not starting (never kill an unknown process)" >&2
  exit 1
fi
cd "$RT/FlowAssert-Service"
exec env FLOWASSERT_CURSOR_KEY_FILE="$RT/state/keys/cursor-hmac.key" PYTHONDONTWRITEBYTECODE=1 TMPDIR="$RT/state/tmp" LC_ALL=C \
  .venv/bin/python -B run.py
