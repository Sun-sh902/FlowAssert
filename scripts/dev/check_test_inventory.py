"""Fail a test run that is green only because tests did not run (round 02 hardening FIX01). Read-only.

    /usr/bin/python3 -I -B scripts/dev/check_test_inventory.py vitest REPORT.json   (npx vitest run --reporter=json)
    /usr/bin/python3 -I -B scripts/dev/check_test_inventory.py pytest JUNIT.xml     (pytest --junitxml, portable set)

Compares the run with scripts/dev/test-inventory.json. FAIL when a mandatory suite is missing or unlisted, a suite
has a different number of required tests, or any required test is skipped, pending or not passed. An optional
group (historical evidence outside this repository) is reported RAN or NOT RUN, never silently counted as passed.
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


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("vitest", "pytest"):
        print(__doc__, file=sys.stderr)
        return 2
    kind, path = sys.argv[1], sys.argv[2]
    problems, notes = vitest(json.loads(Path(path).read_text(encoding="utf-8"))) if kind == "vitest" else pytest(path)
    for n in notes:
        print(n)
    for p in problems:
        print(f"FAIL     {p}")
    print(f"{kind} inventory: {'FAIL' if problems else 'OK'} ({len(problems)} problems)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
