# Comparing two reports

From 0.5.0 the web UI can compare two saved [JSON reports](report-format.md) of the same obligation: which records
became a problem, which stopped being one, which stayed one, and what else the two reports record differently. This
page is the specification of `compareReports` in `ui/src/offline/compare.ts`. The shared cases in
`ui/src/test/offline/comparison-cases/` test it.

A comparison is a view of two observations, not a new verdict. It reads the two reports and nothing else: no row is
evaluated again, no record's state is changed, and neither report is modified. It says what each report recorded under
the premises each one states. It never says that a problem was fixed, that data improved, or that a record is correct;
it says, for example, "Verified in the later report". Neither report is authenticated, and comparing them does not
authenticate them.

## Reading the two reports

Each report is read as `ui/src/offline/savedReport.ts` reads any report, and refused if it is not valid:

- `schema_version` must be `1`, and every member [the format](report-format.md) lists must be present, with the
  right type. Members the format does not list are ignored. Both `details` levels and redacted reports are read.
- A duplicate member is refused, as the command line refuses one in a configuration file.
- A file over 200 MiB (the default `--max-bytes`) is refused before it is read.
- A report whose own numbers contradict each other is refused, naming the check that failed:
  `counts` that do not add up to `source_rows_observed` or do not match the records' states; `counts.Pending` other
  than 0; a record state outside `Verified`, `Mismatch`, `Pending`, `Unverified`, or one its rule results contradict;
  records that are not one per source row in file order; a `cohort_state` its counts contradict; a `cohort_state` of
  Verified with a `claim` of `null`, or a claim with other words; `destination_only_counts` that do not match
  `destination_only`; `expected_total`, `source_population_known` or `destination_coverage_sufficient` that the stated
  premises and counts contradict; inputs that disagree with the premises; and `evaluator`, `limitations`,
  `workflow_execution`, `business_truth`, `existed_by_deadline` or `acquisition_authenticity` with another value
  than every report carries.

The original bytes are kept unchanged. What the page shows and what a comparison uses come from the parsed report;
downloading a saved report gives back its original bytes.

A report is **redacted** when a record key or a destination-only key is `[redacted]`, the value `--redact-values`
writes. A report with no records and no destination-only records cannot be told apart from an unredacted one, and has
nothing to redact.

## Which report is earlier

The two reports are compared in the order given: an earlier and a later one. The page orders them by `evaluated_at`,
earlier first, and the person can swap them. The comparison says whether the order agrees with the two times:

| `order` | Meaning |
| --- | --- |
| `chronological` | The earlier report's `evaluated_at` is before the later one's |
| `reversed` | The person swapped them: the report compared as earlier was evaluated after the other |
| `same-time` | Both have the same `evaluated_at` |

Times are compared as instants: `2026-11-02T08:15:30Z` is before `2026-11-02T08:15:30.000001Z`.

## Not comparable

Two reports are refused, with every reason that applies, and nothing else is given — no counts and no partial
comparison — when:

| Reason | When |
| --- | --- |
| `different-key` | `obligation.key` differs |
| `different-fields` | `obligation.fields` differs, as an ordered list of pairs. The same fields in another order are another obligation |
| `different-rules` | The fields are the same and the rules differ |
| `different-scope` | The scope differs |
| `different-comparison` | `obligation.comparison` differs |
| `redacted` | Either report is redacted: its keys are `[redacted]`, so no record can be matched |
| `same-report` | Both have the same `source_sha256`, `destination_sha256`, `premises` (every member, including `observed` and `matched`) and `evaluated_at`: the same report twice, even if one has `details all` |

The rules and the scope are compared as they apply. A report without `obligation.rules` compares every field with
`exact`, and one without `obligation.scope` has scope `source`. So a command-line report written without `--config`
and a report of the CSV check page, which always records its rules and scope, are of the same obligation when they
check the same key and fields exactly with scope `source`.

## Matching records

Records are matched by key, the source key the report records. A key is matched only when it is on exactly one record
in each report where it appears. Nothing is guessed for the others, which are listed as **not matched**, with the
report, the key, the row and the reason:

| Reason | When |
| --- | --- |
| `no-key` | The record's key is `null` (empty in the source) |
| `repeated-key` | The key is on more than one record of either report. Every record with that key, in both reports, is not matched, with the number of records carrying it in each report |

## Classes

Each matched key is in one class. A record is a problem when its state is not Verified: Mismatch or Unverified.

| Class | Earlier report | Later report |
| --- | --- | --- |
| `became-problem` | Verified | Not Verified |
| `stopped-problem` | Not Verified | Verified |
| `still-problem` | Not Verified | Not Verified. Both states are given, and may differ, such as Mismatch then Unverified |
| `still-verified` | Verified | Verified |
| `only-earlier` | Any state | No record with this key, in the earlier source only |
| `only-later` | No record with this key | Any state, in the later source only |

A class is a list of records. It is never a score or a trend, and a class name does not say why a state changed: a
change can come from the data, from the premises, or from both.

For a key in both reports, the comparison also gives each rule result that differs (status, reason, rule, expected,
actual or the normalized values) with both sides, and `candidates` when the two numbers differ. With `details problems`,
a Verified record has only `key`, `source_row` and `state`: for a pair with such a record only the states are compared,
the rule-level changes are `null`, and `ruleLevelUnavailable` counts these pairs. The page says that rule-level changes
are not available for them.

With scope `exact`, destination-only records are compared by key in the same way. They are never Verified, so a key in
both reports is `still-problem` (with both states, such as Unverified then Mismatch once the source population is
known), and the others are `only-earlier` or `only-later`. Each destination-only key is listed once in a report.

## Other facts

Each fact is what the two reports record, side by side:

- the two cohort states, the counts and, with scope `exact`, the destination-only counts;
- `source_rows_observed`, and whether `source_population_known` and `destination_coverage_sufficient` changed;
- every premise whose stated value or origin differs, in name order, including a premise present in one report only
  (such as `allow_identical_content`). A count is compared by its stated number; `observed` and `matched` are
  observations of the files, not statements;
- whether the source file's digest and the destination file's digest changed;
- the `details` level of each report.

When the premises differ, the page says so first, before any count, because a change may come from the premises and
not from the data. When neither digest changed and the premises are the same, the comparison says that the two reports
describe the same files under the same premises (`sameFilesSamePremises`).

## Shared cases

`ui/scripts/offline/comparison_cases.py` writes the cases: two reports each, either a golden case's report
(`{"golden": NAME}`) or one the command-line checker writes from synthetic files, and the expected comparison, written
by hand in the script. `--check` exits 1 when the files are not what the script writes now. The cases cover every
class, every reason a pair is not comparable, both reasons a record is not matched, and premises whose stated value
differs, whose origin differs, or that are present in one report only.
