# Changelog

## 1.1.0 (unreleased)

The release that removes reasons not to try FlowAssert, or to stop after one check. Four highlights, in order: Excel
workbooks checked directly; from finding to fixing, with the records to resend; an n8n community node; and scheduled
checks in the GitHub Action with a run summary.

**Every verdict of every existing case is unchanged, and no existing golden file changed**: for every golden case,
sheet and HubSpot golden case, scenario, conformance case and comparison case, the records, rule results, counts,
cohort state, exit status, refusals, printed summary, JSON report and HTML report are the same bytes as in 1.0.0
(`golden.py --check`, `comparison_cases.py --check`, `schemas.py --check` and `conformance.py --connectors --bytes
--html`, 289 of 289, pass without regenerating anything). The new options leave every existing command as it was.

Not true of this release: no outside user, review or adoption is claimed. The Google Sheets source and the HubSpot
destination, now also in the Action, have been tested against local fakes only. No GitHub workflow was run: the
Action's 1.1.0 inputs and run summary were tested in-process against local fakes, and its self-test, the release
workflow and the node's publish workflow were written and checked for structure only. The n8n node was tested in a
local self-hosted n8n (2.47.5 and 2.46.4, on macOS), not on n8n Cloud; it is not published on npm, not listed in n8n's
catalogue and not verified by n8n.

### Added

- **Excel workbooks** ([guide](docs/guides/excel.md), [design note](docs/design/1.1-excel.md)). Either side can be one
  worksheet of an `.xlsx` workbook: `--source-format xlsx` and `--destination-format xlsx` (default `csv`), with
  `--source-worksheet NAME` and `--destination-worksheet NAME` when a workbook has several sheets. Each cell is read as
  stored, never as displayed, with its text defined once for every cell type and number format, in Python and
  TypeScript alike: numbers as ECMAScript writes them, percentages as fractions, dates and times in ISO 8601 in the
  workbook's date system, booleans as `TRUE` or `FALSE`, a formula's cached result. The same rows give the same result
  as in a CSV file. Readers are standard library only in Python and use the platform's `DecompressionStream` in the
  browser; `--max-bytes` also bounds what is inflated.
- **Workbook refusals**, each with an exact message ([refusal guide](docs/guides/refusals.md#reading-an-excel-workbook)):
  a legacy `.xls` or password-protected file, a macro-enabled `.xlsm`, a Strict or binary workbook, several sheets and
  no name, an unknown worksheet, an empty row 1, an error value such as `#N/A`, a formula without a cached value, an
  undefined or unread number format, a serial number that is not a date, a damaged, ZIP64 or encrypted archive, a
  `DOCTYPE`, XML that is not well-formed or not UTF-8, and a file changed while it was read; and the option refusals
  `--source-worksheet needs --source-format xlsx`, `--source-encoding does not apply to a workbook`, `--source-format
  does not apply to a sheet source` and `--destination-format does not apply to a HubSpot destination`. The browser
  gives hints for six of them.
- **`schema_version` 4**, for a report with a side read from a workbook, with `inputs.source_workbook` and
  `inputs.destination_workbook` (worksheet, its state, sheets, date system, the file's digest and size, inflated bytes,
  columns, rows, cells by how they were read, hidden rows and columns, merged ranges); its digest is that of the canonical
  form `flowassert-xlsx-csv-1`. [JSON Schema](docs/schema/report-v4.schema.json), [spec section 16](docs/spec/verification.md),
  golden cases in `offline/golden-xlsx/`, fixtures from two independent writers in `offline/xlsx-fixtures/`. Reports of
  the existing kinds keep their versions and bytes.
- **Workbooks in the browser**: a workbook is recognised when chosen, its sheets listed for a choice by keyboard, its
  worksheet profiled (rows, columns, empty cells, cells read as numbers, dates, durations, booleans or formula results,
  hidden rows and columns, merged ranges), checked, and read back in saved reports and comparisons.
- **The records to resend** ([guide](docs/guides/records-to-fix.md), [design note](docs/design/1.1-exports.md),
  [spec section 17](docs/spec/verification.md)): `--export-dir DIR` writes `missing-from-destination.csv`,
  `values-differ.csv`, `duplicated-in-destination.csv`, `unknown-status-resending-may-create-duplicates.csv`,
  `only-in-destination.csv` and `only-in-destination-not-concluded.csv`, each row as read under its file's own header,
  UTF-8 with a byte order mark and CR LF. Advice only: no result, report, summary line or exit status changes. A
  destination not stated complete never gives a missing file. Text is never changed; fields that a spreadsheet would
  run as formulas are counted, with the advice to import the files. Refused: `--export-dir cannot be combined with
  --redact-values: …`, `DIR: exists; --export-dir writes to a new directory` and `FILE: changed after it was checked;
  nothing was exported`. The browser's "Export records to fix" builds a file only when its button is pressed; the
  TypeScript checker writes the same bytes, and `checkCsv` takes `exports: true`.
- **The n8n community node**, `n8n-nodes-flowassert` 1.1.0, MIT, in `integrations/n8n-nodes-flowassert/`
  ([README](integrations/n8n-nodes-flowassert/README.md), [design note](docs/design/1.1-n8n-node.md)): two files from
  binary properties, CSV or a workbook; parameters that mirror the check's with every premise unstated by default; a
  Result output and one output per file of records to resend. It holds the packaged checker, has no runtime
  dependency, makes no request and needs no credential; n8n's linter passes. A new premise origin, `n8n node`.
  `checkCsv` also takes `details`, `redactValues`, `maxBytes` and `maxRows`. Publishing is prepared, not run:
  `.github/workflows/n8n-node-publish.yml` (npm trusted publishing with provenance, from a tag `n8n-node-v*`) and the
  owner's checklist, `scripts/dev/n8n_node_publish.md`; `release.yml` also attests the node's `npm pack` tarball.
- **The Action, 1.1.0** ([guide](docs/guides/scheduled-checks.md), [examples](examples/github-actions/README.md),
  [design note](docs/design/1.1-action.md)): the inputs `source-sheet`, `source-range`, `source-timeout`,
  `skip-source-revision`, `destination-hubspot`, `destination-timeout`, `source-format`, `source-worksheet`,
  `destination-format`, `destination-worksheet`, `export-dir`, `summary` and `summary-keys`, and the output
  `export-dir`; `source` and `destination` are no longer marked required. Credentials come only from the step's
  environment, set from secrets. After 1.0's job summary, unchanged, "What this run shows": the verdict, the claim,
  the counts, each premise and whether it was applied, each input's kind and digests and the records to resend, with no
  value, keys only on request, and under GitHub's 1 MiB limit. Two example workflows: a scheduled check from a sheet to
  HubSpot, and a check of two workbooks.
- Guides: [Check an Excel workbook](docs/guides/excel.md), [Export the records to fix](docs/guides/records-to-fix.md),
  [Scheduled checks](docs/guides/scheduled-checks.md); new answers in the [FAQ](docs/faq.md); README screenshots of a
  workbook's worksheet choice and profile, and of the records to fix.

### Changed

- The browser lets go of a check's evaluation (about 133 MiB after two files of a million rows) when a file or a choice
  changes, instead of keeping it until the next check: 1.1 MiB is then held.
- The README describes `--max-rows` as the data rows of a file, since a workbook has them too.

### Known issues

- A HubSpot summary that read one page says "1 pages". The summary's lines keep their wording in 1.x, so the plural
  waits for 2.0.

### Removed

- The documents, the interface and the screenshots are in English only. The Chinese copies of the documents, the
  Simplified Chinese interface (its language switch, catalogue and the Chinese explanations beside English report
  texts) and the Chinese screenshots are removed; they remain in 1.0.0 and earlier. The roadmap is now
  [docs/ROADMAP.md](docs/ROADMAP.md), translated from the Chinese roadmap without change. Chinese characters in data,
  such as the GB18030 and UTF-16 cases and the golden files, are unchanged.

## 1.0.0 (2026-11-11)

The release that turns a careful prototype into a tool a stranger can check. It has four themes: a browser check that knows a file the moment it is chosen and explores any result; a trust commitment, with the report format frozen, specified, given JSON Schemas, a compatibility promise, a runnable conformance suite and build provenance for every release file; large files read as streams; and a read-only HubSpot Contacts destination for the command line.

**Every verdict of every existing case is unchanged**: for every golden case, sheet-sourced golden case, scenario and comparison case, the records, rule results, counts, cohort state, exit status, refusals, printed summary and JSON report are the same bytes as in 0.7.0. The one planned byte change is the HTML report, redesigned in Python and TypeScript alike; every regenerated `report.html` is in a commit of its own. Nothing shown before a check or beside a result is a conclusion, and none of it changes a file, a choice or a report.

0.7.0 was not released on its own: its changes, in the section below, are part of 1.0.0.

Not true of this release: no outside user, review or adoption is claimed; the Google Sheets source and the HubSpot destination have been tested against local fakes only, not against Google or HubSpot; and the roadmap's former 1.0 conditions of three outside users, a connector verified on a test account and an outside code review are not met. The owner released 1.0.0 without them, and the roadmap now lists them as goals for 1.x.

### Added

- **The file profile** (`ui/src/offline/profile.ts`). A file is taken from its button or dropped on its panel, and a second worker reads it at once, as a stream, with the check's own reader: data rows, columns with their empty cells, encoding and byte order mark, line endings and size, or the refusal the check would give it, with its hint. Once a key column is chosen, the check's own key counting says how many rows have no key and how many keys repeat. A test holds the profile to the report of every golden case and scenario.
- **Before you check.** The premises section says what a check started now would do, read from the profiles: a stated total that differs from the file (as in issue [#2](https://github.com/Sun-sh902/FlowAssert/issues/2): "If you check now, the destination statement will not be applied: the export has 4 rows, not 5."), a key column with empty or repeated keys, a chosen column that is not in its file. Each line states a consequence and changes nothing.
- **The result explorer** (`ui/src/offline/explore.ts`, `ui/src/components/report/Explorer.tsx`), on the check page, a saved report and either side of a comparison: filter by state (or not Verified), rule and rule result, or destination-only; search keys; order by row. The list is virtualised and operated by keyboard with one tab stop; the record chosen opens a panel with every rule result, reason and both values, and a `details: problems` report says plainly that it holds no rule results for a Verified record. On the check page the records stay in the worker: 1,000,000 records are listed in 0.016 s, and the page's timers stay within 1 ms. The view is in the address, with numbers and fixed words only.
- **The character diff** (`ui/src/offline/chardiff.ts`, `offline/flowassert_offline/chardiff.py`): for a failed field, the compared values aligned by code point, deletions and insertions marked by form and colour, invisible characters drawn as tokens (`·`, `NBSP`, `ZWSP`, `→`, …), and the code points of what differs; in the browser, notes when the values differ only in Unicode normalisation or in case. Labelled: "This highlights where the two values differ. The rule's result above is the conclusion."
- **The trust commitment**: [the specification](docs/spec/verification.md), normative, every MUST citing a golden case; [JSON Schemas](docs/schema/) (draft 2020-12) for `schema_version` 1, 2 and 3, against which every golden report and comparison case is validated in Python and in Vitest with a small validator of their own; [compatibility in 1.x](docs/compatibility.md); and [conformance](docs/conformance.md), with `offline/bench/conformance.py` running every golden and conformance case against any command (218 of 218 pass for the reference, on Python 3.9 and 3.15).
- **Build provenance**: `.github/workflows/release.yml` builds the wheel, the sdist, `flowassert-check.js` and the static site from a `v*` tag, writes `SHA256SUMS`, attests every file with `actions/attest-build-provenance@v4`, and uploads them to a **draft** release; `pages.yml` attests the artifact it deploys. [Verify a release](docs/verify-a-release.md) says how anyone checks them with `gh attestation verify`, and what that does not prove. Neither workflow has been run.
- **A read-only HubSpot Contacts destination** for the command line: `--destination-hubspot contacts` and `--destination-timeout SECONDS`, the token from `FLOWASSERT_HUBSPOT_TOKEN` (a private app access token with the scope `crm.objects.contacts.read` only), and `FLOWASSERT_HUBSPOT_TEST_ENDPOINT` for a loopback fake in tests. HTTPS `GET` to `/crm/v3/objects/contacts` only, following `paging.next.after`, with `archived=false`; no redirect, proxy or retry; every doubtful read is a refusal with no report. Reports have `schema_version` 3 with `inputs.destination_hubspot`, and say that the read lists what the token could see at that time and does not show that the object is complete; `--destination-complete` keeps its meaning. The browser opens, explains and compares such reports and makes no request to HubSpot. See [the design note](docs/connectors/hubspot.md); [the owner's live check](scripts/dev/hubspot_live_check.md) is prepared and not run.
- The TypeScript check reads `--mapping` too, held to the command line by two new golden cases.
- Tests: the chunk-boundary parity of the streaming reader over every golden input, the profile against every golden report, the explorer from the check and from the saved report, the character diff against Python on 3,000 random pairs, hostile values in the HTML report, an axe audit and a PDF print of the HTML report on A4 and Letter, 39 HubSpot golden cases with their request audits, a credential leak test, the same result as a CSV export for 51 golden cases, and a parse of every workflow.

### Changed

- **The browser reads files as streams** (`File.stream()`), with the CSV reader's state kept across chunks, an incremental SHA-256, and source values kept by column. Two files of 1,000,000 rows: the worker's peak heap falls from about 530 MiB to about 175 MiB, and the time to the result went from 2.82 s to 2.41–2.46 s on the same machine the same day. Progress shows the rows read on each side and an estimate of the time left that counts down and is raised only when it must be. The limits and their refusals are unchanged.
- **The standalone HTML report** is redesigned in the language of the browser check: the verdict, the premises with whether each was applied, the counts, a card for every record that is not Verified with the character highlighting, the limitations and the inputs. Still no script and nothing loaded; it follows the reader's light or dark setting, reads at phone width and prints on A4 and Letter. Python and the browser write the same bytes.
- After a check, the check worker keeps that result's evaluation, so the explorer can read it (about 130 MiB for two files of a million rows), until the next check starts.
- Every build writes the tab icon into the page, so a change of address requests nothing.
- `ui/package-lock.json` updated within the existing ranges (`npm update`); no range changed, `npm audit` reports no vulnerability, and the `fsevents` install script was not approved.
- `flowassert_offline.__version__` and the packaged checker's `VERSION` are `1.0.0`; the n8n example holds that build.

## 0.7.0 (not released on its own; part of 1.0.0)

A read-only Google Sheets source for the command line. `flowassert-verify --source-sheet ID --source-range 'TAB!A1:F'` reads the source rows itself, from one bounded range of one tab, instead of from a CSV file a person exported; the destination is still a CSV export. This is the first step of the roadmap's answer to "the files cannot be shown to be whole", and only a narrow one: reading the sheet shows which rows the range held when FlowAssert read it and removes the export step that could cut them short or edit them, but it does **not** show that the range holds every record that should exist. That stays the person's statement, `--source-complete`, a premise FlowAssert does not verify, with the same meaning and effect as for a file; the same cell values give the same result as the same rows in a CSV file. The source is read by the command line only: the browser check, the packaged JavaScript checker, the GitHub Action and the n8n example make no request to Google. It has been tested against a local fake of Google's two endpoints only, not yet against Google.

Every check that does not use the new options is unchanged: the same printed summaries, JSON and HTML reports, exit statuses and refusals, byte for byte; every existing golden case and comparison case gives the same bytes as in 0.6.0, and the packaged checker differs from 0.6.0 only in its version string.

### Added

- **`--source-sheet ID` and `--source-range RANGE`** (`offline/flowassert_offline/sheets.py`, standard library only), with `--source-timeout SECONDS` (default 60) and `--skip-source-revision`. The range must name a tab and bounded columns, such as `Leads!A1:F` or `Leads!A1:F500`; a range without a tab, a named range, a single cell or whole rows are refused. The values are read as formatted text (`FORMATTED_VALUE`); the first row of the range is the header, cells omitted at the end of a row are empty, and an empty row inside the range is a row without a key. `--max-rows`, `--max-bytes`, the selection, rules, scope, premises, counts, `--details`, `--redact-values`, `--json` and `--html` work as for a file; `--source-encoding` is refused with a sheet.
- **Read-only, and only where needed.** Three HTTPS `GET` requests and nothing else: Google Drive's `files.get` for `version` and `modifiedTime` before and after the values, and the Sheets API's `spreadsheets.values.get`. TLS certificates are always verified, no proxy is used, no redirect is followed, and nothing is retried. The read is refused when the file's version or modification time differs before and after ("the sheet changed while it was read"); when Drive gives no version, or with `--skip-source-revision`, the check goes ahead and the report and summary say that the read cannot be tied to a revision.
- **The credential stays in the environment**: `FLOWASSERT_SHEETS_TOKEN` (an OAuth access token, with the read-only scopes `spreadsheets.readonly` and `drive.metadata.readonly`) or `FLOWASSERT_SHEETS_API_KEY` (an API key, for a sheet shared for viewing). It is never an option, never read from a file, and never printed, stored or written into a report, a refusal or an exception; a test runs every refusal with a recognisable fake credential and fails if it appears anywhere. FlowAssert does not sign anyone in. `FLOWASSERT_SHEETS_TEST_ENDPOINT` points the requests at a loopback fake, for tests only.
- **A failed or doubtful read concludes nothing**: no credential, 400, 401, 403, 404, 429, 5xx, a timeout, a response that is not the documented JSON, a returned range other than the one asked for, too many rows, a cell that is not text, a change during the read, or any redirect is a refusal (exit status 2, no report), with a precise message that never repeats the server's own error text. Each message has a Chinese explanation in the interface and a section in both refusal guides.
- **Reports from a sheet source** have `schema_version` 2 and `inputs.source_sheet`: read by FlowAssert, the spreadsheet ID, the ranges asked for and returned, the render options, the read time in UTC, the Drive version and modification time before and after (or why there is none), and the canonical form (`flowassert-sheet-csv-1`) whose SHA-256 is `inputs.source_sha256`. They never record the credential, the account or the spreadsheet's title. The summary and the HTML report say where the rows were read and that this does not show the range is the whole batch. A reader of version 1 only refuses them, by design. Reports without a sheet source keep `schema_version` 1. See [the report format](docs/report-format.md#a-report-from-a-google-sheets-source).
- **The browser reads such reports**: the Saved reports page imports and opens them and shows where the rows were read and the revision; a comparison is refused with `different-source` when the two reports' sources differ (a file and a sheet, two spreadsheets or two ranges); "What this result means" explains the new members from the report alone, in English and Chinese, and words the premises for a range. The browser makes no request to Google.
- [The design note](docs/connectors/google-sheets.md) and [the Google Sheets guide](docs/guides/google-sheets.md), in English and Chinese, with every statement about Google's behaviour marked as read from documentation or still unconfirmed, and the steps that were not tried said plainly; two new questions in both FAQs; a Chinese copy of [the report format](https://github.com/Sun-sh902/FlowAssert/blob/v1.0.0/docs/report-format.zh-CN.md); and [the owner's live check](scripts/dev/sheets_live_check.md), prepared and not run.
- Tests: `scripts/dev/tests/test_sheets_source.py` against a local fake of the two endpoints (`offline/bench/fake_sheets_api.py`), covering every refusal, the method, host and path of every request, verified TLS, no retry or redirect, the timeout, the revision, the credential leak test, and the same result as a CSV file with the same rows for 80 golden cases. 42 sheet-sourced golden cases in `offline/golden-sheets/`, with the fake's responses and the requests the checker sent, checked by `golden.py --check` in CI. A Vitest suite opens, explains and compares sheet-sourced reports. The test inventory gains an `offline` group for the command line's own tests.

### Changed

- `README.md`, `README.zh-CN.md` and the comment in `action.yml` name the Action as `Sun-sh902/FlowAssert@v0.6.0` (in 1.0.0, `@v1.0.0`), the latest release, instead of `@v0.4.0`; a test fails when they disagree or name a version without a dated section here.
- The workflows use `actions/checkout@v7`, `actions/setup-node@v7`, `actions/setup-python@v7`, `actions/upload-artifact@v7`, `actions/upload-pages-artifact@v5` and `actions/deploy-pages@v5`, all on Node.js 24.
- `ui/package-lock.json` updated within the existing ranges (`npm update`); no range changed and `npm audit` reports no vulnerability.
- `flowassert_offline.__version__` and the packaged checker's `VERSION` are `0.7.0`; the n8n example holds that build.

- The trial feedback form is in one language at a time: `.github/ISSUE_TEMPLATE/trial_feedback.yml` is in English only, and its Chinese copy, `trial_feedback_zh-CN.yml`, is the one the Chinese interface and `README.zh-CN.md` link to. The English changelog no longer quotes Chinese interface texts.
- On the CSV check page, when the last check found a stated total that differs from the rows it read, a note under that total, and under its statement when the box is ticked, says that the check did not apply the statement. The checkbox stays as the person left it; the note is read from that check's report and goes away with the result on any change. Suggested in the first trial feedback ([#2](https://github.com/Sun-sh902/FlowAssert/issues/2)).
- The CSV check page chooses each file with its own "Choose a file" button, in the interface's language. The browser's file button, which the browser labels in the system's language (Chinese on a Chinese system even in the English interface), is hidden.

## 0.6.0 (2026-11-04)

A first check that a newcomer can finish and understand. This release adds no checking capability. The verdicts, summaries, JSON and HTML reports, exit statuses and comparisons of the command-line checker, the browser check, the packaged JavaScript checker, the GitHub Action and the n8n example are unchanged; every existing golden case and comparison case gives the same bytes as in 0.5.0, and the packaged checker differs from 0.5.0 only in its version string. Everything new is shown next to a result, never inside it. The Service, the frozen contracts, the pinned Evaluator v1, the Action and the LOCAL_RESEARCH and MOCK pages are unchanged. Nothing new makes a request or stores anything.

### Added

- **What this result means**, under the result on the CSV check page and on an opened saved report: a short list of plain-language points read only from the report (`ui/src/offline/explain.ts`). For Verified, what was shown, under which stated premises, and what it does not show. For Mismatch, how many records failed which rules. For Unverified, and after a Mismatch, each reason the batch is not Verified, in the order that matters: the source population (the source not stated complete, empty or repeated keys, a total that differs), destination coverage (not stated complete, destination rows without a key, a total that differs), values a rule could not compare, and destination-only records without a conclusion. A premise is explained as what it means, how a person could find out whether it is true, and that FlowAssert cannot check it; it is never offered as a way to reach Verified. Repeated reasons are grouped with counts, and the list is capped.
- **Help after a refusal** on the CSV check page: under the command line's message, a hint where the refusal and the first bytes of the chosen files justify one (`ui/src/offline/refusalHint.ts`): a UTF-16 byte order mark, UTF-16 without one, a start that reads as UTF-8 or GB18030; the file's columns, and one that differs from a missing column only in case or spaces; the fields of a refused line against the header; a file separated by semicolons or tabs; repeated column names; identical content, the same file, and the row and size limits. A hint never retries and never changes a choice. [When a check is refused](docs/guides/refusals.md) gives the same help for the command line, one section per refusal message.
- **Chinese explanations of the English texts**: in the Chinese interface, each refusal, date format problem, rule reason, destination-only reason, the claim, the limitations and each kind of summary line is shown in English, as the command line writes it, with a Chinese explanation next to it (`ui/src/i18n/englishTexts.ts`). A test reads the refusal messages and reasons from the Python sources and fails for one without an explanation.
- **Scenarios** (`offline/examples/scenarios/`): four small synthetic file pairs with their configuration, replacing "Use the sample files": contacts synced to a CRM with one changed phone number and one missing contact; orders compared with casefold and trim; an extra destination record under scope `exact`; a source row with an empty key. Each says which result to expect with which premises. Choosing one on the page fills in its files, columns and rules and states nothing. Each expectation is a new golden case, `scenario-ID-PREMISES`, run by the command line and the page.
- **Feedback**: an issue form, "I tried FlowAssert" (`.github/ISSUE_TEMPLATE/trial_feedback.yml`, in English with each label also in Chinese), and a "Give feedback" link on the CSV check and saved reports pages that opens it on GitHub in a new tab when pressed, with no query parameter other than the template. The form asks people not to paste real data, keys, values or reports.
- [Questions and answers](docs/faq.md), also in Chinese.
- A test of every relative link and anchor in the Markdown files, and browser tests of all of the above in Chrome (`ui/e2e/first-check.spec.ts`), in the CI job of the CSV check.

### Changed

- Both READMEs start with what FlowAssert is, how to try it online, how to install and run one check, and what the four results mean. The Service quick start, architecture, backend, frontend, testing, extending, repository layout and project history moved unchanged to [Development](docs/development.md).
- In the Chinese interface, the claim and the limitations are shown in English with a Chinese explanation, instead of in Chinese only.
- `flowassert_offline.__version__` and the packaged checker's `VERSION` are `0.6.0`; the n8n example holds that build.

## 0.5.0 (2026-11-04)

History and change, in the browser only: reports can be kept in the browser on request, and two reports of the same obligation can be compared. The verdicts, summaries, reports and exit statuses of the command-line checker, the browser check, the packaged JavaScript checker, the GitHub Action and the n8n example are unchanged; every golden case gives the same bytes as in 0.4.0. The Service, the frozen contracts, the pinned Evaluator v1, the Action and the LOCAL_RESEARCH and MOCK pages are unchanged.

### Added

- **Saved reports** (`#/check/reports`), reached from the CSV check page and the "Browser check" navigation. After a check, "Keep this report in this browser" keeps that one JSON report; a JSON report written by the command line, the Action or n8n can be imported. Nothing is stored unless the person asks, every time: a check stores nothing by default, no setting turns saving on, and the CSV files are never stored. Reports are kept in one IndexedDB database of the site, `flowassert-saved-reports`; reading the list never creates it, and "Delete all" deletes it. The page lists each report's time, how it was obtained, cohort state, counts, key and fields, and whether it is redacted, and shows where they are kept. A report can be opened (the state, the claim or "No claim is made", every premise with its origin, the counts, the limitations and the records that are not Verified), downloaded with its original bytes, or deleted. Saving, importing, listing, comparing and deleting make no request. If storage is unavailable, saving is refused with the reason and the check still works.
- **Reading a report** (`ui/src/offline/savedReport.ts`): a file is accepted only as a valid `schema_version` 1 report, read with the configuration file's JSON reader (a duplicate member is refused), of at most 200 MiB, and whose own numbers agree; otherwise it is refused with the check that failed and nothing is stored. An opened or compared report is always read again from its original bytes.
- **Comparing two reports** (`#/check/compare`, `ui/src/offline/compare.ts`, specified in [`docs/report-comparison.md`](docs/report-comparison.md)): for two reports of the same obligation, the records that became a problem, stopped being one or stayed one (with both states), stayed Verified, or are in one source only, destination-only keys compared the same way, and the records that cannot be matched by key, with the reason. The page shows the two reports, then any premise difference and any changed file digest, before any count, then the classes and their records. A comparison is a view of two observations, never a new verdict: it re-evaluates nothing, changes no state and never says that a problem was fixed. Two reports of another obligation, a redacted report or the same report twice are refused with the reasons.
- Shared comparison cases (`ui/src/test/offline/comparison-cases/`), written from reports of the command-line checker by `ui/scripts/offline/comparison_cases.py`; CI checks they are current.
- Browser tests of saved reports and comparisons with the real IndexedDB in Chrome (`ui/e2e/saved-reports.spec.ts`), in the CI job of the CSV check.

### Changed

- `flowassert_offline.__version__` and the packaged checker's `VERSION` are `0.5.0`; the n8n example holds that build.
- The browser check's register says that a report is kept only when the person asks. On the online demo, the CSV check and saved reports pages say that the site `sun-sh902.github.io` is shared by every GitHub Pages site of the account, so another of them could read the reports kept there.
- The CSV check and its saved reports pages are one chunk of the UI build, so moving between them loads nothing.

## 0.4.0 (2026-11-04)

Workflow integration: the check runs where data already moves. The verdicts, summaries, reports and exit statuses of the command-line checker and of the browser check are unchanged; every golden case gives the same bytes as in 0.3.0. Two fixes concern Windows only. The Service, the frozen contracts, the pinned Evaluator v1 and the UI pages are unchanged.

### Added

- A **GitHub Action** (`action.yml`, `uses: Sun-sh902/FlowAssert@v0.4.0`): a composite action that runs the offline checker from its own folder with the runner's Python 3.9 or later, and installs or downloads nothing while it runs. Each input maps to one `flowassert-verify` option; the premises default to not stated, and a boolean input accepts only `true` or `false`. `fail-on` is `not-verified` (the default: the step passes only on Verified) or `mismatch` (it passes on Verified and Unverified); a refused or failed check always fails the step. By default the log and the job summary show the state, the counts, the premises and the limitations, and no key or value; `show-records: true` prints the record lines. Outputs `state`, `exit-code`, `json` and `html`. Inputs reach the check only through the environment and `action/run_action.py`, never inside a shell script. A self-test workflow (`.github/workflows/action-self-test.yml`) runs it on Linux, macOS and Windows.
- A **packaged JavaScript checker**: `checkCsv` in `ui/src/offline/api.ts`, built by `npm run build:lib` into one script, `ui/dist-lib/flowassert-check.js`, that defines the global `FlowAssert` with `checkCsv` and `VERSION`, imports nothing and makes no request. It runs the check the CSV check page runs and returns the exit status, state, summary, message and both reports. It checks the host features it needs (`BigInt`, `TextEncoder`, `TextDecoder` with fatal decoding for each encoding used) on known bytes before every check and refuses with a message when one is missing or different. Where `crypto.subtle` is missing it uses its own SHA-256, which is tested against `crypto.subtle`.
- An **n8n example** (`examples/n8n/`): a workflow whose Code node holds the packaged checker, with no Execute Command node. It reads two files, runs the check with every premise unstated by default, and branches on the state. It was tested on a self-hosted n8n 2.46.4, where all 49 golden cases it can express gave the command line's results; it was not tested on n8n Cloud. `ui/scripts/n8n/build_workflow.mjs` writes it, and a test fails when the committed workflow does not hold the current build.
- The premise origins `JavaScript call` and `n8n Code node`, chosen by a caller of the packaged checker. See `docs/report-format.md`.
- CI: `test_action.py` on every Python version, the packaged checker built and kept as an artifact, and a check that the n8n example holds that build.

### Changed

- `flowassert_offline.__version__` is `0.4.0`.
- `.gitattributes` keeps the golden files, examples, conformance cases and the n8n workflow byte for byte on a Windows checkout.

### Fixed

- On Windows, the JSON and HTML reports were written with CR LF line breaks, so they differed from the reports written on Linux, macOS and in the browser. They now have the same bytes on every platform.
- A summary with a character the terminal's encoding cannot show (on Windows, a non-ASCII value printed to a pipe) stopped the check with exit status 4 after the reports were written. That character is now printed as an escape such as `\xe9`, and the exit status is the result's.

## 0.3.0 (2026-11-03)

The offline check in the browser. The command-line checker gives the same verdicts, summaries, reports and exit statuses as 0.2.0, except for the two date-rule fixes below. The Service, the frozen contracts, the pinned Evaluator v1 and the LOCAL_RESEARCH and MOCK pages are unchanged.

### Added

- A **CSV check** page in the web UI (`#/check`): choose a source file and a destination export with an encoding each, the key column, the compared fields with a rule each, the scope and the premises, and get the command line's result, summary, and JSON and HTML reports. Nothing is preselected or inferred; both completeness statements start unchecked. The files are read in a Web Worker and never leave the computer: the page makes no network request from choosing the files to downloading the reports. Nothing the user chooses or states is stored; the column and rule choices can be downloaded and loaded as a `--config` file.
- A TypeScript port of Evaluator v2, the CSV reader, the encodings and the report writers (`ui/src/offline/`), following Python where its behaviour depends on Unicode (casefold, whitespace, `repr`, case-insensitive matching) through tables generated from CPython 3.15 (`ui/scripts/offline/unicode_tables.py`).
- The premise origin `browser form`, recorded for every premise of a report made in the page. See `docs/report-format.md`.
- `offline/bench/golden.py` and `offline/golden/`: the CLI's outputs for 88 cases, which the browser check must reproduce byte for byte. A Python test fails when they are not current. `offline/bench/parity.py` runs random cases for the random parity test.
- A GitHub Pages build (`npm run build:pages`) with the CSV check as its home page, a Content Security Policy that allows no connection, and a "works only locally" notice in place of every page that needs the local Service; `.github/workflows/pages.yml` deploys it on manual dispatch only.
- CI: the golden check on every Python version, a parity job on Python 3.15, and the CSV check's browser tests in Chrome.

### Differences between the browser check and the command line

- Date formats may use only `%Y %m %d %H %M %S %f %z %b %B %y %p %I %j %%`; any other directive is refused as not supported in the browser.
- Where Python versions differ, the browser follows Python 3.15: `%d` needs a year directive, and `%z` may be absent from a value.
- The page always runs as `--config` with both encodings stated, so its reports record `config_file_sha256`, `obligation.rules`, `obligation.scope` and both encodings; it offers no `--mapping`, `--details all`, `--redact-values` or other limits.
- The browser does not reveal paths: two choices are refused as the same file when their name, size, modification time and bytes are all equal.

### Changed

- `flowassert_offline.__version__` is `0.3.0`.
- A production build of the UI uses relative asset paths, so it works from a sub-path.
- The UI's navigation rail scrolls when the window is too short for it.

### Fixed

- A date format that repeats a directive, such as `date:%Y %Y`, is refused (exit status 2, `date format '%Y %Y' repeats a directive`). It stopped the check with exit status 4 before, because Python cannot compile such a format.
- A date with a UTC offset whose instant falls outside the years 1–9999 in UTC, such as `0001-01-01 00:00 +0100`, leaves its field unknown, as any value that cannot be read as a date does. It stopped the whole check with exit status 4 before.

## 0.2.0 (2026-11-02)

Configuration, comparison rules and trust for the offline CSV checker (`offline/`). The Service, UI, frozen contracts, and pinned Evaluator v1 are unchanged. With none of the new options, verdicts, record states, exit statuses and the printed summary are the same as in 0.1.1.

### Added

- `--source-count N` and `--destination-count N`: the totals seen in the original systems, compared with the data rows in each file. A source count that differs makes the source population unknown, even with `--source-complete`; a destination count that differs makes destination coverage insufficient, even with `--destination-complete`. Each mismatch prints one summary line. A matching count does not replace the completeness flags.
- `--config FILE`: a UTF-8 JSON file with `key`, `fields` (each with `source`, `destination` and an optional `rule`) and `scope`. A leading byte order mark is accepted. Completeness statements and counts are refused there, as are unknown or duplicate members, unknown rules, malformed date formats, repeated source fields, empty names and wrong types. It cannot be combined with `--mapping`, `--key`, `--field` or `--scope`. Its SHA-256 is recorded as `inputs.config_file_sha256`.
- Explicit comparison rules, set per field in the configuration file: `exact` (the default), `trim`, `casefold`, `digits` and `date:FORMAT`. A value without digits under `digits`, or that does not parse under `date:FORMAT`, is Unverified; under `date:FORMAT`, values with a UTC offset are compared in UTC; an empty value is Unverified under every rule. Field results under a rule other than `exact` record the rule and the normalized values, which `--redact-values` also removes. `--mapping` still always compares exactly.
- `--scope source|exact`. With `exact`, destination keys that are not in the source are reported as destination-only records, in a separate `destination_only` list with `destination_only_counts` and one summary line. They are a Mismatch only when the source population is known; otherwise they are listed without a conclusion.
- `--source-encoding` and `--destination-encoding`: `utf-8` (default), `utf-16` or `gb18030`. A file that does not decode is refused with its name and encoding. When either option is passed, both encodings are recorded in `inputs`.
- `--details problems|all` (default `problems`).
- `--html PATH`: a self-contained HTML report with no scripts and no external resources, escaping every value. Like `--json`, it refuses to overwrite a file. If one report cannot be written, no report is left behind.
- `docs/report-format.md`, describing every report member.
- `offline/bench/memory_check.py` and a CI job running it on Python 3.14: it fails if two files of 1,000,000 rows peak at 500 MB or more.
- Conformance cases for each rule, the count cross-check and `--scope exact`. The case format accepts a rule as the third item of a field, `scope` in `obligation`, and `source_count` and `destination_count` in `premises`; see `offline/conformance/README.md`.

### Changed

- **Report shape:** with the default `--details problems`, a Verified record in the JSON report keeps only `key`, `source_row` and `state`. Non-Verified records are unchanged. Pass `--details all` for the 0.1.1 record shape.
- The JSON report starts with `"schema_version": 1` and adds `details` and `premises`. `premises` lists `source_complete`, `destination_complete`, `source_count`, `destination_count` and, when passed, `allow_identical_content`, each with what was stated and its origin, and, for counts, the rows read and whether they matched. Every 0.1.1 member, including all of `inputs`, is kept.
- The Verified claim now reads: "At this evaluation, under the stated premises, the supplied destination rows satisfy the rules for the supplied source rows."
- The source file is read once and kept only for the columns the check uses. The destination file is folded into an index while it is read, and no destination row is kept. The report is written one record at a time. On the memory check (two 1,000,000-row files, macOS, Python 3.14), peak memory fell from 2.3 GB to 0.4 GB, and the default JSON report from 750 MB to 95 MB.
- A report that fails while being written is removed rather than left partly written.

## 0.1.1 (2026-11-02)

Small hardening and usability release for the offline CSV checker (`offline/`). The Service, UI, frozen contracts, and pinned Evaluator v1 are unchanged.

### Added

- `--mapping FILE`: UTF-8 JSON file specifying `key` and `fields` column pairs so column names containing `:` can be selected; records `mapping_file_sha256` in report `inputs` and refuses combining `--mapping` with `--key` or `--field`. A leading byte order mark is accepted.
- `--allow-identical-content`: allows comparing two distinct files whose SHA-256 digests match when they genuinely come from separate systems, recording `identical_content` and `identical_content_allowed` in `inputs` and noting identical files in the printed summary. Paths resolving to the same file remain refused, and identical content remains refused by default.
- `--max-bytes N` (default `209715200`, 200 MiB, checked via `os.stat` before reading) and `--max-rows N` (default `1000000`, checked while reading CSV rows) to refuse oversized inputs cleanly with exit status 2.
- `--max-details N` (default `50`; `0` prints none) to cap non-Verified record details in the printed summary without affecting the `--json` report.
- Shared synthetic conformance suite in `offline/conformance/` for Evaluator v2, including the three cases shared with Evaluator v1.
- Step-by-step first-check guides in English (`docs/guides/first-check.md`) and Simplified Chinese (`docs/guides/first-check.zh-CN.md`).

### Changed

- Documented the Python support policy for `offline/`: Python 3.11+ is supported, while Python 3.9 and 3.10 are best-effort because macOS ships Python 3.9 (`requires-python = ">=3.9"` retained; CI offline matrix set to `3.9`, `3.11`, and `3.14`).

## 0.1.0 (2026-11-01)

Initial public release of FlowAssert:

- Installable offline CSV checker (`flowassert-verify` / `offline/verify.py`) and Evaluator v2 for exact-string comparison with explicit completeness premises, JSON reports, SHA-256 file digests, and value redaction.
- Local read-only FastAPI Service, pinned Evaluator v1, append-only SQLite history archive, and React UI (English and Simplified Chinese) operating on five reviewed synthetic cases.
