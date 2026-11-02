# First check: compare two CSV files

English | [简体中文](first-check.zh-CN.md)

This guide walks through installing `flowassert-verify`, preparing a source CSV and a destination CSV export, stating only the premises you can stand behind, and reading the result.

FlowAssert follows one rule throughout: **without enough evidence, never say Verified.**

## 1. Install the command

Python 3.11+ is supported; Python 3.9 and 3.10 are best-effort because macOS ships Python 3.9. Only the Python standard library is used, and the command makes no network requests.

From a local clone of the repository:

```sh
python3 -m pip install ./offline
flowassert-verify --version
```

Or directly from GitHub:

```sh
python3 -m pip install "git+https://github.com/Sun-sh902/FlowAssert.git#subdirectory=offline"
```

If you prefer not to install a package, run `python3 offline/verify.py` from the repository root with the same options.

## 2. Export two CSV files and choose a stable key

Prepare two UTF-8 CSV files with header rows:

1. **Source CSV** — the records that should have arrived in the destination (for example, an export from your upstream table, form store, or order list).
2. **Destination CSV** — a separate export of the records currently held in the destination system.

Keep the two files independent:

- Do not compare a file against itself, or against a copy made from the same export. FlowAssert refuses paths that resolve to the same file, and refuses identical file contents unless you explicitly pass `--allow-identical-content` for two genuinely separate exports.
- Check that each file is valid UTF-8 and that every row matches the header. FlowAssert refuses a malformed or oversized file as a whole rather than producing a partial verdict.

### Choose a stable key

Pick a column whose value uniquely identifies each business record in the source and is written unchanged into the destination, such as an upstream `external_id`, submission ID, or order number.

Avoid keys that can drift or collide:

- **Mutable fields** such as display names, company names, or phone numbers that a user or workflow may reformat.
- **Destination-only IDs** generated after import, unless the source system independently recorded them.
- **Blank or repeated keys** in the source. Rows with missing or duplicate source keys cannot be matched reliably and stay `Unverified`.

When a column has different header names in the two files, write `source:destination`, such as `--field email:hs_email`. If any column name itself contains a colon (such as `Contact: Phone`), use `--mapping FILE` instead of `--key` and `--field`:

```json
{
  "key": ["external_id", "Record ID"],
  "fields": [["Contact: Phone", "phone"], ["email", "hs_email"]]
}
```

### Example files in `offline/examples/`

The repository includes two small synthetic files so you can run a check right away.

`offline/examples/source.csv`:

```csv
external_id,phone,email
SYN-001,+1 212 555 0101,ada@example.test
SYN-002,+1 212 555 0102,grace@example.test
SYN-003,+1 212 555 0103,alan@example.test
SYN-004,+1 212 555 0104,edsger@example.test
```

`offline/examples/destination.csv`:

```csv
external_id,phone,hs_email
SYN-001,+1 212 555 0101,ada@example.test
SYN-002,+1 212 555 0199,grace@example.test
SYN-004,+1 212 555 0104,edsger@example.test
SYN-004,+1 212 555 0104,edsger.2@example.test
```

## 3. What the two completeness flags mean — and when not to use them

A CSV file cannot prove on its own whether rows were left out when it was exported. FlowAssert therefore keeps completeness explicit through two flags:

| Flag | What you state | When **not** to use it |
| --- | --- | --- |
| `--source-complete` | The source CSV contains the entire batch you want to verify. | Leave it off if the source file is a sample, a filtered view, a single page of results, or a partial log. Without it, individual rows can still be `Verified` or `Mismatch`, while the batch stays `Unverified`. |
| `--destination-complete` | The destination CSV covers every record in the target object where matches or duplicates could exist. | Leave it off if the export was filtered (for example by date, owner, or status), truncated by an export row cap, or taken from a partial view. Without it, a key not seen in the file is `Unverified` rather than `Mismatch`, and uniqueness stays unknown. |

**FlowAssert does not verify either statement.** If you pass `--destination-complete` on a filtered export, a record sitting outside that filter will be reported as a missing `Mismatch`, and a duplicate sitting outside that filter can be missed so a record is wrongly called `Verified`. Only pass a completeness flag when you know how the export was produced.

Even when `--destination-complete` is passed, if any destination row has an empty key, FlowAssert withholds coverage because that unkeyed row could be the missing record or a duplicate.

## 4. Run the check, read the result, and use the exit status

Run the example from the repository root:

```sh
flowassert-verify \
  --source offline/examples/source.csv \
  --destination offline/examples/destination.csv \
  --key external_id \
  --field phone \
  --field email:hs_email \
  --source-complete --destination-complete
```

Output:

```text
Mismatch: 4 rows of 4
Verified 1 · Mismatch 3 · Unverified 0
  record 2 SYN-002: Mismatch
    field:phone fail: exact string comparison ('+1 212 555 0102' vs '+1 212 555 0199')
  record 3 SYN-003: Mismatch
    existence fail: key not found in stated complete destination
    uniqueness unknown: insufficient evidence
    field:phone unknown: insufficient evidence
    field:email unknown: insufficient evidence
  record 4 SYN-004: Mismatch
    uniqueness fail: more than one destination row carries this key
    field:phone unknown: no arbitrary candidate selected
    field:email unknown: no arbitrary candidate selected
Files and completeness statements are not authenticated. Not assessed: whether a workflow ran, whether the source is true, whether a record existed by a past deadline.
```

How to read each line:

- `Mismatch: 4 rows of 4` is the **batch (cohort) verdict**, followed by observed source rows and the expected total (`unknown total` when `--source-complete` is omitted or source keys are invalid/duplicated).
- `Verified 1 · Mismatch 3 · Unverified 0` summarizes the **individual record states**:
  - `SYN-001` matched a unique destination row on both `phone` and `email` (`hs_email`), so it is `Verified` and omitted from the problem list.
  - `SYN-002` was found, and `phone` differed under exact string comparison (`Mismatch`).
  - `SYN-003` was absent from a destination stated complete (`Mismatch`; if you omit `--destination-complete`, `SYN-003` becomes `Unverified` instead).
  - `SYN-004` appeared twice in the destination (`Mismatch`; FlowAssert refuses to pick one row arbitrarily to compare fields).
- Comparison is exact: whitespace, letter case, and phone formatting differences count as `Mismatch`. Empty compared cells are `Unverified`, because a CSV cannot show why a cell is blank.
- To save every record, rule status, and SHA-256 input digest to a new file, add `--json report.json` (pass `--redact-values` if keys and field values should be omitted). When many records fail, `--max-details N` controls how many non-Verified records are printed to standard output while `--json` keeps all of them.

### Use the exit status in scripts

Check `$?` immediately after running `flowassert-verify`:

| Exit status | Meaning | Typical script action |
| --- | --- | --- |
| `0` | `Verified` | Proceed |
| `1` | `Mismatch` | Alert on proven data discrepancy |
| `3` | `Unverified` | Do not treat as success; inspect missing evidence or completeness premises |
| `2` | Input refused | Fix command arguments, missing columns, malformed CSV, or size/row limits |
| `4` | Internal failure | Alert on tool error; no verdict was produced |

Only exit status `0` means `Verified`. A scheduled check should distinguish `1` (data discrepancy), `3` (insufficient evidence), and `2` or `4` (check did not complete).

## 5. What the result does not prove

Even a `Verified` result (`0`) makes only a narrow statement: at the moment of evaluation, the supplied destination CSV satisfied exact string comparison on the selected columns for the supplied source CSV, under the completeness statements you passed.

It does **not** prove:

- **Workflow execution** — that an automation workflow actually ran or performed the write rather than another process or manual edit.
- **Source truth or external completeness** — that the source CSV itself is accurate, or that real-world events missing from the source CSV never happened.
- **File authenticity** — that either CSV genuinely came from the named system without alteration or export filtering.
- **Absence of semantic duplicates** — that the destination has no duplicate person or order stored under a different key or an empty key outside the export.
- **Historical timing or future state** — that a record arrived before a past deadline, or that the destination remained accurate after the export was taken.
