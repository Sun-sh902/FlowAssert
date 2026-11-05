# Live check of the Google Sheets source (for the owner; not run)

> [!IMPORTANT]
> **Before anything else:** a parent agrees to this check, and to every account or project it needs, **before** any
> account is created or any Google Cloud project is set up. Read Google's terms of service and the Google Cloud terms
> first, and check their minimum-age requirements: if they are not met, stop here. No credential is ever pasted into a
> chat, an issue, a commit or a file in this repository. Use synthetic data only.

This plan was written with FlowAssert 0.7.0 and has **not** been run. It answers S1 question T7 of the
[validation plan](../../docs/product-dev/final-version/S1_VALIDATION_PLAN.md) — "Is a Google Sheets read bounded and
repeatable? Pass: exact cells, a revision reference if available, and read-only scope" — and confirms or contradicts
the statements marked **[unconfirmed]** in the [design note](../../docs/connectors/google-sheets.md). Record what
each step printed in a private note, not in the repository; afterwards, write the conclusions (not the outputs that
name the account) into the design note and the changelog.

## What you need

- A Google account used only for testing, with no real data in its Drive.
- A Google Cloud project in that account, used only for this check, with the **Google Sheets API** and the **Google
  Drive API** enabled. The two can be enabled from the project's API library.
- One of these credentials (try both if you can; they test different things):
  - **OAuth access token** with exactly two scopes, `https://www.googleapis.com/auth/spreadsheets.readonly` and
    `https://www.googleapis.com/auth/drive.metadata.readonly`, issued for the test account. Google's OAuth 2.0
    Playground, or `gcloud auth print-access-token` after a sign-in with those scopes, are possible ways; choose the
    scopes explicitly and nothing wider.
  - **API key** from the same project, restricted (under the key's API restrictions) to the Google Sheets API and the
    Google Drive API, with no other API allowed. It works only for a sheet shared as "anyone with the link can view".
- FlowAssert at the commit under review, installed in a fresh venv: `python3 -m pip install ./offline`.

## The synthetic sheet

Create a new spreadsheet named `FlowAssert live check` in the test account. Rename the first tab to `Leads` and type
exactly (format column E as plain text so the date stays as typed; leave row 5 empty on purpose; nothing after row 7):

| | A | B | C | D | E |
| --- | --- | --- | --- | --- | --- |
| 1 | lead_id | phone | email | note | signed |
| 2 | LEAD-001 | +1 555 0100 001 | lead001@example.test | first, with a comma | 2026-01-02 |
| 3 | LEAD-002 | +1 555 0100 002 | lead002@example.test | | 2026-01-03 |
| 4 | LEAD-003 | +1 555 0100 003 | lead003@example.test | say "hi" | |
| 5 | | | | | |
| 6 | LEAD-004 | 15550100004 | lead004@example.test | number in B | 2026-01-05 |
| 7 | LEAD-005 | +1 555 0100 005 | LEAD005@EXAMPLE.TEST | | 2026-01-06 |

Leave `B6` as a **number** (do not format it as text), so the formatted value is tested. Add a second tab named
`Q3 leads` with `lead_id` in `A1` and `LEAD-001` in `A2`, for the quoting check.

Copy the spreadsheet's ID from its address (between `/d/` and the next `/`). In the commands below, `ID` stands for
it. Save this destination file as `crm-export.csv` in an empty folder:

```text
lead_id,phone,hs_email
LEAD-001,+1 555 0100 001,lead001@example.test
LEAD-002,+1 555 0100 099,lead002@example.test
LEAD-003,+1 555 0100 003,lead003@example.test
LEAD-004,15550100004,lead004@example.test
LEAD-005,+1 555 0100 005,lead005@example.test
```

## The commands

Set the credential without echoing it or keeping it in history, in the shell that runs the checks:

```sh
read -rs FLOWASSERT_SHEETS_TOKEN && export FLOWASSERT_SHEETS_TOKEN
unset FLOWASSERT_SHEETS_API_KEY FLOWASSERT_SHEETS_TEST_ENDPOINT
```

### 1. A whole read, with the revision

```sh
flowassert-verify --source-sheet ID --source-range 'Leads!A1:E' --destination crm-export.csv \
  --key lead_id --field phone --field email:hs_email --details all --json r1.json --html r1.html
echo "exit $?"
```

Expected: exit 1 (Mismatch: `LEAD-002` phone `+1 555 0100 002` vs `+1 555 0100 099`, and `LEAD-005` email
`LEAD005@EXAMPLE.TEST` vs `lead005@example.test` under exact comparison), and lines like

```text
Mismatch: 6 rows of unknown total
Verified 0 · Mismatch 2 · Unverified 4
Source read by FlowAssert from Google Sheets: spreadsheet ID, range Leads!A1:E1000, at 2026-...Z.
Drive version N before and after the values were read.
Source population unknown: the batch cannot be Verified.
```

6 rows, because the empty row 5 is read as a row without a key. Check in `r1.json`:

- `inputs.source_sheet.range_returned`: write down exactly what it is (`Leads!A1:E1000`, `Leads!A1:E7`, quoted or
  not). This is **[unconfirmed]** in the design note.
- `inputs.source_sheet.revision`: `available` true with a `version` of digits and a `modifiedTime`. If it is
  `Google Drive returned no version`, Drive gave no `version` for a spreadsheet: record that.
- In `records`, `LEAD-004`'s phone is `15550100004` (or how the sheet formats the number: record it exactly), and
  `LEAD-002`'s `note` was not compared. The empty row is record 4 (`source_row` 3) with key `null`.

### 2. The same read again, unchanged

Run step 1 again with `--json r2.json` (no edit in between). Expected: the same `inputs.source_sha256`, the same
version, the same records. Compare: `python3 -c "import json;a,b=(json.load(open(f)) for f in ('r1.json','r2.json'));print(a['inputs']['source_sha256']==b['inputs']['source_sha256'], a['inputs']['source_sheet']['revision']==b['inputs']['source_sheet']['revision'])"`
should print `True True`. This is the "repeatable" part of T7.

### 3. A bounded range, a quoted tab, a refused range

```sh
flowassert-verify --source-sheet ID --source-range 'Leads!A1:C4' --destination crm-export.csv --key lead_id --field phone --json r3.json
flowassert-verify --source-sheet ID --source-range "'Q3 leads'!A1:A" --destination crm-export.csv --key lead_id --field lead_id
flowassert-verify --source-sheet ID --source-range 'A1:C' --destination crm-export.csv --key lead_id --field phone
```

Expected: the first reads 3 data rows and `range_returned` is `Leads!A1:C4`; the second runs (exit 3) and its
summary names the quoted tab as Google returned it (record whether Google quotes it); the third is refused before any
request with `--source-range 'A1:C' must name a tab and bounded columns, ...`.

### 4. A change during the read (best effort)

In the sheet, keep typing into an unused cell of another tab (for example `Q3 leads!B9`) while running step 1 several
times. Expected, at least once: `refused: the sheet changed while it was read: ...`, exit 2, no report. If it never
happens, record that the window was too short to hit by hand; that is not a failure.

### 5. Without the Drive scope, and with an API key

- Issue a token with `spreadsheets.readonly` only, and run step 1. Expected: refused with
  `Google Drive revision metadata: access was denied (HTTP 403 ...)` **[unconfirmed]**. Then add
  `--skip-source-revision`: expected to run, with `The read cannot be tied to a revision: not requested (--skip-source-revision).`
- `unset FLOWASSERT_SHEETS_TOKEN`, share the sheet as "anyone with the link can view", set
  `FLOWASSERT_SHEETS_API_KEY` the same way, and run step 1. Expected: the same result as step 1. Record whether
  Drive's `files.get` answers an API key for this file, or refuses it.
- Unshare the sheet again and run with the key. Expected: refused with HTTP 403 or 404.

### 6. Errors

- A wrong ID (change one character): expected `Google Sheets values: not found (HTTP 404 NOT_FOUND)` or a 403;
  record which, and whether Drive answered first (it is asked first, so the refusal will name `Google Drive revision
  metadata` if Drive refuses).
- A tab that does not exist, `'Nope!A1:C'`: expected HTTP 400 **[unconfirmed]**.
- A range wider than the tab, `'Leads!A1:ZZ'` on a 26-column tab: record whether it is a 400 or a returned range
  other than the one asked for.
- A revoked token (after step 7): expected HTTP 401.

### 7. Revoke

- Remove the variables: `unset FLOWASSERT_SHEETS_TOKEN FLOWASSERT_SHEETS_API_KEY`.
- Delete the API key in the project's credentials page, and remove the access you granted (the test account's
  security settings list the apps and services with access; for a token from the OAuth 2.0 Playground, its own
  "revoke" also works).
- Run step 1 once more: expected HTTP 401 or 403.
- Delete `r*.json` and `r*.html`; they contain the spreadsheet ID. Delete the test project when the check is done.

## What the run confirms or contradicts

| Statement in the design note | Step | Confirmed when |
| --- | --- | --- |
| `spreadsheets.values.get` answers at `sheets.googleapis.com/v4/spreadsheets/ID/values/RANGE` with `range`, `majorDimension`, `values` | 1 | It runs |
| An open-ended range (`A1:E`) is returned with a last row, or as asked | 1 | `range_returned` recorded |
| Rows omitted at the end of the range; each row's trailing empty cells omitted | 1 | Records 2 and 3 have empty `note`/`signed`; no row after 7 |
| An empty row inside the range comes as `[]` and is read as a row without a key | 1 | Record with `source_row` 3 and key `null` |
| `FORMATTED_VALUE` gives the displayed text of a number cell | 1 | `LEAD-004` phone as displayed |
| Drive `files.get` gives `version` and `modifiedTime` for a spreadsheet; `headRevisionId` not needed | 1 | `revision.available` true |
| Two reads of an unchanged sheet give the same values and version (T7: repeatable) | 2 | `True True` |
| The returned range is exactly the bounded range asked for (T7: exact cells) | 3 | `Leads!A1:C4` |
| Quoted tab names, and how Google writes them back | 3 | Second command runs |
| The version changes during an edit, and the read is refused | 4 | The refusal is seen at least once |
| A token without `drive.metadata.readonly` gets 403 from Drive | 5 | The 403 refusal |
| An API key reads a sheet shared for viewing, values and Drive metadata | 5 | Same result as step 1 |
| Error statuses: 404 for a wrong ID, 400 for a missing tab, 401 for a revoked token | 6, 7 | The refusals |
| Read-only scope is enough (T7: read-only scope) | 1, 5 | Every read ran with the two read-only scopes only |

T7 passes when steps 1–3 behave as above with only the two read-only scopes, and the revision reference is either
present (step 1) or its absence is reported. If any statement is contradicted, correct the design note, the code and
its tests before release.
