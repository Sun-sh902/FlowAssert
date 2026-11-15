#!/usr/bin/env python3
"""Print the xcodebuild destinations the app's tests run on: the newest iPhone simulator and an iPad simulator, on the
newest iOS runtime this Xcode has with both. Standard library only.

    python3 ios/scripts/simulators.py            one destination per line (platform=iOS Simulator,id=...)
    python3 ios/scripts/simulators.py --names    the devices' names instead

"Newest" is read from the name: the highest model number, then Pro before the others and the plain size before Max
and Plus. An iPad Pro is preferred to the other iPads, and the 11-inch to the larger one.
"""
import json
import re
import subprocess
import sys


def simctl(*args):
    return json.loads(subprocess.run(["xcrun", "simctl", "list", *args, "-j"], check=True, capture_output=True, text=True).stdout)


def version(runtime):
    return tuple(int(p) for p in re.findall(r"\d+", runtime.get("version", "0")))


def number(name):
    found = re.findall(r"\d+", name)
    return int(found[0]) if found else 0


def iphone_rank(name):
    return (number(name), "Pro" in name, "Max" not in name and "Plus" not in name, "e" not in name.split()[-1:])


def ipad_rank(name):
    return ("iPad Pro" in name, "11-inch" in name, max((int(m) for m in re.findall(r"M(\d+)", name)), default=0))


def main(argv):
    runtimes = [r for r in simctl("runtimes")["runtimes"] if r.get("platform", r.get("name", "")).startswith("iOS") and r.get("isAvailable")]
    if not runtimes:
        print("no iOS simulator runtime is installed", file=sys.stderr)
        return 1
    listed = simctl("devices", "available")["devices"]
    # A runtime made for one device shares its version with the general one: take the newest that has both.
    for runtime in sorted(runtimes, key=lambda r: (version(r), len(listed.get(r["identifier"], []))), reverse=True):
        devices = [d for d in listed.get(runtime["identifier"], []) if d.get("isAvailable", True)]
        iphones = [d for d in devices if d["name"].startswith("iPhone")]
        ipads = [d for d in devices if d["name"].startswith("iPad")]
        if iphones and ipads:
            break
    else:
        print(f"no iOS runtime has both an iPhone and an iPad simulator: {[r['name'] for r in runtimes]}", file=sys.stderr)
        return 1
    chosen = [max(iphones, key=lambda d: iphone_rank(d["name"])), max(ipads, key=lambda d: ipad_rank(d["name"]))]
    for d in chosen:
        print(d["name"] if "--names" in argv else f"platform=iOS Simulator,id={d['udid']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
