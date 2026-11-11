# Check a Google Sheets range against a destination export

English | [简体中文](google-sheets.zh-CN.md)

From 1.0.0 the command line can read the source rows itself, from one range of a Google Sheets spreadsheet, read-only, instead of from a CSV file you exported. The destination is still a CSV export. This guide covers preparing the range, obtaining a read-only credential, running one check, reading the result, and what is still your statement. [The design note](../connectors/google-sheets.md) has every detail and every refusal.

Only the command line reads sheets. The CSV check page in the browser, the GitHub Action and the n8n example read files only, and make no request to Google.

> [!IMPORTANT]
> **Not yet tried against Google.** FlowAssert's reading of a sheet is tested against a local fake of Google's two endpoints, built from Google's API descriptions. Nobody has yet run it against a real spreadsheet. The steps for obtaining a credential below are written from documentation in general terms, and were not tried either. If something does not work as described, please [report it](https://github.com/Sun-sh902/FlowAssert/issues/new?template=trial_feedback.yml), without any credential, key or real data.

- [1. What reading the sheet shows, and what it does not](#1-what-reading-the-sheet-shows-and-what-it-does-not)
- [2. Prepare a bounded range with a key column](#2-prepare-a-bounded-range-with-a-key-column)
- [3. Obtain a read-only credential](#3-obtain-a-read-only-credential)
- [4. Run one check](#4-run-one-check)
- [5. Read the result](#5-read-the-result)
- [6. What is still your statement](#6-what-is-still-your-statement)
- [7. Afterwards: remove the credential](#7-afterwards-remove-the-credential)

## 1. What reading the sheet shows, and what it does not

Reading the sheet removes one step you had to trust: the export. No export can have cut the rows short or edited them, because FlowAssert read the range itself, and the report records which spreadsheet, which range, when, and, when Google Drive gives one, the file's version before and after the values were read.

It does **not** show that the range holds every record that should exist. A filter, a missing row or a record that was never typed into the sheet look the same from the API as from a CSV file. Whether the range is the whole batch stays your statement, `--source-complete`, exactly as for a file. The same cell values give the same result as the same rows in a CSV file: reading the sheet never makes a result more Verified.

## 2. Prepare a bounded range with a key column

1. Put the records of one batch on one tab, with a header row first and one record per row.
2. Give the tab a column that identifies each record, such as `lead_id`, with a value in every row and no value twice. The destination export must carry the same key.
3. Leave no empty row between records. FlowAssert reads an empty row inside the range as a record without a key, which keeps the batch from being Verified; it cannot tell an empty record from a gap.
4. Write the range with the tab's name and the columns you need: `Leads!A1:F` reads columns A to F of the tab `Leads`, from row 1 to the last row with a value; `Leads!A1:F500` stops at row 500. Quote a tab name with spaces: `'Q3 leads'!A1:F`. A range without a tab, a named range, or whole rows such as `Leads!1:500` are refused, so that the command and the report always say which cells were read.
5. Check what the sheet shows. FlowAssert reads every cell as the text the sheet displays, formatted in the spreadsheet's locale: a date shown as `2026-01-02` is read as `2026-01-02`, and a number shown as `1,234.50` as `1,234.50`. Compare it with the destination using a rule that fits, such as `date:%Y-%m-%d` or `digits` in a `--config` file.

Use synthetic data while you try it. The live-check plan for the maintainer ([scripts/dev/sheets_live_check.md](../../scripts/dev/sheets_live_check.md)) has a small synthetic sheet you can copy.

## 3. Obtain a read-only credential

FlowAssert does not sign you in. You give it one credential in an environment variable, never as an option and never in a file, and it uses it only for three `GET` requests: two to Google Drive for the file's version, one to the Google Sheets API for the values. It never prints, stores or writes the credential.

There are two kinds. Choose one:

- **An OAuth access token** in `FLOWASSERT_SHEETS_TOKEN`, for a sheet your Google account can open. Grant only the read-only scopes: `https://www.googleapis.com/auth/spreadsheets.readonly` for the values, and `https://www.googleapis.com/auth/drive.metadata.readonly` for the version. Look for a place to choose scopes in whatever tool issues the token, such as Google's OAuth 2.0 Playground or the `gcloud` command-line tool. Access tokens expire after a while; FlowAssert reports an expired one as a refusal (HTTP 401) and does not refresh it.
- **An API key** in `FLOWASSERT_SHEETS_API_KEY`, only for a sheet shared so that anyone with the link can view it. An API key belongs to a Google Cloud project in which the Google Sheets API (and the Google Drive API, for the version) are enabled. When you create it, look for the setting that restricts the key to those APIs, and use it.

A token without the Drive scope, or a key in a project without the Drive API, cannot read the version. Then add `--skip-source-revision`: the check goes ahead, and the report says that the read cannot be tied to a revision.

**Steps not tried.** Creating a Google Cloud project, enabling the two APIs, creating and restricting an API key, and issuing a token with chosen scopes were not tried for this guide, and the screens are not described here because they were not seen. Check Google's terms for who may hold an account before creating an account or a project.

Set the variable without it landing in your shell history, for example in zsh or bash:

```sh
read -rs FLOWASSERT_SHEETS_TOKEN && export FLOWASSERT_SHEETS_TOKEN
```

Paste the token, press Enter, and nothing is shown. Never paste a credential into an issue, a chat, a file in the repository or a report.

## 4. Run one check

A synthetic example. The tab `Leads` of the spreadsheet holds:

| lead_id | phone | email |
| --- | --- | --- |
| LEAD-001 | +1 555 0100 001 | lead001@example.test |
| LEAD-002 | +1 555 0100 002 | lead002@example.test |
| LEAD-003 | +1 555 0100 003 | lead003@example.test |

The destination export, `crm-export.csv`:

```text
lead_id,phone,hs_email
LEAD-001,+1 555 0100 001,lead001@example.test
LEAD-002,+1 555 0100 002,lead002@example.test
LEAD-003,+1 555 0100 003,lead003@example.test
```

The command, with your spreadsheet's ID in place of the synthetic one (the ID is the long part of the spreadsheet's address after `/d/`):

```sh
flowassert-verify \
  --source-sheet 1SyntheticSpreadsheet-FlowAssert_0001 \
  --source-range 'Leads!A1:C' \
  --destination crm-export.csv \
  --key lead_id --field phone --field email:hs_email \
  --source-complete --destination-complete \
  --json report.json --html report.html
```

Pass `--source-complete` only if the range really is the whole batch, and `--destination-complete` only if the export really covers the whole object (section 6).

## 5. Read the result

The output of this command against the synthetic sheet, from the golden case `offline/golden-sheets/sheet-verified` (run against the local fake, with the time fixed):

```text
Verified: 3 rows of 3
Verified 3 · Mismatch 0 · Unverified 0
Source read by FlowAssert from Google Sheets: spreadsheet 1SyntheticSpreadsheet-FlowAssert_0001, range Leads!A1:C1000, at 2000-01-01T00:00:00Z.
Drive version 57 before and after the values were read.
Files and completeness statements are not authenticated. Not assessed: whether a workflow ran, whether the source is true, whether a record existed by a past deadline.
```

- The first two lines are read as for two files ([the first-check guide](first-check.md#4-run-the-check-read-the-result-and-use-the-exit-status)).
- `Source read by FlowAssert from Google Sheets` names the spreadsheet, the range the API said it read (`Leads!A1:C1000`: the range asked for, with the tab's last row filled in), and when.
- `Drive version 57 before and after the values were read.` means Google Drive recorded no change to the file between just before and just after the read. In its place, `The read cannot be tied to a revision: ...` says why there is no version: you passed `--skip-source-revision`, or Drive gave none.
- If the sheet changes while it is read, the check is refused ("the sheet changed while it was read"). Run it again.

The JSON report has `schema_version` 2 and records the read in `inputs.source_sheet` ([the report format](../report-format.md#a-report-from-a-google-sheets-source)). The **Saved reports** page of the web UI can import it, shows where its rows were read, and compares it only with another read of the same range of the same spreadsheet. A refused check prints one line: [When a check is refused](refusals.md#reading-a-google-sheets-range) explains each message about a sheet.

## 6. What is still your statement

| Statement | Option | Is it shown by reading the sheet? |
| --- | --- | --- |
| The range is the whole batch | `--source-complete` | **No.** FlowAssert sees the rows in the range, not the records that should be there. Check it the way you would for a file: compare the number of rows with the total the system that owns the batch shows, and pass that total with `--source-count` |
| The export covers the whole object | `--destination-complete` | No: the destination is still a file you exported |
| The sheet is the right source, and its values are true | — | No |

A wrong statement gives a wrong result. Reading the sheet does not change that.

## 7. Afterwards: remove the credential

When you are done, remove the variable from the shell (`unset FLOWASSERT_SHEETS_TOKEN` or `unset FLOWASSERT_SHEETS_API_KEY`). Then revoke what you created: delete the API key in its Google Cloud project, or remove the access you granted from your Google account's security settings, which ends the token (look for the list of third-party apps or connections with access). A token also stops working by itself when it expires. These steps were not tried for this guide.
