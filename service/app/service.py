"""Controlled fixture import, immutable serialized catalogue, signed pagination."""
import copy
import json
import os
import stat
import secrets
import hmac
import hashlib
import base64
from pathlib import Path
from .adapter import Adapter
from .identity import ROOT, EXAMPLES_HASH, checked_bytes, canonical, digest, check_sources, ServiceError
from .validation import validate_run, validate_item, time_projection, require, schema

KEY_FILE_ENV = 'FLOWASSERT_CURSOR_KEY_FILE'
DEFAULT_KEY_FILE = ROOT/'.state/cursor-hmac.key'


def cursor_key():
    """Local cursor-authentication key that outlives one process, so an authentic cursor whose snapshot
    expired at restart is recognised as 409 rather than indistinguishable from a forgery (400).
    Created once, atomically, owner-only; an unusable file fails closed and is never silently replaced."""
    path = Path(os.environ.get(KEY_FILE_ENV, str(DEFAULT_KEY_FILE)))
    try:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if not os.path.lexists(path):
            temp = path.with_name(f'.{path.name}.{secrets.token_hex(8)}.tmp')
            fd = os.open(temp, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
            try:
                with os.fdopen(fd, 'w') as f: f.write(secrets.token_hex(32))
                try: os.link(temp, path)
                except FileExistsError: pass
            finally: os.unlink(temp)
        fd = os.open(path, os.O_RDONLY|os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            text = os.read(fd, 65).decode('ascii') if stat.S_ISREG(info.st_mode) else ''
        finally: os.close(fd)
    except (OSError, UnicodeDecodeError): raise ServiceError(503,'cursor_key_unavailable') from None
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid() \
            or len(text) != 64 or any(c not in '0123456789abcdef' for c in text):
        raise ServiceError(503,'cursor_key_unavailable')
    return bytes.fromhex(text)


class Catalog:
    def __init__(self):
        self.adapter = Adapter()
        self._runs = {}
        self._seals = {}
        self._key = cursor_key()
        # The frozen package supplies controlled metadata/inputs, never serving verdicts.
        package = json.loads(checked_bytes(ROOT/'contracts/verification-examples.json', EXAMPLES_HASH))
        for reviewed_case in package['examples']:
            case = json.loads((ROOT/'fixtures'/f"{reviewed_case['case_id']}.json").read_text())
            require(case == reviewed_case, 'fixture_identity_conflict')
            evidence = copy.deepcopy(case['input_evidence'])
            raw, at = self.adapter.evaluate(evidence)
            # Contradiction with the independently authored research result is a stop condition.
            require(raw == case['proposed_response']['result'], 'reviewed_expectation_conflict')
            run = copy.deepcopy(case['proposed_response'])
            run['result'] = raw
            run['evaluation_context']['service_executed_at'] = at
            run['identity']['created_at'] = at
            run['meta']['generated_at'] = at
            events, diagnostics = time_projection(raw, run['evaluation_context']['time_mapping'])
            run['evaluation_context']['event_times'] = events
            run['diagnostics'] = diagnostics
            run['snapshot_id'] = 'pending-publication'
            validate_run(run, evidence, raw)
            items = []
            for ref in run['evidence_references']:
                payload = evidence if ref['role'] == 'evaluation_input' else evidence[ref['role']]
                item = {'reference': ref, 'payload': payload if ref['availability']=='available' else None, 'payload_reason': None if ref['availability']=='available' else ref['reason']}
                validate_item(item)
                items.append(item)
            self._runs[run['identity']['id']] = {'run':run,'input':evidence,'raw':raw,'items':items}
        self.snapshot = 'snapshot-' + digest(self._runs)
        for key, bundle in self._runs.items():
            bundle['run']['snapshot_id'] = self.snapshot
            self._runs[key] = canonical(bundle)
            self._seals[key] = hashlib.sha256(self._runs[key]).hexdigest()

    def read(self, run_id, snapshot=None):
        check_sources()
        if snapshot is not None and snapshot != self.snapshot: raise ServiceError(409,'snapshot_unavailable')
        if run_id not in self._runs: raise ServiceError(404,'run_not_found')
        data=self._runs[run_id]
        require(hashlib.sha256(data).hexdigest()==self._seals[run_id], 'snapshot_content_corrupt')
        bundle=json.loads(data)
        require(bundle['run']['snapshot_id']==self.snapshot and bundle['run']['identity']['id']==run_id, 'snapshot_identity')
        validate_run(bundle['run'],bundle['input'],bundle['raw'])
        require([x['reference'] for x in bundle['items']]==bundle['run']['evidence_references'], 'evidence_inventory')
        for item in bundle['items']: validate_item(item)
        return bundle

    def _encode(self, obj):
        data=canonical(obj)
        token=base64.urlsafe_b64encode(data).decode().rstrip('=')+'.'+hmac.new(self._key,data,hashlib.sha256).hexdigest()
        # Never publish a successful page with an unusable continuation (frozen request cap).
        if len(token)>2048: raise ServiceError(503,'cursor_size_exceeded')
        return token

    def _decode(self, cursor):
        try:
            if not isinstance(cursor,str) or not 1<=len(cursor)<=2048: raise ValueError()
            encoded, sig=cursor.split('.')
            data=base64.b64decode(encoded+'='*(-len(encoded)%4),altchars=b'-_',validate=True)
            if not hmac.compare_digest(sig,hmac.new(self._key,data,hashlib.sha256).hexdigest()): raise ValueError()
            obj=json.loads(data)
            if not isinstance(obj,dict): raise ValueError()
            # Authenticate the received bytes first. No version means the accepted legacy format;
            # an unsupported/malformed version must never fall back to that interpretation.
            versioned='v' in obj
            if versioned and (type(obj['v']) is not int or obj['v']!=2): raise ValueError()
            if set(obj)!=({'v','scope','snapshot','offset'} if versioned else {'scope','snapshot','offset'}): raise ValueError()
            scope=obj['scope']; identity='run_sha256' if versioned else 'run'
            if not isinstance(scope,dict) or set(scope)!={identity,'limit','include_payload','workspace','mode','contract'}: raise ValueError()
            if not isinstance(scope[identity],str): raise ValueError()
            if versioned:
                if len(scope[identity])!=64 or any(c not in '0123456789abcdef' for c in scope[identity]): raise ValueError()
            elif not 1<=len(scope[identity])<=128: raise ValueError()
            if type(scope['limit']) is not int or not 1<=scope['limit']<=100 or type(scope['include_payload']) is not bool: raise ValueError()
            if any(not isinstance(scope[k],str) for k in ('workspace','mode','contract')): raise ValueError()
            if not isinstance(obj['snapshot'],str) or not 1<=len(obj['snapshot'])<=128: raise ValueError()
            if type(obj['offset']) is not int or obj['offset']<=0: raise ValueError()
            return obj
        except (ValueError, TypeError): raise ServiceError(400,'invalid_cursor') from None

    def evidence(self, run_id, snapshot=None, limit=25, cursor=None, include_payload=True):
        offset=0
        scope={'run':run_id,'limit':limit,'include_payload':include_payload,'workspace':'ws-synthetic-01','mode':'LOCAL_RESEARCH','contract':'0.1.1-proposed'}
        compact_scope={k:v for k,v in scope.items() if k!='run'}
        compact_scope['run_sha256']=digest({'domain':'flowassert-evidence-run-id-v2','run_id':run_id})
        if cursor is not None:
            decoded=self._decode(cursor)
            expected=compact_scope if 'v' in decoded else scope
            if canonical(decoded['scope']) != canonical(expected): raise ServiceError(400,'cursor_query_conflict')
            if snapshot is not None and snapshot!=decoded['snapshot']: raise ServiceError(409,'snapshot_conflict')
            snapshot=decoded['snapshot']; offset=decoded['offset']
        bundle=self.read(run_id,snapshot)
        if cursor is not None and (offset%limit or offset>=len(bundle['items'])): raise ServiceError(400,'invalid_cursor')
        all_items=bundle['items']; items=all_items[offset:offset+limit]
        for item in items:
            if not include_payload:
                item['payload']=None;item['payload_reason']='omitted_by_request'
            validate_item(item,include_payload)
        end=offset+len(items)
        token=self._encode({'v':2,'scope':compact_scope,'snapshot':self.snapshot,'offset':end}) if end<len(all_items) else None
        response={'meta':bundle['run']['meta'],'run_id':run_id,'items':items,'page':{'snapshot_id':self.snapshot,'next_cursor':token,'total':len(all_items)}}
        schema('EvidencePage',response)
        return response
