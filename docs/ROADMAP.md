# FlowAssert roadmap (after 0.1.0)

Drawn up on 2026-11-02, updated on 2026-11-04 after 0.6.0 was released, with the plan for 0.7.0 and the connectors after it added on 2026-11-05, changed on 2026-11-06 to find users first and decide on 0.8.0 afterwards, updated on 2026-11-11 after 1.0.0 was released, and with the plan after 1.0.0 written in on 2026-11-12, the same day the owner decided to build 1.1.0 first. This is a plan, not a promise: it is adjusted after every release, according to the feedback.

## 1. Where things stand

| Item | State |
| --- | --- |
| Released | 0.1.1 to 0.6.0 (2026-11-02 to 11-04), 1.0.0 (2026-11-11); 0.7.0 was not released on its own and was folded into 1.0.0 |
| Connectors | The command line can read a Google Sheets source and a HubSpot contacts destination, read-only; both have been tested only against local fakes, not yet on real accounts |
| Offline CSV check | The command line can be installed; it supports UTF-8, UTF-16, GB18030 and comparison rules; there is a specification, JSON Schemas and a runnable conformance suite, and the browser version and the command line agree byte for byte |
| Browser version | Online demo at https://sun-sh902.github.io/FlowAssert/ ; files are not uploaded; large files are read as streams; choosing a file shows its profile, with warnings before the check; results can be browsed record by record, with character differences marked; reports can be saved and compared |
| Workflows | GitHub Action; n8n example (tested only on a self-hosted n8n 2.46.4, not on n8n Cloud) |
| Service | Local and read-only, handles only 5 synthetic cases |
| Tests and CI | 3712 frontend, 1095 command-line and 80 Chrome tests in CI; 8 CI jobs, plus the Action's self-test on 3 operating systems; release files carry build provenance attestations |
| Users | As of 2026-11-12: 2 stars, 0 forks, 8 unique visitors in two weeks, at most 1 outside download of the release files; the first outside trial feedback, [#2](https://github.com/Sun-sh902/FlowAssert/issues/2) (2026-11-07, from the n8n forum), whose suggestion was implemented in 1.0.0; no known long-term user yet |
| Feedback channels | Trial feedback form (one in Chinese and one in English, labelled `feedback` automatically), the "Give feedback" link on the page, GitHub Discussions |

Figures at 0.1.0 (for comparison): UTF-8 and exact comparison only; 200,000 rows in about 1.3 seconds with a peak memory of about 630 MB; 1,000,000 rows in about 7 seconds and about 3 GB; about 1830 frontend tests and about 340 browser tests.

Outside facts that shape the plan (checked on 2026-11-02):

- Python 3.9 and 3.10 are no longer maintained, but the Python that comes with macOS is still 3.9.
- n8n's Execute Command node cannot be used on n8n Cloud, and is disabled by default from n8n 2.0.
- n8n has its own Compare Datasets node, which gives four kinds of result: "In A only", "In B only", "Same" and "Different".

## 2. Position: how FlowAssert differs from an ordinary comparison tool

An ordinary comparison tool answers "where do the two sets of data differ". FlowAssert answers "is there enough evidence for this result". Every later feature must serve that:

1. **Tell a mismatch from a lack of evidence.** Not finding a record is not the same as the record being missing.
2. **Premises must be stated.** Whether the source is complete and whether the export is complete are written into the report.
3. **No picking among duplicates.** When one key has several records, none is chosen at random to compare.
4. **The batch and the records are separate.** Every record can pass and the batch still be Unverified.
5. **Reports can be kept.** With file digests, the time and the rules used, a result can be reviewed later.

A feature that would weaken these principles is not built.

## 3. Known problems and how they are handled

Confirmed on 2026-11-02 by code review and by measurement.

### Problem 1: two files with exactly the same content are refused

`cli.py` refuses outright when the two files have the same SHA-256. The aim is to stop a file being checked against itself, but two systems that legitimately export exactly the same content are refused too.

**Plan:** The same path is still refused. When the content is the same, the check is refused by default, with the reason; once the user confirms that the two files really come from different systems, `--allow-identical-content` lets it continue. The report records that the content was the same and that it was confirmed. **In 0.1.1.**

### Problem 2: a file cannot be proved genuine or complete

Completeness is stated by the user with `--source-complete` and `--destination-complete`, and the tool does not verify it. A wrong statement can still give Verified. This is a fundamental limit of an offline check, and code alone cannot remove it.

**Plan:**

1. **Numbers that can be cross-checked:** new `--source-count N` and `--destination-count N`, for the totals seen in the original system; when the row count differs, Verified is not given. **0.2.0**
2. **The report states the statements:** a Verified result reads "Verified under the premises you stated", and lists every statement and where it came from. The HTML report puts this where it is seen first. **0.2.0**
3. **Reading directly:** a read-only connector reads the data itself, removing the step where an export could be cut short or changed. **From 0.7.0, starting with a Google Sheets source.** But it cannot prove that the sheet range holds every record that should be there, so `--source-complete` stays the user's statement.

This limit is written in the README's "Known issues". Connectors can only narrow it, not remove it.

### Problem 3: data handling is simple, and large files use a lot of memory

Exact comparison only; the whole file is read into memory, with no size limit. The measured peak memory is about 68 times the file size.

**Plan:**

| Task | Version |
| --- | --- |
| Default limits, such as 200 MB or 1,000,000 rows, refused clearly beyond them, adjusted with `--max-rows` | 0.1.1 |
| Keep only the columns used; a Verified record keeps only a summary in the report, and `--details all` keeps every detail | 0.2.0 |
| Explicit comparison rules: trim spaces, ignore case, compare digits only; dates compared after parsing with a format the user gives | 0.2.0 |
| Index the destination file row by row instead of reading it whole | 0.2.0 |
| A large-file performance test in CI, with a target peak memory under 500 MB for 1,000,000 rows | 0.2.0 |

Every rule must be chosen explicitly; the default stays exact comparison.

### Problem 4: extra records in the destination are not checked

The check now looks up the source records one by one, so extra records in the destination are not found. This is the direction of the design, but the case "both sides must agree" needs support.

**Plan:** a new `--scope`:

| Value | Meaning |
| --- | --- |
| `source` (default) | As now: only the records in the source are checked |
| `exact` | The destination should hold no record outside the source. Only when the destination is stated complete is an extra record a mismatch; otherwise it is listed without a conclusion |

The report gains a "destination-only" kind, counted separately. **In 0.2.0.**

## 4. Version plan

Estimates assume 3–5 hours a week, and are all rough.

### The road ahead (2026-11-12)

1.0.0 has been released, but there is only one piece of outside trial feedback, and the features already far outnumber the users. **The bottleneck now is users, not features.** On 2026-11-12 the owner decided to build 1.1.0 first; its four highlights all aim to make it easier for people to start using it: checking Excel files directly, exporting a list of records to resend, an n8n community node, and scheduled checks in the Action. Finding users goes on at the same time as 1.1.0.

| Stage | When | What | What counts as done |
| --- | --- | --- | --- |
| 1. Release 1.0.0 | 2026-11-11 (done) | 0.7.0's Google Sheets source and the HubSpot destination, streaming, the new browser experience, the specification and build provenance, released together | The release files can be checked with `gh attestation verify` |
| 2. 1.1.0 | November to December | See "The four highlights of 1.1.0" below | The results of every existing case are unchanged; each of the four highlights has tests and documents in Chinese and English |
| 3. Find users with 1.0.0 and 1.1.0 | Mid-November to the end of December | 1.0.0 fits the most common case of n8n users: a Google Sheets list of the records there should be, checked against the destination system. Following section 6: post the 1.0 announcement, submit the n8n template, follow up on #2; when talking with people trying it, use the 7 interview questions of the S1 validation plan. Apart from 1.1.0, start no new feature, and fix only the problems people trying it run into | At least 1 or 2 people have run it on their own case and said where they got stuck |
| 1.0.x fixes | When there is time | See "1.0.x fixes" below; no new features | Every fix has tests, and the results of existing cases are unchanged |
| 4. Decide from the feedback | Early January 2027 | See the decision points in section 10: if people use it and the need is clear, build 1.2 for that need; if there is feedback but the need is not on the roadmap, first discuss it fully in an Issue; if there is no feedback, the project enters maintenance, and the README says so | The decision points of section 10 |

Maintenance is not a failure: the project has complete tests, documents and an online demo, and can be kept as a portfolio piece for the long term. It can also be paused at any time during exams.

### 1.0.x fixes (no new features)

| Item | Notes |
| --- | --- |
| Checks on real accounts | When the owner has test accounts, run `scripts/dev/sheets_live_check.md` and `scripts/dev/hubspot_live_check.md`, fix whatever does not match, and change the wording "tested only against local fakes" |
| Singular and plural in the command line's summary | The summary has wording such as "1 pages"; [compatibility](compatibility.md) lists the summary's wording as unchanged within 1.x, so it has to wait for 2.0; meanwhile it is written down under known issues |
| Memory used by the result explorer | After a check, the worker holds about 130 MiB more for the result explorer (two files of a million rows); consider releasing it when the result is left |
| Layout matrix | Cannot be run without Python 3.14 on this machine; run it once a 3.14 environment is added |

### The four highlights of 1.1.0 (decided on 2026-11-12)

| Highlight | What | What is kept |
| --- | --- | --- |
| Checking Excel files directly | The command line, the browser and the Action can all read one worksheet of an `.xlsx` file, without converting it to CSV first | Standard library only; no network; the two implementations agree byte for byte; the value a cell stores is read, not its displayed format, and the report says so |
| Exporting a list of records to resend | After a check, export three CSV files: the source rows the destination definitely does not have, the source rows whose values differ, and the source rows whose state cannot be determined; and, besides, the records that are extra in the destination | Exporting changes no conclusion, report or exit status; the rows that "cannot be determined" are kept apart, with a note that resending them directly may create duplicates |
| An n8n community node | `n8n-nodes-flowassert`: a node found and installed by searching inside n8n, holding the packaged checker | No network, no credential; the owner publishes it with their own npm account; the existing Code node example stays for n8n Cloud users |
| Scheduled checks and a run summary in the Action | The Action supports a Google Sheets source, a HubSpot destination and Excel files, with credentials in secrets; the run page gets a summary of the result; an example workflow for scheduled checks is included | By default the summary holds no value; every run is a new observation and changes no earlier report |

Not in 1.1.0: other connectors (such as Airtable or Salesforce), considered only when a user asks for one.

### 0.1.1 Fixes and foundations (about 6 hours, aiming for November)

| Task | Where |
| --- | --- |
| A column name can contain a colon, given through a mapping file | `offline/flowassert_offline/cli.py` |
| Files with the same content: refused by default, may continue after confirmation (problem 1) | Same |
| Limits on file size and row count (problem 3) | Same |
| When the output is too long, show only the first N problems, set with `--max-details` | Same |
| A clear Python support policy: 3.11+ officially supported, 3.9 on a best-effort basis (it comes with macOS) | `offline/pyproject.toml`, CI |
| Shared conformance test cases, as groundwork for a later browser port | `offline/conformance/*.json` |
| A tutorial in Chinese and English, "Export a CSV and run a first check" | `docs/guides/` |

Acceptance: a new user can run their own files by following the tutorial within 10 minutes; CI covers 3.9, 3.11 and 3.14; a clear reason for the refusal is given when a limit is exceeded.

### 0.2.0 Configuration, comparison rules and trustworthiness (about 30 hours, aiming for December to January)

| Task | Notes |
| --- | --- |
| Configuration file `flowassert.json` | Write the key, fields and rules once, instead of typing a long command every time |
| Explicit comparison rules | Exact (the default), trim leading and trailing spaces, ignore case, compare digits only. Chosen for each field separately |
| The report records the rules | Keeps both the original and the processed values, and says which rule was used |
| File encodings | `--encoding` supports UTF-8, UTF-16 and GB18030, for Excel and Chinese users |
| Report format version | The JSON gains `schema_version`, with a format document, `docs/report-format.md` |
| HTML report | A standalone HTML file that people who do not read code can also read |
| Cross-checking totals and explaining statements | `--source-count`, `--destination-count`, and the report lists each statement (problem 2) |
| Memory optimisation | Keep only the columns used, slim reports, index row by row (problem 3) |
| Checking both directions | `--scope exact` and a "destination-only" kind (problem 4) |

Acceptance: every rule has tests on both sides, passing and failing; the same input and rules always give the same result; the default behaviour is exactly that of 0.1; peak memory for 1,000,000 rows within 500 MB.

### 0.3.0 Checking in the browser (about 30–40 hours, aiming for February to March)

This is the most important release: it lets people who do not use a command line use it directly.

| Task | Notes |
| --- | --- |
| Port Evaluator v2 to TypeScript | In `ui/src/offline/` |
| Conformance tests | Python and TypeScript run the same cases, and the results must be identical |
| A new "CSV check" page | Choose two files, map the columns, choose the rules, and get the result directly in the browser, reusing the existing four states and evidence components |
| Export reports | Export JSON and HTML in the same format as the command line |
| Online demo | Deployed to GitHub Pages, with example files |

Acceptance:

- The check sends no network request, and the files never leave the computer, as browser tests prove.
- Every conformance test of the two implementations passes.
- Usable in Chinese and English and at phone width.
- In the online demo, pages that depend on the Service are clearly marked "local only".

### 0.4.0 Fitting into workflows (about 15 hours, aiming for April)

| Task | Notes |
| --- | --- |
| GitHub Action | Check CSV files in a repository or a scheduled job, with the exit status deciding success or failure |
| n8n example | No Execute Command; instead, the packaged JavaScript checker used in a Code node |

Acceptance: the Action runs in an example repository. The n8n example must first be tried on a local self-hosted n8n; I have not yet verified the Code node's limits.

### 0.5.0 History and changes (about 20 hours, aiming for May)

| Task | Notes |
| --- | --- |
| Local history | The browser keeps past reports, without uploading them |
| Comparing two results | Shows newly appeared problems and problems that have gone. The old report stays unchanged; the new result is a new observation |

Acceptance: a comparison is made only when the key and the rules are the same; otherwise it says they cannot be compared.

### 0.6.0 Ease of use and documents (released, 2026-11-04)

This release was not in the original plan. After 0.5.0 was released there were still no users, so, following the decision point in section 10, ease of use and the documents were improved first. It added no checking ability; every result, report and exit status is unchanged.

| Task | Notes |
| --- | --- |
| Explaining the result | "What this result means", explained from the report's content alone |
| Refusal hints | When a file is refused, suggest likely causes, such as the encoding or the delimiter; only suggest, never change anything for the user |
| Chinese explanations | In the Chinese interface, the English report text is paired with a Chinese explanation, and the English original is kept |
| Synthetic scenarios | 4 sets of example files, each saying which result to expect under which statements |
| Documents | The README rewritten; the development document, the FAQ and the refusal guide each a separate document |
| Feedback | A trial feedback form, and a "Give feedback" link on the page |

### 0.7.0 A read-only Google Sheets source (not released on its own, folded into 1.0.0)

This release was brought forward by the owner's decision on 2026-11-05, without waiting for the decision point of section 10 in 2027-01, and before the user interviews of the S1 validation plan were done.

| Task | Notes |
| --- | --- |
| Reading the source | Command line `--source-sheet`, `--source-range`; only GET requests, only read-only permissions requested, the credential read only from an environment variable |
| Bounded and reproducible | The range must name the tab and the columns; the Drive revision is read once before and once after the data, and the read is refused if the sheet changed in between |
| Report | `schema_version` 2, recording the sheet, the range, the time and the revision read; the browser can open and compare such reports, and never contacts Google itself |
| Tests | All against a local fake API, never a real account |

Not done yet: the owner running `scripts/dev/sheets_live_check.md` once with a test account, checking each statement marked [doc] and [unconfirmed] in the design note one by one, and fixing in 1.0.x whatever does not match. Before applying for an account, check the terms of service first.

### 0.8.0 A read-only HubSpot contacts destination (already done in 1.0.0)

The original preconditions were that 0.7.0 had been verified on a real account and that at least one person trying it needed HubSpot. On 2026-11-09 the owner decided not to wait for those two preconditions and built it into 1.0.0: command line `--destination-hubspot contacts`, only GET requests, tested only against a local fake.

Answers T1 to T6 and T8 of the [S1 validation plan](https://github.com/Sun-sh902/FlowAssert/blob/v1.1.0/docs/product-dev/final-version/S1_VALIDATION_PLAN.md): the minimal read-only permission, whether reading by a unique property can show "does not exist" credibly, how long after a record is created it can be read, and how rate limits and errors map to results. A delay in reading may give "Pending" its first real use.

The check on a real account has not been done yet (`scripts/dev/hubspot_live_check.md`). If a credible "does not exist" cannot be read, the scope narrows as the product definition says: every missing record is Unverified.

### 0.9.0 Fitting into workflows

| Task | Notes |
| --- | --- |
| A sheet source in the Action | Credentials in the repository's secrets, passed only through environment variables |
| Scheduled repeated checks | Every run is a new observation, and changes no old report |

The precondition is that both 0.7.0 and 0.8.0 have been verified on real test accounts.

### Not for now

- Connectors in the browser: they would break the promise that "files never leave the computer and no network request is sent".
- An OAuth sign-in built into the tool: first find out whether users really get stuck at preparing a token.
- Service v2: the browser version is already enough, so it is cancelled following section 10.
- Accounts, statistics and tracking.

## 5. What 1.0 promises, and what 1.x still has to reach

The 1.0 conditions written originally were five. When 1.0.0 was released (2026-11-11), only two of them were met: the report format is stable with a promise of compatibility, and the conformance tests of the browser version and the command line pass in CI. The owner decided to release 1.0.0 anyway, turned the other three into goals for 1.x, and said in the release notes that they were not met.

**What 1.0.0 promises:**

- The report format is fixed by [the specification](spec/verification.md) and [the JSON Schemas](schema/), compatible within 1.x ([compatibility](compatibility.md))
- The conformance suite can be run against any implementation ([conformance](conformance.md))
- Every release file has a build provenance attestation ([verify a release](verify-a-release.md))

**The goals of 1.x (none met when 1.0.0 was released):**

- At least 3 outside users using it, with a record of their feedback
- At least one read-only connector verified on a test account, so that the export step no longer rests only on the user's statement
- One code review by a third party or the community

## 6. Users and community (alongside development)

| When | What |
| --- | --- |
| Done | GitHub Discussions opened, with a welcome post; a trial feedback form (Chinese and English) and a `feedback` label; an online demo and synthetic scenarios |
| Done | On 2026-11-04, an invitation to try it posted in English on the n8n community forum |
| Done | On 2026-11-09, a reply to the first outside trial feedback, #2, with the suggestion to be built in 1.0.0; on 2026-11-11, told its author that the online demo had been updated |
| Mid-November | Post the 1.0 announcement: a follow-up under the original post on the n8n forum, and one post each on Reddit r/n8n and V2EX; the owner posts two videos on Bilibili and Douyin. Each with the online demo link and the synthetic scenarios |
| Mid-November | Submit the workflow of `examples/n8n` to n8n's official template library |
| November to December | Follow up with the author of #2; find 3 people willing to try it and write down where they get stuck. Ask them to try the synthetic scenarios and fill in the feedback form; where a conversation is possible, use the 7 interview questions of the S1 validation plan |
| Every release | The release notes say clearly what changed and what is still missing |

Only GitHub's own figures (visitors, stars, Issues) are looked at; no statistics or tracking are added to the tool.

## 7. Maintenance rhythm

| Item | How often |
| --- | --- |
| Look at Issues, PRs and discussions | Once a week |
| Release a version | When there are changes, about once a month |
| Dependency security check | Once a month |
| Watch for changes to GitHub's runner images (the Python 3.9 jobs broke once when ubuntu-latest became 26.04) | Once a month, and at once when CI fails |
| Update this roadmap | After every release |

Exams and holidays affect progress. A delay is fine; do not skip tests to keep to a schedule.

## 8. Risks and how they are met

| Risk | Response |
| --- | --- |
| The Python and browser implementations give different results | Shared conformance tests; no release while they differ |
| More and more features | One theme per release; a new idea is first written down as an Issue |
| Wording that overstates what it can do | A check before each release: every claim must be backed by code or a test |
| Real data leaking | Processing in the browser, never uploaded; examples use synthetic data only |
| Relying too much on AI to write the code | You must be able to explain every change clearly, and it must have tests |
| Not keeping it going | Release in small steps; it can be paused at any time, with its state written in the README |

## 9. Not for now

- AI judging results: it conflicts with the principle of "conclusions from evidence only"
- Statistics and tracking
- Accounts, multiple users and charging
- The original Phase 3B approval process and the Trusted Runner (M1)

## 10. Decision points

| When | Question | Outcome |
| --- | --- | --- |
| 2 months after 0.3.0 is released | Are there at least 3 outside users | Yes: continue with 0.4 and the connectors; no: first improve ease of use and the documents, then look for users |
| After 0.5.0 | Does the browser version already meet the need | Yes: cancel Service v2; no: plan Service v2 |
| Around early 2027-01 | Is anyone using it, and what do they need | People are using it and the need is clear: build 1.2 for that need; there is feedback but the need is not on the roadmap: first discuss it fully in an Issue, then decide the version; no feedback: the project enters maintenance, and the README says so |
