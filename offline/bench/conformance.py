#!/usr/bin/env python3
"""Run the golden cases and the conformance cases against an implementation of the check (docs/conformance.md).

    python3 offline/bench/conformance.py                       the reference implementation, from this clone
    python3 offline/bench/conformance.py --command "my-verify" another command-line implementation
    python3 offline/bench/conformance.py --evaluator "my-eval" another evaluator, for offline/conformance/*.json

Options:
    --command "CMD ARG..."    the command to run in place of flowassert-verify (split as a shell would split it)
    --evaluator "CMD ARG..."  a command that reads one conformance case as JSON on standard input and prints
                              {"cohort_state": ..., "record_states": [...], "expected_total": ...}
    --no-golden, --no-cases   leave out the golden cases, or the conformance cases
    --bytes                   also require report.json to be the golden file byte for byte
    --html                    also ask for --html and require report.html byte for byte
    --connectors              also run the cases whose rows are read by a connector, against the local fakes
    --only NAME               run only this case; repeatable
    --list                    print the names of the cases and exit

A golden case passes when the command gives the golden exit status, standard output and standard error, writes a
report exactly when the golden case has one, the report is valid against the JSON Schema of its schema_version, and it
equals the golden report as a JSON value. Only `evaluated_at` (and a connector's read times) may differ: each must be
a UTC time, and is not compared. Exit 0 when every case passes, 1 when any fails, 2 for a usage error.

Standard library only. Nothing here contacts a network: connector cases talk to a fake on a loopback port.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "offline"))
import json_schema  # noqa: E402

GOLDEN = ROOT / "offline" / "golden"
CASES = ROOT / "offline" / "conformance"
SCHEMAS = ROOT / "docs" / "schema"
OUTPUTS = ("exit_status.txt", "stdout.txt", "stderr.txt", "report.json", "report.html")
NOT_INPUTS = OUTPUTS + ("case.json", "requests.json", "sheet-responses.json", "hubspot-responses.json")
UTC = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{6})?Z")
TIMEOUT = 120


def connector_folders():
    """The golden folders of the connectors that exist in this clone, with how each is run."""
    folders = []
    if (ROOT / "offline" / "golden-sheets").is_dir():
        folders.append((ROOT / "offline" / "golden-sheets", "sheets"))
    if (ROOT / "offline" / "golden-hubspot").is_dir():
        folders.append((ROOT / "offline" / "golden-hubspot", "hubspot"))
    return folders


def _times(value, found):
    """Replace every UTC time held under a member named like a time; collect what was there."""
    if isinstance(value, dict):
        out = {}
        for name, item in value.items():
            if name in ("evaluated_at", "read_at", "read_finished_at"):
                found.append(item)
                out[name] = "TIME"
            else:
                out[name] = _times(item, found)
        return out
    if isinstance(value, list):
        return [_times(item, found) for item in value]
    return value


def _without_times(text):
    return UTC.sub("TIME", text)


def _schema(version):
    path = SCHEMAS / f"report-v{version}.schema.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def compare(folder, work, code, stdout, stderr, options):
    """The ways one run differs from its golden case; empty when it passes."""
    problems = []
    expected_code = int((folder / "exit_status.txt").read_text(encoding="utf-8"))
    if code != expected_code:
        problems.append(f"exit status {code}, expected {expected_code}")
    for name, actual in (("stdout.txt", stdout), ("stderr.txt", stderr)):
        expected = (folder / name).read_bytes()
        if _without_times(actual.decode("utf-8", "replace")) != _without_times(expected.decode("utf-8")):
            problems.append(f"{name[:-4]} differs: {actual[:200]!r}, expected {expected[:200]!r}")
    golden_json = folder / "report.json"
    actual_json = work / "report.json"
    if golden_json.exists() != actual_json.exists():
        problems.append("report.json " + ("was not written" if golden_json.exists() else "was written, and the case has none"))
    elif golden_json.exists():
        try:
            actual = json.loads(actual_json.read_text(encoding="utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            return problems + [f"report.json is not UTF-8 JSON ({e})"]
        expected = json.loads(golden_json.read_text(encoding="utf-8"))
        schema = _schema(actual.get("schema_version") if isinstance(actual, dict) else None)
        if schema is None:
            problems.append("report.json has a schema_version without a schema")
        else:
            problems += [f"report.json is not valid: {e}" for e in json_schema.validate(schema, actual)[:5]]
        times = []
        if _times(actual, times) != _times(expected, []):
            problems.append("report.json differs from the golden report as a JSON value")
        problems += [f"report.json has {t!r} where a UTC time belongs" for t in times
                     if not (isinstance(t, str) and UTC.fullmatch(t))]
        if options.bytes and _without_times(actual_json.read_text(encoding="utf-8")) != _without_times(
                golden_json.read_text(encoding="utf-8")):
            problems.append("report.json differs from the golden report byte for byte")
    if options.html:
        golden_html, actual_html = folder / "report.html", work / "report.html"
        if golden_html.exists() != actual_html.exists():
            problems.append("report.html " + ("was not written" if golden_html.exists() else "was written, and the case has none"))
        elif golden_html.exists() and _without_times(actual_html.read_bytes().decode("utf-8", "replace")) != _without_times(
                golden_html.read_text(encoding="utf-8")):
            problems.append("report.html differs from the golden report byte for byte")
    return problems


def run_command(command, args, work, options, environ=None):
    outputs = ["--json", "report.json"] + (["--html", "report.html"] if options.html else [])
    env = {name: value for name, value in os.environ.items() if not name.startswith("FLOWASSERT_")}
    env.update(environ or {})
    done = subprocess.run(command + args + outputs, cwd=work, env=env, capture_output=True, timeout=TIMEOUT)
    return done.returncode, done.stdout, done.stderr


def copy_inputs(folder, work):
    for path in folder.iterdir():
        if path.name not in NOT_INPUTS:
            shutil.copyfile(path, work / path.name)


def golden_case(folder, command, options):
    case = json.loads((folder / "case.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        copy_inputs(folder, work)
        code, stdout, stderr = run_command(command, case["args"], work, options)
        return compare(folder, work, code, stdout, stderr, options)


def connector_case(folder, kind, command, options):
    """A case whose rows a connector reads: the fake serves the case's responses, and the requests are compared."""
    import golden  # the fakes and the cases' credentials
    case = json.loads((folder / "case.json").read_text(encoding="utf-8"))
    responses = json.loads((folder / f"{'sheet' if kind == 'sheets' else kind}-responses.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        copy_inputs(folder, work)
        with golden.fake_for(kind, case, responses) as api:
            environ = golden.environ_for(kind, case, api.endpoint)
            code, stdout, stderr = run_command(command, case["args"], work, options, environ)
        problems = compare(folder, work, code, stdout, stderr, options)
        expected = json.loads((folder / "requests.json").read_text(encoding="utf-8"))
        if golden.requests_of(kind, api) != expected:
            problems.append("the requests sent differ from requests.json")
        return problems


def evaluator_case(path, evaluator):
    case = json.loads(path.read_text(encoding="utf-8"))
    given = {name: case[name] for name in ("name", "obligation", "source_rows", "destination_rows", "premises")}
    done = subprocess.run(evaluator, input=json.dumps(given).encode("utf-8"), capture_output=True, timeout=TIMEOUT)
    if done.returncode != 0:
        return [f"the evaluator exited with {done.returncode}: {done.stderr[:200]!r}"]
    try:
        actual = json.loads(done.stdout.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        return [f"the evaluator did not print JSON ({e})"]
    if actual != case["expected"]:
        return [f"gave {json.dumps(actual)}, expected {json.dumps(case['expected'])}"]
    return []


def evaluate_stdin():
    """The reference evaluator as an --evaluator command: one case on standard input, its result on standard output."""
    from flowassert_offline import evaluator_v2
    case = json.load(sys.stdin)
    result = evaluator_v2.evaluate(case["obligation"], case["source_rows"], case["destination_rows"], **case["premises"])
    json.dump({"cohort_state": result["cohort_state"], "record_states": [r["state"] for r in result["records"]],
               "expected_total": result["expected_total"]}, sys.stdout)
    return 0


def collect(options):
    """(label, callable returning problems) for every case asked for."""
    command = shlex.split(options.command) if options.command else [sys.executable, str(ROOT / "offline" / "verify.py")]
    evaluator = (shlex.split(options.evaluator) if options.evaluator
                 else [sys.executable, str(Path(__file__).resolve()), "--evaluate-stdin"])
    runs = []
    if not options.no_golden:
        for folder in sorted(GOLDEN.iterdir()):
            runs.append((f"golden/{folder.name}", lambda f=folder: golden_case(f, command, options)))
        if options.connectors:
            for root, kind in connector_folders():
                for folder in sorted(root.iterdir()):
                    runs.append((f"{root.name}/{folder.name}",
                                 lambda f=folder, k=kind: connector_case(f, k, command, options)))
    if not options.no_cases:
        for path in sorted(CASES.glob("*.json")):
            runs.append((f"conformance/{path.stem}", lambda p=path: evaluator_case(p, evaluator)))
    if options.only:
        wanted = set(options.only)
        runs = [(label, run) for label, run in runs if label in wanted or label.split("/", 1)[1] in wanted]
    return runs


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv == ["--evaluate-stdin"]:
        return evaluate_stdin()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--command")
    parser.add_argument("--evaluator")
    parser.add_argument("--no-golden", action="store_true")
    parser.add_argument("--no-cases", action="store_true")
    parser.add_argument("--bytes", action="store_true")
    parser.add_argument("--html", action="store_true")
    parser.add_argument("--connectors", action="store_true")
    parser.add_argument("--only", action="append", default=[])
    parser.add_argument("--list", action="store_true")
    options = parser.parse_args(argv)
    runs = collect(options)
    if options.list:
        print("\n".join(label for label, _ in runs))
        return 0
    if not runs:
        print("no case to run", file=sys.stderr)
        return 2
    failed = 0
    for label, run in runs:
        try:
            problems = run()
        except subprocess.TimeoutExpired:
            problems = [f"no answer within {TIMEOUT} seconds"]
        except OSError as e:
            problems = [f"the command could not be run ({e.strerror})"]
        if problems:
            failed += 1
            print(f"FAIL  {label}")
            for problem in problems:
                print(f"      {problem}")
        else:
            print(f"PASS  {label}")
    print(f"{len(runs) - failed} of {len(runs)} cases pass")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
