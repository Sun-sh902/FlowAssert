# Offline CSV check

Compares a source CSV with a CSV export from the destination system, with the `flowassert-verify` command. It uses only the Python standard library, reads local files, and makes no network requests. Python 3.11+ is supported; Python 3.9 and 3.10 are best-effort because macOS ships Python 3.9.

Install it from a clone, or from GitHub:

```sh
python3 -m pip install ./offline
python3 -m pip install "git+https://github.com/Sun-sh902/FlowAssert.git#subdirectory=offline"
```

Run the example from the repository root:

```sh
flowassert-verify \
  --source offline/examples/source.csv \
  --destination offline/examples/destination.csv \
  --key external_id --field phone --field email:hs_email \
  --source-complete --destination-complete
```

Use `source:destination` when a column has different names. Exit status: 0 Verified, 1 Mismatch, 3 Unverified, 2 refused input, 4 internal failure, so a scheduled job can act on the result.

Without installing, run `python3 offline/verify.py` with the same options.

## What the two flags mean

| Flag | You state that | Without it |
| --- | --- | --- |
| `--source-complete` | The source file is the whole batch | The batch cannot be Verified |
| `--destination-complete` | The export covers the whole object | Missing records and duplicates stay unknown |

FlowAssert does not check either statement. A wrong statement gives a wrong result.

## Results

| Situation | Record result |
| --- | --- |
| One row, every selected field identical, destination stated complete | Verified |
| A field differs | Mismatch |
| Key absent from a stated complete destination | Mismatch |
| Key appears more than once | Mismatch; fields are not compared |
| Empty value, or duplicate or empty source key | Unverified |

Comparison is exact: spaces, case and phone formats count as differences. A result is never Pending, because this tool has no waiting window.

A malformed file is refused as a whole. `--json PATH` writes a report with file digests to a new file. Reports include keys and compared values unless you pass `--redact-values`. Every report records when it was evaluated. Source and destination files with identical content are refused, because that check would not be independent. A column name containing `:` cannot be selected.

## Limits

This checks files, not systems. It does not show that a workflow ran, that the source is true, that a file came from where you say, or that a record existed by a past deadline. `flowassert_offline/evaluator_v2.py` has had no independent review. The FlowAssert Service and UI still use the frozen Evaluator and do not read these reports.
