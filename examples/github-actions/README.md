# FlowAssert in GitHub Actions: examples

Two workflows to copy into a repository's `.github/workflows/`. Both need FlowAssert 1.1.0, whose Action reads a
Google Sheets range, HubSpot's contacts and Excel workbooks, writes the records to resend, and adds a run summary to
the run's page. The Action's inputs are described in [`action.yml`](../../action.yml), and the design in
[docs/design/1.1-action.md](../../docs/design/1.1-action.md).

| Workflow | What it checks | When |
| --- | --- | --- |
| [`scheduled-sheet-to-hubspot.yml`](scheduled-sheet-to-hubspot.yml) | The leads of a Google Sheets range against HubSpot's contacts | Every weekday at 06:17 UTC, and by hand |
| [`workbooks.yml`](workbooks.yml) | One worksheet of a workbook in the repository against another workbook | When either workbook changes, and by hand |

## Credentials

A credential is never an input: an input's value can appear in the log of the step that sets it. FlowAssert reads
its credentials from the environment only, so the workflow sets them from repository secrets in the `env:` of the step
that uses the Action:

| Secret | For | What it is |
| --- | --- | --- |
| `FLOWASSERT_SHEETS_TOKEN` | Google Sheets | An OAuth access token that can read the spreadsheet ([the connector's page](../../docs/connectors/google-sheets.md)). `FLOWASSERT_SHEETS_API_KEY` reads a spreadsheet shared with anyone who has the link instead. |
| `FLOWASSERT_HUBSPOT_TOKEN` | HubSpot | A private app's access token with the `crm.objects.contacts.read` scope ([the connector's page](../../docs/connectors/hubspot.md)) |

Add them under the repository's Settings, "Secrets and variables", "Actions". The scheduled example also reads the
spreadsheet's ID from a repository variable, `LEADS_SPREADSHEET_ID`; it is not a secret, but keeping it out of the file
lets the same workflow check another spreadsheet. FlowAssert never prints, stores or summarises a credential, and the
Action's tests run it with recognisable fake credentials against local fakes and find them in none of its outputs.
GitHub does not pass secrets to workflows triggered from a fork.

## What a run leaves

- **The run summary**, on the run's page: the result, the claim or "No claim is made", the counts, each premise and
  whether it was applied, each input's kind and digests, and the files of records to resend with their row counts. It
  holds no compared value and, unless `summary-keys: "true"`, no key. `summary: "false"` turns it off.
- **An artifact**, `flowassert-RUN_ID`: the JSON and HTML reports and the records to resend, kept for 30 days. They
  hold keys and values. People who can see the workflow's runs can download it, which in a public repository may be
  anyone; use these examples in a private repository, or leave the artifact step out.
- **The step's result**: it fails when the result is not Verified (`fail-on: not-verified`, the default), so GitHub
  tells the people it notifies of failed runs. `fail-on: mismatch` fails only on a Mismatch.

Each run writes its files into a new folder named after the run's ID. A run is a new observation: nothing edits an
earlier report, and an earlier run's artifact keeps what that run saw.

## The records to resend

`export-dir` writes CSV files of the rows that need action, each row as it was read: the rows the destination lacks
(only when the destination was stated complete), the rows whose values differ, the duplicated keys, and, apart, the
rows whose status is unknown, which resending may duplicate. They are advice from the check, not a further
conclusion. Import them into the system they came from rather than opening them in a spreadsheet program, which may
run text that begins with `=`, `+`, `-` or `@` as a formula. [docs/design/1.1-exports.md](../../docs/design/1.1-exports.md)
describes every file.

## Schedules

From GitHub's documentation of `on.schedule`, read on 2026-11-12:

- A scheduled workflow runs on the latest commit of the default branch, in UTC, at most every 5 minutes.
- Runs may be delayed when GitHub is busy, most often at the start of an hour; a run may be dropped. The example runs
  at minute 17 for that reason.
- In a public repository, GitHub disables a scheduled workflow after 60 days without activity in the repository.
  Re-enable it from the Actions tab.

A scheduled check therefore says what the data looked like when it ran. It is not a monitor that sees every change.
