# The FlowAssert check: specification

Version 1.0. This document is normative. It specifies the check that `flowassert-verify` performs and that the browser
check and the packaged JavaScript checker repeat: its inputs, how rows are read, how records are judged, what the
report holds, what is refused and how the command exits.

- [1. Conventions](#1-conventions)
- [2. Inputs](#2-inputs)
- [3. Reading a CSV file](#3-reading-a-csv-file)
- [4. Keys](#4-keys)
- [5. Field rules](#5-field-rules)
- [6. Premises and counts](#6-premises-and-counts)
- [7. Record states](#7-record-states)
- [8. The cohort state](#8-the-cohort-state)
- [9. Scope and destination-only records](#9-scope-and-destination-only-records)
- [10. The report](#10-the-report)
- [11. The printed summary](#11-the-printed-summary)
- [12. Refusals](#12-refusals)
- [13. Exit statuses](#13-exit-statuses)
- [14. Rows read by a connector](#14-rows-read-by-a-connector)
- [15. What this specification leaves open](#15-what-this-specification-leaves-open)
- [16. A worksheet of an .xlsx workbook](#16-a-worksheet-of-an-xlsx-workbook)

## 1. Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be read as in RFC 2119 and RFC 8174: they have their
special meaning only in capitals.

Every requirement has a number, and every requirement with MUST names at least one golden case that tests it. A case
is written as its folder: `golden/NAME` is `offline/golden/NAME`, `golden-sheets/NAME` is `offline/golden-sheets/NAME`, `golden-hubspot/NAME` is `offline/golden-hubspot/NAME`, `golden-xlsx/NAME` is `offline/golden-xlsx/NAME`, and `conformance/NAME` is `offline/conformance/NAME.json`.
[Conformance](../conformance.md) says how an implementation runs them. A test
(`scripts/dev/tests/test_spec.py`) fails when a requirement names no case, or a case that does not exist.

The reference implementation is `offline/flowassert_offline/`, on CPython. Where this text and the reference
implementation disagree, that is a defect in one of them, to be reported and resolved; neither silently wins.

**The one rule.** Without enough evidence, the result is never Verified. Every requirement below is an application of
it: a conclusion that needs a premise is not drawn without the premise, and a value that cannot be compared is unknown,
not equal and not different.

## 2. Inputs

A check has: a **source**, a table of rows with named columns; a **destination**, another such table; an
**obligation**, which names the key column and the compared fields; and the **premises** the caller states.

- **R2.1** A check MUST take exactly one source and one destination, each read once, the source first. Cases: `golden/example`, `golden/chunk-csv-error-before-later-decode-error`.
- **R2.2** The obligation MUST name one key column in each table and at least one compared field, each field a source column, a destination column and a rule. Cases: `golden/example`, `golden/refused-no-field`.
- **R2.3** On the command line the obligation MUST come from exactly one of: `--key` with `--field` (every rule `exact`), a `--mapping` file (every rule `exact`), or a `--config` file (a rule per field, and optionally the scope). Cases: `golden/example`, `golden/mapping-file`, `golden/rules-pass`, `golden/refused-config-with-key`, `golden/refused-mapping-with-key`.
- **R2.4** `--key` and `--field` take `COLUMN` or `SOURCE:DESTINATION`, split at the first colon; a column whose name contains a colon MUST be given through a mapping or configuration file. Cases: `golden/example`, `golden/mapping-file`, `golden/refused-empty-key-column`.
- **R2.5** A source column MUST NOT be compared twice. Cases: `golden/refused-repeated-field`, `golden/refused-config-repeated-field`.
- **R2.6** A configuration or mapping file MUST be UTF-8 JSON, with an optional byte order mark, and MUST be refused when it is not UTF-8, is not JSON, repeats a member, has an unknown member, or lacks `key` or `fields`. Cases: `golden/config-loaded-with-bom`, `golden/refused-config-not-utf8`, `golden/refused-config-not-json`, `golden/refused-config-duplicate-member`, `golden/refused-config-unknown-member`.
- **R2.7** A configuration file MUST NOT state a premise: a member named like a completeness statement, a count or the identical-content permission, in any letter case and with `-` or `_`, is refused. Cases: `golden/refused-config-premise`.
- **R2.8** The two inputs MUST be independent. The same file given twice is refused; two files with identical bytes are refused unless the caller states that they come from different systems (`--allow-identical-content`), which the report then records. Cases: `golden/refused-same-file`, `golden/refused-identical-content`, `golden/identical-content-allowed`.

## 3. Reading a CSV file

A CSV file is read as CPython's `csv.reader(strict=True)` reads text opened with `newline=""`: comma as delimiter, `"`
as quote, a quote inside a quoted field written twice, no escape character.

- **R3.1** The encoding MUST be the one stated, `utf-8` (the default), `utf-16` or `gb18030`, and MUST NOT be guessed; another name is refused. Cases: `golden/encoding-gb18030`, `golden/encoding-cli-options`, `golden/refused-bad-encoding-name`, `golden/decode-wrong-encoding`.
- **R3.2** UTF-8 MAY start with a byte order mark, which is not part of the first column name; UTF-16 MUST start with one, which chooses the byte order. Cases: `golden/encoding-utf8-bom`, `golden/encoding-utf16-le`, `golden/encoding-utf16-be`, `golden/decode-utf16-no-bom`.
- **R3.3** A file with a byte sequence that does not decode in the stated encoding MUST be refused, never read with a replacement character. Cases: `golden/decode-utf8-invalid`, `golden/decode-utf8-truncated`, `golden/decode-utf16-odd-length`, `golden/decode-utf16-lone-surrogate`, `golden/decode-gb18030-invalid`.
- **R3.4** GB18030 MUST be decoded as CPython's `gb18030` codec decodes it, including the sequences other decoders map differently. Cases: `golden/encoding-gb18030-python-mapping`.
- **R3.5** A line ends at LF, CR LF or CR; a line break inside a quoted field is part of the value and MUST be kept exactly. Cases: `golden/quoted-line-breaks`.
- **R3.6** The first row is the header. A header that repeats a column name MUST be refused, and so MUST a file without a column the obligation names; an empty file has no columns. Cases: `golden/refused-repeated-column`, `golden/refused-missing-columns`, `golden/refused-empty-file`.
- **R3.7** A blank line MUST NOT be a row: it is skipped and not counted. Cases: `golden/counts-zero`, `golden/quoted-line-breaks`.
- **R3.8** Every other row MUST have exactly as many fields as the header; a wider or narrower row is refused with its line number, which counts every line read, including the lines inside quoted values. Cases: `golden/refused-row-wider-than-header`, `golden/refused-row-narrower-than-header`, `golden/line-number-after-quoted-break`.
- **R3.9** Malformed quoting MUST be refused: a quoted field that never ends, or a closing quote followed by anything but a comma or the end of the line. Cases: `golden/refused-unexpected-end`, `golden/refused-quote-not-followed-by-comma`.
- **R3.10** A field longer than 131,072 code points MUST be refused; a field of exactly that length is read. Cases: `golden/refused-field-limit`, `golden/field-at-limit`.
- **R3.11** A file larger than the byte limit (`--max-bytes`, default 209,715,200) MUST be refused before it is read, and a file with more data rows than the row limit (`--max-rows`, default 1,000,000) MUST be refused while it is read; a file exactly at a limit is read. Cases: `golden/refused-max-bytes`, `golden/refused-max-rows`, `golden/max-rows-at-limit`.
- **R3.12** When a file has both a malformed row and a byte that does not decode, the refusal MUST be the one CPython gives when it decodes the file 8,192 bytes at a time, as the CSV reader needs each line: the problem met first in that order. Cases: `golden/chunk-csv-error-before-later-decode-error`, `golden/chunk-decode-error-in-first-chunk`.
- **R3.13** Only the columns the obligation names take part in the check. A value is the field's text exactly: no trimming, no case change, no type conversion. Cases: `golden/unsafe-values`, `golden/rules-fail`.
- **R3.14** A refused file MUST NOT be partly used: there is no report and no result. Cases: `golden/refused-row-wider-than-header`, `golden/refused-max-rows`.

## 4. Keys

- **R4.1** A row's key is the value of its key column. A key that is empty or only whitespace is **no key**; whitespace is what CPython's `str.isspace` accepts. Cases: `golden/keyless-rows`, `conformance/keyless-destination-row`.
- **R4.2** Keys MUST be compared as exact strings: no trimming, no case folding and no Unicode normalisation. Cases: `golden/unsafe-values`, `golden/scope-exact-source-known`.
- **R4.3** A source row without a key, and every source row whose key another source row also has, MUST be Unverified, with every rule result `unknown` and the reason `invalid or duplicate source key`. Cases: `golden/duplicate-source-key`, `golden/keyless-rows`, `conformance/duplicate-source-key`.
- **R4.4** A destination row without a key MUST be counted in `destination_rows_without_key` and MUST NOT be matched to any source record. Cases: `golden/keyless-rows`, `golden/scope-exact-keyless-destination`.
- **R4.5** When more than one destination row has a source record's key, the record's `uniqueness` MUST fail and no field of it is compared: no candidate is chosen. Cases: `golden/duplicate-destination-key`, `golden/example`, `conformance/duplicate-destination-key`.

## 5. Field rules

Each field has one rule, chosen by the caller and never inferred.

| Rule | Compares | Unknown when |
| --- | --- | --- |
| `exact` | The two strings as they are | Either value is empty |
| `trim` | The strings without leading and trailing whitespace (`str.strip`) | Either value is empty, or empty after trimming |
| `casefold` | The strings after full Unicode case folding (`str.casefold`) | Either value is empty |
| `digits` | Only the characters `0` to `9` of each string, in order | Either value is empty, or has none of those characters |
| `date:FORMAT` | Both values parsed with `datetime.strptime(value, FORMAT)`; a value with a UTC offset is compared as an instant in UTC | Either value is empty, does not parse, or is an instant outside the years 1 to 9999 in UTC |

- **R5.1** A field result MUST be `pass` when the compared forms are equal, `fail` when they differ, and `unknown` when there is nothing to compare, as the table says. Cases: `golden/rules-pass`, `golden/rules-fail`, `golden/rules-unknown`.
- **R5.2** An empty value MUST be `unknown` under every rule: a missing value is not assumed to be a difference. Cases: `golden/empty-values`, `golden/rules-unknown`, `conformance/empty-value`.
- **R5.3** `digits` MUST keep only the ASCII digits `0` to `9`; a digit of another script is not one of them. Cases: `golden/rules-pass`, `conformance/rule-digits-unknown`.
- **R5.4** A date with a UTC offset MUST be converted to UTC before it is compared, so two different writings of one instant pass; a conversion that leaves the years 1 to 9999 MUST be `unknown`. Cases: `golden/rules-pass`, `golden/date-overflow-unknown`, `conformance/rule-date-offset-pass`.
- **R5.5** A rule that is not one of the five, a `date:` rule without a format or without a directive, a format `strptime` cannot use, and a format that repeats a directive MUST be refused before any file is read. Cases: `golden/refused-config-unknown-rule`, `golden/refused-config-malformed-date`, `golden/refused-config-stray-percent`, `golden/refused-config-no-directive`, `golden/refused-config-repeated-directive`.
- **R5.6** For a rule other than `exact`, the result MUST record the rule and both values as the rule compared them (`expected_normalized`, `actual_normalized`), `null` where there was nothing to compare. Cases: `golden/rules-fail`, `golden/rules-unknown`.
- **R5.7** A rule MUST NOT change the value recorded as `expected` or `actual`: those are the fields' text. Cases: `golden/rules-pass`, `golden/scope-exact-source-known`.

The browser check supports the `strptime` directives `%Y %m %d %H %M %S %f %z %b %B %y %p %I %j %%`. It refuses a
format with any other directive, saying so, rather than parse it approximately; the command line accepts every
directive CPython knows.

## 6. Premises and counts

A premise is a statement by the caller that the check cannot verify. It is recorded with its origin and never
authenticated.

| Premise | Statement | Needed for |
| --- | --- | --- |
| `source_complete` | The source rows are the whole batch | A Verified batch |
| `destination_complete` | The destination rows cover the whole object | A missing record to be a Mismatch, and a single row to be unique |
| `source_count` | The total the caller saw in the source system | Nothing: it can only withdraw `source_complete` |
| `destination_count` | The total the caller saw in the destination system | Nothing: it can only withdraw `destination_complete` |
| `allow_identical_content` | Two identical inputs come from different systems | Checking them at all |

- **R6.1** A premise MUST be taken as stated only when the caller states it explicitly; it is never inferred from the data, and a configuration file cannot state it. Cases: `golden/example-without-premises`, `golden/refused-config-premise`, `conformance/unknown-source-population`.
- **R6.2** The **source population is known** exactly when `source_complete` is stated, every source row has a key, no key is repeated, and `source_count`, if stated, equals the source rows read. Cases: `golden/example`, `golden/count-source-mismatch`, `golden/duplicate-source-key`, `golden/keyless-rows`.
- **R6.3** **Destination coverage is sufficient** exactly when `destination_complete` is stated, every destination row has a key, and `destination_count`, if stated, equals the destination rows read. Cases: `golden/example`, `golden/count-destination-mismatch`, `golden/keyless-rows`.
- **R6.4** A stated count that equals the rows read MUST NOT stand in for a completeness statement. Cases: `golden/count-cli-forms`, `conformance/counts-match-without-completeness`.
- **R6.5** A stated count MUST be a whole number from 0, of any size; anything else is refused. Rows without a key are rows; blank lines are not. Cases: `golden/counts-zero`, `golden/count-cli-forms`, `golden/refused-bad-count`, `golden/refused-negative-count`.
- **R6.6** The report MUST record, for each count, what was stated, the rows read and whether they matched, also when no count was stated. Cases: `golden/example`, `golden/counts-match`, `golden/count-destination-mismatch-without-complete`.

## 7. Record states

Every source row is one record, with a result for `existence`, `uniqueness` and each compared field. Each result is
`pass`, `fail` or `unknown`, with a reason.

- **R7.1** A record MUST be a **Mismatch** when any result fails, **Verified** when every result passes, and **Unverified** otherwise. Cases: `golden/example`, `golden/rules-unknown`, `conformance/field-differs`.
- **R7.2** With exactly one destination row for its key: `existence` passes; `uniqueness` passes only when destination coverage is sufficient, and is otherwise `unknown`; each field is compared under its rule. Cases: `golden/example`, `golden/example-page-source-complete-only`.
- **R7.3** A field that differs MUST be a failure with or without any premise: a row that exists can disprove a rule on its own. Cases: `golden/example-without-premises`, `conformance/field-differs-without-premises`.
- **R7.4** With no destination row for its key: `existence` fails only when destination coverage is sufficient; otherwise it is `unknown`, and the record is Unverified, not a Mismatch. Cases: `golden/example`, `golden/example-page-source-complete-only`, `conformance/missing-incomplete-destination`.
- **R7.5** When `destination_complete` is stated but the stated destination count differs from the rows read, a missing record's `existence` MUST be `unknown`, and its reason MUST say that the count differs. Cases: `golden/count-destination-mismatch`, `conformance/destination-count-mismatch`.
- **R7.6** There is no waiting window in this check, so a record is never Pending and the `Pending` count is always 0. Cases: `golden/example`, `golden/no-rows`.

## 8. The cohort state

- **R8.1** The cohort is a **Mismatch** when any record is a Mismatch, or any destination-only record is. Cases: `golden/example`, `golden/scope-exact-source-known`.
- **R8.2** Otherwise the cohort is **Verified** only when there is at least one source row, the source population is known, and every record is Verified. Cases: `golden/rules-pass`, `golden/counts-match`, `conformance/all-verified`.
- **R8.3** Otherwise the cohort is **Unverified**. In particular every record can be Verified while the cohort is Unverified, because the source population is not known; and a check of no rows is Unverified. Cases: `golden/example-page-destination-complete-only`, `golden/no-rows`, `golden/counts-zero`, `conformance/v1-e-row-verified-cohort-unverified`.
- **R8.4** `expected_total` MUST be the number of source rows when the source population is known, and `null` otherwise. Cases: `golden/example`, `golden/example-without-premises`.
- **R8.5** Only a Verified cohort carries a claim, and the claim is the fixed sentence of section 10; every other report's `claim` MUST be `null`. Cases: `golden/rules-pass`, `golden/example`.

## 9. Scope and destination-only records

The scope is `source` (the default: each source record is checked) or `exact` (also, destination keys that are not in
the source are reported).

- **R9.1** With scope `source`, a destination row whose key is not in the source MUST NOT affect any result, and the report has no `destination_only` member. Cases: `golden/scope-source-cli`, `golden/unsafe-values`, `conformance/scope-source-extra`.
- **R9.2** With scope `exact`, each destination key that no source row has MUST be one destination-only record, in the order of its first destination row, with that row's position and the number of rows that have the key. Cases: `golden/scope-exact-keyless-destination`, `golden/scope-exact-source-known`.
- **R9.3** A destination-only record MUST be a Mismatch when the source population is known, and Unverified otherwise, because its key could belong to a source row that was not supplied. Destination coverage plays no part: the row exists. Cases: `golden/scope-exact-source-known`, `golden/scope-exact-source-unknown`, `conformance/scope-exact-source-not-complete`.
- **R9.4** A destination row without a key MUST NOT be a destination-only record. Cases: `golden/scope-exact-keyless-destination`, `conformance/scope-exact-keyless-destination-row`.
- **R9.5** A destination-only record is never in `records` and never counted in `counts`; it is counted in `destination_only_counts`. Cases: `golden/scope-exact-source-known`, `golden/scope-exact-no-extra`.
- **R9.6** A scope other than `source` or `exact` MUST be refused. Cases: `golden/refused-bad-scope`, `golden/refused-config-bad-scope`.

## 10. The report

The report is one JSON object. [Report format](../report-format.md) describes every member, and the
[JSON Schemas](../schema/) define them for each `schema_version`.

- **R10.1** The report MUST begin with `schema_version`, and a writer MUST use the version whose schema the report satisfies: 1 for two files, 2 when the source was read from Google Sheets, 3 when the destination was read from HubSpot, 4 when either side was read from an .xlsx workbook ([section 16](#16-a-worksheet-of-an-xlsx-workbook)). Cases: `golden/example`, `golden-sheets/sheet-verified`, `golden-hubspot/hubspot-verified`, `golden-xlsx/xlsx-verified`.
- **R10.2** `records` MUST hold one record per source row, in file order, with `source_row` counting from 0. Cases: `golden/example`, `golden/duplicate-source-key`.
- **R10.3** With details `problems` (the default) a Verified record MUST have only `key`, `source_row` and `state`; with `all`, every record has every member. The details level MUST NOT change any state, count or the summary. Cases: `golden/example`, `golden/example-details-all`.
- **R10.4** With `--redact-values` every record key and destination-only key MUST be `[redacted]`, and no field result has `expected`, `actual`, `expected_normalized` or `actual_normalized`; states, reasons and counts are unchanged. Cases: `golden/example-redacted`, `golden/rules-redacted`, `golden/scope-exact-cli`, `golden/unsafe-values-details-all`.
- **R10.5** `inputs` MUST record the SHA-256 of each input's bytes as read, whether they are identical, and the SHA-256 of a mapping or configuration file that was used. Cases: `golden/example`, `golden/mapping-file`, `golden/rules-pass`, `golden/identical-content-allowed`.
- **R10.6** The encodings MUST be recorded when either was chosen explicitly, both together. Cases: `golden/encoding-cli-options`, `golden/example-page`.
- **R10.7** Each premise MUST be recorded with what was stated and its origin, whether or not it was stated. Cases: `golden/example-without-premises`, `golden/example-page`.
- **R10.8** `obligation` MUST record the key, the fields in order, whether every rule is `exact` (`comparison`), the rules when a configuration file gave them, and the scope when it was chosen. Cases: `golden/example`, `golden/rules-pass`, `golden/scope-source-cli`.
- **R10.9** Every report MUST carry `limitations`, and `workflow_execution`, `business_truth` and `existed_by_deadline` as `Not assessed`, and `acquisition_authenticity` as `not_authenticated`: the check never assesses them. Cases: `golden/example`, `golden/rules-pass`.
- **R10.10** The JSON text MUST be UTF-8 with every character outside ASCII written as a `\u` escape, members sorted by code point except `schema_version`, which is first, two spaces of indentation, and no line break after the closing brace. Cases: `golden/unsafe-values`, `golden/scope-exact-source-known`.
- **R10.11** The HTML report, when written, MUST show the same result as the JSON report, escape every value from a file, contain no script and load nothing. Cases: `golden/unsafe-values`, `golden/scope-exact-source-known`.
- **R10.12** A report file is never written over an existing file, and when either report cannot be written neither is left behind. This is required, and tested outside the golden cases, which always write to new files; see [section 15](#15-what-this-specification-leaves-open).

The claim of a Verified report is exactly: "At this evaluation, under the stated premises, the supplied destination
rows satisfy the rules for the supplied source rows." The limitations are exactly: "Files and completeness statements
are not authenticated. Not assessed: whether a workflow ran, whether the source is true, whether a record existed by a
past deadline."

## 11. The printed summary

After a check that was not refused, the command prints these lines to standard output, in this order, each only when
its condition holds:

| Line | When |
| --- | --- |
| `STATE: N rows of TOTAL` | Always; `TOTAL` is `expected_total` or `unknown total` |
| `Verified A · Mismatch B · Unverified C` | Always |
| The lines of a connector ([section 14](#14-rows-read-by-a-connector)) | The source or the destination was read by a connector |
| The lines of a workbook ([section 16](#16-a-worksheet-of-an-xlsx-workbook)) | Either side was read from an .xlsx workbook |
| `Source and destination files were identical (--allow-identical-content).` | The inputs were identical |
| `Source count stated S, file has N rows: the batch cannot be Verified.` | The stated source count differs |
| `Destination count stated S, file has N rows: absence and uniqueness stay unknown.` | The stated destination count differs |
| `Source population unknown: the batch cannot be Verified.` | The source population is not known |
| `Destination coverage not established: absence and uniqueness stay unknown.` | Destination coverage is not sufficient |
| `Destination-only: N records not in the source…` | Scope `exact`: `0 records not in the source.`, or `, each a Mismatch.`, or `, listed without a conclusion.` |
| `  record R KEY: STATE`, then `    RULE STATUS: REASON (VALUES)` for each result that did not pass | For each record that is not Verified, up to `--max-details` (default 50); `R` counts from 1, and a record without a key prints `(no key)` |
| `... N more records not shown; use --json for all of them.` | More such records than `--max-details` |
| The limitations | Always |

- **R11.1** The summary MUST be these lines and no others, each ending with a line feed. Cases: `golden/example`, `golden/scope-exact-source-known`, `golden/count-source-mismatch`.
- **R11.2** `--max-details` MUST limit only the record lines of the summary: no state, count or report changes with it, and 0 prints none. Cases: `golden/example-max-details-1`, `golden/example-max-details-0`.
- **R11.3** A value in a record line is written as CPython's `repr` writes a string, so that an empty string, a space and a control character are visible. Cases: `golden/unsafe-values`, `golden/rules-fail`.

## 12. Refusals

A refusal is the answer to an input that cannot be checked. It concludes nothing.

- **R12.1** A refused check MUST print one line, `refused: MESSAGE`, to standard error, print nothing to standard output, write no report, and exit with status 2. Cases: `golden/refused-max-rows`, `golden/refused-identical-content`, `golden/decode-utf8-invalid`.
- **R12.2** A refusal that concerns a file MUST begin with that file's name as it was given. Cases: `golden/refused-row-wider-than-header`, `golden/refused-config-not-json`.
- **R12.3** Every option MUST be validated, and the configuration read, before either input is read, in the order of the table below; of several problems, the first in that order is the one reported. Cases: `golden/refused-bad-details`, `golden/refused-config-with-key`, `golden/refused-max-bytes`.

The messages, in the order in which they can arise. `FILE` is a file's name, `N` a number, `NAMES` a list separated by
`, `:

| Message | When |
| --- | --- |
| `--max-details must be a non-negative integer` | The limit of the summary's record lines is not a whole number from 0 |
| `--max-bytes must be a positive integer`, `--max-rows must be a positive integer` | The limit is not a whole number from 1 |
| `--source-count must be a non-negative integer`, `--destination-count …` | R6.5 |
| `--details must be one of: problems, all` | Another details level |
| `--source-encoding must be one of: utf-8, utf-16, gb18030`, `--destination-encoding …` | R3.1 |
| `--config cannot be combined with NAMES` | `--config` with `--mapping`, `--key`, `--field` or `--scope` |
| `--scope must be one of: source, exact` | R9.6 |
| `--mapping cannot be combined with --key or --field` | R2.3 |
| `--key or --mapping is required`, `at least one --field is required` | R2.2 |
| `empty column name in 'TEXT'` | `--key` or `--field` with nothing before the colon |
| `FILE: …` for a configuration or mapping file | R2.6, R2.7, R5.5, R9.6: `not UTF-8`; `invalid JSON (…)`; `duplicate member 'NAME'`; `configuration must be a JSON object`; `mapping must be a JSON object`; `NAMES cannot be set in a configuration file; completeness statements and counts are command-line options, chosen at each run`; `unknown member NAMES`; `missing member NAMES`; `key must be a two-item list of strings`; `empty column name in key`; `fields must be a non-empty list`; `each field must be an object with source, destination and an optional rule`; `unknown member NAMES in field`; `missing member NAMES in field`; `field source must be a string`; `empty column name in field`; `field rule must be a string`; `field 'NAME': …` with the rule's error; `a source field is repeated`; `scope must be one of: source, exact` |
| `a source field is repeated` | R2.5 |
| `source and destination are the same file, so the check would not be independent` | R2.8 |
| `FILE: file size N bytes exceeds --max-bytes limit of N` | R3.11 |
| `FILE: repeated column name`, `FILE: missing column NAMES` | R3.6 |
| `FILE: line N does not match the header` | R3.8 |
| `FILE: exceeds --max-rows limit of N` | R3.11 |
| `FILE: not UTF-8`, `FILE: not UTF-16`, `FILE: not UTF-16 (no byte order mark)`, `FILE: not GB18030` | R3.2, R3.3 |
| `FILE: unexpected end of data`, `FILE: ',' expected after '"'`, `FILE: field larger than field limit (131072)`, `FILE: new-line character seen in unquoted field - do you need to open the file with newline=''?` | R3.9, R3.10; the texts are CPython's |
| `FILE: …` with the operating system's message | The file cannot be opened or read |
| `source and destination have identical content, so the check would not be independent; pass --allow-identical-content if they really come from different systems` | R2.8, after both inputs were read |

The refusals of a workbook are listed in [section 16](#16-a-worksheet-of-an-xlsx-workbook) and, each with its text, in the [Excel design note](../design/1.1-excel.md#refusals-and-bounds); the option refusals among them come after the encodings in this order. The refusals of `--export-dir` are listed in [section 17](#17-records-to-resend).

- **R12.4** The texts in this table are part of the format: an implementation MUST give them exactly. Cases: `golden/refused-bad-count`, `golden/refused-config-premise`, `golden/refused-field-limit`, `golden/decode-utf16-no-bom`.

## 13. Exit statuses

| Status | Meaning |
| --- | --- |
| 0 | The cohort is Verified |
| 1 | The cohort is a Mismatch |
| 3 | The cohort is Unverified |
| 2 | The input was refused; nothing was checked |
| 4 | The checker failed internally; nothing can be concluded |

- **R13.1** The exit status MUST follow the cohort state: 0, 1 or 3. Cases: `golden/rules-pass`, `golden/example`, `golden/example-without-premises`.
- **R13.2** A refusal MUST exit with 2, which is never the status of a result. Cases: `golden/refused-max-rows`, `golden/decode-wrong-encoding`.
- **R13.3** An internal failure exits with 4 and prints `failed: NAME` to standard error, never 1, which would read as a Mismatch. No golden case can provoke one; see [section 15](#15-what-this-specification-leaves-open).

## 14. Rows read by a connector

A connector reads one side's rows itself instead of taking a file. It changes where the rows come from and nothing
else.

- **R14.1** The same rows MUST give the same records, rule results, counts, cohort state and exit status whether a connector read them or a CSV file held them. Cases: `golden-sheets/sheet-mismatch`, `golden-sheets/sheet-config-rules-exact-redacted`, `golden-hubspot/hubspot-mismatch`, `golden-hubspot/hubspot-config-rules-exact-redacted`.
- **R14.2** A connector MUST NOT state a premise. Reading every row a service returns does not show that the rows are the whole batch or the whole object: completeness stays the caller's statement, with the same effect as for a file. Cases: `golden-sheets/sheet-unverified`, `golden-hubspot/hubspot-unverified`.
- **R14.3** A connector MUST only read: HTTPS `GET` to the documented hosts, with TLS verified, no redirect followed, no proxy and no retry. Cases: `golden-sheets/sheet-verified` (its `requests.json`), `golden-sheets/sheet-refused-redirect`, `golden-hubspot/hubspot-many-pages` (its `requests.json`), `golden-hubspot/hubspot-refused-redirect`.
- **R14.4** A read that fails or is in doubt MUST be a refusal with no report: an error status, a rate limit, a timeout, a redirect, a response that is not the documented shape, or a source that changed while it was read. Cases: `golden-sheets/sheet-refused-429`, `golden-sheets/sheet-refused-not-json`, `golden-sheets/sheet-refused-changed`, `golden-hubspot/hubspot-refused-429`, `golden-hubspot/hubspot-refused-repeated-record`, `golden-hubspot/hubspot-refused-archived`.
- **R14.5** The credential MUST come from an environment variable and MUST NOT appear in the summary, a report, a refusal or an error. Cases: `golden-sheets/sheet-refused-401`, `golden-sheets/sheet-api-key`, `golden-hubspot/hubspot-refused-401`, `golden-hubspot/hubspot-verified`.
- **R14.6** The report MUST record where and when the rows were read, and the digest of a documented canonical form of them, in place of a file's digest. Cases: `golden-sheets/sheet-verified`, `golden-hubspot/hubspot-verified`.
- **R14.7** A destination read page by page MUST be refused when a record appears twice, when a page gives a paging cursor it has given before, or when a page names a next page and holds no record: each means the list changed or the pages repeat. Cases: `golden-hubspot/hubspot-refused-repeated-record`, `golden-hubspot/hubspot-refused-repeated-cursor`, `golden-hubspot/hubspot-refused-empty-page-with-next`.
- **R14.8** A property the destination's records have no value for MUST be an empty value, as an empty cell is; a property they do not have at all MUST be a refusal, as a missing column is. Cases: `golden-hubspot/hubspot-null-values`, `golden-hubspot/hubspot-refused-missing-property`.

The design notes are part of this specification for their connectors: [Google Sheets source](../connectors/google-sheets.md) and [HubSpot Contacts destination](../connectors/hubspot.md).
It gives each option, request, refusal and report member.

## 15. What this specification leaves open

What the reference implementation does that depends on its platform, and what this text requires that no golden case
tests. Each is stated so that nobody has to discover it.

| Matter | State |
| --- | --- |
| **Unicode version.** `casefold`, the whitespace of `trim` and of an empty key, and which characters `repr` escapes in the summary follow the Unicode version of the running Python. | Left open. The golden cases use characters whose behaviour is the same from Unicode 13 (Python 3.9) to Unicode 17 (Python 3.15). The browser check follows Python 3.15. A value with a character whose case folding or whitespace status changed between versions can compare differently on two Pythons |
| **`strptime` across Python versions.** Python 3.15 refuses a format with `%d` and no year, and accepts a value without the offset `%z` asks for; earlier versions differ. | Left open, and followed as Python 3.15 behaves in the browser. A format that parses the same on every supported Python is unaffected; the golden cases use only such formats |
| **Operating-system messages** in a refusal (`No such file or directory`) are the platform's. | Left open: the text after the file name is not part of the format |
| **R10.12, not overwriting a report.** | Required, and tested by `test_existing_report_is_not_overwritten`, `test_html_report_never_overwrites_and_leaves_no_partial_output` and `test_a_failed_html_write_removes_both_reports` in `scripts/dev/tests/test_offline_verify.py`, not by a golden case: the golden runner always writes to new files |
| **R13.3, exit status 4.** | Required, and tested by `test_internal_failure_is_not_a_mismatch`, not by a golden case: a golden case cannot make the checker fail internally |
| **The same file given twice** is recognised by its resolved path on the command line. The browser cannot see paths, and treats two choices as the same file when their name, size, modification time and bytes are equal. | A difference of platform: both refuse with the same message |
| **`--mapping`** exists only on the command line. | The browser and the packaged checker always run as `--config` |
| **Usage errors** (an option that does not exist, no `--destination`) are printed by the argument parser and exit with 2. | Their text is not part of the format |
| **A workbook that changed while it was read** is refused on the command line, which compares the file's size and modification time before and after. A file chosen in the browser cannot change. | A difference of platform |
| **A part that is both damaged and malformed.** The two implementations meet every problem in the order of its position in the inflated text, data after the end of a deflate stream and a part that inflates to more than the archive records among them (the text up to the recorded size is read first), except a deflate stream damaged midway: Python's zlib gives none of the text a failing block would have given, and a browser's `DecompressionStream` may give some. | Left open: both refuse, and the message can name either problem. No golden case is both |
| **`DecompressionStream`.** The browser and the packaged checker inflate a workbook's parts with the platform's `DecompressionStream("deflate-raw")`; a JavaScript platform without it refuses every workbook. | A difference of platform, refused with its own message |

## 16. A worksheet of an .xlsx workbook

From 1.1.0 either side can be one worksheet of an .xlsx workbook (`--source-format xlsx`, `--destination-format xlsx`).
The [Excel design note](../design/1.1-excel.md) is part of this specification for workbooks: it defines the text of
every cell, every refusal with its text, and every bound.

- **R16.1** A side MUST be read as a workbook only when its format option says `xlsx`, and never because of a file's name or content. `--source-worksheet` without `--source-format xlsx`, and an encoding with a workbook, are refused. Cases: `golden-xlsx/xlsx-verified`, `golden-xlsx/xlsx-refused-worksheet-without-format`, `golden-xlsx/xlsx-refused-encoding-with-workbook`, `golden-xlsx/xlsx-refused-format-name`.
- **R16.2** The worksheet MUST be the sheet whose name equals the one given, exactly; without a name, the workbook MUST have exactly one sheet, or the check is refused with every sheet's name. A sheet that is not a worksheet is refused. Cases: `golden-xlsx/xlsx-hidden-sheet-by-name`, `golden-xlsx/xlsx-refused-several-sheets`, `golden-xlsx/xlsx-refused-no-such-worksheet`, `golden-xlsx/xlsx-refused-chart-sheet`.
- **R16.3** The header MUST be row 1, from column A to its last non-empty cell; an empty row 1 is refused. Cases: `golden-xlsx/xlsx-verified`, `golden-xlsx/xlsx-refused-row-1-empty`, `golden-xlsx/xlsx-refused-repeated-column`, `golden-xlsx/xlsx-refused-missing-column`.
- **R16.4** A later row with no non-empty cell MUST NOT be a record; cells left out of a row are empty; a non-empty cell beyond the header's last column, a cell or row out of order and a reference outside the worksheet MUST be refused. Cases: `golden-xlsx/xlsx-gaps-and-no-references`, `golden-xlsx/xlsx-refused-beyond-header`, `golden-xlsx/xlsx-refused-cell-out-of-order`, `golden-xlsx/xlsx-refused-row-out-of-order`, `golden-xlsx/xlsx-refused-huge-column`.
- **R16.5** Each cell's text MUST be the stored value written as the design note defines it, for every cell type and number format, with no locale: numbers as ECMAScript's `Number::toString`, dates and times in ISO 8601 in the workbook's date system, booleans as `TRUE` or `FALSE`, a formula's cached value, escapes decoded. Cases: `golden-xlsx/xlsx-cell-forms`, `golden-xlsx/xlsx-date-1904`.
- **R16.6** A cell whose text the design note does not define MUST be refused: an error value, a formula without a cached value, a number format that is not defined or not read, a serial number that is not a date in the date system, an unknown type, and a value that is not of its type. Cases: `golden-xlsx/xlsx-refused-error-value`, `golden-xlsx/xlsx-refused-formula-without-value`, `golden-xlsx/xlsx-refused-undefined-format`, `golden-xlsx/xlsx-refused-unread-format`, `golden-xlsx/xlsx-refused-date-60`, `golden-xlsx/xlsx-refused-unknown-type`, `golden-xlsx/xlsx-refused-not-a-number`.
- **R16.7** A file that is not an .xlsx workbook FlowAssert can read with certainty MUST be refused: an OLE compound file (a legacy .xls or a password-protected workbook), a file that is not a ZIP archive, a damaged archive, a ZIP64 archive, a repeated or encrypted entry, a macro-enabled, Strict or other workbook, an external relationship, a part that is not UTF-8, has a `DOCTYPE` or is not well-formed XML. Cases: `golden-xlsx/xlsx-refused-ole`, `golden-xlsx/xlsx-refused-not-zip`, `golden-xlsx/xlsx-refused-crc`, `golden-xlsx/xlsx-refused-zip64`, `golden-xlsx/xlsx-refused-macro-enabled`, `golden-xlsx/xlsx-refused-strict`, `golden-xlsx/xlsx-refused-external`, `golden-xlsx/xlsx-refused-doctype`, `golden-xlsx/xlsx-refused-not-well-formed`, `golden-xlsx/xlsx-refused-not-utf8`.
- **R16.8** `--max-bytes` MUST bound the bytes inflated from the parts read, together, as well as the file's size, so that inflating stops at the limit; `--max-rows` counts data rows. Cases: `golden-xlsx/xlsx-bomb-within-bounds`, `golden-xlsx/xlsx-refused-bomb-beyond-bounds`, `golden-xlsx/xlsx-max-rows-at-limit`, `golden-xlsx/xlsx-refused-max-rows`.
- **R16.9** The report MUST have `schema_version` 4 and record, for each side read from a workbook, `inputs.source_workbook` or `inputs.destination_workbook`: the worksheet, the date system, the file's SHA-256, the counts of the cells by how they were read, and the canonical form `flowassert-xlsx-csv-1`, whose SHA-256 is the side's digest. Cases: `golden-xlsx/xlsx-verified`, `golden-xlsx/xlsx-both-workbooks-scope-exact`, `golden-xlsx/xlsx-destination-workbook-source-encoding`.
- **R16.10** Identical content MUST compare the sides' digests: a worksheet and a CSV file holding the same rows are identical content. Cases: `golden-xlsx/xlsx-identical-content-refused`, `golden-xlsx/xlsx-identical-content-allowed`.
- **R16.11** The summary MUST say, for each side read from a workbook, which worksheet was read and that cells were read as stored, not as displayed, with the counts of the cells a spreadsheet may display otherwise and of the hidden rows, hidden columns and merged ranges. Cases: `golden-xlsx/xlsx-cell-forms`, `golden-xlsx/xlsx-unverified`.
- **R16.12** The same rows MUST give the same records, rule results, counts, cohort state and exit status whether a worksheet or a CSV file holds them (R14.1). Cases: `golden-xlsx/xlsx-mismatch`, `golden-xlsx/xlsx-config-rules`, `golden-xlsx/xlsx-redacted`.

## 17. Records to resend

From 1.1.0, `--export-dir DIR` also writes, after the check, CSV files of the rows that need action. The
[exports design note](../design/1.1-exports.md) is part of this specification for them: it defines each file, which
record goes to which, and their bytes. `scripts/dev/tests/test_exports.py` runs every golden case with and without
`--export-dir`, and `ui/src/test/offline/exports.test.ts` requires the TypeScript checker to write the same bytes.

- **R17.1** `--export-dir` MUST NOT change any record, rule result, count, cohort state, report or exit status, and MUST NOT change the summary's lines; it only adds lines after them. Cases: `golden/example`, `golden/scope-exact-source-known`, `golden-xlsx/xlsx-mismatch`, `golden-sheets/sheet-mismatch`, `golden-hubspot/hubspot-mismatch`.
- **R17.2** Each source record that is not Verified MUST be in exactly one file: `missing-from-destination.csv` when `existence` failed, `duplicated-in-destination.csv` when `uniqueness` failed, `values-differ.csv` for any other Mismatch, and `unknown-status-resending-may-create-duplicates.csv` when it is Unverified or Pending. Cases: `golden/example`, `golden/rules-fail`, `golden/example-page-no-premises`.
- **R17.3** A destination not stated complete MUST NOT give `missing-from-destination.csv`, and the summary MUST say that absence is not established when records were not found. Cases: `golden/example-without-premises`, `golden/scenario-contacts-crm-no-statements`.
- **R17.4** With scope `exact`, each destination row whose key is not in the source MUST be in `only-in-destination.csv` when its record is a Mismatch, and in `only-in-destination-not-concluded.csv` when it is Unverified. Cases: `golden/scope-exact-source-known`, `golden/scope-exact-source-unknown`.
- **R17.5** Each exported row MUST be the row as read, every column, under its own file's header, in UTF-8 with a byte order mark and CR LF line endings, quoted only where a reader needs it, so that reading the file back gives the rows exactly; no text is changed, including text a spreadsheet would run as a formula, which the summary counts. Cases: `golden/example`, `golden/unsafe-values`, `golden/quoted-line-breaks`, `golden-xlsx/xlsx-cell-forms`.
- **R17.6** `--export-dir` MUST be refused with `--redact-values`, and when `DIR` exists, before either input is read; a file that changed between the check and the export MUST be refused; and when any file or report cannot be written, nothing MUST be left behind. Cases: `golden/example-redacted`.

| Message | When |
| --- | --- |
| `--export-dir cannot be combined with --redact-values: the exported rows hold the values` | After the formats, before the configuration is read |
| `DIR: exists; --export-dir writes to a new directory` | `DIR` exists, even as a link to nothing |
| `FILE: changed after it was checked; nothing was exported` | A side read again does not have the digest it had |
| `DIR: …` with the operating system's message | The directory or a file in it cannot be written |
