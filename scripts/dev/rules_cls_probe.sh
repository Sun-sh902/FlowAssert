#!/bin/sh
# Rules layout-shift probe gate (round 02), run from ui/: build, serve the build on 127.0.0.1:4184, load #/rules 30
# times cold (scripts/dev/cls-probe.mjs) and fail on any CLS >= 0.1 or any page error.
# Round 02 hardening FIX01: the gate owns its server. It refuses an occupied port, proves the listener is the preview
# process it started and that it serves this build's dist/index.html, and stops only that process (never pkill -f).
#   ../scripts/dev/rules_cls_probe.sh OUT.json
set -u
OUT_JSON="${1:?usage: rules_cls_probe.sh OUT.json}"
PORT=4184
listener() { lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' | sed 's/ $//'; }
[ -z "$(listener)" ] || { echo "port $PORT already has a listener (pid $(listener)); refusing to measure a server this gate did not start" >&2; exit 1; }
npx vite build >/dev/null || { echo "vite build failed" >&2; exit 1; }
node node_modules/vite/bin/vite.js preview --port "$PORT" --strictPort >/dev/null 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null' EXIT
i=0
while [ "$(listener)" != "$PID" ] && [ "$i" -lt 40 ]; do
  kill -0 "$PID" 2>/dev/null || { echo "preview server exited (port $PORT taken?)" >&2; exit 1; }
  sleep 0.25; i=$((i + 1))
done
[ "$(listener)" = "$PID" ] || { echo "listener on $PORT is '$(listener)', not the preview server this gate started ($PID)" >&2; exit 1; }
curl -s --noproxy '*' "http://127.0.0.1:$PORT/" | cmp -s - dist/index.html || { echo "port $PORT does not serve this build's dist/index.html" >&2; exit 1; }
echo "measuring http://127.0.0.1:$PORT/ served by pid $PID (this build)"
node scripts/dev/cls-probe.mjs "http://127.0.0.1:$PORT/" '#/rules' 30 "$OUT_JSON"; rc=$?
[ "$rc" -eq 0 ] || exit "$rc"
# FIX02: a load with a page error is a failed measurement, not a CLS of 0. Residual closeout R10: so is one taken before
# every font had loaded.
node -e 'const r=require(process.argv[1]); process.exit(r.some(x=>x.cls>=0.1||x.pageErrors.length||x.fontsAtEnd!=="loaded")?1:0)' "$OUT_JSON"
