#!/bin/sh
# Create local synthetic SQLite archives for product development through the unchanged Service CLI
# (archive_cli.py, wrapped by the Service's own socket audit scripts/guarded_entry.py). No import capability exists.
#   dev-main   seed + seed --reevaluate → 10 archived evaluations (5 reviewed synthetic cases × 2 batches)
#   dev-empty  init only → valid empty archive
# Refuses to reuse an existing state. State: service/.runtime/<name> (0700, gitignored).
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SVC="$ROOT/service"
RT="$SVC/.runtime"
umask 077
mkdir -p "$RT/tmp" "$RT/net"
chmod 700 "$RT" "$RT/tmp" "$RT/net"
run() {
  label="$1"; shift
  env -i PATH=/usr/bin:/bin HOME="$HOME" LC_ALL=C PYTHONDONTWRITEBYTECODE=1 TMPDIR="$RT/tmp" \
    FLOWASSERT_NETWORK_AUDIT="$RT/net/$label.json" \
    "$SVC/.venv/bin/python" -B "$SVC/scripts/guarded_entry.py" archive_cli.py "$@"
}
for s in dev-main dev-empty; do
  if [ -e "$RT/$s" ]; then echo "refusing to reuse existing state $RT/$s" >&2; exit 1; fi
done
cd "$SVC"
run seed-main    --state "$RT/dev-main" seed
run reeval-main  --state "$RT/dev-main" seed --reevaluate
run check-main   --state "$RT/dev-main" check
run init-empty   --state "$RT/dev-empty" init
run check-empty  --state "$RT/dev-empty" check
