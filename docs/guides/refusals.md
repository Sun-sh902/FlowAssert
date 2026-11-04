# When a check is refused

English | [简体中文](refusals.zh-CN.md)

A refused check prints `refused: ` and one message to standard error, exits with status `2`, and writes no report: nothing was checked, so there is no result to read. This page has one section for each message, with what it means and what you can do. The CSV check page in the browser shows the same messages, and under some of them the same hints, worked out from the first bytes of the files you chose.

A hint is only a suggestion. FlowAssert never retries a check, and never changes an encoding, a separator or a column for you: you change the choice and run the check again.

In the messages below, `FILE` is the path you gave (the file's name in the browser), and `N` a number.

- [Reading the CSV files](#reading-the-csv-files)
- [Choosing columns](#choosing-columns)
- [Configuration and mapping files](#configuration-and-mapping-files)
- [Options](#options)
- [The two files together](#the-two-files-together)

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

The file is larger than `--max-bytes` allows (209,715,200 bytes, 200 MiB, by default), checked before reading. Pass a higher `--max-bytes`. The browser check uses the default limit; use the command line for a larger file, where the destination is read without holding it in memory.

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
