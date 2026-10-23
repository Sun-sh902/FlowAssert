#!/bin/sh
# Sandbox accommodation only: terminate a headless Playwright Firefox whose parent is a browser-probe.mjs running in
# the clean clone (identified by its working directory) after 45 s. Firefox is information-only; under sandbox-exec
# its launch hangs.
LOG="$1"; CLONE="$2"
while true; do
  for probe in $(pgrep -f 'scripts/dev/browser-probe.mjs'); do
    cwd=$(lsof -a -p "$probe" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    case "$cwd" in "$CLONE"*) ;; *) continue ;; esac
    for ff in $(pgrep -P "$probe" -f 'ms-playwright/firefox'); do
      s=$(ps -o etime= -p "$ff" | tr -d ' ' | awk -F: '{ if (NF==3) print $1*3600+$2*60+$3; else print $1*60+$2 }')
      [ "${s:-0}" -ge 45 ] && { echo "$(date -u +%FT%TZ) killed firefox $ff (parent probe $probe in $cwd, ${s}s)" >> "$LOG"; kill "$ff"; }
    done
  done
  sleep 5
done
