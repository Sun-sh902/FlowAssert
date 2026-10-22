"""Build handoff documents from recorded current-state evidence and source bytes."""
import hashlib,json,os,stat,subprocess,sys
from pathlib import Path
from datetime import datetime,timezone
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from app.identity import canonical,MODEL_HASH,CONTRACT_HASH
from app.history_contract import CONTRACT_SHA256,CONTRACT_VERSION
from app.history_store import ArchiveStore,DEFAULT_STATE,source_identity,schema_signature
D=ROOT/'docs/phase3a';E=D/'evidence';H=E/'http-closeout'

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(name,body):(D/name).write_text(body.strip()+'\n')
xml=ET.parse(E/'regression-closeout.xml');suite=xml.getroot().find('testsuite')
assert suite is not None and int(suite.attrib['failures'])==0 and int(suite.attrib['errors'])==0 and int(suite.attrib['skipped'])==0
count=int(suite.attrib['tests'])
http=json.loads((H/'receipt.json').read_text());assert http['assertions']==204
ids=json.loads((H/'delivery-history-ids.json').read_text())['first_seed']
source,source_set=source_identity()
s=ArchiveStore(); first=s.detail(ids['SPEC-001'])
assert first['provenance']['implementation_sha256']==source['implementation']
assert first['provenance']['source_set_sha256']==source_set
with s.connection() as c:
    schema_hash=hashlib.sha256(canonical(schema_signature(c))).hexdigest()
    version=c.execute('PRAGMA user_version').fetchone()[0]
    total=c.execute('SELECT count(*) FROM archives').fetchone()[0]
assert version==1 and total==10
code={}
for directory in ('app','scripts','tests','fixtures','contracts','migrations','vendor'):
    for p in sorted((ROOT/directory).rglob('*')):
        if p.is_file() and '__pycache__' not in p.parts:code[str(p.relative_to(ROOT))]=sha(p)
for name in ('archive_cli.py','run_history.py','run.py','research-lock.json','pyproject.toml','requirements.lock','.gitignore'):
    code[name]=sha(ROOT/name)
code=dict(sorted(code.items()));source_hash=hashlib.sha256(canonical(code)).hexdigest()
manifest={'source_snapshot_sha256':source_hash,'scope':'Application, launchers, CLI, scripts, tests, fixtures, contracts/examples, migration, evaluator, runtime dependency lock. Excludes docs/evidence, baseline copy, .venv and .runtime. Hash is SHA256 of accepted canonical bytes of files mapping.','files':code}
(D/'SOURCE_MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
identity={'source_snapshot_sha256':source_hash,'implementation_sha256':source['implementation'],'source_set_sha256':source_set,
          'history_contract_version':CONTRACT_VERSION,'history_contract_sha256':CONTRACT_SHA256,
          'frozen_contract_sha256':CONTRACT_HASH,'evaluator_sha256':MODEL_HASH,'schema_version':version,
          'migration_sha256':sha(ROOT/'migrations/001.sql'),'sqlite_schema_signature_sha256':schema_hash,
          'database':str(s.path),'archive_count':total,'initial_history_ids':ids,'git':{'repository':False,'branch':None,'head':None}}
(E/'final-identities.json').write_text(json.dumps(identity,indent=2)+'\n')
rows='\n'.join(f'| {case} | `{hid}` | {verdict} |' for (case,hid),verdict in zip(ids.items(),('Verified','Mismatch','Pending','Unverified','Unverified (12 Verified rows; unknown population)')))
common=f'''Additive contract: `{CONTRACT_VERSION}`, `contracts/openapi-history-v1.yaml`, SHA-256 `{CONTRACT_SHA256}`.
Schema version **1**; migration SHA-256 `{sha(ROOT/'migrations/001.sql')}`; actual sqlite_master signature SHA-256 `{schema_hash}`.
Source snapshot SHA-256 `{source_hash}` (`SOURCE_MANIFEST.json`); executed implementation SHA-256 `{source['implementation']}`; reviewed source-set identity `{source_set}`.
'''
write('PROPOSED_API_CONTRACT.md',f'''
# Phase 3A additive API contract — implemented, locally validated

{common}
The filename was required by the task; these three additive operations are implemented and tested locally. This is not Owner Acceptance. Frozen `contracts/openapi-v1-proposed.yaml` remains `{CONTRACT_HASH}`. Its response shapes and `/openapi.json` remain unchanged; `/history-openapi.json` advertises the separate extension. No route conflicts with the accepted two-operation slice or frozen proposed five-path document.

| Method/path | Parameters | Success |
| --- | --- | --- |
| GET /api/v1/history | limit 1–100/default25; opaque cursor ≤2048; optional verification_id SPEC-001…005 | HistoryList, descending archive sequence, pinned high-water list snapshot |
| GET /api/v1/history/{{history_id}} | history_id `hist_` +64 lowercase hex; optional snapshot_id ≤128 | HistoryDetail with full original `run` |
| GET /api/v1/history/{{history_id}}/evidence | ID; snapshot_id; limit 1–100/default25; cursor; include_payload exact true/false/defaulttrue | HistoryEvidencePage, four original ordered references for this reviewed scope |

No request bodies, update, delete, live-ingestion or write HTTP operations. Unknown/duplicate query parameters →400; malformed bounded parameters →422. IDs are identifiers, never paths/SQL. Dot segments, slash/backslash tricks and residual percent escapes are rejected. Missing history →404; explicit historical snapshot conflict →409. POST/PUT/PATCH/DELETE on a resource →405.

Every success field is required unless the machine contract says otherwise. HistorySummary contains history/archive/persistent snapshot/original snapshot/verification/workspace identities, actual archive_created_at, pinned evaluator, original contract digest, input digest, synthetic provenance, result_summary, and integrity. Detail adds the unchanged original VerificationRun as `run`; its original `run.snapshot_id` is deliberately different from the persistent outer snapshot_id. Four business verdict strings are copied, with row/cohort separate. Nullable expected_total remains null for unknown population. Original optional rule expected/actual keys and raw JSON values are preserved without coercion.

HistoryList page has snapshot_id, next_cursor (string/null), total (archive-entry count, never population). Empty initialized archive →200 items=[], total=0, cursor=null. Missing database →503, with no automatic HTTP initialization. Evidence page repeats all binding identities; items contain original reference/payload/payload_reason plus explicit integrity. Payload omission is null/omitted_by_request, while the server still checks stored bytes. Null next_cursor terminates. Full Detail records are not paged; current bounded maximum is200 inherited source rows. Current fixture evidence inventory is exactly4 and publication enforces it; no large-history capacity benchmark is claimed.

Errors use the unchanged frozen envelope `error.{{code,message,request_id,retryable,details}}`, with details entries {{path,code}}, no business verdict. 400 cursor/query,403 origin,404 missing,405 method,409 snapshot,422 parameter,500 sanitized internal,503 unavailable/corrupt/schema-invalid. For integrity errors details[0] is {{path:"archive",code:"INTEGRITY_FAILED" or "INTEGRITY_UNVERIFIABLE"}}. retryable=true only for503; this does not authorize automatic retry/re-evaluation or imply corruption will self-heal. No 401/auth/rate-limiter guarantee is introduced. All data/error responses use no-store.

`contracts/history-examples.json` contains **37** examples extracted from actual final HTTP captures, all validated against the relevant response schemas (0 failures). `evidence/contract-examples-validation.json` records the contract digest. Do not infer external authenticity from these synthetic outputs.
''')
write('SQLITE_SCHEMA.md',f'''
# SQLite schema and durability choices

{common}
Exact DDL: `migrations/001.sql`. SQLite tested version:3.53.1; Python3.14.7. Ordered tables: archives.sequence INTEGER PRIMARY KEY AUTOINCREMENT; history_id/archive_id/snapshot_id each UNIQUE; immutable verification and original snapshot identities; actual archive creation time; canonical candidate BLOB; candidate SHA; header seal; BUILDING/PUBLISHED state. The header seal includes sequence, all identities, creation time and candidate SHA, so a single sequence rewrite cannot silently change listing order.

records has composite primary key(history_id,position), foreign key to archives, canonical raw evaluator record BLOB and nonnegative explicit order. evidence has primary key(history_id,position), UNIQUE(history_id,reference_id), foreign key to archives, original snapshot, reference BLOB, nullable canonical payload BLOB, reason, and original expected digest. Inventory and semantic relationships are validated beyond SQL constraints. archive_meta stores one database UUID for cursor scoping. seed_sets uniquely maps a complete reviewed source-set identity to the atomic initial five-case batch; its source binding is checked when reused. Index history_verification_sequence supports filtered descending keysets. Application SQL values are parameterized.

Original full bundle, raw input, raw result, full original five-case snapshot basis, rule outcomes and all optional/missing/null fields are canonical JSON BLOBs, not coerced SQL numerics or defaults. Zero, false, null, missing, empty object and empty array remain different bytes. Unknown population is not an archive-record count. No tick is converted into actual observation time; stored projection comes from the accepted Service.

CLI migration path is version0 EMPTY database → version1 via one deterministic executescript transaction; user_version changes atomically with DDL. Existing version1 must match the exact expected sqlite_master signature; unknown versions, extra tables/triggers, nonempty unversioned databases and partial schemas fail closed. Reopening does not recreate or rewrite data. There is no speculative upgrade/downgrade path. Tests cover rollback on malformed migration, unknown schema version, nonempty v0, reopen, foreign keys, and immutable triggers.

Each connection enables and verifies foreign_keys, sets busy_timeout=5000 ms. Writer uses journal_mode=DELETE and verifies synchronous=FULL. WAL is unnecessary for the bounded local single-writer CLI and is not enabled. Readers use mode=ro plus query_only and a read transaction; schema, quick_check and foreign_key_check run within it. No partially written archive is visible. SQLITE errors become sanitized503 rather than fabricated results. Connections close on success/failure, with unfinished transactions rolled back.

Private state directory0700; database and signing keys0600, owner-checked, single hard link, regular file; unsafe symlinks/FIFOs/sidecar paths fail closed. Sensitive runtime paths must stay within private directories under this workspace. Keys are fsynced along with their parent directory. SQLite FULL supports this local crash model; real power-loss, physical storage failure, hostile same-user filesystem races, backups and production administration were not validated. A hot rollback journal may require a controlled CLI `init`/`seed` writer reopen to recover; read-only HTTP may return503 until recovery and does not attempt repair. SQL/admin tools are outside the supported write interface.
''')
write('ARCHIVE_IMMUTABILITY_MODEL.md',f'''
# Archive identity, state and immutability

ABSENT → BUILDING inside an uncommitted transaction → PUBLISHED at commit. An exception/process death before commit rolls back verification, ordered records, evidence and seed registry together. Tests inject faults after the parent row, after an evidence row and before publication; a real child exits73 mid-transaction, then a writer reopen/retry recovers. No half archive is published.

The input identity is SHA-256 of the accepted canonical bytes of the complete candidate: original bundle (including actual execution times and original snapshot), complete original snapshot basis, pinned research/evaluator/source/contract identities and synthetic provenance. IDs are hist_<digest>, archive_<digest>, history-snapshot_<digest>. The original catalog snapshot is recomputed as snapshot-<SHA256(original five pending-publication bundles)> and membership is byte-compared. A correct content hash alone does not permit assigning another original snapshot. The final persistent header additionally seals the database sequence and actual first archive creation time.

Exact candidate retry validates/replays admission, reads and fully validates an existing archive, then proves candidate bytes equal before returning the existing ID. A repeated default CLI seed is an ensure operation: it reads the source-set registry, verifies all five members and their source identity, returns the original IDs with evaluations=0. It does not pretend a new evaluator execution occurred. `seed --reevaluate` runs the actual evaluator again; new real execution receipts/snapshot yield distinct history IDs. The final HTTP proof demonstrates both policies, leaving10 entries (five initial +five explicit reevaluations).

Changed evidence, unsupported evaluator identity and changed original/additive contract identity are explicit admission conflicts (CLI exit1; internal409 codes unsupported_synthetic_source, unsupported_evaluator_identity, unsupported_contract_identity). This authorized CLI accepts only the five reviewed pinned cases; it cannot import arbitrary changed evidence or evaluator versions. No existing archive is overwritten, and no new verdict is manually authored to bypass a conflict. A future new reviewed source/evaluator/contract requires a separately versioned design.

SQL guards prohibit updates/deletes on published archives and children, late child insertions, and seed-registry mutation. HTTP is read-only. Re-evaluation never updates a prior result. Available content corrupted after publication is a503 integrity failure; stored verdicts are not rewritten. Mutations in tests bypass guards only to simulate administrator damage, restore exact trigger definitions, and leave the negative database damaged for inspection.

Immutable means immutable through supported application/CLI/API operations, with read-time internal consistency checks. A database owner can drop triggers, rewrite data and all digest/seal metadata or replace a database. This local design has no external signature/transparency log, administrator-proof immutability or source authentication.
''')
write('ARCHIVE_INTEGRITY_MODEL.md',f'''
# Archived evidence integrity

Retrieval status, stored-content integrity and external source authenticity are separate dimensions. HTTP200 means the requested representation passed required admission checks; it is not acquisition authenticity. All reviewed source provenance stays synthetic_local/research_only/not_authenticated.

Exact accepted algorithm: Python `json.dumps(value,sort_keys=True,separators=(',', ':'),ensure_ascii=True,allow_nan=False).encode('utf-8')`; SHA-256 over those bytes. This is the accepted Service representation, not RFC8785/JCS, generic JSON.stringify, locale sorting, NFC normalization or UTF-16 key sorting. Stored payload BLOBs are the actual canonical bytes checked. Research model.digest uses default=repr and default ensure_ascii; for admitted finite JSON inputs its bytes agree, as independently exercised by the corpus. Unsafe integer/non-finite inputs remain subject to the accepted Adapter restrictions.

Evidence check verifies BLOB decoding, exact re-encoding equality and digest equality against the original reference. All original references, their IDs/order/roles/availability, input-derived payload relationship, expected digest, original snapshot and table inventory must match the original bundle. The candidate's own digest, ID binding, original snapshot proof, full schema/F004 semantics, record order/values, and sealed archive header are checked before a response. include_payload=false never skips checks. Read validation does not recalculate the historical verdict; actual evaluator replay is an ingestion/check evidence activity, not a second verdict engine.

| State | Meaning | Exposure in current scope |
| --- | --- | --- |
| INTEGRITY_VERIFIED | Actual stored canonical bytes reproduce the referenced SHA and required archive relationships validate | Every available evidence item and successfully retrieved archive in the five-case corpus |
| INTEGRITY_FAILED | Digest, canonical form, schema, identity, seal, ordering or relationship contradiction |503 frozen Error, details {{path:archive,code:INTEGRITY_FAILED}}; no successful body |
| INTEGRITY_UNVERIFIABLE | Required bytes/state cannot be read or expected available content is missing; no success claim |503 with explicit details; missing-at-evaluation helper semantics also preserve null/reason without inventing content |

Root integrity.checked_sha256 identifies candidate bytes; item checked_sha256 identifies canonical payload bytes. The full header SHA is stored in archives.seal, and includes sequence, IDs, creation clock and candidate SHA. Root scope archive_candidate_and_relationships covers the separately verified relational/header checks, not a claim that the candidate SHA alone covers every database column. Error retryable=true means operational503, not automatic repair.

All five reviewed cases have four available references, including SPEC-004's available access-denied receipt. That receipt does not establish an observation timestamp or successful external read. A reviewed missing-at-evaluation/unavailable-reference archive is **not available** in this corpus: pure validation behavior is tested, but a successful HTTP example of it is NOT TESTED and none was fabricated. Unexpected loss of required available evidence blocks publication/read.

Corpus tests cover nested objects, reversed key insertion, Unicode/BMP/astral keys (Python code-point order), astral strings, ints/floats/-0.0/exponents, null, arrays, empty objects, false, zero and missing keys. Mutations cover invalid bytes, valid JSON with wrong digest, omitted payload, foreign reference/snapshot, schema damage, incorrect order, altered verdict/population and metadata including sequence. Real HTTP corrupt-content/schema tests confirm503, even when payload is omitted.

P2-AUD-001: backend rejects failed hashes before unqualified success; frontend must respect server state and cannot label an integrity failure Complete. P2-AUD-002: hashing occurs using the accepted Python bytes, including astral key ordering. Browser recomputation on parsed arbitrary numbers is not promised; the server's stored-byte check is explicitly scoped. No frontend change or frontend verification was performed.

An administrator who controls both content and local digest metadata can consistently replace an entire archive. Internal hash consistency does not authenticate HubSpot/n8n, observation provenance, source population, causality, execution, or business truth. Missing source evidence is never repaired or fabricated.
''')
write('SNAPSHOT_AND_CURSOR_MODEL.md',f'''
# Snapshots and cursors

Original ephemeral behavior remains in unchanged app.main/app.service: startup actually evaluates five cases and makes a memory-only catalog snapshot; persistent ephemeral HMAC key authenticates old cursors, but unavailable old snapshot still returns409 snapshot_unavailable after a real restart. An explicit conflicting snapshot returns409 snapshot_conflict; forged/rebound cursors return400. No TTL is invented; the fixed-clock existing test can reproduce the exact same original catalog bytes, which remains valid accepted behavior.

History is a separate persistent namespace. history_id and archive_id bind exact candidate bytes; persistent snapshot_id=history-snapshot_<digest>; original_snapshot_id and nested run.snapshot_id preserve the original evaluation snapshot. A stored five-case snapshot basis proves original catalog identity and exact member inclusion. Do not send a historical snapshot to an ephemeral route or substitute run.snapshot_id for the outer historical snapshot in a history request.

History listing sorts immutable AUTOINCREMENT sequence descending. First page pins max published sequence (upper). Continuations require sequence<=upper and sequence<last returned sequence. A later insert necessarily has a larger sequence, so it is excluded from that chain. No supported deletion/sequence update is available. A list_snapshot ID hashes database UUID, contract, filter, limit and upper. Total counts only published archive entries at the pinned boundary; never infer source population. Explicit reread without cursor starts a new list view.

History cursors: base64url(canonical JSON) + HMAC-SHA256, with strict canonical spelling, bounded length2048, exact field sets/types and signature-first validation. Not encrypted; clients must treat them as opaque. Scope binds database UUID, additive contract digest, endpoint kind, limit, verification filter or history ID, payload option as applicable, persistent snapshot, and strict advancing boundary. Malformed/tampered →400 invalid_cursor; cross-history/query/database/endpoint →400 cursor_query_conflict; explicit conflicting snapshot →409 history_snapshot_conflict. Offset0/non-int/bool/out-of-range/invalid page alignment is rejected for evidence. List bounds and existing filtered boundary are checked. Generated pages strictly advance and cannot cycle.

No TTL or process-epoch field in history cursors. The 0600 history-hmac.key persists across service restart and is separate from the ephemeral key. Deleting/changing it invalidates old history signatures (400); missing/unsafe key fails503 rather than being silently regenerated by HTTP. No rotation/admin key recovery is implemented. Cursor replay yields the same pinned contents; single-use cursors are not claimed. Database replacement/admin edits are outside continuity guarantees.

Real HTTP A→B proof preserved in evidence/http-closeout: old ephemeral cursor409, historical evidence continuation200 at the same snapshot, historical list continuation200 at its original five-entry boundary after10 entries exist, and all first five Detail bodies identical across restart. New inserts during pagination produced no duplicate/omission/reorder. Pagination capacity/performance for an unbounded archive is NOT TESTED.
''')
write('SYNTHETIC_SEED_PIPELINE.md',f'''
# Controlled evaluator-backed seed pipeline

Supported workspace: `{ROOT}`. All writes are isolated here. No live data, credentials, connectors, telemetry or external services. .venv is a local byte-copy of locked dependencies; use its Python with -B/module invocation, not copied executable wrapper shebangs pointing at the original environment.

```sh
cd {ROOT}
export TMPDIR="$PWD/.runtime/tmp"
export PYTHONDONTWRITEBYTECODE=1
.venv/bin/python -B archive_cli.py init
.venv/bin/python -B archive_cli.py seed
.venv/bin/python -B archive_cli.py check
```

Default state: `{DEFAULT_STATE}` (0700); SQLite/key files0600. init/seed/check never take an arbitrary input file. A --state override must be an isolated private path inside this workspace; it selects runtime state, never a source/evidence import. No mutable accepted runtime secret was copied. No HTTP write route exists.

On the first source-set seed, the unchanged accepted Catalog performs five pinned Adapter/evaluate calls, validates output against the independently authored frozen cases and publishes its original snapshot. The CLI reads actual Catalog bundles, reconstructs and verifies that complete snapshot basis, and archives every ordered result/reference/content. Publication independently replays the same unmodified evaluator for each candidate (five additional calls), validates all source relationships and commits all five plus the registry in one transaction. Actual service_executed_at remains an actual clock; research ticks stay original ticks.

Source-set key binds reviewed fixture bytes, evaluator lock/model digest, original/additive contract digests, accepted source manifest and executed implementation bytes. Identical repeated seed validates/reuses the same five IDs with evaluations=0. Explicit `seed --reevaluate` performs another genuine five-case batch and five publication replays; different actual execution receipts create new archive IDs. The seed registry retains the first ensure batch. Exact candidate publication retry returns an existing ID only after canonical byte equivalence and full stored validation.

| Case | First published history ID | Stored cohort |
| --- | --- | --- |
{rows}

SPEC-005 contains12 ordered Verified records, Unverified cohort, expected_total=null and source_population_known=false. No source population is inferred from12. First five IDs are from real final CLI/HTTP output; the intentional repeat-evaluation test leaves10 valid entries in the delivery database. Both batches are listed in evidence/http-closeout/delivery-history-ids.json.

Source fixtures originate from the reviewed Service package, never frontend MOCKs. Only the pinned pure evaluator is compiled; no evaluator or frozen contract byte changed. The Service cannot supply authenticated external acquisitions, omitted customer evidence, real n8n/HubSpot events, or source provenance beyond supplied synthetic premises; no such material is invented. All four reviewed references are archived as exposed by the Service; no extra rule receipt is fabricated. The static SPEC-004 example has older diagnostic wording: actual accepted time_projection wording is preserved and separately validated, with code/path unchanged.

Exploratory `.runtime/state`, `.runtime/archive` and `.runtime/history-v1` belong to pre-delivery validation source identities and are retained development artifacts, not the configured delivery store. `*-negative` stores deliberately retain damage. Do not use those paths as runtime state or silently repair them. Current supported schema/contract/implementation applies to `.runtime/delivery`; no compatibility claim is made for pre-delivery experimental databases.
''')
write('HTTP_TEST_RESULTS.md',f'''
# Current local test and HTTP evidence

Final pytest: **{count} passed, 0 failed, 0 skipped, 0 errors**;88 unchanged accepted tests +{count-88} new history tests. Command: `.venv/bin/python -B scripts/run_checks.py regression-closeout tests`. Exact subprocess argv/cwd/PID/timestamps/exit0/stream digests: evidence/regression-closeout.command.json; full log and JUnit XML alongside. One inherited Starlette/httpx deprecation warning is recorded; dependencies remain the accepted lock. It does not skip a test.

Final real process probe: **204 assertions, 45 HTTP captures, exit0**, three loopback service processes stopped (SIGTERM exit -15 after cleanup). Exact parent command: `.venv/bin/python -B scripts/runtime_probe.py`; receipt evidence/http-runtime-closeout.command.json. Child CLI receipts/streams are prefixed http-closeout-seed-*; HTTP request paths, statuses, headers, bodies and body SHA-256 are evidence/http-closeout/001…045-*.json. No UI/browser/frontend test was run. Network guards record zero unauthorized socket connects during all controlled CLI/server entries; no external service or real API was contacted. This is scoped runtime observation and fail-closed guarding, not an OS-wide packet capture.

Real HTTP coverage: five actual evaluator-backed old/new Detail responses;20 original archived reference digests; exact row/cohort/unknown-population comparisons against separately fixed expectations and direct pure replay; signed evidence/list pagination; explicit reevaluation while a pinned list is in flight; repeated seed; invalid/tampered/rebound cursors;404/400/403/405/409/422; genuine A→B restart; old cursor409 while persistent cursor200; unchanged historical bodies; corrupt stored evidence and invalid schema503, including omitted payload. Direct evaluator comparison objects are evidence/http-closeout/direct-evaluator-comparisons.json.

SQLite/process tests additionally exercise exception rollback at three points, actual os._exit(73) mid-write, writer recovery and retry, exact-input idempotency, altered evaluator/evidence/contract conflicts, ordered records, missing evidence, schema/canonical/digest mutations, correct digest/wrong binding, foreign keys, immutable triggers, migration rollback/reopen/unknown versions, unsafe modes/symlinks/hardlinks/FIFO/sidecar paths and strict cursor shape. SQL mutation tests restore guard definitions solely to test damage detection; they never repair damaged archived content.

All37 extracted history response examples validate against the additive/frozen schemas with0 failures, via `.venv/bin/python -B scripts/contract_examples.py`; evidence/contract-examples-validation.json. The OpenAPI validator also passes in test_contract_validation.

Earlier attempts remain intact: initial seed refused SPEC-004 diagnostic-message mismatch and published no batch; normalization was limited to independently checked accepted diagnostic projection. history-first:86 passed/1 failure from an expected-code spelling difference (actual503 was correct). regression-01:180 passed/1 failure because an overbroad legacy integrity baseline included review-owned unreadable0000 test keys; the protected original script was unchanged. A separately documented Phase3A current-window six-root baseline, in the unchanged original script's supported shape, was then prepared. No historical acceptance baseline or failure was overwritten. regression-02:181/0; closeout adds sealed ordering and exact SQLite internal-prefix validation with dedicated mutation regressions, {count}/0. http-runtime-01 is pre-final local evidence; only http-runtime-closeout binds the delivered implementation.

Original integrity test uses this task's explicit current-window evidence/protected-before.json for its original six roots. The independent Phase3A eleven-root snapshots additionally include file metadata, external Git administration and all historical evidence without reading secret contents. Accepted test/source files remain byte-identical apart from the isolated evaluator location in app/identity.py; no existing test was weakened or deselected.

NOT TESTED: frontend, general arbitrary-input ingestion (not supported), successful unavailable-reference archive HTTP fixture (none reviewed), production/multi-user deployment, live acquisition, auth/rate limiting, malicious administrator with fully rewritten metadata, physical power loss, OS-wide egress monitoring or large-scale capacity. All current backend test scenarios have0 skips; these explicit scope gaps are not converted into passed tests.
''')
write('FRONTEND_HANDOFF.md',f'''
# Claude Code — Phase 3A frontend integration handoff

**READY FOR PHASE 3A FRONTEND INTEGRATION** — backend local recommendation, not Owner Acceptance. No frontend development or test has been performed. Do not start Phase3B or live connectors/deployment under this handoff.

{common}
Exact identities: evidence/final-identities.json. All code/config/test/contract digests: SOURCE_MANIFEST.json. Original model SHA-256 `{MODEL_HASH}`; original frozen contract `{CONTRACT_HASH}` unchanged. Original app.main/app.service routes and response shapes remain frozen; Phase3A composes them in app.history_api and publishes its separate spec at /history-openapi.json.

```sh
cd {ROOT}
export PYTHONDONTWRITEBYTECODE=1
export TMPDIR="$PWD/.runtime/tmp"
.venv/bin/python -B archive_cli.py seed
.venv/bin/python -B archive_cli.py check
.venv/bin/python -B run_history.py
# Ctrl-C to stop this owned service.
```

Server is fixed to http://127.0.0.1:8765. Verify the port is free; never kill an unrelated listener. Default SQLite `{s.path}`; private state0700, database/history key/ephemeral key0600. Launcher validates private state and safely prepares the separate ephemeral key. No auth is claimed. No CORS middleware/allow-origin response is enabled. Use an authorized same-origin dev proxy. Exact accepted Origin header values for history are http://127.0.0.1:5183 and http://127.0.0.1:8765; other Origins get403; Origin absent is allowed for local clients. This is an origin check, not authentication. No frontend proxy/config file was edited here.

| Case | Initial history ID | Stored cohort |
| --- | --- | --- |
{rows}

There are10 delivery entries after explicit reevaluation testing; preserve both batches. A default seed returns the initial five IDs, does not reevaluate, and leaves historical bytes unchanged. List API must use history_id as the route key, never assume original SPEC ID uniquely identifies an evaluation. Current histories are all workspace ws-synthetic-01 / LOCAL_RESEARCH / synthetic / research_only.

```sh
curl --noproxy '*' 'http://127.0.0.1:8765/api/v1/history?limit=2'
curl --noproxy '*' 'http://127.0.0.1:8765/api/v1/history/{ids['SPEC-005']}'
curl --noproxy '*' 'http://127.0.0.1:8765/api/v1/history/{ids['SPEC-001']}/evidence?limit=1'
```

Use returned next_cursor verbatim with the same limit/filter/payload option; query-encode it. List continuation retains its original high-water snapshot even across new inserts/restart. History evidence continuation binds history_id, persistent snapshot_id, database and payload scope. Optional snapshot_id should be the outer historical value; nested run.snapshot_id is the original catalog snapshot and is a different namespace. Null next_cursor terminates; concatenate evidence reference objects in exactly Detail.run.evidence_references order, with no duplicates, omissions, cycles or cross-history merge. Full historical records/rules are in run.result; do not build them from result_summary/counts. row/cohort verdicts remain distinct. SPEC-005 total is unknown, never0 or12.

Actual full response examples, captured request paths and working continuation tokens: contracts/history-examples.json and evidence/http-closeout/. Files containing list-pinned-continuation, history-after-restart-page2 and list-after-restart demonstrate continuation. Tokens work only with the delivered database/key/scope and are not generic reusable fixtures. The 37 examples were schema-validated; no frontend provider/type-generation validation is implied.

| Error | Meaning / UI obligation |
| --- | --- |
|400 invalid_cursor/cursor_query_conflict/invalid_query | Request failed; never a verdict or stale-run replacement |
|403 origin_not_allowed | Local origin policy refused |
|404 history_not_found | Identifier absent; never invent rows |
|405 method_not_allowed | Read-only API |
|409 history_snapshot_conflict | Explicit history pin conflict; do not fall forward or mix snapshots |
|422 invalid_history_id/invalid_parameter | Malformed ID/path/query |
|500 internal_error | Sanitized request failure |
|503 archive/evidence/schema/key failure | Inspect error.details integrity code; no unqualified Complete/Verified integrity display |
|Old endpoint409 snapshot_unavailable | Original ephemeral restart behavior; discard old evidence pages and explicitly re-read as previously accepted |

A business Verified/Mismatch/Pending/Unverified is an HTTP200 archived result, not retrieval/integrity status. INTEGRITY_VERIFIED refers to exact stored Python canonical bytes and validated archive relationships; failed hashes block200. INTEGRITY_FAILED and INTEGRITY_UNVERIFIABLE are explicit error details. include_payload=false keeps null/omitted_by_request while checking stored content. Do not turn browser canonicalization inability into external-authenticity claims or overwrite the server's verdict. P2-AUD-001/002 handling is documented in ARCHIVE_INTEGRITY_MODEL.md. Successful unavailable-reference HTTP archival was not fabricated and remains untested because no reviewed source fixture supplies it.

Limits: only five reviewed synthetic source shapes; changed evidence/evaluator/contract is a documented conflict, no arbitrary import. No HubSpot/n8n acquisition, customer data, credentials, external provenance proof, administrator-proof immutability, production hardening, key rotation, cloud deployment or frontend acceptance. Historical queries validate stored evidence; they do not rerun/update the result. Software/schema migrations beyond empty0→1 are unsupported and fail closed.

Exact regression command: `.venv/bin/python -B scripts/run_checks.py NEW-LABEL tests` ({count} passed/0 failed/0 skipped in final run;88 original regressions). To repeat the real process probe, use fresh paths and retain prior evidence: `.venv/bin/python -B scripts/runtime_probe.py --state "$PWD/.runtime/recheck-NEW" --output "$PWD/docs/phase3a/evidence/http-recheck-NEW"`. This creates a distinct synthetic test database and temporarily owns8765; do not rerun against existing delivery state. The probe never clears existing archives. Documentation is complete; backend work stops here.
''')
# Source/protection report will be completed by the final readback tool.
write('SOURCE_INTEGRITY.md',f'''
# Source, runtime and protected-workspace integrity

{common}
Gate0 accepted snapshot:34/34 source files match the latest independent Service manifest, with source bytes copied into baseline/FlowAssert-Service and the implementation root. Current source snapshot SHA covers the explicit files mapping in SOURCE_MANIFEST.json, including tests, CLI, additive contract, exact model, fixtures, scripts and dependency lock. Evidence final-identities.json also binds the executed implementation digest to stored first-seed provenance; current code matches the final HTTP execution. SHA-256 identifies bytes, not source authenticity or execution causality by itself.

Protected roots (all strictly read-only): FlowAssert-Service, FlowAssert-UI, FlowAssert-Service-Review, FlowAssert-UI-Review, FlowAssert-Phase2-Support, FlowAssert-Phase2-Review, FlowAssert-round03-oracle-fix, FlowAssert-Integration-Planning, FlowAssert-Integration-Review, FlowAssert-Integration-Reassessment and FlowAssert-Integration-Final-Audit. Baseline evidence/protected-before.json includes79,130 objects, lstat metadata (excluding access time), symlink targets, SHA for regular non-secret files, raw Git HEAD/branch/status/untracked/ignored/index observations, and external Git administrative trees. Secret key contents/digests are deliberately not collected by that full audit. Before/after evidence/protected-comparison-after.json reports0 changed objects, all Git observations equal and all external administration equal across all11 roots. A later final readback is evidence/protected-comparison-final.json. No Git write command/worktree/shared administrative state/hardlink source copy was used.

This workspace was initially empty and is not a Git repository; initial/final branch and HEAD are unavailable (git exit128), not invented. Complete changed-source inventory versus the 34-file accepted snapshot: evidence/changed-source-files.json. Complete workspace file inventory including copied baseline/dependencies/runtime metadata: evidence/workspace-files.json; secret runtime state is metadata-only. Copied dependency byte comparison: evidence/dependency-copy-comparison.json. No protected source was modified or tests run in it; tests use copied code/dependencies/model, -B and isolated TMPDIR/cache/key/database paths. Base interpreter symlinks are read-only runtime references, not mutable source hardlinks.

Current runtime is `.runtime/delivery` only. Keys/database0700/0600 checked; actual schema1 and signature above. Early exploratory databases and negative test databases are retained as test artifacts and explicitly excluded from the configured store. Do not clean/rebaseline them to erase observed failures. Original historical reports/acceptance evidence remain untouched. Original six-root test uses this task's documented current-window legacy-shaped baseline, supplemented by the stronger11-root full observations; it does not make historical failures pass retrospectively.

All final tests/HTTP have recorded command exits and raw streams. Earlier failures are preserved in history-first/regression-01 and pre-final http evidence. Test-process cleanup and full local listener observation are evidence/process-cleanup.json; the owned8765 listener is absent. No frontend processes were started. No code was staged, committed, merged, reset, cleaned, switched or pushed.
''')
matrix=[
('A01','Accepted baseline identity','test_A01_A33_baseline; baseline-source.json'),
('A02','Original API compatibility','88 unchanged original tests; test_A02_old_and_composed_app_same_catalog_shape; real HTTP'),
('A03–A06','Five evaluator results / rows / cohort / SPEC005','test_A03_A06_direct_evaluator_archive ×5; direct-evaluator-comparisons.json'),
('A07','Transaction atomicity','test_A07_A26_transaction_exception_and_crash, three fault points'),
('A08','SQLite restart persistence','real process A→B; all first five Detail bodies byte-equivalent as JSON'),
('A09–A10','Uniqueness and idempotency','test_A09_A10_A15_idempotency_and_new_evaluation; guarded CLI repeats'),
('A11–A12','Changed evidence/evaluator identity','test_A11_A12_changed_inputs_documented_conflict ×3;409 admission conflict'),
('A13–A16','Record/reference/snapshot/evidence order','test_A13_A16_ordered_evidence ×10; original snapshot digest/membership; HTTP continuation'),
('A17','Concurrent insert pagination','test_A17_new_inserts_during_list_pagination; real HTTP CLI insert between pages'),
('A18','Invalid history IDs','test_A18_invalid_ids ×10; actual encoded-dot request'),
('A19–A21','Tampering/cross-history/cross-query','test_A19_A21_cursor_bindings ×8; cross_filter; strict_cursor; real HTTP'),
('A22','Missing evidence','test_deleted_reference_stops_publication_and_read; missing payload mutation; no fabricated unavailable source'),
('A23–A25','Corrupt/digest/schema-invalid content','test_A14_A22_A25_mutations ×10; updated_outer_hash; real negative HTTP'),
('A26','Interrupted transaction','actual os._exit73, journal recovery, repeat seed'),
('A27','Reopen/migration','test_A27_reopen_migrations; test_migration_rollback'),
('A28','SQL constraints','test_A28_constraints_and_immutability; FK ON/UNIQUE/PK/nonnegative constraints in schema'),
('A29–A30','Malformed HTTP / structured errors','test_A29_A30_malformed_list ×8; methods_origins_snapshots; real statuses/captures'),
('A31','Old ephemeral restart409','original cursor tests; actual A→B ephemeral-restart-409.json'),
('A32','No unauthorized outbound traffic','test-only guarded CLI/server socket audits;0 external attempts; no OS-wide monitoring claim'),
('A33','Evaluator unchanged','baseline test; vendor SHA equals original pinned model'),
('A34','Protected workspaces unchanged','eleven-root before/after/final hashes+metadata+Git comparison')]
mat='\n'.join(f'| {n} | {topic} | {proof} |' for n,topic,proof in matrix)
write('PHASE3A_BACKEND_REPORT.md',f'''
# Phase 3A backend implementation report

**READY FOR PHASE 3A FRONTEND INTEGRATION**

This is a locally validated backend recommendation, not independent acceptance or Owner Acceptance. Phase3B, frontend implementation, live APIs and deployment were not started. Authorization came from the Owner's current specification and applied only to this isolated workspace.

{common}
Implemented: local SQLite immutable verification/evidence history; atomic controlled evaluator-backed CLI seed/re-evaluation; persistent historical snapshots; three additive GETs; signed stable history/evidence pagination across restart; exact Python-byte evidence integrity; schema/relationship validation; safe local filesystem/runtime handling; machine OpenAPI/examples; complete frontend handoff. Existing accepted business endpoints retain their original code/shape/restart behavior (only local evaluator path relocated).

Current validation: **{count} pytest passed /0 failed /0 skipped /0 errors**, including **88/88 original Phase1/2 regression tests** and {count-88} new history tests. **204 real HTTP/process assertions**,45 captures,37 validated contract examples,0 example failures. Exact command receipts bind argv/PID/cwd/exits/streams. Real server restart proves old cursor409 alongside historical cursor200. Genuine mid-transaction child exit73 and retry are tested. One dependency deprecation warning remains. No frontend test claim is made.

The delivery database has10 immutable evaluations: five reviewed cases initially archived, followed by five explicit actual reevaluations for pagination/restart tests. Default seed safely reuses the original first five. All business results originate from pinned Python execution and direct replay, with independent fixed verdict expectations. SPEC005 preserves12 Verified records /Unverified cohort /unknown population.

| Case | First history ID | Cohort |
| --- | --- | --- |
{rows}

## Required backend matrix (current local evidence)

| ID | Requirement | Evidence |
| --- | --- | --- |
{mat}

## Gate1/Gate2 self-review counterexamples

1. Same case/different evaluator: explicit unsupported identity conflict, no overwrite.
2. Crash after parent/before evidence: real exit73 rolls back and retry commits full five-case batch.
3. Cursor at foreign history:400 query conflict; no evidence disclosed.
4. Insert during listing: cursor high water excludes all newly inserted archives; existing order unchanged.
5. Correct digest/wrong snapshot: complete original snapshot digest/membership plus table binding refuse it.
6. Post-publication database mutation: guards reject supported writes; bypassed guards still encounter candidate/header/reference/schema checks, including sealed sequence.
7. Unknown population rewritten0: both original digest and rehashed-semantic mutation fail; no invented population.
8. Restart between evidence pages: historical200 at original persistent snapshot; old ephemeral409 remains.
9. Repeated CLI seed: same five IDs, evaluations=0; explicit reevaluation adds five distinct IDs.
10. Accidental old Detail extension: original app.main bytes unchanged; returned frozen shape contains no history fields; original88 tests pass.

Confirmed issues found during implementation were corrected within the isolated backend scope: SPEC004 diagnostic projection compared to actual accepted behavior; complete original snapshot membership was added; sequence was included in the header seal; SQL schema introspection now uses a literal underscore in the reserved sqlite_ prefix rather than a LIKE wildcard. No evaluator/frozen contract/accepted repository correction was needed. Earlier failures and pre-final results remain historical evidence; final assertions apply to final source only.

## Integrity, process and scope boundaries

11 protected workspaces:0 changed objects in before/after comparison; Git state/external administration unchanged. Final readback result is in evidence/protected-comparison-final.json. No source hardlinks, shared-worktree state, protected test execution, commits/merges/pushes or reset/clean actions. Keys/database stay isolated. Three final HTTP service processes are stopped; no8765 listener remains. Network-guard observations show0 unauthorized external connects for controlled entries.

Limits: only five reviewed synthetic source shapes; changed evaluator/evidence/contract imports are explicit conflicts. No external authenticity, acquisition proof, administrator-proof immutability, production multi-user/durability guarantee, rotation, general migration framework, cloud system, customer data or telemetry. Missing-at-evaluation unavailable archive HTTP success has no reviewed fixture and is NOT TESTED; pure uncertainty handling and unexpected missing required evidence are tested. Physical power-loss, large archive scale, OS-wide egress capture and frontend behavior are not verified. No missing evidence or verdict was fabricated to fill those gaps.

Frontend handoff: `docs/phase3a/FRONTEND_HANDOFF.md`. Mandatory documents and machine contract are present; actual examples and exact identities accompany them. Backend work stops after handoff. This is not Owner Acceptance.
''')
(ROOT/'README.md').write_text(f'''# FlowAssert Phase 3A — local persistent verification history

READY FOR PHASE 3A FRONTEND INTEGRATION (backend local recommendation; not Owner Acceptance).

{count} tests pass, including88 accepted regressions;204 actual HTTP/process assertions. SQLite schema1. Five reviewed synthetic cases;10 stored evaluations after explicit replay testing. No frontend work, live APIs or deployment.

Start here: [backend report](docs/phase3a/PHASE3A_BACKEND_REPORT.md), [Claude frontend handoff](docs/phase3a/FRONTEND_HANDOFF.md), [additive OpenAPI](contracts/openapi-history-v1.yaml), [source manifest](docs/phase3a/SOURCE_MANIFEST.json).

```sh
cd {ROOT}
export TMPDIR="$PWD/.runtime/tmp"
export PYTHONDONTWRITEBYTECODE=1
.venv/bin/python -B archive_cli.py seed
.venv/bin/python -B archive_cli.py check
.venv/bin/python -B run_history.py
```

Fixed loopback127.0.0.1:8765; stop with Ctrl-C. Supported current state: .runtime/delivery (0700); database/keys0600. Existing default seed validates/reuses its first five IDs. To record a genuine new batch use seed --reevaluate. No arbitrary import or HTTP write endpoint.

Regression: `.venv/bin/python -B scripts/run_checks.py NEW-LABEL tests`. Use a fresh label to preserve evidence. For real HTTP replay, use scripts/runtime_probe.py with fresh --state and --output paths as documented in the handoff; it refuses to replace existing delivery state.

Original Phase1 reports/files are retained from the accepted source snapshot and describe historical phases; the current Phase3A report above governs this delivery. Pre-final exploratory and deliberately damaged negative databases are retained as test artifacts and must not be substituted for the configured store. Internal hashes authenticate neither external sources nor administrator-controlled data.
''')
print(json.dumps(identity,indent=2));print(f'{count} passing tests;12 required documents prepared')
