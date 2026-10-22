# Research → Frontend Mapping

```
model.py evaluate() output  ─┐
(src/research/types.ts)       ├─►  src/adapters/researchToView.ts  ─►  view models  ─►  components
Proposed run envelope        ─┘    (only module reading both)          (src/domain/view.ts)
(src/mocks/types.ts)
```

Legend: **R** = exists in research output · **RI** = research *input* field ·
**P** = proposed / frontend-only · **D** = derived by the adapter from R/RI only (no evaluation).

## Run level (`RunView`)

| View field | Source | Kind |
| --- | --- | --- |
| `state` | `cohort_state` | R |
| `counts` | `counts` | R |
| `recordsEvaluated` | `len(records)` = `source_rows_observed` | R |
| `expectedTotal` | `expected_total` (null when population unknown) | R |
| `populationKnown` | `source_population_known` | R |
| `recordsNotFullyAssessed` | count of `records[]` with any rule `status == "unknown"` | D (v0.2) |
| `coverageSufficient` | `destination_coverage_sufficient` | R |
| `premises[]` | `premise_evidence.*` + `observation_time_valid` | R |
| `notEstablished[]` | `workflow_execution`, `business_truth`, `absence_cause` (verbatim) + authenticity limitation (Round03.5 README) + `policy.require_historical_deadline` | R / RI |
| `capturedAt`, `observedAt`, `evaluatedAt`, `deadline` | `business_obligation_at`, `observed_at`, `evaluation_at`, `deadline` (integer ticks) mapped through envelope `tick_origin_iso` + `tick_seconds` | R ticks → **P** wall clock |
| `windowOpen` | `evaluation_at < deadline` ∧ `policy.retry_viable` ∧ `destination.access ≠ denied` (the `window` term in model.py) | D from R/RI |
| `accessDenied` | `destination.access` | RI |
| `headline`, `explanation`, `reasons`, `nextStep`, `issueBreakdown` | Selected from state, counts and rule statuses | D (copy) |
| `technical[]` | policy/source/destination inputs, digests, page-sequence result | R / RI |
| `id`, `workflow`, `previousRunId` | Run envelope | **P** |
| `source_basis_sha256`, `rule_basis_sha256` values | Demo placeholders (not hashes) | **P** — shape is R |

## Record level (`RecordView`)

| View field | Source | Kind |
| --- | --- | --- |
| `key`, `sourceRow`, `state`, `candidateIds` | `records[].key / source_row / state / candidate_ids` | R |
| `rules[].status`, `rules[].reasonRaw` | `records[].rules[name].status / reason` | R |
| `rules[].explanation` | Plain-language text keyed by the exact reason string | D (copy) |
| `fields[]` (phone) | `rules.phone.expected / actual` | R |
| `fields[]` (email) | `rules.email.expected / actual` | **P** — proposed second field rule, same exact-string semantics |
| `displayName`, `company` | Envelope source rows | **P** (research rows contain only `key`, `phone`) |
| `issue`, `summary` | From rule statuses | D (copy) |

## Rule names

| Research rule | UI label | Notes |
| --- | --- | --- |
| `existence` | Record exists in HubSpot | R |
| `uniqueness` | One contact per source key | R; pass requires complete destination coverage |
| `phone` | Phone matches source | R; exact string |
| `email` | Email matches source | **P**, tagged "Proposed rule" in the UI |
| `existed_by_deadline` | Existed by deadline | R; always `unknown` when required. Demo policies set it `false`, so it is absent and shown under "does not establish" |
| `workflow_execution` | Workflow execution | R; same treatment |

## State semantics preserved

- Record precedence and cohort aggregation are restated **verbatim** in
  `src/research/semantics.ts` and used only to keep demo data consistent
  (`src/mocks/validate.ts` runs at dev startup and blocks rendering on any inconsistency).
- Pending fixtures satisfy every `can_wait` condition; access-denied fixtures are never Pending.
- A run with every record Verified but no inventory record is cohort **Unverified** with
  `expected_total = null` (VR-2023).
- Mismatch records still list rules that were not assessed.

## Demo scenarios ↔ research cases

| Run | Situation | Research analogue |
| --- | --- | --- |
| VR-2025 | 2 phone differences, 1 absent after deadline, 1 duplicate key | E1-independent, E2-three-missing, E3-confirmed-duplicates |
| VR-2026 | 4 rows absent inside open window | E5-pending-missing / E5-retry-pending |
| VR-2023 | All rows pass, no inventory | E2-unknown-source-total |
| VR-2022 | Destination access denied | E4-access-denied, E5-denied-no-pending |
| VR-2016 | Provider total ≠ returned rows (uniqueness unassessed → 17 Unverified) plus one phone formatting difference (Mismatch) | E4-duplicates-partial, E3-leading-zero (no hidden normalisation) |
| VR-2017 | Email empty in destination | E5-empty-distinct |
| VR-2015 | One key absent after the deadline with complete coverage | E2-three-missing |

## Proposed future interface (NOT existing)

```ts
// PROPOSED — no such service exists.
GET /v1/runs?workflow=<id>&state=<state>  -> { runs: RunEnvelope[] }       // without records
GET /v1/runs/<runId>                       -> RunEnvelope                   // with evaluate() output
type RunEnvelope = DemoRunEnvelope (src/mocks/types.ts)
```

Replacing `src/data/store.ts` with a client for such an endpoint would leave components unchanged.
