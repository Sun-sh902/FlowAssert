# Controlled evaluator-backed seed pipeline

Supported workspace: `/Users/zhangshenghe/Documents/FlowAssert-Phase3A-Service`. All writes are isolated here. No live data, credentials, connectors, telemetry or external services. .venv is a local byte-copy of locked dependencies; use its Python with -B/module invocation, not copied executable wrapper shebangs pointing at the original environment.

```sh
cd /Users/zhangshenghe/Documents/FlowAssert-Phase3A-Service
export TMPDIR="$PWD/.runtime/tmp"
export PYTHONDONTWRITEBYTECODE=1
.venv/bin/python -B archive_cli.py init
.venv/bin/python -B archive_cli.py seed
.venv/bin/python -B archive_cli.py check
```

Default state: `/Users/zhangshenghe/Documents/FlowAssert-Phase3A-Service/.runtime/delivery` (0700); SQLite/key files0600. init/seed/check never take an arbitrary input file. A --state override must be an isolated private path inside this workspace; it selects runtime state, never a source/evidence import. No mutable accepted runtime secret was copied. No HTTP write route exists.

On the first source-set seed, the unchanged accepted Catalog performs five pinned Adapter/evaluate calls, validates output against the independently authored frozen cases and publishes its original snapshot. The CLI reads actual Catalog bundles, reconstructs and verifies that complete snapshot basis, and archives every ordered result/reference/content. Publication independently replays the same unmodified evaluator for each candidate (five additional calls), validates all source relationships and commits all five plus the registry in one transaction. Actual service_executed_at remains an actual clock; research ticks stay original ticks.

Source-set key binds reviewed fixture bytes, evaluator lock/model digest, original/additive contract digests, accepted source manifest and executed implementation bytes. Identical repeated seed validates/reuses the same five IDs with evaluations=0. Explicit `seed --reevaluate` performs another genuine five-case batch and five publication replays; different actual execution receipts create new archive IDs. The seed registry retains the first ensure batch. Exact candidate publication retry returns an existing ID only after canonical byte equivalence and full stored validation.

| Case | First published history ID | Stored cohort |
| --- | --- | --- |
| SPEC-001 | `hist_230c08845a2e81335c63d9f4876be867828d0bc0cf8b9cbda155782372c84f12` | Verified |
| SPEC-002 | `hist_51a4d6305b0e7b4b82dbe8b757ecf14060189fc47dd2e2f11e933d4613855425` | Mismatch |
| SPEC-003 | `hist_8c50b8a8a684c221be99f719292c660acad02d84a90a933991dcf3b39f125d1b` | Pending |
| SPEC-004 | `hist_da374150e1a47d18302f6a56a3eaf1001f185155505c6bf761183459180dfc09` | Unverified |
| SPEC-005 | `hist_22ad2174cef10586aedf65dd5d734cc009af28e16cd57df2c7170a5863213c61` | Unverified (12 Verified rows; unknown population) |

SPEC-005 contains12 ordered Verified records, Unverified cohort, expected_total=null and source_population_known=false. No source population is inferred from12. First five IDs are from real final CLI/HTTP output; the intentional repeat-evaluation test leaves10 valid entries in the delivery database. Both batches are listed in evidence/http-closeout/delivery-history-ids.json.

Source fixtures originate from the reviewed Service package, never frontend MOCKs. Only the pinned pure evaluator is compiled; no evaluator or frozen contract byte changed. The Service cannot supply authenticated external acquisitions, omitted customer evidence, real n8n/HubSpot events, or source provenance beyond supplied synthetic premises; no such material is invented. All four reviewed references are archived as exposed by the Service; no extra rule receipt is fabricated. The static SPEC-004 example has older diagnostic wording: actual accepted time_projection wording is preserved and separately validated, with code/path unchanged.

Exploratory `.runtime/state`, `.runtime/archive` and `.runtime/history-v1` belong to pre-delivery validation source identities and are retained development artifacts, not the configured delivery store. `*-negative` stores deliberately retain damage. Do not use those paths as runtime state or silently repair them. Current supported schema/contract/implementation applies to `.runtime/delivery`; no compatibility claim is made for pre-delivery experimental databases.
