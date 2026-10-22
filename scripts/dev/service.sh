#!/bin/sh
# Run the local Phase 3A Service (run_history.py: frozen v1 reads + History + exact-ID lookup) on 127.0.0.1:8765.
# FA_STATE=dev-main (default) | dev-single | dev-empty. Stop with Ctrl-C / SIGTERM to this PID.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SVC="$ROOT/service"
RT="$SVC/.runtime"
STATE="${FA_STATE:-dev-main}"
case "$STATE" in dev-main|dev-single|dev-empty) ;; *) echo "unknown state: $STATE" >&2; exit 2 ;; esac
[ -d "$RT/$STATE" ] || { echo "state $STATE missing; run scripts/dev/seed.sh first" >&2; exit 1; }
if lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port 8765 already has a listener; not starting (never kill an unknown process)" >&2; exit 1
fi
cd "$SVC"
exec env -i PATH=/usr/bin:/bin HOME="$HOME" LC_ALL=C PYTHONDONTWRITEBYTECODE=1 TMPDIR="$RT/tmp" \
  FLOWASSERT_HISTORY_STATE="$RT/$STATE" \
  FLOWASSERT_NETWORK_AUDIT="$RT/net/service-$STATE-$(date -u +%Y%m%dT%H%M%SZ)-$$.json" \
  .venv/bin/python -B scripts/guarded_entry.py run_history.py
