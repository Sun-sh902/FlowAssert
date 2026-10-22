#!/bin/sh
# TEST ONLY. Run the isolated exact-source copy of the Phase 3A Service at the ID-addressability handoff identity
# (scripts/phase3a/prepare_lookup_runtime.py) through the backend's own identity-alias launcher, in the foreground,
# on 127.0.0.1:8765 (fixed by that launcher). State: a private archive under the copy's own .runtime/, seeded once
# by the reviewed CLI (archive_cli.py seed + check) and never reset. Receipts go to $FA_LOOKUP_BACKEND_OUT.
# Stop with SIGINT to this PID (the launcher then writes its outbound-connection audit).
set -eu
UI="$(cd "$(dirname "$0")/../.." && pwd)"
RT="$UI/.phase3a-lookup-runtime/FlowAssert-Phase3A-Service"
STATE="$RT/.runtime/ui-lookup"
OUT="${FA_LOOKUP_BACKEND_OUT:?set FA_LOOKUP_BACKEND_OUT}"
[ -d "$RT" ] || { echo "missing isolated runtime; run scripts/phase3a/prepare_lookup_runtime.py" >&2; exit 2; }
if lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port 8765 already has a listener; not starting (never kill an unknown process)" >&2
  exit 1
fi
mkdir -p "$OUT" "$RT/.runtime/tmp"
chmod 700 "$RT/.runtime"
cd "$RT"
ENV="env -i PATH=/usr/bin:/bin HOME=$HOME LC_ALL=C PYTHONDONTWRITEBYTECODE=1 TMPDIR=$RT/.runtime/tmp"
if [ ! -d "$STATE" ]; then
  $ENV .venv/bin/python -B archive_cli.py --state "$STATE" seed > "$OUT/seed.json"
  $ENV .venv/bin/python -B archive_cli.py --state "$STATE" check > "$OUT/check.json"
fi
exec $ENV .venv/bin/python -B "$UI/scripts/phase3a/lookup_alias_entry.py" "$OUT" "$STATE"
