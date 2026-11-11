# Questions and answers

English | [简体中文](faq.zh-CN.md)

- [Why is my result Unverified?](#why-is-my-result-unverified)
- [Can FlowAssert check that my files are complete?](#can-flowassert-check-that-my-files-are-complete)
- [Do my files leave my computer?](#do-my-files-leave-my-computer)
- [Does FlowAssert still need `--source-complete` when it reads my sheet?](#does-flowassert-still-need---source-complete-when-it-reads-my-sheet)
- [Does FlowAssert change my sheet?](#does-flowassert-change-my-sheet)
- [Does reading HubSpot show that my contacts are all there?](#does-reading-hubspot-show-that-my-contacts-are-all-there)
- [Can I trust a download of FlowAssert?](#can-i-trust-a-download-of-flowassert)
- [How is this different from a diff tool?](#how-is-this-different-from-a-diff-tool)
- [Can I use it on real data?](#can-i-use-it-on-real-data)

## Why is my result Unverified?

Unverified means that no rule was shown to be false, but the evidence is not enough to say Verified. The printed summary names the reasons that apply, and the CSV check page explains each one under **What this result means**. The usual ones:

- **The source file is not stated to be the whole batch** (`--source-complete`, or *The source file is the whole batch* on the page). Without that statement, records that belong to the batch but are not in the file cannot be ruled out, so the batch is never Verified, even when every record in the file passes.
- **The destination export is not stated to cover the whole object** (`--destination-complete`). Without it, a record that is not found is not called missing, and a record found once is not called unique.
- **The files contradict a statement**: a total you stated differs from the rows in the file, a source key is empty or repeated, or destination rows have an empty key.
- **A value cannot be compared**: it is empty, or the rule cannot read it, such as a value without digits under `digits`, or a date that does not match its format.

The statements are yours to make, and only when you know they are true. FlowAssert cannot check them. A statement made because a Verified result is wanted makes the result wrong, not more certain. To find out whether a statement is true, compare the file with the system it came from: for example, the number of rows in the file with the total the system shows for that batch.

## Can FlowAssert check that my files are complete?

No. A CSV file cannot show what was left out when it was exported: a filter, a row limit, one page of results or an interrupted export all give a file that looks whole. FlowAssert has no connection to your systems, so it cannot compare the file with them. That is why completeness is a statement you make, recorded in the report with where it was made.

From 0.7.0 the command line can read the source from a Google Sheets range itself, which removes the export step for the source. It still cannot show that the range holds every record that should exist: see [the next questions](#does-flowassert-still-need---source-complete-when-it-reads-my-sheet).

Totals help a little. If you pass the total your system shows (`--source-count`, `--destination-count`, or the two totals on the page) and it differs from the rows in the file, the matching statement is withdrawn. A total that matches does not prove that the file is complete.

## Do my files leave my computer?

No.

- **The command line** reads local files and makes no network request, unless you give it `--source-sheet`: then it reads that one range of your Google Sheets spreadsheet with three read-only `GET` requests to Google, and sends Google nothing of your files ([the Google Sheets guide](guides/google-sheets.md)). With `--destination-hubspot contacts` it lists your HubSpot contacts with read-only `GET` requests, asking only for the properties you named, and sends HubSpot nothing of your source file ([the design note](connectors/hubspot.md)).
- **The browser check** reads the files in the browser, in Web Workers, as streams; the file profile, the result explorer and the character diff run there too. From choosing the files to downloading the reports it makes no request, and the online demo's Content Security Policy forbids every connection. Nothing you choose or state is stored, unless you press **Keep this report in this browser**, which keeps that one report in this browser profile (see [Saved reports](../README.md#saved-reports-and-comparing-two-results)).
- **The GitHub Action** runs on your workflow's runner and downloads nothing. Its log and job summary show no key or value unless you set `show-records`.
- **The n8n example** runs in your n8n instance; the Code node makes no request.

The **Give feedback** links on the CSV check and saved reports pages open GitHub in a new tab only when you press them, and carry nothing from the page.

## Does FlowAssert still need `--source-complete` when it reads my sheet?

Yes. Reading the sheet shows which rows the range held when FlowAssert read it, and that no export cut them short or edited them on the way. It cannot show that the range holds every record that should exist: a record that was never entered, a row outside the range, or a filter applied before the rows were copied into the sheet all leave a range that looks whole. Whether the range is the whole batch is a statement only you can make, so without `--source-complete` the batch is never Verified, exactly as for a file. The report records the statement as a premise FlowAssert does not verify.

The same cell values give the same result as the same rows in a CSV file: reading the sheet removes one step you had to trust, and does not make a result more Verified. `--source-count` helps in the same way as for a file.

## Does FlowAssert change my sheet?

No. FlowAssert sends only three HTTPS `GET` requests: two to Google Drive for the file's version (`www.googleapis.com/drive/v3/files/...`, fields `version` and `modifiedTime`), and one to the Google Sheets API for the values of the range (`sheets.googleapis.com/v4/spreadsheets/.../values/...`). How that is enforced:

- The code sends no other method and no request body, and connects only to those two hosts, over TLS with the certificate verified. It follows no redirect and retries nothing. Tests record every request it makes, against a local fake of the two endpoints, and fail on any other method, host or path.
- You give it a read-only credential: a token with only `spreadsheets.readonly` and `drive.metadata.readonly`, or an API key for a sheet shared for viewing. Even a credential that could write is used only for those `GET` requests.
- The credential stays in the environment variable you set; FlowAssert never writes it anywhere.

Only the command line reads sheets. The browser check, the GitHub Action and the n8n example make no request to Google.

## Does reading HubSpot show that my contacts are all there?

No. With `--destination-hubspot contacts`, FlowAssert lists the contacts itself, page by page, so no export step could filter them or cut them short. That shows which contacts the API listed to your token at that time. It does not show that the object is complete: contacts the token cannot see are not listed, a contact changed during the read may be missed, and archived contacts are not read. Whether the records cover the whole object is still your statement, `--destination-complete`, with the same meaning as for an export, and the report says that the read does not show completeness. The same records give the same result as the same rows in a CSV file.

FlowAssert only reads: `GET` requests to one documented endpoint, with a token that should have the scope `crm.objects.contacts.read` and nothing else. It has been tested against a local fake of that endpoint, not yet against a HubSpot account.

## Can I trust a download of FlowAssert?

From the first release made by the release workflow, you can check where a download came from. Each file comes with `SHA256SUMS` and a GitHub build provenance attestation, and `gh attestation verify` shows that the file was built by this repository's release workflow, from the tagged commit, on a GitHub-hosted runner ([Verify a release](verify-a-release.md)). That does not show that the code is correct or that anyone reviewed it. No release carries an attestation yet.

## How is this different from a diff tool?

A diff tool answers "where do these two files differ?". FlowAssert answers "is there enough evidence for this result?":

1. **It tells a mismatch from missing evidence.** A record that is not found is missing only when the export is stated to cover the whole object; otherwise it is Unverified.
2. **Its premises are explicit.** Whether the source and the export are complete is stated, never assumed, and written into the report.
3. **It does not pick among duplicates.** When two destination rows carry one key, it does not choose one to compare.
4. **The batch and the records are separate.** Every record can pass and the batch still be Unverified.
5. **The report can be read again later.** It keeps the files' digests, the time and the rules.

It also compares under rules you choose, such as `trim`, `casefold`, `digits` or a date format, and never infers one.

## Can I use it on real data?

Yes, on your own computer. The command line, the browser check, the GitHub Action and the n8n example all leave the files where they are, and the online demo reads files in your browser without uploading them.

One caution concerns saved reports on the online demo. Its site, `sun-sh902.github.io`, is shared by every GitHub Pages site of that GitHub account, so another of those sites could read a report you keep there. A report holds the keys and compared values of its records, unless it was written with `--redact-values`. For reports you would not want another site to read, run the UI locally (`cd ui && npm ci && npm run dev`), or download the report instead of keeping it.

FlowAssert is early-stage software with one maintainer and no security audit: read [Known issues](../README.md#known-issues) first. The Service and its pages take only the five reviewed synthetic cases and are not meant for real data.
