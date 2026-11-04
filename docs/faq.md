# Questions and answers

English | [简体中文](faq.zh-CN.md)

- [Why is my result Unverified?](#why-is-my-result-unverified)
- [Can FlowAssert check that my files are complete?](#can-flowassert-check-that-my-files-are-complete)
- [Do my files leave my computer?](#do-my-files-leave-my-computer)
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

Totals help a little. If you pass the total your system shows (`--source-count`, `--destination-count`, or the two totals on the page) and it differs from the rows in the file, the matching statement is withdrawn. A total that matches does not prove that the file is complete.

## Do my files leave my computer?

No.

- **The command line** reads local files and makes no network request.
- **The browser check** reads the files in the browser, in a Web Worker. From choosing the files to downloading the reports it makes no request, and the online demo's Content Security Policy forbids every connection. Nothing you choose or state is stored, unless you press **Keep this report in this browser**, which keeps that one report in this browser profile (see [Saved reports](../README.md#saved-reports-and-comparing-two-results)).
- **The GitHub Action** runs on your workflow's runner and downloads nothing. Its log and job summary show no key or value unless you set `show-records`.
- **The n8n example** runs in your n8n instance; the Code node makes no request.

The **Give feedback** links on the CSV check and saved reports pages open GitHub in a new tab only when you press them, and carry nothing from the page.

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
