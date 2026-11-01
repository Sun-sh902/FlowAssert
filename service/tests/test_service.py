import copy
import json
import os
from pathlib import Path
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from openapi_spec_validator import validate
from app.main import create_app
from app.identity import ROOT, ServiceError, digest, MODEL_HASH
from app.adapter import Adapter, validate_input
from app.validation import SPEC, schema, validate_run, validate_item, time_projection

CASES=json.loads((ROOT/'contracts/verification-examples.json').read_text())['examples']
EXPECTED=[('Verified',['Verified']),('Mismatch',['Mismatch']),('Pending',['Pending']),('Unverified',['Unverified']),('Unverified',['Verified']*12)]

@pytest.fixture
def client():
    with TestClient(create_app(), base_url='http://127.0.0.1:8765') as client: yield client

@pytest.mark.parametrize('i',range(5))
def test_real_execution_and_http(client,i):
    case=CASES[i]; id=case['proposed_response']['identity']['id']
    response=client.get('/api/v1/verifications/'+id)
    assert response.status_code==200
    r=response.json();schema('VerificationRun',r)
    assert r['result']==case['proposed_response']['result']
    assert (r['result']['cohort_state'],[x['state'] for x in r['result']['records']])==EXPECTED[i]
    assert r['evaluation_context']['service_executed_at'] is not None
    assert r['evaluation_context']['evaluator']['model_sha256']==MODEL_HASH
    assert r['evaluation_context']['input_evidence_sha256']==digest(case['input_evidence'])
    assert r['meta']['synthetic'] is True
    assert r['assurance']['research_authorization']=='research_only'
    assert response.headers['cache-control']=='no-store'
    calls=client.app.state.catalog.adapter.calls
    assert len(calls)==5 and calls[i]['result_sha256']==digest(r['result'])
    for _ in range(2):client.get('/api/v1/verifications/'+id)
    assert len(calls)==5


def test_adapter_spy():
    evidence=CASES[0]['input_evidence'];before=copy.deepcopy(evidence)
    from app.identity import load_evaluator
    evaluator=load_evaluator()
    with patch('app.adapter.load_evaluator',return_value=evaluator) as load:
        result,at=Adapter().evaluate(evidence)
    assert load.call_count==1 and result==CASES[0]['proposed_response']['result'] and evidence==before

@pytest.mark.parametrize('suffix,status', [('missing',404),('SPEC-001?snapshot_id=expired',409),('SPEC-001?unknown=1',400),('SPEC-001?snapshot_id=',422),('SPEC-001/evidence?limit=0',422),('SPEC-001/evidence?limit=101',422),('SPEC-001/evidence?include_payload=1',422),('SPEC-001/evidence?cursor=bad',400),('SPEC-001?x=y',400),('SPEC-001?snapshot_id=a&snapshot_id=b',400)])
def test_errors(client,suffix,status):
    r=client.get('/api/v1/verifications/'+suffix)
    assert r.status_code==status;schema('Error',r.json());assert 'result' not in r.json()


def test_pagination(client):
    root='/api/v1/verifications/SPEC-001';detail=client.get(root).json(); params={'limit':1,'snapshot_id':detail['snapshot_id']};items=[]
    while True:
        r=client.get(root+'/evidence',params=params);assert r.status_code==200
        page=r.json();schema('EvidencePage',page);items+=page['items']
        assert page['page']['snapshot_id']==detail['snapshot_id']
        token=page['page']['next_cursor']
        if token is None:break
        params['cursor']=token
    assert [x['reference'] for x in items]==detail['evidence_references']
    for item in items:assert digest(item['payload'])==item['reference']['sha256']
    token=client.get(root+'/evidence?limit=1').json()['page']['next_cursor']
    for query,status in [({'limit':2,'cursor':token},400),({'limit':1,'cursor':token,'include_payload':'false'},400),({'limit':1,'cursor':token,'snapshot_id':'wrong'},409),({'limit':1,'cursor':token+'x'},400)]:
        r=client.get(root+'/evidence',params=query);assert r.status_code==status;schema('Error',r.json())
    assert client.get('/api/v1/verifications/SPEC-002/evidence',params={'limit':1,'cursor':token}).status_code==400


def test_payload_omission_and_denied_receipt(client):
    for id in ['SPEC-001','SPEC-004']:
        page=client.get(f'/api/v1/verifications/{id}/evidence?include_payload=false').json()
        assert all(x['payload'] is None and x['payload_reason']=='omitted_by_request' for x in page['items'])
        assert all(x['reference']['availability']=='available' for x in page['items'])
    r=client.get('/api/v1/verifications/SPEC-004').json()
    assert r['result']['observed_at'] is None and r['evaluation_context']['event_times']['observed_at'] is None
    assert any(x['code']=='missing_time_tick' for x in r['diagnostics'])

MUTATIONS=[
 ('unmapped_parameters',lambda r:r['evaluation_context']['time_mapping'].update(kind='unmapped')),
 ('affine_parameters',lambda r:r['evaluation_context']['time_mapping'].update(origin_iso=None)),
 ('present_value_null',lambda r:r['source_snapshot']['rows'][0]['phone'].update(value=None)),
 ('unavailable_value_invented',lambda r:r['source_snapshot']['rows'][0]['phone'].update(state='missing')),
 ('approval_reference_invalid',lambda r:r['assurance'].update(research_authorization='approved_for_product_use')),
 ('unknown_population_total',lambda r:r['result'].update(source_population_known=False,expected_total=0)),
]
@pytest.mark.parametrize('code,mutate',MUTATIONS)
def test_f004_runtime(code,mutate,client):
    # All six inputs remain schema-valid; rejection must come from runtime application checks.
    bundle=client.app.state.catalog.read('SPEC-001');run=bundle['run'];mutate(run);schema('VerificationRun',run)
    with pytest.raises(ServiceError) as error:validate_run(run,bundle['input'],bundle['raw'])
    assert error.value.status==503 and error.value.code==code


def test_f004_unavailable_payload(client):
    item=client.app.state.catalog.read('SPEC-001')['items'][0]
    item['reference']['availability']='unavailable';schema('EvidenceItem',item)
    with pytest.raises(ServiceError) as err:validate_item(item)
    assert err.value.code=='unavailable_payload'
    item.update(payload=None,payload_reason='not available at evaluation');validate_item(item)

@pytest.mark.parametrize('change', ['input','reference','count','context','scope','raw','snapshot'])
def test_corruption_rejected_http(client,change):
    catalog=client.app.state.catalog;bundle=catalog.read('SPEC-001')
    if change=='input':bundle['input']['now']=13
    if change=='reference':bundle['items'].reverse()
    if change=='count':bundle['run']['result']['counts']['Verified']=2
    if change=='context':bundle['run']['source_snapshot']['rows'][0]['phone']['value']='wrong'
    if change=='scope':bundle['run']['meta']['workspace_id']='other'
    if change=='raw':bundle['run']['result']['records'][0]['rules']['phone']['reason']='edited'
    if change=='snapshot':bundle['run']['snapshot_id']='other'
    from app.identity import canonical
    catalog._runs['SPEC-001']=canonical(bundle)
    # Keep original seal: any changed published bytes must fail closed, never return old success.
    r=client.get('/api/v1/verifications/SPEC-001');assert r.status_code==503;schema('Error',r.json())


def test_version_drift(client):
    with patch('app.identity.MODEL_HASH','0'*64):
        r=client.get('/api/v1/verifications/SPEC-001');assert r.status_code==503;schema('Error',r.json())
        with pytest.raises(ServiceError):Adapter().evaluate(CASES[0]['input_evidence'])

@pytest.mark.parametrize('value',[2**53,float('nan'),float('inf')])
def test_unsafe_input(value):
    e=copy.deepcopy(CASES[0]['input_evidence']);e['now']=value
    with pytest.raises(ServiceError) as error:validate_input(e)
    assert error.value.status==422


def test_limits():
    for mutate in [lambda e:e['source'].update(rows=[{}]*201),lambda e:e.update(extra='x'*1048577)]:
        e=copy.deepcopy(CASES[0]['input_evidence']);mutate(e)
        with pytest.raises(ServiceError) as error:validate_input(e)
        assert error.value.status==422


def test_time_mapping():
    raw=copy.deepcopy(CASES[0]['proposed_response']['result']);raw['observed_at']=True
    events,diags=time_projection(raw,{'kind':'unmapped','origin_iso':None,'seconds_per_tick':None})
    assert all(v is None for v in events.values())
    assert {x['code'] for x in diags}=={'invalid_time_tick','time_mapping_unavailable'}


def test_openapi_and_scope(client):
    validate(SPEC);validate(client.get('/openapi.json').json())
    assert set(client.get('/openapi.json').json()['paths'])=={'/api/v1/verifications/{id}','/api/v1/verifications/{id}/evidence'}
    assert client.post('/api/v1/verifications/SPEC-001').status_code==405
    r=client.get('/api/v1/verifications/SPEC-001',headers={'Origin':'https://example.com'})
    assert 'access-control-allow-origin' not in r.headers


def test_required_schema_fields(client):
    run=client.get('/api/v1/verifications/SPEC-001').json()
    for name in SPEC['components']['schemas']['VerificationRun']['required']:
        altered=copy.deepcopy(run);del altered[name]
        with pytest.raises(ServiceError):schema('VerificationRun',altered)

@pytest.mark.parametrize('code,mutate',MUTATIONS)
def test_f004_through_http(client,code,mutate):
    # Simulate corrupted stored data with recomputed storage seal to exercise
    # semantic checks beyond the immutable-storage digest check.
    from app.identity import canonical
    import hashlib
    c=client.app.state.catalog;b=c.read('SPEC-001');mutate(b['run'])
    c._runs['SPEC-001']=canonical(b);c._seals['SPEC-001']=hashlib.sha256(c._runs['SPEC-001']).hexdigest()
    r=client.get('/api/v1/verifications/SPEC-001')
    assert r.status_code==503 and r.json()['error']['code']==code
    schema('Error',r.json())


def test_unavailable_payload_through_http(client):
    from app.identity import canonical
    import hashlib
    c=client.app.state.catalog;b=c.read('SPEC-001')
    b['run']['evidence_references'][0]['availability']='unavailable'
    b['items'][0]['reference']['availability']='unavailable'
    c._runs['SPEC-001']=canonical(b);c._seals['SPEC-001']=hashlib.sha256(c._runs['SPEC-001']).hexdigest()
    r=client.get('/api/v1/verifications/SPEC-001/evidence')
    assert r.status_code==503 and r.json()['error']['code']=='unavailable_payload'


def test_snapshot_restart_and_no_aliasing(client):
    from app.service import Catalog
    c=client.app.state.catalog;old=c.snapshot
    b=c.read('SPEC-001');b['run']['result']['cohort_state']='Mismatch'
    assert c.read('SPEC-001')['run']['result']['cohort_state']=='Verified'
    new=Catalog()
    assert new.snapshot!=old
    with pytest.raises(ServiceError) as error:new.read('SPEC-001',old)
    assert error.value.status==409


def test_forged_product_reference(client):
    b=client.app.state.catalog.read('SPEC-001')
    b['run']['assurance'].update(research_authorization='approved_for_product_use',release_approval_reference='invented-reference')
    with pytest.raises(ServiceError) as error:validate_run(b['run'],b['input'],b['raw'])
    assert error.value.code=='approval_reference_invalid'


def test_startup_source_failure():
    with patch('app.identity.MODEL_HASH','0'*64):
        with TestClient(create_app(), base_url='http://127.0.0.1:8765') as client:
            r=client.get('/api/v1/verifications/SPEC-001')
            assert r.status_code==503 and 'result' not in r.json()


def test_unexpected_error_sanitized(client):
    with patch.object(client.app.state.catalog,'read',side_effect=RuntimeError('/private/path secret')):
        r=client.get('/api/v1/verifications/SPEC-001')
        assert r.status_code==500 and 'secret' not in r.text and '/private' not in r.text
        schema('Error',r.json())


def test_protected_repository_integrity():
    repo_root = ROOT.parent.resolve()
    if repo_root.parent.name != 'FlowAssert-Active' and os.environ.get('FLOWASSERT_ENFORCE_ACTIVE_SIBLINGS') != '1':
        pytest.skip('Standalone product workspace outside FlowAssert-Active; 6-sibling custody check applies only to FlowAssert-Active')
    from scripts.protected_integrity import snapshot,compare
    differences=compare(snapshot())
    assert all(not d['file_differences'] and d['git_equal'] for d in differences.values()), differences
