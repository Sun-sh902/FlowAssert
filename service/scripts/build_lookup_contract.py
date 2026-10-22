"""Build the NEW additive query API contract without touching frozen contracts."""
import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'contracts/openapi-id-addressability-v1.yaml'
IDENTITY = ROOT / 'app/lookup_contract.py'
VERSION = 'phase3a-id-addressability-1.0.0'


def build():
    frozen = (ROOT / 'contracts/openapi-v1-proposed.yaml').read_bytes()
    old = json.loads(frozen)

    def ref(name):
        return {'$ref': '#/components/schemas/' + name}

    def parameter(name, schema, description, required=False):
        return {'name': name, 'in': 'query', 'required': required,
                'style': 'form', 'explode': True, 'allowReserved': False,
                'description': description, 'schema': schema}

    identity = parameter('verification_id', {'type': 'string', 'minLength': 1, 'maxLength': 128},
        'Exact Verification ID: 1..128 Unicode scalar code points, not UTF-16 units or UTF-8 bytes. '
        'UTF-8 percent-encode once with URLSearchParams or an equivalent form query encoder. '
        'A literal + is %2B; literal % is %25; / is %2F. No trimming, normalization, truncation '
        'or second decode. Dot/slash IDs are values, never path segments. Lone surrogates are '
        'not UTF-8 scalar representations. Duplicate names, including encoded equivalents, are 400.', True)
    snapshot = parameter('snapshot_id', {'type': 'string', 'minLength': 1, 'maxLength': 128},
        'Pin to Detail.snapshot_id. Same ephemeral Catalog snapshot as legacy path endpoints.')
    limit = parameter('limit', {'type': 'integer', 'minimum': 1, 'maximum': 100, 'default': 25},
        'ASCII decimal digits only (1..3 digits); keep identical on continuation.')
    cursor = parameter('cursor', {'type': 'string', 'maxLength': 2048},
        'Opaque authenticated token. Forward verbatim through one query encoding. Empty/invalid '
        'tokens are 400 invalid_cursor. Accepted legacy and compact v2 formats share existing '
        'Catalog rules. Authentic unavailable snapshots are 409 snapshot_unavailable.')
    payload = parameter('include_payload', {'type': 'boolean', 'default': True},
        'Wire spelling must be exactly true or false; bound into the cursor.')

    errors = {
        400: 'invalid_query (unknown/duplicate fields, malformed escapes/UTF-8); invalid_cursor; '
             'cursor_query_conflict; unexpected_request_body',
        403: 'host_not_allowed or origin_not_allowed',
        404: 'run_not_found; lookup_route_not_found for noncanonical lookup paths',
        405: 'method_not_allowed (Allow: GET); all methods except GET rejected',
        409: 'snapshot_unavailable or snapshot_conflict, unchanged Catalog distinction',
        414: 'request_target_too_long (origin-form target >4096 bytes)',
        422: 'invalid_parameter (missing/empty/overlength ID, snapshot, cursor cap, limit, flag)',
        500: 'internal_error (sanitized)',
        503: 'Existing source/evaluator/key/snapshot/evidence/schema integrity failure; no business verdict',
    }

    def operation(name, schema, parameters):
        responses = {'200': {'description': 'Existing validated local synthetic DTO, unchanged structure',
            'content': {'application/json': {'schema': ref(schema)}}}}
        responses.update({str(code): {'description': description,
            'content': {'application/json': {'schema': ref('Error')}}}
            for code, description in errors.items()})
        return {'get': {'operationId': name, 'parameters': parameters, 'responses': responses,
            'security': [], 'description': 'Read-only exact-ID alias of the existing Catalog operation. '
            'Cache-Control: no-store. No evaluator calls on reads. Errors are retrieval failures, '
            'never Verified/Mismatch/Pending/Unverified business results.'}}

    return {
        'openapi': '3.1.1',
        'info': {'title': 'FlowAssert additive exact Verification ID lookup', 'version': VERSION,
            'description': 'Owner-authorized backend query transport extension. The frozen Phase0 '
            'and History contracts and existing path routes are unchanged. This additive API does '
            'not repair the legacy path-domain discrepancy retroactively or close P3A-AUD-001.'},
        'servers': [{'url': 'http://127.0.0.1:8765'}],
        'paths': {
            '/api/v1/verification-lookup': operation('lookupVerification', 'VerificationRun', [identity, snapshot]),
            '/api/v1/verification-evidence': operation('lookupVerificationEvidence', 'EvidencePage',
                [identity, snapshot, limit, cursor, payload]),
        },
        'components': copy.deepcopy(old['components']), 'security': [],
        'x-frozen-contract-sha256': hashlib.sha256(frozen).hexdigest(),
        'x-history-contract-sha256': hashlib.sha256((ROOT / 'contracts/openapi-history-v1.yaml').read_bytes()).hexdigest(),
        'x-transport': {
            'query_encoding': 'ASCII URI query containing UTF-8 percent-encoded values; form semantics; + decodes to space',
            'decode_count': 1, 'separator': '&', 'requires_equals': True,
            'unknown_or_duplicate_parameters': '400 invalid_query, including percent-encoded equivalent names',
            'invalid_percent_escape_or_utf8': '400 invalid_query; no replacement decoding',
            'missing_or_empty_id': '422 invalid_parameter',
            'unicode_length': '1..128 scalar code points; scalar controls are supported if percent encoded',
            'raw_fragment': 'Not an identifier transport; # must be %23. Browser fragments never reach HTTP.',
            'request_target_max_bytes': 4096,
            'host': 'Exactly 127.0.0.1:<bound port> (127.0.0.1 also at port80); one Host field',
            'origins': ['http://127.0.0.1:5183', 'http://127.0.0.1:8765'],
            'origin_absent': 'Allowed for local clients; no authentication or CORS grant',
            'request_body': 'GET bodies and Transfer-Encoding rejected',
            'legacy_limits': 'Legacy path endpoints retain dot-segment/slash routing limitations; lone-surrogate '
                             'strings admitted by some JSON Schema tools have no faithful scalar UTF-8 query transport',
        },
        'x-cursor-compatibility': 'Existing Catalog evidence v2 issuance and legacy consumption unchanged; '
            'exact ID digest, query, workspace, mode, contract and snapshot bindings preserved; '
            'path/query cursors interoperable for the same exact ID and snapshot; History namespace unchanged.',
    }


if __name__ == '__main__':
    # Never replace an already published version, even with identical bytes.
    raw = (json.dumps(build(), indent=2, ensure_ascii=True) + '\n').encode('utf-8')
    with DEST.open('xb') as f:
        f.write(raw)
    sha = hashlib.sha256(raw).hexdigest()
    with IDENTITY.open('x') as f:
        f.write('"""Pinned identity of the new additive lookup contract."""\n'
                f'CONTRACT_VERSION = "{VERSION}"\nCONTRACT_SHA256 = "{sha}"\n')
    print(json.dumps({'contract': str(DEST), 'version': VERSION, 'sha256': sha}))
