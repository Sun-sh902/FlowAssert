# S1 validation plan

Prepared 2026-11-01. **Not started.** Nothing here has contacted a provider. The technical spike needs a separate Owner instruction, see [OWNER_DECISIONS_20261101.md](OWNER_DECISIONS_20261101.md).

S1 answers two questions before any core rewrite: do target users want this, and can read-only access support the claims in [PRODUCT_DEFINITION_v0.2.md](PRODUCT_DEFINITION_v0.2.md)?

## User interviews

At least three independent automation developers or studios. Use real, redacted incidents where possible, and record what they do, not whether they like the idea.

1. Tell me about the last time an automation succeeded but the business data was wrong. How did you find out?
2. How do you check outcomes today? Show me, if you can. How long does it take?
3. What did that incident cost you or your client?
4. Is there a sheet or other list you would trust as the source of what should exist?
5. Do your HubSpot records carry a stable key from the source? Could you add a unique property?
6. Would you give a self-hosted tool read access to that sheet and to HubSpot Contacts? What would stop you?
7. What would you stop doing if this worked? What would you pay for it, if anything?

Interest alone does not count. Pass requires at least two of three to show a recurring cost, a usable source list, and acceptance of the access.

## Technical spike

A throwaway read-only script, kept outside the product code. Test accounts hold synthetic data only.

| # | Question | Pass |
| --- | --- | --- |
| T1 | What is the smallest HubSpot grant for the reads? | Read-only credential works; a write attempt is refused by the grant |
| T2 | Does a read by unique property return exactly one contact or a clear not-found? | Correct for present, absent, archived and merged contacts |
| T3 | How soon after a create does that read see the contact? | Measured delay distribution, compared with Search |
| T4 | Can a unique property really prevent duplicates? | A duplicate value is refused by HubSpot |
| T5 | Can the read return only selected properties? | No over-return |
| T6 | What are the failure and rate-limit responses? | Each maps to a defined state without a false conclusion |
| T7 | Is a Google Sheets read bounded and repeatable? | Exact cells, a revision reference if available, and read-only scope |
| T8 | How is the connected account identified? | The account can be bound to the policy |

## What the Owner provides

Separate instruction naming: the HubSpot test account, the Google test account and sheet, the administrator who creates and revokes credentials, where the data may be kept, and the session budget. D08 ceilings apply unless changed. Credentials are never pasted into chat or committed.

## Exit

| Result | Next |
| --- | --- |
| Interviews and T1–T8 pass | Start S2 |
| T2 or T3 fail | Narrow the missing-record claim, then decide on S2 |
| Interviews fail | Stop or revise the product direction |
