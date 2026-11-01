"""Additive read-only routes; accepted app.main and its OpenAPI remain unchanged."""
import re
from urllib.parse import unquote
from uuid import uuid4
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from fastapi.exception_handlers import http_exception_handler
from .main import create_app
from .history_store import ArchiveStore, history_spec
from .history_security import HistoryError, history_id as validate_history_id
from .verification_lookup import add_verification_lookup
from .local_boundary import ALLOWED_ORIGINS
from .admission_serialization import legacy_history_response


def create_history_app(directory=None):
    app = create_app()
    store = ArchiveStore(directory)
    app.state.history_store = store

    async def history_error(request, exc):
        details = [{'path': 'archive', 'code': exc.integrity}] if exc.integrity else []
        return JSONResponse(status_code=exc.status, content={'error': {'code': exc.code,
            'message': 'Historical request could not be completed.', 'request_id': str(uuid4()),
            'retryable': exc.status == 503, 'details': details}}, headers={'Cache-Control':'no-store'})
    app.add_exception_handler(HistoryError, history_error)

    @app.exception_handler(HTTPException)
    async def framework_error(request, exc):
        if request.url.path.startswith('/api/v1/history'):
            code = 'method_not_allowed' if exc.status_code == 405 else 'history_route_not_found'
            return await history_error(request, HistoryError(exc.status_code, code))
        return await http_exception_handler(request, exc)

    @app.middleware('http')
    async def history_boundary(request, call_next):
        if request.url.path.startswith('/api/v1/history'):
            raw = request.scope.get('raw_path', b'').decode('ascii', errors='replace')
            decoded = unquote(raw)
            if any(p in ('.','..') for p in decoded.split('/')) or '\\' in decoded or '%' in decoded:
                return await history_error(request, HistoryError(422, 'invalid_history_id'))
            if request.headers.get('origin') is not None and request.headers['origin'] not in ALLOWED_ORIGINS:
                return await history_error(request, HistoryError(403, 'origin_not_allowed'))
            if request.method == 'GET' and (request.headers.get('content-length','0') != '0' or 'transfer-encoding' in request.headers):
                return await history_error(request, HistoryError(400, 'unexpected_request_body'))
        return await call_next(request)

    def query(request, kind):
        allowed = {'snapshot_id'} if kind == 'detail' else {'limit','cursor'} | ({'verification_id'} if kind == 'list' else {'snapshot_id','include_payload'})
        pairs = list(request.query_params.multi_items())
        if any(k not in allowed for k,v in pairs) or len(set(k for k,v in pairs)) != len(pairs):
            raise HistoryError(400, 'invalid_query')
        q = dict(pairs)
        for k, cap in [('cursor',2048),('snapshot_id',128),('verification_id',128)]:
            if k in q and (not q[k] or len(q[k]) > cap): raise HistoryError(422, 'invalid_parameter')
        if kind != 'detail':
            raw = q.get('limit','25')
            if not re.fullmatch('[0-9]{1,3}', raw) or not 1 <= int(raw) <= 100: raise HistoryError(422, 'invalid_parameter')
            q['limit'] = int(raw)
        if 'verification_id' in q and not re.fullmatch('SPEC-00[1-5]', q['verification_id']):
            raise HistoryError(422, 'invalid_parameter')
        if kind == 'evidence':
            flag = q.get('include_payload','true')
            if flag not in ('true','false'): raise HistoryError(422, 'invalid_parameter')
            q['include_payload'] = flag == 'true'
        if 'snapshot_id' in q: q['snapshot'] = q.pop('snapshot_id')
        return q

    @app.get('/api/v1/history')
    def listing(request: Request): return legacy_history_response(store.listing(**query(request, 'list')))

    @app.get('/api/v1/history/verifications')
    def verification_listing(request: Request): return store.listing(**query(request, 'list'))

    @app.get('/api/v1/history/verifications/{history_id}')
    def verification_detail(history_id: str, request: Request): return store.detail(validate_history_id(history_id), **query(request, 'detail'))

    @app.get('/api/v1/history/verifications/{history_id}/evidence')
    def verification_evidence(history_id: str, request: Request): return store.evidence(validate_history_id(history_id), **query(request, 'evidence'))

    @app.get('/api/v1/history/{history_id}')
    def detail(history_id: str, request: Request): return legacy_history_response(store.detail(validate_history_id(history_id), **query(request, 'detail')))

    @app.get('/api/v1/history/{history_id}/evidence')
    def evidence(history_id: str, request: Request): return store.evidence(validate_history_id(history_id), **query(request, 'evidence'))

    @app.get('/api/v1/history/{invalid_path:path}', include_in_schema=False)
    def invalid_path(invalid_path: str): raise HistoryError(422, 'invalid_history_id')

    @app.get('/history-openapi.json', include_in_schema=False)
    def contract(): return history_spec()

    add_verification_lookup(app)
    return app
