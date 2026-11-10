# Conformance

English | [简体中文](conformance.zh-CN.md)

How another implementation of the check shows that it gives FlowAssert's results. An implementation conforms when it
passes the cases in this repository; it does not conform because its author has read
[the specification](spec/verification.md).

- [The cases](#the-cases)
- [Run them](#run-them)
- [What counts as a pass](#what-counts-as-a-pass)
- [An evaluator without a command line](#an-evaluator-without-a-command-line)
- [Conformance classes](#conformance-classes)
- [How FlowAssert's own implementations are held to it](#how-flowasserts-own-implementations-are-held-to-it)

## The cases

| Cases | Where | What each holds |
| --- | --- | --- |
| Golden cases | `offline/golden/NAME/` | The input files, `case.json` with the command's arguments, and what the reference implementation gave: `exit_status.txt`, `stdout.txt`, `stderr.txt`, and `report.json` and `report.html` when it wrote them |
| Connector cases | `offline/golden-sheets/NAME/` | The same, with the responses a local fake of the service gives and the requests the checker must send (`requests.json`) |
| Conformance cases | `offline/conformance/NAME.json` | Rows, an obligation and premises as JSON, and the expected cohort state, record states and total ([their README](../offline/conformance/README.md)) |

Every value in them is synthetic. `python3 offline/bench/golden.py` writes the golden cases from the reference
implementation, and CI fails when they are not current.

## Run them

One command runs everything against the reference implementation, from a clone, with Python 3.9 or later and nothing
else installed:

```sh
python3 offline/bench/conformance.py --connectors
```

To run another implementation, give its command. The runner starts it in a new folder that holds only the case's
input files, with the case's arguments followed by `--json report.json`, so the command must be on the `PATH` or
given by its full path:

```sh
python3 offline/bench/conformance.py --command "my-verify"
python3 offline/bench/conformance.py --command "/full/path/to/my-verify --some-option" --bytes --html
```

| Option | Effect |
| --- | --- |
| `--command "CMD ARG..."` | The command to run in place of `flowassert-verify` |
| `--evaluator "CMD ARG..."` | The evaluator for the conformance cases ([below](#an-evaluator-without-a-command-line)) |
| `--no-golden`, `--no-cases` | Leave out the golden cases, or the conformance cases |
| `--bytes` | Also require `report.json` to be the golden file byte for byte |
| `--html` | Also pass `--html report.html` and require the HTML report byte for byte |
| `--connectors` | Also run the connector cases, against a fake on a loopback port; nothing contacts a network |
| `--only NAME` | Run one case; repeatable |
| `--list` | Print the names of the cases |

It prints `PASS` or `FAIL` for each case, with what differed, then `N of M cases pass`, and exits with 0 only when
every case passes.

## What counts as a pass

A golden case passes when all of these hold:

1. The **exit status** is the one in `exit_status.txt`.
2. **Standard output** is `stdout.txt` and **standard error** is `stderr.txt`, byte for byte. A refusal names a file as
   the case names it, such as `source.csv`.
3. `report.json` **exists exactly when** the golden case has one. A refused check writes nothing.
4. The report is **valid against the JSON Schema** of its `schema_version` ([docs/schema/](schema/)).
5. The report **equals the golden report as a JSON value**: the same members with the same values, in any order and
   with any white space.

Times are not compared, because they are when the check ran: `evaluated_at`, and a connector's `read_at`. Each must be
a UTC time of the documented form.

A connector case passes when, in addition, the requests the command sent to the fake are the ones in `requests.json`:
the method, the path and the query of each, in order.

A conformance case passes when the evaluator gives exactly the `expected` member: `cohort_state`, `record_states` and
`expected_total`.

## An evaluator without a command line

An implementation that has no command line, such as a library, can still run the conformance cases. Give the runner a
command that reads one case as JSON on standard input, with the members `name`, `obligation`, `source_rows`,
`destination_rows` and `premises`, and prints one JSON object on standard output:

```json
{"cohort_state": "Mismatch", "record_states": ["Verified", "Mismatch"], "expected_total": 2}
```

```sh
python3 offline/bench/conformance.py --no-golden --evaluator "my-evaluator"
```

The expected result is not sent to it.

## Conformance classes

| Class | An implementation that passes |
| --- | --- |
| **Evaluator** | Every conformance case |
| **Report** | Every golden case and every conformance case, without `--bytes` or `--html` |
| **Byte for byte** | The same with `--bytes --html` |
| **Connector** | The class it has, with `--connectors` |

A claim of conformance names the class, the FlowAssert version whose cases were run, and the command that ran them.

## How FlowAssert's own implementations are held to it

- **The command line** is the reference. CI runs `python3 offline/bench/golden.py --check` on Python 3.9, 3.11 and
  3.14, so the golden cases are what it writes on each, and `scripts/dev/tests/test_spec.py` runs the runner above
  with `--bytes --html --connectors`.
- **The browser check** runs every golden case in Vitest (`ui/src/test/offline/golden.test.ts`) byte for byte, every
  conformance case (`conformance.test.ts`), and 300 random cases against the command line (`random-parity.test.ts`).
- **The packaged JavaScript checker** runs every golden case the page can run, from the built file, in a context
  without `crypto` (`bundle.test.ts`).

A difference between them is a defect, whichever of them is wrong.
