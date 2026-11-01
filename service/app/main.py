"""Only two business routes. All operational failures use the frozen error envelope."""
from uuid import uuid4
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from .identity import ServiceError
from .service import Catalog
from .validation import SPEC
from .models import VerificationRun, EvidencePage
from .local_boundary import local_request_error
from .admission_serialization import public_live_run


def create_app():
    @asynccontextmanager
    async def lifespan(app):
        try: app.state.catalog=Catalog();app.state.failure=None
        except ServiceError as exc: app.state.catalog=None;app.state.failure=exc
        yield
    app=FastAPI(title='FlowAssert offline research service', lifespan=lifespan)

    @app.exception_handler(ServiceError)
    async def operational_error(request, exc):
        return JSONResponse(status_code=exc.status, content={'error':{'code':exc.code,'message':'Offline request could not be completed.','request_id':str(uuid4()),'retryable':exc.status==503,'details':[]}},headers={'Cache-Control':'no-store'})

    @app.middleware('http')
    async def boundary(request, call_next):
        code = local_request_error(request)
        if code is not None:
            return await operational_error(request, ServiceError(403, code))
        try: response=await call_next(request)
        except Exception:
            response=await operational_error(request,ServiceError(500,'internal_error'))
        response.headers['Cache-Control']='no-store'
        return response

    def query(request, evidence=False):
        allowed={'snapshot_id'} | ({'limit','cursor','include_payload'} if evidence else {'phase3b'})
        pairs=list(request.query_params.multi_items())
        if any(k not in allowed for k,v in pairs) or len({k for k,v in pairs}) != len(pairs): raise ServiceError(400,'invalid_query')
        q=dict(pairs)
        if 'phase3b' in q and q.pop('phase3b') not in ('true', 'false'): raise ServiceError(422,'invalid_parameter')
        for k, cap in [('snapshot_id',128),('cursor',2048)]:
            if k in q and (len(q[k])>cap or (k=='snapshot_id' and not q[k])): raise ServiceError(422,'invalid_parameter')
        if evidence:
            try:
                raw=q.get('limit','25')
                if not raw.isdecimal(): raise ValueError()
                limit=int(raw)
                if not 1<=limit<=100: raise ValueError()
            except ValueError: raise ServiceError(422,'invalid_parameter') from None
            flag=q.get('include_payload','true')
            if flag not in ('true','false'): raise ServiceError(422,'invalid_parameter')
            q.update(limit=limit,include_payload=flag=='true')
        if 'snapshot_id' in q:q['snapshot']=q.pop('snapshot_id')
        return q

    def catalog(request,id):
        if len(id)>128:raise ServiceError(422,'invalid_parameter')
        if request.app.state.failure:raise request.app.state.failure
        return request.app.state.catalog

    @app.get('/api/v1/verifications/{id}')
    def detail(id:str,request:Request):
        data = catalog(request,id).read(id,**query(request))['run']
        VerificationRun.model_validate(data)
        return public_live_run(data) if request.query_params.get('phase3b') == 'true' else data

    @app.get('/api/v1/verifications/{id}/evidence')
    def evidence(id:str,request:Request):
        data = catalog(request,id).evidence(id,**query(request,True))
        EvidencePage.model_validate(data)
        return data

    # Publish the exact reviewed schemas/operations for the two implemented paths.
    def openapi():
        return {**SPEC,'paths':{k:v for k,v in SPEC['paths'].items() if '{id}' in k}}
    app.openapi=openapi
    return app

app=create_app()
