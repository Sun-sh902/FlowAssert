"""Deterministic additive contract; frozen contract is only read."""
from pathlib import Path
import json, hashlib
R=Path(__file__).resolve().parents[1]
old=json.loads((R/'contracts/openapi-v1-proposed.yaml').read_text())
S=old['components']['schemas'].copy()
def ref(n):return {'$ref':'#/components/schemas/'+n}
def obj(p):return {'type':'object','additionalProperties':False,'required':list(p),'properties':p}
def string(**kw):return {'type':'string',**kw}
D=string(pattern='^[a-f0-9]{64}$')
H=string(pattern='^hist_[a-f0-9]{64}$')
nullable_digest={'type':['string','null'],'pattern':'^[a-f0-9]{64}$'}
S['HistoryIntegrity']=obj({'status':string(enum=['INTEGRITY_VERIFIED','INTEGRITY_FAILED','INTEGRITY_UNVERIFIABLE']), 'algorithm':string(const='sha256'),'canonicalization':string(const='python-json-sortkeys-ascii-v1'),'checked_sha256':nullable_digest,'content_scope':string(enum=['archive_candidate_and_relationships','evidence_canonical_bytes'])})
S['HistoryProvenance']=obj({'kind':string(const='synthetic_local'),'research_authorization':string(const='research_only'),'acquisition_authenticity':string(const='not_authenticated'),'service_baseline_sha256':D,'implementation_sha256':D,'source_set_sha256':D,'reviewed_case':string(),'reviewed_fixture_sha256':D,'research_source_commit':string(pattern='^[a-f0-9]{40}$')})
S['HistoryResultSummary']=obj({'cohort_state':string(enum=['Verified','Mismatch','Pending','Unverified']),'counts':ref('Counts'),'expected_total':{'type':['integer','null'],'minimum':0},'source_population_known':{'type':'boolean'}})
summary={'contract_version':string(const='phase3a-1.0.0'),'history_id':H,'archive_id':string(pattern='^archive_[a-f0-9]{64}$'),'snapshot_id':string(pattern='^history-snapshot_[a-f0-9]{64}$'),'original_snapshot_id':string(minLength=1,maxLength=128),'original_verification_id':string(pattern='^SPEC-00[1-5]$'),'workspace_id':string(const='ws-synthetic-01'),'archive_created_at':string(format='date-time'),'evaluator':ref('EvaluatorIdentity'),'original_contract_sha256':D,'input_evidence_sha256':D,'provenance':ref('HistoryProvenance'),'result_summary':ref('HistoryResultSummary'),'integrity':ref('HistoryIntegrity')}
S['HistorySummary']=obj(summary)
S['HistoryDetail']=obj({**summary,'run':ref('VerificationRun')})
S['HistoryItem']=obj({**S['EvidenceItem']['properties'],'integrity':ref('HistoryIntegrity')})
S['HistoryPage']=obj({'snapshot_id':string(),'next_cursor':{'type':['string','null'],'maxLength':2048},'total':{'type':'integer','minimum':0}})
S['HistoryList']=obj({'contract_version':string(const='phase3a-1.0.0'),'workspace_id':string(const='ws-synthetic-01'),'items':{'type':'array','maxItems':100,'items':ref('HistorySummary')},'page':ref('HistoryPage')})
S['HistoryEvidencePage']=obj({'contract_version':string(const='phase3a-1.0.0'),'history_id':H,'archive_id':summary['archive_id'],'snapshot_id':summary['snapshot_id'],'original_snapshot_id':summary['original_snapshot_id'],'original_verification_id':summary['original_verification_id'],'workspace_id':summary['workspace_id'],'integrity':ref('HistoryIntegrity'),'items':{'type':'array','maxItems':100,'items':ref('HistoryItem')},'page':ref('HistoryPage')})
def param(n,s,where='query',required=False):return {'name':n,'in':where,'required':required,'schema':s}
limit=param('limit',{'type':'integer','minimum':1,'maximum':100,'default':25})
cursor=param('cursor',string(minLength=1,maxLength=2048))
hid=param('history_id',H,'path',True)
snapshot=param('snapshot_id',string(minLength=1,maxLength=128))
def operation(op,schema,params,description):
    codes={400:'Invalid cursor/query or scope conflict',403:'Origin outside exact local allowlist',404:'History not found',405:'Read-only resource',409:'Explicit snapshot conflict',422:'Malformed ID/parameter',500:'Sanitized internal failure',503:'Archive unavailable, schema invalid, or integrity failed/unverifiable'}
    responses={'200':{'description':'Validated local synthetic archive retrieval; not source authentication','content':{'application/json':{'schema':ref(schema)}}}}
    responses.update({str(code):{'description':text,'content':{'application/json':{'schema':ref('Error')}}} for code,text in codes.items()})
    return {'get':{'operationId':op,'description':description,'parameters':params,'responses':responses,'security':[]}}
paths={
'/api/v1/history':operation('listHistory','HistoryList',[limit,cursor,param('verification_id',string(pattern='^SPEC-00[1-5]$'))],'Descending immutable sequence with a cursor-pinned upper boundary. New inserts excluded. Total counts archive entries only. Empty list returns items=[], next_cursor=null, total=0.'),
'/api/v1/history/{history_id}':operation('getHistory','HistoryDetail',[hid,snapshot],'Complete original immutable VerificationRun nested under run. Persistent snapshot_id is distinct from run.snapshot_id (original ephemeral snapshot). Integrity failure blocks 200.'),
'/api/v1/history/{history_id}/evidence':operation('getHistoryEvidence','HistoryEvidencePage',[hid,limit,cursor,snapshot,param('include_payload',{'type':'boolean','default':True})],'Ordered references exactly match run.evidence_references. Cursor binds history/archive/database/snapshot/query. Integrity checks precede optional payload omission. Missing-at-evaluation content is explicitly unverifiable; unexpected missing content is503. No unqualified success on digest mismatch.')}
out={'openapi':'3.1.1','info':{'title':'FlowAssert Phase 3A additive history API','version':'phase3a-1.0.0','description':'Local synthetic read-only archive extension. Frozen Phase0 operations unchanged. No write/delete/update/live endpoints. Internal content consistency does not authenticate external sources.'},'servers':[{'url':'http://127.0.0.1:8765'}],'paths':paths,'components':{'schemas':S},'security':[],'x-frozen-contract-sha256':hashlib.sha256((R/'contracts/openapi-v1-proposed.yaml').read_bytes()).hexdigest()}
raw=(json.dumps(out,indent=2,ensure_ascii=True)+'\n').encode()
p=R/'contracts/openapi-history-v1.yaml';p.write_bytes(raw)
h=hashlib.sha256(raw).hexdigest()
(R/'app/history_contract.py').write_text('"""Pinned additive contract identity; regenerate only for a reviewed version change."""\nCONTRACT_VERSION = "phase3a-1.0.0"\nCONTRACT_SHA256 = "'+h+'"\n')
print(h)
