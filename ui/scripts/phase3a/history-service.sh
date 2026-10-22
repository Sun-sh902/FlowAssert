#!/bin/sh
# Run the isolated exact-source copy of the Phase 3A history Service in the foreground.
# Launch command from FlowAssert-Phase3A-Service/docs/phase3a/FRONTEND_HANDOFF.md (run_history.py);
# only the state path differs, and the backend's own test-only socket audit (scripts/guarded_entry.py)
# records every outbound connect. run_history.py fixes host 127.0.0.1 and port 8765 itself.
# Prepare once:  /usr/bin/python3 -I -B scripts/phase3a/prepare_runtime.py && /usr/bin/python3 -I -B scripts/phase3a/seed_states.py
# State: FA_HISTORY_STATE=ui-main (default) | ui-empty | ui-corrupt | ui-unverifiable. Stop with SIGTERM to this PID.
set -eu
UI="$(cd "$(dirname "$0")/../.." && pwd)"
RT="$UI/.phase3a-runtime/FlowAssert-Phase3A-Service"
STATE="${FA_HISTORY_STATE:-ui-main}"
case "$STATE" in
  ui-main|ui-empty|ui-corrupt|ui-unverifiable) ;;
  *) echo "unknown history state: $STATE" >&2; exit 2 ;;
esac
if lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port 8765 already has a listener; not starting (never kill an unknown process)" >&2
  exit 1
fi
AUDIT="$RT/.runtime/net/service-$STATE-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
cd "$RT"
exec env -i PATH=/usr/bin:/bin HOME="$HOME" LC_ALL=C PYTHONDONTWRITEBYTECODE=1 TMPDIR="$RT/.runtime/tmp" \
  FLOWASSERT_HISTORY_STATE="$RT/.runtime/$STATE" FLOWASSERT_NETWORK_AUDIT="$AUDIT" \
  .venv/bin/python -B scripts/guarded_entry.py run_history.py
