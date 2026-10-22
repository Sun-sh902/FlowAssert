# Frontend provider and transport contract

**PROPOSED — NOT IMPLEMENTED.** This is a documentation contract, not an added TypeScript module. This task did not modify frontend files. The external v1.1 change and current existing MOCK seam are recorded in the authority map; global UI non-mutation is not claimed.

## Modes and provenance

| Mode | Data source | Authority / availability |
| --- | --- | --- |
| MOCK | Existing `src/mocks`, `src/data/store.ts` and v1.1 MOCK-only `src/data/provider.ts` | Synthetic hand-built research-shaped outcomes, including proposed email and placeholder digests. Existing code only; not a Python execution. |
| LOCAL_RESEARCH | Proposed Python service, controlled synthetic input, actual locked `model.evaluate(e)` execution | Planned. Must show “Local research · synthetic · unapproved research version” and consistent-input authenticity limit. No live acquisition. |
| LIVE | Future separately collected source and destination evidence | **Not implemented or enabled.** Selecting this mode returns a clear unavailable-provider error; no fallback to LOCAL_RESEARCH or MOCK. Requires connector/security/release/product approval. |

Current MOCK behavior is confirmed in [builders:133–252](/Users/zhangshenghe/Documents/FlowAssert-UI/src/mocks/builders.ts:133), [store:12–17](/Users/zhangshenghe/Documents/FlowAssert-UI/src/data/store.ts:12). At later observed UI HEAD e529077, [provider.ts:29–66](/Users/zhangshenghe/Documents/FlowAssert-UI/src/data/provider.ts:29) already defines synchronous VerificationProvider.listRuns/getRun and a MOCK-only activeProvider. Verification pages still import the store directly. The async surface below is a proposed evolution of that seam, not an existing HTTP client or another engine.

The backend schema reserves LOCAL_RESEARCH/LIVE metadata; **MOCK is not a backend verification claim**. A service deployment advertises one configured mode and serves one configured workspace in Phase 1. Every returned resource must agree with that mode and synthetic flag. A LIVE-labelled response cannot be accepted from a LOCAL_RESEARCH provider. Cached objects are keyed by provider mode, workspace, API contract identity, catalog snapshot and run ID, with input/evaluator identity checked. Mode changes clear in-flight requests, selected resource cache and stale crumbs. `assurance.release_approval_reference` is null for research_only examples; a future product-authorized claim needs a separately verified reference bound to exact code/contract identity. This field does not authenticate acquisition.

## Typed provider surface

Proposed documentation-only TypeScript sketch:

```ts
type ProviderMode = "MOCK" | "LOCAL_RESEARCH" | "LIVE";
type ProviderResult<T> =
  | { kind: "ready"; data: T; context: ProviderContext }
  | { kind: "partial"; data: T; context: ProviderContext; unavailableIds: string[] }
  | { kind: "not_found"; requestId: string | null }
  | { kind: "error"; code: string; message: string; requestId: string | null; retryable: boolean };

interface FlowAssertProvider {
  readonly mode: ProviderMode;
  readonly capabilities: {
    readRuns: boolean;
    readEvidence: boolean;
    liveAcquisition: false; // all initial implementations
    requestRecheck: false;
  };
  getOverview(query: OverviewQuery, signal?: AbortSignal): Promise<ProviderResult<OverviewViewV1>>;
  listVerifications(query: VerificationQuery, signal?: AbortSignal): Promise<ProviderResult<RunPageViewV1>>;
  getVerification(id: string, query?: DetailQuery, signal?: AbortSignal): Promise<ProviderResult<RunViewV1>>;
  getEvidence(id: string, query: EvidenceQuery, signal?: AbortSignal): Promise<ProviderResult<EvidencePageViewV1>>;
  listWorkflows(query: WorkflowQuery, signal?: AbortSignal): Promise<ProviderResult<WorkflowPageViewV1>>;
}
```

`ProviderContext` contains mode, synthetic flag, server workspace identity, research authorization, acquisition-authenticity limit, explicit display-clock basis, API version and request/snapshot identity. Query shapes are exactly those in [OpenAPI](openapi-v1-proposed.yaml). Page view types contain typed items, snapshot ID, total/null and next cursor/null. Evidence pages contain typed reference metadata and JSON payloads with explicit availability; presentation components do not receive research-evaluation functions.

`DetailQuery = { snapshot_id?: string }`; `EvidenceQuery` carries the same optional snapshot plus the defined limit/cursor/include_payload fields. Internal Overview/history hydration calls getVerification with the parent's snapshot, and related getEvidence calls use the Detail snapshot. A standalone first Detail read may omit it.

`meta.contract_version` must equal the reviewed `0.1.1-proposed` decoder; `meta.workspace_id` must equal the configured workspace even for empty collections. `partial` is permitted only for Overview hydration, explicitly requested full-history hydration, or evidence inspection with some unavailable/loading content. It is not a verification state. Ordinary list pages are ready as pages, never as complete history. Initial loading and cancellation are hook states, separate from this settled result union.

`RunViewV1` retains the current [RunView composition](/Users/zhangshenghe/Documents/FlowAssert-UI/src/domain/view.ts:86), with narrow changes:

- `capturedAt`, `observedAt`, `evaluatedAt`, `deadline`: `string | null`; retain raw ticks in technical metadata.
- `WorkflowViewV1.n8nLabel`: `string | null`, preserved independently of the derived display text described below. Current `WorkflowView` remains the documented legacy string type until authorized UI edits.
- `windowOpen`, `retryViable`: `boolean | null`. The first means **timing window at evaluation**, the second is a policy input. Neither is row eligibility.
- `provider: ProviderContext`, `evaluatorIdentity`, `evidenceReferences`, `limitations`, `retryContext` and `diagnostics` are explicit typed fields.
- Each record gets `rowId = runId + ':' + source_row`, `rawKey: JsonValue`, and a formatted display `key`. Use rowId for React keys, URL selection and list focus. A duplicate/raw invalid key cannot collapse rows.
- Each field comparison carries availability alongside `source/destination: string | null`. Source availability comes from the bound typed source context. If no destination `actual` was emitted, say “not exposed / not compared” and show the evaluator reason; do not guess whether the raw field was null, missing, inaccessible or absent. Bound evidence can be inspected separately without changing the verdict.
- Timeline event `at` and `future` become nullable. Unknown events remain visible with unavailable time but have no invented axis position.
- `premises` copy says which supplied-record consistency check is supported. Acquisition authenticity remains explicitly not authenticated.

These changes avoid a visual redesign. The same verdict, trace, ledger, comparison, unknowns and metadata components remain, with localized null/loading/availability handling. The existing type cannot honestly represent every malformed-key/time case without those small changes.

## DTO to view mapping

| API source | View destination | Rule |
| --- | --- | --- |
| identity / workflow | id, previousRunId, workflow | Service metadata; no demo registry lookup. |
| result.cohort_state | RunViewV1.state | Exact copy, never derive from records. |
| result.records[].state | RecordViewV1.state | Exact copy, never derive from rules/evidence. |
| result.counts / expected_total / source_population_known / destination_coverage_sufficient | counts / expectedTotal / populationKnown / coverageSufficient | Exact copy; check consistency, reject broken transport rather than repair it. |
| result.records[].rules | RuleView[] / fields[] | Preserve statuses/reasons/optional values and every required rule. No real-mode email rule. |
| source_snapshot / destination_observation / policy_context | contextual display and technical metadata | Bound input projections only; neither substitutes for the returned result. |
| evaluation_context.event_times + time_mapping | calendar display / timeline | Explicit mapping below. No implicit Unix or tick-minute assumptions. |
| retry_context.pending_source_rows | retry explanation | Derived by service from returned Pending labels; no provider eligibility engine. |
| result.premise_evidence + full sufficiency fields | premises | Show individual checks separately from population/coverage conclusions. |
| assurance + meta | mode label / notEstablished / limitations | Always visible, including on a green result. |

### Nullable workflow metadata

The Python evaluator has no workflow-label field. `workflow.n8n_label` is configured service metadata, not source evidence or proof that n8n ran. A present string (including an empty string) is preserved verbatim. Explicit null remains null in `WorkflowViewV1.n8nLabel`. An omitted wire key is a contract error: do not silently supply null, a workflow name, a source namespace or a demo label. A future importer with no configured label must publish the explicit null key.

Presentation may derive `n8nLabelText = n8nLabel === null ? "Workflow label unavailable" : n8nLabel`; this text has PRESENTATION authority only and is never written back to metadata/evidence. Search skips null (`typeof value === "string" && value.toLowerCase().includes(needle)`) and never indexes the fallback. Apply the same policy to Detail, list, Overview and workflow catalogue. The boundary example includes a schema-valid null label; missing-key rejection is a separate negative case.

Local counts of displayed issue labels, passed/total rules and rows with unknown rules are presentation derivations. The provider must not import `deriveRecordState`, `deriveCohortState`, mock builders or fake digest generation in LOCAL_RESEARCH/LIVE paths. A disagreement between schema, stored counts and rows is a contract error, not permission to select a “more plausible” state.

## Time contract

Current research ticks and source-of-time behavior are defined at [model:93–126](/Users/zhangshenghe/Documents/FlowAssert-round03-oracle-fix/experiments/round03/model.py:93), [273–274](/Users/zhangshenghe/Documents/FlowAssert-round03-oracle-fix/experiments/round03/model.py:273). Current demo mapping/null substitution and fixed clock are at [adapter:208–215](/Users/zhangshenghe/Documents/FlowAssert-UI/src/adapters/researchToView.ts:208), [format:1–37](/Users/zhangshenghe/Documents/FlowAssert-UI/src/lib/format.ts:1).

**LOCAL_RESEARCH proposed default:** `time_mapping.kind = synthetic_affine_v1`, `origin_iso` explicitly supplied, positive integer `seconds_per_tick` explicitly supplied. For a valid tick `t`, presentation instant = origin + t × seconds_per_tick. The five examples choose origin `2026-10-16T14:00:00Z` and 60 seconds/tick; this does not assign a real-world unit to the research model. `unmapped` requires both mapping parameters null and every mapped event time null.

Before mapping, reject booleans as ticks and require plain safe integers, finite arithmetic and a valid representable RFC3339 result. A missing/null tick maps to null with `Diagnostic {path: "result.<field>", code: "missing_time_tick", message: <explanation>}`. A boolean/noninteger/invalid tick or an unrepresentable mapped instant maps to null with `invalid_time_tick`. Retain the raw result unchanged. Under `unmapped`, all display times are null and add `time_mapping_unavailable`; still diagnose missing/invalid raw ticks separately. Example D supplies `missing_time_tick` for `result.observed_at`, including when a denied-read receipt is available. Out-of-range JSON integer inputs beyond ±(2^53−1), non-finite numbers and oversized payloads are outside the offline service transport contract and rejected **before import**, not rounded. This is a service scope limit, not a change to research outcomes. Source capture, destination observation, semantic evaluation and deadline retain distinct fields; an untrusted raw integer observation may be shown as a declared time but must retain `observation_time_valid=false` and clock limits.

When required time is unavailable, retain the returned verdict/rules and display an unavailable-time explanation; do not position that event on a timeline, calculate its age/countdown or substitute tick zero, receipt time, generated_at or service execution time. If evaluation time is unavailable, the frozen relative display clock is unavailable too. A missing required mapped-time key is a transport error; a present null is an allowed unavailable value. Missing live temporal evidence requires the separately reviewed live policy; display conversion cannot repair it.

All API calendar timestamps have an explicit RFC3339 offset; output uses UTC `Z`. The UI may keep its existing explicit UTC presentation. `service_executed_at` is the actual wall-clock execution instant in a future implemented service, not the mapped semantic `evaluation_at`; the static JSON examples intentionally use null. `created_at` and `meta.generated_at` are also separate metadata. Static examples' dates are synthetic, not acquisition or execution receipts.

LOCAL_RESEARCH relative labels use a declared frozen **evaluation snapshot** clock, not the user's current clock; the UI must state that basis. The original MOCK clock stays confined to MOCK. Render-time expiry must never rewrite a stored Pending result. `window_open_at_evaluation` is timing context only: an access-denied Unverified row can coexist with an open timing window and no eligible retry. Automatic retry is disabled; no next-attempt time is invented.

LIVE time policy is **OWNER_DECISION_REQUIRED**: trusted observation sources, precision, clock skew, obligation origin, epoch/tick conversion and no-rounding deadline semantics need separate approval and connector experiments. Do not reinterpret a workflow event time as independent source capture without revisiting the obligation contract. The older proposed event-time baseline in [Verification Principles:98](/Users/zhangshenghe/Documents/FlowAssert-round03-oracle-fix/VERIFICATION_PRINCIPLES.md:98) is not what current Python uses.

## Read API behavior

Every path is proposed under `/api/v1`:

| GET path | Parameters | Response / UI consumer |
| --- | --- | --- |
| `/overview` | evaluated_from inclusive / evaluated_to exclusive | Latest-per-workflow cohort counts and row counts, latest summaries, all-in-range UTC daily trend, unbucketed count. Hydrate each latest Detail as defined below; summary alone is not RunView. |
| `/verifications` | limit 1–100 default 25; cursor; workflow_id; cohort_state; q≤200; sort; evaluation range | Run summaries, page snapshot/cursor/total, cohort filter counts after search but before state filter. Match current list search fields; no implicit PII search. |
| `/verifications/{id}` | opaque id; optional snapshot_id | Complete unchanged evaluator result plus bound context and selected snapshot_id; no record truncation. Offline import cap is 200 source rows and 1 MiB input. |
| `/verifications/{id}/evidence` | id; optional snapshot_id; limit/cursor; include_payload default true | Logical refs plus bound synthetic JSON or explicit unavailability reason. Echo selected snapshot in page.snapshot_id. No arbitrary path/URL fetch. |
| `/workflows` | limit/cursor; q; name sort | Configured display metadata, not live connection health or execution evidence. |

Run sorting accepts `evaluated_at:desc` (default), `evaluated_at:asc`, `created_at:desc`; evaluation refers to mapped semantic evaluation time, with unmapped/null last in either direction and ID tie-break in the same direction. Workflow sorting is name asc/desc with ID tie-break. An overview's latest run follows evaluation-desc then ID-desc; for unmapped evaluations it uses the same null-last order, never silently replaces evaluation time by service receipt time.

The Phase 1 catalog is capped at 100 workflows, 200 source rows per run, and 1 MiB input per imported run. Refuse oversized imports before evaluation/publication; do not make a partial cohort or silently omit workflows from overview. Larger-scale paging/streaming is a later measured requirement.

Cursors bind the configured workspace, provider mode, contract version, full normalized query, sort, evidence run/include_payload option and immutable catalog snapshot. Continue against that same snapshot. Reusing a cursor with changed filters is 400; an expired/unavailable snapshot is 409. An explicit snapshot_id that conflicts with a cursor is 409. Cursor contents are opaque and integrity checked; do not trust decoded client values. First-page reads may select a new snapshot. `total=null` means not computed, not zero. Detail/evidence reads retain the run's immutable version identity. Snapshot IDs identify non-reused immutable catalog membership/content under that scope; queries/cursors select within it. Adding a run creates a new catalog snapshot, never edits the previous one. Standalone Detail selects and echoes a snapshot; related evidence reads pin it. Missing run in a retained snapshot is 404; expired snapshot is 409; missing/corrupt bound content is 503.

### Overview hydration — Option B (normative)

Option A (embedding ordered rows/access/rules in every latest summary) duplicates the already bounded full Detail and risks divergent projections. Choose **Option B**, using the five existing GET paths. No new endpoint, evaluator, payload duplication or design change is needed.

1. Fetch Overview once. Validate schema, `meta` mode/synthetic/workspace/contract and nonempty `snapshot_id`; the aggregates, trend and ordered `latest_runs` are one frozen selection. Empty latest_runs is an empty catalogue, not Verified. A run ID is `latest_runs[i].identity.id`, scoped by workspace/mode/contract, never a workflow ID or record key.
2. For every selected summary fetch `GET /verifications/{encoded id}?snapshot_id={encoded overview snapshot_id}`. Bound concurrency to **four**, propagate AbortSignal, and retain Overview order regardless of response arrival. Do not fetch newer “latest” selections during hydration. Cache by mode/workspace/contract/snapshot/run plus evaluator/input identity; a same-ID object from another scope/snapshot cannot satisfy the request.
3. Before admitting a Detail, require exact snapshot echo; complete identity, workflow, evaluation_context and assurance equality with the summary; meta scope/version agreement; and equality of every ResultSummary field with its full result projection. Check code/input/source/policy/ref bindings, full record count and row/context inventory. A mismatch is an operational contract error, not a business verdict. A backend must validate the bound immutable input/result/reference catalogue before serving; the frontend checks the available bindings, not external acquisition authenticity.
4. Detail contains every `result.records[]` in original capture order. Require unique integer `source_row` values covering `0..source_rows_observed-1`, full source context rows, and matching raw keys by source_row. Preserve raw result order and map records by ascending source_row; never join by raw key, group by state, deduplicate keys or generate cells from counts. `rowId = runId + ':' + source_row` is presentation identity. These rules apply even when >120 rows cause the existing aggregate strip to render. There is **no record pagination** in this bounded contract.
5. Copy each row state/rule/status/reason and cohort_state independently. Keep null expected_total and population_known=false, including twelve Verified rows with an Unverified cohort. Unknown-population rings are uncertainty marks, not additional evaluated rows. Supported Mismatch and bounded Pending remain unchanged; the provider does not run a reducer or retry clock.
6. The hydrated RunView supplies Trace/RecordCells and Exhibits with ordered records, accessDenied from bound destination.access, times, population/coverage, retry context, rule reasons, and qualified nextStep/issueBreakdown. The existing [crosswalk](../docs/04_RESEARCH_FRONTEND_MAPPING.md#overview-consumer-requirements) defines the exact sources. Issue labels/counts and suggested next steps are presentation restatements; they cannot create new failures or claim why a field was missing. Full evidence payloads are **not required eagerly**: Detail already includes bound context and the complete reference inventory.
7. On payload inspection, call the existing evidence path with the same run/snapshot. Its `page.snapshot_id` and `meta` scope/version must match Detail; concatenate pages in complete Detail.evidence_references order, validate all reference metadata/IDs/hashes and reject duplicates, cycles, omissions, reordering or foreign-run pages. `next_cursor=null` terminates; nullable total never proves completion. A cursor limit controls payload pages only; it never changes trace cells or cohort counts. A user may open a standalone Detail in a newer catalog only as a separately labelled read, never merge it into the pinned Overview.
8. `OverviewViewV1` contains the immutable summary/aggregate snapshot plus one typed hydration entry per latest summary: `{kind: "ready", run: RunViewV1}` or `{kind: "loading" | "error", summary: RunSummaryViewV1, explanation: string}`. A ready overall provider result requires all entries ready. Failed Detail requests yield `partial` with unavailableIds; show loading/error slots in the existing trace/exhibit composition, never cast summaries to RunView, invent empty records or assign Unverified for a transport failure. Aggregates can display as labelled server snapshot summaries while traces are partial. Do not show “nothing requires attention” or a complete set of exhibits from the loaded subset. Cancellation cannot publish an old selection.
9. Scope/version/snapshot identity conflicts invalidate the affected hydration batch; 409 requires an explicit whole-Overview refresh, never per-run fall-forward. During refresh, clear or visibly label prior snapshot content as historical, and never mix snapshots. Ordinary per-run 404/503 can show an unavailable slot and qualify completeness. Evidence inspection has its own loading/partial/error status; missing-at-evaluation references retain explicit availability/reasons and the stored verdict, while unexpected loss/hash failure of an available reference blocks an unqualified successful display with 503. Changing reference availability for later retention creates a new projection snapshot or expires the old snapshot, never mutates pinned metadata silently. Neither condition fabricates evidence or changes the stored result.
10. Overview does not need full history. If a consumer asks for legacy `WorkflowSummary.history: RunViewV1[]`, paginate `/verifications?workflow_id=...` to explicit termination under one cursor snapshot and hydrate **each** returned ID against that snapshot, with the same validation/concurrency. One summary page is a `RunPageViewV1`, not complete history. List `forceStrip` can use a narrow RunSummaryViewV1 without record hydration; it must not masquerade as a full RunView.

### Strict boundary obligations (F004)

Generated schema types are necessary but insufficient. Before publishing/accepting a response, the authorized implementation must test and reject: affine mapping with null origin/scale; unmapped mapping with nonnull parameters; present EvidenceValue with null value or unavailable value with an invented string; unknown population with nonnull expected_total; product-use assurance with no independently bound approval reference; unavailable/redacted/expired reference with nonnull payload; wrong input/code/source/policy/ref hash; inconsistent counts/row/context inventory; and snapshot/mode/workspace/contract mixing. Raw malformed tick/key echoes intentionally remain permitted by the raw-result schema; rejecting a broken envelope must not repair them or manufacture a verdict. Static conformance is not runtime enforcement or authorization.

Overview counts latest selected runs per workflow. Trend counts all evaluations in the requested range, so a recheck contributes a new evaluation rather than replacing an old outcome. Unmapped times do not enter UTC day buckets or time-range filters; unbucketed results are counted separately in an unfiltered overview. Phase 1 starts with a tiny catalog; a later size increase requires an explicit compatible pagination plan.

Errors are operational: 400 cursor/query, 404 unavailable resource in current scope, 409 snapshot/mode/version conflict, 422 parameter/scope limit, 429 request throttling, 500 sanitized exception, 503 bound evidence/version/integrity unavailable. 401/403 are reserved for a later authenticated deployment and are **not implemented in Phase 1**. Cross-workspace identifiers must not disclose existence when that boundary is added. Backend errors never get mapped to Verified, Mismatch or Unverified business verdicts; the screen shows a request error.

Missing evidence *at evaluation* stays unknown/Pending/Unverified according to Python and appears in references/reasons. An available access-denied receipt is not a successful observation. For `include_payload=false`, payload is null with `omitted_by_request`; stored availability is unchanged. For unavailable/redacted/expired references, payload is null with a reason. If evidence expected to be available cannot be read or its hash fails, Phase 1 returns 503 rather than presenting an unqualified green run. Future retention-driven historical display needs the explicit history policy in [data design](../docs/06_DATA_AND_PERSISTENCE.md).

The OpenAPI file is intentionally JSON-compatible YAML 1.2 and can be parsed with the standard JSON parser without installing dependencies. Draft contract version is `0.1.1-proposed` under API family v1, superseding the independently audited `0.1.0-proposed` draft for reassessment. Freeze/review schema and provider together; unknown verdict enums, removed fields or semantic changes require a new reviewed contract and, for breaking public semantics, `/api/v2`. Changes never authorize an unapproved evaluator version.

## Required frontend edits, when authorized

1. Evolve the existing src/data/provider.ts synchronous MOCK seam into one async provider factory and add a separate HTTP-to-view adapter. MOCK wraps current fixtures; LOCAL_RESEARCH fetches validated DTOs; LIVE stays unavailable. Preserve existing descriptor labels without creating a second mode authority.
2. Replace static store imports in App crumbs, Overview, Verifications and VerificationDetail with provider-backed hooks when each screen is authorized. Handle initial loading, aborts, errors, empty catalog and true 404 independently. Overview implements the bounded snapshot hydration above before using Trace/Exhibits; no new query library is required for the first Detail page.
3. Remove demo workflow/clock imports from the real adapter path. Keep demo startup checks only for MOCK. Do not let `main.tsx` pull mock builders into real mode as a correctness prerequisite.
4. Apply the narrow vNext type changes, stable row identity, nullable workflow label with null-safe search, and conditional copy described above. Add direct rule rows for any returned historical/execution requirement; preserve the operator-spine layout.
5. Make Demo-register/What's-real/fixed-clock/digest hints and the new Settings provider/fixture-source panel mode aware. Preserve synthetic/research-only status in LOCAL_RESEARCH and keep authenticity limits visible. Connections/Rules may remain explicitly labelled static demo/reference configuration, but cannot imply current workspace connections, approved rules or actual backend policy. Browser drafts never enter a real evaluation without future reviewed rule management.
6. Keep existing CSS tokens, typefaces, hatching, seals, traces, responsive layout and keyboard behavior. Show loading/error content in those components rather than replacing the design with generic cards.

Acceptance requires actual Python execution → API serialization → browser network response → rendered state equality for the named run and evidence identity. A screenshot of a hand-built JSON response, a matching label alone, or a MOCK consistency check does not prove this chain. See [integration tests](../docs/08_TEST_STRATEGY.md).
