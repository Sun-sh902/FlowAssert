# Google Sheets source: design note

English | [简体中文](google-sheets.zh-CN.md)

Status: FlowAssert 0.7.0, command line only. Written before the code, and kept in step with it. Nothing here has been
tried against Google: every statement about Google's behaviour comes from documentation, and is marked as such. The
statements marked **[doc]** come from a document listed in [Sources](#sources); the statements marked
**[unconfirmed]** come from Google documentation pages that could not be opened from the machine this was written on,
so they rest on general knowledge of the API and must be confirmed by the owner's live check
([scripts/dev/sheets_live_check.md](../../scripts/dev/sheets_live_check.md)). Statements about what FlowAssert does are
about its own code and tests, which run against a local fake of the two endpoints.

- [What the read shows, and what it does not](#what-the-read-shows-and-what-it-does-not)
- [Options and environment variables](#options-and-environment-variables)
- [The range](#the-range)
- [The requests](#the-requests)
- [From a values response to rows](#from-a-values-response-to-rows)
- [The canonical form](#the-canonical-form)
- [The revision check](#the-revision-check)
- [Identical content](#identical-content)
- [Refusals](#refusals)
- [The report](#the-report)
- [Sources](#sources)

## What the read shows, and what it does not

With `--source-sheet`, the source rows are not a CSV file the person exported: FlowAssert reads them itself, from one
bounded range of one tab, through the Google Sheets API, read-only.

It shows: which values the range held, as the API returned them, when FlowAssert read it; that no export step could
have cut the rows short or edited them on the way; and, when Google Drive gives a revision reference, that the file's
version did not change between just before and just after the values were read.

It does not show:

- **that the range holds every record that should exist.** Whether the sheet range is the whole cohort is still the
  person's statement, `--source-complete`, recorded as a premise FlowAssert does not verify, with the same meaning and
  the same effect as for a file. Without it the batch is never Verified.
- that the values are true, or that the sheet is the right source;
- that a workflow made any write, or that a record existed by a past deadline;
- that a second read at the same revision gives the same values: formulas that depend on the time or on other files
  can change without a new version **[unconfirmed]**;
- anything about the destination, which is still a CSV file with the same premises as before.

A sheet source is never "more Verified" than the same rows in a CSV file: the same cell values give the same records,
rule results, counts and cohort state, and tests hold the two paths to that.

## Options and environment variables

| Option | Meaning |
| --- | --- |
| `--source-sheet ID` | Read the source from this spreadsheet, in place of `--source FILE`. The ID is the part of the spreadsheet's address between `/d/` and the next `/` **[unconfirmed]**. Letters, digits, `-` and `_` only, at most 200 characters |
| `--source-range RANGE` | The range to read, in A1 notation with a tab and bounded columns, such as `Leads!A1:F` or `Leads!A1:F500`. Required with `--source-sheet` |
| `--source-timeout SECONDS` | The longest each request may take, from connecting to the last byte of the response (default 60) |
| `--skip-source-revision` | Do not ask Google Drive for the revision reference. The report then says that the read cannot be tied to a revision |

`--source-sheet` and `--source` cannot be combined. `--source-range`, `--source-timeout` and `--skip-source-revision`
need `--source-sheet`. `--source-encoding` does not apply to a sheet and is refused with it. Everything else works as
for a file: `--max-rows` (data rows, the header not counted), `--max-bytes` (the size of each response body),
`--key`, `--field`, `--mapping`, `--config`, `--scope`, the premises and counts, `--details`, `--max-details`,
`--redact-values`, `--json` and `--html`.

The credential is taken only from the environment, never from an argument or a file:

| Variable | Holds |
| --- | --- |
| `FLOWASSERT_SHEETS_TOKEN` | An OAuth 2.0 access token, sent as `Authorization: Bearer TOKEN` |
| `FLOWASSERT_SHEETS_API_KEY` | An API key, for a sheet shared so that anyone with the link can view it, sent as the `key` query parameter **[doc]** |
| `FLOWASSERT_SHEETS_TEST_ENDPOINT` | For tests only: `http://127.0.0.1:PORT` or `http://[::1]:PORT`. Both requests go there instead of to Google. Any other value is refused |

Exactly one of the two credentials must be set. A credential must be printable ASCII without spaces, at most 4,096
characters; anything else is refused without showing it. FlowAssert never prints, logs, stores or writes a credential:
not in the summary, a report, a refusal or an error. It does not run an OAuth sign-in: the person obtains a token or key
themselves ([the guide](../guides/google-sheets.md) says how, in general terms), and should grant only the read-only
scopes below.

The two read-only scopes are `https://www.googleapis.com/auth/spreadsheets.readonly`, described as "See all your Google
Sheets spreadsheets", and `https://www.googleapis.com/auth/drive.metadata.readonly`, "See information about your Google
Drive files" **[doc]**. `spreadsheets.values.get` accepts `spreadsheets.readonly` **[doc]**, and Drive's `files.get`
accepts `drive.metadata.readonly` **[doc]**. A token with only `spreadsheets.readonly` can be used with
`--skip-source-revision`. FlowAssert cannot see which scopes a token carries; a wider token would still only be used for
the two `GET` requests below.

## The range

`--source-range` must be `TAB!START:END`, where:

- `TAB` is a tab name, either unquoted (letters, digits, `_` and `.`) or in single quotes, with a quote inside written
  twice, such as `'Q3 leads'` or `'Ann''s list'`. The quoting rules are Google's A1 notation **[unconfirmed]**.
- `START` is a column and an optional row, such as `A1` or `A`; without a row, the range starts at row 1.
- `END` is a column and an optional row, such as `F500` or `F`; without a row, the range runs to the last row of the tab.
- Columns are 1 to 3 letters, `A` to `ZZZ`, upper or lower case. Rows are whole numbers from 1, at most 8 digits.
- The start column is not after the end column, and the start row is not after the end row.

Refused: a range without a tab (`A1:F`, which the API would read from the first visible tab **[unconfirmed]**), a
defined name (a "named range" such as `Leads2026`), a single cell, a whole-row range such as `Leads!1:500` (columns
unbounded), R1C1 notation, and anything else. A defined name is refused because the command and the report would not
show which tab and which cells were read.

The first row of the range is the header row; every later row is a data row.

## The requests

FlowAssert sends three HTTPS `GET` requests, one after another, and nothing else:

1. Drive revision metadata, before the values (left out with `--skip-source-revision`):
   `GET https://www.googleapis.com/drive/v3/files/ID?fields=version,modifiedTime&supportsAllDrives=true` **[doc]**
2. The values:
   `GET https://sheets.googleapis.com/v4/spreadsheets/ID/values/RANGE?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING` **[doc]**
3. Drive revision metadata again, after the values (left out with `--skip-source-revision`).

`ID` and `RANGE` are percent-encoded, so neither can change the path. With an API key, `&key=KEY` is added to each
request. Each request also sends `Accept: application/json`, `Accept-Encoding: identity` and
`User-Agent: flowassert-verify/VERSION`.

How they are sent:

- With `http.client` from the standard library, one new connection per request, to port 443 of
  `www.googleapis.com` or `sheets.googleapis.com` only. No proxy is used, even when `HTTPS_PROXY` is set.
- TLS uses `ssl.create_default_context()`: the certificate and the host name are verified. There is no option to turn
  that off. On Python from python.org on macOS, the certificates may need installing first ("Install
  Certificates.command" in the Python folder); otherwise the request is refused as a certificate that could not be
  verified.
- A redirect is never followed: any 3xx response is a refusal.
- There is no retry. A rate limit, a server error or a timeout is a refusal, and the person runs the check again.
- A response body larger than `--max-bytes` is refused as soon as it is larger; it is not read further.

## From a values response to rows

The values response is a `ValueRange`: `range`, `majorDimension` and `values` **[doc]**.

- **`range`** is "the entire requested range, even though the values will exclude trailing rows and columns" **[doc]**.
  FlowAssert requires it to be the range asked for: the same tab (compared after removing the quotes), the same
  columns and the same start row. When the request named an end row, the end row must be the same; when it did not,
  the response may name one (the last row of the tab **[unconfirmed]**). Anything else is refused.
- **`majorDimension`** must be `ROWS`.
- **`values`** is a list of rows, each a list of cells. "Empty trailing rows and columns will not be included" **[doc]**,
  and when the range is empty the member can be absent **[unconfirmed]**: that is read as no rows at all.

Rows are built as follows:

| In the response | Becomes |
| --- | --- |
| The first row | The header. Its width is the number of cells it has, so trailing empty header cells are not part of it. A header cell in the middle that is empty is a column named `""`, as in a CSV header |
| A row with fewer cells than the header | Padded with empty strings: cells omitted at the end of a row are empty cells. The description says that "empty trailing rows and columns will not be included" **[doc]**; that each row's own trailing empty cells are left out is **[unconfirmed]** |
| A row with more cells than the header | Refused: a value in a column without a name cannot be checked, and a CSV file would be refused for the same row |
| An empty row (`[]`) between rows | A data row whose cells are all empty. It has no key, so the source population is not known. FlowAssert does not skip it, because it cannot tell an empty record from a gap; remove it or narrow the range |
| Rows omitted at the end of the range | Not rows. They are empty in the sheet **[doc]** |
| An empty string | An empty value: `unknown` under every rule, as in a CSV file |
| A cell that is not a string | Refused (see the render options below) |
| More rows than the range has, or more cells than its columns | Refused |

**Render options.** FlowAssert asks for `FORMATTED_VALUE`: "Values will be calculated & formatted in the response
according to the cell's formatting. Formatting is based on the spreadsheet's locale, not the requesting user's
locale" **[doc]**. So every cell arrives as the text the sheet shows, which is also what a CSV export of the sheet
holds, and what a destination CSV file is compared with. A number formatted as `1,234.50` arrives as `"1,234.50"`, and
a date formatted as `2026-01-02` arrives as `"2026-01-02"`, to be read by a `date:%Y-%m-%d` rule. The alternatives were
rejected: `UNFORMATTED_VALUE` gives numbers as JSON numbers, which have no single text form to compare (`1`, `1.0`,
`1e3`), and dates as serial numbers; `FORMULA` gives formulas, not values. FlowAssert also sends
`dateTimeRenderOption=FORMATTED_STRING`, which is "ignored if value_render_option is FORMATTED_VALUE" **[doc]**: it is
sent and recorded so the report names both options explicitly. The options are fixed in this release; a person
cannot choose others.

Because the values are formatted in the spreadsheet's locale, changing the sheet's locale or a column's number format
changes the values read, and so possibly the result. That is a change in the source, and the report's digest changes
with it.

`--max-rows N` refuses a range with more than `N` data rows, after the response is read; the header row is not
counted. To keep a read small, bound the rows in the range itself.

## The canonical form

The rows read are written once, in memory, as a CSV text, and `inputs.source_sha256` is the SHA-256 of its bytes. The
form, named `flowassert-sheet-csv-1`, is:

- UTF-8 without a byte order mark;
- the header row, then every data row, each padded with empty strings to the header's width, each ending with a line
  feed (`\n`, also after the last row);
- cells separated by `,`;
- a cell in double quotes, with each `"` inside written twice, when it contains `,`, `"`, a carriage return or a line
  feed, or when it is the only cell of its row and is empty; every other cell as it is.

An empty range has no header, so it is refused for its missing columns before anything is hashed.

This is a CSV file that `flowassert-verify --source` reads as exactly the same rows. A person can therefore rebuild
the digest from the values, and the tests use this form to prove that a sheet and a file with the same rows give the
same result. It is not the same as the bytes of a CSV file downloaded from the sheet, which may use other line endings
or quoting **[unconfirmed]**.

## The revision check

Google Drive's `files.get` returns, among other fields, `version`: "A monotonically increasing version number for the
file. This reflects every change made to the file on the server, even those not visible to the user", an int64 written
as a string; and `modifiedTime`: "The last time the file was modified by anyone (RFC 3339 date-time)" **[doc]**. The
field `headRevisionId` "is currently only available for files with binary content in Google Drive" **[doc]**, which a
Google Sheets spreadsheet is not, so FlowAssert does not ask for it.

FlowAssert reads `version` and `modifiedTime` just before and just after the values:

- Both reads give a `version`, and the two are the same (and so are the two `modifiedTime` values): the report records
  them, and the summary says "Drive version V before and after the values were read."
- Both give a `version`, and either value differs: refused, "the sheet changed while it was read". Because `version`
  counts changes that are not visible to the user **[doc]**, this can refuse a read in which no cell changed; the
  person runs the check again.
- Neither read gives a `version` (a response without that member): the check goes ahead. The report and the summary
  say that the read cannot be tied to a revision, and why.
- One read gives a `version` and the other does not: refused, as a read that cannot be tied to one state.
- `--skip-source-revision`: no Drive request is made, and the report and the summary say that the read cannot be tied
  to a revision because it was not requested.
- Any error from Drive (401, 403, 404, 429, 5xx, a timeout, a response that does not parse) is a refusal, like an
  error from Sheets. A token without `drive.metadata.readonly` is expected to get 403 here **[unconfirmed]**: use
  `--skip-source-revision` with it.

Equal versions show that Drive recorded no change between the two metadata reads. Google does not document that a
values response reflects exactly that version, so the report records what was observed around the read, not a
guarantee about it.

## Identical content

Identical-content detection is kept, and works as for two files: when the digest of the canonical form equals the
digest of the destination file's bytes, the check is refused unless `--allow-identical-content` is passed, and the
report records `identical_content`. It is meaningful in one narrow case: a destination file that holds exactly the
canonical form of the sheet, for example one written from the same values, which would make the check compare the
sheet with itself. It does not catch a CSV file downloaded from the sheet with other line endings or quoting, which
compares a sheet with a copy of itself just as surely. FlowAssert does not try to detect that by comparing rows: the
independence of the destination remains the person's responsibility, as for two files.

## Refusals

Every refusal prints `refused: MESSAGE` to standard error, exits with status 2, writes no report and concludes
nothing, as for every other refusal. No message contains the credential. In the table, `RANGE` is the range as given,
`WHAT` is `Google Sheets values` or `Google Drive revision metadata`, and `STATUS` is the `error.status` of an error
response in Google's JSON error format (`{"error": {"code": 404, "status": "NOT_FOUND", ...}}` **[doc]**), written as
` NOT_FOUND` when present and only when it is upper-case letters and `_`. The error's `message` is never repeated,
because FlowAssert cannot know what it contains.

| Message | When |
| --- | --- |
| `--source and --source-sheet cannot be combined` | Both were given |
| `--source-sheet needs --source-range` | No range |
| `OPTION needs --source-sheet` | `--source-range`, `--source-timeout` or `--skip-source-revision` without a sheet |
| `--source-encoding does not apply to a sheet source` | Both given |
| `--source-sheet must be a spreadsheet ID: letters, digits, - and _, at most 200 characters` | Any other ID |
| `--source-range 'RANGE' must name a tab and bounded columns, such as Leads!A1:F or Leads!A1:F500` | Not of the form above |
| `--source-range 'RANGE' starts after it ends` | Start column or row after the end |
| `no credential: set FLOWASSERT_SHEETS_TOKEN to a read-only OAuth access token, or FLOWASSERT_SHEETS_API_KEY to an API key for a sheet shared for viewing` | Neither variable set |
| `set only one of FLOWASSERT_SHEETS_TOKEN and FLOWASSERT_SHEETS_API_KEY` | Both set |
| `VARIABLE does not hold a credential: printable ASCII without spaces, at most 4096 characters` | Empty, too long, or another character |
| `FLOWASSERT_SHEETS_TEST_ENDPOINT must be http://127.0.0.1:PORT or http://[::1]:PORT; it is for tests only` | Any other value |
| `WHAT: the credential was not accepted (HTTP 401STATUS); it may have expired or been revoked` | 401 |
| `WHAT: access was denied (HTTP 403STATUS); the credential may lack the read-only scope, its project may not have the API enabled, or the sheet is not shared with it` | 403 |
| `WHAT: not found (HTTP 404STATUS); check the spreadsheet ID and that the credential can see it` | 404 |
| `WHAT: the request was not accepted (HTTP 400STATUS); check that the tab exists and the range lies inside it` | 400 |
| `WHAT: rate limited (HTTP 429STATUS); FlowAssert does not retry: wait, then run the check again` | 429 |
| `WHAT: server error (HTTP NSTATUS); FlowAssert does not retry: run the check again later` | 500 to 599 |
| `WHAT: redirected (HTTP N), and FlowAssert does not follow redirects` | 300 to 399 |
| `WHAT: unexpected response (HTTP NSTATUS)` | Any other status but 200 |
| `WHAT: no complete response within N seconds; FlowAssert does not retry` | `--source-timeout` passed |
| `WHAT: the server's TLS certificate could not be verified` | Certificate or host name check failed |
| `WHAT: the connection failed` | Name lookup, connection or TLS failure of another kind |
| `WHAT: response exceeds --max-bytes limit of N` | Body larger than `--max-bytes` |
| `WHAT: the response is not the JSON the API documents (DETAIL)` | Not UTF-8 JSON, a duplicate member, a compressed body, or a member missing or of the wrong type; `DETAIL` says which |
| `Google Sheets returned the range 'R' for 'RANGE', which is not the range asked for` | See [From a values response to rows](#from-a-values-response-to-rows) |
| `RANGE: the response has more rows than the range holds` | More rows than the range's rows |
| `RANGE: row N has more cells than the range has columns` | A row wider than the range |
| `RANGE: row N has a cell that is not text; FlowAssert reads formatted values only` | A number, `true`, `null` or a list in a cell |
| `RANGE: row N has a value beyond the header` | A row wider than the header row (`N` is the sheet's row number) |
| `RANGE: repeated column name` | As for a file |
| `RANGE: missing column NAME` | As for a file; an empty range has no columns |
| `RANGE: exceeds --max-rows limit of N` | As for a file |
| `the sheet changed while it was read: Drive version A modified T before the values, version B modified U after; run the check again` | Version or modification time differs |
| `the sheet's revision could not be read the same way before and after the values; run the check again` | One Drive read has a `version`, the other not |

## The report

A report from a sheet source has `schema_version` **2**. Every report without a sheet source is unchanged, byte for
byte, and keeps `schema_version` 1. Version 2 is used because three existing members change meaning for a sheet:
`inputs.source_sha256` is the digest of the canonical form, not of a file's bytes; `source_rows_observed` and
`premises.source_count.observed` count the range's data rows; and `premises.source_complete` states that the sheet
range is the whole cohort. A reader that knows only version 1, such as the 0.6.0 web UI, refuses a version 2 report,
which is intended: it would otherwise show the sheet's rows as a file and compare them with a file's.

Version 2 has every member of version 1, with these differences:

| Member | In version 2 |
| --- | --- |
| `inputs.source_sha256` | SHA-256 of the canonical form |
| `inputs.source_encoding` | Never present: a sheet has no encoding. `inputs.destination_encoding` is present alone when `--destination-encoding` was passed |
| `inputs.source_sheet` | New, always present (below) |

`inputs.source_sheet`:

| Member | Value |
| --- | --- |
| `read_by` | `FlowAssert`: the rows were read by FlowAssert, not exported by the person. This is not a statement about completeness |
| `service` | `Google Sheets API v4` |
| `spreadsheet_id` | The spreadsheet ID, as given |
| `range_requested` | The range as given |
| `range_returned` | The `range` of the values response, as returned |
| `value_render_option` | `FORMATTED_VALUE` |
| `date_time_render_option` | `FORMATTED_STRING` |
| `major_dimension` | `ROWS` |
| `read_at` | When the values request was sent, UTC ISO 8601, such as `2026-11-05T08:15:30.123456Z` |
| `revision` | `{"available": true, "before": {"version": V, "modified_time": T}, "after": {...}}`, where `V` is the version string and `T` the `modifiedTime` string or `null`; or `{"available": false, "reason": R}`, where `R` is `not requested (--skip-source-revision)` or `Google Drive returned no version` |
| `canonical_form` | `flowassert-sheet-csv-1` |

It never records the credential, the account, or the spreadsheet's title. `--redact-values` does not remove the
spreadsheet ID or the range, which are not values.

The printed summary adds two lines after the counts:

```text
Source read by FlowAssert from Google Sheets: spreadsheet ID, range RANGE_RETURNED, at READ_AT.
Drive version V before and after the values were read.
```

or, in place of the second, `The read cannot be tied to a revision: REASON.` A stated count that differs says `range
has N rows` in place of `file has N rows`. The HTML report adds a section, "Source read from Google Sheets", with the
same members and the sentence that the read does not show that the range holds every record that should exist.

`claim`, `limitations`, `acquisition_authenticity` (`not_authenticated`) and every conclusion are the same as for a
file.

## Sources

Read on 2026-11-05. The developer pages at `developers.google.com` and `cloud.google.com` could not be opened from the
machine this was written on (every request timed out), so the **[doc]** statements come from Google's machine-readable
API descriptions, which carry the same reference text, and from Google's API design documents on GitHub:

| Source | Used for |
| --- | --- |
| Google Sheets API discovery document, <https://sheets.googleapis.com/$discovery/rest?version=v4> (revision 20261028) | `spreadsheets.values.get`: method, path, parameters, the descriptions of `ValueRenderOption`, `DateTimeRenderOption` and `majorDimension`, `ValueRange`, the accepted scopes and their descriptions, the `key` parameter |
| Google Drive API discovery document, <https://www.googleapis.com/discovery/v1/apis/drive/v3/rest> (revision 20261102) | `files.get`: method, path, accepted scopes, `supportsAllDrives`, `fields`; the `File` fields `version`, `modifiedTime`, `headRevisionId`; the scope `drive.metadata.readonly` |
| `google/rpc/code.proto`, <https://github.com/googleapis/googleapis/blob/master/google/rpc/code.proto> | The `status` names and their HTTP codes (`PERMISSION_DENIED` 403, `UNAUTHENTICATED` 401, `RESOURCE_EXHAUSTED` 429, `NOT_FOUND` 404, ...) |
| AIP-193 Errors, <https://github.com/aip-dev/google.aip.dev/blob/master/aip/general/0193.md> | The JSON error shape `{"error": {"code", "message", "status", "details"}}` |

Pages that could not be opened, on which the **[unconfirmed]** statements bear; the live check is where they are
confirmed or contradicted:

- <https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get>
- <https://developers.google.com/workspace/sheets/api/guides/concepts> (A1 notation, spreadsheet ID)
- <https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueRenderOption>
- <https://developers.google.com/workspace/sheets/api/reference/rest/v4/DateTimeRenderOption>
- <https://developers.google.com/workspace/sheets/api/scopes>
- <https://developers.google.com/workspace/sheets/api/limits> (usage limits, 429)
- <https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get>
- <https://developers.google.com/workspace/drive/api/guides/api-specific-auth>
- <https://developers.google.com/workspace/drive/api/guides/handle-errors>
- <https://cloud.google.com/docs/authentication/api-keys>
