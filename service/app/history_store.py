"""Transactional immutable archives. No evaluator calls or writes on HTTP reads."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from uuid import uuid4
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import ValidationError
from .identity import ROOT, MODEL_HASH, CONTRACT_HASH, EXAMPLES_HASH, canonical, digest, checked_bytes, load_evaluator, ServiceError
from .admission_models import RunBoundExecutionContext, RunBoundEvidenceReceipt
from .execution_collector import verify_receipt
from .validation import validate_run, validate_item, time_projection
from .history_contract import CONTRACT_VERSION, CONTRACT_SHA256
from .history_security import HistoryError, fail, state_directory, private_file, signing_key, Cursors, history_id
from .admission_serialization import public_admission

SCHEMA_VERSION = 1
MIGRATION = ROOT / 'migrations/001.sql'
DEFAULT_STATE = ROOT / '.runtime/delivery'


def sha(raw): return hashlib.sha256(raw).hexdigest()

def equal(a, b): return canonical(a) == canonical(b)


def integrity(status, checked=None, scope='archive_candidate_and_relationships'):
    return {'status': status, 'algorithm': 'sha256', 'canonicalization': 'python-json-sortkeys-ascii-v1',
            'checked_sha256': checked, 'content_scope': scope}


def check_evidence(ref, raw):
    """Hash the actual stored bytes; require the accepted canonical encoding too."""
    if ref['availability'] != 'available':
        if raw is not None: fail('unavailable_payload', 'INTEGRITY_FAILED')
        return integrity('INTEGRITY_UNVERIFIABLE', scope='evidence_canonical_bytes')
    if raw is None: fail('archived_evidence_missing')
    try:
        value = json.loads(raw)
        if canonical(value) != raw: fail('noncanonical_evidence', 'INTEGRITY_FAILED')
    except (ValueError, TypeError, UnicodeError): fail('archived_evidence_invalid', 'INTEGRITY_FAILED')
    actual = sha(raw)
    if ref['sha256'] is None: return integrity('INTEGRITY_UNVERIFIABLE', scope='evidence_canonical_bytes')
    if actual != ref['sha256']: fail('evidence_digest_mismatch', 'INTEGRITY_FAILED')
    return integrity('INTEGRITY_VERIFIED', actual, 'evidence_canonical_bytes')


def history_spec():
    return json.loads(checked_bytes(ROOT / 'contracts/openapi-history-v1.yaml', CONTRACT_SHA256))


def validate_response(name, data):
    spec = history_spec()
    s = {'$ref': '#/components/schemas/' + name, 'components': spec['components']}
    # The reviewed Phase 3A schemas are frozen and disallow additional fields.
    # Validate their complete projection before returning the additive 3B fields.
    projection = json.loads(canonical(data))
    summaries = ([projection] if name == 'HistoryDetail' else
                 projection.get('items', []) if name == 'HistoryList' else [])
    for summary in summaries:
        for key in ('capture_status', 'admission_status', 'run_bound_metadata'):
            summary.pop(key, None)
    if next(Draft202012Validator(s, format_checker=FormatChecker()).iter_errors(projection), None):
        fail('archive_response_schema_invalid', 'INTEGRITY_FAILED')
    return data


def source_identity():
    baseline = ROOT / 'docs/phase3a/evidence/baseline-source.json'
    files = [*sorted((ROOT / 'app').glob('*.py')), MIGRATION, ROOT / 'run_history.py',
             ROOT / 'archive_cli.py', ROOT / 'vendor/model.py', ROOT / 'contracts/openapi-history-v1.yaml']
    implementation = digest({str(p.relative_to(ROOT)): sha(p.read_bytes()) for p in files})
    source = {'fixtures': {p.name: sha(p.read_bytes()) for p in sorted((ROOT / 'fixtures').glob('*.json'))},
              'evaluator': MODEL_HASH, 'contract': CONTRACT_HASH, 'history_contract': CONTRACT_SHA256,
              'research_lock': json.loads((ROOT / 'research-lock.json').read_text()),
              'baseline': sha(baseline.read_bytes()), 'implementation': implementation}
    return source, digest(source)


# Detect ordinary on-disk code changes after this module was loaded. This is a
# development guard, not proof of the bytes executed or protection against an
# actor able to replace inputs during import or restore them between checks.
try:
    _LOADED_SOURCE_IDENTITY = source_identity()
except (OSError, ValueError, TypeError):
    _LOADED_SOURCE_IDENTITY = None


def make_candidate(bundle, case, snapshot_basis):
    source, source_set = source_identity()
    return {'bundle': bundle, 'snapshot_basis': snapshot_basis, 'provenance': {'kind': 'synthetic_local', 'research_authorization': 'research_only',
        'acquisition_authenticity': 'not_authenticated', 'service_baseline_sha256': source['baseline'],
        'implementation_sha256': source['implementation'], 'source_set_sha256': source_set,
        'reviewed_case': case['case_id'], 'reviewed_fixture_sha256': source['fixtures'][case['case_id'] + '.json'],
        'research_source_commit': source['research_lock']['source_commit']}, 'original_contract_sha256': CONTRACT_HASH,
        'history_contract_sha256': CONTRACT_SHA256}


def semantic_run(run):
    r = json.loads(canonical(run))
    # Only execution receipt fields differ from the reviewed static projection.
    r['identity']['created_at'] = None
    r['meta']['generated_at'] = None
    r['evaluation_context']['service_executed_at'] = None
    r['snapshot_id'] = None
    # SPEC-004's static example has older explanatory wording. Actual service
    # wording is separately validated against its unchanged time_projection.
    r['diagnostics'] = [{'path': x['path'], 'code': x['code']} for x in r['diagnostics']]
    return r


def evaluate_admission(candidate, current_execution_context=None, *, signing_secret=None):
    """Verify run and artifact bindings; untrusted self-reports remain unadmitted.

    A signing secret from the archive state is required to authenticate the
    collector receipt. ArchiveStore also enforces one-time use at publication.
    """
    def result(capture, admission):
        return {'capture_status': capture, 'admission_status': admission}

    incomplete = result('CAPTURE_INCOMPLETE', 'REJECTED_INCOMPLETE_EXECUTION')
    if not isinstance(candidate, dict): return incomplete
    has_context = 'execution_context' in candidate
    has_receipt = 'evidence_receipt' in candidate
    if not has_context and not has_receipt:
        if current_execution_context is not None: return incomplete
        return result('CAPTURE_NOT_IMPLEMENTED', 'ADMISSION_NOT_IMPLEMENTED')
    if not has_context or not has_receipt: return incomplete
    try:
        context = RunBoundExecutionContext.model_validate(candidate['execution_context'])
        receipt = RunBoundEvidenceReceipt.model_validate(candidate['evidence_receipt'])
        current = (RunBoundExecutionContext.model_validate(current_execution_context)
                   if current_execution_context is not None else context)
        run = candidate['bundle']['run']
        run_id = run['identity']['id']
        source_basis = run['result']['source_basis_sha256']
        rule_basis = run['result']['rule_basis_sha256']
    except (ValidationError, KeyError, TypeError):
        return incomplete
    if (receipt.run_id != current.run_id or
            receipt.execution_cwd_sha256 != current.execution_cwd_sha256):
        return result('CAPTURE_STALE_REJECTED', 'REJECTED_STALE_RECEIPT')
    authenticated = signing_secret is not None and verify_receipt(signing_secret, candidate['execution_context'], candidate['evidence_receipt'])
    if (context != current or (not authenticated and current.run_id != run_id) or
            current.source_basis_sha256 != source_basis or
            current.rule_basis_sha256 != rule_basis):
        return result('CAPTURE_INCOMPLETE', 'REJECTED_BINDING_MISMATCH')
    if current.subprocess_failures > 0:
        return result('CAPTURE_SUBPROCESS_FAILED', 'REJECTED_INCOMPLETE_EXECUTION')
    if (not current.verifier_work_completed or current.outer_exit_status != 0 or
            current.completed_mono_ns < current.started_mono_ns):
        return incomplete
    if not authenticated: return incomplete
    if (receipt.input_sha256 != digest(candidate['bundle']['input']) or
            receipt.result_sha256 != digest(candidate['bundle']['raw'])):
        return result('CAPTURE_INCOMPLETE', 'REJECTED_BINDING_MISMATCH')
    return result('CAPTURED_COMPLETE', 'ADMITTED_RUN_BOUND')


def validate_candidate(candidate, replay=False, current_execution_context=None, *, signing_secret=None):
    try:
        required = {'bundle', 'snapshot_basis', 'provenance', 'original_contract_sha256', 'history_contract_sha256'}
        if not required <= set(candidate) or set(candidate) - required - {'execution_context', 'evidence_receipt'}:
            fail('archive_schema_invalid', 'INTEGRITY_FAILED')
        admission = evaluate_admission(candidate, current_execution_context, signing_secret=signing_secret)
        if admission['admission_status'] not in ('ADMISSION_NOT_IMPLEMENTED', 'ADMITTED_RUN_BOUND'):
            raise HistoryError(409, admission['admission_status'].lower())
        if candidate['original_contract_sha256'] != CONTRACT_HASH or candidate['history_contract_sha256'] != CONTRACT_SHA256:
            raise HistoryError(409, 'unsupported_contract_identity')
        b, p = candidate['bundle'], candidate['provenance']
        if set(b) != {'run', 'input', 'raw', 'items'}: fail('archive_schema_invalid', 'INTEGRITY_FAILED')
        run = b['run']
        expected_lock = json.loads((ROOT / 'research-lock.json').read_text())
        if not equal(run['evaluation_context']['evaluator'], expected_lock):
            raise HistoryError(409, 'unsupported_evaluator_identity')
        cases = json.loads(checked_bytes(ROOT / 'contracts/verification-examples.json', EXAMPLES_HASH))['examples']
        matched = [x for x in cases if x['case_id'] == p['reviewed_case']]
        if len(matched) != 1: raise HistoryError(409, 'unsupported_synthetic_source')
        case = matched[0]
        if not equal(b['input'], case['input_evidence']): raise HistoryError(409, 'unsupported_synthetic_source')
        if not equal(semantic_run(run), semantic_run(case['proposed_response'])):
            fail('reviewed_projection_conflict', 'INTEGRITY_FAILED')
        if not isinstance(run['snapshot_id'], str) or not run['snapshot_id'].startswith('snapshot-'):
            fail('original_snapshot_binding', 'INTEGRITY_FAILED')
        basis = candidate['snapshot_basis']
        if not isinstance(basis, dict) or set(basis) != {'SPEC-001','SPEC-002','SPEC-003','SPEC-004','SPEC-005'}:
            fail('original_snapshot_inventory', 'INTEGRITY_FAILED')
        if run['snapshot_id'] != 'snapshot-' + digest(basis):
            fail('original_snapshot_digest', 'INTEGRITY_FAILED')
        member = json.loads(canonical(basis[run['identity']['id']]))
        if member['run']['snapshot_id'] != 'pending-publication': fail('original_snapshot_basis_invalid', 'INTEGRITY_FAILED')
        member['run']['snapshot_id'] = run['snapshot_id']
        if not equal(member, b): fail('original_snapshot_membership', 'INTEGRITY_FAILED')
        for at in (run['identity']['created_at'], run['meta']['generated_at'], run['evaluation_context']['service_executed_at']):
            if not isinstance(at, str) or not equal(at, run['evaluation_context']['service_executed_at']):
                fail('execution_receipt_binding', 'INTEGRITY_FAILED')
        validate_run(run, b['input'], b['raw'])
        if not equal(run['diagnostics'], time_projection(b['raw'], run['evaluation_context']['time_mapping'])[1]):
            fail('diagnostic_projection_conflict', 'INTEGRITY_FAILED')
        if not equal(b['raw'], case['proposed_response']['result']): fail('reviewed_result_conflict', 'INTEGRITY_FAILED')
        if replay and not equal(load_evaluator()(json.loads(canonical(b['input']))), b['raw']):
            fail('evaluator_replay_conflict', 'INTEGRITY_FAILED')
        if not equal([i['reference'] for i in b['items']], run['evidence_references']):
            fail('evidence_reference_binding', 'INTEGRITY_FAILED')
        if len(b['items']) != 4: fail('evidence_inventory', 'INTEGRITY_FAILED')
        for item in b['items']:
            validate_item(item)
            ref = item['reference']
            payload = b['input'] if ref['role'] == 'evaluation_input' else b['input'][ref['role']]
            if ref['availability'] == 'available' and not equal(item['payload'], payload):
                fail('evidence_payload_binding', 'INTEGRITY_FAILED')
            check_evidence(ref, canonical(item['payload']) if item['payload'] is not None else None)
        expected_fixture_hash = sha((ROOT / 'fixtures' / (case['case_id'] + '.json')).read_bytes())
        if p['reviewed_fixture_sha256'] != expected_fixture_hash or p['research_source_commit'] != expected_lock['source_commit']:
            fail('archive_provenance_binding', 'INTEGRITY_FAILED')
        # Strict schema for all stored provenance fields, without depending on a current execution receipt.
        schema = history_spec()
        validator = Draft202012Validator({'$ref': '#/components/schemas/HistoryProvenance', 'components': schema['components']})
        if next(validator.iter_errors(p), None): fail('archive_provenance_invalid', 'INTEGRITY_FAILED')
        return admission
    except HistoryError: raise
    except ServiceError as e: fail('archive_' + e.code, 'INTEGRITY_FAILED')
    except (KeyError, TypeError, ValueError, IndexError, OSError): fail('archive_schema_invalid', 'INTEGRITY_FAILED')


def schema_signature(connection):
    return connection.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").fetchall()


def expected_schema():
    with sqlite3.connect(':memory:') as c:
        c.executescript(MIGRATION.read_text())
        return schema_signature(c)


class ArchiveStore:
    def __init__(self, directory=None):
        self.directory = Path(directory or os.environ.get('FLOWASSERT_HISTORY_STATE', str(DEFAULT_STATE)))
        self.path = self.directory / 'history.sqlite3'

    def initialize(self):
        directory = state_directory(self.directory, create=True)
        private_file(self.path, create=True)
        signing_key(directory, create=True)
        with self.connection(write=True, initializing=True) as c:
            # Check and migrate while holding the same write lock: a second
            # initializer must re-read the version after the first commits.
            c.execute('BEGIN IMMEDIATE')
            version = c.execute('PRAGMA user_version').fetchone()[0]
            if version == 0:
                if c.execute('SELECT count(*) FROM sqlite_master').fetchone()[0]: fail('unversioned_nonempty_database')
                # executescript() commits an existing transaction before it
                # runs. Execute complete SQL statements individually instead,
                # preserving the lock and rollback on any migration failure.
                statement = ''
                for char in MIGRATION.read_text():
                    statement += char
                    if char == ';' and sqlite3.complete_statement(statement):
                        c.execute(statement)
                        statement = ''
                if statement.strip(): fail('archive_migration_incomplete')
                c.execute('PRAGMA user_version=1')
            self._check_schema(c)
            c.execute('INSERT OR IGNORE INTO archive_meta(singleton,database_id) VALUES(1,?)', (str(uuid4()),))

    def _check_schema(self, c):
        if c.execute('PRAGMA user_version').fetchone()[0] != SCHEMA_VERSION: fail('unsupported_schema_version')
        if not equal(schema_signature(c), expected_schema()): fail('archive_schema_invalid', 'INTEGRITY_FAILED')

    @contextmanager
    def connection(self, write=False, initializing=False):
        c = None
        try:
            directory = state_directory(self.directory)
            before, _ = private_file(self.path)
            for suffix in ('-journal', '-wal', '-shm'):
                side = Path(str(self.path) + suffix)
                if os.path.lexists(side): private_file(side, transient=True)
            c = sqlite3.connect(self.path.as_uri() + ('?mode=rw' if write else '?mode=ro'), uri=True, timeout=5, isolation_level=None)
            c.execute('PRAGMA foreign_keys=ON')
            if c.execute('PRAGMA foreign_keys').fetchone()[0] != 1: fail('foreign_keys_disabled')
            c.execute('PRAGMA busy_timeout=5000')
            if write:
                if c.execute('PRAGMA journal_mode=DELETE').fetchone()[0] != 'delete': fail('journal_mode_unavailable')
                c.execute('PRAGMA synchronous=FULL')
                if c.execute('PRAGMA synchronous').fetchone()[0] != 2: fail('durability_configuration_failed')
            else: c.execute('PRAGMA query_only=ON')
            after, _ = private_file(self.path)
            if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino): fail('database_identity_changed')
            if not initializing:
                c.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
                self._check_schema(c)
                if c.execute('PRAGMA quick_check').fetchall() != [('ok',)] or c.execute('PRAGMA foreign_key_check').fetchone():
                    fail('archive_database_corrupt', 'INTEGRITY_FAILED')
            yield c
            if c.in_transaction: c.commit()
        except sqlite3.Error: fail('archive_database_unavailable')
        except OSError: fail('archive_unavailable')
        finally:
            if c is not None:
                if c.in_transaction: c.rollback()
                c.close()

    def _db_scope(self, c):
        row = c.execute('SELECT database_id FROM archive_meta WHERE singleton=1').fetchone()
        if not row: fail('archive_metadata_invalid')
        return {'database_id': row[0], 'contract_sha256': CONTRACT_SHA256}

    def _cursors(self): return Cursors(signing_key(state_directory(self.directory)))

    def admission(self, candidate):
        return evaluate_admission(candidate, signing_secret=signing_key(state_directory(self.directory)))

    def publish(self, candidate, c=None, fault=None, *, current_execution_context=None):
        if c is None:
            with self.connection(write=True) as own:
                return self.publish(candidate, own, fault, current_execution_context=current_execution_context)
        # A stored receipt and its stored context can both be replayed.  The
        # publishing caller must bind Phase 3B evidence to its current run.
        if ('execution_context' in candidate or 'evidence_receipt' in candidate) and current_execution_context is None:
            raise HistoryError(409, 'current_execution_context_required')
        secret = signing_key(state_directory(self.directory))
        validate_candidate(candidate, replay=True, current_execution_context=current_execution_context, signing_secret=secret)
        if 'execution_context' in candidate:
            # The write transaction serializes this check with insertion. UUIDs
            # are consumed permanently, including across process restarts.
            execution_id = candidate['execution_context']['run_id']
            rows = c.execute("SELECT candidate FROM archives WHERE state='PUBLISHED'")
            for (stored_raw,) in rows:
                stored = json.loads(stored_raw)
                if stored.get('execution_context', {}).get('run_id') == execution_id:
                    raise HistoryError(409, 'execution_receipt_replayed')
        raw = canonical(candidate); identity = sha(raw); hid = 'hist_' + identity
        existing = c.execute('SELECT history_id FROM archives WHERE history_id=?', (hid,)).fetchone()
        if existing:
            stored, _ = self._read(c, hid)
            if canonical(stored) != raw: fail('archive_identity_collision', 'INTEGRITY_FAILED')
            return hid
        b = candidate['bundle']; run = b['run']
        at = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        header = {'history_id': hid, 'archive_id': 'archive_' + identity, 'snapshot_id': 'history-snapshot_' + identity,
                  'verification_id': run['identity']['id'], 'original_snapshot_id': run['snapshot_id'],
                  'created_at': at, 'candidate_sha256': identity}
        inserted = c.execute('INSERT INTO archives(history_id,archive_id,snapshot_id,verification_id,original_snapshot_id,created_at,candidate,candidate_sha256,seal,state) VALUES(?,?,?,?,?,?,?,?,?,?)',
                  (hid, header['archive_id'], header['snapshot_id'], header['verification_id'], header['original_snapshot_id'], at, raw, identity, digest(header), 'BUILDING'))
        header['sequence'] = inserted.lastrowid
        c.execute('UPDATE archives SET seal=? WHERE history_id=?', (digest(header), hid))
        if fault: fault('after_archive_row')
        for pos, record in enumerate(run['result']['records']):
            c.execute('INSERT INTO records(history_id,position,record) VALUES(?,?,?)', (hid, pos, canonical(record)))
        for pos, item in enumerate(b['items']):
            ref = item['reference']
            payload = canonical(item['payload']) if item['payload'] is not None else None
            c.execute('INSERT INTO evidence(history_id,position,reference_id,original_snapshot_id,reference,payload,payload_reason,expected_sha256) VALUES(?,?,?,?,?,?,?,?)',
                      (hid, pos, ref['id'], run['snapshot_id'], canonical(ref), payload, item['payload_reason'], ref['sha256']))
            if fault: fault('after_evidence_row')
        if fault: fault('before_publication')
        c.execute("UPDATE archives SET state='PUBLISHED' WHERE history_id=?", (hid,))
        self._read(c, hid)
        return hid

    def _read(self, c, hid):
        history_id(hid)
        c.row_factory = sqlite3.Row
        row = c.execute("SELECT * FROM archives WHERE history_id=? AND state='PUBLISHED'", (hid,)).fetchone()
        c.row_factory = None
        if row is None: raise HistoryError(404, 'history_not_found')
        r = dict(row)
        try:
            raw = r['candidate']
            if not isinstance(raw, bytes) or sha(raw) != r['candidate_sha256']: fail('archive_digest_mismatch', 'INTEGRITY_FAILED')
            candidate = json.loads(raw)
            if canonical(candidate) != raw: fail('archive_noncanonical', 'INTEGRITY_FAILED')
            try: validate_candidate(candidate, signing_secret=signing_key(state_directory(self.directory)))
            except HistoryError as e: fail(e.code, 'INTEGRITY_FAILED')
            ident = r['candidate_sha256']; b = candidate['bundle']; run = b['run']
            if hid != 'hist_' + ident or r['archive_id'] != 'archive_' + ident or r['snapshot_id'] != 'history-snapshot_' + ident:
                fail('archive_identity_binding', 'INTEGRITY_FAILED')
            header = {k: r[k] for k in ('sequence', 'history_id', 'archive_id', 'snapshot_id', 'verification_id', 'original_snapshot_id', 'created_at', 'candidate_sha256')}
            if digest(header) != r['seal']: fail('archive_metadata_digest_mismatch', 'INTEGRITY_FAILED')
            if r['verification_id'] != run['identity']['id'] or r['original_snapshot_id'] != run['snapshot_id']:
                fail('original_identity_binding', 'INTEGRITY_FAILED')
            records = c.execute('SELECT position,record FROM records WHERE history_id=? ORDER BY position', (hid,)).fetchall()
            if records != [(i, canonical(x)) for i, x in enumerate(run['result']['records'])]:
                fail('archive_record_binding', 'INTEGRITY_FAILED')
            evidence = c.execute('SELECT position,reference_id,original_snapshot_id,reference,payload,payload_reason,expected_sha256 FROM evidence WHERE history_id=? ORDER BY position', (hid,)).fetchall()
            if len(evidence) != len(b['items']): fail('archive_evidence_missing')
            for e, item in zip(evidence, b['items']):
                i, refid, snap, refraw, payload, reason, expected = e
                ref = item['reference']
                check_evidence(ref, payload)
                want = (i, ref['id'], run['snapshot_id'], canonical(ref), canonical(item['payload']) if item['payload'] is not None else None, item['payload_reason'], ref['sha256'])
                if e != want: fail('archive_evidence_binding', 'INTEGRITY_FAILED')
            if [e[0] for e in evidence] != list(range(len(b['items']))): fail('archive_evidence_order', 'INTEGRITY_FAILED')
            return candidate, r
        except HistoryError: raise
        except (KeyError, ValueError, TypeError, UnicodeError): fail('archive_content_invalid', 'INTEGRITY_FAILED')

    def _summary(self, candidate, row):
        run = candidate['bundle']['run']; result = run['result']
        return {'contract_version': CONTRACT_VERSION, 'history_id': row['history_id'], 'archive_id': row['archive_id'],
            'snapshot_id': row['snapshot_id'], 'original_snapshot_id': row['original_snapshot_id'],
            'original_verification_id': row['verification_id'], 'workspace_id': run['identity']['workspace_id'],
            'archive_created_at': row['created_at'], 'evaluator': run['evaluation_context']['evaluator'],
            'original_contract_sha256': candidate['original_contract_sha256'],
            'input_evidence_sha256': run['evaluation_context']['input_evidence_sha256'], 'provenance': candidate['provenance'],
            'result_summary': {k: result[k] for k in ('cohort_state', 'counts', 'expected_total', 'source_population_known')},
            'integrity': integrity('INTEGRITY_VERIFIED', row['candidate_sha256']),
            **public_admission(self.admission(candidate), candidate.get('execution_context'))}

    def detail(self, hid, snapshot=None):
        with self.connection() as c:
            candidate, row = self._read(c, hid)
            if snapshot is not None and snapshot != row['snapshot_id']: raise HistoryError(409, 'history_snapshot_conflict')
            return validate_response('HistoryDetail', {**self._summary(candidate, row), 'run': candidate['bundle']['run']})

    def evidence(self, hid, snapshot=None, limit=25, cursor=None, include_payload=True):
        with self.connection() as c:
            scope = {**self._db_scope(c), 'kind': 'history_evidence', 'history_id': history_id(hid), 'limit': limit, 'include_payload': include_payload}
            offset = 0; token = None; signer = self._cursors()
            if cursor is not None:
                token = signer.decode(cursor)
                if set(token) != {'scope', 'snapshot_id', 'offset'} or not equal(token['scope'], scope): raise HistoryError(400, 'cursor_query_conflict')
                offset = token['offset']
                if type(offset) is not int or offset <= 0 or offset % limit: raise HistoryError(400, 'invalid_cursor')
                if snapshot is not None and snapshot != token['snapshot_id']: raise HistoryError(409, 'history_snapshot_conflict')
                snapshot = token['snapshot_id']
            candidate, row = self._read(c, hid)
            if snapshot is not None and snapshot != row['snapshot_id']: raise HistoryError(409, 'history_snapshot_conflict')
            all_items = candidate['bundle']['items']
            if offset >= len(all_items) and cursor is not None: raise HistoryError(400, 'invalid_cursor')
            items = []
            for item in all_items[offset:offset+limit]:
                status = check_evidence(item['reference'], canonical(item['payload']) if item['payload'] is not None else None)
                result = {**item, 'integrity': status}
                if not include_payload: result.update(payload=None, payload_reason='omitted_by_request')
                items.append(result)
            end = offset + len(items)
            nxt = signer.encode({'scope': scope, 'snapshot_id': row['snapshot_id'], 'offset': end}) if end < len(all_items) else None
            response = {k: self._summary(candidate, row)[k] for k in ('contract_version','history_id','archive_id','snapshot_id','original_snapshot_id','original_verification_id','workspace_id','integrity')}
            return validate_response('HistoryEvidencePage', {**response, 'items': items, 'page': {'snapshot_id': row['snapshot_id'], 'next_cursor': nxt, 'total': len(all_items)}})

    def listing(self, limit=25, cursor=None, verification_id=None):
        with self.connection() as c:
            scope = {**self._db_scope(c), 'kind': 'history_list', 'limit': limit, 'verification_id': verification_id}
            signer = self._cursors()
            maximum = c.execute("SELECT coalesce(max(sequence),0) FROM archives WHERE state='PUBLISHED'").fetchone()[0]
            upper = maximum; before = maximum + 1
            if cursor is not None:
                token = signer.decode(cursor)
                if set(token) != {'scope','upper','before'} or not equal(token['scope'], scope): raise HistoryError(400, 'cursor_query_conflict')
                upper, before = token['upper'], token['before']
                if type(upper) is not int or type(before) is not int or not 0 < before <= upper <= maximum:
                    raise HistoryError(400, 'invalid_cursor')
                boundary = c.execute("SELECT 1 FROM archives WHERE sequence=? AND state='PUBLISHED' AND (? IS NULL OR verification_id=?)", (before, verification_id, verification_id)).fetchone()
                if not boundary: raise HistoryError(400, 'invalid_cursor')
            params = (upper, before, verification_id, verification_id)
            rows = c.execute("SELECT sequence,history_id FROM archives WHERE state='PUBLISHED' AND sequence<=? AND sequence<? AND (? IS NULL OR verification_id=?) ORDER BY sequence DESC LIMIT ?", (*params, limit+1)).fetchall()
            items = [self._summary(*self._read(c, hid)) for seq, hid in rows[:limit]]
            nxt = signer.encode({'scope': scope, 'upper': upper, 'before': rows[limit-1][0]}) if len(rows) > limit else None
            total = c.execute("SELECT count(*) FROM archives WHERE state='PUBLISHED' AND sequence<=? AND (? IS NULL OR verification_id=?)", (upper, verification_id, verification_id)).fetchone()[0]
            snapshot = 'list_' + digest({'scope': scope, 'upper': upper})
            return validate_response('HistoryList', {'contract_version': CONTRACT_VERSION, 'workspace_id': 'ws-synthetic-01', 'items': items,
                    'page': {'snapshot_id': snapshot, 'next_cursor': nxt, 'total': total}})

    def seed(self, reevaluate=False, fault=None):
        from .service import Catalog
        self.initialize()
        # Keep the source-set key and every candidate bound to the same
        # snapshot of on-disk inputs. This does not attest already-loaded code.
        try:
            source, identity = source_identity()
            source = json.loads(canonical(source))
        except (OSError, ValueError, TypeError):
            fail('source_identity_unavailable')
        if digest(source) != identity: fail('source_identity_invalid', 'INTEGRITY_FAILED')
        if (_LOADED_SOURCE_IDENTITY is None or identity != _LOADED_SOURCE_IDENTITY[1]
                or not equal(source, _LOADED_SOURCE_IDENTITY[0])):
            fail('source_restart_required', 'INTEGRITY_FAILED')

        def require_unchanged_source():
            try:
                current, current_identity = source_identity()
                unchanged = current_identity == identity and equal(current, source)
            except (OSError, ValueError, TypeError):
                unchanged = False
            if not unchanged: fail('source_identity_changed', 'INTEGRITY_FAILED')

        with self.connection(write=True) as c:
            require_unchanged_source()
            previous = c.execute('SELECT history_ids FROM seed_sets WHERE identity=?', (identity,)).fetchone()
            if previous and not reevaluate:
                ids = json.loads(previous[0])
                if not isinstance(ids, list) or len(ids) != 5 or len(set(ids)) != 5: fail('seed_registry_invalid', 'INTEGRITY_FAILED')
                runs = [self._read(c, hid)[0] for hid in ids]
                if [x['bundle']['run']['identity']['id'] for x in runs] != ['SPEC-001','SPEC-002','SPEC-003','SPEC-004','SPEC-005']:
                    fail('seed_registry_binding', 'INTEGRITY_FAILED')
                if any(x['provenance']['source_set_sha256'] != identity for x in runs):
                    fail('seed_registry_source_binding', 'INTEGRITY_FAILED')
                require_unchanged_source()
                return {'source_set_sha256': identity, 'history_ids': ids, 'reused': True, 'evaluations': 0}
            catalog = Catalog()
            cases = json.loads(checked_bytes(ROOT/'contracts/verification-examples.json', EXAMPLES_HASH))['examples']
            bundles = {case['proposed_response']['identity']['id']: catalog.read(case['proposed_response']['identity']['id']) for case in cases}
            basis = json.loads(canonical(bundles))
            for bundle in basis.values(): bundle['run']['snapshot_id'] = 'pending-publication'
            ids = []
            for case in cases:
                require_unchanged_source()
                try:
                    candidate = make_candidate(bundles[case['proposed_response']['identity']['id']], case, basis)
                except (OSError, ValueError, TypeError):
                    fail('source_identity_changed', 'INTEGRITY_FAILED')
                if (candidate['provenance']['source_set_sha256'] != identity or
                        candidate['provenance']['implementation_sha256'] != source['implementation']):
                    fail('source_identity_changed', 'INTEGRITY_FAILED')
                ids.append(self.publish(candidate, c, fault))
            require_unchanged_source()
            if not previous: c.execute('INSERT INTO seed_sets(identity,history_ids) VALUES(?,?)', (identity, canonical(ids)))
            require_unchanged_source()
            return {'source_set_sha256': identity, 'history_ids': ids, 'reused': False, 'evaluations': len(catalog.adapter.calls), 'publication_replays': 5}
