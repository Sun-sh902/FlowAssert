# FIX03 — Domain semantics verification

Integrity, Service-error and four-axis semantics, checked against the accepted Service and the real local data,
then in Chrome and WebKit against the running Service (`e2e-workspace`, `e2e-history`, `e2e-lookup` PASS on `529db23`).

## Integrity statements the Service actually produces

| Where | Statuses possible | Source |
| --- | --- | --- |
| Archive record in a 200 list / Detail / evidence page | `INTEGRITY_VERIFIED` only — any other status in a 200 is refused by the UI decoder as `integrity_status_conflict` | Service: `listing()` reads every item through `_read()` (`service/app/history_store.py:266-301, 363`), which raises before answering. UI: `ui/src/data/history/decode.ts:44-55` |
| Evidence item in a 200 evidence page | `INTEGRITY_VERIFIED` (available, hashed) or `INTEGRITY_UNVERIFIABLE` (nothing hashed); FAILED is refused | `history_store.py:31-43`; `decode.ts:163-174` |
| 503 error envelope | `error.details[{path:"archive", code}]` with `INTEGRITY_FAILED` (digest, canonical, binding, schema failures) or `INTEGRITY_UNVERIFIABLE` (the `fail()` default: `archive_unavailable`, `history_key_unavailable`, `unsafe_state_path`, `archive_evidence_missing`, `archived_evidence_missing`, `foreign_keys_disabled`, …) | `service/app/history_security.py:20`, `history_api.py:23` |

Real local data (`dev-main` archive, read in-process): the list returned 10 entries, all with archive record
`INTEGRITY_VERIFIED` (`evidence/service-probe/rules_probe.json`).

So in the running product the only way an UNVERIFIABLE reaches an archive-record display is through a **503**. Before
FIX03 the Verification Detail status axes reported that 503 as *"The Service reported an archive integrity failure"*
(F-01b). The four tag sites that mapped any non-VERIFIED status to `failed` (F-01a) cannot be reached through the
decoder. They were fixed through the same mapping so they stay correct if the decoder rules change.

## Integrity states as rendered after FIX03

| State | Glyph (`data-i`) | Words | Where |
| --- | --- | --- | --- |
| Verified | `verified` — filled digest square | "record check · service", or the status; screen reader: "Integrity verified: …" | History rows, archive axis, match candidates, entry page |
| Failed | `failed` — broken link | `INTEGRITY_FAILED`, "integrity failure", "failed internal consistency verification" | archive axis (503), History/Workspace notices, evidence items |
| Unverifiable | `unverifiable` — dashed square | `INTEGRITY_UNVERIFIABLE`, "could not verify the stored archive", "could not be verified" | archive axis (503), History/Workspace notices, evidence items |
| Missing evidence | evidence ledger: reference `unavailable` → item *unverifiable* with the reference's reason | "reference not available — no content to check" | `domain/integrity.ts:57`, EvidenceLedger |
| Loading / unknown | `pending` (dotted) or no tag; "reading archive…" | "Integrity not established", "reading archive…" | `StatusAxes.tsx` READING, EvidenceStatus |
| Archive list not found (new) | none | "Archive list not found" | Detail axes only (F-04e) |

No integrity state uses a verdict seal, a verdict colour or the Unverified hatch (`components/integrity/Integrity.tsx`
header). The verdict axis is rendered only from a copied Evaluator result. `fix03.test.tsx` F-01 #4 checks that an
integrity failure leaves exactly one seal on the page, the live verdict.

## The four axes on real Service data

Read in-process from this workspace's Service and `dev-main` archive (`evidence/service-probe/rules_probe.json`):

| Case | Capture | Admission | Archive | Evaluator verdict (live) |
| --- | --- | --- | --- | --- |
| SPEC-001 | NOT_IMPLEMENTED | NOT_IMPLEMENTED | archived ×2, record VERIFIED | Verified |
| SPEC-002 | NOT_IMPLEMENTED | NOT_IMPLEMENTED | archived ×2, record VERIFIED | Mismatch |
| SPEC-003 | NOT_IMPLEMENTED | NOT_IMPLEMENTED | archived ×2, record VERIFIED | Pending |
| SPEC-004 | NOT_IMPLEMENTED | NOT_IMPLEMENTED | archived ×2, record VERIFIED | Unverified |
| SPEC-005 | NOT_IMPLEMENTED | NOT_IMPLEMENTED | archived ×2, record VERIFIED | Unverified (12 records Verified, population unknown) |

Capture and admission are constants of this build (`domain/statusAxes.ts:77-89`). The archive axis is the Service's
storage and integrity statement. The verdict is `result.cohort_state`, copied. FIX03 changed only how the archive
axis words and draws its own states; no axis reads another axis's value.

The same axes are asserted in Chrome and WebKit against the running Service by `e2e-workspace` (PASS on `529db23`).
