# FlowAssert — Product Understanding

Prepared 2026-10-16 for the first UI iteration. Source of truth: the research repository at
`/Users/zhangshenghe/Documents/FlowAssert-round03-oracle-fix`, inspected **read-only**.

| Reference | Value observed on 2026-10-16 |
| --- | --- |
| Branch | `fix/round03-5-review-fixes` |
| HEAD | `4deddb323ad0f1f00b2c369a7b141dc04c95f8fa` (matches the reported commit) |
| Working tree | **Not clean**: 10 modified + 4 untracked files under `experiments/` (Round03.5 v3 release-remediation work). These pre-existed this task and were left untouched. |

Paths below are relative to that repository.

## Labels used in this document

| Label | Meaning |
| --- | --- |
| **EXISTING IMPLEMENTATION** | Code that exists in the research repository today |
| **RESEARCH-VALIDATED** | Behaviour demonstrated by the synthetic suites (not by live systems) |
| **PROPOSED PRODUCT** | Described in product documents as a proposal; not built |
| **MOCKED FRONTEND** | Exists only in this UI as demo data or interaction |
| **NOT YET IMPLEMENTED** | Neither built nor validated anywhere |

---

## A. What FlowAssert actually does today

FlowAssert is an **offline research model**, not an application.

- **EXISTING IMPLEMENTATION** — `experiments/round03/model.py` exposes `evaluate(evidence)`: a
  pure-Python, standard-library function that takes one synthetic evidence document (an
  independently captured *source cohort*, a paginated *destination* read and a *policy*) and returns
  a cohort result with a state per source row and a cohort state. No network, clock, randomness or
  credentials are used.
- **EXISTING IMPLEMENTATION** — `experiments/round03/evidence_oracle.py`: a separately written
  sufficiency oracle with the same contract, used to cross-check the model.
- **EXISTING IMPLEMENTATION** — `experiments/round03_5_trust_hardening/ground_truth.py`: judges the
  model against hidden synthetic "worlds" (11 named, 119 typing, 500 seeded random cases).
- **EXISTING IMPLEMENTATION** — verification-artifact integrity, history pinning and a release
  protocol (`experiments/round03/verify_artifacts.py`, `history.py`,
  `experiments/round03_4_oracle_closeout/release_protocol/`).
- **RESEARCH-VALIDATED** — the upgraded legacy suite passes 92/92
  (`experiments/round03_5_trust_hardening/evidence/original/results.json`, `summary`). This holds
  only after `evidence_upgrade.py` adds premise records; raw legacy fixtures pass 47/92 by failing
  closed (Round03.5 README, "What the legacy pass counts do and do not show").
- **Release status** — blocked. Owner approval exists (`owner-approval.json`) but is explicitly
  *not* independent; `independent_approval` remains `PENDING_INDEPENDENT_REVIEW`, the prior
  independent review of `4deddb3` concluded REMEDIATION REQUIRED, and the current Oracle
  (`eeaae000…`) is unapproved (Round03.5 README, "Bounded v3 release remediation").

## B. What the proposed commercial product will do

**PROPOSED PRODUCT** (`PRODUCT_DEFINITION.md` §1, §4–5; Round03.5 scope note pending owner
confirmation): help automation developers confirm that leads synchronised by an **n8n** workflow
exist correctly in **HubSpot**, by comparing HubSpot with an **independently captured source
cohort** and presenting Verified / Mismatch / Pending / Unverified with traceable evidence.

Proposed v1 promise (`PRODUCT_DEFINITION.md` §4, `ROUND03_TRUST_MODEL_REPORT.md` §10):

> At the recorded observation, the available destination evidence satisfies the selected rules for
> the declared, independently captured source cohort. Coverage gaps and unassessed rules are shown
> explicitly. This does not establish workflow execution.

Target users (hypothesis, no interviews conducted): independent automation developers and small
studios maintaining n8n workflows for clients (`PRODUCT_DEFINITION.md` §2).

## C. Capabilities that exist in research code

| Capability | Where | Label |
| --- | --- | --- |
| Four-state per-row verdict with fixed precedence | `model.py` `state()` | EXISTING / RESEARCH-VALIDATED |
| Cohort verdict incl. population completeness | `model.py` end of `evaluate()` | EXISTING / RESEARCH-VALIDATED |
| Existence, exact-string phone and key-uniqueness rules | `model.py` record loop | EXISTING |
| Optional `existed_by_deadline` and `workflow_execution` rules (always *unknown* when required) | `model.py` | EXISTING |
| Fail-closed premise records (provenance, inventory, approval, query total, clock trust) | `model.py` docstring, `VERIFICATION_PRINCIPLES.md` §3a | EXISTING (Round03.5) |
| Pagination chain validation; conflicting-ID detection | `model.py` | EXISTING |
| Bounded Pending (deadline + `retry_viable`) | `model.py` `window` / `can_wait` | EXISTING |
| Independent oracle and ground-truth suites | `evidence_oracle.py`, `ground_truth.py` | EXISTING |

## D. Capabilities that do NOT exist

**NOT YET IMPLEMENTED** anywhere: live n8n integration; live HubSpot integration; any source
connector; authenticated acquisition (signed exports, independent count endpoints); backend API;
persistence/database; authentication; scheduling of observations; notifications; multi-tenant
administration; rule editor; field comparisons other than exact-string phone; real wall-clock
timestamps (the model uses integer ticks). No UI existed before this workspace.

## E. Verification states (exact semantics)

Per row (`model.py` `state(rules, can_wait)`), evaluated in this order:

1. any required rule `fail` → **Mismatch**
2. else all rules `pass` (and at least one rule) → **Verified**
3. else `can_wait` → **Pending**
4. else → **Unverified**

`can_wait` requires: valid source/rule basis, a valid expected value, account/object binding,
`now < deadline`, `retry_viable is True`, destination access not `denied`, no conflicting IDs, and
**neither** `require_historical_deadline` nor `require_execution` (those rules can never pass from a
present read, so they forbid Pending and Verified).

Per cohort (`model.py` end of `evaluate()`):

1. any row Mismatch → **Mismatch**
2. else population unknown **or** no rows → **Unverified**
3. else every row Verified → **Verified**
4. else any row Unverified → **Unverified**
5. else → **Pending**

Population is "known" only when `source.complete is True`, the source basis is valid, the
independent inventory record matches the captured rows (count and key-set digest), and every key is
a unique non-blank string. Hence **every row can be Verified while the cohort is Unverified**, and
`expected_total` is then `null` ("Total expected records unknown"). Empty cohorts are Unverified by
explicit policy (README "Empty cohorts yield Unverified").

Rule statuses are `pass` / `fail` / `unknown`, each with a `reason` string.

## F. Important evidence fields (model output)

`cohort_state`, `counts`, `records[]` (`key`, `source_row`, `state`, `candidate_ids`, `rules{}`),
`expected_total`, `source_rows_observed`, `source_population_known`,
`destination_coverage_sufficient`, `source_basis_sha256`, `rule_basis_sha256`, `observed_at`,
`deadline`, `business_obligation_at` (= source capture tick), `evaluation_at`,
`observation_time_valid`, `destination_page_sequence_valid`, `destination_page_sequence_reason`,
`premise_evidence{source_provenance_record, source_inventory_record, rule_approval_record,
destination_query_total_consistent, observation_clock_trusted}`, and the fixed disclaimers
`workflow_execution: "Not assessed"`, `business_truth: "Not assessed"`,
`absence_cause: "Not inferred"`.

Relevant input fields: `policy.{version, comparison, deadline, max_age, retry_viable,
settling_allowed, account, object, identity_reliable}`, `source.{namespace, captured_at, rows,
provenance, inventory}`, `destination.{account, object, access, observed_at, query_total, pages}`.

## G. Business entities

| Entity | Research basis | Label |
| --- | --- | --- |
| Verification run (one cohort evaluation) | one `evaluate()` call | EXISTING concept |
| Record result (one source row) | `records[]` | EXISTING |
| Rule outcome | `records[].rules{}` | EXISTING |
| Source cohort (captured, versioned) | `source` input | EXISTING (synthetic) |
| Destination observation | `destination` input | EXISTING (synthetic) |
| Policy / rule version + approval | `policy` input | EXISTING (synthetic) |
| Workflow (n8n) | product docs only | PROPOSED |
| Connection (source / HubSpot) | product docs only | PROPOSED |
| Human acknowledgement, recheck history | `VERIFICATION_PRINCIPLES.md` §7, fixtures E5-acknowledgment/E5-recheck | PROPOSED UI; model treats them as not changing state |

## H. Current data and result structures

See `docs/RESEARCH_TO_FRONTEND_MAPPING.md` for the field-by-field mapping, and
`src/research/types.ts` for the TypeScript mirror of the `evaluate()` output.

## I. Limitations that the UI must carry

1. **Forged but consistent evidence still yields Verified** (Round03.5 README, ground-truth cases
   `GT-L1-forged-consistent-*`). "Verified" = consistent with supplied evidence records, not
   authenticated.
2. Premise records are inputs; the model cannot authenticate acquisition.
3. A present read cannot establish historical delivery by a deadline or workflow execution.
4. Duplicate detection is limited to the configured key and declared scope.
5. Only exact-string comparison is supported; unsupported types stay *unknown*, never pass.
6. Everything is synthetic; no live API behaviour (pagination, latency, permissions) is validated.
7. The research recommendation is **REVISE; hold production development**
   (`ROUND03_TRUST_MODEL_REPORT.md` §11).

## J. Proposed frontend-to-backend boundary

**PROPOSED, not existing.** A future backend would run the evaluator and return a payload shaped
like `evaluate()` output, wrapped in a run envelope (run id, workflow, connections, wall-clock
mapping). The UI consumes only view models produced by `src/adapters/`. Illustrative future reads:

```
GET /v1/runs?workflow=&state=           (PROPOSED)
GET /v1/runs/{runId}                    (PROPOSED) -> envelope + evaluate() output
```

No such service exists. In this iteration the adapter is fed by local demo fixtures in `src/mocks/`.
