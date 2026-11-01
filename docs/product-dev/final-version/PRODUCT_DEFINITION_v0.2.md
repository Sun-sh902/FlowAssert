# FlowAssert Product Definition v0.2

2026-11-01. Supersedes `FlowAssert/PRODUCT_DEFINITION.md` v0.1 for final-version work, under [OWNER_DECISIONS_20261101.md](OWNER_DECISIONS_20261101.md). The v0.1 file is unchanged. Sections not restated here still apply: target users, core problem, experience standards, and success criteria. `VERIFICATION_PRINCIPLES.md` also still applies.

Status: working definition. The target user remains a hypothesis, and every feasibility item below is unvalidated until S1.

## What changed from v0.1

| Topic | v0.1 | v0.2 |
| --- | --- | --- |
| Expected data | Reported by n8n | Read independently from a named Google Sheets tab |
| Claim | Destination verified against workflow-reported expectations | Destination verified against an independently read source cohort |
| n8n | Supplies expectations | Not connected in the first version. A workflow name is context only |
| Fields | Selected fields | Selected scalar fields under approved exact rules |
| Delivery | Undecided | Self-hosted, single user |

## First-version claim

> At the recorded observation, the destination evidence satisfies the configured rules for the declared source cohort.

FlowAssert does not claim that n8n performed the write, that the source is factually correct, that every real-world lead is in the sheet, that semantic duplicates are absent, that the record existed by a past deadline, or that the destination stays correct afterward.

## Supported scenario

- One Google Sheets tab holding one bounded cohort with stable source keys.
- One HubSpot account, Contacts object only.
- A source key stored in a HubSpot property configured as unique. This is an onboarding requirement.
- Selected ordinary scalar fields. Sensitive properties and associations are excluded.
- Manual and scheduled verification, and rechecks that create a new observation.

## Obligation type

v0.2 adds one obligation: **current state at observation**. A policy of this type states that its required rules are existence, uniqueness within the key, and the selected field comparisons. `existed_by_deadline` and `workflow_execution` are outside that obligation because the policy says so, in a versioned, approved record. They are not switched off to reach Verified, and reports show them as not assessed.

## Result semantics

Verified, Mismatch, Pending and Unverified, their precedence, and the separation of record and cohort results do not change. A cohort cannot be Verified with an unknown source population.

## Out of scope

CRM writes, workflow editing, n8n credentials, other CRMs and objects, multi-tenancy, billing, AI verdicts, and any claim of attested capture.

## Stop or narrow

- If unique-property reads cannot support absence, drop the missing-record conclusion and report those records as Unverified.
- If target users refuse the required access, or their current checks are good enough, stop.
