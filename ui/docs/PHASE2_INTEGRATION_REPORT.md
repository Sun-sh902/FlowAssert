# FlowAssert — Product Integration Phase 2 report

Evidence Atelier × local Python verification service · 2026-10-18 · workspace `/Users/zhangshenghe/Documents/FlowAssert-UI` (branch `main`, HEAD `e529077`, uncommitted)

## Recommendation

**READY FOR PHASE 2 INDEPENDENT REVIEW**

This is not Owner acceptance. Nothing was deployed, staged, committed, merged or pushed; Phase 3 was not started; no backend code was changed.

## 1. What was done

| Stage | Outcome |
| --- | --- |
| A–B Handoff and identities | Read all seven handoff documents and the evidence they cite (captured HTTP bodies, evaluator traces, identity comparisons, frozen contract). 34/34 accepted Service files, the pinned model and the frozen contract match their digests. No drift → no stop. [SOURCE_IDENTITY.md](phase2/SOURCE_IDENTITY.md) |
| C–D UIA-009 | Fixed before any HTTP work; 14 tests; a sensitivity run proves 4 of them fail on the old search. §2 |
| E LocalResearchProvider | Real `fetch` to the two authorized GETs only, same-origin through a Vite proxy scoped to `/api/v1` → `127.0.0.1:8765`; bounded time and size; no redirects, credentials, retries, cache or MOCK fallback. LIVE stays unavailable. [API_PROVIDER_MAPPING.md](phase2/API_PROVIDER_MAPPING.md) |
| F Runtime validation | Frozen-schema validation (33 verbatim schemas, drift-tested) + F004 cross-field checks + evidence-chain rules; malformed or contradictory bodies are refused, never repaired. |
| G Verification Detail | The existing Detail composition renders LOCAL_RESEARCH data through a new adapter (`wireToView.ts`) that copies every verdict; gaps G1–G8 of the Phase 2.5 checklist are closed. |
| H Evidence | Evidence panel reads pages pinned to the Detail snapshot (limit 2, constant payload mode, opaque cursor), checks references against the Detail, reproduces payload SHA-256 in the browser (labelled internal consistency only). |
| I Snapshot / errors | 400/404/409/422/503, proxy failure, transport failure, timeout, malformed, cancellation, stale and late responses all handled as access states. 409 → explicit "re-read the whole case"; nothing merged. [SNAPSHOT_AND_ERROR_MATRIX.md](phase2/SNAPSHOT_AND_ERROR_MATRIX.md) |
| J Mode separation | LOCAL_RESEARCH lives only under `#/local/…` with its own nav group, register and an always-visible provenance band; demo pages stay MOCK and make no `/api/` request. |
| K Real E2E | 17 real-service checks × Chrome, WebKit, Firefox = 51 passed. [END_TO_END_TEST_RESULTS.md](phase2/END_TO_END_TEST_RESULTS.md) |
| L Regression | typecheck, lint, build, fixtures (8), unit (352), contract drift (127), accepted browser suite Chrome+WebKit 136 + Firefox 68 — all exit 0. Visual diff: only the new rail group changed. [VISUAL_REGRESSION_REPORT.md](phase2/VISUAL_REGRESSION_REPORT.md) |
| M Integrity | 0 changes across the nine protected workspaces. [SOURCE_INTEGRITY.md](phase2/SOURCE_INTEGRITY.md) |

## 2. UIA-009 — the exact fix

Defect: `WorkflowView.n8nLabel` was typed `string`, and the Verifications search called `.toLowerCase()` on it, so a contract-valid `n8n_label: null` would throw.

Fix:
* `src/domain/view.ts` — `n8nLabel: string | null` (the original null is kept; nothing fills it).
* `src/lib/search.ts` (new) — `matchesSearch(query, fields)` skips `null`/`undefined` fields and never searches a fallback; an empty string is a real value.
* `src/pages/Verifications.tsx` — search extracted to `searchRuns(list, q)` using `matchesSearch`; order and object identity preserved, nothing mutated.
* `src/lib/format.ts` — `workflowLabelText(label)` returns *"Workflow label unavailable"* (null) / *"Workflow label empty"* ("") / the label, flagged as fallback — presentation only. Used by Connections and the local provenance band (italic).
* The same null-safe search now also covers record search in Detail (nullable `displayName` / `company`).
* Filtering is by cohort state (unaffected by the label); there is no sort by label anywhere, so null-safe sorting is not applicable.

Tests (`src/test/uia009-nullable-label.test.tsx`, plus 3 local-Detail tests and E2E 14): null, empty and normal labels in one mixed collection; search by real fields (ID, name, namespace, label); fallback words (`"null"`, `"unavailable"`, `"Workflow label unavailable"`, `"Workflow label empty"`) match nothing; no mutation and identical objects returned; the list renders and searches with null labels; combined with the state filter; Connections shows fallbacks in italics only; a real Service body with `n8n_label: null` renders and its record search still works. Sensitivity: restoring the pre-fix search fails 4 of the 14 ([evidence/uia009/](phase2/evidence/uia009/)).

## 3. Changed files

New (code and tests):
`src/data/local/{config,schema,decode,canonical,evidenceChain,provider}.ts`, `src/data/contract/v1.schemas.json`, `src/adapters/wireToView.ts`, `src/lib/{search,useEvidenceAcquisition}.ts`, `src/components/local/LocalResearch.tsx`, `src/pages/LocalCases.tsx`, `src/test/{uia009-nullable-label,local-validation,local-provider,local-detail,contract-drift-runtime}.test.ts(x)`, `src/test/local/fakeService.ts`, `e2e-local/{support,local-research.spec,screenshots.spec}.ts`, `playwright.local.config.ts`, `scripts/phase2/{prepare_runtime.py,local-service.sh,extract_schemas.py,visual_diff.mjs,final_regression.sh}`.

Modified:
`src/domain/{view,evidence}.ts` (nullable times/label/names, row identity, access values, `local` facts, digest outcome), `src/adapters/researchToView.ts` (MOCK adapter fills the new fields; behaviour unchanged), `src/data/{provider,access,store}.ts`, `src/lib/{format,router}.ts`, `src/App.tsx`, `src/pages/{VerificationDetail,Verifications,Connections,Settings}.tsx`, `src/components/{shell/AppShell,detail/ComparisonSheet,records/RecordCells,states/EvidenceLedger}.tsx`, `src/lab/{data.ts,a/ADetail.tsx,c/CDetail.tsx}` (MOCK-only lab refuses an unavailable time rather than drawing it at zero), `src/test/{detail,provider}.test.ts(x)`, `e2e/{interactions,screenshots}.spec.ts`, `vite.config.ts`, `playwright.config.ts` (loopback origin), `tsconfig.node.json`, `package.json` (scripts `test:e2e:local`, `service:local`), `.gitignore` (`.phase2-runtime`, `test-results-local`), `.claude/launch.json` (preview URL on loopback).

Totals against the pre-phase hash baseline: 28 source/config/test/script files added, 30 modified, 0 removed. Dependencies: none added (`package-lock.json` unchanged). Deliverables: `docs/PHASE2_INTEGRATION_REPORT.md`, `docs/phase2/*.md`, `docs/phase2/evidence/`, `docs/screenshots/phase2_integration/`. Machine list: [changed-files.json](phase2/evidence/changed-files.json).

## 4. Identities

Frozen contract `openapi-v1-proposed.yaml` `0688d55d…c1d230` (v1, `0.1.1-proposed`); provider contract `aa275b2c…65312a`; examples `92ea5a88…f20b`. Accepted Service: 34/34 files match; evaluator `b61779e1…842d`, commit `4deddb32…f8fa`, "Round03.5 research — unapproved", `workspace_dirty: true` — checked by the frontend on every response. Details: [SOURCE_IDENTITY.md](phase2/SOURCE_IDENTITY.md).

## 5. Real HTTP evidence and the five cases

For each case, in each engine: the browser's response came from uvicorn through the proxy and was byte-identical to a direct read of `127.0.0.1:8765`; its `result` equals the evaluator's direct-execution output from the handoff; the rendered seal and record cells equal independently fixed expectations; the two evidence pages carry the Detail's snapshot and the opaque cursor unchanged; references equal the Detail's; 4/4 payload digests reproduce.

| Case | Rendered cohort | Records | Total |
| --- | --- | --- | --- |
| SPEC-001 | Verified | Verified | 1 |
| SPEC-002 | Mismatch (window open — not Pending) | Mismatch | 1 |
| SPEC-003 | Pending (no retry scheduled) | Pending | 1 |
| SPEC-004 | Unverified (access denied; observed time unavailable) | Unverified | 1 |
| SPEC-005 | **Unverified** | 12 × Verified | unknown |

## 6. Snapshot and cursor behaviour

Detail is read unpinned; its snapshot pins every evidence page. A real Service restart produced a new snapshot in each engine; the next page with the old cursor got a real `409 snapshot_unavailable`; the panel discarded its pages, the page marked the case as read from a snapshot no longer served, and only *Re-read the whole case* fetched the new snapshot — Detail first, unpinned, then evidence pinned to it. A tampered cursor got a real `400 invalid_cursor`. See [SNAPSHOT_AND_ERROR_MATRIX.md](phase2/SNAPSHOT_AND_ERROR_MATRIX.md).

## 7. Provider isolation

* LOCAL_RESEARCH modules import no demo fixture, store, MOCK adapter or MOCK provider at runtime (source test).
* No failure path returns MOCK data; with the Service stopped the page shows SERVICE_UNAVAILABLE and the text "MOCK fallback: none", with no seal, record or demo ID (unit + E2E ×3).
* Demo routes made zero `/api/` requests; the browser only contacted the app origin (E2E ×3, and the accepted suite's network test).
* Overview statistics and other demo pages never show local results; local pages never show demo data.

## 8. Python evaluator authority

Verdicts, record states, counts, rule statuses and reasons, unknown population (`expected_total: null`), evidence availability and assurance are copied. The UI has no verdict reducer; a test alters only `cohort_state` in an otherwise valid body and the UI shows the altered value, proving the copy direction. Admission refuses contradictions (e.g. counts vs records) rather than recomputing. Twelve Verified rows render under an Unverified cohort. An API error is never Unverified; unavailable evidence is never Mismatch; an unknown total is never zero or twelve.

## 9. Known limitations

* **Proxy required.** A static build served without the `/api/v1` proxy cannot reach the Service; local pages then show Service unavailable. Only Vite dev/preview are configured. The proxy adds no authentication; loopback reachability is not authentication.
* **Validation scope.** Schema keywords listed in API_PROVIDER_MAPPING §4 only; it validates the parsed value (duplicate keys and `1.0` vs `1` are invisible); `date-time` is pattern + `Date.parse`. F004 checks needing the input evidence are left to the Service. Not a claim of complete OpenAPI validation.
* **Digest check.** Browser re-canonicalisation reproduces Python bytes only for JSON whose numbers are safe integers; otherwise "not checkable". A reproduced digest proves internal consistency of two values from the same service, not authenticity.
* **Not exercised for real:** a non-available evidence reference (no reviewed fixture has one), 401/403/429, a generic 500 from the Service, `snapshot_conflict` (exercised with the test double and the handoff capture only), timeouts (unit only).
* **No collection endpoint.** The local case index lists the five reviewed IDs from the handoff, with no verdicts; results appear only when a case is opened.
* **Runtime custody.** `.phase2-runtime/` (gitignored) holds the executed copy and its own key; `prepare_runtime.py` refuses to overwrite it. Network evidence files contain opaque signed cursors (never the key).
* **Coverage classification.** Chrome, Playwright WebKit and Playwright Firefox ran (Firefox now starts here, unlike Phase 2.5). Safari.app and screen readers were not run.
* In development, React StrictMode issues and immediately aborts a duplicate first read (visible as `ERR_ABORTED` in dev tools); production builds do not.
* The historical frozen-contract text still says "PROPOSED / NOT IMPLEMENTED" and port 8000; unchanged by design.

## 10. Commands and exit codes

| Command | Exit |
| --- | --- |
| `/usr/bin/python3 -I -B docs/phase2/evidence/scripts/integrity.py snapshot …/before.json` | 0 |
| `npx tsc -b`, `npm run lint`, `npx vitest run` (baseline) | 0, 0, 0 (254 passed) |
| `npx vitest run src/test/uia009-nullable-label.test.tsx` on pre-fix search / fixed | 1 (4 failed) / 0 |
| `/usr/bin/python3 -I -B scripts/phase2/prepare_runtime.py` | 0 |
| `/usr/bin/python3 -I -B scripts/phase2/extract_schemas.py` | 0 |
| `scripts/phase2/final_regression.sh` — typecheck, lint, build, fixtures, unit, contract drift, e2e Chrome+WebKit, e2e Firefox, e2e-local ×3, listener check | 0 for all 10 ([commands.json](phase2/evidence/runs/final/commands.json)) |
| `node scripts/phase2/visual_diff.mjs` | 0 |
| `/usr/bin/python3 -I -B docs/phase2/evidence/scripts/integrity.py compare …` | 0 (total_changes 0) |

Earlier failing attempts and their fixes are kept in `docs/phase2/evidence/runs/` and summarised in END_TO_END_TEST_RESULTS §3 (two real defects were found and fixed: a contrast failure on the selected record row, and a nested interactive control I had introduced on Settings).

## 11. Protected integrity and Git status

Nine protected workspaces: 48,765 objects, **0 added / 0 removed / 0 changed**, Git outputs equal ([SOURCE_INTEGRITY.md](phase2/SOURCE_INTEGRITY.md)). FlowAssert-UI: branch `main`, HEAD `e529077d474f364e834c28dd29f728c823bd4d6e`, all work uncommitted; `git status --porcelain` has 786 lines (baseline 597) ([final-git-status-porcelain.txt](phase2/evidence/final-git-status-porcelain.txt)). No Service process is running.

## 12. Running it

```bash
/usr/bin/python3 -I -B scripts/phase2/prepare_runtime.py
```

```bash
npm run service:local
```

```bash
npm run dev
```

Then open `http://127.0.0.1:5183/#/local/verifications`. The first command is needed once; the second runs the isolated Service in the foreground (Ctrl-C stops it).
