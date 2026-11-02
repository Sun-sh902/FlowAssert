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

Step-by-step walkthrough: [First-check guide](../docs/guides/first-check.md) | [第一次核对指南（简体中文）](../docs/guides/first-check.zh-CN.md).

## Options

| Option | Meaning |
| --- | --- |
| `--source PATH` | Source CSV file. Required |
| `--destination PATH` | Destination CSV export. Required |
| `--key COL[:COL]` | Stable record key. Required unless `--mapping` is used |
| `--field COL[:COL]` | Field to compare. Repeatable; at least one is required unless `--mapping` is used |
| `--mapping FILE` | UTF-8 JSON file with `key` and `fields` column pairs, including names containing `:` |
| `--source-complete` | State that the source file is the whole batch |
| `--destination-complete` | State that the export covers the whole object |
| `--allow-identical-content` | Continue when two distinct files have identical content, and record that in `inputs` |
| `--max-bytes N` | Refuse a file larger than `N` bytes before reading (default: `209715200`, 200 MiB) |
| `--max-rows N` | Refuse a CSV with more than `N` rows while reading (default: `1000000`) |
| `--max-details N` | Print at most `N` non-Verified records in the summary; `0` prints none (default: `50`) |
| `--json PATH` | Write a full report with file digests to a new file |
| `--redact-values` | Leave keys and compared values out of the output |
| `--version` | Show the version |

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

A malformed or oversized file is refused as a whole. `--json PATH` writes a report with file digests to a new file; `--max-details` only shortens the printed summary and never removes records from `--json`. Reports include keys and compared values unless you pass `--redact-values`. Every report records when it was evaluated. Paths resolving to the same file are always refused; two distinct files with identical content are refused by default unless `--allow-identical-content` is passed. Use `--mapping FILE` when a column name contains `:`.

## Limits

This checks files, not systems. It does not show that a workflow ran, that the source is true, that a file came from where you say, or that a record existed by a past deadline. `flowassert_offline/evaluator_v2.py` has had no independent review. The FlowAssert Service and UI still use the frozen Evaluator and do not read these reports.
