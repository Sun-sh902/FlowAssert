# Product development round 01

Date: 2026-10-22 · Branch `product-dev/round-01` from tag `phase3a-baseline` · Scope: local / offline / synthetic.

## 1. Workspace and source identity

The accepted Phase 3A roots have no Git HEAD, so they were identified by content, using the map algorithm of
`FlowAssert-Phase3A-Review/reassessment-04/evidence/identities.py` (read, not executed) against
`PHASE3A_FINAL_OWNER_ACCEPTANCE/ACCEPTED_SOURCE_BASELINE.md`. All recomputed values matched before copying:

| Identity | Accepted | Workspace copy |
| --- | --- | --- |
| Service 39-file map | `a5d68b75…4b45` | identical |
| UI 166-file source map | `0ff0200e…b134` | identical once the omitted `src/.DS_Store` (Finder metadata) digest is re-added; no other file differs |
| UI 182 / 532-file maps | `a7b70678…`, `c6823cd3…` | recomputed on the accepted root (copy excludes `.DS_Store`, `e2e/.output`) |
| Evaluator `vendor/model.py` | `b61779e1…842d` | identical; equals the research evaluator |
| Oracle, frozen v1, history, ID-addressability contracts | as accepted | identical |

Excluded from the copy: runtime state, historical evidence trees (≈800 MB), build and test output. Record:
[SOURCE_IDENTITIES.json](SOURCE_IDENTITIES.json). Phase 3B-P (`PHASE3BP-OA-20261022-…`) was used as vocabulary
reference only: its capture and admission contracts are DRAFT and Phase 3B-1 is not authorized.

**Custody.** A read-only snapshot of six protected roots (accepted UI, Service, Phase 3A acceptance archive, research
evaluator/Oracle, Phase 3B-P archive and planning; 35,453 files, digest and mtime) was taken before work and again after
the final regression: **all six identical** ([evidence/custody/protected-roots.json](evidence/custody/protected-roots.json)).
`service/` has **no changes** against the baseline; the Evaluator is not modified. 60 Service socket-audit records: **0
outbound connections**.

## 2. What the running application showed (gaps found)

1. The primary screens — Overview, Verifications, Verification Detail — rendered **MOCK data only**; the real Service
   was reachable only from a secondary "Research" section.
2. The Local research list showed **no results** ("result read on open"), although the archive holds them.
3. **No status taxonomy.** Capture, evidence admission, archive and verdict were never distinguished; the Detail trace
   said "12 rows **captured**" for fixture input although nothing is captured.
4. The frozen v1 API has **no collection endpoint** (`GET /api/v1/verifications` is refused by the gate). Lists can only
   be built from the History archive.
5. No Capture runs surface at all — and no honest statement that capture does not exist.
6. Service reachability was static text (`127.0.0.1:8765`), not an observed state.

## 3. Implemented (first Evidence Atelier improvement pass)

| Screen | Change | Data |
| --- | --- | --- |
| **Overview** `#/` | New. Editorial verdict statement (coral only for contradictions), newest-archived-result ledger, *Cases* exhibits ordered by what to do, *Workspace register* (Service answered, archive pages, record checks, evaluator, contract), four-axes explainer. | One complete archive list read (all pages, one pinned list view) |
| **Verifications** `#/verifications` | New. Five reviewed cases × four columns: 01 Capture · 02 Admission · 03 Archive · 04 Evaluator verdict. Responsive stacked layout at narrow widths. | Same archive read; row opens the live Detail |
| **Verification Detail** | *Status axes* ledger between provenance and verdict: live verdict (`GET /api/v1/verifications/:id`) beside this case's archive status (`GET /api/v1/history?verification_id=…`, every page). Trace says "rows **supplied**" for local runs. | Live read + scoped archive read |
| **Evidence** | Unchanged accepted panel (paged retrieval, browser-side digest reproduction), now framed by the axes. | Live |
| **History entry** | Same *Status axes* ledger for the archived evaluation. | Archive |
| **Capture runs** `#/capture` | New. States capture is not implemented; no button, no request, links back to Verifications / History. | none |
| **Navigation** | *Workspace · local* (Overview, Verifications, History, Capture runs) · *Configure · demo* · *Demo register · mock* (`#/demo`, `#/demo/verifications`). | — |

**Status semantics (`ui/src/domain/statusAxes.ts`).** Capture and admission are typed `NOT_IMPLEMENTED` with their
basis. Archive is `ARCHIVED` / `THIS_ENTRY` / `NOT_ARCHIVED` / `UNAVAILABLE` / `NOT_ADDRESSABLE` / `READING`. The verdict
axis holds a value only when copied from a Python response, with its source; otherwise **No verdict** — drawn with no
seal, no state colour and no Unverified hatch. An archive failure never changes the verdict. A partly read archive yields
no per-case result.

**States.** Loading (with page progress and Cancel), empty archive (every case *No verdict*), Service unavailable (no
fallback, start hint), stale snapshot, refused list page, archive integrity failure (accepted integrity notice),
cancelled, not-addressable IDs (no request sent).

Screenshots (actual UI, real Service): [screenshots/](screenshots/) — overview, verifications, detail (SPEC-005 light,
SPEC-002 dark), history entry, capture, 375 px, Service unavailable.

## 4. Test evidence — `scripts/dev/regression.sh round01-final`

Logs and exit codes: [evidence/regression/round01-final/](evidence/regression/round01-final/summary.tsv).

| Gate | Result |
| --- | --- |
| Backend pytest (`service/tests`) | **247 passed**, 1 deselected (see below) |
| Pinned identities (`scripts/dev/check_identities.py`) | **pass** — evaluator, 4 contracts, 39-file map |
| UI typecheck / lint | **exit 0 / exit 0** |
| Vitest (unit, component, contract-drift) | **1600 passed / 1600** (33 files; 19 new) |
| E2E static MOCK suite (Chrome: a11y, responsive, keyboard, perf) | **67 passed, 1 failed, 12 skipped** |
| E2E workspace, real Service (Chrome + WebKit) | **27 passed**, 1 skipped (screenshots Chrome-only) |
| E2E accepted History suite, real Service | **34 passed**, 4 skipped |
| E2E accepted exact-ID lookup suite, real Service | **30 passed** |
| E2E accepted Phase 2 local suite, Phase 2 Service | **17 passed**, 4 skipped |

The workspace suite runs dev-main, dev-empty and *Service stopped*; checks cohort results against the backend
handoff's table (not the UI), that the browser talks only to its own origin, axe (WCAG 2.2 AA + best practice) with
**0 violations** in light/dark at 1440 and 375 px, and no horizontal overflow at 375 px.

**The one failure is pre-existing:** `e2e/perf.spec.ts` — layout shift on `#/rules` 0.137 > 0.1. The untouched
`phase3a-baseline` commit fails identically (0.137); it passed once during this round, so it is intermittent. Not fixed,
threshold not changed.

**Deselected:** `test_protected_repository_integrity` walks sibling repositories via `ROOT.parent` and reads
`evidence/protected-before.json`; it is bound to the original checkout location. The six-root custody comparison
above replaces it for this round.

**Test changes to accepted suites** (all from the route move, none weakening an assertion): MOCK routes gained the
`/demo` prefix; nav-label expectations updated; drawer "blank click" tests now target a non-interactive element instead
of 62 % of the drawer height (the added nav items put a link there); e2e-history F20 now permits exactly one more
request shape — this case's own scoped archive list — and requires it; e2e-local expects the case list to report
*Service unavailable* on the Phase 2 Service (it has no history routes).

## 5. Limitations

- Verdicts on Overview/Verifications are the **newest archived** results; the live verdict appears only on Detail.
  Archive order = newest archive entry first, as the Service returns it.
- Five reviewed synthetic cases only; the archive filter cannot address other IDs (shown as *Not addressable*).
- Capture and admission are not implemented anywhere; the axes say so rather than imply a state.
- Service reachability is shown from the archive read on Overview; there is no health endpoint.
- P3A-AUD-001 stays OPEN (legacy path collision; gate refuses it). F15 Firefox harness defect not fixed; Firefox not run.
- `ui/scripts/phase3a/prepare_runtime.py` checks the pre-remediation manifest and exits 1 on `app/history_api.py` and
  `app/service.py`; the copy it makes was verified identical to the accepted Service (`a5d68b75…`, full diff empty).
- Dependencies are copied, not reinstalled; a clean-clone install path is not yet scripted.

## 6. Next engineering tasks

1. **Live verdict on the list** — read `GET /api/v1/verifications/:id` per case on Verifications (bounded, cancellable)
   and show live vs newest archived side by side, flagging any difference without choosing one.
2. **Fix the `#/rules` layout shift** (reserve the space that shifts; keep the 0.1 budget) so e2e-static is green.
3. **Archive-to-live comparison on Detail** — link the live result to its matching archived evaluation by
   `input_evidence_sha256`, else say none matches.
4. **Workspace health line in the top bar** from the last completed read (time-free: "answered / unavailable"),
   replacing the static host text.
5. **History list filters by verdict and integrity** using the indexed archive (no new endpoint).
6. **Clean-clone bootstrap** — `scripts/dev/bootstrap.sh` doing `npm ci` and a venv from `requirements.lock`, plus a
   relocatable variant of the custody test instead of deselecting it.
7. **Retire the Phase 2 harness** or pin it explicitly: decide whether e2e-local still guards anything the Phase 3A
   Service does not.
8. Capture / admission screens remain **blocked** on a separate Owner authorization of Phase 3B-1; no UI beyond the
   honest *not implemented* state until then.
