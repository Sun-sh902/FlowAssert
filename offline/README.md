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
| `--key COL[:COL]` | Stable record key. Required unless `--mapping` or `--config` is used |
| `--field COL[:COL]` | Field to compare exactly. Repeatable; at least one is required unless `--mapping` or `--config` is used |
| `--mapping FILE` | UTF-8 JSON file with `key` and `fields` column pairs, including names containing `:`. Always compares exactly |
| `--config FILE` | UTF-8 JSON file with `key`, `fields` with a comparison rule each, and `scope`. Cannot be combined with `--mapping`, `--key`, `--field` or `--scope` |
| `--scope source\|exact` | `source` (default): check each source record. `exact`: also report destination keys that are not in the source |
| `--source-complete` | State that the source file is the whole batch |
| `--destination-complete` | State that the export covers the whole object |
| `--source-count N` | State the source total you saw in the original system. Compared with the rows in the file |
| `--destination-count N` | State the destination total you saw in the original system. Compared with the rows in the file |
| `--allow-identical-content` | Continue when two distinct files have identical content, and record that in `inputs` |
| `--source-encoding NAME` | `utf-8` (default, with an optional byte order mark), `utf-16` (with a byte order mark) or `gb18030` |
| `--destination-encoding NAME` | The same for the destination file |
| `--max-bytes N` | Refuse a file larger than `N` bytes before reading (default: `209715200`, 200 MiB) |
| `--max-rows N` | Refuse a CSV with more than `N` rows while reading (default: `1000000`) |
| `--max-details N` | Print at most `N` non-Verified records in the summary; `0` prints none (default: `50`) |
| `--json PATH` | Write a full report with file digests to a new file |
| `--details problems\|all` | `problems` (default): a Verified record in `--json` keeps only `key`, `source_row` and `state`. `all`: every record in full |
| `--html PATH` | Write a self-contained HTML report to a new file |
| `--redact-values` | Leave keys and compared values out of the output |
| `--version` | Show the version |

## What you state

| Option | You state that | Without it |
| --- | --- | --- |
| `--source-complete` | The source file is the whole batch | The batch cannot be Verified |
| `--destination-complete` | The export covers the whole object | Missing records and duplicates stay unknown |
| `--source-count N` | The source system showed `N` records | Nothing is cross-checked |
| `--destination-count N` | The destination system showed `N` records | Nothing is cross-checked |

FlowAssert does not check any of these statements. A wrong statement gives a wrong result.

A count that differs from the rows in the file withdraws the matching completeness statement: the batch cannot be Verified, or missing records and duplicates stay unknown. The summary says so, for example `Source count stated 120, file has 118 rows: the batch cannot be Verified.` A count that matches does not replace `--source-complete` or `--destination-complete`; it only catches some wrong statements.

## Comparison rules

Comparison is exact by default: spaces, case and phone formats count as differences. A configuration file can choose one rule per field:

```json
{
  "key": ["crm id", "Record ID"],
  "fields": [
    {"source": "Contact: Phone", "destination": "phone", "rule": "digits"},
    {"source": "email", "destination": "hs_email", "rule": "casefold"},
    {"source": "signed", "destination": "signed_on", "rule": "date:%Y-%m-%d"}
  ],
  "scope": "source"
}
```

| Rule | Compares |
| --- | --- |
| `exact` | The strings as they are. The default when a field has no `rule` |
| `trim` | After removing leading and trailing whitespace |
| `casefold` | After Unicode case folding |
| `digits` | Only the digits 0–9. A value without any is Unverified, not a match |
| `date:FORMAT` | Both values parsed with Python's `datetime.strptime` and `FORMAT`, then compared. A value that does not parse is Unverified, not a Mismatch |

Rules are never inferred. An empty value is Unverified under every rule. For a rule other than `exact`, the report records the rule, both raw values and both normalized values. The configuration file cannot state completeness or counts, so they are chosen at each run. It is refused if it has any other member, a duplicate member, an unknown rule, a malformed date format or a repeated source field. Its SHA-256 is recorded in `inputs`.

## Results

| Situation | Record result |
| --- | --- |
| One row, every selected field passes its rule, destination stated complete | Verified |
| A field differs under its rule | Mismatch |
| Key absent from a stated complete destination | Mismatch |
| Key appears more than once | Mismatch; fields are not compared |
| Empty value, value without digits for `digits`, value that does not parse for `date:` | Unverified |
| Duplicate or empty source key | Unverified |

With `--scope exact`, each destination key that is not in the source is a destination-only record, reported in its own list with its own counts. When destination coverage is sufficient (`--destination-complete`, no rows without a key, and a matching `--destination-count` if stated), each one is a Mismatch and so is the batch. Otherwise they are listed without a conclusion and do not change the result. A destination row without a key is never destination-only.

A result is never Pending, because this tool has no waiting window.

## Files and reports

A malformed or oversized file, or one that does not decode in its stated encoding, is refused as a whole. FlowAssert never guesses an encoding. Paths resolving to the same file are always refused; two distinct files with identical content are refused by default unless `--allow-identical-content` is passed.

`--json PATH` writes a report with file digests and every stated premise to a new file; its members are described in [docs/report-format.md](../docs/report-format.md). `--html PATH` writes the same result as a page with no scripts that loads nothing, for people who do not read JSON. Neither overwrites a file, and if one cannot be written, neither is left behind. `--max-details` only shortens the printed summary and never removes records from a report. Reports include keys and compared values unless you pass `--redact-values`. Every report records when it was evaluated.

The source file is kept in memory, only for the columns the check uses. The destination file is read once, row by row, and no destination row is kept. `offline/bench/memory_check.py` checks that two files of 1,000,000 rows and three columns each peak under 500 MB; on macOS with Python 3.14 the peak is about 400 MB.

## Limits

This checks files, not systems. It does not show that a workflow ran, that the source is true, that a file came from where you say, or that a record existed by a past deadline. `flowassert_offline/evaluator_v2.py` has had no independent review. The FlowAssert Service and UI still use the frozen Evaluator and do not read these reports.
