# Report format

English | [简体中文](report-format.zh-CN.md)

`flowassert-verify --json PATH` writes one JSON object to a new file. This page describes `schema_version` 1, written by FlowAssert 0.2.0 and later, and `schema_version` 2, written from 0.7.0 only when the source is a Google Sheets range ([A report from a Google Sheets source](#a-report-from-a-google-sheets-source)). `--html PATH` writes the same report as a single HTML page for people; it is described at the end.

From 0.3.0 the CSV check page of the web UI writes the same two reports, byte for byte, from the same inputs; it runs as `--config` with both encodings stated. The only difference is the `origin` of each premise, `browser form` (see [`premises`](#premises)).

From 0.4.0 the packaged JavaScript checker (`checkCsv` in `flowassert-check.js`, used by the n8n example) runs the page's check and writes the same two reports. Its premises' `origin` is the one its caller chose: `JavaScript call` (the default) or `n8n Code node`.

From 0.5.0 the web UI can keep reports in the browser and compare two reports of the same obligation; [Comparing two reports](report-comparison.md) describes how a report is read for that and what a comparison gives.

The report never claims more than its evidence. A member that FlowAssert could not establish is `null`, `false` or `"unknown"`, never a guess.

## Versioning

`schema_version` is the first member. It changes when a member is removed or renamed, or when the meaning of a value changes. New members can be added without a change, so a reader should ignore members it does not know.

A report whose source is a Google Sheets range (`--source-sheet`, 0.7.0 and later) has `schema_version` 2, because three members of version 1 mean something else for it; every other report is version 1. A reader that knows only version 1 refuses a version 2 report, rather than show the sheet's rows as a file.

Reports from FlowAssert 0.1.x have no `schema_version`. They have the same members as a 0.2.0 report run with `--details all`, except `schema_version`, `details` and `premises`, and their `claim` text is shorter.

## Members that depend on options

| Member | Present when |
| --- | --- |
| `inputs.identical_content_allowed` | The two files have identical content and `--allow-identical-content` was passed |
| `inputs.mapping_file_sha256` | `--mapping` was used |
| `inputs.config_file_sha256` | `--config` was used |
| `inputs.source_encoding`, `inputs.destination_encoding` | `--source-encoding` or `--destination-encoding` was passed. Both are recorded; with a sheet source, only `destination_encoding` |
| `inputs.source_sheet` | The source is a Google Sheets range (`--source-sheet`); `schema_version` is then 2 |
| `obligation.rules` | `--config` was used |
| `obligation.scope` | `--scope` was passed, or the configuration file has `scope` |
| `premises.allow_identical_content` | `--allow-identical-content` was passed |
| `destination_only`, `destination_only_counts` | The scope is `exact` |
| `rule`, `expected_normalized`, `actual_normalized` in a field result | The field's rule is not `exact` |
| A Verified record's `candidates` and `rules` | `--details all` |

`--redact-values` replaces every record key, and every destination-only key, with `"[redacted]"`, and removes `expected`, `actual`, `expected_normalized` and `actual_normalized` from every field result.

## Top-level members

| Member | Type | Meaning |
| --- | --- | --- |
| `schema_version` | integer | `1`, or `2` for a report whose source is a Google Sheets range |
| `cohort_state` | string | The batch result: `Verified`, `Mismatch` or `Unverified`. The exit status follows it: 0, 1, 3 |
| `claim` | string or null | When `cohort_state` is `Verified`: "At this evaluation, under the stated premises, the supplied destination rows satisfy the rules for the supplied source rows." Otherwise `null` |
| `counts` | object | Number of records in each state (see below) |
| `expected_total` | integer or null | Number of source records, when the source population is known; otherwise `null` |
| `source_rows_observed` | integer | Number of data rows read from the source file |
| `source_population_known` | boolean | `true` only if `--source-complete` was passed, every source key is present and unique, and `--source-count`, if stated, matches the rows read |
| `destination_coverage_sufficient` | boolean | `true` only if `--destination-complete` was passed, every destination row has a key, and `--destination-count`, if stated, matches the rows read. Absence and uniqueness need it |
| `destination_rows_without_key` | integer | Destination rows whose key is empty or only whitespace |
| `records` | array | One record per source row, in file order (see below) |
| `destination_only` | array | Scope `exact` only: destination keys that are not in the source (see below) |
| `destination_only_counts` | object | Scope `exact` only: number of destination-only records in each state, with the same members as `counts` |
| `details` | string | `problems` (the default) or `all`, from `--details` |
| `premises` | object | Every premise stated or not stated at this run (see below) |
| `inputs` | object | File digests and how the files were read (see below) |
| `obligation` | object | What was checked (see below) |
| `evaluator` | string | The evaluator version, `v2-current-state-1` |
| `evaluated_at` | string | When the report was made, as UTC ISO 8601, such as `2026-11-02T08:15:30.123456Z` |
| `limitations` | string | What the result does not establish |
| `workflow_execution` | string | Always `Not assessed`: whether a workflow ran |
| `business_truth` | string | Always `Not assessed`: whether the source is true |
| `existed_by_deadline` | string | Always `Not assessed`: whether a record existed by a past deadline |
| `acquisition_authenticity` | string | Always `not_authenticated`: the files and statements are not authenticated |

### `counts`

`Verified`, `Mismatch`, `Pending` and `Unverified`, each an integer. `Pending` is always 0, because this tool has no waiting window.

### `premises`

One entry for each premise, keyed by name. FlowAssert does not verify any of them.

| Entry | Meaning |
| --- | --- |
| `source_complete` | `--source-complete`: the source file is the whole batch |
| `destination_complete` | `--destination-complete`: the export covers the whole object |
| `source_count` | `--source-count N`: the source total seen in the original system |
| `destination_count` | `--destination-count N`: the destination total seen in the original system |
| `allow_identical_content` | `--allow-identical-content`: the two identical files come from different systems. Present only when passed |

Each entry has:

| Member | Meaning |
| --- | --- |
| `stated` | What was stated: `true` or `false` for a flag, the number or `null` for a count |
| `origin` | Where the statement came from: `command-line option` from `flowassert-verify`; `browser form` from the CSV check page of the web UI (0.3.0 and later); `JavaScript call` from a program calling the packaged checker, or `n8n Code node` from the n8n example's Code node (0.4.0 and later; the caller chooses one of these two). A configuration file cannot state premises |
| `observed` | Counts only: the number of data rows read from that file. Blank lines are not rows; rows without a key are |
| `matched` | Counts only: whether `stated` equals `observed`, or `null` when no count was stated |

A count that does not match withdraws the matching completeness statement: the source population becomes unknown, or destination coverage becomes insufficient. A count that matches does not replace `--source-complete` or `--destination-complete`.

### `inputs`

| Member | Meaning |
| --- | --- |
| `source_sha256`, `destination_sha256` | SHA-256 of each file's bytes, as read |
| `source_complete_stated`, `destination_complete_stated` | The completeness flags, as in 0.1.x. `premises` has the same information |
| `identical_content` | Whether the two files have the same SHA-256 |
| `identical_content_allowed` | `true` when identical content was allowed with `--allow-identical-content` |
| `mapping_file_sha256` | SHA-256 of the `--mapping` file |
| `config_file_sha256` | SHA-256 of the `--config` file |
| `source_encoding`, `destination_encoding` | `utf-8`, `utf-16` or `gb18030` |

### `obligation`

| Member | Meaning |
| --- | --- |
| `type` | Always `current_state` |
| `key` | `[source column, destination column]` |
| `fields` | `[[source column, destination column], ...]`, in order |
| `comparison` | `exact-string` when every field is compared exactly; `per-field-rule` when any field has another rule |
| `rules` | One rule per entry of `fields`, in the same order: `exact`, `trim`, `casefold`, `digits` or `date:FORMAT` |
| `scope` | `source` or `exact` |

## Records

Each entry of `records` is one source row.

| Member | Meaning |
| --- | --- |
| `key` | The source key, or `null` when it is empty |
| `source_row` | Position of the row among the source data rows, starting at 0. The summary prints it plus 1 |
| `state` | `Verified`, `Mismatch` or `Unverified` |
| `candidates` | Number of destination rows carrying this key |
| `rules` | One result per rule (see below) |

With `--details problems`, the default, a Verified record has only `key`, `source_row` and `state`. Every other record always has every member. With `--details all`, every record has every member.

### Rule results

`rules` has `existence`, `uniqueness`, and one `field:COLUMN` entry for each compared field, named after the source column. Each result has:

| Member | Meaning |
| --- | --- |
| `status` | `pass`, `fail` or `unknown` |
| `reason` | Why, in words |
| `expected` | The source value, when a value was compared |
| `actual` | The destination value, when a value was compared |
| `rule` | The field's comparison rule, when it is not `exact` |
| `expected_normalized` | The source value as the rule compared it, or `null` when there was nothing to compare, such as a date that does not parse |
| `actual_normalized` | The same for the destination value |

A record is a Mismatch if any result fails, Verified if every result passes, and Unverified otherwise. An empty value is `unknown` under every rule. For `digits`, a value without the digits 0–9 is `unknown`; for `date:FORMAT`, a value that does not parse is `unknown`, and a value with a UTC offset is normalized to UTC. A date is normalized as ISO 8601, such as `2026-01-02T00:00:00`.

## Destination-only records

With scope `exact`, each destination key that is not in the source becomes one entry of `destination_only`, in the order of its first destination row. Destination rows without a key are never destination-only. These entries are never in `records`.

| Member | Meaning |
| --- | --- |
| `key` | The destination key |
| `destination_row` | Position of the first destination data row with this key, starting at 0 |
| `rows` | Number of destination rows with this key |
| `state` | `Mismatch` when `source_population_known` is true. Otherwise `Unverified`: listed, with no conclusion, because the key could belong to a source row that was not supplied. Destination coverage plays no part: the row exists |
| `reason` | Why, in words |

A destination-only Mismatch makes `cohort_state` a Mismatch. An Unverified destination-only record does not change `cohort_state`.

## A report from a Google Sheets source

From 0.7.0, `flowassert-verify --source-sheet ID --source-range RANGE` reads the source rows from one range of a Google Sheets spreadsheet, read-only, in place of a source file ([the design note](connectors/google-sheets.md)). Its report has `schema_version` 2, and every member of version 1 with the same meaning, except:

| Member | In version 2 |
| --- | --- |
| `inputs.source_sha256` | SHA-256 of the canonical form of the values read (`flowassert-sheet-csv-1`, below), not of a file's bytes |
| `source_rows_observed`, `premises.source_count.observed` | The data rows of the range: every row after its first, the header |
| `premises.source_complete` | `--source-complete`: the sheet range is the whole batch. Still a statement FlowAssert does not verify |
| `inputs.source_encoding` | Never present; `inputs.destination_encoding` is present alone when `--destination-encoding` was passed |
| `inputs.identical_content` | Whether the canonical form and the destination file have the same SHA-256 |
| `inputs.source_sheet` | Where the rows were read, below. Always present |

Reading the sheet removes the export step, so no export could have cut the rows short or edited them. It does not show that the range holds every record that should exist: that stays the premise `source_complete`. The same cell values give the same records, rule results, counts and cohort state as a CSV file with the same rows.

### `inputs.source_sheet`

| Member | Meaning |
| --- | --- |
| `read_by` | Always `FlowAssert`: the rows were read by FlowAssert, not exported by a person. It is not a statement about completeness |
| `service` | Always `Google Sheets API v4` |
| `spreadsheet_id` | The spreadsheet ID, as given to `--source-sheet` |
| `range_requested` | The range as given to `--source-range`, such as `Leads!A1:F` |
| `range_returned` | The range the API said it read, such as `Leads!A1:F1000` |
| `value_render_option` | Always `FORMATTED_VALUE`: every cell as the text the sheet shows |
| `date_time_render_option` | Always `FORMATTED_STRING` (ignored by the API with `FORMATTED_VALUE`, and recorded to name both options) |
| `major_dimension` | Always `ROWS` |
| `read_at` | When the values were requested, in UTC ISO 8601 like `evaluated_at` |
| `revision` | `{"available": true, "before": {"version": V, "modified_time": T}, "after": {...}}`: Google Drive's `version` (a string of digits) and `modifiedTime` (a string, or `null` when Drive gave none) just before and just after the values were read, which are equal; or `{"available": false, "reason": R}`, where `R` is `not requested (--skip-source-revision)` or `Google Drive returned no version`: the read cannot be tied to a revision |
| `canonical_form` | Always `flowassert-sheet-csv-1` |

The report never records the credential, the account or the spreadsheet's title. `--redact-values` leaves the spreadsheet ID and the range in place: they are not values.

### The canonical form `flowassert-sheet-csv-1`

UTF-8 without a byte order mark. The header row, then every data row padded with empty strings to the header's width, each followed by a line feed (also the last). Cells are separated by commas. A cell is written in double quotes, with each `"` inside doubled, when it contains `,`, `"`, a carriage return or a line feed, or when it is the only cell of its row and is empty; every other cell is written as it is. `flowassert-verify --source` reads this text as exactly the rows the sheet gave.

## HTML report

`--html PATH` writes one HTML file and, like `--json`, refuses to overwrite an existing file. If either report cannot be written, neither is left behind. The page shows the cohort result and claim, every stated premise, the counts, the limitations, every record that is not Verified with its rule results, every destination-only record, and the inputs. It follows `--redact-values`.

A report from a Google Sheets source has one more section, "Source read from Google Sheets", before the inputs: the members of `inputs.source_sheet`, the revision, and the sentence that the read does not show that the range holds every record that should exist.

Every value from a file is escaped. The page has no scripts and loads nothing: its styles are inline, and a Content Security Policy blocks everything else. It works when opened offline.
