"""Real two-process restart probe for evidence cursors (P1-AUD-001).

Starts the supported launcher (run.py, 127.0.0.1:8765, default configuration), obtains a cursor, terminates the
process, starts a second process and reuses the cursor. Expected statuses come from the frozen contract
(frontend-provider-contract.md:119), not from the implementation. Never prints or stores the key bytes.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from app.validation import schema
from app.identity import digest
from app.service import DEFAULT_KEY_FILE, KEY_FILE_ENV

out = Path(os.environ.get('FLOWASSERT_EVIDENCE_DIR', str(root/'evidence'))).resolve()/'restart-http'
if not out.is_relative_to((root/'evidence').resolve()): raise ValueError('Invalid evidence directory')
out.mkdir(parents=True, exist_ok=False)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
env = {k: v for k, v in os.environ.items() if k != KEY_FILE_ENV}
env['PYTHONDONTWRITEBYTECODE'] = '1'
receipt = {'argv': [sys.executable, '-B', 'run.py'], 'cwd': str(root), 'key_file': str(DEFAULT_KEY_FILE),
           'key_env_override': None, 'processes': [], 'requests': [], 'checks': []}


def now(): return datetime.now(timezone.utc).isoformat()


def port_free():
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(('127.0.0.1', 8765))


def get(path, params=None):
    url = 'http://127.0.0.1:8765' + path + ('?' + urllib.parse.urlencode(params) if params else '')
    try:
        with opener.open(url, timeout=10) as r: return r.status, dict(r.headers), json.load(r)
    except urllib.error.HTTPError as exc: return exc.code, dict(exc.headers), json.load(exc)


def start(n):
    port_free()
    log = (out/f'server-{n}.log').open('w')
    p = subprocess.Popen(receipt['argv'], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
    record = {'n': n, 'pid': p.pid, 'started_at': now()}
    for _ in range(100):
        if p.poll() is not None: raise RuntimeError(f'server {n} exited during startup')
        try: get('/api/v1/verifications/SPEC-001'); break
        except urllib.error.URLError: time.sleep(.1)
    else: raise RuntimeError('startup timeout')
    record['ready_at'] = now()
    listen = subprocess.run(['lsof', '-nP', '-a', '-p', str(p.pid), '-iTCP', '-sTCP:LISTEN'], capture_output=True, text=True)
    (out/f'listener-{n}.txt').write_text(listen.stdout + listen.stderr)
    assert listen.returncode == 0 and '127.0.0.1:8765' in listen.stdout and '*:8765' not in listen.stdout
    record['listener'] = '127.0.0.1:8765'
    receipt['processes'].append(record)
    return p, log, record


def stop(p, log, record):
    p.terminate()
    try: p.wait(timeout=10)
    except subprocess.TimeoutExpired: p.kill(); p.wait()
    log.close()
    record.update(stopped_at=now(), exit_code=p.returncode)
    port_free()
    record['port_free_after_stop'] = True


def request(label, path, params, expected_status, expected_code=None, process=None):
    status, headers, body = get(path, params)
    schema('Error' if status >= 400 else 'EvidencePage' if path.endswith('/evidence') else 'VerificationRun', body)
    ok = status == expected_status and (expected_code is None or body['error']['code'] == expected_code)
    if status >= 400: ok = ok and 'result' not in body and 'items' not in body and body['error']['retryable'] is False
    ok = ok and headers.get('cache-control', headers.get('Cache-Control')) == 'no-store'
    receipt['requests'].append({'label': label, 'process': process, 'at': now(), 'path': path, 'params': params,
                                'expected_status': expected_status, 'expected_code': expected_code,
                                'status': status, 'body': body, 'pass': ok})
    return status, body


procs = []
try:
    p1 = start(1); procs.append(p1)
    _, detail1 = request('detail', '/api/v1/verifications/SPEC-001', None, 200, process=1)
    snap1 = detail1['snapshot_id']
    _, page1 = request('initial evidence page', '/api/v1/verifications/SPEC-001/evidence', {'limit': 1, 'snapshot_id': snap1}, 200, process=1)
    cursor = page1['page']['next_cursor']
    receipt['issued'] = {'snapshot_id': snap1, 'cursor': cursor}
    _, page2 = request('continuation before restart', '/api/v1/verifications/SPEC-001/evidence', {'limit': 1, 'snapshot_id': snap1, 'cursor': cursor}, 200, process=1)
    receipt['checks'].append({'name': 'page 2 continues page 1 in Detail order', 'pass': page2['items'][0]['reference'] == detail1['evidence_references'][1] and digest(page2['items'][0]['payload']) == page2['items'][0]['reference']['sha256']})
    stop(*p1); procs.remove(p1)

    p2 = start(2); procs.append(p2)
    _, detail2 = request('detail after restart', '/api/v1/verifications/SPEC-001', None, 200, process=2)
    snap2 = detail2['snapshot_id']
    receipt['checks'].append({'name': 'restart published a new snapshot', 'pass': snap2 != snap1})
    E = '/api/v1/verifications/SPEC-001/evidence'
    request('old cursor only', E, {'limit': 1, 'cursor': cursor}, 409, 'snapshot_unavailable', 2)
    request('old cursor + old snapshot', E, {'limit': 1, 'snapshot_id': snap1, 'cursor': cursor}, 409, 'snapshot_unavailable', 2)
    request('old snapshot, no cursor', E, {'limit': 1, 'snapshot_id': snap1}, 409, 'snapshot_unavailable', 2)
    request('old cursor + new snapshot', E, {'limit': 1, 'snapshot_id': snap2, 'cursor': cursor}, 409, 'snapshot_conflict', 2)
    encoded, sig = cursor.split('.')
    request('old cursor, signature tampered', E, {'limit': 1, 'cursor': encoded + '.' + sig[:-1] + ('0' if sig[-1] != '0' else '1')}, 400, 'invalid_cursor', 2)
    request('malformed cursor', E, {'limit': 1, 'cursor': 'bad'}, 400, 'invalid_cursor', 2)
    request('old cursor, different run', '/api/v1/verifications/SPEC-002/evidence', {'limit': 1, 'cursor': cursor}, 400, 'cursor_query_conflict', 2)
    request('old cursor, different limit', E, {'limit': 2, 'cursor': cursor}, 400, 'cursor_query_conflict', 2)
    request('old cursor, different payload mode', E, {'limit': 1, 'include_payload': 'false', 'cursor': cursor}, 400, 'cursor_query_conflict', 2)
    items, params = [], {'limit': 1, 'snapshot_id': snap2}
    while True:
        _, page = request('fresh pagination on new snapshot', E, params, 200, process=2)
        items += page['items']
        if page['page']['next_cursor'] is None: break
        params = {**params, 'cursor': page['page']['next_cursor']}
    receipt['checks'].append({'name': 'fresh pagination complete in Detail order with digests', 'pass': [x['reference'] for x in items] == detail2['evidence_references'] and all(digest(x['payload']) == x['reference']['sha256'] for x in items)})
    stop(*p2); procs.remove(p2)
finally:
    for p in procs: stop(*p)
    key = DEFAULT_KEY_FILE.read_text() if DEFAULT_KEY_FILE.exists() else None
    mode = oct(DEFAULT_KEY_FILE.lstat().st_mode & 0o777) if DEFAULT_KEY_FILE.exists() else None
    receipt['key_file_mode'] = mode
    receipt['key_absent_from_logs_and_responses'] = key is not None and all(key not in (out/f).read_text() for f in os.listdir(out)) and key not in json.dumps(receipt)
    receipt['passed'] = all(r['pass'] for r in receipt['requests']) and all(c['pass'] for c in receipt['checks']) \
        and len(receipt['processes']) == 2 and all('exit_code' in x for x in receipt['processes']) \
        and mode == '0o600' and receipt['key_absent_from_logs_and_responses']
    (out/'receipt.json').write_text(json.dumps(receipt, indent=2))
for r in receipt['requests']: print(f"[{r['process']}] {r['label']}: {r['status']} {r['body'].get('error', {}).get('code', '')} expected {r['expected_status']} {r['expected_code'] or ''} {'PASS' if r['pass'] else 'FAIL'}")
for c in receipt['checks']: print(c['name'], 'PASS' if c['pass'] else 'FAIL')
print(json.dumps({k: receipt[k] for k in ['processes', 'key_file_mode', 'key_absent_from_logs_and_responses', 'passed']}, indent=2))
sys.exit(0 if receipt['passed'] else 1)
