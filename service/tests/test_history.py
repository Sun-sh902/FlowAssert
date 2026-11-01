"""Independent fixed expectations, real SQLite, mutation and actual evaluator replay."""
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import sys
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from openapi_spec_validator import validate
from app.identity import ROOT, MODEL_HASH, CONTRACT_HASH, ServiceError, canonical, digest, load_evaluator
from app.service import Catalog
from app.history_api import create_history_app
from app.history_store import ArchiveStore, SCHEMA_VERSION, sha, source_identity, make_candidate, check_evidence, validate_response, history_spec, integrity
from app.history_security import HistoryError, Cursors, private_file
from archive_cli import configure_ephemeral_key

# Authored from the owner specification and frozen independently authored scenarios.
EXPECTED = [('Verified',['Verified'],1,True), ('Mismatch',['Mismatch'],1,True),
            ('Pending',['Pending'],1,True), ('Unverified',['Unverified'],1,True),
            ('Unverified',['Verified']*12,None,False)]
CASES = json.loads((ROOT/'contracts/verification-examples.json').read_text())['examples']

@pytest.fixture
def store(tmp_path, monkeypatch):
    state = tmp_path/'state'; configure_ephemeral_key(state)
    s = ArchiveStore(state); s.initialize()
    return s

@pytest.fixture
def seeded(store):
    return store, store.seed()['history_ids']

@pytest.fixture
def http(seeded):
    s, ids = seeded
    with TestClient(create_history_app(s.directory), base_url='http://127.0.0.1:8765') as client: yield client, s, ids


def mutation(s, table, assignments, parameters=(), where=''):
    """Simulate administrator damage, restoring exact guard SQL before the read.
    Trigger bypass is a test operation, never a supported product capability.
    """
    with sqlite3.connect(s.path) as c:
        triggers = c.execute("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name=?", (table,)).fetchall()
        for name, sql in triggers: c.execute('DROP TRIGGER "' + name + '"')
        c.execute(f'UPDATE {table} SET {assignments} {where}', parameters)
        for name, sql in triggers: c.execute(sql)


def error(response, status, code=None, integrity_status=None):
    assert response.status_code == status, response.text
    body = response.json(); assert list(body) == ['error']
    assert set(body['error']) == {'code','message','request_id','retryable','details'}
    assert 'result' not in body and 'items' not in body
    if code: assert body['error']['code'] == code
    if integrity_status: assert body['error']['details'] == [{'path':'archive','code':integrity_status}]
    assert response.headers['cache-control'] == 'no-store'
    from app.validation import schema
    schema('Error',body)
    return body


def test_A01_A33_baseline():
    manifest=json.loads((ROOT/'docs/phase3a/evidence/baseline-source.json').read_text())
    assert not manifest['drift'] and len(manifest['files']) == 34
    for path, expected in manifest['files'].items():
        assert sha((ROOT/'baseline/FlowAssert-Service'/path).read_bytes()) == expected
    assert sha((ROOT/'vendor/model.py').read_bytes()) == MODEL_HASH
    for name, expected in [('openapi-v1-proposed.yaml',CONTRACT_HASH),('frontend-provider-contract.md','aa275b2c7f4a04b52f04d30a8e7a8f181614a161a57873317c30946a4865312a')]:
        assert sha((ROOT/'contracts'/name).read_bytes()) == expected


@pytest.mark.parametrize('index',range(5))
def test_A03_A06_direct_evaluator_archive(http,index):
    client,s,ids=http
    detail=client.get('/api/v1/history/'+ids[index]); assert detail.status_code==200
    data=detail.json(); validate_response('HistoryDetail',data)
    run=data['run']; result=run['result']; cohort, states,total,known=EXPECTED[index]
    # A separate pure evaluator execution; expected verdicts above are not derived from it.
    replay=load_evaluator()(copy.deepcopy(CASES[index]['input_evidence']))
    assert canonical(result)==canonical(replay)
    assert (result['cohort_state'],[r['state'] for r in result['records']],result['expected_total'],result['source_population_known']) == (cohort,states,total,known)
    assert [r['source_row'] for r in result['records']] == list(range(len(states)))
    assert data['original_snapshot_id']==run['snapshot_id'] and data['snapshot_id']!=run['snapshot_id']
    assert data['evaluator']['model_sha256']==MODEL_HASH
    assert data['provenance']['acquisition_authenticity']=='not_authenticated'
    assert data['integrity']['status']=='INTEGRITY_VERIFIED'
    assert run['evaluation_context']['service_executed_at'] is not None
    if index==3:
        assert result['observed_at'] is None
        assert run['evaluation_context']['event_times']['observed_at'] is None
        assert run['diagnostics'][0]['code']=='missing_time_tick'


def test_A02_old_and_composed_app_same_catalog_shape(http):
    client,s,ids=http
    catalog=client.app.state.catalog
    for i in range(1,6):
        current=client.get(f'/api/v1/verifications/SPEC-00{i}').json()
        assert current==catalog.read(f'SPEC-00{i}')['run']
        assert 'history_id' not in current and 'integrity' not in current
    spec=client.get('/openapi.json').json()
    assert set(spec['paths'])=={'/api/v1/verifications/{id}','/api/v1/verifications/{id}/evidence'}
    assert len(client.get('/history-openapi.json').json()['paths'])==3


def test_A07_A26_transaction_exception_and_crash(store,tmp_path):
    for stage in ('after_archive_row','after_evidence_row','before_publication'):
        def crash(current):
            if current==stage: raise RuntimeError('fault injection')
        with pytest.raises(RuntimeError):store.seed(fault=crash)
        assert store.listing()['page']['total']==0
        with sqlite3.connect(store.path) as c:
            for table in ('archives','records','evidence','seed_sets'): assert c.execute('SELECT count(*) FROM '+table).fetchone()[0]==0
    code='''import os,sys
from pathlib import Path
from archive_cli import configure_ephemeral_key
from app.history_store import ArchiveStore
state=Path(sys.argv[1]);configure_ephemeral_key(state)
def crash(stage):
 if stage=='after_archive_row':os._exit(73)
ArchiveStore(state).seed(fault=crash)
'''
    p=subprocess.run([sys.executable,'-B','-c',code,str(store.directory)],cwd=ROOT,capture_output=True,text=True)
    assert p.returncode==73, p.stderr
    # Reopening the actual on-disk database recovers the interrupted rollback journal.
    with store.connection(write=True): pass
    assert store.listing()['page']['total']==0
    first=store.seed(); assert len(first['history_ids'])==5
    assert store.seed()['history_ids']==first['history_ids']


def test_A09_A10_A15_idempotency_and_new_evaluation(seeded):
    s,ids=seeded
    original=[s.detail(h) for h in ids]
    repeated=s.seed(); assert repeated['reused'] and repeated['evaluations']==0 and repeated['history_ids']==ids
    with s.connection() as c:
        candidate,_=s._read(c,ids[0])
    assert s.publish(candidate)==ids[0]
    newer=s.seed(reevaluate=True)['history_ids']
    assert not set(newer)&set(ids) and s.listing()['page']['total']==10
    assert [s.detail(h) for h in ids]==original
    assert len(set(ids))==5


@pytest.mark.parametrize('change,code',[('evidence','unsupported_synthetic_source'),('evaluator','unsupported_evaluator_identity'),('contract','unsupported_contract_identity')])
def test_A11_A12_changed_inputs_documented_conflict(seeded,change,code):
    s,ids=seeded
    with s.connection() as c: candidate,_=s._read(c,ids[0])
    candidate=copy.deepcopy(candidate)
    if change=='evidence':candidate['bundle']['input']['source']['rows'][0]['phone']='different'
    elif change=='evaluator':candidate['bundle']['run']['evaluation_context']['evaluator']['model_sha256']='0'*64
    else:candidate['original_contract_sha256']='0'*64
    with pytest.raises(HistoryError) as exc:s.publish(candidate)
    assert (exc.value.status,exc.value.code)==(409,code)
    assert s.listing()['page']['total']==5


@pytest.mark.parametrize('include_payload',[True,False])
@pytest.mark.parametrize('limit',[1,2,3,4,100])
def test_A13_A16_ordered_evidence(seeded,include_payload,limit):
    s,ids=seeded
    for hid in ids:
        detail=s.detail(hid); items=[];seen=set();cursor=None
        while True:
            page=s.evidence(hid,snapshot=detail['snapshot_id'],limit=limit,cursor=cursor,include_payload=include_payload)
            assert page['page']['snapshot_id']==detail['snapshot_id'] and page['page']['total']==4
            assert page['original_snapshot_id']==detail['run']['snapshot_id']
            for item in page['items']:
                assert item['integrity']['status']=='INTEGRITY_VERIFIED'
                assert item['integrity']['checked_sha256']==item['reference']['sha256']
                if include_payload:assert sha(canonical(item['payload']))==item['reference']['sha256']
                else:assert item['payload'] is None and item['payload_reason']=='omitted_by_request'
            items+=page['items'];cursor=page['page']['next_cursor']
            if cursor is None:break
            assert cursor not in seen;seen.add(cursor)
        assert [x['reference'] for x in items]==detail['run']['evidence_references']


def test_A17_new_inserts_during_list_pagination(seeded):
    s,ids=seeded
    p=s.listing(limit=2); original=copy.deepcopy(p);collected=[x['history_id'] for x in p['items']]
    new=s.seed(reevaluate=True)['history_ids']
    seen=set()
    while p['page']['next_cursor']:
        t=p['page']['next_cursor'];assert t not in seen;seen.add(t)
        p=s.listing(limit=2,cursor=t)
        assert p['page']['snapshot_id']==original['page']['snapshot_id'] and p['page']['total']==5
        collected += [x['history_id'] for x in p['items']]
    assert collected==list(reversed(ids)) and not set(collected)&set(new)
    assert s.listing()['page']['total']==10


def test_empty_list_and_unknown_history(store):
    assert store.listing()['items']==[] and store.listing()['page']['total']==0
    with TestClient(create_history_app(store.directory), base_url='http://127.0.0.1:8765') as c:error(c.get('/api/v1/history/hist_'+'0'*64),404,'history_not_found')


@pytest.mark.parametrize('bad',['SPEC-001','hist_bad','%2e%2e','%2E','hist_'+('f'*65),'hist_'+('G'*64),'abc/def','%2fetc%2fpasswd','%252e%252e','a\\b'])
def test_A18_invalid_ids(http,bad):
    c,s,ids=http;error(c.get('/api/v1/history/'+bad),422,'invalid_history_id')


@pytest.mark.parametrize('change',['tampered','foreign_history','limit','payload','endpoint','snapshot','foreign_database','invalid_offset'])
def test_A19_A21_cursor_bindings(http,change,tmp_path):
    c,s,ids=http
    first=s.evidence(ids[0],limit=1);t=first['page']['next_cursor'];q={'limit':1,'cursor':t};target=ids[0];endpoint='evidence'
    status=400;code='cursor_query_conflict'
    if change=='tampered':q['cursor']=t[:-1]+('0' if t[-1]!='0' else '1');code='invalid_cursor'
    elif change=='foreign_history':target=ids[1]
    elif change=='limit':q['limit']=2
    elif change=='payload':q['include_payload']='false'
    elif change=='endpoint':endpoint='list'
    elif change=='snapshot':q['snapshot_id']='wrong';status=409;code='history_snapshot_conflict'
    elif change=='foreign_database':
        other=ArchiveStore(tmp_path/'other');other.initialize()
        with other.connection() as db: scope=other._db_scope(db)
        signer=s._cursors();decoded=signer.decode(t);decoded['scope'].update(scope);q['cursor']=signer.encode(decoded)
    elif change=='invalid_offset':
        signer=s._cursors();decoded=signer.decode(t);decoded['offset']=0;q['cursor']=signer.encode(decoded);code='invalid_cursor'
    path='/api/v1/history' if endpoint=='list' else '/api/v1/history/'+target+'/evidence'
    error(c.get(path,params=q),status,code)
    # Failed continuations cannot poison a valid chain.
    assert s.evidence(ids[0],limit=1,cursor=t)['items'][0]['reference']['role']=='destination'


def test_cross_filter_and_list_scope(seeded):
    s,ids=seeded;p=s.listing(limit=1);token=p['page']['next_cursor']
    for kwargs in ({'verification_id':'SPEC-001'},{'limit':2}):
        q={'limit':1,'cursor':token,**kwargs}
        with pytest.raises(HistoryError) as e:s.listing(**q)
        assert e.value.status==400
    assert [x['history_id'] for x in s.listing(verification_id='SPEC-005')['items']]==[ids[4]]


@pytest.mark.parametrize('change,expected',[('missing','archived_evidence_missing'),('corrupt','archived_evidence_invalid'),('mismatch','evidence_digest_mismatch'),('binding','archive_evidence_binding'),('snapshot','archive_evidence_binding'),('order','archive_evidence_order'),('record','archive_record_binding'),('metadata','archive_metadata_digest_mismatch'),('unknown_zero','archive_digest_mismatch'),('schema','archive_schema_invalid')])
def test_A14_A22_A25_mutations(http,change,expected):
    c,s,ids=http;hid=ids[0]
    if change=='missing':mutation(s,'evidence','payload=NULL',where='WHERE position=0')
    elif change=='corrupt':mutation(s,'evidence','payload=?',(b'{invalid',),'WHERE position=0')
    elif change=='mismatch':mutation(s,'evidence','payload=?',(b'{}',),'WHERE position=0')
    elif change=='binding':mutation(s,'evidence','reference_id=?',('foreign-reference',),'WHERE position=0')
    elif change=='snapshot':mutation(s,'evidence','original_snapshot_id=?',('snapshot-foreign',),'WHERE position=0')
    elif change=='order':mutation(s,'evidence','position=position+10')
    elif change=='record':mutation(s,'records','record=?',(canonical({'state':'Mismatch'}),),'WHERE position=0')
    elif change=='metadata':mutation(s,'archives','created_at=?',('2099-01-01T00:00:00Z',))
    elif change=='unknown_zero':
        hid=ids[4]
        with s.connection() as db:candidate,row=s._read(db,hid)
        candidate['bundle']['raw']['expected_total']=0
        mutation(s,'archives','candidate=?',(canonical(candidate),),'WHERE history_id=\''+hid+'\'')
    elif change=='schema':
        with sqlite3.connect(s.path) as db:db.execute('CREATE TABLE unexpected(value TEXT)')
    r=c.get('/api/v1/history/'+hid+'/evidence',params={'include_payload':'false'})
    # Payload omission must not bypass integrity checks.
    error(r,503,expected)
    assert r.json()['error']['details'][0]['code'] in ('INTEGRITY_FAILED','INTEGRITY_UNVERIFIABLE')


def test_schema_invalid_with_updated_outer_hash(http):
    c,s,ids=http
    with s.connection() as db:candidate,row=s._read(db,ids[0])
    del candidate['bundle']['run']['result']['counts']
    raw=canonical(candidate)
    mutation(s,'archives','candidate=?,candidate_sha256=?',(raw,sha(raw)),"WHERE history_id='"+ids[0]+"'")
    error(c.get('/api/v1/history/'+ids[0]),503,integrity_status='INTEGRITY_FAILED')


def test_unavailable_at_evaluation_semantics():
    ref={'availability':'unavailable','sha256':None}
    assert check_evidence(ref,None)['status']=='INTEGRITY_UNVERIFIABLE'
    with pytest.raises(HistoryError):check_evidence(ref,b'{}')
    # No reviewed case has this shape; the controlled seed never manufactures one.


@pytest.mark.parametrize('value',[
    {'b':{'z':[None,False,0,[],{}]},'a':1}, {'a':1,'b':{'z':[None,False,0,[],{}]}},
    {'\ue000':'BMP','\U00010000':'astral','😀':'😀','中文':'值'},
    {'int':1,'float':1.0,'minus_zero':-0.0,'large_float':1e20,'small':1e-7}, None,[],{},[1,None,False,{},[]]])
def test_canonical_corpus(value):
    # Independent expression comes directly from the accepted representation, not our helper.
    raw=json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('utf-8')
    expected=hashlib.sha256(raw).hexdigest()
    assert canonical(value)==raw
    assert check_evidence({'availability':'available','sha256':expected},raw)['checked_sha256']==expected
    from app.identity import load_evaluator
    # Research's default=repr makes no difference on this admitted JSON corpus.
    namespace={};exec(compile((ROOT/'vendor/model.py').read_bytes(),'model.py','exec'),namespace)
    assert namespace['digest'](value)==expected


def test_unicode_order_and_numeric_bytes_are_specific():
    assert canonical({'\ue000':0,'\U00010000':1})==b'{"\\ue000":0,"\\ud800\\udc00":1}'
    assert canonical(1)!=canonical(1.0) and canonical(0.0)!=canonical(-0.0)
    assert canonical({'v':None})!=canonical({})
    assert len({canonical(x) for x in (None,0,False,[],{})})==5
    assert canonical({'a':1,'b':2})==canonical({'b':2,'a':1})


def test_A27_reopen_migrations(store,tmp_path):
    before=store.path.read_bytes();store.initialize();assert store.path.read_bytes()==before
    assert ArchiveStore(store.directory).listing()['page']['total']==0
    with sqlite3.connect(store.path) as c:c.execute('PRAGMA user_version=99')
    with pytest.raises(HistoryError) as e:store.initialize()
    assert e.value.code=='unsupported_schema_version'
    other=ArchiveStore(tmp_path/'nonempty');other.directory.mkdir(mode=0o700)
    private_file(other.path,create=True)
    with sqlite3.connect(other.path) as c:c.execute('CREATE TABLE alien(a)')
    with pytest.raises(HistoryError) as e:other.initialize()
    assert e.value.code=='unversioned_nonempty_database'


def test_migration_rollback(store,tmp_path,monkeypatch):
    import app.history_store as module
    bad=tmp_path/'bad.sql';bad.write_text('CREATE TABLE partial(a); THIS IS INVALID;')
    monkeypatch.setattr(module,'MIGRATION',bad)
    other=ArchiveStore(tmp_path/'broken')
    with pytest.raises(HistoryError):other.initialize()
    with sqlite3.connect(other.path) as c:
        assert c.execute('PRAGMA user_version').fetchone()[0]==0
        assert c.execute('SELECT count(*) FROM sqlite_master').fetchone()[0]==0


def test_A28_constraints_and_immutability(seeded):
    s,ids=seeded
    with s.connection(write=True) as c:
        assert c.execute('PRAGMA foreign_keys').fetchone()[0]==1
        statements=[("UPDATE archives SET verification_id='SPEC-005'",()),('DELETE FROM archives',()),('UPDATE evidence SET payload=NULL',()),('DELETE FROM records',()),
                    ('INSERT INTO records VALUES(?,?,?)',('hist_'+'0'*64,0,b'{}')),('INSERT INTO records VALUES(?,?,?)',(ids[0],99,b'{}')),
                    ('INSERT INTO records VALUES(?,?,?)',(ids[0],-1,b'{}'))]
        for sql,args in statements:
            with pytest.raises(sqlite3.IntegrityError):c.execute(sql,args)
    assert s.listing()['page']['total']==5


@pytest.mark.parametrize('suffix,status,code',[
    ('?x=y',400,'invalid_query'),('?limit=1&limit=2',400,'invalid_query'),('?limit=0',422,'invalid_parameter'),
    ('?limit=101',422,'invalid_parameter'),('?limit=١',422,'invalid_parameter'),('?cursor=',422,'invalid_parameter'),
    ('?verification_id=../',422,'invalid_parameter'),('?cursor=bad',400,'invalid_cursor')])
def test_A29_A30_malformed_list(http,suffix,status,code):
    c,s,ids=http;error(c.get('/api/v1/history'+suffix),status,code)


def test_A29_A30_methods_origins_snapshots(http):
    c,s,ids=http;url='/api/v1/history/'+ids[0]
    for method in ('post','put','patch','delete'):error(getattr(c,method)(url),405,'method_not_allowed')
    error(c.get(url,params={'snapshot_id':'wrong'}),409,'history_snapshot_conflict')
    error(c.get(url,params={'unknown':'x'}),400,'invalid_query')
    error(c.get(url,headers={'Origin':'https://example.com'}),403,'origin_not_allowed')
    assert c.get(url,headers={'Origin':'http://127.0.0.1:5183'}).status_code==200
    assert 'access-control-allow-origin' not in c.get(url).headers
    error(c.request('GET',url,content=b'body'),400,'unexpected_request_body')
    error(c.get(url+'/evidence?include_payload=1'),422,'invalid_parameter')
    error(c.get(url+'/evidence?snapshot_id='),422,'invalid_parameter')


@pytest.mark.parametrize('damage',['symlink_db','symlink_parent','db_mode','key_mode','key_fifo','db_hardlink','key_symlink','journal_symlink','db_bytes'])
def test_local_security(http,tmp_path,damage):
    c,s,ids=http
    if damage=='symlink_db':s.path.rename(s.path.with_suffix('.saved'));s.path.symlink_to(s.path.with_suffix('.saved'))
    elif damage=='symlink_parent':
        new=tmp_path/'moved';s.directory.rename(new);s.directory.symlink_to(new,target_is_directory=True)
    elif damage=='db_mode':s.path.chmod(0o644)
    elif damage=='key_mode':(s.directory/'history-hmac.key').chmod(0o644)
    elif damage=='key_fifo':
        k=s.directory/'history-hmac.key';k.unlink();os.mkfifo(k,0o600)
    elif damage=='db_hardlink':os.link(s.path,s.directory/'hardlinked-db')
    elif damage=='key_symlink':
        k=s.directory/'history-hmac.key';k.rename(s.directory/'saved-key');k.symlink_to(s.directory/'saved-key')
    elif damage=='journal_symlink':Path(str(s.path)+'-journal').symlink_to(tmp_path/'outside')
    else:s.path.write_bytes(b'not a sqlite database')
    error(c.get('/api/v1/history'),503)


def test_no_http_state_creation(tmp_path):
    missing=tmp_path/'missing'
    with TestClient(create_history_app(missing), base_url='http://127.0.0.1:8765') as c:error(c.get('/api/v1/history'),503)
    assert not missing.exists()


def test_contract_validation():
    validate(history_spec())
    assert set(history_spec()['paths'])=={'/api/v1/history','/api/v1/history/{history_id}','/api/v1/history/{history_id}/evidence'}
    for path, operations in history_spec()['paths'].items():assert set(operations)=={'get'}


def test_deleted_reference_stops_publication_and_read(http):
    c,s,ids=http
    with s.connection() as db:candidate,_=s._read(db,ids[0])
    candidate['bundle']['items'].pop()
    with pytest.raises(HistoryError):s.publish(candidate)
    with sqlite3.connect(s.path) as db:
        sql=db.execute("SELECT sql FROM sqlite_master WHERE name='evidence_no_delete'").fetchone()[0]
        db.execute('DROP TRIGGER evidence_no_delete')
        db.execute('DELETE FROM evidence WHERE history_id=? AND position=0',(ids[0],))
        db.execute(sql)
    error(c.get('/api/v1/history/'+ids[0]),503,'archive_evidence_missing','INTEGRITY_UNVERIFIABLE')


def test_unknown_population_cannot_be_zero_even_after_outer_rehash(http):
    c,s,ids=http
    with s.connection() as db:candidate,_=s._read(db,ids[4])
    candidate['bundle']['raw']['expected_total']=0
    candidate['bundle']['run']['result']['expected_total']=0
    raw=canonical(candidate)
    mutation(s,'archives','candidate=?,candidate_sha256=?',(raw,sha(raw)),"WHERE history_id='"+ids[4]+"'")
    error(c.get('/api/v1/history/'+ids[4]),503,integrity_status='INTEGRITY_FAILED')


def test_candidate_evidence_wrong_snapshot_with_valid_digest(seeded):
    s,ids=seeded
    with s.connection() as db:candidate,_=s._read(db,ids[0])
    candidate['bundle']['items'][0]['reference']=copy.deepcopy(candidate['bundle']['items'][1]['reference'])
    candidate['bundle']['items'][0]['payload']=copy.deepcopy(candidate['bundle']['items'][1]['payload'])
    # Correct destination digest is still wrong in source position.
    assert digest(candidate['bundle']['items'][0]['payload'])==candidate['bundle']['items'][0]['reference']['sha256']
    with pytest.raises(HistoryError):s.publish(candidate)


def test_strict_cursor_shape_and_canonical_encoding(seeded):
    s,ids=seeded;signer=s._cursors();cursor=s.evidence(ids[0],limit=1)['page']['next_cursor']
    token=signer.decode(cursor)
    for modified in ({**token,'offset':True},{**token,'offset':4},{**token,'extra':None},{**token,'offset':-1}):
        with pytest.raises(HistoryError):s.evidence(ids[0],limit=1,cursor=signer.encode(modified))
    for value in (cursor+'.',cursor+'=',cursor.split('.')[0]+'==.'+cursor.split('.')[1],'.','not-a-cursor'):
        with pytest.raises(HistoryError):signer.decode(value)
    assert signer.decode(cursor)==token


def test_source_and_state_paths_are_bounded(tmp_path):
    with pytest.raises(HistoryError):ArchiveStore('/tmp/flowassert-forbidden').initialize()
    assert not Path('/tmp/flowassert-forbidden').exists()
    with pytest.raises(HistoryError):ArchiveStore(ROOT).initialize()


def test_correct_content_wrong_original_snapshot_rejected(seeded):
    s,ids=seeded
    with s.connection() as db:candidate,row=s._read(db,ids[0])
    candidate['bundle']['run']['snapshot_id']='snapshot-'+'0'*64
    with pytest.raises(HistoryError) as e:s.publish(candidate)
    assert e.value.code=='original_snapshot_digest'
    candidate['bundle']['run']['snapshot_id']=row['original_snapshot_id']
    candidate['snapshot_basis']['SPEC-001']['run']['identity']['created_at']='2099-01-01T00:00:00Z'
    with pytest.raises(HistoryError) as e:s.publish(candidate)
    assert e.value.code=='original_snapshot_digest'


def test_published_order_sequence_is_sealed(http):
    c,s,ids=http
    mutation(s,'archives','sequence=sequence+100')
    error(c.get('/api/v1/history'),503,'archive_metadata_digest_mismatch','INTEGRITY_FAILED')


def test_schema_prefix_underscore_is_literal(http):
    c,s,ids=http
    with sqlite3.connect(s.path) as db:db.execute('CREATE TABLE sqliteXunexpected(value TEXT)')
    error(c.get('/api/v1/history'),503,'archive_schema_invalid','INTEGRITY_FAILED')
