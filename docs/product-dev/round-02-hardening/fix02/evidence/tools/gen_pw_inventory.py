"""FIX02 one-off: derive the Playwright section of scripts/dev/test-inventory.json from a run's JSON reports.
Refuses to bless a run with any failed, flaky or did-not-run test, any skip without a declared reason, or any error
outside a test. Each declared skip reason is printed so it can be checked against the specs' test.skip(...) lines.
    python3 gen_pw_inventory.py RUN_DIR INVENTORY.json"""
import json, sys
from pathlib import Path
run, inv_path = Path(sys.argv[1]), Path(sys.argv[2])
GATES = ["e2e-static", "rules-cls-repeat", "e2e-workspace", "e2e-history", "e2e-lookup", "e2e-local"]
inv = json.loads(inv_path.read_text(encoding="utf-8"))
out, bad, reasons = {}, [], {}
for gate in GATES:
    report = json.loads((run / f"{gate}.json").read_text(encoding="utf-8"))
    if report.get("errors"): bad.append(f"{gate}: errors outside tests")
    seen = {}
    def walk(suite, titles):
        for spec in suite.get("specs", []):
            for t in spec["tests"]:
                seen.setdefault(" › ".join([t["projectName"], spec["file"], *titles, spec["title"]]), []).append(t)
        for c in suite.get("suites", []):
            walk(c, titles + ([c["title"]] if c.get("title") != c.get("file") else []))
    for s in report["suites"]: walk(s, [])
    entries = {}
    for key, runs in sorted(seen.items()):
        if any(" › " in part for part in []): pass
        statuses = {(t["status"], tuple(r["status"] for r in t["results"])) for t in runs}
        if statuses == {("expected", ("passed",))}:
            entries[key] = {"passed": len(runs)}
            continue
        skips = {tuple(a["description"] for a in t["annotations"] if a["type"] == "skip") for t in runs}
        if {s for s, _ in statuses} == {"skipped"} and len(skips) == 1 and len(next(iter(skips))) == 1:
            reason = next(iter(skips))[0]
            entries[key] = {"skipped": len(runs), "reason": reason}
            reasons[reason] = reasons.get(reason, 0) + len(runs)
            continue
        bad.append(f"{gate}: {key}: {statuses} {skips}")
    out[gate] = entries
    print(f"{gate}: {sum(v.get('passed', 0) for v in entries.values())} required runs, {sum(v.get('skipped', 0) for v in entries.values())} declared skips, {len(entries)} tests")
if bad:
    print("REFUSED:", *bad, sep="\n  "); sys.exit(1)
for r, n in sorted(reasons.items()): print(f"  skip × {n}: {r}")
inv["playwright"] = out
inv_path.write_text(json.dumps(inv, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
