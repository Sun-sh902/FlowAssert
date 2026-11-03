# Report format

`flowassert-verify --json PATH` writes one JSON object to a new file. This page describes `schema_version` 1, written by FlowAssert 0.2.0. `--html PATH` writes the same report as a single HTML page for people; it is described at the end.

The report never claims more than its evidence. A member that FlowAssert could not establish is `null`, `false` or `"unknown"`, never a guess.

## Versioning

`schema_version` is the first member. It changes when a member is removed or renamed, or when the meaning of a value changes. New members can be added without a change, so a reader should ignore members it does not know.

Reports from FlowAssert 0.1.x have no `schema_version`. They have the same members as a 0.2.0 report run with `--details all`, except `schema_version`, `details` and `premises`, and their `claim` text is shorter.

## Members that depend on options

| Member | Present when |
| --- | --- |
| `inputs.identical_content_allowed` | The two files have identical content and `--allow-identical-content` was passed |
| `inputs.mapping_file_sha256` | `--mapping` was used |
| `inputs.config_file_sha256` | `--config` was used |
| `inputs.source_encoding`, `inputs.destination_encoding` | `--source-encoding` or `--destination-encoding` was passed. Both are recorded |
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
| `schema_version` | integer | Always `1` in this format |
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
| `origin` | Where the statement came from. Always `command-line option` in this version; a configuration file cannot state premises |
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

A record is a Mismatch if any result fails, Verified if every result passes, and Unverified otherwise. An empty value is `unknown` under every rule. For `digits`, a value without the digits 0–9 is `unknown`; for `date:FORMAT`, a value that does not parse is `unknown`. A date is normalized as ISO 8601, such as `2026-01-02T00:00:00`.

## Destination-only records

With scope `exact`, each destination key that is not in the source becomes one entry of `destination_only`, in the order of its first destination row. Destination rows without a key are never destination-only; they already make coverage insufficient. These entries are never in `records`.

| Member | Meaning |
| --- | --- |
| `key` | The destination key |
| `destination_row` | Position of the first destination data row with this key, starting at 0 |
| `rows` | Number of destination rows with this key |
| `state` | `Mismatch` when destination coverage is sufficient. Otherwise `Unverified`: listed, with no conclusion |
| `reason` | Why, in words |

A destination-only Mismatch makes `cohort_state` a Mismatch. An Unverified destination-only record does not change `cohort_state`.

## HTML report

`--html PATH` writes one HTML file and, like `--json`, refuses to overwrite an existing file. If either report cannot be written, neither is left behind. The page shows the cohort result and claim, every stated premise, the counts, the limitations, every record that is not Verified with its rule results, every destination-only record, and the inputs. It follows `--redact-values`.

Every value from a file is escaped. The page has no scripts and loads nothing: its styles are inline, and a Content Security Policy blocks everything else. It works when opened offline.
