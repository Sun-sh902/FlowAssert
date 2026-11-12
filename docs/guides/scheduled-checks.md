# Scheduled checks in GitHub Actions

From 1.1.0 the FlowAssert Action reads a Google Sheets range and HubSpot's contacts as the command line does, reads
Excel workbooks, writes the records to fix, and adds a run summary to the run's page. A workflow with `on.schedule` then
checks, every morning, that yesterday's records arrived. [examples/github-actions](../../examples/github-actions/README.md)
has two workflows to copy, and [the design note](../design/1.1-action.md) the details.

> [!IMPORTANT]
> **Not yet run on GitHub.** The Action's 1.1.0 inputs are tested with `scripts/dev/tests/test_action.py` against
> local fakes of Google Sheets and HubSpot, and its self-test workflow was written but not run. Nobody has yet run a
> scheduled check against a real spreadsheet or a HubSpot account.

## 1. Credentials come from secrets, never from inputs

Add `FLOWASSERT_SHEETS_TOKEN` (or `FLOWASSERT_SHEETS_API_KEY`) and `FLOWASSERT_HUBSPOT_TOKEN` as repository secrets,
and set them in the `env:` of the step that uses the Action. FlowAssert reads them from the environment only and never
prints, stores or summarises them. An input's value can appear in the log of the step that sets it, so a credential is
never an input.

```yaml
- uses: Sun-sh902/FlowAssert@v1.1.0
  env:
    FLOWASSERT_SHEETS_TOKEN: ${{ secrets.FLOWASSERT_SHEETS_TOKEN }}
    FLOWASSERT_HUBSPOT_TOKEN: ${{ secrets.FLOWASSERT_HUBSPOT_TOKEN }}
  with:
    source-sheet: ${{ vars.LEADS_SPREADSHEET_ID }}
    source-range: Leads!A1:F
    destination-hubspot: contacts
    key: lead_id
    fields: |
      email
      phone
    source-complete: "true"
    export-dir: flowassert/${{ github.run_id }}/records-to-fix
```

## 2. State only what is true at every run

The premises are your statements, and a schedule repeats them every day. State `source-complete` only if the range
always holds the whole batch, and `destination-complete` only if HubSpot's contacts are the whole destination. Without
them the result is not Verified, which is the honest answer.

## 3. What a run leaves

- **The run summary** on the run's page: the result, the claim or "No claim is made", the counts, each premise and
  whether it was applied, each input's kind and digests, and the files of records to fix with their row counts. No
  value; keys only with `summary-keys: "true"`. It stays well under GitHub's 1 MiB limit for a step's summary; beyond
  it, the printed summary and the keys are left out and the summary says so. `summary: "false"` turns it off.
- **The step's result:** it fails when the result is not Verified, so GitHub notifies you as for any failed run.
- **An artifact** with the reports and the records to fix, if you upload it. It holds keys and values: in a public
  repository, anyone may be able to download it.

Each run writes into a new folder named after the run. A run is a new observation; nothing edits an earlier report.

## 4. What GitHub's schedules do

From GitHub's documentation, read on 2026-11-12: a scheduled workflow runs on the latest commit of the default branch,
in UTC; runs may be delayed when GitHub is busy, most of all at the start of an hour, and may be dropped; in a public
repository a schedule is disabled after 60 days without activity. A scheduled check says what the data looked like when
it ran. It is not a monitor that sees every change.
