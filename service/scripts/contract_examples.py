"""Extract and validate actual HTTP bodies, never invent response examples."""
import hashlib,json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from app.history_store import validate_response,history_spec
from app.validation import schema
from app.history_contract import CONTRACT_VERSION,CONTRACT_SHA256
folder=ROOT/'docs/phase3a/evidence/http-closeout'
examples=[]
for path in sorted(folder.glob('[0-9]*.json')):
    capture=json.loads(path.read_text());url=capture['path'].split('?')[0]
    if not url.startswith('/api/v1/history'):continue
    if capture['status']!=200:schema('Error',capture['body']);name='Error'
    else:
        name='HistoryList' if url=='/api/v1/history' else 'HistoryEvidencePage' if url.endswith('/evidence') else 'HistoryDetail'
        validate_response(name,capture['body'])
    examples.append({'name':path.stem,'request':{'method':capture['method'],'path':capture['path']},'http_status':capture['status'],'schema':name,'response':capture['body'],'capture_sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
out={'contract_version':CONTRACT_VERSION,'contract_sha256':CONTRACT_SHA256,'source':'Actual local HTTP captures; synthetic evaluator-backed archive; no authored replacement verdicts.','examples':examples}
(ROOT/'contracts/history-examples.json').write_text(json.dumps(out,indent=2)+'\n')
report={'validated_examples':len(examples),'failures':0,'contract_sha256':CONTRACT_SHA256}
(ROOT/'docs/phase3a/evidence/contract-examples-validation.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
