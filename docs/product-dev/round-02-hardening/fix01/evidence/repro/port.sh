#!/bin/sh
# Usage: port.sh CLONE OUTDIR — occupy 127.0.0.1:4184 with an unrelated page, then run the rules-cls-probe gate
# exactly as CLONE/scripts/dev/regression.sh defines it. A correct gate must refuse (non-zero) instead of measuring
# the unrelated page. Prints the regression pre-check verdict and the gate exit code.
C="$1"; OUT="$2"; rm -rf "$OUT"; mkdir -p "$OUT/www"; echo '<!doctype html><title>unrelated</title><p>not FlowAssert</p>' > "$OUT/www/index.html"
python3 -m http.server 4184 --bind 127.0.0.1 --directory "$OUT/www" >/dev/null 2>&1 & UPID=$!; sleep 1
lsof -nP -iTCP:4184 -sTCP:LISTEN | tail -1
# The gate's command line, extracted verbatim from regression.sh (the line(s) after "gate rules-cls-probe").
GATE="$(awk '/^gate rules-cls-probe/{p=1} p{print} p&&!/\\$/{exit}' "$C/scripts/dev/regression.sh")"
printf '%s\n' "$GATE" > "$OUT/gate-definition.txt"
( cd "$C" && OUT="$OUT" ROOT="$C" sh -c '
  gate() { name="$1"; dir="$2"; shift 2; ( cd "$dir" && "$@" ) > "$OUT/$name.log" 2>&1; echo "$name exit $?"; }
  '"$(sed -n '/^preflight_port\(\)/,/^}/p' "$C/scripts/dev/regression.sh")"'
  '"$GATE" )
[ -f "$OUT/rules-cls-probe.json" ] && python3 -c "import json,sys;r=json.load(open(sys.argv[1]));print(len(r),'loads measured; max cls',max(x['cls'] for x in r))" "$OUT/rules-cls-probe.json"
kill -0 $UPID 2>/dev/null && echo "unrelated server still alive (pid $UPID)"; kill $UPID 2>/dev/null; wait $UPID 2>/dev/null
tail -3 "$OUT/rules-cls-probe.log"
