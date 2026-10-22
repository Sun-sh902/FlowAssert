"""Real CLI, actual HTTP, insertion while paging, restart, and fail-closed mutation."""
from datetime import datetime, timezone
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import time
from urllib.parse import urlencode
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from app.identity import canonical,load_evaluator
from app.history_store import validate_response,ArchiveStore,DEFAULT_STATE
from scripts.run_checks import run
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--state',type=Path,default=DEFAULT_STATE)
parser.add_argument('--output',type=Path,default=ROOT/'docs/phase3a/evidence/http-final')
args=parser.parse_args()
OUT=args.output.resolve()
STATE=args.state.resolve()
assert OUT.is_relative_to(ROOT) and STATE.is_relative_to(ROOT)
ENV={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','TMPDIR':str(ROOT/'.runtime/tmp'),'LC_ALL':'C','FLOWASSERT_HISTORY_STATE':str(STATE)}
EXPECTED=[('Verified',['Verified'],1,True),('Mismatch',['Mismatch'],1,True),('Pending',['Pending'],1,True),('Unverified',['Unverified'],1,True),('Unverified',['Verified']*12,None,False)]
assertions=0;captures=[];processes=[];servers=[];counter=0

def check(condition,message):
    global assertions
    assertions+=1
    if not condition:raise AssertionError(message)

def now():return datetime.now(timezone.utc).isoformat()

def request(path,status=200,label=None,method='GET',headers=None):
    global counter
    c=http.client.HTTPConnection('127.0.0.1',8765,timeout=5)
    try:
        c.request(method,path,headers=headers or {})
        response=c.getresponse();raw=response.read();body=json.loads(raw)
        record={'method':method,'path':path,'status':response.status,'headers':dict(response.getheaders()),'body':body,'body_sha256':hashlib.sha256(raw).hexdigest()}
        check(response.status==status,repr(record))
        check(response.getheader('Cache-Control')=='no-store','cache-control')
        if status>=400:
            check(set(body)=={'error'},'error cannot carry result')
            check(set(body['error'])=={'code','message','request_id','retryable','details'},'structured error')
        if label:
            counter+=1;file=f'{counter:03}-{label}.json';(OUT/file).write_text(json.dumps(record,indent=2))
            captures.append(file)
        return body
    finally:c.close()

def cli(label,args,state=STATE):
    label=OUT.name+'-'+label
    argv=[str(ROOT/'.venv/bin/python'),'-B','scripts/guarded_entry.py','archive_cli.py','--state',str(state),*args]
    code=run(argv,label,{'FLOWASSERT_NETWORK_AUDIT':str(OUT/(label+'-network.json'))})
    check(code==0,label+' CLI failed')
    return json.loads((OUT.parent/(label+'.stdout.log')).read_text())

def listeners():
    p=subprocess.run(['lsof','-nP','-iTCP:8765','-sTCP:LISTEN'],capture_output=True,text=True)
    return {'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr}

def start(name,state=STATE):
    previous=listeners();check(previous['exit']==1 and not previous['stdout'],'refuse occupied port')
    env={**ENV,'FLOWASSERT_HISTORY_STATE':str(state),'FLOWASSERT_NETWORK_AUDIT':str(OUT/(name+'-network.json'))}
    argv=[str(ROOT/'.venv/bin/python'),'-B','scripts/guarded_entry.py','run_history.py']
    log=(OUT/(name+'-server.log')).open('wb')
    p=subprocess.Popen(argv,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
    servers.append((p,log))
    for attempt in range(120):
        if p.poll() is not None:raise RuntimeError('server exited: '+(OUT/(name+'-server.log')).read_text())
        try:
            c=http.client.HTTPConnection('127.0.0.1',8765,timeout=.3);c.request('GET','/api/v1/verifications/SPEC-001');r=c.getresponse();r.read();c.close()
            if r.status==200:break
        except OSError:pass
        time.sleep(.05)
    else:raise RuntimeError('startup timeout')
    observation=listeners();check('127.0.0.1:8765' in observation['stdout'] and '*:8765' not in observation['stdout'],'loopback listener')
    entry={'name':name,'pid':p.pid,'argv':argv,'cwd':str(ROOT),'started_at':now(),'state':str(state),'listener':observation}
    processes.append(entry)
    return p,log,entry

def stop(server):
    p,log,entry=server
    p.terminate()
    try:rc=p.wait(timeout=10)
    except subprocess.TimeoutExpired:p.kill();rc=p.wait(timeout=5)
    log.close();entry.update(exit=rc,stopped_at=now(),after_listener=listeners())
    check(entry['after_listener']['exit']==1 and not entry['after_listener']['stdout'],'owned server stopped')

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    check(not STATE.exists(),'runtime proof needs unused delivery state; never overwrites prior history')
    a=cli('seed-initial',['seed']);b=cli('seed-repeat',['seed'])
    check(a['history_ids']==b['history_ids'] and b['reused'] and b['evaluations']==0,'CLI retry identity')
    ids=a['history_ids'];cases=json.loads((ROOT/'contracts/verification-examples.json').read_text())['examples']
    A=start('A'); originals=[];comparisons=[]
    for index,hid in enumerate(ids):
        caseid=f'SPEC-00{index+1}'
        old=request('/api/v1/verifications/'+caseid,label=caseid+'-ephemeral-detail')
        detail=request('/api/v1/history/'+hid,label=caseid+'-history-detail');originals.append(detail)
        validate_response('HistoryDetail',detail)
        result=detail['run']['result'];replay=load_evaluator()(cases[index]['input_evidence'])
        check(canonical(result)==canonical(replay)==canonical(old['result']),'direct evaluator equality')
        check((result['cohort_state'],[r['state'] for r in result['records']],result['expected_total'],result['source_population_known'])==EXPECTED[index],'independent expected verdicts')
        evidence=request('/api/v1/history/'+hid+'/evidence',label=caseid+'-history-evidence');validate_response('HistoryEvidencePage',evidence)
        check([x['reference'] for x in evidence['items']]==detail['run']['evidence_references'],'reference order')
        for item in evidence['items']:
            check(hashlib.sha256(canonical(item['payload'])).hexdigest()==item['reference']['sha256']==item['integrity']['checked_sha256'],'exact canonical evidence digest')
        comparisons.append({'verification_id':caseid,'history_id':hid,'actual':result,'direct_evaluator_sha256':hashlib.sha256(canonical(replay)).hexdigest(),'expected_cohort':EXPECTED[index][0],'expected_records':EXPECTED[index][1],'expected_total':EXPECTED[index][2],'source_population_known':EXPECTED[index][3],'equal':True})
    old_page=request('/api/v1/verifications/SPEC-001/evidence?limit=1',label='old-first-page')
    history_page=request('/api/v1/history/'+ids[0]+'/evidence?limit=1',label='history-first-page')
    listing=request('/api/v1/history?limit=2',label='list-before-insert')
    newer=cli('seed-reevaluate',['seed','--reevaluate'])
    check(not set(ids)&set(newer['history_ids']),'reevaluation distinct identity')
    collected=[x['history_id'] for x in listing['items']];page=listing;chain=set()
    while page['page']['next_cursor']:
        cursor=page['page']['next_cursor'];check(cursor not in chain,'cursor cycle');chain.add(cursor)
        page=request('/api/v1/history?'+urlencode({'limit':2,'cursor':cursor}),label='list-pinned-continuation')
        check(page['page']['snapshot_id']==listing['page']['snapshot_id'] and page['page']['total']==5,'list remains pinned')
        collected += [x['history_id'] for x in page['items']]
    check(collected==list(reversed(ids)),'no duplicates omissions reorder after insert')
    latest=request('/api/v1/history',label='list-after-insert');check(latest['page']['total']==10,'fresh list sees new inserts')
    t=history_page['page']['next_cursor']
    errors=[('/api/v1/history/'+ids[1]+'/evidence?'+urlencode({'limit':1,'cursor':t}),400,'cursor_query_conflict'),
      ('/api/v1/history/'+ids[0]+'/evidence?'+urlencode({'limit':2,'cursor':t}),400,'cursor_query_conflict'),
      ('/api/v1/history/'+ids[0]+'/evidence?'+urlencode({'limit':1,'cursor':t[:-1]+('0' if t[-1]!='0' else '1')}),400,'invalid_cursor'),
      ('/api/v1/history/'+ids[0]+'?snapshot_id=wrong',409,'history_snapshot_conflict'),
      ('/api/v1/history/%2e%2e/secret',422,'invalid_history_id'),
      ('/api/v1/history/hist_'+'0'*64,404,'history_not_found'),
      ('/api/v1/history?limit=1&limit=2',400,'invalid_query'),('/api/v1/history?limit=0',422,'invalid_parameter'),
      ('/api/v1/history/'+ids[0]+'/evidence?include_payload=1',422,'invalid_parameter')]
    for path,status,code in errors:check(request(path,status,label='error-'+code)['error']['code']==code,code)
    request('/api/v1/history/'+ids[0],405,label='error-no-write',method='POST')
    request('/api/v1/history',403,label='error-origin',headers={'Origin':'https://untrusted.invalid'})
    stop(A);B=start('B')
    old_error=request('/api/v1/verifications/SPEC-001/evidence?'+urlencode({'limit':1,'cursor':old_page['page']['next_cursor']}),409,label='ephemeral-restart-409')
    check(old_error['error']['code']=='snapshot_unavailable','old cursor remains ephemeral')
    continued=request('/api/v1/history/'+ids[0]+'/evidence?'+urlencode({'limit':1,'cursor':t}),label='history-after-restart-page2')
    check(continued['page']['snapshot_id']==history_page['page']['snapshot_id'],'persistent evidence snapshot')
    check(continued['items'][0]['reference']==originals[0]['run']['evidence_references'][1],'persistent evidence order')
    pinned=request('/api/v1/history?'+urlencode({'limit':2,'cursor':listing['page']['next_cursor']}),label='list-after-restart')
    check(pinned['page']['snapshot_id']==listing['page']['snapshot_id'] and pinned['page']['total']==5,'list restart continuity')
    for hid,original in zip(ids,originals):
        check(request('/api/v1/history/'+hid,label='history-stable-after-restart')==original,'history immutable across restart')
    current=request('/api/v1/verifications/SPEC-001',label='new-ephemeral-after-restart')
    check(current['snapshot_id']!=old_page['page']['snapshot_id'],'new ephemeral snapshot')
    stop(B)
    negative=STATE.with_name(STATE.name+'-negative');cli('seed-negative',['seed'],negative);C=start('C-negative',negative)
    # Same-owner administrator bypass of SQL guard; leave damage intact for inspection.
    path=negative/'history.sqlite3'
    with sqlite3.connect(path) as db:
        trigger=db.execute("SELECT sql FROM sqlite_master WHERE name='evidence_no_update'").fetchone()[0]
        db.execute('DROP TRIGGER evidence_no_update');db.execute('UPDATE evidence SET payload=? WHERE position=0',(b'{}',));db.execute(trigger)
        hid=db.execute('SELECT history_id FROM archives ORDER BY sequence LIMIT 1').fetchone()[0]
    for url in ('/api/v1/history/'+hid,'/api/v1/history/'+hid+'/evidence?include_payload=false','/api/v1/history'):
        result=request(url,503,label='real-corrupt-evidence-503')
        check(result['error']['code']=='evidence_digest_mismatch' and result['error']['details']==[{'path':'archive','code':'INTEGRITY_FAILED'}],'no false integrity success')
    with sqlite3.connect(path) as db:db.execute('CREATE TABLE injected_schema(value TEXT)')
    check(request('/api/v1/history',503,label='real-schema-invalid-503')['error']['code']=='archive_schema_invalid','schema cannot produce success')
    stop(C)
    # The delivery database remains intact; negative tests used a separate state directory.
    check(ArchiveStore(STATE).listing()['page']['total']==10,'delivery intact')
    networks={p.name:json.loads(p.read_text()) for p in OUT.glob('*-network.json')}
    check(all(not x['unauthorized'] for x in networks.values()),'no unauthorized outbound traffic')
    (OUT/'direct-evaluator-comparisons.json').write_text(json.dumps(comparisons,indent=2))
    (OUT/'delivery-history-ids.json').write_text(json.dumps({'first_seed':dict(zip([f'SPEC-00{i}' for i in range(1,6)],ids)),'explicit_reevaluation':newer['history_ids'],'state':str(STATE)},indent=2))
    (OUT/'receipt.json').write_text(json.dumps({'assertions':assertions,'captures':captures,'processes':processes,'networks':networks,'final_listener':listeners(),'external_calls_observed':0,'frontend_tested':False,'completed_at':now()},indent=2))
    print(json.dumps({'assertions':assertions,'captures':len(captures),'owned_processes_stopped':len(processes),'external_calls':0}),flush=True)

if __name__=='__main__':
    try:main()
    finally:
        for p,log in servers:
            if p.poll() is None:p.terminate();p.wait(timeout=10)
            if not log.closed:log.close()
