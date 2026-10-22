# Information Architecture

## Navigation (first iteration)

| Item | Status | Purpose |
| --- | --- | --- |
| Overview | Implemented | What needs attention, per-workflow state, recent runs, record-state trend |
| Verifications | Implemented (lightweight) | Every verification run, filterable by state and searchable |
| Verification detail | Implemented (contextual, `#/verifications/:runId`) | The evidence inspection screen for one run and its records |
| Connections | Demo (Phase 2) | Independent source, n8n workflow under test, HubSpot destination — roles, permissions, configuration preview. Nothing connected |
| Rules | Demo (Phase 2) | Rule register (research-supported / proposed / draft), rule detail, policy preview, local draft editor |
| Settings | Demo (Phase 2) | Theme, display, accessibility, demo configuration; account & security listed as future |

Phase 2 replaced the earlier "not available" notices. The three pages sit under a "Configure · demo"
group in the rail. Nothing pretends to work: no authorisation, no request, no evaluation. See
`docs/PHASE2_UI.md`.

## Review of the proposed structure

1. **Keep "Verifications" as a list of runs, not records.** The research unit of evaluation is the
   cohort run (`evaluate()`), and cohort state can differ from row states. Records are inspected
   inside their run so this context is never lost.
2. **Recommendation: model Connections as two distinct roles — Source and Destination.** Source
   independence is the central trust premise (`VERIFICATION_PRINCIPLES.md` §3a); a single generic
   "connections" list would hide which side is the comparison basis.
3. **Recommendation: Rules should show version + approval binding**, because a rule is only usable
   when its approval record binds the exact version and comparison (`model.py`
   `rule_approval_valid`). A relaxed rule must never appear to repair a past mismatch.
4. **No separate "Workflows" page yet.** The Overview's workflow summary covers it; add a page only
   when there is per-workflow configuration to show.
5. **Acknowledgement / recheck** belong on the detail page in a later iteration and must not change
   state (`USER_EXPERIENCE.md` §4).

## Primary journeys covered

1. *Daily check* — Overview → attention list → detail (≤ 2 clicks to the failing rule).
2. *Investigate a mismatch* — detail → record list filtered to Mismatch → rule + field comparison.
3. *Understand uncertainty* — detail of an Unverified run → which premise or coverage check failed
   and what would restore it.
4. *Waiting* — Pending run → deadline, remaining window, what a later observation could change.

## Detail page structure (progressive disclosure)

1. Verdict header: run ID, workflow, source → destination, cohort state, one-sentence explanation.
2. Cohort facts: records evaluated, state counts, population completeness, timing.
3. Records table (filter + search) with a selected-record inspector:
   rule outcomes → field comparison → candidate destination IDs.
4. Evidence support: premise checks, destination coverage, observation timing.
5. "What this does not establish" — fixed disclaimers from the model output.
6. Evidence timeline.
7. Technical metadata (collapsed): basis digests, policy, page-sequence result, raw tick values.
