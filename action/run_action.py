"""Run the offline CSV check as a GitHub Action step: the wrapper that action.yml starts.

    python3 -I action/run_action.py

The Action's inputs arrive as environment variables (FA_SOURCE, FA_SOURCE_COMPLETE, ...), set in action.yml's `env:`,
so no input is ever part of a shell script. This script turns them into an argument list for `flowassert-verify`,
runs the checker from this Action's own folder (offline/, never installed and never downloaded), and writes the step's
outputs and job summary. It uses only the standard library and makes no network request.

The checker decides; this script only reports. The step passes on Verified, and also on Unverified with
`fail-on: mismatch`. A refused or failed check (exit status 2 or 4), or any result this script cannot recognise,
fails the step. Logs and job summaries are often public, so by default the checker runs with `--max-details 0`: the
log and the summary show the state, the counts, the premises and the limitations, and no key or field value.
"""
import os
from pathlib import Path
import secrets
import subprocess
import sys

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
          ("max-rows", "--max-rows"), ("details", "--details"), ("json", "--json"), ("html", "--html"))
# input name: CLI flag, for boolean inputs. Only "true" and "false" are accepted.
FLAGS = (("source-complete", "--source-complete"), ("destination-complete", "--destination-complete"),
         ("allow-identical-content", "--allow-identical-content"), ("redact-values", "--redact-values"))
# The premises, in the order and with the names of the report's `premises`.
PREMISES = (("source_complete", "source-complete"), ("destination_complete", "destination-complete"),
            ("source_count", "source-count"), ("destination_count", "destination-count"))
# Every input and its default in action.yml; an input missing from the environment has its default.
DEFAULTS = dict([(name, "") for name, _ in VALUES] + [(name, "false") for name, _ in FLAGS]
                + [("fields", ""), ("fail-on", "not-verified"), ("show-records", "false")])
HIDDEN = "Record lines are not shown (show-records: false). The JSON and HTML reports, if asked for, have them."


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


def arguments(inputs):
    """The flowassert-verify arguments for these inputs. Each value is passed as --option=value, so a value that
    starts with "-" stays a value. Raises Refused for an input the CLI never sees: a boolean, fail-on, show-records."""
    flags = {name: boolean(inputs, name) for name, _ in FLAGS}
    show_records = boolean(inputs, "show-records")
    if inputs["fail-on"] not in FAIL_ON:
        raise Refused(f"fail-on must be one of: {', '.join(FAIL_ON)}")
    argv = [f"{option}={inputs[name]}" for name, option in VALUES if inputs[name] != ""]
    # One field per line; blank lines (such as the one a YAML block leaves at the end) are not fields.
    argv += [f"--field={line}" for line in inputs["fields"].splitlines() if line.strip()]
    argv += [option for name, option in FLAGS if flags[name]]
    if not show_records:
        argv.append("--max-details=0")
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
    fail_on = inputs["fail-on"]
    code = None
    stdout = stderr = ""
    show_records = inputs["show-records"] == "true"
    try:
        argv = arguments(inputs)
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
               "json": inputs["json"] if concluded else "", "html": inputs["html"] if concluded else ""}
    write_outputs(environ.get("GITHUB_OUTPUT"), outputs)
    _write(environ.get("GITHUB_STEP_SUMMARY"), job_summary(state, code, fail_on, passed, stdout, stderr, inputs, hidden))
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
