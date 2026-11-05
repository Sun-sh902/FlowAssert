# FlowAssert

English | [简体中文](README.zh-CN.md)

**The workflow succeeded. Did the expected business data actually arrive?**

FlowAssert compares a source CSV, the records that should have arrived, with an export of the destination system, what is there now, and reports each record as **Verified**, **Mismatch** or **Unverified**. Its central rule: without enough evidence, it never says Verified. It runs on your computer, in a terminal or in your browser, and reads local files; from 0.7.0 the command line can also read the source rows from a Google Sheets range, read-only ([Read the source from Google Sheets](#read-the-source-from-google-sheets)).

> [!IMPORTANT]
> **Early-stage project with one maintainer.** It is not production software.
> The Service and UI work on five reviewed synthetic cases only. They have no live n8n, HubSpot or Google Sheets connection, take no credentials, and capture no external data. Hashes and local receipts show internal consistency, not that any data is authentic.

## Try it online

<https://sun-sh902.github.io/FlowAssert/> runs the check in your browser. Your files never leave your computer: the page makes no network request.

1. Choose your two CSV files, or one of the four synthetic scenarios under **No files at hand? Try a scenario**.
2. Choose the key column and the compared fields, and state only what you know about the files.
3. Press **Check**. Under the result, **What this result means** explains it, from the report alone.

More in [Check in your browser](#check-in-your-browser).

## Install and run one check

This needs only Python 3.9 or later. It reads local files and makes no network requests (only `--source-sheet` reads from Google, and only when you use it).

```sh
git clone https://github.com/Sun-sh902/FlowAssert.git
cd FlowAssert
python3 -m pip install ./offline

flowassert-verify \
  --source offline/examples/source.csv \
  --destination offline/examples/destination.csv \
  --key external_id \
  --field phone \
  --field email:hs_email \
  --source-complete --destination-complete
```

The result, with exit status 1:

```text
Mismatch: 4 rows of 4
Verified 1 · Mismatch 3 · Unverified 0
  record 2 SYN-002: Mismatch
    field:phone fail: exact string comparison ('+1 212 555 0102' vs '+1 212 555 0199')
  record 3 SYN-003: Mismatch
    existence fail: key not found in stated complete destination
    ...
  record 4 SYN-004: Mismatch
    uniqueness fail: more than one destination row carries this key
    ...
```

The [first-check guide](docs/guides/first-check.md) explains each line, and [Scenarios for a first check](offline/examples/scenarios/README.md) has more small examples to run. If the check is refused (exit status 2), [When a check is refused](docs/guides/refusals.md) explains the message.

## What the four results mean

| Result | What it means | Exit status | What to do |
| --- | --- | --- | --- |
| **Verified** | Every record passed every rule, and the batch is known to be whole, under the premises you stated | 0 | Keep the report; the premises are part of the result |
| **Mismatch** | At least one rule is demonstrably false: a value differs, a record is absent from an export stated to be complete, or two destination rows carry one key | 1 | Look at the records listed |
| **Unverified** | No rule was shown to be false, but the evidence is not enough to say Verified | 3 | Read what is not established, and what would settle it |
| **Pending** | No conclusion yet, inside a waiting window. The CSV check has no window, so it never gives Pending | — | Wait, or observe again |

A refused input (exit status 2) or an internal failure (4) has no result at all. A batch can be less certain than its records: when every record passes but the source file is not stated to be the whole batch, the batch is Unverified. FlowAssert does not check what you state, so a wrong statement gives a wrong result. [Why is my result Unverified?](docs/faq.md#why-is-my-result-unverified)

**Tried it? Tell us:** [the trial feedback form](https://github.com/Sun-sh902/FlowAssert/issues/new?template=trial_feedback.yml) asks how you used it, what you wanted to check, where you got stuck and whether the result was clear. It is public, so do not paste real data, keys, values or reports.

## Contents

- [Try it online](#try-it-online)
- [Install and run one check](#install-and-run-one-check)
- [What the four results mean](#what-the-four-results-mean)
- [The problem](#the-problem)
- [Screenshots](#screenshots)
- [What is and is not here](#what-is-and-is-not-here)
- [Command-line options](#command-line-options)
- [Read the source from Google Sheets](#read-the-source-from-google-sheets)
- [Check in your browser](#check-in-your-browser)
- [Use in GitHub Actions](#use-in-github-actions)
- [Use in n8n](#use-in-n8n)
- [How verification works](#how-verification-works)
- [Security model](#security-model)
- [Known issues](#known-issues)
- [Questions](#questions)
- [Development](#development)
- [Glossary](#glossary)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## The problem

A successful automation run does not prove a correct business outcome. A workflow can write a wrong value, skip a lead, or create duplicates while reporting success.

Suppose a workflow should sync 100 leads. 97 match, 2 have wrong values, and 1 is missing after the allowed window. The honest report is 97 Verified and 3 Mismatch, not "100 succeeded". If the check cannot see enough of the destination, that record is Unverified, not missing.

The intended users were independent automation developers and small studios. That profile was never validated: no user interviews took place, and no real account was tested.

## Screenshots

Every screen below shows reviewed synthetic data from a local run. They are the Service's pages, which work only locally, and the demo pages; the CSV check is not among them. Dates and times are synthetic or local to that run.

### Overview

The opening page states the result in words, then shows live results beside the newest archived results for each case. "Live against archive" compares two Service outputs. It is a diagnostic, not a verdict.

| Light | Dark |
| --- | --- |
| ![Overview in light theme](docs/readme/overview-light.png) | ![Overview in dark theme](docs/readme/overview-dark.png) |

### Verifications

Each case on one page, with capture and admission kept apart from the live and archived verdicts. Both of those columns show *Not implemented* for the reviewed fixtures, on purpose.

![Verifications list](docs/readme/verifications.png)

### A Mismatch, from claim to evidence

`SPEC-002` read from top to bottom: the verdict, how it was reached, the four status axes, matching archive entries, the record comparison, what the evidence supports, what stays unknown, the timeline, and the evidence references the browser re-hashes.

<details>
<summary>Open the full page</summary>

![Full Verification Detail page for a Mismatch](docs/readme/detail-mismatch.png)

</details>

### Every row passes, and the batch is still Unverified

`SPEC-005` is the case the product exists for. All 12 visible records match, but the source total is unknown, so FlowAssert does not call the batch Verified.

![Verification Detail for SPEC-005: 12 records match, batch Unverified](docs/readme/detail-cohort-unverified.png)

### History

Archived evaluations, newest first, each with its own integrity statement. Archive time and evaluation time are kept separate.

![History list](docs/readme/history.png)

### Demo pages

Rules, Connections and Settings are mock pages, and they say so. A rule draft stays in the browser and never runs.

![Rules demo page](docs/readme/rules-demo.png)

### Narrow screens

The workspace pages are checked across a 200-cell responsive matrix, in both themes.

<img src="docs/readme/overview-mobile.png" alt="Overview on a phone-width screen in dark theme" width="320">

## What is and is not here

| Area | State |
| --- | --- |
| Offline CSV check (`offline/`) | Works on your own local files |
| CSV check in the browser (`ui/`, `#/check`) | Works on your own local files; nothing is uploaded |
| GitHub Action (`action.yml`) | Runs the offline check on files in a workflow; installs and downloads nothing |
| n8n example (`examples/n8n/`) | Runs the browser check in a Code node; tested on a self-hosted n8n only |
| Pinned Evaluator with four result states | Works on the five synthetic cases |
| Read-only HTTP Service | Works locally |
| Append-only SQLite history archive | Works locally; only the reviewed cases can be archived |
| React UI for results, evidence and history | Works locally against the Service |
| Local execution receipts | Experimental; they prove nothing outside this Service |
| Connections, Rules, Settings pages | Mock demo. Nothing connects or runs |
| Capture runs page | Not implemented |
| Google Sheets source (`--source-sheet`) | Command line only: reads one range of a spreadsheet, read-only, as the source. Tested against a local fake of Google's endpoints; not yet tried against Google |
| n8n or HubSpot connectors | Do not exist |
| Starting a verification from the UI | Does not exist |
| Login, multi-user, deployment | Do not exist |
| User validation | Never done |

## Command-line options

Without installing, run `python3 offline/verify.py` with the same options. To install from GitHub:

```sh
python3 -m pip install "git+https://github.com/Sun-sh902/FlowAssert.git#subdirectory=offline"
```

`email:hs_email` means the column is `email` in the source and `hs_email` in the destination.

| Option | Meaning |
| --- | --- |
| `--key COL[:COL]` | Stable record key. Required unless `--mapping` or `--config` is used |
| `--field COL[:COL]` | Field to compare exactly. Repeatable; at least one is required unless `--mapping` or `--config` is used |
| `--mapping FILE` | UTF-8 JSON file with `key` and `fields` column pairs, including names containing `:`. Always compares exactly |
| `--config FILE` | UTF-8 JSON file with `key`, `fields` with a comparison rule each, and `scope`. Replaces `--mapping`, `--key`, `--field` and `--scope` |
| `--scope source\|exact` | `source` (default): check each source record. `exact`: also report destination keys that are not in the source |
| `--source-complete` | You state that the source file is the whole batch |
| `--destination-complete` | You state that the export covers the whole object |
| `--source-count N` | You state the source total seen in the original system; a different row count blocks Verified |
| `--destination-count N` | You state the destination total seen in the original system; a different row count leaves absence and duplicates unknown |
| `--allow-identical-content` | Continue when two distinct files have identical content, and record that in `inputs` |
| `--source-encoding NAME` | `utf-8` (default), `utf-16` or `gb18030` |
| `--source-sheet ID` | Read the source from this Google Sheets spreadsheet, read-only, in place of `--source` ([guide](docs/guides/google-sheets.md)) |
| `--source-range RANGE` | With `--source-sheet`: a tab and bounded columns, such as `Leads!A1:F` or `Leads!A1:F500` |
| `--source-timeout SECONDS` | With `--source-sheet`: the longest each request may take (default: `60`) |
| `--skip-source-revision` | With `--source-sheet`: do not read the file's version from Google Drive; the report says the read cannot be tied to a revision |
| `--destination-encoding NAME` | `utf-8` (default), `utf-16` or `gb18030` |
| `--max-bytes N` | Refuse a file larger than `N` bytes before reading (default: `209715200`, 200 MiB) |
| `--max-rows N` | Refuse a CSV with more than `N` rows while reading (default: `1000000`) |
| `--max-details N` | Print at most `N` non-Verified records in the summary; `0` prints none (default: `50`) |
| `--json PATH` | Write a full report with file digests. Refuses to overwrite a file. [Format](docs/report-format.md) |
| `--details problems\|all` | `problems` (default): Verified records in `--json` keep only key, row and state. `all`: every record in full |
| `--html PATH` | Write a self-contained HTML report. Refuses to overwrite a file |
| `--redact-values` | Leave keys and compared values out of the output |
| `--version` | Show the version |

| Exit status | Meaning |
| --- | --- |
| 0 | Verified |
| 1 | Mismatch |
| 3 | Unverified |
| 2 | Input refused, such as a malformed file or a missing column |
| 4 | Internal failure; nothing was concluded |

A refused check names the problem in one line. [When a check is refused](docs/guides/refusals.md) explains each message and what to do.

The two completeness flags matter. Without `--source-complete`, a batch cannot be Verified. Without `--destination-complete`, missing records and duplicates stay unknown. FlowAssert does not check these statements, so a wrong statement gives a wrong result. If you know the totals in the original systems, pass `--source-count` and `--destination-count` too: a total that differs from the file withdraws the matching statement. A matching total does not prove completeness.

Comparison is exact by default: spaces, case and phone formatting count as differences. A `--config` file can choose `trim`, `casefold`, `digits` or `date:FORMAT` for each field; rules are never inferred. Empty cells are Unverified, because a CSV cannot show why a value is empty. Full details are in [offline/README.md](offline/README.md).

## Read the source from Google Sheets

From 0.7.0, `flowassert-verify` can read the source rows itself from one range of a Google Sheets spreadsheet, instead of from a CSV file you exported. The destination is still a CSV export.

```sh
read -rs FLOWASSERT_SHEETS_TOKEN && export FLOWASSERT_SHEETS_TOKEN   # a read-only token, typed, not stored
flowassert-verify --source-sheet SPREADSHEET_ID --source-range 'Leads!A1:F' \
  --destination crm-export.csv --key lead_id --field phone --field email:hs_email
```

- **Read-only.** Three HTTPS `GET` requests and nothing else: Google Drive for the file's version before and after, and the Google Sheets API for the values. Certificates are always verified; there is no retry and no redirect.
- **The credential stays in the environment.** `FLOWASSERT_SHEETS_TOKEN` (an OAuth access token with the read-only scopes) or `FLOWASSERT_SHEETS_API_KEY` (an API key, for a sheet shared for viewing). It is never an option, never read from a file, and never printed or written into a report.
- **What it shows.** Which rows the range held when FlowAssert read it, with no export step that could cut them short or edit them, and whether the file's version was the same before and after the read. The report records the spreadsheet ID, the ranges asked for and returned, the time and the version, and has `schema_version` 2.
- **What it does not show.** That the range holds every record that should exist: `--source-complete` is still your statement, and without it the batch is never Verified. The same cell values give the same result as the same rows in a CSV file.
- **Not yet tried against Google.** It is tested against a local fake of the two endpoints only. The command line is the only part that reads sheets: the browser check, the Action and the n8n example make no request to Google.

[The Google Sheets guide](docs/guides/google-sheets.md) covers preparing the range, obtaining a read-only credential, one complete example and reading the result; [the design note](docs/connectors/google-sheets.md) has every detail and refusal.

## Check in your browser

The same check runs in the web UI, for people who do not use a terminal: open the **CSV check** page, choose the two
files, the key column, the fields and a rule for each, state what you know, and press Check. The result, the printed
summary and the JSON and HTML reports are the command line's, byte for byte, except that each premise's origin is
`browser form`.

**Your files stay on your computer.** They are read in the browser, in a Web Worker, and nothing is uploaded: from
choosing the files to downloading the reports, the page makes no network request. Nothing you choose or state is
stored; you choose the files and state the premises again at every check. Only the column and rule choices can be
saved, as a configuration file you download yourself. A report is kept in the browser only when you ask for it (see
below).

- **Online demo:** <https://sun-sh902.github.io/FlowAssert/>. Its Content Security Policy
  forbids every connection, and the pages that need the local Service say that they work only locally.
- **Locally:** `cd ui && npm ci && npm run dev`, then open <http://127.0.0.1:5183/#/check>. Sample files are on the page.

Differences from the command line:

| | Browser | Command line |
| --- | --- | --- |
| Date formats | `%Y %m %d %H %M %S %f %z %b %B %y %p %I %j %%` only; any other directive is refused as not supported in the browser | Every `strptime` directive |
| Python version differences | Follows Python 3.15: `%d` needs a year directive, `%z` may be absent from a value | Depends on the Python running it |
| Selection | Always a configuration: the report records `config_file_sha256`, `obligation.rules`, `obligation.scope` and both encodings | `--key`/`--field`, `--mapping` or `--config` |
| Options | Default limits (200 MiB, 1,000,000 rows), `--details problems`, no redaction | Every option |
| The same file twice | Refused when both choices have the same name, size, modification time and bytes; the browser does not reveal paths | Refused when the paths resolve to the same file |
| Memory | Each file is held in memory while it is read | The source is kept for the used columns; the destination is streamed |

The browser check is built from the same specification and is tested against the command line: every conformance case,
97 golden cases compared byte for byte, and random cases (0 differences in 10,000). It is a second implementation, so
a difference would be a bug; please report one.

### Saved reports and comparing two results

From 0.5.0 the **Saved reports** page (`#/check/reports`) keeps JSON reports in this browser, and compares two of them.

- **What is stored, and only when you ask.** After a check, "Keep this report in this browser" keeps that one JSON
  report. You can also import a JSON report written by the command line, the GitHub Action or n8n; a file that is not
  a valid FlowAssert report is refused and nothing is kept. A check stores nothing unless you press the button, every
  time; no setting turns saving on. The CSV files are never stored. A report holds the keys and compared values of
  its records (unless it was written with `--redact-values`).
- **Where.** In one IndexedDB database of the page's site, `flowassert-saved-reports`, in this browser profile.
  Anyone using this browser profile can read it. Nothing is uploaded: saving, importing, listing, comparing and
  deleting make no request.
- **Deleting.** Delete one report, or all of them with a confirmation; deleting all removes the database. Clearing
  the site's data in the browser removes it too.
- **Premises are never reused.** A saved report shows the premises that were stated for it, with their origin.
  Nothing from it fills in the CSV check: each check starts with nothing chosen or stated.
- **Comparing.** Two reports of the same obligation (key, fields, rules, scope and comparison) can be compared: which
  records became a problem, stopped being one or stayed one, which are only in one source, and what could not be
  matched by key. When the two reports state different premises, the page says so before any count, because a change
  may come from the premises and not from the data. A comparison says what each report recorded; it is not a new
  verdict. Redacted reports, reports of another obligation and the same report twice are refused.
  [Comparing two reports](docs/report-comparison.md) is the specification.
- **Not authenticated.** An imported report is not authenticated, and comparing two reports does not authenticate
  either of them. The page says so wherever it shows one.
- **The online demo.** Its site, `sun-sh902.github.io`, is shared by every GitHub Pages site of that GitHub account,
  so another of those sites could read the reports kept there. Saving works there, and the page says this. For
  reports you would not want another site to read, run the UI locally.

## Use in GitHub Actions

The repository is also a GitHub Action. It runs the offline check on two CSV files in your workflow, with the
runner's Python 3.9 or later, from the Action's own copy of `offline/`: nothing is installed or downloaded while it
runs. The step passes or fails on the result.

```yaml
name: Check the nightly export
on:
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - uses: Sun-sh902/FlowAssert@v0.4.0
        id: flowassert
        with:
          source: exports/source.csv
          destination: exports/destination.csv
          key: external_id
          fields: |
            phone
            email:hs_email
```

Each input is one `flowassert-verify` option, named the same without `--` (`fields` takes one `--field` per line);
an empty input leaves the option out, so the checker's own defaults and refusals apply. The full list is in
[action.yml](action.yml).

**The premises are left out on purpose.** `source-complete`, `destination-complete`, `source-count`,
`destination-count` and `allow-identical-content` are statements about your files that FlowAssert cannot check, so
none is assumed: add `source-complete: "true"` and the others only when they are true for every run. Without
`source-complete` the batch is never Verified. A boolean input accepts only `"true"` or `"false"`.

| Input | Default | Meaning |
| --- | --- | --- |
| `fail-on` | `not-verified` | `not-verified`: the step passes only on Verified. `mismatch`: it passes on Verified and Unverified and fails on Mismatch. A refused input or an internal failure (exit status 2 or 4) always fails the step |
| `show-records` | `"false"` | **Logs and job summaries are often public**, for example in a public repository. By default the step prints and summarizes the state, the counts, the premises and the limitations, and no key or field value. `"true"` also prints the checker's record lines, values included |
| `json`, `html` | empty | Write the JSON or HTML report to this new file. Reports hold keys and compared values unless `redact-values` is `"true"`, and are written only where you ask |

Outputs: `state` (`Verified`, `Mismatch`, `Unverified`, `refused` or `failed`), `exit-code`, and `json` and `html`
(the report paths, when written). The step's summary and reports say exactly what `flowassert-verify` says for the
same arguments. `.github/workflows/action-self-test.yml` runs the Action on Linux, macOS and Windows.

## Use in n8n

[examples/n8n/](examples/n8n/) is an n8n workflow that runs the check in a **Code node**, without the Execute Command
node (disabled by default from n8n 2.0 and not offered on n8n Cloud). The Code node holds the browser check packaged
as one script, so it gives the command line's result, summary and JSON report for the same files and premises; each
premise's `origin` is `n8n Code node`. The files' content stays in the n8n instance: the node makes no request and runs
no command. Every premise starts unstated in the node's configuration block. It was tested on a self-hosted n8n
2.46.4 only, not on n8n Cloud; the [example's README](examples/n8n/README.md) has the setup and what was found out
about the Code node.

The packaged script is `flowassert-check.js`, built with `cd ui && npm run build:lib` (CI builds it on every run, to
be attached to each release). It defines one global, `FlowAssert`, with `checkCsv` and `VERSION`, imports nothing and makes no request; other
JavaScript hosts can call it the same way (see `ui/src/offline/api.ts`).

## How verification works

### The four states

| State | Meaning | What to do |
| --- | --- | --- |
| Verified | Every required rule has enough evidence and passes | Inspect the evidence if needed |
| Mismatch | At least one required rule is demonstrably false | Investigate the discrepancy |
| Pending | No conclusion yet, within an explicit waiting window | Wait or observe again |
| Unverified | Evidence or configuration is not enough | Restore what is missing |

A record takes the first state that applies:

1. Any rule failed: **Mismatch**.
2. Every rule passed: **Verified**.
3. It may still resolve inside a valid window: **Pending**.
4. Otherwise: **Unverified**.

Pending is never success. Unverified is never a confirmed failure. A failed request is neither: it has no verdict at all.

### Record and batch results are separate

A batch can be less certain than its records. If every row verifies but the full source population is unknown, the batch is **Unverified**, because rows that were never listed cannot be ruled out. A batch with any Mismatch is a Mismatch.

### Rules

The pinned Evaluator (`service/vendor/model.py`) applies these rules:

| Rule | Passes when |
| --- | --- |
| `existence` | A reliable destination record carries the key |
| `uniqueness` | Exactly one record carries the key, with complete coverage |
| `phone` | The value is an exact string match |
| `existed_by_deadline` | Never: a current read cannot prove the past. Required unless policy explicitly turns it off |
| `workflow_execution` | Never: this approach holds no execution evidence. Required unless policy explicitly turns it off |

Every premise must be exactly true. A missing or malformed value never permits a conclusion. The premises cover source independence, inventory, rule approval, identity reliability, access, freshness, clock trust, pagination, and destination coverage.

The rules behave asymmetrically on purpose. One visible wrong value proves a Mismatch, even from a partial read. Proving that a record is absent or unique needs complete evidence.

| Change to a verified case | Result |
| --- | --- |
| Partial read, value equal | Unverified |
| Partial read, value differs | Mismatch |
| Absent after the deadline, complete coverage | Mismatch |
| Absent inside the window | Pending |
| Absent, but absence evidence unreliable | Unverified |
| Two records with the same key | Mismatch, and no record is picked to compare |
| Observation clock untrusted | Unverified |
| Rule not approved | Unverified |

### The five reviewed cases

| ID | Fixture | Rows | Batch result | Why |
| --- | --- | --- | --- | --- |
| `SPEC-001` | `A-verified` | 1 | Verified | All rules pass |
| `SPEC-002` | `B-mismatch` | 1 | Mismatch | Phone differs |
| `SPEC-003` | `C-pending` | 1 | Pending | Not yet visible, window open |
| `SPEC-004` | `D-unverified` | 1 | Unverified | Destination access denied |
| `SPEC-005` | `E-row-verified-cohort-unverified` | 12 | Unverified | 12 records Verified, source population unknown |

### What a Verified result claims

The narrow claim is: at the recorded observation, the destination evidence satisfies the configured rules for the declared source cohort.

It does not claim that n8n performed the write, that the source is true, that every real-world lead is listed, that semantic duplicates are absent, or that the destination stays correct afterward.

## Security model

The Service is built for a single user on a local machine.

| Control | What it does | What it does not do |
| --- | --- | --- |
| Loopback binding, Host and Origin checks | Limit browser DNS rebinding | Authenticate other local processes |
| API gate | Forwards exact GET routes only | Exist in a static build or production |
| Signed cursors | Stop forged pagination | Protect against someone holding the key |
| Pinned digests | Detect ordinary source changes | Stop someone who can edit code and pins |
| SQLite triggers and seals | Detect accidental change | Stop someone who can write the database; seals are unkeyed |
| Offline guard | Audits socket connections in Python | Provide operating-system isolation |

Do not expose the Service to a network or feed it real customer data. It has no authentication.

Repository history was scanned for common key formats before publication, and none were found. That is a pattern scan, not a security audit. Treat this code as unaudited.

## Known issues

| Issue | Detail |
| --- | --- |
| Completeness statements | The offline check does not verify `--source-complete` or `--destination-complete`. A wrong statement gives a wrong result. `--source-count` and `--destination-count` catch some wrong statements, but a matching count does not prove completeness. The same holds for the two statements in the browser check. With a Google Sheets source (`--source-sheet`) the limitation is narrower, not gone: no export step can cut the source rows short or edit them, but whether the range holds every record that should exist is still `--source-complete`, your statement. The destination is always an export |
| Google Sheets source | Tested against a local fake of Google's two endpoints only; not yet run against a real spreadsheet. Some statements about Google's behaviour rest on documentation that could not be read when it was written ([design note](docs/connectors/google-sheets.md#sources)). Command line only |
| Browser check | Supports fewer date directives than the command line, and follows Python 3.15 where Python versions differ. See [Check in your browser](#check-in-your-browser) |
| Saved reports | Kept in the browser profile, readable by anyone using it, and on the online demo by other GitHub Pages sites of the same account. Imported reports are not authenticated. See [Saved reports and comparing two results](#saved-reports-and-comparing-two-results) |
| n8n example | Tested on a self-hosted n8n 2.46.4 only, not on n8n Cloud. It reads files with the Read/Write Files node, which n8n restricts to `~/.n8n-files` by default |
| Evaluator status | The pinned version is labelled `Round03.5 research — unapproved` |
| P3A-AUD-001 | A legacy path such as `/api/v1/verifications/x%2Fevidence` can address the wrong resource. Use the query routes for unusual IDs |
| Archive seals | Unkeyed hashes. Anyone who can write the database can forge a consistent row |
| Browser test | One `e2e-lookup` failure on 2026-10-31 was never explained. It did not recur |
| Firefox | Not tested. A known harness defect is unfixed |
| Accessibility | Automated checks only; no screen-reader testing |
| Load | No load testing |
| `/docs` | FastAPI's docs page is enabled and loads assets from a CDN if opened |
| Old harness scripts | Some scripts in `ui/scripts/phase2` and `ui/scripts/phase3a` contain paths from the original machine |

`npm audit` and an OSV lookup of the Python lock file reported no known vulnerabilities on 2026-11-01.

## Questions

[Questions and answers](docs/faq.md): why a result is Unverified, whether FlowAssert can check that your files are complete, whether your files leave your computer, how it differs from a diff tool, and whether you can use it on real data.

## Development

The architecture, the backend and frontend, the tests, the repository layout, the project's history, how to extend it, and how to run the Service and UI locally are in [Development](docs/development.md).

## Glossary

| Term | Meaning |
| --- | --- |
| Owner | The person making product and acceptance decisions |
| Evaluator | The code that produces verdicts |
| Cohort | The batch of source records being checked |
| Source population | Everything that should be in the cohort |
| Snapshot | A fixed identity for a set of results |
| Run-bound | Tied to one local execution by a receipt |
| Custody | Evidence that protected files have not changed |
| Phase 3A, 3B | Local archive stage; planned evidence-capture stage |
| G1 | An implementation grant that was never issued |
| M1 | The Trusted Runner milestone, which remained blocked |
| R1–R3 | Recovery stages after the machine rebuild |

## Roadmap

The aim is to find out whether this is useful to people who maintain automations. There are no dates.

- Improve the offline CSV check using real feedback.
- Test the planned checks with read-only sandbox accounts. See the [validation plan](docs/product-dev/final-version/S1_VALIDATION_PLAN.md).
- Add explicit, reviewed comparison policies beyond exact match.
- Connect the Service to real sources only after that testing supports it.

## Contributing

Trial feedback, bug reports, examples of real verification problems and focused pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md) and the [security policy](SECURITY.md).

## License

License: [Apache 2.0](LICENSE).

Copyright 2026 The FlowAssert Authors. Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE).

HubSpot, n8n and Google Sheets are trademarks of their respective owners. This project is not affiliated with or endorsed by them.
