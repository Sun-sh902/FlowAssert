# Archived evidence integrity

Retrieval status, stored-content integrity and external source authenticity are separate dimensions. HTTP200 means the requested representation passed required admission checks; it is not acquisition authenticity. All reviewed source provenance stays synthetic_local/research_only/not_authenticated.

Exact accepted algorithm: Python `json.dumps(value,sort_keys=True,separators=(',', ':'),ensure_ascii=True,allow_nan=False).encode('utf-8')`; SHA-256 over those bytes. This is the accepted Service representation, not RFC8785/JCS, generic JSON.stringify, locale sorting, NFC normalization or UTF-16 key sorting. Stored payload BLOBs are the actual canonical bytes checked. Research model.digest uses default=repr and default ensure_ascii; for admitted finite JSON inputs its bytes agree, as independently exercised by the corpus. Unsafe integer/non-finite inputs remain subject to the accepted Adapter restrictions.

Evidence check verifies BLOB decoding, exact re-encoding equality and digest equality against the original reference. All original references, their IDs/order/roles/availability, input-derived payload relationship, expected digest, original snapshot and table inventory must match the original bundle. The candidate's own digest, ID binding, original snapshot proof, full schema/F004 semantics, record order/values, and sealed archive header are checked before a response. include_payload=false never skips checks. Read validation does not recalculate the historical verdict; actual evaluator replay is an ingestion/check evidence activity, not a second verdict engine.

| State | Meaning | Exposure in current scope |
| --- | --- | --- |
| INTEGRITY_VERIFIED | Actual stored canonical bytes reproduce the referenced SHA and required archive relationships validate | Every available evidence item and successfully retrieved archive in the five-case corpus |
| INTEGRITY_FAILED | Digest, canonical form, schema, identity, seal, ordering or relationship contradiction |503 frozen Error, details {path:archive,code:INTEGRITY_FAILED}; no successful body |
| INTEGRITY_UNVERIFIABLE | Required bytes/state cannot be read or expected available content is missing; no success claim |503 with explicit details; missing-at-evaluation helper semantics also preserve null/reason without inventing content |

Root integrity.checked_sha256 identifies candidate bytes; item checked_sha256 identifies canonical payload bytes. The full header SHA is stored in archives.seal, and includes sequence, IDs, creation clock and candidate SHA. Root scope archive_candidate_and_relationships covers the separately verified relational/header checks, not a claim that the candidate SHA alone covers every database column. Error retryable=true means operational503, not automatic repair.

All five reviewed cases have four available references, including SPEC-004's available access-denied receipt. That receipt does not establish an observation timestamp or successful external read. A reviewed missing-at-evaluation/unavailable-reference archive is **not available** in this corpus: pure validation behavior is tested, but a successful HTTP example of it is NOT TESTED and none was fabricated. Unexpected loss of required available evidence blocks publication/read.

Corpus tests cover nested objects, reversed key insertion, Unicode/BMP/astral keys (Python code-point order), astral strings, ints/floats/-0.0/exponents, null, arrays, empty objects, false, zero and missing keys. Mutations cover invalid bytes, valid JSON with wrong digest, omitted payload, foreign reference/snapshot, schema damage, incorrect order, altered verdict/population and metadata including sequence. Real HTTP corrupt-content/schema tests confirm503, even when payload is omitted.

P2-AUD-001: backend rejects failed hashes before unqualified success; frontend must respect server state and cannot label an integrity failure Complete. P2-AUD-002: hashing occurs using the accepted Python bytes, including astral key ordering. Browser recomputation on parsed arbitrary numbers is not promised; the server's stored-byte check is explicitly scoped. No frontend change or frontend verification was performed.

An administrator who controls both content and local digest metadata can consistently replace an entire archive. Internal hash consistency does not authenticate HubSpot/n8n, observation provenance, source population, causality, execution, or business truth. Missing source evidence is never repaired or fabricated.
