"""Fail a test run that is green only because tests did not run (round 02 hardening FIX01). Read-only.

    /usr/bin/python3 -I -B scripts/dev/check_test_inventory.py vitest REPORT.json   (npx vitest run --reporter=json)
    /usr/bin/python3 -I -B scripts/dev/check_test_inventory.py pytest JUNIT.xml     (pytest --junitxml, portable set)
    /usr/bin/python3 -I -B scripts/dev/check_test_inventory.py playwright GATE REPORT.json   (--reporter=json; FIX02)
    /usr/bin/python3 -I -B scripts/dev/check_test_inventory.py matrix GATE results.json      (ui/scripts/dev/fix04-product-review.mjs)

Compares the run with scripts/dev/test-inventory.json. FAIL when a mandatory suite is missing or unlisted, a suite
has a different number of required tests, or any required test is skipped, pending or not passed. An optional
group (historical evidence outside this repository) is reported RAN or NOT RUN, never silently counted as passed.
Playwright (Round 02 hardening FIX02): every test of the gate, by project › file › describe › title, must have its
inventoried outcome — "passed" N times (N > 1 only with --repeat-each), or "skipped" with exactly the declared skip
reason. A test that did not run (a serial file stopped by an earlier failure) carries no declared reason and FAILS, as do
an unlisted test, a missing one and any error outside a test. Captures interrupted by a page close after a test ended
(annotation capture-interrupted-by-close, ui/e2e/capture-lifecycle.ts) are listed, not hidden.
Responsive matrix (residual closeout R13): every inventoried cell (engine × theme × width × scenario) must be present
exactly once with no problem, and must carry the results of the checks it claims — layout, axe and scroll containers in
every cell, the keyboard scroll of the History table at 768 and 1024, and twelve focus stops on the Overview. A screenshot
without those results does not count.
Exit 0 = every required test executed and passed; 1 = FAIL; 2 = usage.
"""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

INVENTORY = json.loads((Path(__file__).resolve().parent / "test-inventory.json").read_text(encoding="utf-8"))


def vitest(report):
    inv = INVENTORY["vitest"]
    problems, notes = [], []
    seen = {}
    for suite in report["testResults"]:
        name = suite["name"]
        rel = "src/" + name.split("/src/", 1)[1] if "/src/" in name else name
        seen[rel] = suite
    for rel in sorted(set(inv["files"]) - set(seen)):
        problems.append(f"{rel}: mandatory suite did not run")
    for rel in sorted(set(seen) - set(inv["files"])):
        problems.append(f"{rel}: suite is not in scripts/dev/test-inventory.json")
    for rel, suite in sorted(seen.items()):
        if rel not in inv["files"]:
            continue
        groups = [g for g in inv["optional"] if g["file"] == rel]
        required, optional = [], {g["describe"]: [] for g in groups}
        for a in suite["assertionResults"]:
            top = (a.get("ancestorTitles") or [""])[0]
            (optional[top] if top in optional else required).append(a)
        if suite.get("status") != "passed" and not suite["assertionResults"]:
            problems.append(f"{rel}: suite failed to load: {(suite.get('message') or '').strip()[:200]}")
        if len(required) != inv["files"][rel]:
            problems.append(f"{rel}: {len(required)} required tests, inventory has {inv['files'][rel]}")
        not_passed = [a for a in required if a["status"] != "passed"]
        for a in not_passed[:5]:
            problems.append(f"{rel}: required test {a['status']}: {a['fullName']}")
        if len(not_passed) > 5:
            problems.append(f"{rel}: … {len(not_passed) - 5} more required tests not passed")
        for g in groups:
            tests = optional[g["describe"]]
            states = {a["status"] for a in tests}
            if states == {"passed"} and len(tests) == g["tests_when_present"]:
                notes.append(f"RAN      {rel} › {g['describe']} ({len(tests)} passed)")
            elif tests and states <= {"skipped", "pending"} and len(tests) == g["tests_when_absent_skipped"]:
                notes.append(f"NOT RUN  {rel} › {g['describe']} — {g['category']}")
            else:
                problems.append(f"{rel} › {g['describe']}: unexpected optional result {sorted(states)} × {len(tests)}")
    return problems, notes


def pytest(xml_path):
    inv = INVENTORY["pytest"]["portable"]
    cases = ET.parse(xml_path).getroot().iter("testcase")
    problems, ids = [], []
    for case in cases:
        node = f"{case.get('classname', '').replace('.', '/')}.py::{case.get('name')}"
        ids.append(node)
        for tag in ("skipped", "failure", "error"):
            if case.find(tag) is not None:
                problems.append(f"{node}: {tag}")
    if len(ids) != inv["tests"]:
        problems.append(f"{len(ids)} portable backend tests ran, inventory has {inv['tests']}")
    for node in inv["deselected"]:
        if node in ids:
            problems.append(f"{node}: custody test ran inside the portable gate")
    return problems, [f"portable backend tests: {len(ids)}; custody tests run separately: {', '.join(inv['deselected'])}"]


def playwright(gate, report):
    inv = INVENTORY["playwright"].get(gate)
    if inv is None:
        return [f"gate {gate} is not in scripts/dev/test-inventory.json"], []
    problems, notes, seen = [], [], {}

    def walk(suite, titles):
        for spec in suite.get("specs", []):
            for t in spec["tests"]:
                seen.setdefault(" › ".join([t["projectName"], spec["file"], *titles, spec["title"]]), []).append(t)
        for child in suite.get("suites", []):
            walk(child, titles + ([child["title"]] if child.get("title") != child.get("file") else []))

    for suite in report.get("suites", []):
        walk(suite, [])
    for err in report.get("errors", []):
        problems.append(f"error outside a test: {(err.get('message') or '').strip()[:200]}")
    for key in sorted(set(inv) - set(seen)):
        problems.append(f"{key}: mandatory test did not run")
    for key in sorted(set(seen) - set(inv)):
        problems.append(f"{key}: test is not in scripts/dev/test-inventory.json")
    for key, runs in sorted(seen.items()):
        want = inv.get(key)
        if want is None:
            continue
        for t in runs:
            for a in t.get("annotations", []):
                if a.get("type") == "capture-interrupted-by-close":
                    notes.append(f"INTERRUPTED capture after the test's last settle: {key}: {a.get('description')}")
        if "skipped" in want:
            reasons = [[a.get("description") for a in t.get("annotations", []) if a.get("type") == "skip"] for t in runs]
            if len(runs) != want["skipped"] or any(t["status"] != "skipped" or r != [want["reason"]] for t, r in zip(runs, reasons)):
                problems.append(f"{key}: expected {want['skipped']} declared skip(s) ({want['reason']}), got {[(t['status'], r) for t, r in zip(runs, reasons)]}")
            continue
        outcomes = [(t["status"], [r["status"] for r in t.get("results", [])]) for t in runs]
        if len(runs) != want["passed"] or any(o != ("expected", ["passed"]) for o in outcomes):
            problems.append(f"{key}: expected {want['passed']} × passed, got {outcomes}")
    passed = sum(len(r) for k, r in seen.items() if "passed" in inv.get(k, {}))
    skipped = sum(len(r) for k, r in seen.items() if "skipped" in inv.get(k, {}))
    notes.append(f"{gate}: {passed} required test runs, {skipped} declared skips, {len(seen)} distinct tests")
    return problems, notes


def matrix(gate, rows):
    inv = INVENTORY["matrix"].get(gate)
    if inv is None:
        return [f"gate {gate} is not in scripts/dev/test-inventory.json"], []
    if not isinstance(rows, list):
        return ["results are not a list of cells"], []
    want = {f"{e}-{t}-{w}-{n}" for e in inv["engines"] for t in inv["themes"] for w in inv["widths"] for n in inv["scenarios"]}
    problems, seen = [], {}
    for row in rows:
        key = row.get("key") if isinstance(row, dict) else None
        if key in seen:
            problems.append(f"{key}: cell reported twice")
        seen[key] = row
    for key in sorted(want - set(seen)):
        problems.append(f"{key}: cell did not run")
    for key in sorted(set(seen) - want, key=str):
        problems.append(f"{key}: cell is not in scripts/dev/test-inventory.json")
    for key in sorted(want & set(seen)):
        row = seen[key]
        if row.get("problems"):
            problems.append(f"{key}: {'; '.join(map(str, row['problems']))[:300]}")
            continue
        missing = [k for k in ("layout", "axe", "scrollers", "focus") if not isinstance(row.get(k), (dict, list))]
        if row.get("name") == "history" and row.get("width") in inv["keyboard_scroll_widths"] and not isinstance(row.get("tableScroll"), dict):
            missing.append("tableScroll")
        if row.get("name") == "overview" and len(row.get("focus") or []) != inv["overview_focus_stops"]:
            missing.append(f"{inv['overview_focus_stops']} focus stops")
        if missing:
            problems.append(f"{key}: checks not executed ({', '.join(missing)})")
    browsers = sorted({f"{r.get('engine')} {r.get('browser')}" for r in seen.values() if isinstance(r, dict)})
    passed = sum(1 for k in want & set(seen) if not seen[k].get("problems"))
    return problems, [f"{gate}: {passed} of {len(want)} cells passed · {', '.join(browsers)}"]


def main():
    args = sys.argv[1:]
    if not ((len(args) == 2 and args[0] in ("vitest", "pytest")) or (len(args) == 3 and args[0] in ("playwright", "matrix"))):
        print(__doc__, file=sys.stderr)
        return 2
    kind, path = args[0], args[-1]
    if kind == "matrix":
        try:
            problems, notes = matrix(args[1], json.loads(Path(path).read_text(encoding="utf-8")))
        except (OSError, ValueError) as e:  # the matrix stopped before it wrote its results
            problems, notes = [f"results {path} missing or unreadable: {e}"], []
    elif kind == "playwright":
        try:
            report = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:  # the run ended before its reporter wrote the file
            report = None
            problems, notes = [f"report {path} missing or unreadable: {e}"], []
        if report is not None:
            problems, notes = playwright(args[1], report)
    else:
        problems, notes = vitest(json.loads(Path(path).read_text(encoding="utf-8"))) if kind == "vitest" else pytest(path)
    for n in notes:
        print(n)
    for p in problems:
        print(f"FAIL     {p}")
    print(f"{kind} inventory: {'FAIL' if problems else 'OK'} ({len(problems)} problems)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
