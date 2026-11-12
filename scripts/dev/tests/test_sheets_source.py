"""The Google Sheets source of the command line (0.7.0): offline/flowassert_offline/sheets.py.

Everything here runs against a local fake of the two endpoints (offline/bench/fake_sheets_api.py) or against a
recorder in place of the HTTPS connection; nothing contacts Google, and every credential is a recognisable fake.
docs/connectors/google-sheets.md is the design these tests hold the code to.
"""
import contextlib
import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import ssl
import sys
import time
import traceback

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'offline'))
sys.path.insert(0, str(ROOT / 'offline' / 'bench'))
from flowassert_offline import cli, sheets  # noqa: E402
from flowassert_offline.errors import Refused  # noqa: E402
from fake_sheets_api import FAKE_KEY, FAKE_TOKEN, FakeSheetsApi, drive, error, sheet_rows, values  # noqa: E402

SHEET_ID = '1SyntheticSpreadsheet-FlowAssert_0002'
VARIABLES = ('FLOWASSERT_SHEETS_TOKEN', 'FLOWASSERT_SHEETS_API_KEY', 'FLOWASSERT_SHEETS_TEST_ENDPOINT')
ROWS = [['id', 'p'], ['S1', 'one'], ['S2', 'two']]
# The same values as ROWS, in other bytes than their canonical form, so the content is not identical.
DESTINATION = 'id,p\r\nS1,one\r\nS2,two\r\n'


def _golden():
    spec = importlib.util.spec_from_file_location('flowassert_golden_sheets', ROOT / 'offline/bench/golden.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GOLDEN = _golden()


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for name in VARIABLES + ('HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'):
        monkeypatch.delenv(name, raising=False)


def run(tmp_path, args, responses, credential=('token', FAKE_TOKEN), destination=DESTINATION, env=None):
    """Run the checker on a sheet source served by the fake: (exit, stdout, stderr, report text or None, requests)."""
    (tmp_path / 'destination.csv').write_text(destination, encoding='utf-8')
    out = io.StringIO()
    err = io.StringIO()
    with FakeSheetsApi(responses, credential=credential) as api:
        environ = {'FLOWASSERT_SHEETS_TEST_ENDPOINT': api.endpoint,
                   'FLOWASSERT_SHEETS_TOKEN' if credential[0] == 'token' else 'FLOWASSERT_SHEETS_API_KEY': credential[1]}
        environ.update(env or {})
        saved = {name: os.environ.get(name) for name in environ}
        os.environ.update({k: v for k, v in environ.items() if v is not None})
        for name in [k for k, v in environ.items() if v is None]:
            os.environ.pop(name, None)
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = cli.main(['--source-sheet', SHEET_ID, '--destination', str(tmp_path / 'destination.csv'),
                                 '--json', str(tmp_path / 'report.json'), '--html', str(tmp_path / 'report.html')]
                                + args)
        finally:
            for name, value in saved.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value
    texts = [(tmp_path / name).read_text(encoding='utf-8') for name in ('report.json', 'report.html')
             if (tmp_path / name).exists()]
    for name in ('report.json', 'report.html'):
        if (tmp_path / name).exists():
            (tmp_path / name).unlink()
    return code, out.getvalue(), err.getvalue(), texts, api.requests


BASIC = ['--source-range', 'Data!A1:B', '--key', 'id', '--field', 'p']


def ok(rows=ROWS, returned='Data!A1:B1000'):
    return {'drive': [drive(3), drive(3)], 'values': [values(returned, rows)]}


# ---------- Ranges ----------

@pytest.mark.parametrize('text,expected', [
    ('Leads!A1:F', ('Leads', 1, 6, 1, None)),
    ('Leads!A1:F500', ('Leads', 1, 6, 1, 500)),
    ('Leads!a2:f', ('Leads', 1, 6, 2, None)),
    ('Leads!A:F', ('Leads', 1, 6, 1, None)),
    ("'Q3 leads'!B5:ZZZ9", ('Q3 leads', 2, 18278, 5, 9)),
    ("'Ann''s list'!A1:A1", ("Ann's list", 1, 1, 1, 1)),
    ('Sheet_1.v2!C3:C3', ('Sheet_1.v2', 3, 3, 3, 3)),
])
def test_a_bounded_range_with_a_tab_is_accepted(text, expected):
    r = sheets.SheetRange(text)
    assert (r.tab, r.first_column, r.last_column, r.first_row, r.last_row) == expected


@pytest.mark.parametrize('text', ['A1:F', 'Leads', 'Leads!A1', 'Leads!1:500', 'Leads!A1:F0', 'Leads!A01:F', 'Leads!R1C1:R5C6',
                                  'Leads!A1:AAAA', "'Leads!A1:F", "''!A1:F", 'My Leads!A1:F', 'Leads!A1:F;', 'Leads!A1:F\n',
                                  'Leads!A1:F123456789', 'Leads!A1:B:C', ''])
def test_a_range_without_a_tab_or_bounded_columns_is_refused(text):
    with pytest.raises(Refused, match='must name a tab and bounded columns'):
        sheets.SheetRange(text)


@pytest.mark.parametrize('text', ['Leads!C1:A', 'Leads!A9:B2'])
def test_a_range_that_starts_after_it_ends_is_refused(text):
    with pytest.raises(Refused, match='starts after it ends'):
        sheets.SheetRange(text)


@pytest.mark.parametrize('asked,returned,expected', [
    ('Leads!A1:F', 'Leads!A1:F1000', 1000),
    ('Leads!A1:F', "'Leads'!A1:F1000", 1000),
    ('Leads!A1:F', 'Leads!A1:F', None),
    ('Leads!A1:F500', 'Leads!A1:F500', 500),
    ('Leads!A:F', 'Leads!A1:F20', 20),
    ('Leads!a1:f9', 'Leads!A1:F9', 9),
    ('Leads!A1:A1', 'Leads!A1', 1),
    ('Leads!A1:F500', 'Leads!A1:F1000', False),
    ('Leads!A1:F', 'Leads!A2:F1000', False),
    ('Leads!A1:F', 'Leads!A1:G1000', False),
    ('Leads!A1:F', 'Other!A1:F1000', False),
    ('Leads!A5:F', 'Leads!A5:F4', False),
    ('Leads!A1:F', 'A1:F1000', False),
    ('Leads!A1:F', 'Leads!A1:F1000 ', False),
])
def test_the_returned_range_must_be_the_range_asked_for(asked, returned, expected):
    assert sheets.SheetRange(asked).returned(returned) == expected


# ---------- Options, credential and endpoint, before any request ----------

@pytest.mark.parametrize('environ,message', [
    ({}, '^no credential: set FLOWASSERT_SHEETS_TOKEN'),
    ({'FLOWASSERT_SHEETS_TOKEN': FAKE_TOKEN, 'FLOWASSERT_SHEETS_API_KEY': FAKE_KEY}, '^set only one of'),
    ({'FLOWASSERT_SHEETS_TOKEN': ''}, '^FLOWASSERT_SHEETS_TOKEN does not hold a credential'),
    ({'FLOWASSERT_SHEETS_TOKEN': FAKE_TOKEN + ' with space'}, '^FLOWASSERT_SHEETS_TOKEN does not hold a credential'),
    ({'FLOWASSERT_SHEETS_TOKEN': 'line\nbreak'}, '^FLOWASSERT_SHEETS_TOKEN does not hold a credential'),
    ({'FLOWASSERT_SHEETS_TOKEN': 'tökén'}, '^FLOWASSERT_SHEETS_TOKEN does not hold a credential'),
    ({'FLOWASSERT_SHEETS_TOKEN': 'x' * 4097}, '^FLOWASSERT_SHEETS_TOKEN does not hold a credential'),
    ({'FLOWASSERT_SHEETS_API_KEY': '\t'}, '^FLOWASSERT_SHEETS_API_KEY does not hold a credential'),
])
def test_the_credential_comes_only_from_one_well_formed_variable(environ, message):
    with pytest.raises(Refused, match=message) as refused:
        sheets.credential(environ)
    for value in environ.values():
        if value.strip():
            assert value not in str(refused.value)


def test_a_credential_is_taken_from_the_environment_only():
    assert sheets.credential({'FLOWASSERT_SHEETS_TOKEN': 'x' * 4096}) == ('token', 'x' * 4096)
    assert sheets.credential({'FLOWASSERT_SHEETS_API_KEY': FAKE_KEY}) == ('key', FAKE_KEY)
    # No option names a credential, and no file is read for one.
    help_text = io.StringIO()
    with contextlib.redirect_stdout(help_text), pytest.raises(SystemExit):
        cli.main(['--help'])
    assert 'token' not in help_text.getvalue().lower().replace('--source', '')
    assert not any(word in (ROOT / 'offline/flowassert_offline/sheets.py').read_text(encoding='utf-8')
                   for word in ('open(', 'expanduser', 'credentials.json', 'gcloud'))


@pytest.mark.parametrize('value', ['https://sheets.googleapis.com', 'http://localhost:8080', 'http://127.0.0.2:80',
                                   'http://127.0.0.1', 'http://127.0.0.1:0', 'http://127.0.0.1:70000',
                                   'http://127.0.0.1:80/v4', 'http://[::2]:80', 'http://::1:80', ' http://127.0.0.1:80',
                                   ''])
def test_the_test_endpoint_is_loopback_http_only(value):
    with pytest.raises(Refused, match='^FLOWASSERT_SHEETS_TEST_ENDPOINT must be'):
        sheets.test_endpoint({'FLOWASSERT_SHEETS_TEST_ENDPOINT': value})


def test_the_test_endpoint_can_be_either_loopback_address():
    assert sheets.test_endpoint({'FLOWASSERT_SHEETS_TEST_ENDPOINT': 'http://127.0.0.1:8080'}) == ('127.0.0.1', 8080)
    assert sheets.test_endpoint({'FLOWASSERT_SHEETS_TEST_ENDPOINT': 'http://[::1]:65535'}) == ('::1', 65535)
    assert sheets.test_endpoint({}) is None


def test_a_missing_source_is_refused_as_argparse_words_it():
    err = io.StringIO()
    with contextlib.redirect_stderr(err), pytest.raises(SystemExit) as exit_:
        cli.main([])
    assert exit_.value.code == 2
    assert err.getvalue().endswith('error: the following arguments are required: --source, --destination\n')
    err = io.StringIO()
    with contextlib.redirect_stderr(err), pytest.raises(SystemExit):
        cli.main(['--source-sheet', SHEET_ID])
    assert err.getvalue().endswith('error: the following arguments are required: --destination\n')


@pytest.mark.parametrize('option', [['--source-timeout', '5'], ['--skip-source-revision']])
def test_sheet_options_need_a_sheet(tmp_path, capsys, option):
    (tmp_path / 's.csv').write_text('k,p\n1,2\n')
    (tmp_path / 'd.csv').write_text('k,p\n1,3\n')
    assert cli.main(['--source', str(tmp_path / 's.csv'), '--destination', str(tmp_path / 'd.csv'), '--key', 'k',
                     '--field', 'p'] + option) == 2
    assert capsys.readouterr().err == f'refused: {option[0]} needs --source-sheet\n'


@pytest.mark.parametrize('value', ['0', '-1', '1.5', 'x'])
def test_the_timeout_is_a_positive_integer(tmp_path, value):
    code, _, err, _, requests = run(tmp_path, BASIC + ['--source-timeout', value], ok())
    assert (code, err, requests) == (2, 'refused: --source-timeout must be a positive integer\n', [])


# ---------- Requests: method, hosts, paths ----------

def test_a_read_sends_three_get_requests_and_nothing_else(tmp_path):
    code, out, err, _, requests = run(tmp_path, BASIC + ['--source-complete', '--destination-complete'], ok())
    assert (code, err) == (0, '')
    assert [(r['method'], r['path']) for r in requests] == [
        ('GET', f'/drive/v3/files/{SHEET_ID}'),
        ('GET', f'/v4/spreadsheets/{SHEET_ID}/values/Data%21A1%3AB'),
        ('GET', f'/drive/v3/files/{SHEET_ID}')]
    assert requests[0]['query'] == [('fields', 'version,modifiedTime'), ('supportsAllDrives', 'true')]
    assert requests[1]['query'] == [('majorDimension', 'ROWS'), ('valueRenderOption', 'FORMATTED_VALUE'),
                                    ('dateTimeRenderOption', 'FORMATTED_STRING')]
    for r in requests:
        assert r['headers']['Authorization'] == f'Bearer {FAKE_TOKEN}'
        assert r['headers']['Accept-Encoding'] == 'identity'
        assert r['headers']['User-Agent'] == f'flowassert-verify/{cli.__version__}'
        assert 'Content-Length' not in r['headers'] and 'Cookie' not in r['headers']


def test_an_api_key_is_sent_as_the_key_parameter_and_no_token(tmp_path):
    code, _, err, _, requests = run(tmp_path, BASIC, ok(), credential=('key', FAKE_KEY))
    assert (code, err) == (3, '')
    for r in requests:
        assert r['method'] == 'GET' and ('key', FAKE_KEY) in r['query'] and 'Authorization' not in r['headers']


def test_the_id_and_range_cannot_change_the_path(tmp_path):
    rows = [['id', 'p'], ['S1', 'one']]
    code, _, _, _, requests = run(tmp_path, ['--source-range', "'a/../b?c#d'!A1:B", '--key', 'id', '--field', 'p'],
                                  ok(rows, "'a/../b?c#d'!A1:B9"))
    assert code == 3
    assert requests[1]['path'] == f"/v4/spreadsheets/{SHEET_ID}/values/%27a%2F..%2Fb%3Fc%23d%27%21A1%3AB"
    for bad in ('../x', 'a/b', 'a?b', 'a%2Fb', 'x' * 201, ''):
        with pytest.raises(Refused, match='^--source-sheet must be a spreadsheet ID'):
            sheets.SheetSource(bad, 'Data!A1:B', max_bytes=1, environ={'FLOWASSERT_SHEETS_TOKEN': 't'})


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


def test_without_the_test_endpoint_only_the_two_google_hosts_are_contacted_over_verified_tls(monkeypatch, tmp_path):
    # A proxy in the environment is not used either: the connection goes to the host itself.
    monkeypatch.setenv('HTTPS_PROXY', 'http://127.0.0.1:9')
    monkeypatch.setenv('FLOWASSERT_SHEETS_TOKEN', FAKE_TOKEN)
    monkeypatch.setattr(sheets.http.client, 'HTTPSConnection', _Recorder)
    monkeypatch.setattr(sheets.http.client, 'HTTPConnection', None)
    _Recorder.made = []
    _Recorder.answers = [(200, b'{"version": "4"}'), (200, json.dumps(values('Data!A1:B9', ROWS)['json']).encode()),
                         (200, b'{"version": "4"}')]
    source = sheets.SheetSource(SHEET_ID, 'Data!A1:B', max_bytes=10_000)
    source.select(['id', 'p'], 10)
    source.read()
    assert [(c.host, c.port, c.method) for c in _Recorder.made] == [
        ('www.googleapis.com', 443, 'GET'), ('sheets.googleapis.com', 443, 'GET'), ('www.googleapis.com', 443, 'GET')]
    assert _Recorder.made[0].target.startswith(f'/drive/v3/files/{SHEET_ID}?')
    assert _Recorder.made[1].target.startswith(f'/v4/spreadsheets/{SHEET_ID}/values/Data%21A1%3AB?')
    for connection in _Recorder.made:
        assert connection.context.verify_mode == ssl.CERT_REQUIRED and connection.context.check_hostname
        assert connection.timeout == sheets.TIMEOUT


def test_the_scopes_named_are_read_only():
    text = (ROOT / 'docs/connectors/google-sheets.md').read_text(encoding='utf-8')
    scopes = {s for s in text.split() if 'googleapis.com/auth/' in s}
    assert scopes == {'`https://www.googleapis.com/auth/spreadsheets.readonly`,',
                      '`https://www.googleapis.com/auth/drive.metadata.readonly`,'}
    source = (ROOT / 'offline/flowassert_offline/sheets.py').read_text(encoding='utf-8')
    assert 'POST' not in source and 'PUT' not in source and 'DELETE' not in source and 'PATCH' not in source
    assert source.count('"GET"') == 1


# ---------- Failed and doubtful reads ----------

def test_a_redirect_is_never_followed(tmp_path):
    response = {'status': 307, 'text': '', 'headers': {'Location': 'http://127.0.0.1:9/elsewhere'}}
    code, _, err, _, requests = run(tmp_path, BASIC, {'drive': [drive(3)], 'values': [response]})
    assert (code, err) == (2, 'refused: Google Sheets values: redirected (HTTP 307), and FlowAssert does not follow '
                              'redirects\n')
    assert len(requests) == 2


@pytest.mark.parametrize('code', [500, 502, 503, 504, 429])
def test_nothing_is_retried(tmp_path, code):
    status = 'RESOURCE_EXHAUSTED' if code == 429 else 'UNAVAILABLE'
    result, _, err, texts, requests = run(tmp_path, BASIC, {'drive': [drive(3)], 'values': [error(code, status)] * 3})
    assert (result, texts, len(requests)) == (2, [], 2)
    assert f'(HTTP {code} {status})' in err


def test_an_error_status_that_is_not_a_plain_name_is_left_out(tmp_path):
    response = {'status': 404, 'json': {'error': {'code': 404, 'status': 'not found; <b>', 'message': 'x'}}}
    _, _, err, _, _ = run(tmp_path, BASIC, {'drive': [drive(3)], 'values': [response]})
    assert err == ('refused: Google Sheets values: not found (HTTP 404); check the spreadsheet ID and that the '
                   'credential can see it\n')


def test_the_error_message_from_the_server_is_never_repeated(tmp_path):
    secret = 'SERVER-SAID-THIS'
    _, _, err, _, _ = run(tmp_path, BASIC, {'drive': [error(403, 'PERMISSION_DENIED', secret)]})
    assert secret not in err and 'HTTP 403 PERMISSION_DENIED' in err


@pytest.mark.parametrize('response,detail', [
    ({'status': 200, 'text': '{"range": "Data!A1:B9", "range": "x"}'}, 'a duplicate member'),
    ({'status': 200, 'text': '{"range": NaN}'}, 'NaN is not JSON'),
    ({'status': 200, 'text': '[1]'}, 'not an object'),
    ({'status': 200, 'text': '\xff'}, 'not JSON'),
    ({'status': 200, 'text': '[' * 100000}, 'not JSON'),
    ({'status': 200, 'json': {'majorDimension': 'ROWS'}}, 'range is missing'),
    ({'status': 200, 'json': {'range': 'Data!A1:B9'}}, 'majorDimension is not ROWS'),
    ({'status': 200, 'json': {'range': 'Data!A1:B9', 'majorDimension': 'ROWS', 'values': {'a': 1}}},
     'values is not a list of rows'),
    ({'status': 200, 'json': {'range': 'Data!A1:B9', 'majorDimension': 'ROWS', 'values': ['a']}},
     'values is not a list of rows'),
    ({'status': 200, 'text': '{"range": "Data!A1:B9", "majorDimension": "ROWS", "values": [["\\ud800"]]}'},
     'a cell is not valid Unicode'),
    ({'status': 200, 'json': {}, 'headers': {'Content-Encoding': 'gzip'}}, 'a compressed body'),
])
def test_a_values_response_that_is_not_the_documented_json_is_refused(tmp_path, response, detail):
    code, _, err, texts, _ = run(tmp_path, BASIC, {'drive': [drive(3), drive(3)], 'values': [response]})
    assert (code, texts) == (2, [])
    assert err == f'refused: Google Sheets values: the response is not the JSON the API documents ({detail})\n'


@pytest.mark.parametrize('body,detail', [
    ({'version': 7}, 'version is not a whole number written as a string'),
    ({'version': '-7'}, 'version is not a whole number written as a string'),
    ({'version': '7', 'modifiedTime': 5}, 'modifiedTime is not a string'),
])
def test_a_drive_response_that_is_not_the_documented_json_is_refused(tmp_path, body, detail):
    _, _, err, _, _ = run(tmp_path, BASIC, {'drive': [{'status': 200, 'json': body}]})
    assert err == f'refused: Google Drive revision metadata: the response is not the JSON the API documents ({detail})\n'


def test_a_slow_response_is_refused_after_the_timeout_and_not_retried(tmp_path):
    started = time.monotonic()
    code, _, err, texts, requests = run(tmp_path, BASIC + ['--source-timeout', '1'], {
        'drive': [drive(3)], 'values': [{**values('Data!A1:B9', ROWS), 'delay': 3}]})
    assert time.monotonic() - started < 2.9
    assert (code, texts, len(requests)) == (2, [], 2)
    assert err == 'refused: Google Sheets values: no complete response within 1 seconds; FlowAssert does not retry\n'


def test_a_response_that_trickles_in_is_bounded_by_the_timeout_as_a_whole(tmp_path):
    started = time.monotonic()
    code, _, err, _, _ = run(tmp_path, BASIC + ['--source-timeout', '1'], {
        'drive': [{**drive(3), 'drip': 0.05}]})
    assert time.monotonic() - started < 2.5
    assert (code, err) == (2, 'refused: Google Drive revision metadata: no complete response within 1 seconds; '
                              'FlowAssert does not retry\n')


def test_a_connection_that_fails_is_refused(tmp_path, monkeypatch, capsys):
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    monkeypatch.setenv('FLOWASSERT_SHEETS_TOKEN', FAKE_TOKEN)
    monkeypatch.setenv('FLOWASSERT_SHEETS_TEST_ENDPOINT', f'http://127.0.0.1:{port}')
    (tmp_path / 'd.csv').write_text(DESTINATION)
    assert cli.main(['--source-sheet', SHEET_ID, '--destination', str(tmp_path / 'd.csv')] + BASIC) == 2
    assert capsys.readouterr().err == 'refused: Google Drive revision metadata: the connection failed\n'


def test_a_certificate_that_cannot_be_verified_is_refused(monkeypatch):
    class Unverified(_Recorder):
        def request(self, *args, **kwargs):
            raise ssl.SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] synthetic')

    monkeypatch.setattr(sheets.http.client, 'HTTPSConnection', Unverified)
    source = sheets.SheetSource(SHEET_ID, 'Data!A1:B', max_bytes=100, environ={'FLOWASSERT_SHEETS_TOKEN': FAKE_TOKEN})
    with pytest.raises(Refused) as refused:
        source.read()
    assert str(refused.value) == "Google Drive revision metadata: the server's TLS certificate could not be verified"
    assert refused.value.__cause__ is None and refused.value.__suppress_context__


@pytest.mark.parametrize('rows,returned,message', [
    ([['id', 'p']] * 4, 'Data!A1:B3', 'Data!A1:B: the response has more rows than the range holds'),
    ([['id', 'p', 'x']], 'Data!A1:B9', 'Data!A1:B: row 1 has more cells than the range has columns'),
    ([['id', 'p'], ['S1', True]], 'Data!A1:B9', 'Data!A1:B: row 2 has a cell that is not text; FlowAssert reads '
                                                'formatted values only'),
    ([['id', 'p'], ['S1', None]], 'Data!A1:B9', 'Data!A1:B: row 2 has a cell that is not text; FlowAssert reads '
                                                'formatted values only'),
    ([['id', 'p'], ['S1', 1.5]], 'Data!A1:B9', 'Data!A1:B: row 2 has a cell that is not text; FlowAssert reads '
                                               'formatted values only'),
    ([['id', 'id']], 'Data!A1:B9', 'Data!A1:B: repeated column name'),
    ([['id']], 'Data!A1:B9', 'Data!A1:B: missing column p'),
    ([], 'Data!A1:B9', 'Data!A1:B: missing column id, p'),
    (ROWS, "'Data'!A1:B", None),
])
def test_rows_are_refused_rather_than_partly_read(tmp_path, rows, returned, message):
    code, _, err, _, _ = run(tmp_path, BASIC, ok(rows, returned))
    if message is None:
        assert (code, err) == (3, '')
    else:
        assert (code, err) == (2, f'refused: {message}\n')


def test_max_rows_counts_data_rows_and_max_bytes_bounds_each_response(tmp_path):
    assert run(tmp_path, BASIC + ['--max-rows', '2'], ok())[0] == 3
    assert run(tmp_path, BASIC + ['--max-rows', '1'], ok())[2] == 'refused: Data!A1:B: exceeds --max-rows limit of 1\n'
    big = ok([['id', 'p']] + [[f'S{i}', 'x' * 50] for i in range(100)])
    code, _, err, _, requests = run(tmp_path, BASIC + ['--max-bytes', '2000'], big)
    assert (code, err) == (2, 'refused: Google Sheets values: response exceeds --max-bytes limit of 2000\n')
    assert len(requests) == 2


# ---------- The revision ----------

@pytest.mark.parametrize('before,after,expected', [
    (drive(9), drive(9), 'Drive version 9 before and after the values were read.'),
    (drive(None), drive(None), 'The read cannot be tied to a revision: Google Drive returned no version.'),
    (drive(None, None), drive(None, None), 'The read cannot be tied to a revision: Google Drive returned no version.'),
    (drive(9, None), drive(9, None), 'Drive version 9 before and after the values were read.'),
    (drive(9), drive(10), 'refused: the sheet changed while it was read: Drive version 9 modified '
                          '2026-11-01T09:00:00.000Z before the values, version 10 modified 2026-11-01T09:00:00.000Z '
                          'after; run the check again'),
    (drive(9), drive(9, '2026-11-01T09:00:01.000Z'), 'refused: the sheet changed while it was read: Drive version 9 '
                                                     'modified 2026-11-01T09:00:00.000Z before the values, version 9 '
                                                     'modified 2026-11-01T09:00:01.000Z after; run the check again'),
    (drive(9), drive(None), 'refused: the sheet\'s revision could not be read the same way before and after the '
                            'values; run the check again'),
    (drive(None), drive(9), 'refused: the sheet\'s revision could not be read the same way before and after the '
                            'values; run the check again'),
])
def test_the_revision_is_read_before_and_after_the_values(tmp_path, before, after, expected):
    code, out, err, texts, requests = run(tmp_path, BASIC, {'drive': [before, after],
                                                             'values': [values('Data!A1:B9', ROWS)]})
    assert len(requests) == 3
    if expected.startswith('refused: '):
        assert (code, err, texts) == (2, expected + '\n', [])
    else:
        assert code == 3 and expected in out.splitlines()
        report = json.loads(texts[0])
        assert report['inputs']['source_sheet']['revision']['available'] is expected.startswith('Drive')


def test_skipping_the_revision_makes_no_drive_request(tmp_path):
    code, out, _, texts, requests = run(tmp_path, BASIC + ['--skip-source-revision'],
                                        {'values': [values('Data!A1:B9', ROWS)]})
    assert code == 3 and [r['path'].split('/')[1] for r in requests] == ['v4']
    assert 'The read cannot be tied to a revision: not requested (--skip-source-revision).' in out.splitlines()
    assert json.loads(texts[0])['inputs']['source_sheet']['revision'] == {
        'available': False, 'reason': 'not requested (--skip-source-revision)'}


# ---------- The report ----------

def test_the_report_records_the_read_and_never_the_credential_account_or_title(tmp_path):
    # Members a response could carry beside the documented ones are not copied into the report.
    title, account = 'Synthetic title FA7', 'owner-fa7@example.test'
    drive_more = {'status': 200, 'json': {'version': '3', 'modifiedTime': '2026-11-01T09:00:00.000Z', 'name': title,
                                          'owners': [{'emailAddress': account}]}}
    responses = {'drive': [drive_more, drive_more],
                 'values': [{'status': 200, 'json': {**values('Data!A1:B1000', ROWS)['json'], 'title': title}}]}
    code, _, _, texts, _ = run(tmp_path, BASIC + ['--source-complete'], responses)
    report = json.loads(texts[0])
    assert report['schema_version'] == 2
    sheet = report['inputs']['source_sheet']
    assert sorted(sheet) == ['canonical_form', 'date_time_render_option', 'major_dimension', 'range_requested',
                             'range_returned', 'read_at', 'read_by', 'revision', 'service', 'spreadsheet_id',
                             'value_render_option']
    assert sheet['read_by'] == 'FlowAssert' and sheet['range_requested'] == 'Data!A1:B'
    assert sheet['range_returned'] == 'Data!A1:B1000'
    assert report['inputs']['source_sha256'] == hashlib.sha256(b'id,p\nS1,one\nS2,two\n').hexdigest()
    assert 'source_encoding' not in report['inputs']
    # The completeness premise keeps its meaning: a statement, not a check.
    assert report['premises']['source_complete'] == {'origin': 'command-line option', 'stated': True}
    assert report['limitations'] == cli.LIMITS and report['acquisition_authenticity'] == 'not_authenticated'
    for text in texts:
        assert FAKE_TOKEN not in text and title not in text and account not in text


def test_a_destination_encoding_is_recorded_alone(tmp_path):
    _, _, _, texts, _ = run(tmp_path, BASIC + ['--destination-encoding', 'utf-8'], ok())
    inputs = json.loads(texts[0])['inputs']
    assert inputs['destination_encoding'] == 'utf-8' and 'source_encoding' not in inputs


def test_reports_without_a_sheet_source_are_version_1(tmp_path, capsys):
    (tmp_path / 's.csv').write_text('k,p\n1,2\n')
    (tmp_path / 'd.csv').write_text('k,p\n1,3\n')
    cli.main(['--source', str(tmp_path / 's.csv'), '--destination', str(tmp_path / 'd.csv'), '--key', 'k', '--field',
              'p', '--json', str(tmp_path / 'r.json')])
    report = json.loads((tmp_path / 'r.json').read_text())
    assert report['schema_version'] == 1 and 'source_sheet' not in report['inputs']
    assert 'Google' not in capsys.readouterr().out


# ---------- The canonical form ----------

@pytest.mark.parametrize('rows', [
    [['id', 'p'], ['a,b', 'say "x"'], ['line\nbreak', 'cr\ronly'], ['', ''], ['trailing ', ' lead']],
    [['only'], [''], ['x'], ['']],
    [['名前', 'note'], ['K-😀', '\x01\x7f'], ['K-ü', '']],
    [['', 'p'], ['k', '']],
])
def test_the_canonical_form_is_a_csv_file_that_reads_as_the_same_rows(tmp_path, rows):
    text = ''.join(sheets.canonical_row(row) for row in rows)
    (tmp_path / 'c.csv').write_bytes(text.encode('utf-8'))
    header = rows[0]
    columns = [c for c in header if c] or header
    read = list(cli.CsvFile(str(tmp_path / 'c.csv'), columns))
    assert read == [{c: row[header.index(c)] for c in columns} for row in rows[1:]]
    assert list(csv.reader(io.StringIO(text, newline=''), strict=True)) == rows


# ---------- The credential never leaves the environment ----------

def _every_refusal():
    """Every golden sheet case, which between them take every refusal path, and the paths only a test can take."""
    for name, spec in GOLDEN.SHEET_CASES.items():
        yield name, spec['args'], spec['responses'], spec['env']
    args = ['--source-sheet', SHEET_ID, '--destination', 'destination.csv'] + BASIC
    yield 'timeout', args + ['--source-timeout', '1'], {'drive': [{**drive(1), 'delay': 2}]}, {}
    yield 'connection', args, {}, {'FLOWASSERT_SHEETS_TEST_ENDPOINT': 'http://127.0.0.1:1'}


@pytest.mark.parametrize('kind', ['token', 'key'])
def test_the_credential_appears_in_no_output_report_or_exception(tmp_path, monkeypatch, kind):
    recognisable = (FAKE_TOKEN if kind == 'token' else FAKE_KEY) + '-LEAK-CANARY'
    variable = 'FLOWASSERT_SHEETS_TOKEN' if kind == 'token' else 'FLOWASSERT_SHEETS_API_KEY'
    seen = []
    for name, args, responses, env in _every_refusal():
        folder = tmp_path / name
        folder.mkdir()
        spec = GOLDEN.SHEET_CASES.get(name, {'files': {'destination.csv': DESTINATION.encode()}})
        for file, data in spec['files'].items():
            (folder / file).write_bytes(data)
        with FakeSheetsApi(json.loads(json.dumps(responses)), credential=(kind, recognisable)) as api:
            environ = {'FLOWASSERT_SHEETS_TEST_ENDPOINT': api.endpoint, variable: recognisable, **env}
            for name_, value in environ.items():
                monkeypatch.setenv(name_, value)
            monkeypatch.chdir(folder)
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = cli.main(args + ['--json', 'report.json', '--html', 'report.html'])
            # The refusal itself, raised again outside main, and everything chained to it.
            try:
                cli.run(cli_args(args))
            except Refused as e:
                chained = ''.join(traceback.format_exception(type(e), e, e.__traceback__))
            else:
                chained = ''
            for name_ in environ:
                monkeypatch.delenv(name_)
        written = ''.join(p.read_text(encoding='utf-8') for p in folder.glob('report.*'))
        seen.append(code)
        for text in (out.getvalue(), err.getvalue(), written, chained):
            assert recognisable not in text, name
            assert recognisable[:20] not in text, name
    assert 2 in seen and {0, 1, 3} & set(seen)


def cli_args(args):
    """The parsed options of a command line, as main parses them."""
    parsed = {}

    class Capture(Exception):
        pass

    def fake_run(a):
        parsed['args'] = a
        raise Capture()

    saved = cli.check
    cli.check = fake_run
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            try:
                cli.main(args)
            except (Capture, SystemExit):
                pass
    finally:
        cli.check = saved
    return parsed.get('args')


# ---------- Same rows, same result (rule 7) ----------

def _source_rows(name, case):
    """The source rows of a golden case as a sheet would hold them, or None when a sheet cannot hold the same rows."""
    folder = GOLDEN.GOLDEN / name
    args = case['args']
    encoding = args[args.index('--source-encoding') + 1] if '--source-encoding' in args else 'utf-8'
    codec = {'utf-8': 'utf-8-sig', 'utf-16': 'utf-16', 'gb18030': 'gb18030'}.get(encoding)
    path = folder / args[args.index('--source') + 1]
    if codec is None or not path.exists():
        return None
    data = path.read_bytes()
    try:
        rows = [row for row in csv.reader(io.StringIO(data.decode(codec), newline=''), strict=True) if row]
    except (UnicodeError, csv.Error):
        return None
    if not rows or rows[0][-1:] == [''] or any(len(row) != len(rows[0]) for row in rows):
        return None
    if any(len(value) > 50000 for row in rows for value in row):
        return None  # longer than a Google Sheets cell can hold [unconfirmed limit]
    held = sheet_rows(rows)
    if held is None:
        return None
    canonical = ''.join(sheets.canonical_row(row) for row in rows).encode('utf-8')
    destination = folder / args[args.index('--destination') + 1]
    if destination.exists() and data == destination.read_bytes() and data != canonical:
        return None  # identical bytes as files, but not as the canonical form: the two paths differ by design
    return held


def _column_letters(n):
    letters = ''
    while n:
        n, r = divmod(n - 1, 26)
        letters = chr(65 + r) + letters
    return letters


def _equivalence_cases():
    for folder in sorted(GOLDEN.GOLDEN.iterdir()):
        case = json.loads((folder / 'case.json').read_text(encoding='utf-8'))
        exit_status = int((folder / 'exit_status.txt').read_text())
        stderr = (folder / 'stderr.txt').read_text(encoding='utf-8')
        if exit_status == 2 and (stderr.startswith('refused: --source-encoding') or stderr.startswith('refused: source.csv:')
                                 and not any(m in stderr for m in ('missing column', 'repeated column', '--max-rows'))
                                 or 'same file' in stderr):
            continue  # a refusal of the source file itself, or of an option a sheet does not take
        rows = _source_rows(folder.name, case)
        if rows is not None:
            yield folder.name, case, rows


EQUIVALENCE = list(_equivalence_cases())


def test_most_golden_cases_can_be_run_from_a_sheet():
    assert len(EQUIVALENCE) >= 60
    names = {name for name, _, _ in EQUIVALENCE}
    for name in ('example', 'rules-pass', 'rules-fail', 'rules-unknown', 'scope-exact-source-known', 'counts-match',
                 'duplicate-source-key', 'keyless-rows', 'empty-values', 'no-rows', 'unsafe-values', 'encoding-gb18030',
                 'refused-identical-content', 'identical-content-allowed', 'refused-missing-columns',
                 'refused-repeated-column', 'refused-max-rows', 'scenario-orders-rules-both-statements'):
        assert name in names, name


SHEET_LINES = ('Source read by FlowAssert from Google Sheets: ', 'Drive version ', 'The read cannot be tied')


@pytest.mark.parametrize('name,case,rows', EQUIVALENCE, ids=[name for name, _, _ in EQUIVALENCE])
def test_a_sheet_and_a_file_with_the_same_rows_give_the_same_result(tmp_path, monkeypatch, name, case, rows):
    folder = GOLDEN.GOLDEN / name
    args = list(case['args'])
    i = args.index('--source')
    width = max(len(rows[0]), 1)
    range_text = f'Data!A1:{_column_letters(width)}'
    args[i:i + 2] = ['--source-sheet', SHEET_ID, '--source-range', range_text]
    if '--source-encoding' in args:
        j = args.index('--source-encoding')
        del args[j:j + 2]
    for file in folder.iterdir():
        if file.suffix in ('.csv', '.json') and file.name not in ('case.json', 'report.json'):
            (tmp_path / file.name).write_bytes(file.read_bytes())
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('FLOWASSERT_SHEETS_TOKEN', FAKE_TOKEN)
    out, err = io.StringIO(), io.StringIO()
    with FakeSheetsApi({'drive': [drive(1), drive(1)], 'values': [values(range_text, rows)]}) as api:
        monkeypatch.setenv('FLOWASSERT_SHEETS_TEST_ENDPOINT', api.endpoint)
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main(args + ['--json', 'report.json'])
    expected_exit = int((folder / 'exit_status.txt').read_text())
    expected_err = (folder / 'stderr.txt').read_text(encoding='utf-8').replace('source.csv:', f'{range_text}:')
    assert (code, err.getvalue()) == (expected_exit, expected_err)
    if code == 2:
        return
    summary = [line.replace(', range has ', ', file has ') for line in out.getvalue().splitlines()
               if not line.startswith(SHEET_LINES)]
    assert summary == (folder / 'stdout.txt').read_text(encoding='utf-8').splitlines()
    sheet = json.loads((tmp_path / 'report.json').read_text(encoding='utf-8'))
    file = json.loads((folder / 'report.json').read_text(encoding='utf-8'))
    for report in (sheet, file):
        report.pop('schema_version')
        report.pop('evaluated_at')
    sheet_inputs, file_inputs = sheet.pop('inputs'), file.pop('inputs')
    assert sheet == file
    for member in ('source_complete_stated', 'destination_complete_stated', 'destination_sha256', 'identical_content',
                   'identical_content_allowed', 'mapping_file_sha256', 'config_file_sha256'):
        assert sheet_inputs.get(member) == file_inputs.get(member), member
    padded = [rows[0]] + [row + [''] * (len(rows[0]) - len(row)) for row in rows[1:]]
    canonical = ''.join(sheets.canonical_row(row) for row in padded).encode('utf-8')
    assert sheet_inputs['source_sha256'] == hashlib.sha256(canonical).hexdigest()


def test_the_golden_sheet_cases_are_current_and_send_only_get_requests_to_the_two_paths():
    assert GOLDEN.check() == []
    folders = sorted(GOLDEN.GOLDEN_SHEETS.iterdir())
    assert [f.name for f in folders] == sorted(GOLDEN.SHEET_CASES)
    for folder in folders:
        for method, path, query in json.loads((folder / 'requests.json').read_text(encoding='utf-8')):
            assert method == 'GET'
            assert path == f'/drive/v3/files/{GOLDEN.SHEET_ID}' or path.startswith(
                f'/v4/spreadsheets/{GOLDEN.SHEET_ID}/values/')
            assert all(value != FAKE_KEY for _, value in query)
        for file in folder.iterdir():
            text = file.read_bytes().decode('utf-8', 'replace')
            assert FAKE_TOKEN not in text and FAKE_KEY not in text, file
