# Domain semantics recheck (R04, R05, R06, R07)

Implementation-side. Each statement below is backed by code that was read and a test that runs in the regression.
Test file: `ui/src/test/residual-closeout.test.tsx` (20 tests) unless stated otherwise.

## not_found versus failed (R05)

The live side of each known case has five provider outcomes (`ui/src/data/workspace/comparison.ts:109-114`, mapped by
`ui/src/lib/useLiveCases.ts:17-24`):

| Live outcome | Origin | Comparison (unchanged) | Overview headline (after) | Register "Live reads" (after) |
| --- | --- | --- | --- | --- |
| `ready` | 200, admitted | by verdict | counted under its verdict | counted as answered |
| `not_found` | 404 + FlowAssert envelope (`data/local/provider.ts:150`) | `LIVE_MISSING` "no current result" | "N has/have no current result at the Service"; all five: "The Service holds no current result for these cases." | counted as answered, "(N not found)" |
| `failed`, transport (`SERVICE_UNAVAILABLE`, not integrity) | network error, no envelope | `SERVICE_UNAVAILABLE` | "N could not reach the Service" | not answered |
| `failed`, other | 4xx/5xx envelope, refused body, provider exception | `INCONCLUSIVE` | "N could not be read" | not answered |
| `reading` | in flight | `READING` | "N is/are still being read"; nothing read yet: "No current result has been read yet." (unchanged) | not answered |
| `cancelled` | the reader pressed Cancel | — | "could not be read" (unchanged; see below) | not answered |

Page-level states are unchanged: archive and every live read unreachable → the Service-unavailable notice
(`Workspace.tsx` `allUnreachable`); the archive list 404 → `AccessNotice NOT_FOUND` "The archive list answered 404".

Scenarios exercised (unit, real provider + decoder, captured Service bodies):

| # | Scenario | Headline | Register |
| --- | --- | --- | --- |
| 1 | all ready | verdict sentence only | 5 of 5 answered |
| 2 | all not found | The Service holds no current result for these cases. | 5 of 5 answered (5 not found) |
| 3 | 4 ready + SPEC-003 not found | … One has no current result at the Service. | 5 of 5 answered (1 not found) |
| 4 | live and archive unreachable | Service-unavailable notice, no "not found" wording | — |
| 4b | all live 500 | No current result could be read. | 0 of 5 answered |
| 5 | 3 not found + 2 failed, nothing read | No current result was read. Three have no current result at the Service, two could not be read. | — |
| 5b | 4 ready + SPEC-004 unreachable | … One could not reach the Service. | — |
| 6 | 4 pending + 1 not found | No current result has been read yet. | 1 of 5 answered (1 not found) |

Browser (Chrome and WebKit, real Service): `e2e-workspace` "Overview: a live 404 from the Service is 'no current
result', never a failed read" obtains the Service's own 404 `run_not_found` body through the gate (unknown ID
`SPEC-999`) and serves it for SPEC-003's live read. Headline: "One case contradicts its source. Two cannot be
concluded, one is verified, one has no current result at the Service."; the case is in the "No current result" group;
the Register reads "5 of 5 answered (1 not found)". On `1caef22` the same test fails in both engines with "… one could
not be read."

Not changed: a user-cancelled read with nothing else read still yields "No current result could be read." Cancel is
offered only while reads are in flight, and the case rows say "read cancelled". The finding did not name it, so it is
listed in REMAINING_LIMITATIONS.md rather than changed. Backend Verdicts and comparison states are untouched.

## Digest verification wording (R06)

| Where | What is verified | By whom | SHA-256 computed? |
| --- | --- | --- | --- |
| History list row, "record check · service" | stored candidate bytes vs `candidate_sha256`, canonical form, identity bindings, header seal, record and evidence rows | Service, on every read (`service/app/history_store.py:266-301`) | yes, by the Service |
| History list row | `integrity.status = INTEGRITY_VERIFIED`; `checked_sha256` = the digest in `history_id`; `archive_id`, `snapshot_id` carry the same digest; scope `archive_candidate_and_relationships` | browser decoder (`ui/src/data/history/decode.ts:45-55`) | **no** — string comparison of reported values |
| History entry page, evidence | each received payload canonicalized (Python rules) and hashed, compared with the reference `sha256` | browser (`history/provider.ts:174` → `local/canonical.ts:307-325`, `crypto.subtle`) | yes, in the browser |

Tooltip before: "… This browser confirmed that the reported digest names this entry. Evidence payloads are checked on
the entry's page."
Tooltip after: "The Service re-verified this archive's stored candidate bytes and relationships when it answered (scope
archive_candidate_and_relationships). This browser did not recompute that digest: it checked that the digest the
Service reports is the one in this entry's history, archive and snapshot IDs. Evidence payload digests are recomputed
in this browser on the entry's page."

The tag text, glyph and accessible name stay "Integrity verified: record check · service" (asserted). Service-side
verification language is unchanged. INTEGRITY_FAILED / UNVERIFIABLE rendering (FIX03) is unchanged.

## Provider replacement (R07)

| Case | Before (`1caef22`) | After |
| --- | --- | --- |
| A settled, replaced by B, same key | B never called; A's data shown as B's | A's state dropped in the same render; B read once; B's data |
| A pending, replaced by B | B never called; the state stayed A's `loading` read | A's signal aborted; A's late answer dropped by sequence; B's data |
| B rejects | B never called; A's data stayed | REQUEST_ERROR from B, never A's data |
| unmount while B pending | — | B's signal aborted, nothing published |
| stable provider re-rendered 5× | 1 read | 1 read (no loop) |
| `useHistoryList`: provider replaced after page 1 | A's 4 entries kept, B never read | A's pages dropped; B's first page read once (`/api/v1/history?limit=4`) |
| `useHistoryList`: replaced after loading page 2 | A's 2 pages and cursor kept | starts at B's page 1, no cursor carried over |
| `useHistoryList`: stable provider | 1 first-page read | 1 first-page read |

Production: providers are module singletons and the two Detail routes that use different providers are separately
keyed (`App.tsx:177-178`), so the app never swapped providers under one key. The fix makes the hooks honour their
documented lifecycle for any caller. `useLiveCases` already listed the provider in its effect dependencies.

## ArchiveIndex reachability (R04)

| Input | Path | Result |
| --- | --- | --- |
| Contract-valid list page (IDs `SPEC-001`…`SPEC-005`) | `decodeHistoryList` → `admitListPage` → `useArchiveIndex` → `indexArchive` | indexed; `unexpected` empty |
| List page with `SPEC-009` | `decodeHistoryList` (schema `^SPEC-00[1-5]$`) | refused whole, `schema_invalid`; Overview: archive "not read", Record checks "—", no SPEC-009 anywhere |
| Direct call `indexArchive([...SPEC-009...])` | unit test only (`workspace.test.tsx:93`) | kept in `unexpected`, never counted in `latestByState` or the five cases |
| Future contract that admits more IDs | needs a new contract, schema copy and decoder | out of scope; `unexpected` would then need rendering — recorded in REMAINING_LIMITATIONS.md |

Runtime validation was not weakened. Only the inaccurate comment changed.
