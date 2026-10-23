"""Workspace script checks (round 02 hardening FIX01). Run with the Service venv:
    service/.venv/bin/python -B -m pytest -p no:cacheprovider -q scripts/dev/tests
Everything happens in pytest's tmp_path; no protected root or committed evidence is read for writing."""
import copy
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
INVENTORY = json.loads((ROOT / "scripts/dev/test-inventory.json").read_text(encoding="utf-8"))


def load_protected_integrity():
    spec = importlib.util.spec_from_file_location("protected_integrity_under_test", ROOT / "service/scripts/protected_integrity.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def protected(tmp_path, monkeypatch):
    """A disposable parent holding every protected root named in the pinned baseline, one file each."""
    module = load_protected_integrity()
    names = list(json.loads((ROOT / "service/evidence/protected-before.json").read_text()))
    parent = tmp_path / "parent"
    for name in names:
        (parent / name).mkdir(parents=True)
        (parent / name / "file.txt").write_text("x")
    for target in ("A", "B"):
        (tmp_path / target / "sub").mkdir(parents=True)
        (tmp_path / target / "sub" / "f").write_text(target)
    monkeypatch.setattr(module, "PROTECTED_PARENT", parent)
    root = parent / names[0]
    return lambda: module.snapshot()[names[0]]["files"], root, tmp_path


def test_directory_symlink_added_retargeted_and_removed_are_differences(protected):
    files, root, tmp = protected
    before = files()
    os.symlink(tmp / "A", root / "linkdir")
    added = files()
    assert added["linkdir"] == "link:" + str(tmp / "A")
    os.remove(root / "linkdir")
    os.symlink(tmp / "B", root / "linkdir")
    retargeted = files()
    os.remove(root / "linkdir")
    assert before != added != retargeted and files() == before


def test_real_directories_and_file_symlinks_unchanged(protected):
    files, root, tmp = protected
    (root / "realdir").mkdir()
    (root / "realdir" / "g").write_text("g")
    os.symlink(tmp / "A" / "sub" / "f", root / "filelink")
    snap = files()
    assert "realdir" not in snap and snap["realdir/g"] and snap["filelink"] == "link:" + str(tmp / "A" / "sub" / "f")


def test_missing_protected_root_is_an_error_not_an_empty_tree(protected):
    files, root, _ = protected
    os.rename(root, root.with_name(root.name + "-moved"))
    with pytest.raises(FileNotFoundError):
        files()


# ---------- scripts/dev/check_test_inventory.py ----------

def vitest_report(optional_present=True):
    results = []
    for rel, n in INVENTORY["vitest"]["files"].items():
        tests = [{"ancestorTitles": ["suite"], "title": f"t{i}", "fullName": f"suite t{i}", "status": "passed"} for i in range(n)]
        for g in INVENTORY["vitest"]["optional"]:
            if g["file"] == rel:
                k = g["tests_when_present"] if optional_present else g["tests_when_absent_skipped"]
                tests += [{"ancestorTitles": [g["describe"]], "title": f"o{i}", "fullName": f"o{i}", "status": "passed" if optional_present else "skipped"} for i in range(k)]
        results.append({"name": f"/anywhere/ui/{rel}", "status": "passed", "assertionResults": tests})
    return {"testResults": results}


def check(tmp_path, kind, payload):
    path = tmp_path / ("report.json" if kind == "vitest" else "junit.xml")
    path.write_text(json.dumps(payload) if kind == "vitest" else payload)
    r = subprocess.run([sys.executable, "-I", "-B", str(ROOT / "scripts/dev/check_test_inventory.py"), kind, str(path)], capture_output=True, text=True)
    return r.returncode, r.stdout


def test_inventory_accepts_a_complete_run(tmp_path):
    rc, out = check(tmp_path, "vitest", vitest_report())
    assert rc == 0 and "RAN" in out


def test_inventory_reports_absent_optional_evidence_as_not_run(tmp_path):
    rc, out = check(tmp_path, "vitest", vitest_report(optional_present=False))
    assert rc == 0 and "NOT RUN" in out


def test_inventory_fails_a_skipped_required_test(tmp_path):
    report = vitest_report()
    report["testResults"][0]["assertionResults"][0]["status"] = "skipped"
    rc, out = check(tmp_path, "vitest", report)
    assert rc == 1 and "required test skipped" in out


def test_inventory_fails_a_missing_suite_and_an_unlisted_one(tmp_path):
    report = vitest_report()
    gone = report["testResults"].pop()
    extra = copy.deepcopy(gone)
    extra["name"] = "/anywhere/ui/src/test/new.test.ts"
    report["testResults"].append(extra)
    rc, out = check(tmp_path, "vitest", report)
    assert rc == 1 and "mandatory suite did not run" in out and "not in scripts/dev/test-inventory.json" in out


def test_inventory_fails_a_suite_that_did_not_load(tmp_path):
    report = vitest_report()
    report["testResults"][0].update(status="failed", assertionResults=[], message="EPERM")
    rc, out = check(tmp_path, "vitest", report)
    assert rc == 1 and "failed to load" in out


def junit(n, extra=""):
    cases = "".join(f'<testcase classname="tests.test_x" name="t{i}"/>' for i in range(n))
    return f'<?xml version="1.0"?><testsuites><testsuite>{cases}{extra}</testsuite></testsuites>'


def test_pytest_inventory_counts_and_custody_separation(tmp_path):
    n = INVENTORY["pytest"]["portable"]["tests"]
    assert check(tmp_path, "pytest", junit(n))[0] == 0
    assert check(tmp_path, "pytest", junit(n - 1))[0] == 1
    assert check(tmp_path, "pytest", junit(n - 1, '<testcase classname="tests.test_y" name="s"><skipped/></testcase>'))[0] == 1
    custody = '<testcase classname="tests.test_service" name="test_protected_repository_integrity"/>'
    rc, out = check(tmp_path, "pytest", junit(n - 1, custody))
    assert rc == 1 and "custody test ran inside the portable gate" in out


# ---------- check_test_inventory.py playwright (FIX02) ----------

def playwright_report(gate):
    """A report in Playwright's JSON reporter shape matching the gate's inventory exactly."""
    suites = []
    for key, want in INVENTORY["playwright"][gate].items():
        project, file, *titles = key.split(" › ")
        if "skipped" in want:
            tests = [{"projectName": project, "status": "skipped", "annotations": [{"type": "skip", "description": want["reason"]}], "results": [{"status": "skipped"}]}] * want["skipped"]
        else:
            tests = [{"projectName": project, "status": "expected", "annotations": [], "results": [{"status": "passed"}]}] * want["passed"]
        node = {"title": titles[-2] if len(titles) > 1 else file, "file": file, "specs": [{"title": titles[-1], "file": file, "tests": copy.deepcopy(tests)}], "suites": []}
        for describe in reversed(titles[:-2]):
            node = {"title": describe, "file": file, "specs": [], "suites": [node]}
        suites.append(node if len(titles) == 1 else {"title": file, "file": file, "specs": [], "suites": [node]})
    return {"suites": suites, "errors": []}


def check_playwright(tmp_path, gate, report):
    path = tmp_path / "playwright.json"
    path.write_text(json.dumps(report))
    r = subprocess.run([sys.executable, "-I", "-B", str(ROOT / "scripts/dev/check_test_inventory.py"), "playwright", gate, str(path)], capture_output=True, text=True)
    return r.returncode, r.stdout


def first_spec(report, project_skipped=False):
    stack = list(report["suites"])
    while stack:
        s = stack.pop(0)
        for spec in s["specs"]:
            if (spec["tests"][0]["status"] == "skipped") == project_skipped:
                return spec
        stack.extend(s["suites"])


@pytest.mark.parametrize("gate", ["e2e-static", "rules-cls-repeat", "e2e-workspace", "e2e-history", "e2e-lookup", "e2e-local"])
def test_playwright_inventory_accepts_a_complete_run(tmp_path, gate):
    rc, out = check_playwright(tmp_path, gate, playwright_report(gate))
    assert rc == 0, out


def test_playwright_inventory_fails_a_test_that_did_not_run(tmp_path):
    # A serial file stopped by an earlier failure: the later tests are "skipped" without a declared reason.
    report = playwright_report("e2e-local")
    first_spec(report)["tests"][0].update(status="skipped", annotations=[], results=[])
    rc, out = check_playwright(tmp_path, "e2e-local", report)
    assert rc == 1 and "× passed" in out


def test_playwright_inventory_fails_an_undeclared_skip_reason(tmp_path):
    report = playwright_report("e2e-local")
    first_spec(report, project_skipped=True)["tests"][0]["annotations"] = [{"type": "skip", "description": "something else"}]
    rc, out = check_playwright(tmp_path, "e2e-local", report)
    assert rc == 1 and "declared skip" in out


def test_playwright_inventory_fails_missing_unlisted_and_outside_errors(tmp_path):
    report = playwright_report("e2e-lookup")
    spec = first_spec(report)
    spec["title"] += " (renamed)"
    report["errors"] = [{"message": "Error: response.allHeaders: Target page, context or browser has been closed"}]
    rc, out = check_playwright(tmp_path, "e2e-lookup", report)
    assert rc == 1 and "mandatory test did not run" in out and "not in scripts/dev/test-inventory.json" in out and "error outside a test" in out


def test_playwright_inventory_counts_repeats(tmp_path):
    report = playwright_report("rules-cls-repeat")
    first_spec(report)["tests"].pop()
    rc, out = check_playwright(tmp_path, "rules-cls-repeat", report)
    assert rc == 1 and "expected 20 × passed" in out


def test_playwright_inventory_lists_interrupted_captures(tmp_path):
    report = playwright_report("e2e-local")
    first_spec(report)["tests"][0]["annotations"] = [{"type": "capture-interrupted-by-close", "description": "http://127.0.0.1:4184/api/v1/x"}]
    rc, out = check_playwright(tmp_path, "e2e-local", report)
    assert rc == 0 and "INTERRUPTED capture" in out


def test_playwright_inventory_refuses_an_unknown_gate(tmp_path):
    rc, out = check_playwright(tmp_path, "e2e-unknown", {"suites": [], "errors": []})
    assert rc == 1 and "not in scripts/dev/test-inventory.json" in out


def test_playwright_inventory_fails_a_missing_report(tmp_path):
    r = subprocess.run([sys.executable, "-I", "-B", str(ROOT / "scripts/dev/check_test_inventory.py"), "playwright", "e2e-local", str(tmp_path / "absent.json")], capture_output=True, text=True)
    assert r.returncode == 1 and "missing or unreadable" in r.stdout


# ---------- residual closeout R13: the responsive matrix as a release gate ----------

def matrix_rows():
    inv = INVENTORY["matrix"]["responsive-matrix"]
    rows = []
    for e in inv["engines"]:
        for t in inv["themes"]:
            for w in inv["widths"]:
                for n in inv["scenarios"]:
                    row = {"key": f"{e}-{t}-{w}-{n}", "engine": e, "browser": "1.0", "theme": t, "width": w, "name": n,
                           "layout": {}, "axe": [], "scrollers": [], "focus": [], "problems": []}
                    if n == "history" and w in inv["keyboard_scroll_widths"]:
                        row["tableScroll"] = {"scrollLeft": 1, "maxScroll": 1}
                    if n == "overview":
                        row["focus"] = [{"visible": True}] * inv["overview_focus_stops"]
                    rows.append(row)
    return rows


def check_matrix(tmp_path, rows, gate="responsive-matrix"):
    path = tmp_path / "results.json"
    if rows is not None:
        path.write_text(json.dumps(rows))
    r = subprocess.run([sys.executable, "-I", "-B", str(ROOT / "scripts/dev/check_test_inventory.py"), "matrix", gate, str(path)], capture_output=True, text=True)
    return r.returncode, r.stdout


def test_matrix_inventory_accepts_every_cell_passed(tmp_path):
    rc, out = check_matrix(tmp_path, matrix_rows())
    assert rc == 0 and "200 of 200 cells passed" in out


@pytest.mark.parametrize("mutation, message", [
    (lambda rows: rows.pop(), "cell did not run"),
    (lambda rows: rows.append(dict(rows[0])), "cell reported twice"),
    (lambda rows: rows.append({**rows[0], "key": "firefox-light-375-overview"}), "not in scripts/dev/test-inventory.json"),
    (lambda rows: rows[5].update(problems=["horizontal overflow"]), "horizontal overflow"),
    (lambda rows: rows[5].pop("axe"), "checks not executed (axe)"),
    (lambda rows: next(r for r in rows if r["name"] == "history" and r["width"] == 1024).pop("tableScroll"), "checks not executed (tableScroll)"),
    (lambda rows: next(r for r in rows if r["name"] == "overview").update(focus=[]), "12 focus stops"),
])
def test_matrix_inventory_fails_a_missing_extra_failed_or_unchecked_cell(tmp_path, mutation, message):
    rows = matrix_rows()
    mutation(rows)
    rc, out = check_matrix(tmp_path, rows)
    assert rc == 1 and message in out


def test_matrix_inventory_fails_missing_results_and_unknown_gate(tmp_path):
    assert check_matrix(tmp_path, None)[0] == 1
    rc, out = check_matrix(tmp_path, matrix_rows(), gate="no-such-matrix")
    assert rc == 1 and "not in scripts/dev/test-inventory.json" in out
