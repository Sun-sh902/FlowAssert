"""Additive exact-ID query transport; Catalog remains the business authority."""
import json
import re
from urllib.parse import parse_qsl

from fastapi import Request

from .identity import ROOT, ServiceError, checked_bytes
from .lookup_contract import CONTRACT_SHA256
from .models import EvidencePage, VerificationRun
from .admission_serialization import public_live_run

DETAIL = '/api/v1/verification-lookup'
EVIDENCE = '/api/v1/verification-evidence'
PATHS = (DETAIL, EVIDENCE)
MAX_TARGET_BYTES = 4096
# RFC 3986 query characters. Non-ASCII values must use UTF-8 percent encoding.
QUERY_BYTES = re.compile(rb"[A-Za-z0-9._~!$&'()*+,;=:@/?%\-]*")
BAD_ESCAPE = re.compile(rb'%(?![0-9A-Fa-f]{2})')


def lookup_spec():
    return json.loads(checked_bytes(
        ROOT / 'contracts/openapi-id-addressability-v1.yaml', CONTRACT_SHA256))


def lookup_query(request, evidence=False):
    """Strict form-query decode exactly once; never normalize an identifier."""
    raw = request.scope.get('query_string', b'')
    if not QUERY_BYTES.fullmatch(raw) or BAD_ESCAPE.search(raw):
        raise ServiceError(400, 'invalid_query')
    try:
        pairs = parse_qsl(raw.decode('ascii'), keep_blank_values=True,
                         strict_parsing=True, encoding='utf-8', errors='strict',
                         max_num_fields=5, separator='&')
    except (ValueError, UnicodeError):
        raise ServiceError(400, 'invalid_query') from None
    allowed = {'verification_id', 'snapshot_id'} | (set() if evidence else {'phase3b'})
    if evidence:
        allowed |= {'limit', 'cursor', 'include_payload'}
    if any(k not in allowed for k, _ in pairs) or len({k for k, _ in pairs}) != len(pairs):
        raise ServiceError(400, 'invalid_query')
    q = dict(pairs)
    if 'phase3b' in q and q.pop('phase3b') not in ('true', 'false'):
        raise ServiceError(422, 'invalid_parameter')
    identity = q.pop('verification_id', '')
    if not 1 <= len(identity) <= 128:
        raise ServiceError(422, 'invalid_parameter')
    for name, cap in [('snapshot_id', 128), ('cursor', 2048)]:
        if name in q and (len(q[name]) > cap or (name == 'snapshot_id' and not q[name])):
            raise ServiceError(422, 'invalid_parameter')
    if evidence:
        limit = q.get('limit', '25')
        if not re.fullmatch('[0-9]{1,3}', limit) or not 1 <= int(limit) <= 100:
            raise ServiceError(422, 'invalid_parameter')
        flag = q.get('include_payload', 'true')
        if flag not in ('true', 'false'):
            raise ServiceError(422, 'invalid_parameter')
        q.update(limit=int(limit), include_payload=flag == 'true')
    if 'snapshot_id' in q:
        q['snapshot'] = q.pop('snapshot_id')
    return identity, q


def add_verification_lookup(app, allowed_origins):
    """Install only on the supported Phase3A composed app, leaving Phase1 intact."""
    async def error(request, status, code):
        response = await app.exception_handlers[ServiceError](
            request, ServiceError(status, code))
        if status == 405:
            response.headers['Allow'] = 'GET'
        return response

    @app.middleware('http')
    async def lookup_boundary(request, call_next):
        path = request.url.path
        if any(path == p or path.startswith(p + '/') for p in PATHS):
            raw = request.scope.get('raw_path', b'')
            if path not in PATHS or raw != path.encode('ascii'):
                return await error(request, 404, 'lookup_route_not_found')
            query = request.scope.get('query_string', b'')
            if len(raw) + (1 + len(query) if query else 0) > MAX_TARGET_BYTES:
                return await error(request, 414, 'request_target_too_long')
            if request.method != 'GET':
                return await error(request, 405, 'method_not_allowed')
            # The supported launcher binds only 127.0.0.1; require its actual
            # authority, including the port. This is not authentication.
            port = request.scope['server'][1]
            hosts = request.headers.getlist('host')
            allowed_hosts = {f'127.0.0.1:{port}'}
            if port == 80:
                allowed_hosts.add('127.0.0.1')
            if len(hosts) != 1 or hosts[0] not in allowed_hosts:
                return await error(request, 403, 'host_not_allowed')
            origins = request.headers.getlist('origin')
            if len(origins) > 1 or (origins and origins[0] not in allowed_origins):
                return await error(request, 403, 'origin_not_allowed')
            if (request.headers.get('content-length', '0') != '0'
                    or 'transfer-encoding' in request.headers):
                return await error(request, 400, 'unexpected_request_body')
        return await call_next(request)

    def catalog(request):
        if request.app.state.failure:
            raise request.app.state.failure
        return request.app.state.catalog

    @app.get(DETAIL)
    def lookup(request: Request):
        identity, params = lookup_query(request)
        data = catalog(request).read(identity, **params)['run']
        VerificationRun.model_validate(data)
        return public_live_run(data) if request.query_params.get('phase3b') == 'true' else data

    @app.get(EVIDENCE)
    def lookup_evidence(request: Request):
        identity, params = lookup_query(request, evidence=True)
        data = catalog(request).evidence(identity, **params)
        EvidencePage.model_validate(data)
        return data

    @app.get('/id-addressability-openapi.json', include_in_schema=False)
    def contract():
        return lookup_spec()
