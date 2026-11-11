"""The HubSpot contacts destination of the command line (1.0.0): offline/flowassert_offline/hubspot.py.

Everything here runs against a local fake of the list endpoint (offline/bench/fake_hubspot_api.py) or against a
recorder in place of the HTTPS connection; nothing contacts HubSpot, and every token is a recognisable fake.
docs/connectors/hubspot.md is the design these tests hold the code to.
"""
import contextlib
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import socket
import ssl
import sys
import traceback

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'offline'))
sys.path.insert(0, str(ROOT / 'offline' / 'bench'))
from flowassert_offline import cli, hubspot, sheets  # noqa: E402
from flowassert_offline.errors import Refused  # noqa: E402
import fake_hubspot_api as hs  # noqa: E402

VARIABLES = ('FLOWASSERT_HUBSPOT_TOKEN', 'FLOWASSERT_HUBSPOT_TEST_ENDPOINT')
SOURCE = 'id,email\r\nC1,a@example.test\r\nC2,b@example.test\r\n'
RECORDS = [hs.contact(11, {'external_id': 'C1', 'email': 'a@example.test'}),
           hs.contact(12, {'external_id': 'C2', 'email': 'b@example.test'})]
ARGS = ['--key', 'id:external_id', '--field', 'email:email']


def _golden():
    spec = importlib.util.spec_from_file_location('flowassert_golden_hubspot', ROOT / 'offline/bench/golden.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GOLDEN = _golden()


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for name in VARIABLES + ('HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'):
        monkeypatch.delenv(name, raising=False)


def run(tmp_path, monkeypatch, args, responses, token=hs.FAKE_TOKEN, source=SOURCE, env=None):
    """Run the checker against the fake: (exit, stdout, stderr, report or None, the fake)."""
    (tmp_path / 'source.csv').write_bytes(source.encode('utf-8'))
    out, err = io.StringIO(), io.StringIO()
    with hs.FakeHubSpotApi(json.loads(json.dumps(responses))) as api:
        monkeypatch.setenv('FLOWASSERT_HUBSPOT_TEST_ENDPOINT', api.endpoint)
        if token is not None:
            monkeypatch.setenv('FLOWASSERT_HUBSPOT_TOKEN', token)
        for name, value in (env or {}).items():
            monkeypatch.setenv(name, value)
        monkeypatch.chdir(tmp_path)
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main(['--source', 'source.csv', '--destination-hubspot', 'contacts', '--json', 'report.json']
                            + args)
    report = json.loads((tmp_path / 'report.json').read_text(encoding='utf-8')) if (tmp_path / 'report.json').exists() \
        else None
    return code, out.getvalue(), err.getvalue(), report, api


# ---------- Options and the credential ----------

@pytest.mark.parametrize('environ,message', [
    ({}, 'no credential: set FLOWASSERT_HUBSPOT_TOKEN to a private app access token with the scope '
         'crm.objects.contacts.read only'),
    ({'FLOWASSERT_HUBSPOT_TOKEN': ''}, 'FLOWASSERT_HUBSPOT_TOKEN does not hold a credential'),
    ({'FLOWASSERT_HUBSPOT_TOKEN': 'a b'}, 'FLOWASSERT_HUBSPOT_TOKEN does not hold a credential'),
    ({'FLOWASSERT_HUBSPOT_TOKEN': 'x' * 4097}, 'FLOWASSERT_HUBSPOT_TOKEN does not hold a credential'),
    ({'FLOWASSERT_HUBSPOT_TOKEN': 'pat-é'}, 'FLOWASSERT_HUBSPOT_TOKEN does not hold a credential'),
])
def test_the_credential_comes_only_from_one_well_formed_variable(environ, message):
    with pytest.raises(Refused) as e:
        hubspot.HubSpotDestination('contacts', max_bytes=1000, environ=environ)
    assert str(e.value).startswith(message)
    for value in environ.values():
        if value:
            assert value not in str(e.value)


@pytest.mark.parametrize('value', ['https://api.hubapi.com', 'http://localhost:8080', 'http://127.0.0.1',
                                   'http://10.0.0.1:80', 'http://127.0.0.1:70000', 'http://[::1]:0'])
def test_the_test_endpoint_is_loopback_http_only(value):
    with pytest.raises(Refused, match='it is for tests only'):
        hubspot.test_endpoint({'FLOWASSERT_HUBSPOT_TEST_ENDPOINT': value})


@pytest.mark.parametrize('name', ['', 'a-b', 'a b', 'phone&archived=true', 'é', 'x' * 101, 'a,b', 'a%2Cb'])
def test_a_property_name_cannot_change_the_request(name):
    with pytest.raises(Refused, match='must be letters, digits and _, at most 100 characters'):
        hubspot.check_property(name)
    hubspot.check_property('hs_object_id')
    hubspot.check_property('x' * 100)


def test_a_missing_destination_is_refused_as_argparse_words_it(capsys):
    with pytest.raises(SystemExit):
        cli.main(['--source', 's.csv', '--key', 'k', '--field', 'p'])
    assert 'the following arguments are required: --destination' in capsys.readouterr().err


# ---------- The requests ----------

def test_a_read_sends_get_requests_to_one_path_with_the_properties_asked_for_and_follows_the_cursor(tmp_path,
                                                                                                     monkeypatch):
    code, out, err, report, api = run(tmp_path, monkeypatch, ARGS, hs.pages_of(RECORDS, size=1))
    assert (code, err) == (3, '')
    assert [(r['method'], r['path']) for r in api.requests] == [('GET', '/crm/v3/objects/contacts')] * 2
    assert [r['query'] for r in api.requests] == [
        [('limit', '100'), ('archived', 'false'), ('properties', 'external_id,email')],
        [('limit', '100'), ('archived', 'false'), ('properties', 'external_id,email'), ('after', '12')]]
    for r in api.requests:
        assert r['host'] == api.endpoint.split('//')[1]
        assert r['headers']['Authorization'] == f'Bearer {hs.FAKE_TOKEN}'
        assert r['headers']['Accept'] == 'application/json' and r['headers']['Accept-Encoding'] == 'identity'
        assert r['headers']['User-Agent'].startswith('flowassert-verify/')
    assert report['inputs']['destination_hubspot']['pages'] == 2


class _Recorder:
    """In place of http.client.HTTPSConnection: records where a request would go, and answers like the fake."""
    made = []
    answers = []

    def __init__(self, host, port=None, timeout=None, context=None):
        self.host, self.port, self.timeout, self.context = host, port, timeout, context
        self.sock = None
        _Recorder.made.append(self)

    def request(self, method, target, headers=None):
        self.method, self.target, self.headers = method, target, headers

    def getresponse(self):
        status, body = _Recorder.answers.pop(0)
        stream = io.BytesIO(body)

        class Response:
            def getheader(self, name, default=None):
                return default

            read1 = stream.read1

        response = Response()
        response.status = status
        return response

    def close(self):
        pass


def test_without_the_test_endpoint_only_the_documented_host_is_contacted_over_verified_tls(monkeypatch):
    # A proxy in the environment is not used either: the connection goes to the host itself.
    monkeypatch.setenv('HTTPS_PROXY', 'http://127.0.0.1:9')
    monkeypatch.setenv('FLOWASSERT_HUBSPOT_TOKEN', hs.FAKE_TOKEN)
    monkeypatch.setattr(hubspot.http.client, 'HTTPSConnection', _Recorder)
    monkeypatch.setattr(hubspot.http.client, 'HTTPConnection', None)
    _Recorder.made = []
    _Recorder.answers = [(200, json.dumps(page['json']).encode()) for page in hs.pages_of(RECORDS, size=1)]
    destination = hubspot.HubSpotDestination('contacts', max_bytes=10_000)
    destination.select(['external_id', 'email'], 10)
    assert [row for row in destination] == [{'external_id': 'C1', 'email': 'a@example.test'},
                                           {'external_id': 'C2', 'email': 'b@example.test'}]
    assert [(c.host, c.port, c.method) for c in _Recorder.made] == [('api.hubapi.com', 443, 'GET')] * 2
    assert _Recorder.made[0].target == '/crm/v3/objects/contacts?limit=100&archived=false&properties=external_id,email'
    assert _Recorder.made[1].target.endswith('&after=12')
    for connection in _Recorder.made:
        assert connection.context.verify_mode == ssl.CERT_REQUIRED and connection.context.check_hostname
        assert connection.timeout == hubspot.TIMEOUT
        assert connection.headers['Authorization'] == f'Bearer {hs.FAKE_TOKEN}'


def test_a_redirect_is_never_followed(tmp_path, monkeypatch):
    code, _, err, report, api = run(tmp_path, monkeypatch, ARGS, [
        {'status': 307, 'text': '', 'headers': {'Location': 'https://api.hubapi.example.test/elsewhere'}}])
    assert (code, report) == (2, None)
    assert err == 'refused: HubSpot contacts: redirected (HTTP 307), and FlowAssert does not follow redirects\n'
    assert len(api.requests) == 1


@pytest.mark.parametrize('response', [hs.rate_limited(), hs.error(500, 'INTERNAL_ERROR'), hs.error(502, 'BAD_GATEWAY')])
def test_nothing_is_retried(tmp_path, monkeypatch, response):
    code, _, _, _, api = run(tmp_path, monkeypatch, ARGS, [response, *hs.pages_of(RECORDS)])
    assert code == 2 and len(api.requests) == 1


def test_a_refusal_on_a_later_page_requests_nothing_after_it_and_writes_no_report(tmp_path, monkeypatch):
    code, out, err, report, api = run(tmp_path, monkeypatch, ARGS, [hs.page(RECORDS[:1], '12'),
                                                                    hs.error(503, 'SERVICE_UNAVAILABLE')])
    assert (code, out, report) == (2, '', None)
    assert err.startswith('refused: HubSpot contacts: server error (HTTP 503 SERVICE_UNAVAILABLE)')
    assert len(api.requests) == 2


def test_the_error_message_from_the_server_is_never_repeated(tmp_path, monkeypatch):
    secret = 'Synthetic detail portal 99999 contact x@example.test'
    for response in (hs.error(403, 'MISSING_SCOPES', secret), hs.error(401, 'not a plain name', secret)):
        code, out, err, _, _ = run(tmp_path, monkeypatch, ARGS, [response])
        assert code == 2 and secret not in err and secret not in out and 'not a plain name' not in err


@pytest.mark.parametrize('response,detail', [
    ({'status': 200, 'text': '[]'}, 'not an object'),
    ({'status': 200, 'text': '{"results": [], "results": []}'}, 'a duplicate member'),
    ({'status': 200, 'text': '{"results": [NaN]}'}, 'NaN is not JSON'),
    ({'status': 200, 'text': '\xff'}, 'not JSON'),
    ({'status': 200, 'json': {'results': [], 'paging': []}}, 'paging is not an object'),
    ({'status': 200, 'json': {'results': [], 'paging': {'next': {'after': 5}}}}, 'paging.next.after is not a string'),
    ({'status': 200, 'json': {'results': [{'properties': {}}]}}, 'a record has no id'),
    ({'status': 200, 'json': {'results': [{'id': '1'}]}}, 'a record has no properties'),
    ({'status': 200, 'json': {'results': [{'id': '1', 'properties': {}, 'archived': 'no'}]}},
     'archived is not true or false'),
    ({'status': 200, 'json': {'results': []}, 'headers': {'Content-Encoding': 'gzip'}}, 'a compressed body'),
])
def test_a_page_that_is_not_the_documented_json_is_refused(tmp_path, monkeypatch, response, detail):
    code, _, err, _, _ = run(tmp_path, monkeypatch, ARGS, [response])
    assert code == 2
    assert err == f'refused: HubSpot contacts: the response is not the JSON the API documents ({detail})\n'


def test_a_property_that_is_null_is_an_empty_value_and_other_properties_are_ignored(tmp_path, monkeypatch):
    records = [hs.contact(11, {'external_id': 'C1', 'email': None, 'createdate': '2026-11-01', 'hs_object_id': '11'}),
               hs.contact(12, {'external_id': 'C2', 'email': 'b@example.test', 'lastmodifieddate': 'x'})]
    code, out, _, report, _ = run(tmp_path, monkeypatch, ARGS + ['--destination-complete', '--source-complete'],
                                  hs.pages_of(records))
    assert code == 3
    rule = report['records'][0]['rules']['field:email']
    assert (rule['status'], rule['actual']) == ('unknown', '')


def test_a_slow_response_is_refused_after_the_timeout_and_not_retried(tmp_path, monkeypatch):
    code, _, err, _, api = run(tmp_path, monkeypatch, ARGS + ['--destination-timeout', '1'],
                               [{**hs.pages_of(RECORDS)[0], 'delay': 1.5}])
    assert code == 2 and err == 'refused: HubSpot contacts: no complete response within 1 seconds; FlowAssert does not retry\n'
    assert len(api.requests) == 1


def test_a_response_that_trickles_in_is_bounded_by_the_timeout_as_a_whole(tmp_path, monkeypatch):
    code, _, err, _, _ = run(tmp_path, monkeypatch, ARGS + ['--destination-timeout', '1'],
                             [{**hs.pages_of(RECORDS)[0], 'drip': 0.02}])
    assert code == 2 and 'no complete response within 1 seconds' in err


def test_a_connection_that_fails_is_refused(tmp_path, monkeypatch, capsys):
    port = socket.socket()
    port.bind(('127.0.0.1', 0))
    endpoint = f'http://127.0.0.1:{port.getsockname()[1]}'
    port.close()
    (tmp_path / 'source.csv').write_text(SOURCE, encoding='utf-8')
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('FLOWASSERT_HUBSPOT_TOKEN', hs.FAKE_TOKEN)
    monkeypatch.setenv('FLOWASSERT_HUBSPOT_TEST_ENDPOINT', endpoint)
    assert cli.main(['--source', 'source.csv', '--destination-hubspot', 'contacts'] + ARGS) == 2
    assert capsys.readouterr().err == 'refused: HubSpot contacts: the connection failed\n'


def test_a_certificate_that_cannot_be_verified_is_refused(monkeypatch):
    class Unverified(_Recorder):
        def request(self, method, target, headers=None):
            raise ssl.SSLCertVerificationError('certificate verify failed: synthetic')

    monkeypatch.setattr(hubspot.http.client, 'HTTPSConnection', Unverified)
    destination = hubspot.HubSpotDestination('contacts', max_bytes=1000, environ={'FLOWASSERT_HUBSPOT_TOKEN': 'x'})
    destination.select(['a'], 10)
    with pytest.raises(Refused, match="HubSpot contacts: the server's TLS certificate could not be verified"):
        list(destination)


def test_max_rows_stops_the_read_and_max_bytes_bounds_each_page(tmp_path, monkeypatch):
    records = [hs.contact(100 + i, {'external_id': f'C{i}', 'email': 'e'}) for i in range(5)]
    code, _, err, _, api = run(tmp_path, monkeypatch, ARGS + ['--max-rows', '2'], hs.pages_of(records, size=1),
                               source='id,email\r\nC1,e\r\n')
    assert (code, err) == (2, 'refused: HubSpot contacts: exceeds --max-rows limit of 2\n')
    assert len(api.requests) == 3  # the third record is refused as it arrives; no fourth page is asked for
    code, _, err, _, _ = run(tmp_path, monkeypatch, ARGS + ['--max-bytes', '200'], hs.pages_of(records))
    assert (code, err) == (2, 'refused: HubSpot contacts: response exceeds --max-bytes limit of 200\n')


# ---------- The report ----------

def test_the_report_records_the_read_and_never_the_token_portal_or_account(tmp_path, monkeypatch):
    records = [hs.contact(11, {'external_id': 'C1', 'email': 'a@example.test', 'hs_object_id': '11'})]
    page = hs.page(records)
    page['json']['portalId'] = 424242
    code, out, _, report, _ = run(tmp_path, monkeypatch, ARGS + ['--source-encoding', 'utf-8'], [page],
                                  source='id,email\r\nC1,a@example.test\r\n')
    assert code == 3
    assert report['schema_version'] == 3
    member = report['inputs']['destination_hubspot']
    assert set(member) == {'read_by', 'service', 'object', 'properties', 'archived_excluded', 'page_limit', 'pages',
                           'rows', 'read_at', 'read_finished_at', 'canonical_form'}
    assert (member['read_by'], member['service'], member['object'], member['properties']) == (
        'FlowAssert', 'HubSpot CRM API v3', 'contacts', ['external_id', 'email'])
    assert (member['archived_excluded'], member['page_limit'], member['pages'], member['rows']) == (True, 100, 1, 1)
    assert member['canonical_form'] == 'flowassert-hubspot-csv-1'
    assert 'destination_encoding' not in report['inputs'] and report['inputs']['source_encoding'] == 'utf-8'
    text = json.dumps(report) + out
    for absent in (hs.FAKE_TOKEN, '424242', 'portal', 'hubapi.com/'):
        assert absent not in text
    canonical = 'external_id,email\nC1,a@example.test\n'.encode()
    assert report['inputs']['destination_sha256'] == hashlib.sha256(canonical).hexdigest()


def test_the_summary_says_what_the_read_does_not_show(tmp_path, monkeypatch):
    code, out, _, _, _ = run(tmp_path, monkeypatch, ARGS + ['--destination-complete', '--destination-count', '3'],
                             hs.pages_of(RECORDS))
    lines = out.splitlines()
    assert lines[2].startswith('Destination read by FlowAssert from HubSpot: contacts, 2 records in 1 pages, from ')
    assert lines[2].endswith('; archived records were not read.')
    assert lines[3] == 'This lists what the token could see at that time; it does not show that the object is complete.'
    assert 'Destination count stated 3, HubSpot listed 2 records: absence and uniqueness stay unknown.' in lines
    # Reading every page does not make the completeness statement: without it, coverage is not established.
    (tmp_path / 'b').mkdir()
    code, out, _, report, _ = run(tmp_path / 'b', monkeypatch, ARGS, hs.pages_of(RECORDS))
    assert report['destination_coverage_sufficient'] is False
    assert 'Destination coverage not established: absence and uniqueness stay unknown.' in out


def test_reports_without_a_hubspot_destination_keep_their_version(tmp_path, capsys):
    (tmp_path / 's.csv').write_text('k,p\n1,a\n')
    (tmp_path / 'd.csv').write_text('p,k\na,1\n')
    assert cli.main(['--source', str(tmp_path / 's.csv'), '--destination', str(tmp_path / 'd.csv'), '--key', 'k',
                     '--field', 'p', '--json', str(tmp_path / 'r.json')]) == 3
    assert json.loads((tmp_path / 'r.json').read_text())['schema_version'] == 1


@pytest.mark.parametrize('rows', [
    [['a', 'b'], ['1', '2']],
    [['a'], [''], ['x']],
    [['a', 'b'], ['', ''], ['q"uote', 'com,ma'], ['line\nbreak', 'cr\rlf'], ['é中', ' space ']],
])
def test_the_canonical_form_is_a_csv_file_that_reads_as_the_same_rows(tmp_path, rows):
    text = ''.join(sheets.canonical_row(row) for row in rows)
    (tmp_path / 'c.csv').write_bytes(text.encode('utf-8'))
    file = cli.CsvFile(str(tmp_path / 'c.csv'), rows[0])
    assert [[row[c] for c in rows[0]] for row in file] == rows[1:]
    assert file.sha256 == hashlib.sha256(text.encode('utf-8')).hexdigest()


# ---------- The credential leaks nowhere ----------

def test_the_token_appears_in_no_output_report_request_record_or_exception(tmp_path, monkeypatch):
    canary = hs.FAKE_TOKEN + '-LEAK-CANARY'
    seen = set()
    for name, spec in GOLDEN.HUBSPOT_CASES.items():
        folder = tmp_path / name
        folder.mkdir()
        for file, data in spec['files'].items():
            (folder / file).write_bytes(data)
        with hs.FakeHubSpotApi(json.loads(json.dumps(spec['responses'])), token=canary) as api:
            environ = {'FLOWASSERT_HUBSPOT_TEST_ENDPOINT': api.endpoint}
            if spec['credential'] == 'token':
                environ['FLOWASSERT_HUBSPOT_TOKEN'] = canary
            environ.update(spec['env'])
            for variable, value in environ.items():
                monkeypatch.setenv(variable, value)
            monkeypatch.chdir(folder)
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = cli.main(spec['args'] + ['--json', 'report.json', '--html', 'report.html'])
            chained = ''
            api.responses = json.loads(json.dumps(spec['responses']))
            try:
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    parsed = _parsed(spec['args'])
                    if parsed is not None:
                        list(cli.run(parsed).get('records', []))
            except Refused as e:
                chained = ''.join(traceback.format_exception(type(e), e, e.__traceback__))
            for variable in environ:
                monkeypatch.delenv(variable)
        written = ''.join(p.read_text(encoding='utf-8') for p in folder.glob('report.*'))
        recorded = json.dumps([[r['method'], r['path'], r['query']] for r in api.requests])
        seen.add(code)
        for text in (out.getvalue(), err.getvalue(), written, chained, recorded):
            assert canary not in text, name
            assert canary[:16] not in text, name
    assert {0, 1, 2, 3} <= seen


def _parsed(args):
    parsed = {}

    class Capture(Exception):
        pass

    def fake_run(a):
        parsed['args'] = a
        raise Capture()

    saved = cli.run
    cli.run = fake_run
    try:
        try:
            cli.main(args)
        except (Capture, SystemExit):
            pass
    finally:
        cli.run = saved
    return parsed.get('args')


# ---------- Same rows, same result as a CSV export ----------

def _destination_records(name, case):
    """The destination rows of a golden case as HubSpot records, or None when HubSpot cannot hold the same rows."""
    folder = GOLDEN.GOLDEN / name
    args = case['args']
    if '--destination' not in args:
        return None
    encoding = args[args.index('--destination-encoding') + 1] if '--destination-encoding' in args else 'utf-8'
    codec = {'utf-8': 'utf-8-sig', 'utf-16': 'utf-16', 'gb18030': 'gb18030'}.get(encoding)
    path = folder / args[args.index('--destination') + 1]
    if codec is None or not path.exists():
        return None
    try:
        rows = [row for row in csv.reader(io.StringIO(path.read_bytes().decode(codec), newline=''), strict=True)
                if row]
    except (UnicodeError, csv.Error):
        return None
    if not rows or len(set(rows[0])) != len(rows[0]) or any(len(row) != len(rows[0]) for row in rows):
        return None
    if not all(hubspot._PROPERTY.fullmatch(name) for name in rows[0]):
        return None  # not a HubSpot property name
    if any('\x00' in value for row in rows for value in row):
        return None
    return rows


def _equivalence_cases():
    for folder in sorted(GOLDEN.GOLDEN.iterdir()):
        case = json.loads((folder / 'case.json').read_text(encoding='utf-8'))
        if int((folder / 'exit_status.txt').read_text()) == 2:
            continue  # a refusal is about a file or an option; the refusals of a read are golden cases of their own
        rows = _destination_records(folder.name, case)
        if rows is not None:
            yield folder.name, case, rows


EQUIVALENCE = list(_equivalence_cases())


def test_most_golden_results_can_be_run_against_hubspot():
    assert len(EQUIVALENCE) >= 40
    names = {name for name, _, _ in EQUIVALENCE}
    # The cases left out name a column that is not a HubSpot property name (unsafe-values, scope-exact-source-known).
    for name in ('example', 'rules-pass', 'rules-fail', 'rules-unknown', 'scope-exact-cli', 'counts-match',
                 'count-destination-mismatch', 'duplicate-destination-key', 'keyless-rows', 'empty-values', 'no-rows',
                 'quoted-line-breaks', 'encoding-gb18030', 'scenario-orders-rules-both-statements',
                 'scenario-extra-in-destination-no-statements'):
        assert name in names, name


HUBSPOT_LINES = ('Destination read by FlowAssert from HubSpot: ', 'This lists what the token could see')


@pytest.mark.parametrize('name,case,rows', EQUIVALENCE, ids=[name for name, _, _ in EQUIVALENCE])
def test_hubspot_and_a_file_with_the_same_rows_give_the_same_result(tmp_path, monkeypatch, name, case, rows):
    folder = GOLDEN.GOLDEN / name
    args = list(case['args'])
    i = args.index('--destination')
    args[i:i + 2] = ['--destination-hubspot', 'contacts']
    if '--destination-encoding' in args:
        j = args.index('--destination-encoding')
        del args[j:j + 2]
    for file in folder.iterdir():
        if file.suffix in ('.csv', '.json') and file.name not in ('case.json', 'report.json'):
            (tmp_path / file.name).write_bytes(file.read_bytes())
    records = [hs.contact(1000 + n, dict(zip(rows[0], (value if value != '' else None for value in row))))
               for n, row in enumerate(rows[1:])]
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('FLOWASSERT_HUBSPOT_TOKEN', hs.FAKE_TOKEN)
    out, err = io.StringIO(), io.StringIO()
    with hs.FakeHubSpotApi(hs.pages_of(records, size=2)) as api:
        monkeypatch.setenv('FLOWASSERT_HUBSPOT_TEST_ENDPOINT', api.endpoint)
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main(args + ['--json', 'report.json'])
    properties = dict(api.requests[0]['query'])['properties'].split(',')
    canonical = ''.join(sheets.canonical_row(row) for row in
                        [properties] + [[row[rows[0].index(c)] for c in properties] for row in rows[1:]]).encode('utf-8')
    if code == 2 and 'identical content' in err.getvalue():
        # By design: the source file holds exactly the canonical form of the records (docs/connectors/hubspot.md).
        assert (tmp_path / args[args.index('--source') + 1]).read_bytes() == canonical
        return
    assert (code, err.getvalue()) == (int((folder / 'exit_status.txt').read_text()), '')
    summary = [line for line in out.getvalue().splitlines() if not line.startswith(HUBSPOT_LINES)]
    summary = [line.replace('HubSpot listed ', 'file has ').replace(' records: absence', ' rows: absence')
               if line.startswith('Destination count stated') else line for line in summary]
    assert summary == (folder / 'stdout.txt').read_text(encoding='utf-8').splitlines()
    crm = json.loads((tmp_path / 'report.json').read_text(encoding='utf-8'))
    file = json.loads((folder / 'report.json').read_text(encoding='utf-8'))
    assert (crm.pop('schema_version'), file.pop('schema_version')) == (3, 1)
    for report in (crm, file):
        report.pop('evaluated_at')
    crm_inputs, file_inputs = crm.pop('inputs'), file.pop('inputs')
    # Every record, rule result, count, premise and conclusion is the same.
    assert crm == file
    for member in ('source_sha256', 'source_complete_stated', 'destination_complete_stated', 'identical_content',
                   'mapping_file_sha256', 'config_file_sha256'):
        assert crm_inputs.get(member) == file_inputs.get(member), member
    assert crm_inputs['destination_hubspot']['properties'] == properties
    assert crm_inputs['destination_sha256'] == hashlib.sha256(canonical).hexdigest()


def test_the_golden_hubspot_cases_are_current_and_send_only_get_requests_to_one_path():
    assert GOLDEN.check() == []
    folders = sorted(GOLDEN.GOLDEN_HUBSPOT.iterdir())
    assert [f.name for f in folders] == sorted(GOLDEN.HUBSPOT_CASES)
    for folder in folders:
        for method, path, query in json.loads((folder / 'requests.json').read_text(encoding='utf-8')):
            assert (method, path) == ('GET', '/crm/v3/objects/contacts')
            assert [k for k, _ in query][:3] == ['limit', 'archived', 'properties']
            assert dict(query)['archived'] == 'false' and dict(query)['limit'] == '100'
            assert set(dict(query)) <= {'limit', 'archived', 'properties', 'after'}
        for file in folder.iterdir():
            assert hs.FAKE_TOKEN not in file.read_bytes().decode('utf-8', 'replace'), file
