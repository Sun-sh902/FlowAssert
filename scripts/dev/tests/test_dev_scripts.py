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
