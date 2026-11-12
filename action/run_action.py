"""Run the offline check as a GitHub Action step: the wrapper that action.yml starts.

    python3 -I action/run_action.py

The Action's inputs arrive as environment variables (FA_SOURCE, FA_SOURCE_COMPLETE, ...), set in action.yml's `env:`,
so no input is ever part of a shell script. This script turns them into an argument list for `flowassert-verify`,
runs the checker from this Action's own folder (offline/, never installed and never downloaded), and writes the step's
outputs and job summary. It uses only the standard library and makes no network request.

The checker decides; this script only reports. The step passes on Verified, and also on Unverified with
`fail-on: mismatch`. A refused or failed check (exit status 2 or 4), or any result this script cannot recognise,
fails the step. Logs and job summaries are often public, so by default the checker runs with `--max-details 0`: the
log and the summary show the state, the counts, the premises and the limitations, and no key or field value.

From 1.1.0 a run summary, "What this run shows", follows 1.0's job summary (docs/design/1.1-action.md): the verdict,
the claim, the counts, each premise and whether it was applied, the inputs' kinds and digests, and the records to
resend, read from the JSON report. It holds no compared value, and a key only with summary-keys: true. Credentials
reach the checker in its environment, as in 1.0; this script never reads, prints, stores or summarises one.
"""
import csv
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile

ACTION_ROOT = Path(__file__).resolve().parent.parent
OFFLINE = ACTION_ROOT / "offline"
# Started with -I, so neither the working directory nor PYTHONPATH can put another module (a csv.py in the checked
# out repository, say) before the checker's own. The working directory stays the workflow's, so the paths, refusals
# and summary are the ones flowassert-verify gives for the same arguments.
LAUNCH = ("import sys; sys.path.insert(0, sys.argv.pop(1)); sys.argv[0] = 'flowassert-verify'; "
          "sys.stdout.reconfigure(encoding='utf-8'); sys.stderr.reconfigure(encoding='utf-8', errors='backslashreplace'); "
          "from flowassert_offline.cli import main; sys.exit(main())")

EXIT_STATES = {0: "Verified", 1: "Mismatch", 3: "Unverified"}
FAIL_ON = ("not-verified", "mismatch")
# input name: CLI option, for inputs that take a value. Empty means the option is not given.
VALUES = (("source", "--source"), ("destination", "--destination"), ("config", "--config"), ("key", "--key"),
          ("mapping", "--mapping"), ("scope", "--scope"), ("source-count", "--source-count"),
          ("destination-count", "--destination-count"), ("source-encoding", "--source-encoding"),
          ("destination-encoding", "--destination-encoding"), ("max-bytes", "--max-bytes"),
          ("max-rows", "--max-rows"), ("details", "--details"), ("json", "--json"), ("html", "--html"),
          # 1.1.0: a Google Sheets source, a HubSpot destination, workbooks and the records to resend.
          ("source-sheet", "--source-sheet"), ("source-range", "--source-range"), ("source-timeout", "--source-timeout"),
          ("destination-hubspot", "--destination-hubspot"), ("destination-timeout", "--destination-timeout"),
          ("source-format", "--source-format"), ("source-worksheet", "--source-worksheet"),
          ("destination-format", "--destination-format"), ("destination-worksheet", "--destination-worksheet"),
          ("export-dir", "--export-dir"))
# input name: CLI flag, for boolean inputs. Only "true" and "false" are accepted.
FLAGS = (("source-complete", "--source-complete"), ("destination-complete", "--destination-complete"),
         ("allow-identical-content", "--allow-identical-content"), ("redact-values", "--redact-values"),
         ("skip-source-revision", "--skip-source-revision"))
# The premises, in the order and with the names of the report's `premises`.
PREMISES = (("source_complete", "source-complete"), ("destination_complete", "destination-complete"),
            ("source_count", "source-count"), ("destination_count", "destination-count"))
# Every input and its default in action.yml; an input missing from the environment has its default.
DEFAULTS = dict([(name, "") for name, _ in VALUES] + [(name, "false") for name, _ in FLAGS]
                + [("fields", ""), ("fail-on", "not-verified"), ("show-records", "false"), ("summary", "true"),
                   ("summary-keys", "false")])
HIDDEN = "Record lines are not shown (show-records: false). The JSON and HTML reports, if asked for, have them."
# GitHub refuses a step's summary over 1 MiB; this one stays under 1,000,000 bytes (docs/design/1.1-action.md).
SUMMARY_LIMIT = 1_000_000
MAX_KEYS = 50
KEY_LENGTH = 200
LEFT_OUT = ("The checker's printed summary{keys} {verb} left out here: with {them}, this summary would pass GitHub's "
            "limit of 1 MiB for a step. The step's log has the printed summary, and the reports have every record.")


class Refused(Exception):
    pass


def env_name(name):
    return "FA_" + name.upper().replace("-", "_")


def read_inputs(environ):
    return {name: environ.get(env_name(name), default) for name, default in DEFAULTS.items()}


def boolean(inputs, name):
    value = inputs[name]
    if value not in ("true", "false"):
        raise Refused(f"{name} must be true or false, not {value!r}")
    return value == "true"


def arguments(inputs, report=None):
    """The flowassert-verify arguments for these inputs. Each value is passed as --option=value, so a value that
    starts with "-" stays a value. Raises Refused for an input the CLI never sees: a boolean, fail-on, show-records,
    summary, summary-keys. `report` is where the run summary's JSON report goes when json is not given."""
    flags = {name: boolean(inputs, name) for name, _ in FLAGS}
    show_records = boolean(inputs, "show-records")
    boolean(inputs, "summary")
    boolean(inputs, "summary-keys")
    if inputs["fail-on"] not in FAIL_ON:
        raise Refused(f"fail-on must be one of: {', '.join(FAIL_ON)}")
    argv = [f"{option}={inputs[name]}" for name, option in VALUES if inputs[name] != ""]
    # One field per line; blank lines (such as the one a YAML block leaves at the end) are not fields.
    argv += [f"--field={line}" for line in inputs["fields"].splitlines() if line.strip()]
    argv += [option for name, option in FLAGS if flags[name]]
    if not show_records:
        argv.append("--max-details=0")
    if report is not None:
        argv.append(f"--json={report}")
    return argv


def state_of(code, stdout):
    """The result, from the exit status and the summary's first line, which must agree. Anything else is "failed"."""
    if code == 2:
        return "refused"
    state = EXIT_STATES.get(code)
    if state is not None and stdout.startswith(state + ": "):
        return state
    return "failed"


def passes(state, fail_on):
    return state == "Verified" or (state == "Unverified" and fail_on == "mismatch")


def _escape(text):
    """A workflow command's message, as the runner reads it back."""
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def _write(path, text):
    if path:
        with open(path, "a", encoding="utf-8", newline="") as f:
            f.write(text)


def write_outputs(path, outputs):
    """Append name<<DELIMITER / value / DELIMITER for each output, with a delimiter that is not in any value."""
    text = ""
    for name, value in outputs.items():
        delimiter = "FLOWASSERT_" + secrets.token_hex(16)
        while delimiter in value:
            delimiter = "FLOWASSERT_" + secrets.token_hex(16)
        text += f"{name}<<{delimiter}\n{value}\n{delimiter}\n"
    _write(path, text)


def _fence(text):
    run = longest = 0
    for c in text:
        run = run + 1 if c == "`" else 0
        longest = max(longest, run)
    return "`" * max(3, longest + 1)


def _code(text):
    fence = _fence(text)
    return f"{fence}text\n{text.rstrip(chr(10))}\n{fence}\n\n"


def premise_rows(inputs):
    """Every premise as the report lists it, with what was stated: yes or no for a flag, the number or none."""
    rows = []
    for report_name, name in PREMISES:
        value = inputs[name]
        if name in ("source-complete", "destination-complete"):
            value = "yes" if value == "true" else "no"
        rows.append((report_name, value or "none"))
    if inputs["allow-identical-content"] == "true":
        rows.append(("allow_identical_content", "yes"))
    return rows


def job_summary(state, code, fail_on, passed, stdout, stderr, inputs, hidden):
    """The job summary: the state, the summary the checker printed (with no record lines unless show-records is
    true), every premise with what was stated, and the step's decision."""
    text = f"## FlowAssert: {state}\n\n"
    text += f"Exit status {code}. This step {'passed' if passed else 'failed'} (fail-on: {fail_on}).\n\n"
    if stdout:
        text += _code(stdout)
    if hidden:
        text += HIDDEN + "\n\n"
    if stderr:
        text += _code(stderr)
    if state in EXIT_STATES.values():
        text += ("### Stated premises\n\nFlowAssert does not verify these statements. A wrong statement gives a wrong "
                 "result.\n\n| Premise | Stated | Origin |\n| --- | --- | --- |\n")
        for name, value in premise_rows(inputs):
            text += f"| {name} | {value} | command-line option |\n"
        text += "\n"
    return text


def applied(name, premise, premises, inputs):
    """Whether a premise was applied, in the HTML report's words."""
    if name.endswith("_complete"):
        if premise.get("stated") is not True:
            return "not stated"
        if premises.get(name.replace("_complete", "_count"), {}).get("matched") is False:
            return "not applied: the stated total differs from the rows read"
        return "applied"
    if name.endswith("_count"):
        if premise.get("stated") is None:
            return "not stated"
        return "differs from the rows read" if premise.get("matched") is False else "matches the rows read"
    if name == "allow_identical_content":
        return "applied: the two inputs were identical" if inputs.get("identical_content") else \
            "not needed: the two inputs were not identical"
    return ""


def _stated(value):
    if value is True:
        return "yes"
    if value is False or value is None:
        return "no" if value is False else "none"
    return str(value)


def _cell(text):
    """Text in a Markdown table cell: a pipe and a line break would end the cell."""
    return str(text).replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def input_rows(report):
    """Each side: what it was read as, and its digests."""
    inputs = report.get("inputs", {})
    rows = []
    for side, title in (("source", "Source"), ("destination", "Destination")):
        digest = inputs.get(f"{side}_sha256", "")
        book = inputs.get(f"{side}_workbook")
        sheet = inputs.get(f"{side}_sheet")
        crm = inputs.get(f"{side}_hubspot")
        if book:
            kind = f"worksheet {book.get('worksheet', '')} of an .xlsx workbook"
            digests = f"`{digest}` (canonical form), file `{book.get('file_sha256', '')}`"
        elif sheet:
            revision = sheet.get("revision")
            kind = f"Google Sheets range {sheet.get('range_returned', '')}"
            after = revision.get("after") if isinstance(revision, dict) and revision.get("available") else None
            if isinstance(after, dict) and after.get("version"):
                kind += f", revision {after['version']}"
            digests = f"`{digest}` (canonical form)"
        elif crm:
            kind = f"HubSpot {crm.get('object', '')}, {crm.get('rows', 0)} records"
            digests = f"`{digest}` (canonical form)"
        else:
            kind = "CSV file"
            digests = f"`{digest}`"
        rows.append((title, kind, digests))
    return rows


def export_rows(directory):
    """The records to resend: each file written and its row count, in the design's order."""
    order = ("missing-from-destination.csv", "values-differ.csv", "duplicated-in-destination.csv",
             "unknown-status-resending-may-create-duplicates.csv", "only-in-destination.csv",
             "only-in-destination-not-concluded.csv")
    rows = []
    for name in order:
        path = os.path.join(directory, name)
        if os.path.isfile(path):
            with open(path, encoding="utf-8-sig", newline="") as f:
                rows.append((name, sum(1 for _ in csv.reader(f)) - 1))
    return rows


def _key_line(key):
    if key is None:
        return "(no key)"
    text = key.replace("\\", "\\\\").replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t")
    return text if len(text) <= KEY_LENGTH else text[:KEY_LENGTH - 1] + "\u2026"


def keys_part(report, inputs):
    """With summary-keys: true, the keys of the records that are not Verified, up to 50, never a value."""
    if inputs["summary-keys"] != "true":
        return ""
    if inputs["redact-values"] == "true":
        return "The keys are not listed: the report was written with redact-values.\n\n"
    keys = [r.get("key") for r in report.get("records", []) if r.get("state") != "Verified"]
    if not keys:
        return ""
    shown = keys[:MAX_KEYS]
    text = f"Keys of the records that are not Verified ({len(keys)}"
    text += f", the first {MAX_KEYS} shown):\n\n" if len(keys) > MAX_KEYS else "):\n\n"
    return text + _code("\n".join(_key_line(k) for k in shown))


def run_summary(report, inputs, keys=True):
    """"What this run shows": read from the JSON report, with no compared value."""
    state = report.get("cohort_state", "")
    claim = report.get("claim")
    counts = report.get("counts", {})
    expected = report.get("expected_total")
    text = "### What this run shows\n\n"
    text += f"**{state}.** " + (_cell(claim) if claim else "No claim is made: the result is not Verified.") + "\n\n"
    text += "| Verified | Mismatch | Unverified | Source rows | Expected total |\n| --- | --- | --- | --- | --- |\n"
    text += (f"| {counts.get('Verified', 0)} | {counts.get('Mismatch', 0)} | {counts.get('Unverified', 0)} "
             f"| {report.get('source_rows_observed', 0)} | {'unknown' if expected is None else expected} |\n\n")
    only = report.get("destination_only_counts")
    if only is not None:
        text += (f"Destination-only records (scope exact): Mismatch {only.get('Mismatch', 0)}, "
                 f"Unverified {only.get('Unverified', 0)}.\n\n")
    premises = report.get("premises", {})
    text += "| Premise | Stated | Applied |\n| --- | --- | --- |\n"
    for name in ("source_complete", "destination_complete", "source_count", "destination_count",
                 "allow_identical_content"):
        if name in premises:
            premise = premises[name]
            text += f"| {name} | {_stated(premise.get('stated'))} | {applied(name, premise, premises, report.get('inputs', {}))} |\n"
    text += "\n| Input | Read as | SHA-256 |\n| --- | --- | --- |\n"
    for title, kind, digests in input_rows(report):
        text += f"| {title} | {_cell(kind)} | {digests} |\n"
    text += "\n"
    directory = inputs["export-dir"]
    if directory and os.path.isdir(directory):
        files = export_rows(directory)
        if files:
            listed = ", ".join(f"{name} {rows} row{'' if rows == 1 else 's'}" for name, rows in files)
            text += f"Records to resend, in {_cell(directory)}: {listed}.\n\n"
        else:
            text += f"Records to resend: none; {_cell(directory)} is empty.\n\n"
    if keys:
        text += keys_part(report, inputs)
    text += "This run is a new observation; it does not change any earlier report.\n"
    return text


def summary_text(state, code, fail_on, passed, stdout, stderr, inputs, hidden, report):
    """1.0's job summary, then the run summary when the check concluded, kept under SUMMARY_LIMIT bytes: beyond it,
    the checker's printed summary and the keys are left out, and a sentence says so."""
    def compose(out, keys, note=""):
        text = job_summary(state, code, fail_on, passed, out, stderr, inputs, hidden) + note
        return text + run_summary(report, inputs, keys) if report is not None else text
    text = compose(stdout, True)
    if len(text.encode("utf-8")) <= SUMMARY_LIMIT:
        return text
    with_keys = inputs["summary-keys"] == "true"
    note = LEFT_OUT.format(keys=" and the keys" if with_keys else "", verb="are" if with_keys else "is",
                           them="them" if with_keys else "it")
    return compose("", False, note + "\n\n")


def _show(text):
    """Print the checker's output to the log with workflow commands stopped, so no line of it can act as one."""
    if not text:
        return
    token = secrets.token_hex(16)
    print(f"::stop-commands::{token}")
    print(text.rstrip("\n"))
    print(f"::{token}::")


def run(environ, python=sys.executable):
    """Run one check for the inputs in `environ`. Returns the wrapper's exit status: 0 when the step passes."""
    inputs = read_inputs(environ)
    temporary = None
    report_path = None
    try:
        if inputs["summary"] == "true" and inputs["json"] == "":
            # The run summary reads the JSON report; without json, one is written here and removed afterwards.
            temporary = tempfile.mkdtemp(prefix="flowassert-", dir=environ.get("RUNNER_TEMP") or None)
            report_path = os.path.join(temporary, "report.json")
        return _check(environ, inputs, python, report_path)
    finally:
        if temporary:
            shutil.rmtree(temporary, ignore_errors=True)


def _check(environ, inputs, python, report_path):
    fail_on = inputs["fail-on"]
    show_records = inputs["show-records"] == "true"
    # Only "false" turns the job summary off; any other value is refused below, and the refusal is summarised.
    summarise = inputs["summary"] != "false"
    code = None
    stdout = stderr = ""
    try:
        argv = arguments(inputs, report_path)
    except Refused as e:
        state, code, stderr = "refused", 2, f"refused: {e}\n"
    else:
        result = subprocess.run([python, "-I", "-c", LAUNCH, str(OFFLINE)] + argv, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, env=dict(environ))
        code = result.returncode
        stdout = result.stdout.decode("utf-8", "backslashreplace")
        stderr = result.stderr.decode("utf-8", "backslashreplace")
        if os.name == "nt":  # the checker's text-mode output ends its lines with CR LF there; print would double the CR
            stdout, stderr = stdout.replace("\r\n", "\n"), stderr.replace("\r\n", "\n")
        state = state_of(code, stdout)
    passed = passes(state, fail_on)
    concluded = state in EXIT_STATES.values()
    hidden = not show_records and concluded and "more records not shown" in stdout
    _show(stdout)
    if hidden:
        print(HIDDEN)
    _show(stderr)
    # A report is written only when the check concluded; after a refusal the checker leaves none behind.
    outputs = {"state": state, "exit-code": "" if code is None else str(code),
               "json": inputs["json"] if concluded else "", "html": inputs["html"] if concluded else "",
               "export-dir": inputs["export-dir"] if concluded and inputs["export-dir"] else ""}
    write_outputs(environ.get("GITHUB_OUTPUT"), outputs)
    if summarise:
        report = None
        if concluded:
            path = inputs["json"] or report_path
            try:
                with open(path, encoding="utf-8") as f:
                    report = json.load(f)
            except (OSError, ValueError):
                report = None
        _write(environ.get("GITHUB_STEP_SUMMARY"),
               summary_text(state, code, fail_on, passed, stdout, stderr, inputs, hidden, report))
    if not passed:
        if concluded:
            message = f"FlowAssert: {state}; this step fails on {fail_on}."
        else:
            last = stderr.strip().splitlines()
            message = "FlowAssert: " + (last[-1] if last else f"{state}, exit status {code}") + "; nothing was concluded."
        print("::error title=FlowAssert::" + _escape(message))
    return 0 if passed else 1


def main():
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    return run(os.environ)


if __name__ == "__main__":
    sys.exit(main())
