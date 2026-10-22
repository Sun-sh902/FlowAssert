"""Real loopback process probe, captured responses, guaranteed shutdown."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request
import urllib.error
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
from app.validation import schema
from app.identity import digest
out=Path(os.environ.get('FLOWASSERT_EVIDENCE_DIR', str(root/'evidence'))).resolve()/'http'
if not out.is_relative_to((root/'evidence').resolve()): raise ValueError('Invalid evidence directory')
out.mkdir(parents=True,exist_ok=False)
# Refuse to probe a pre-existing listener and accidentally attribute its results.
with socket.socket() as sock:
    sock.bind(('127.0.0.1',8765))
log=(out/'server.log').open('w')
args=[sys.executable,'-B','run.py']
p=subprocess.Popen(args,cwd=root,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},stdout=log,stderr=subprocess.STDOUT)
receipt={'argv':args,'cwd':str(root),'pid':p.pid,'responses':[]}
def get(path):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8765'+path,timeout=5) as response:return response.status,dict(response.headers),json.load(response)
    except urllib.error.HTTPError as exc:return exc.code,dict(exc.headers),json.load(exc)
try:
    for i in range(50):
        if p.poll() is not None:raise RuntimeError('server exited')
        try:
            status,headers,data=get('/api/v1/verifications/SPEC-001');break
        except urllib.error.URLError:time.sleep(.1)
    else:raise RuntimeError('startup timeout')
    listen=subprocess.run(['lsof','-nP','-a','-p',str(p.pid),'-iTCP','-sTCP:LISTEN'],capture_output=True,text=True)
    (out/'listener.txt').write_text(listen.stdout+listen.stderr)
    assert listen.returncode==0 and '127.0.0.1:8765' in listen.stdout and '*:8765' not in listen.stdout
    for i in range(1,6):
        id=f'SPEC-{i:03}';path='/api/v1/verifications/'+id
        status,headers,data=get(path);assert status==200;schema('VerificationRun',data)
        assert headers.get('cache-control')=='no-store' or headers.get('Cache-Control')=='no-store'
        (out/f'{id}-detail.json').write_text(json.dumps(data,indent=2))
        status,headers,ev=get(path+'/evidence?snapshot_id='+data['snapshot_id']);assert status==200;schema('EvidencePage',ev)
        assert [x['reference'] for x in ev['items']]==data['evidence_references']
        for item in ev['items']:assert digest(item['payload'])==item['reference']['sha256']
        (out/f'{id}-evidence.json').write_text(json.dumps(ev,indent=2))
        receipt['responses'].append({'id':id,'detail_status':200,'evidence_status':200,'result_sha256':digest(data['result']),'service_executed_at':data['evaluation_context']['service_executed_at']})
    for path,expected in [('/api/v1/verifications/missing',404),('/api/v1/verifications/SPEC-001?snapshot_id=expired',409),('/api/v1/verifications/SPEC-001/evidence?limit=0',422),('/api/v1/verifications/SPEC-001?unknown=1',400)]:
        status,headers,data=get(path);assert status==expected;schema('Error',data)
        (out/f'error-{status}.json').write_text(json.dumps(data,indent=2))
    receipt['passed']=True
finally:
    p.terminate()
    try:p.wait(timeout=10)
    except subprocess.TimeoutExpired:p.kill();p.wait()
    log.close();receipt['server_exit']=p.returncode
    (out/'receipt.json').write_text(json.dumps(receipt,indent=2))
print(json.dumps(receipt,indent=2))
