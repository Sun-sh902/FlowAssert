# First check: compare two CSV files

English | [简体中文](first-check.zh-CN.md)

This guide walks through installing `flowassert-verify`, preparing a source CSV and a destination CSV export, stating only the premises you can stand behind, and reading the result.

FlowAssert follows one rule throughout: **without enough evidence, never say Verified.**

No terminal? The same check runs in your browser, and your files stay on your computer: see [section 7](#7-check-in-your-browser).

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

Prepare two CSV files with header rows. UTF-8 is the default; section 5 shows how to read UTF-16 and GB18030 files:

1. **Source CSV** — the records that should have arrived in the destination (for example, an export from your upstream table, form store, or order list).
2. **Destination CSV** — a separate export of the records currently held in the destination system.

Keep the two files independent:

- Do not compare a file against itself, or against a copy made from the same export. FlowAssert refuses paths that resolve to the same file, and refuses identical file contents unless you explicitly pass `--allow-identical-content` for two genuinely separate exports.
- Check that each file decodes in its encoding and that every row matches the header. FlowAssert refuses a malformed or oversized file as a whole rather than producing a partial verdict.

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

When a check is refused (`2`), [When a check is refused](refusals.md) explains each message and what you can do about it.

## 5. More options for real exports

### Files that are not UTF-8

Some exports, such as Excel's "Unicode Text" or files from Chinese systems, are UTF-16 or GB18030. Name the encoding of each file:

```sh
flowassert-verify ... --source-encoding utf-16 --destination-encoding gb18030
```

The accepted names are `utf-8` (the default, with or without a byte order mark), `utf-16` (with a byte order mark) and `gb18030`. FlowAssert never guesses: a file that does not decode in its stated encoding is refused, and the report records both encodings.

### Cross-check the totals

If the source or destination system shows how many records it holds, state those totals:

```sh
flowassert-verify ... --source-complete --destination-complete --source-count 120 --destination-count 118
```

FlowAssert compares each number with the data rows in the file. When one differs, that side cannot support a conclusion, and the summary says so:

```text
Source count stated 120, file has 118 rows: the batch cannot be Verified.
```

A destination total that differs leaves absence and uniqueness unknown, as if `--destination-complete` had not been passed. A total that matches is **not** proof of completeness: keep the completeness flags only when you know how each export was made. FlowAssert does not verify the totals either.

### Comparison rules in a configuration file

Comparison is exact unless you choose otherwise. When a destination reformats values, write a configuration file, for example `flowassert.json`, and pass `--config flowassert.json` instead of `--key` and `--field`:

```json
{
  "key": ["external_id", "Record ID"],
  "fields": [
    {"source": "phone", "destination": "phone", "rule": "digits"},
    {"source": "email", "destination": "hs_email", "rule": "casefold"},
    {"source": "signed", "destination": "signed_on", "rule": "date:%Y-%m-%d"}
  ]
}
```

| Rule | Compares |
| --- | --- |
| `exact` | The values as they are. The default when a field has no `rule` |
| `trim` | After removing leading and trailing whitespace |
| `casefold` | Ignoring letter case |
| `digits` | Only the digits 0–9, so `+1 (212) 555-0101` equals `12125550101`. A value without digits is `Unverified` |
| `date:FORMAT` | Both values read as dates with a Python `strptime` format. With `%z`, values are compared as instants in UTC. `2026-1-2` matches `2026-01-02` under `%Y-%m-%d`. A value that does not match the format is `Unverified` |

Choose a rule only when you know the difference does not matter: `digits` treats `555-0101` and `5550101` as the same phone, and `casefold` treats `Ada` and `ADA` as the same name. The report records each rule with the raw and the compared values. A configuration file cannot contain `--source-complete`, `--destination-complete` or the counts; you state those at each run. It cannot be combined with `--mapping`, `--key`, `--field` or `--scope`.

### Check for extra records in the destination

By default FlowAssert checks only the records in the source. To require that the destination has no other keys, pass `--scope exact` (or set `"scope": "exact"` in the configuration file). A destination key that is not in the source is a destination-only record:

- With `--source-complete`, every source key present and unique, and a matching `--source-count` if you gave one, each destination-only record is a `Mismatch`, and so is the batch. The row is in the destination, so `--destination-complete` is not needed for this.
- Otherwise the key could belong to a source row you did not export, so they are listed without a conclusion and do not change the result.

The summary prints their number, for example `Destination-only: 2 records not in the source, each a Mismatch.`, and the reports list them separately from the source records.

### Reports

- `--json report.json` keeps every record. By default (`--details problems`) a `Verified` record keeps only its key, row and state, which keeps large reports small; `--details all` keeps every rule for every record. The format is described in [report-format.md](../report-format.md).
- `--html report.html` writes one page for people who do not read JSON: the result, every premise you stated, the counts, the limitations, and every record that is not `Verified`. It has no scripts and loads nothing from the network.

Neither option overwrites an existing file.

## 6. What the result does not prove

Even a `Verified` result (`0`) makes only a narrow statement: at the moment of evaluation, under the premises you stated, the supplied destination CSV satisfied the comparison rules (exact string comparison unless you chose others) on the selected columns for the supplied source CSV.

It does **not** prove:

- **Workflow execution** — that an automation workflow actually ran or performed the write rather than another process or manual edit.
- **Source truth or external completeness** — that the source CSV itself is accurate, or that real-world events missing from the source CSV never happened.
- **File authenticity** — that either CSV genuinely came from the named system without alteration or export filtering.
- **Absence of semantic duplicates** — that the destination has no duplicate person or order stored under a different key or an empty key outside the export.
- **Historical timing or future state** — that a record arrived before a past deadline, or that the destination remained accurate after the export was taken.

## 7. Check in your browser

The **CSV check** page of the FlowAssert UI runs the same check without a terminal. The files are read in the browser and never uploaded: from choosing them to downloading the reports, the page makes no network request, and nothing you choose or state is stored.

1. Open the page: the online demo at <https://sun-sh902.github.io/FlowAssert/> once it is published, or locally with `cd ui && npm ci && npm run dev` and <http://127.0.0.1:5183/#/check>. To try it first, press **Use the sample files**; they are the files in `offline/examples/`.
2. **Files.** Choose the source file and the destination export, and the encoding of each (UTF-8 by default; see section 5). The page reads each header and shows how many columns it found, or why the file is refused.
3. **Columns and rules.** Choose the key column in each file, then each compared field: its column in each file and its rule (section 5). Nothing is chosen for you; **Suggest: pair columns that have the same name** fills in pairs only when you press it. Choose the scope: `source`, or `exact` to also report destination keys that are not in the source. **Download configuration** saves these choices in the `--config` format; **Load configuration** reads one back, with the same checks as the command line.
4. **What you state.** Tick *The source file is the whole batch* and *The destination export covers the whole object* only when they are true, exactly as for the two flags in section 3. Both start unticked. The two totals are optional and work like `--source-count` and `--destination-count`.
5. Press **Check.** A progress bar shows the files being read; **Cancel** stops the check and shows no result.

The result shows the batch state, the counts, every premise you stated with its origin `browser form`, the limitations, every record that is not Verified with its rule results, and the summary exactly as the command line prints it. **Download JSON report** and **Download HTML report** save the same reports as `--json` and `--html`. A refused check shows the refusal and no result; where the first bytes of your files justify one, a hint under it suggests a choice to change, such as the encoding. The hint changes nothing itself. [When a check is refused](refusals.md) has the same help.

The page accepts only the date directives `%Y %m %d %H %M %S %f %z %b %B %y %p %I %j %%`, uses the command line's default limits, and has no `--details all` or `--redact-values`. Section 6 applies to its results unchanged.
