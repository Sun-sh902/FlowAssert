# Conformance cases

Each `*.json` file here is one synthetic case for Evaluator v2 (`offline/flowassert_offline/evaluator_v2.py`). Any other implementation, such as a future browser version, must give the `expected` result for every case. `scripts/dev/tests/test_offline_verify.py` runs them all.

A case is a JSON object with exactly these members:

| Member | Meaning |
| --- | --- |
| `name` | Unique case name, the same as the file name without `.json` |
| `description` | What the case shows |
| `obligation` | What is checked (see below) |
| `source_rows`, `destination_rows` | Arrays of objects, column name to string value. A missing column reads as no value |
| `premises` | What the caller states (see below) |
| `expected` | `cohort_state`, `record_states` (one state per source row, in order) and `expected_total` (`null` when the source population is unknown) |

`obligation` members:

| Member | Meaning |
| --- | --- |
| `key` | `[source column, destination column]` |
| `fields` | Array of `[source column, destination column]` or `[source column, destination column, rule]`. The rule is `exact` (the default), `trim`, `casefold`, `digits` or `date:FORMAT`, where `FORMAT` is a Python `datetime.strptime` format |
| `scope` | Optional: `source` (the default) or `exact` |

`premises` members, all optional:

| Member | Meaning |
| --- | --- |
| `source_complete`, `destination_complete` | Only `true` states the premise; any other value, such as `"yes"` or `1`, does not |
| `source_count`, `destination_count` | A non-negative integer: the total the caller saw in the original system. It is compared with the number of rows supplied |

The members added in 0.2.0 are the rule in `fields`, `scope`, `source_count` and `destination_count`. Cases written before 0.2.0 use none of them and are unchanged.

The 0.2.0 cases are `rule-*` (each rule passing, failing and unknown), `*count*` (stated counts that match and do not match), and `scope-*`. The case format has no member for destination-only records, so a `scope-exact-*` case shows their effect through `cohort_state`; their details are tested in `test_offline_verify.py`.
