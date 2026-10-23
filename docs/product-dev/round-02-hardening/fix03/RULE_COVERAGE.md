# FIX03 — Rule coverage

**Status: DRAFT.**

## The five rule categories of the accepted Evaluator

From the pinned `service/vendor/model.py` (sha256 `b61779e1…a842d`, identity check PASS) and the Service's wire model
`service/app/models.py:81-87` (`RuleMap`, `extra='forbid'`):

| Rule key | Always present | Statuses produced | Evaluator source |
| --- | --- | --- | --- |
| `existence` | yes | pass · fail · unknown | `model.py:183-241` |
| `phone` | yes | pass · fail · unknown (with `expected`/`actual` when compared) | `model.py:183-244` |
| `uniqueness` | yes | pass · fail · unknown | `model.py:183-226` |
| `existed_by_deadline` | only when `policy.require_historical_deadline` is not `false` | unknown ("current read cannot reconstruct historical deadline") | `model.py:112, 245-246` |
| `workflow_execution` | only when `policy.require_execution` is not `false` | unknown ("Approach B contains no execution evidence") | `model.py:113, 247-248` |

There is no email rule in the Evaluator. Email exists only as a MOCK "proposed rule" (`adapters/researchToView.ts:43`),
and FIX03 adds no rule.

## What the Service actually returns today

All five reviewed fixtures set both policy flags to `false`. Every record of SPEC-001…005 carries exactly
`existence`, `phone` and `uniqueness` (`evidence/service-probe/rules_probe.json`). The two optional rules are therefore
never in current Service output, but the Evaluator produces them for any input whose policy doesn't switch them off.

## Genuine Evaluator output with the optional rules enabled

`evidence/evaluator/optional_rules.py` runs the pinned Evaluator in-process, read-only, on reviewed fixture `A-verified`
with the flags set to `true`. Output: `evidence/evaluator/optional_rules.json`. Every case returns a record with state
`Unverified` and cohort `Unverified`, where existence, phone and uniqueness pass and `existed_by_deadline` and/or
`workflow_execution` are `unknown`.

| UI surface (203f702) | What a reader saw for that record |
| --- | --- |
| Comparison sheet rows | three "holds" rows: existence, uniqueness, phone. **The rule that made the record Unverified was not shown.** |
| Record summary | "Available evidence is insufficient to reach Verified or Mismatch." |
| Reason-string disclosure (collapsed) | `rules.existed_by_deadline.unknown "…"`, with "3 of 4 passed" counting a rule the sheet hides |

After FIX03 (`fix03.test.tsx` F-02 #1–2):

| UI surface | Shown |
| --- | --- |
| Comparison sheet | the three rows, plus "Existed by deadline · historical read" and/or "Workflow execution · execution evidence". Source cell: "required by policy"; operator `?` "not assessed"; HubSpot cell "not assessed"; note quotes the Evaluator reason. |
| Record summary | "The contact exists, but this rule could not be assessed: Existed by deadline." |
| Disclosure | unchanged ("3 of 4 passed" now matches the rows) |

`recordIssue` remains "Insufficient evidence" for this record, which is true. The record state, cohort and counts are
read from the Evaluator; React computes none of them.

## The phone claim in `recordSummary`

`evidence/evaluator/phone_unknown.json` is the pinned Evaluator's output for `A-verified` with an incomplete destination
read and the HubSpot phone withheld: existence `pass`, phone `unknown`, uniqueness `unknown`, state `Unverified`. On
`203f702` the summary read *"The contact exists and its phone matches, …"*. It now reads *"The contact exists, but these
rules could not be assessed: One contact per source key, Phone matches source."* (F-02 #3). For the reviewed fixtures
every summary is unchanged (F-02 #4: SPEC-001 "All 3 required rules passed at this observation.").
