#!/bin/sh
# Create local synthetic SQLite archives for product development through the unchanged Service CLI
# (archive_cli.py, wrapped by the Service's own socket audit scripts/guarded_entry.py). No import capability exists.
#   dev-main    seed + seed --reevaluate → 10 archived evaluations (5 reviewed synthetic cases × 2 batches)
#   dev-single  seed only → 5 archived evaluations, exactly one per case (round 02: exact Detail → Archive match)
#   dev-empty   init only → valid empty archive
#   dev-run-bound  seed, then SPEC-001 again through the Service's ExecutionCollector and its signed receipt
#               (scripts/dev/seed_run_bound.py) → 6 archived evaluations, the newest SPEC-001 entry ADMITTED_RUN_BOUND
# Creates only the states that do not exist yet; never writes into an existing state.
# Every state, new or existing, is then verified with the Service's read-only `check` (SQLite opened mode=ro) and must
# hold exactly its expected number of evaluations: an interrupted seed leaves a state that exists but is incomplete,
# and it is refused (exit 3, remove it and rerun), never reported ready (round 02 hardening FIX01).
# State: service/.runtime/<name> (0700, gitignored).
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
# validate NAME EXPECTED
validate() {
  out="$(run "check-$1" --state "$RT/$1" check)" || { echo "state $1 failed the Service's integrity check — remove service/.runtime/$1 and rerun" >&2; exit 3; }
  n="$(printf '%s' "$out" | "$SVC/.venv/bin/python" -I -B -c 'import json,sys; d=json.load(sys.stdin); print(d["validated_archives"] if d.get("integrity")=="INTEGRITY_VERIFIED" else "unverified")')"
  [ "$n" = "$2" ] || { echo "state $1 is incomplete: $n archived evaluations, expected $2 (an interrupted seed?) — remove service/.runtime/$1 and rerun" >&2; exit 3; }
  echo "$1: $n archived evaluations, integrity verified"
}
cd "$SVC"
created=0
if [ ! -e "$RT/dev-main" ]; then
  run seed-main    --state "$RT/dev-main" seed
  run reeval-main  --state "$RT/dev-main" seed --reevaluate
  created=1
fi
if [ ! -e "$RT/dev-single" ]; then
  run seed-single  --state "$RT/dev-single" seed
  created=1
fi
if [ ! -e "$RT/dev-empty" ]; then
  run init-empty   --state "$RT/dev-empty" init
  created=1
fi
if [ ! -e "$RT/dev-run-bound" ]; then
  env -i PATH=/usr/bin:/bin HOME="$HOME" LC_ALL=C PYTHONDONTWRITEBYTECODE=1 TMPDIR="$RT/tmp" PYTHONPATH="$SVC" \
    "$SVC/.venv/bin/python" -B "$ROOT/scripts/dev/seed_run_bound.py" "$RT/dev-run-bound"
  created=1
fi
validate dev-main 10
validate dev-single 5
validate dev-empty 0
validate dev-run-bound 6
[ "$created" -eq 1 ] || echo "all states existed and verified; nothing written"
