"""Frozen JSON Schema and additional F004 application invariants."""
import json
from collections import Counter
from datetime import datetime, timedelta
from jsonschema import Draft202012Validator, FormatChecker
from .identity import ROOT, MODEL_HASH, CONTRACT_HASH, ServiceError, checked_bytes, digest

SPEC = json.loads(checked_bytes(ROOT / 'contracts/openapi-v1-proposed.yaml', CONTRACT_HASH))

def require(condition, code):
    if not condition: raise ServiceError(503, code)


def schema(name, data):
    document = {'$ref': '#/components/schemas/' + name, 'components': SPEC['components']}
    if next(Draft202012Validator(document, format_checker=FormatChecker()).iter_errors(data), None):
        raise ServiceError(503, 'response_schema_invalid')


def time_projection(result, mapping):
    kind = mapping['kind']
    if kind == 'unmapped':
        require(mapping['origin_iso'] is None and mapping['seconds_per_tick'] is None, 'unmapped_parameters')
        origin = None
    else:
        require(mapping['origin_iso'] is not None and type(mapping['seconds_per_tick']) is int and mapping['seconds_per_tick'] > 0, 'affine_parameters')
        origin = datetime.fromisoformat(mapping['origin_iso'].replace('Z', '+00:00'))
    events, diagnostics = {}, []
    for name in ['business_obligation_at', 'observed_at', 'evaluation_at', 'deadline']:
        tick = result[name]; events[name] = None
        code = 'missing_time_tick' if tick is None else ('invalid_time_tick' if type(tick) is not int or abs(tick) > 2**53-1 else None)
        if not code and origin is not None:
            try: events[name] = (origin + timedelta(seconds=tick * mapping['seconds_per_tick'])).isoformat().replace('+00:00', 'Z')
            except (OverflowError, ValueError): code = 'invalid_time_tick'
        if code: diagnostics.append({'path': 'result.'+name, 'code': code, 'message': 'Research tick is missing or cannot be mapped; no real observation time is inferred.'})
    if kind == 'unmapped': diagnostics.append({'path': 'evaluation_context.time_mapping', 'code': 'time_mapping_unavailable', 'message': 'Display mapping unavailable.'})
    return events, diagnostics


def validate_item(item, include_payload=True):
    schema('EvidenceItem', item)
    ref, payload = item['reference'], item['payload']
    if ref['availability'] != 'available':
        require(payload is None and bool(item['payload_reason']), 'unavailable_payload')
    elif not include_payload:
        require(payload is None and item['payload_reason'] == 'omitted_by_request', 'payload_omission')
    else:
        require(payload is not None and digest(payload) == ref['sha256'] and item['payload_reason'] is None, 'payload_binding')


def validate_run(run, evidence, result):
    schema('VerificationRun', run)
    ctx = run['evaluation_context']; r = run['result']
    require(run['meta']['workspace_id'] == run['identity']['workspace_id'] == 'ws-synthetic-01', 'workspace_conflict')
    require(run['meta']['contract_version'] == '0.1.1-proposed' and run['meta']['provider_mode'] == 'LOCAL_RESEARCH' and run['meta']['synthetic'] is True, 'scope_conflict')
    require(ctx['evaluator']['model_sha256'] == MODEL_HASH and ctx['input_evidence_sha256'] == digest(evidence), 'evaluator_input_binding')
    require(run['assurance']['research_authorization'] == 'research_only' and run['assurance']['release_approval_reference'] is None, 'approval_reference_invalid')
    for row in run['source_snapshot']['rows']:
        field = row['phone']
        require(field['state'] != 'present' or isinstance(field['value'], str), 'present_value_null')
        require(field['state'] not in ('missing','null','inaccessible','redacted') or field['value'] is None, 'unavailable_value_invented')
    require(r['source_population_known'] or r['expected_total'] is None, 'unknown_population_total')
    events, diags = time_projection(r, ctx['time_mapping'])
    require(ctx['event_times'] == events, 'time_mapping_conflict')
    require({(x['path'],x['code']) for x in run['diagnostics']} == {(x['path'],x['code']) for x in diags}, 'time_diagnostics_conflict')
    require(r == result, 'raw_result_changed')
    counts = Counter(row['state'] for row in r['records'])
    require(all(r['counts'][k] == counts[k] for k in r['counts']), 'counts_conflict')
    rows = evidence['source']['rows']
    require(len(rows) == len(r['records']) == len(run['source_snapshot']['rows']) == r['source_rows_observed'], 'row_inventory_conflict')
    for i, (row, raw, context) in enumerate(zip(r['records'], rows, run['source_snapshot']['rows'])):
        require(row['source_row'] == context['source_row'] == i and row['key'] == context['key'] == raw.get('key'), 'row_order_conflict')
        expected = {'state': 'missing', 'value': None} if 'phone' not in raw else {'state': 'null' if raw['phone'] is None else 'present' if isinstance(raw['phone'],str) else 'unsupported', 'value': raw['phone']}
        require(context['phone'] == expected, 'source_context_conflict')
    refs=run['evidence_references']
    require([x['role'] for x in refs] == ['source','destination','policy','evaluation_input'], 'reference_order')
    require(len(set(x['id'] for x in refs)) == 4, 'duplicate_reference')
    for ref in refs:
        payload = evidence if ref['role']=='evaluation_input' else evidence[ref['role']]
        require(ref['sha256']==digest(payload), 'reference_digest')
        if ref['role'] != 'evaluation_input':
            field={'source':'source_snapshot','destination':'destination_observation','policy':'policy_context'}[ref['role']]
            require(run[field]['evidence_reference_id']==ref['id'], 'reference_identity')
    require(r['source_basis_sha256']==digest(evidence['source']) and r['rule_basis_sha256']==digest(evidence['policy']), 'basis_digest')
    require(run['retry_context']['pending_source_rows'] == [x['source_row'] for x in r['records'] if x['state']=='Pending'], 'retry_rows')
    s,d,p = evidence['source'], evidence['destination'], evidence['policy']
    ss,ds,pc = run['source_snapshot'],run['destination_observation'],run['policy_context']
    for key in ['namespace','version']:
        require(ss[key]==s.get(key), 'source_projection')
    require(ss['provenance_channel']==s.get('provenance',{}).get('channel') and ss['inventory_method']==s.get('inventory',{}).get('method') and ss['inventory_eligible_count']==s.get('inventory',{}).get('eligible_count'), 'source_inventory_projection')
    for key in ['account','object','access','query_total']:
        require(ds[key]==d.get(key), 'destination_projection')
    require(ds['page_count']==len(d.get('pages',[])), 'page_count_conflict')
    ids={x.get('id') for page in d.get('pages',[]) for x in page.get('rows',[]) if isinstance(x,dict) and isinstance(x.get('id'),str)}
    require(ds['distinct_ids_returned']==len(ids), 'destination_count_conflict')
    for key in pc:
        if key!='evidence_reference_id':require(pc[key]==p.get(key), 'policy_projection')
    require(ctx['evaluator']==json.loads((ROOT/'research-lock.json').read_text()), 'evaluator_identity_conflict')
    require(run['assurance']['acquisition_authenticity']=='not_authenticated', 'authenticity_claim')
    require(all(x['acquisition_kind']=='synthetic_local' and x['external_authenticity']=='not_authenticated' for x in refs), 'evidence_provenance_claim')
    retry=run['retry_context']
    require(retry['automatic_retry_enabled'] is False and retry['next_attempt_at'] is None and retry['policy_retry_viable']==p.get('retry_viable'), 'retry_policy')
    now,deadline=evidence.get('now'),p.get('deadline')
    window=now<deadline if type(now) is int and type(deadline) is int else None
    require(retry['window_open_at_evaluation']==window, 'retry_window')
