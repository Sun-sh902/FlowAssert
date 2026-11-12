# When a check is refused

A refused check prints `refused: ` and one message to standard error, exits with status `2`, and writes no report: nothing was checked, so there is no result to read. This page has one section for each message, with what it means and what you can do. The CSV check page in the browser shows the same messages, and under some of them the same hints, worked out from the first bytes of the files you chose.

A hint is only a suggestion. FlowAssert never retries a check, and never changes an encoding, a separator or a column for you: you change the choice and run the check again.

In the messages below, `FILE` is the path you gave (the file's name in the browser), and `N` a number.

- [Reading the CSV files](#reading-the-csv-files)
- [Reading an Excel workbook](#reading-an-excel-workbook)
- [Choosing columns](#choosing-columns)
- [Configuration and mapping files](#configuration-and-mapping-files)
- [Options](#options)
- [The two files together](#the-two-files-together)
- [Reading a Google Sheets range](#reading-a-google-sheets-range)
- [Reading HubSpot contacts](#reading-hubspot-contacts)
- [Records to resend](#records-to-resend)

## Reading the CSV files

### `FILE: not UTF-8`

The file does not decode as UTF-8, the default encoding. FlowAssert never guesses an encoding. Look at the file's first bytes:

- It starts with the bytes `FF FE` or `FE FF` (a UTF-16 byte order mark): it is probably UTF-16. Pass `--source-encoding utf-16` or `--destination-encoding utf-16`.
- Many of its first bytes are zero: it is probably UTF-16 without a byte order mark, which FlowAssert does not read. Save it again as UTF-8, or as UTF-16 with a byte order mark.
- It holds Chinese text from an older system: it may be GB18030. Pass `--source-encoding gb18030` or `--destination-encoding gb18030`.

To look at the first bytes on macOS or Linux: `head -c 64 FILE | od -A x -t x1z`.

### `FILE: not UTF-16`

The file does not decode as UTF-16 after its byte order mark. If it is really UTF-8 or GB18030, name that encoding instead.

### `FILE: not UTF-16 (no byte order mark)`

You named UTF-16, and the file does not start with a byte order mark. FlowAssert reads UTF-16 only with one, so it can tell little-endian from big-endian without guessing. If many of the first bytes are zero, save the file again as UTF-8, or as UTF-16 with a byte order mark. If they are not, the file is probably UTF-8: leave out the encoding option.

### `FILE: not GB18030`

The file does not decode as GB18030. If it is UTF-8, leave out the encoding option; if it starts with a UTF-16 byte order mark, name `utf-16`.

### `FILE: repeated column name`

The header row names one column more than once, so a column chosen by name would be ambiguous. Give each column a name of its own in the header, for example `phone` and `phone_2`, and run the check again.

### `FILE: missing column NAME`

The header row has no column with exactly this name; several names are listed with commas. Names are compared exactly, including upper and lower case and spaces.

- Print the header to see the names the file uses: `head -n 1 FILE`.
- A column such as ` Phone` or `PHONE` is a different name from `phone`: pass the name as the file writes it, or correct the configuration file.
- If the header is one long name with `;` or tab characters in it, the file is not separated by commas: see the next section.

### `FILE: line N does not match the header`

Row `N` of the file (counting physical lines, so a quoted value with line breaks counts as several) has a different number of fields from the header row. FlowAssert refuses the file rather than guess which field is which.

- Compare the number of fields in line `N` and in the header. A value that contains a comma must be inside double quotes, or it is read as two fields.
- If most lines are separated by `;` or by tabs, the file is not comma-separated. FlowAssert reads only commas. Export or save the file again as CSV with a comma as the separator; programs that write CSV usually offer that choice when exporting or saving, sometimes under a name such as "comma-separated" or "comma delimited".

### `FILE: exceeds --max-rows limit of N`

The file has more data rows than `--max-rows` allows (1,000,000 by default). Pass a higher `--max-rows` if this computer has the memory: the source is kept in memory for the columns used. The browser check uses the default limit and cannot change it; use the command line for a larger file.

### `FILE: file size N bytes exceeds --max-bytes limit of N`

The file is larger than `--max-bytes` allows (209,715,200 bytes, 200 MiB, by default), checked before reading. Pass a higher `--max-bytes`. The browser check uses the default limit; use the command line for a larger file.

### `FILE: unexpected end of data`

The file ends inside a quoted value: a `"` opens a value and is never closed. Look for a stray double quote near the end of the file. Inside a quoted value, a double quote is written twice: `"a ""quoted"" word"`.

### `FILE: ',' expected after '"'`

A quoted value is followed by something other than a comma or the end of the line, as in `"Ada" Lovelace,`. Put the whole value inside the quotes, or remove the quotes.

### `FILE: new-line character seen in unquoted field - do you need to open the file with newline=''?`

An unquoted value contains a lone carriage return (`\r`) that does not end the line. This is a message of Python's CSV reader; its question about `newline=''` is meant for programmers and needs no answer. Put the value inside double quotes, or remove the stray character.

### `FILE: field larger than field limit (131072)`

One value is longer than 131,072 characters, Python's default limit, often because a quote was never closed and the rest of the file was read as one value. Look for a stray double quote before the line where the long value starts.

### `FILE: ERROR`

The file could not be opened, for example `No such file or directory` or `Permission denied`; the error is the operating system's. Check the path and that you can read the file.

## Reading an Excel workbook

From 1.1.0 either side can be one worksheet of an .xlsx workbook (`--source-format xlsx`, `--destination-format xlsx`;
in the browser, a workbook is recognised when you choose it). FlowAssert reads the value each cell stores, never what a
spreadsheet program displays, and refuses a workbook it cannot read with certainty. In these messages `WS` is the
worksheet's name and `REF` a cell such as `B7`. The [Excel guide](excel.md) explains how a workbook is read, and the
[design note](../design/1.1-excel.md#refusals-and-bounds) lists every message.

### `--source-format must be one of: csv, xlsx`, and the same for `--destination-format`

Use `csv` (the default) or `xlsx`. FlowAssert never decides a file's format from its name or its content.

### `--source-worksheet needs --source-format xlsx`, and the same for the destination

A worksheet is chosen only for a workbook. Add `--source-format xlsx`, or leave the worksheet out for a CSV file.

### `--source-encoding does not apply to a workbook`, and the same for the destination

A workbook has no encoding to choose: its text is UTF-8 inside the archive. Leave the encoding out for that side.

### `--source-format does not apply to a sheet source` and `--destination-format does not apply to a HubSpot destination`

A Google Sheets range or HubSpot's contacts are read through their services, not from a file. Leave the format out.

### `FILE: not an .xlsx workbook: it is an OLE compound file, …`

The file is a legacy .xls workbook, or an .xlsx workbook protected by a password: both are stored in the older OLE
format. In your spreadsheet program, save a copy as an Excel Workbook (.xlsx) without a password, and check that copy.

### `FILE: not an .xlsx workbook (not a ZIP archive)`

An .xlsx workbook is a ZIP archive and this file is not one. If it is a CSV file, leave out `--source-format xlsx` (in
the browser, choose CSV as its format).

### `FILE: a macro-enabled workbook (.xlsm); …`, `FILE: a Strict Open XML workbook; …` and `FILE: the workbook part has content type TYPE, …`

FlowAssert reads the .xlsx format Excel saves by default. Save a copy as an Excel Workbook (.xlsx): cells keep their
values, and FlowAssert never runs macros either way.

### `FILE: the workbook has N sheets (NAMES); choose one with --source-worksheet`

Name the worksheet to read exactly as the workbook names it, with `--source-worksheet NAME` (or
`--destination-worksheet`). In the browser, pick it under "Choose the worksheet to check". A workbook with one sheet
needs no name.

### `FILE: no worksheet named 'NAME'; the workbook has: NAMES`, `FILE: sheet 'NAME' is not a worksheet` and `FILE: the workbook has no sheet`

Use one of the names listed, exactly, including case and spaces. A chart sheet or a dialog sheet holds no rows.

### `FILE: worksheet WS: row 1 is empty; FlowAssert reads the column names from row 1`

Row 1 must hold the column names. Move them to row 1, or delete the rows above them.

### `FILE: worksheet WS: cell REF holds the error value ERROR`

The cell shows an error, such as `#N/A` or `#DIV/0!`, instead of a value. Correct its formula, or replace the error
with the value it should have.

### `FILE: worksheet WS: cell REF has a formula without a cached value; …`

The workbook holds the formula but not its result, which happens with files written by some programs other than
spreadsheet programs. FlowAssert never computes a formula. Open the workbook in a spreadsheet program and save it, which
stores every result.

### `FILE: worksheet WS: cell REF has number format 'CODE', which FlowAssert does not read`

The cell's format is one whose text FlowAssert does not define, such as a fraction. Format the column as General,
Number, Text or a date in the spreadsheet program, or export the sheet as CSV.

### `FILE: worksheet WS: cell REF holds the serial number X, which is not a date in the 1900 date system`

A date cell holds a number that is not a date, such as a negative number or Excel's 29 February 1900, which never
existed. Correct the cell, or format the column as a number.

### `FILE: worksheet WS: cell REF has a value beyond the header`

A cell to the right of the last column name holds a value. Give that column a name in row 1, or clear the cell.

### `FILE: inflated parts exceed --max-bytes limit of N`

The workbook's parts, uncompressed, are larger than `--max-bytes` (200 MiB by default). Raise `--max-bytes` on the
command line if you expect a workbook that large; the limit also stops a file built to fill memory.

### `FILE: changed while it was read; run the check again`

The file's size or time of change differed between the start and the end of the read: another program was writing it.
Check again once it is saved.

### Other messages about the archive or its XML

`damaged ZIP archive`, `a ZIP64 archive`, `encrypted ZIP entry`, `repeated ZIP entry`, `compression method`,
`missing part`, `external relationship`, `is not UTF-8`, `has a DOCTYPE declaration`, `is not well-formed XML`,
`exceeds a reading bound`, `cell reference … is not a cell of a worksheet`, `is out of order`, `has the type`,
`has no value`, `is not a number`, `refers to shared string`, `has style N`, `is longer than 131072 characters`,
`escaped character`: the file is damaged, or was written in a way FlowAssert does not read with certainty. Open it in a
spreadsheet program and save it as an Excel Workbook (.xlsx), or export the worksheet as CSV UTF-8.

## Choosing columns

### `--key or --mapping is required`

Name the key column with `--key COLUMN` (or `--key SOURCE:DESTINATION`), or give a `--mapping` or `--config` file.

### `at least one --field is required`

Name at least one compared column with `--field COLUMN` or `--field SOURCE:DESTINATION`.

### `empty column name in 'TEXT'`

A `--key` or `--field` value starts with `:` or is empty, so it names no source column. Write `COLUMN` or `SOURCE:DESTINATION`. A column name that itself contains `:` needs a `--mapping` or `--config` file.

### `a source field is repeated`

The same source column is compared twice. Compare each source column once.

### `--mapping cannot be combined with --key or --field`

A mapping file already names the key and the fields. Use either the file or the two options.

### `--config cannot be combined with --mapping, --key, --field, --scope`

A configuration file already names the key, the fields with their rules and the scope. Leave out the options listed in the message.

## Configuration and mapping files

These messages start with the path of the `--config` or `--mapping` file.

### `FILE: not UTF-8`

The configuration or mapping file must be UTF-8 JSON (a byte order mark is allowed). Save it again as UTF-8.

### `FILE: invalid JSON (MESSAGE)`

The file is not valid JSON; the message in brackets is Python's, such as `Expecting value` or `Expecting ',' delimiter`. A JSON checker or editor can show where.

### `FILE: duplicate member 'NAME'`

An object in the file names the same member twice. JSON readers disagree about which one wins, so FlowAssert refuses both. Keep one.

### `FILE: configuration must be a JSON object` and `FILE: mapping must be a JSON object`

The file's outer value must be an object, `{ ... }`, with `key` and `fields`.

### `FILE: NAME cannot be set in a configuration file; completeness statements and counts are command-line options, chosen at each run`

A configuration file holds which columns are compared and how, never what you state about a particular pair of files. Remove the member and pass `--source-complete`, `--destination-complete`, `--source-count` or `--destination-count` at the run they are true for.

### `FILE: unknown member NAME` and `FILE: unknown member NAME in field`

The file has a member FlowAssert does not know, often a misspelling. A configuration file has `key`, `fields` and `scope`; a field has `source`, `destination` and `rule`. A mapping file has `key` and `fields`.

### `FILE: missing member NAME` and `FILE: missing member NAME in field`

A required member is missing: `key` and `fields` in the file, `source` and `destination` in each field of a configuration file.

### `FILE: key must be a two-item list of strings` and `FILE: field must be a two-item list of strings`

The key, and in a mapping file each field, is written `["source column", "destination column"]`.

### `FILE: empty column name in key` and `FILE: empty column name in field`

A column name is empty or only spaces.

### `FILE: fields must be a non-empty list`

`fields` must be a list with at least one field.

### `FILE: each field must be an object with source, destination and an optional rule`

In a configuration file each field is written `{"source": "phone", "destination": "phone", "rule": "digits"}`.

### `FILE: field source must be a string`, `FILE: field destination must be a string` and `FILE: field rule must be a string`

The member must be text in double quotes.

### `FILE: a source field is repeated`

The same source column appears in two fields. Compare each source column once.

### `FILE: scope must be one of: source, exact`

`scope` is `"source"` or `"exact"`.

### `FILE: field 'NAME': unknown comparison rule 'RULE'; use exact, trim, casefold, digits or date:FORMAT`

The rule is not one of the five. See [comparison rules](first-check.md#comparison-rules-in-a-configuration-file).

### `FILE: field 'NAME': date rule 'date:' has no format`

Write a format after `date:`, such as `date:%Y-%m-%d`.

### `FILE: field 'NAME': date format 'FORMAT' has no directive`

The format has no `%` directive, so it cannot read a date. `%%` is a literal percent sign, not a directive.

### `FILE: field 'NAME': malformed date format 'FORMAT' (ERROR)`

Python's `strptime` cannot use the format; the error in brackets is Python's. Check each `%` directive.

### `FILE: field 'NAME': date format 'FORMAT' repeats a directive`

A directive such as `%Y` appears twice. Use each directive once.

In the browser, a date format can also be refused with `date format 'FORMAT' uses %X, which the browser check does not support; it supports %Y %m %d …`: the browser reads only the directives the message lists. Use the command line for that format.

## Options

### `--max-bytes must be a positive integer`, and the same for `--max-rows`

Write a whole number from 1, with digits only.

### `--source-count must be a non-negative integer`, and the same for `--destination-count` and `--max-details`

Write a whole number from 0, with digits only.

### `--details must be one of: problems, all`

And likewise for `--scope` (`source, exact`), `--source-encoding` and `--destination-encoding` (`utf-8, utf-16, gb18030`): use one of the values the message lists.

## The two files together

### `source and destination are the same file, so the check would not be independent`

Both paths lead to one file. Pass the export of the destination system as `--destination`.

### `source and destination have identical content, so the check would not be independent; pass --allow-identical-content if they really come from different systems`

The two files have exactly the same bytes, which usually means one file was compared with a copy of itself. Pass the export of the destination system as `--destination`. If the two files really come from different systems and happen to be identical, `--allow-identical-content` records that statement in the report. FlowAssert cannot check it.

## Reading a Google Sheets range

These messages come only from the command line with `--source-sheet` ([the Google Sheets guide](google-sheets.md)). In them, `RANGE` is the range you gave, and `WHAT` says which request failed: `Google Sheets values` (the cells) or `Google Drive revision metadata` (the file's version, read before and after the values). A name in capitals after the status code, such as `PERMISSION_DENIED`, is the status Google's error gave; the error's own message is never repeated. No message contains your credential. FlowAssert never retries: after you change something, run the check again.

### `--source and --source-sheet cannot be combined`, `--source-sheet needs --source-range`, `--source-range needs --source-sheet`

The source is either a file (`--source`) or a sheet range (`--source-sheet` with `--source-range`). `--source-timeout` and `--skip-source-revision` also need `--source-sheet`.

### `--source-encoding does not apply to a sheet source`

A sheet's cells arrive as text, with no file encoding. Leave the option out. `--destination-encoding` still applies to the destination file.

### `--source-sheet must be a spreadsheet ID: letters, digits, - and _, at most 200 characters`

Pass only the ID, the long part of the spreadsheet's address after `/d/`, not the whole address.

### `--source-range 'RANGE' must name a tab and bounded columns, such as Leads!A1:F or Leads!A1:F500`

Write the tab's name, `!`, and a first and last cell with columns: `Leads!A1:F`. Quote a tab name with spaces or other characters: `'Q3 leads'!A1:F`, with a quote inside a name written twice. A range without a tab, a named range, a single cell and whole rows (`Leads!1:500`) are refused, so that the report always says which cells were read.

### `--source-range 'RANGE' starts after it ends`

The first column or row comes after the last. Swap them.

### `no credential: set FLOWASSERT_SHEETS_TOKEN to a read-only OAuth access token, or FLOWASSERT_SHEETS_API_KEY to an API key for a sheet shared for viewing`

FlowAssert takes a credential only from one of these two environment variables, never from an option or a file. Set one of them in the shell that runs the check (the guide shows how without leaving it in the shell's history).

### `set only one of FLOWASSERT_SHEETS_TOKEN and FLOWASSERT_SHEETS_API_KEY`

Both are set. `unset` the one you do not mean to use.

### `FLOWASSERT_SHEETS_TOKEN does not hold a credential: printable ASCII without spaces, at most 4096 characters`, and the same for `FLOWASSERT_SHEETS_API_KEY`

The variable is empty, longer than 4,096 characters, or holds a space, a line break or another character a credential does not have; often a copy that took in a space or a line break. Set it again. FlowAssert does not show what it holds.

### `FLOWASSERT_SHEETS_TEST_ENDPOINT must be http://127.0.0.1:PORT or http://[::1]:PORT; it is for tests only`

This variable points the command at a local fake of Google's endpoints, for FlowAssert's own tests. Unset it.

### `WHAT: the credential was not accepted (HTTP 401 ...); it may have expired or been revoked`

Access tokens expire. Obtain a new one, or check that the API key was not deleted.

### `WHAT: access was denied (HTTP 403 ...); the credential may lack the read-only scope, its project may not have the API enabled, or the sheet is not shared with it`

- A token: was it issued with `spreadsheets.readonly`, and for the Drive request with `drive.metadata.readonly`? Without the Drive scope, add `--skip-source-revision`.
- An API key: is the Google Sheets API (and for the version, the Google Drive API) enabled in its project, and does the key's restriction allow them? Is the sheet shared so that anyone with the link can view it?
- A token for an account that cannot open the sheet: share the sheet with that account, for viewing.

### `WHAT: not found (HTTP 404 ...); check the spreadsheet ID and that the credential can see it`

The ID is wrong, the spreadsheet was deleted, or it is not visible to this credential.

### `WHAT: the request was not accepted (HTTP 400 ...); check that the tab exists and the range lies inside it`

Usually a tab name that does not exist (names are matched as written), or a range beyond the tab's last column.

### `WHAT: rate limited (HTTP 429 ...); FlowAssert does not retry: wait, then run the check again`

Google limits how many reads a project or a user can make per minute. Wait a minute or so, then run the check again.

### `WHAT: server error (HTTP N ...); FlowAssert does not retry: run the check again later`

A 5xx status: a problem on Google's side. Run the check again later.

### `WHAT: redirected (HTTP N), and FlowAssert does not follow redirects`, and `WHAT: unexpected response (HTTP N ...)`

The answer was not one the API documents for a read. FlowAssert concludes nothing from it. If it persists, something between you and Google, such as a network sign-in page, may be answering instead.

### `WHAT: no complete response within N seconds; FlowAssert does not retry`

The request took longer than `--source-timeout` (60 seconds by default). Run the check again, bound the range's rows, or pass a larger `--source-timeout`.

### `WHAT: the server's TLS certificate could not be verified`

FlowAssert always verifies the certificate, and has no option to skip it. On macOS with Python from python.org, run "Install Certificates.command" in the Python folder once. On a network that inspects encrypted traffic, the certificate it presents is not Google's.

### `WHAT: the connection failed`

The name could not be looked up, or the connection could not be made. Check that the computer is online. FlowAssert connects directly and does not use a proxy set in `HTTPS_PROXY`.

### `WHAT: response exceeds --max-bytes limit of N`

The response is larger than `--max-bytes` (200 MiB by default). Bound the range, or raise the limit.

### `WHAT: the response is not the JSON the API documents (DETAIL)`

The answer was not the documented JSON: `DETAIL` names what was wrong, such as `not JSON` or `majorDimension is not ROWS`. Nothing is concluded from it. If it persists, please report it, with the message but without any credential or data.

### `Google Sheets returned the range 'R' for 'RANGE', which is not the range asked for`

The API said it read other cells than those asked for, for example other columns. FlowAssert refuses rather than check other cells. Check the range, and that its columns lie inside the tab.

### `RANGE: the response has more rows than the range holds`, `RANGE: row N has more cells than the range has columns`

The response does not fit the range it names. Nothing is concluded from it.

### `RANGE: row N has a cell that is not text; FlowAssert reads formatted values only`

FlowAssert asks for every cell as the text the sheet shows, and got something else. Please report it.

### `RANGE: row N has a value beyond the header`

Row `N` of the sheet has a value in a column whose header cell is empty or missing. Give that column a name in the header row, or narrow the range to the named columns.

### `RANGE: repeated column name`, `RANGE: missing column NAME`, `RANGE: exceeds --max-rows limit of N`

As for a file: see [Choosing columns](#choosing-columns) and [`FILE: exceeds --max-rows limit of N`](#file-exceeds---max-rows-limit-of-n). The header is the first row of the range: if your range starts below it, the first row read is taken as the header. An empty range has no columns, so every column is missing.

### `the sheet changed while it was read: Drive version A modified T before the values, version B modified U after; run the check again`

Google Drive recorded a change to the file between just before and just after the values were read, so the values cannot be tied to one state of the sheet. Drive counts changes a person cannot see too, so this can happen when no cell changed. Run the check again; if someone is editing the sheet, wait until they finish.

### `the sheet's revision could not be read the same way before and after the values; run the check again`

One of the two Drive reads gave a version and the other did not. Run the check again.

## Reading HubSpot contacts

These messages come only from the command line with `--destination-hubspot contacts` ([the design note](../connectors/hubspot.md)). In them, `PAGE` is the page of the list, counted from 1. A name in capitals after the status code, such as `MISSING_SCOPES`, is the category HubSpot's error gave; the error's own message is never repeated. No message contains your token. FlowAssert never retries and writes no report: after you change something, run the check again.

### `--destination and --destination-hubspot cannot be combined`, `--destination-hubspot must be contacts`, `--destination-timeout needs --destination-hubspot`

The destination is either a file (`--destination`) or HubSpot's contacts (`--destination-hubspot contacts`); contacts are the only object FlowAssert reads. `--destination-timeout` applies only to HubSpot.

### `--destination-encoding does not apply to a HubSpot destination`

The records arrive as text, with no file encoding. Leave the option out.

### `HubSpot property name 'NAME' must be letters, digits and _, at most 100 characters`

The destination side of the key and of each field is a property's internal name, such as `email` or `hs_object_id`, not its label. HubSpot shows the internal name in each property's settings.

### `no credential: set FLOWASSERT_HUBSPOT_TOKEN to a private app access token with the scope crm.objects.contacts.read only`, `FLOWASSERT_HUBSPOT_TOKEN does not hold a credential: …`

FlowAssert takes the token only from this environment variable. Set it in the shell that runs the check without leaving it in the shell's history: `read -rs FLOWASSERT_HUBSPOT_TOKEN && export FLOWASSERT_HUBSPOT_TOKEN`.

### `HubSpot contacts: the credential was not accepted (HTTP 401…)`, `… access was denied (HTTP 403…)`

The token has expired, been rotated or deleted, or lacks the scope `crm.objects.contacts.read`. Give the private app that scope, and only that one.

### `HubSpot contacts: rate limited (HTTP 429…)`, `… server error (HTTP N…)`, `… no complete response within N seconds…`, `… the connection failed`

HubSpot did not answer this time. Wait, then run the check again; a read of many contacts makes one request per 100 of them.

### `HubSpot contacts: page PAGE has a record without the property 'NAME'; …`

HubSpot leaves out a property the object does not have, so `NAME` is most likely not a contact property, or is written differently. This is the same refusal as a missing column in a file.

### `HubSpot contacts: record ID appears twice (pages P and Q): the list changed while it was read; …`, `… repeats an earlier paging cursor`, `… has a next page and no records`

The list changed, or its pages repeated, while it was read, so the rows cannot be tied to one state. Run the check again when nobody is importing or merging contacts.

### `HubSpot contacts: the response is not the JSON the API documents (DETAIL)`, `… lists an archived record…`, `… has a property value that is not text`, `… has more than 100 records`, `… gives a paging cursor that FlowAssert cannot send back unchanged`, `… redirected…`

A page is not what HubSpot's documentation describes. FlowAssert does not guess what it means; please report it, without the token or any values.

### `HubSpot contacts: exceeds --max-rows limit of N`, `HubSpot contacts: response exceeds --max-bytes limit of N`

More contacts were listed than `--max-rows` allows, or a page was larger than `--max-bytes`. Raise the limit if the number is expected.

## Records to resend

From 1.1.0, `--export-dir DIR` writes the records to resend after the check ([guide](records-to-fix.md)).

### `--export-dir cannot be combined with --redact-values: the exported rows hold the values`

`--redact-values` promises output without values, and the exported rows are values. Leave out one of the two.

### `DIR: exists; --export-dir writes to a new directory`

Each check writes its files into a new directory, so they are never mixed with an older check's. Name a directory that
does not exist yet, for example one with the date in its name. FlowAssert creates it, one level only.

### `FILE: changed after it was checked; nothing was exported`

The rows are read again to write them in full, and the file was not the one the check had read. Nothing was written,
not even the reports. Check again once the file no longer changes.

### `DIR: ERROR`

The directory or a file in it could not be written; the error is the operating system's. Nothing is left behind: the
files written so far and the directory are removed, and no report is written.
