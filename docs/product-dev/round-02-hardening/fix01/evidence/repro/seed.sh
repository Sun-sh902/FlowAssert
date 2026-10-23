#!/bin/sh
# Usage: seed.sh CLONE — simulate an interrupted dev-main seed (first CLI step only, --reevaluate never ran), then rerun
# seed.sh and bootstrap. A correct pipeline must refuse the 5-archive dev-main instead of reporting it ready.
C="$1"; SVC="$C/service"; RT="$SVC/.runtime"; cd "$SVC" || exit 99
rm -rf "$RT/dev-main"
env -i PATH=/usr/bin:/bin HOME="$HOME" LC_ALL=C PYTHONDONTWRITEBYTECODE=1 TMPDIR="$RT/tmp" FLOWASSERT_NETWORK_AUDIT="$RT/net/repro-partial.json" \
  .venv/bin/python -B scripts/guarded_entry.py archive_cli.py --state "$RT/dev-main" seed >/dev/null || exit 98
echo "simulated interruption: dev-main has seed only"
"$NOSIB" "$C/scripts/dev/seed.sh"; echo "seed.sh exit=$?"
"$NOSIB" "$C/scripts/dev/bootstrap.sh" > "$C/.seed-repro.out" 2>&1; rc=$?
grep -A2 "== fixtures" "$C/.seed-repro.out"; grep -E "BOOTSTRAP" "$C/.seed-repro.out"; echo "bootstrap exit=$rc"
