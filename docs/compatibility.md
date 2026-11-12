# Compatibility in 1.x

This page says what stays the same in every FlowAssert release from 1.0.0 until 2.0.0, what may change, how something
is retired, and what a program that reads a report must do with one it does not know.

It is a promise made in good faith by a project with one maintainer. It is not a contract, and it comes with no
support commitment. Where a release breaks it, that is a defect: please report it.

- [What 1.x covers](#what-1x-covers)
- [What is stable](#what-is-stable)
- [What may change](#what-may-change)
- [How additions are made](#how-additions-are-made)
- [Deprecation](#deprecation)
- [What a reader must do](#what-a-reader-must-do)
- [What would need 2.0](#what-would-need-20)

## What 1.x covers

The command `flowassert-verify`, the CSV check of the web UI, the packaged JavaScript checker (`checkCsv` in
`flowassert-check.js`) and the GitHub Action, in every release numbered 1.0.0 or later and below 2.0.0.

It does not cover the local Service and its workspace pages, which handle five synthetic cases and are a prototype.

## What is stable

| Stable | Where it is defined |
| --- | --- |
| **The verdict.** The same inputs, options and premises give the same records, rule results, counts, cohort state and exit status | [The specification](spec/verification.md), sections 4 to 9 |
| **The report format.** For each `schema_version`, every member, its type and its meaning. A `schema_version` is never changed after it is released: no member of it is removed or renamed, and none changes meaning | [Report format](report-format.md), [the JSON Schemas](schema/) |
| **The JSON text**: UTF-8, members sorted with `schema_version` first, two-space indentation, characters outside ASCII escaped | The specification, R10.10 |
| **The exit statuses**: 0 Verified, 1 Mismatch, 3 Unverified, 2 refused, 4 internal failure | The specification, section 13 |
| **The options** of `flowassert-verify`: each name, what it takes, what it means and its default | `flowassert-verify --help`, the README |
| **The defaults**: 209,715,200 bytes and 1,000,000 rows per file, 50 record lines in the summary, details `problems`, encoding `utf-8`, scope `source` | The specification, sections 3 and 11 |
| **The refusal texts** | The specification, section 12; for a connector, its design note |
| **The printed summary**: its lines, their order and their wording | The specification, section 11 |
| **The configuration and mapping files**: their members | The specification, section 2 |
| **The rules** `exact`, `trim`, `casefold`, `digits` and `date:FORMAT`, and the scopes `source` and `exact` | The specification, sections 5 and 9 |
| **`checkCsv`**: the members of its argument and of its result, and the global name `FlowAssert` | The README, "Use the check from JavaScript" |
| **The GitHub Action**: its inputs and outputs | `action.yml` |
| **The evaluator name** `v2-current-state-1` for this behaviour | The report's `evaluator` member |

Two limits on "the same verdict", both stated in section 15 of the specification: `casefold`, the whitespace of `trim`
and of an empty key follow the Unicode version of the Python that runs the check, and `date:FORMAT` follows that
Python's `strptime`. A value that uses a character or a date form on which Python versions differ can compare
differently on two of them. The golden cases use none.

## What may change

In any 1.x release, without notice beyond the changelog:

- **The HTML report's markup and look.** It is for people. It always shows the result the JSON report holds, escapes
  every value, has no script and loads nothing; its bytes are not stable.
- The web UI: its layout, its interface text, and everything it shows beside a result ("What this
  result means", the file profile, the warnings before a check, the explorer, the character highlighting, the refusal
  hints). None of these is in a report.
- The text of a usage error from the argument parser, and the operating system's part of a refusal.
- The Python modules under `flowassert_offline` and the TypeScript modules under `ui/src/offline`: they are not a
  programming interface. The command and `checkCsv` are.
- Speed and memory use.
- The n8n example workflow, the scenarios and the example files.
- The local Service, its API and its pages.

## How additions are made

A 1.x release may add:

- **a member to a report**, without a new `schema_version`, when no existing member changes. It is described in
  [Report format](report-format.md), the schema and the changelog, and a reader ignores it until it knows it;
- **a `schema_version`**, when a report of a new kind gives existing members another meaning, as version 2 did for a
  Google Sheets source and version 3 for a HubSpot destination. Reports of the existing kinds keep their version and
  their bytes;
- **an option**, whose absence leaves every existing command as it was;
- **a refusal**, for an input that an added option makes possible, or for an input that was wrongly accepted and
  could give a result without enough evidence. The second is a correction, and the changelog says so;
- **a value of `origin`** in a premise, for a new way of stating one.

A rule, a scope, a record state or a rule status is not added in 1.x: a reader depends on the full set.

## Deprecation

Nothing listed under [What is stable](#what-is-stable) is removed in 1.x.

When an option, a default or a report member is to be retired in 2.0:

1. A 1.x release marks it **deprecated** in the changelog, in the README or [Report format](report-format.md), and,
   for an option, in `--help`.
2. It keeps working exactly as before in every later 1.x release. No warning is printed, so the output of an existing
   command does not change.
3. 2.0 is not released until at least **six months** and at least **two releases** after that notice.
4. A report member is retired only with a new `schema_version`. A 2.x reader still reads the versions of 1.x, or says
   plainly that it does not.

## What a reader must do

A program that reads a FlowAssert report:

- **MUST read `schema_version` first**, and MUST refuse a report whose version it does not know, or that has none. It
  says which version it found and which it reads. It MUST NOT read the report as the nearest version it knows: a new
  version exists because a member means something else.
- **MUST ignore a member it does not know** in a version it knows, and MUST NOT fail because of it.
- **MUST treat an unknown premise** as a statement FlowAssert did not verify, and an unknown `origin` as a text to
  show.
- **MUST NOT read a refusal's or a reason's text to decide a result.** The result is `cohort_state`, each record's
  `state` and each rule's `status`.
- **MUST NOT treat a report as authenticated.** Its digests show which bytes were read, not who wrote the report.

The web UI's saved-report pages follow these rules ([Comparing two reports](report-comparison.md)).

## What would need 2.0

Removing or renaming an option; changing a default or an exit status; changing the wording of a refusal or of a
summary line; a rule, a scope or a state added or removed; a change to what a verdict is for the same input. None of
these is planned.
