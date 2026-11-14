#!/usr/bin/env python3
"""Sample the resident memory of the app's processes on a simulator until a file appears; print the peaks as JSON.

    python3 ios/scripts/peak_memory.py STOP_FILE

On a simulator the app, its WebKit WebContent process (where the checker runs) and WebKit's Networking process (which
holds the Blobs the workbook reader reads) are processes of the Mac, so `ps` sees them. Only processes that start after
the sampler are counted. RSS on the Mac's simulator is not an iPhone's memory footprint; it is used to compare runs.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

KINDS = {"com.apple.WebKit.WebContent": "webcontent", "com.apple.WebKit.Networking": "networking", "FlowAssert.app/FlowAssert": "app"}


def processes():
    out = subprocess.run(["ps", "-axo", "pid=,rss=,command="], capture_output=True, text=True).stdout
    for line in out.splitlines():
        pid, rss, command = line.strip().split(None, 2)
        if "CoreSimulator" not in command and "Debug-iphonesimulator" not in command:
            continue
        for needle, kind in KINDS.items():
            if needle in command:
                yield int(pid), kind, int(rss) * 1024


def main(stop):
    before = {pid for pid, _, _ in processes()}
    peaks = {}
    while not Path(stop).exists():
        for pid, kind, rss in processes():
            if pid in before:
                continue
            key = f"{kind}:{pid}"
            peaks[key] = max(peaks.get(key, 0), rss)
        time.sleep(0.1)
    by_kind = {}
    for key, rss in peaks.items():
        kind = key.split(":")[0]
        by_kind[kind] = max(by_kind.get(kind, 0), rss)
    print(json.dumps({k: round(v / 1048576, 1) for k, v in sorted(by_kind.items())}))


if __name__ == "__main__":
    main(sys.argv[1])
