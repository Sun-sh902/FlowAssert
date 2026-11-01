# Owner decisions: final-version plan

Recorded 2026-11-01 from the conversation with the Owner. Conversational instruction, not a signed grant.

## Source

The plan ended with six decisions and asked whether to proceed from S0, offering two answers: proceed, or adjust the decisions first. The Owner replied:

> 按方案推进

This record reads that reply as selecting the plan's recommendation for each decision below. The Owner did not restate them one by one. If that reading is wrong, the Owner corrects it here and the affected stage stops.

## Decisions

| Ref | Decision | Selected | Prior record affected |
| --- | --- | --- | --- |
| FV-01 | Product direction | Approach B: independent Google Sheets source against HubSpot Contacts. See [PRODUCT_DEFINITION_v0.2.md](PRODUCT_DEFINITION_v0.2.md) | `PRODUCT_DEFINITION.md` v0.1 |
| FV-02 | Evaluator semantics | Allow an Evaluator v2 and a new obligation type. Evaluator v1 stays frozen | D12 |
| FV-03 | Stage order | Run the S1 sandbox validation before capture-only implementation | D20 |
| FV-04 | D21, M1 and R3 | No longer prerequisites for the first version. They move to post-release hardening | D21 |
| FV-05 | `phase3b/sprint-1` | Experimental branch. See below | None |
| FV-06 | P3A-AUD-001 | New code uses query-addressed IDs only. The finding is reassessed before any external connection | D14 |

The earlier records stay unchanged as history. This file is an overlay on them, as `DECISION_REGISTER_CLOSEOUT.md` was on the original register.

## Not authorized

- Any real account, credential, provider request, or customer data. Each needs a separate Owner instruction naming the account and scope.
- Writes to the six protected roots or to Sol.
- Deletion of M1, R3, or Phase 3B-1 materials. They are retained, only deferred.
- Any claim of external data authenticity.

FV-04 is a trade-off, not a proven safety result: it is based on sandboxes holding only synthetic data under read-only credentials.

## `phase3b/sprint-1`

The branch adds a local execution collector, receipts, and admission statuses on commits `0da7d9d` to `fa808d4`. No G1 grant exists, and the Phase 3B-1 records state that no P1 permission was issued. No record was found that authorized this work as Phase 3B-1.

It is therefore classified as **experimental local development**:

- It is not an implementation of Phase 3B-1 P1, and no 3B-1 milestone is satisfied by it.
- `CAPTURED_COMPLETE` and `ADMITTED_RUN_BOUND` remain local checks only.
- The branch has no Owner Acceptance and no independent review.
- It stays unmerged into `main`. Final-version work continues from it on new branches, because S2 reuses its code.

## Backup

`FlowAssert-Active/BACKUPS-20261101/FlowAssert-Phase3B-Dev-fa808d4.bundle`, all 8 refs. SHA-256 `b705f7c69ed759e91c282a6fb933f41769f5de1b2840685977cc6ea410cd2209`.

Restored into a temporary copy on 2026-11-01: bundle verified, fsck clean, all refs equal, 1122 tracked files equal. It holds Git history only, not `service/.runtime/`, `.dev-runtime/` or dependencies. It is on the same disk as the source, so it does not yet protect against disk loss.
