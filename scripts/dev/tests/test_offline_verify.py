"""Evaluator v2 and the offline CSV check. v1 fixtures are the semantic reference."""
import codecs
import gc
import hashlib
import html
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import weakref

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'offline'))
from flowassert_offline import cli as verify, evaluator_v2  # noqa: E402

KEY = {'key': ('key', 'key'), 'fields': [('phone', 'phone')]}
ROW = {'key': 'K1', 'phone': '1'}


def run(source, destination, **premises):
    return evaluator_v2.evaluate(KEY, source, destination, **premises)


def states(result):
    return result['cohort_state'], [r['state'] for r in result['records']]


COMPLETE = {'source_complete': True, 'destination_complete': True}


@pytest.mark.parametrize('source,destination,premises,expected', [
    ([ROW], [ROW], COMPLETE, ('Verified', ['Verified'])),
    ([ROW], [{'key': 'K1', 'phone': '2'}], COMPLETE, ('Mismatch', ['Mismatch'])),
    ([ROW], [], COMPLETE, ('Mismatch', ['Mismatch'])),
    ([ROW], [ROW, ROW], COMPLETE, ('Mismatch', ['Mismatch'])),
    # Without a premise the conclusion stays open.
    ([ROW], [], {'source_complete': True}, ('Unverified', ['Unverified'])),
    ([ROW], [ROW], {'source_complete': True}, ('Unverified', ['Unverified'])),
    ([ROW], [ROW], {'destination_complete': True}, ('Unverified', ['Verified'])),
    ([ROW], [ROW], {}, ('Unverified', ['Unverified'])),
    # A row that exists can disprove a rule without any premise.
    ([ROW], [{'key': 'K1', 'phone': '2'}], {}, ('Mismatch', ['Mismatch'])),
    # Exact comparison, and empty is unknown rather than different.
    ([ROW], [{'key': 'K1', 'phone': '1 '}], COMPLETE, ('Mismatch', ['Mismatch'])),
    ([ROW], [{'key': 'K1', 'phone': ''}], COMPLETE, ('Unverified', ['Unverified'])),
    ([{'key': 'K1', 'phone': ''}], [ROW], COMPLETE, ('Unverified', ['Unverified'])),
    # Bad identity never verifies.
    ([ROW, ROW], [ROW], COMPLETE, ('Unverified', ['Unverified', 'Unverified'])),
    ([{'key': ' ', 'phone': '1'}], [ROW], COMPLETE, ('Unverified', ['Unverified'])),
    # A destination row without a key could be the missing record.
    ([ROW], [{'key': '', 'phone': '1'}], COMPLETE, ('Unverified', ['Unverified'])),
    ([], [], COMPLETE, ('Unverified', [])),
])
def test_decisions(source, destination, premises, expected):
    assert states(run(source, destination, **premises)) == expected


def test_premises_must_be_exactly_true():
    assert states(run([ROW], [ROW], source_complete='yes', destination_complete=1)) == ('Unverified', ['Unverified'])


def test_mismatch_keeps_other_rows_and_assesses_nothing_external():
    result = run([ROW, {'key': 'K2', 'phone': '2'}], [ROW, {'key': 'K2', 'phone': '3'}], **COMPLETE)
    assert states(result) == ('Mismatch', ['Verified', 'Mismatch'])
    assert result['workflow_execution'] == result['business_truth'] == result['existed_by_deadline'] == 'Not assessed'
    assert result['acquisition_authenticity'] == 'not_authenticated'


def test_unknown_population_has_no_total():
    result = run([ROW], [ROW], destination_complete=True)
    assert result['expected_total'] is None and result['source_population_known'] is False


@pytest.mark.parametrize('fixture,premises', [
    ('A-verified', COMPLETE),
    ('B-mismatch', COMPLETE),
    ('E-row-verified-cohort-unverified', {'source_complete': False, 'destination_complete': True}),
])
def test_agrees_with_frozen_evaluator_on_shared_cases(fixture, premises):
    case = json.loads((ROOT / 'service/fixtures' / f'{fixture}.json').read_text())
    evidence, frozen = case['input_evidence'], case['proposed_response']['result']
    rows = [r for page in evidence['destination']['pages'] for r in page['rows']]
    result = run(evidence['source']['rows'], rows, **premises)
    assert result['cohort_state'] == frozen['cohort_state']
    assert [r['state'] for r in result['records']] == [r['state'] for r in frozen['records']]
    assert result['expected_total'] == frozen['expected_total']


EXAMPLE = ROOT / 'offline/examples'


def cli(*extra):
    return ['--source', str(EXAMPLE / 'source.csv'), '--destination', str(EXAMPLE / 'destination.csv'),
            '--key', 'external_id', '--field', 'phone', '--field', 'email:hs_email', *extra]


def test_example_report(tmp_path, capsys):
    out = tmp_path / 'report.json'
    assert verify.main(cli('--source-complete', '--destination-complete', '--json', str(out))) == 1
    report = json.loads(out.read_text())
    assert [r['state'] for r in report['records']] == ['Verified', 'Mismatch', 'Mismatch', 'Mismatch']
    assert report['claim'] is None and len(report['inputs']['source_sha256']) == 64
    assert 'SYN-002' in capsys.readouterr().out


def test_redaction_removes_values(tmp_path):
    out = tmp_path / 'report.json'
    verify.main(cli('--source-complete', '--destination-complete', '--redact-values', '--json', str(out)))
    text = out.read_text()
    assert '0199' not in text and 'SYN-002' not in text


def test_existing_report_is_not_overwritten(tmp_path, capsys):
    out = tmp_path / 'report.json'
    out.write_text('keep')
    assert verify.main(cli('--json', str(out))) == 2
    assert out.read_text() == 'keep'


def write(path, text):
    path.write_text(text)
    return str(path)


def refused(tmp_path, capsys, source, destination='k,p\n2,x\n', args=('--key', 'k', '--field', 'p')):
    code = verify.main(['--source', write(tmp_path / 's.csv', source),
                        '--destination', write(tmp_path / 'd.csv', destination), *args])
    return code, capsys.readouterr().err


@pytest.mark.parametrize('source,message', [
    ('k\n1\n', 'missing column'),
    ('k,p,p\n1,2,3\n', 'repeated column'),
    ('k,p\n1,2,3\n', 'does not match'),
    ('k,p\n1\n', 'does not match'),
    ('k,p\n"1,2\n', 'unexpected end of data'),
])
def test_malformed_input_is_refused(tmp_path, capsys, source, message):
    code, err = refused(tmp_path, capsys, source)
    assert code == 2 and err.startswith('refused:') and message in err


def test_non_utf8_is_refused(tmp_path, capsys):
    (tmp_path / 's.csv').write_bytes(b'k,p\n\xff,1\n')
    code = verify.main(['--source', str(tmp_path / 's.csv'), '--destination', write(tmp_path / 'd.csv', 'k,p\n1,x\n'),
                        '--key', 'k', '--field', 'p'])
    assert code == 2 and 'not UTF-8' in capsys.readouterr().err


def test_same_file_is_refused(tmp_path, capsys):
    path = write(tmp_path / 's.csv', 'k,p\n1,x\n')
    assert verify.main(['--source', path, '--destination', path, '--key', 'k', '--field', 'p']) == 2
    assert 'independent' in capsys.readouterr().err


def test_identical_content_is_refused(tmp_path, capsys):
    code, err = refused(tmp_path, capsys, 'k,p\n2,x\n')
    assert code == 2 and 'identical content' in err


def test_internal_failure_is_not_a_mismatch(monkeypatch, capsys):
    monkeypatch.setattr(verify, 'evaluate', lambda *a, **k: 1 / 0)
    assert verify.main(cli()) == 4
    assert 'ZeroDivisionError' in capsys.readouterr().err


def test_cell_may_hold_line_separators(tmp_path, capsys):
    text = 'k,p\n1,"a\u2028b\nc"\n'
    code = verify.main(['--source', write(tmp_path / 's.csv', text), '--destination', write(tmp_path / 'd.csv', 'p,k\n"a\u2028b\nc",1\n'),
                        '--key', 'k', '--field', 'p', '--source-complete', '--destination-complete'])
    assert code == 0


def test_a_field_is_required(tmp_path, capsys):
    assert refused(tmp_path, capsys, 'k,p\n1,x\n', args=('--key', 'k'))[0] == 2


def test_verified_exit_and_claim(tmp_path, capsys):
    out = tmp_path / 'r.json'
    code = verify.main(['--source', write(tmp_path / 's.csv', '﻿k,p\n1,x\n'),
                        '--destination', write(tmp_path / 'd.csv', 'k,p\n1,x\n'), '--key', 'k', '--field', 'p',
                        '--source-complete', '--destination-complete', '--json', str(out)])
    assert code == 0 and json.loads(out.read_text())['claim'] == verify.CLAIM


def test_version(capsys):
    with pytest.raises(SystemExit) as stopped:
        verify.main(['--version'])
    assert stopped.value.code == 0 and capsys.readouterr().out.strip() == verify.__version__


def test_unverified_exit(tmp_path, capsys):
    code = verify.main(['--source', write(tmp_path / 's.csv', 'k,p\n1,x\n'),
                        '--destination', write(tmp_path / 'd.csv', 'p,k\nx,1\n'), '--key', 'k', '--field', 'p'])
    assert code == 3


def test_mapping_file_supports_colon_columns_and_records_digest(tmp_path, capsys):
    mapping_bytes = json.dumps({
        'key': ['crm:id', 'Record ID'],
        'fields': [['Contact: Phone', 'phone'], ['email', 'email']],
    }).encode('utf-8')
    mapping_path = tmp_path / 'mapping.json'
    mapping_path.write_bytes(mapping_bytes)
    out = tmp_path / 'report.json'
    code = verify.main([
        '--source', write(tmp_path / 's.csv', 'crm:id,Contact: Phone,email\nSYN-1,+1 555 0100,a@example.test\n'),
        '--destination', write(tmp_path / 'd.csv', 'Record ID,phone,email\nSYN-1,+1 555 0100,a@example.test\n'),
        '--mapping', str(mapping_path),
        '--source-complete', '--destination-complete',
        '--json', str(out),
    ])
    assert code == 0
    report = json.loads(out.read_text())
    assert report['inputs']['mapping_file_sha256'] == hashlib.sha256(mapping_bytes).hexdigest()
    assert report['obligation']['key'] == ['crm:id', 'Record ID']
    assert report['obligation']['fields'] == [['Contact: Phone', 'phone'], ['email', 'email']]


def test_mapping_digest_omitted_when_mapping_not_used(tmp_path, capsys):
    out = tmp_path / 'report.json'
    assert verify.main(cli('--json', str(out))) == 1
    assert 'mapping_file_sha256' not in json.loads(out.read_text())['inputs']


@pytest.mark.parametrize('extra', [
    ['--key', 'k'],
    ['--field', 'p'],
    ['--key', 'k', '--field', 'p'],
])
def test_mapping_cannot_be_combined_with_key_or_field(tmp_path, capsys, extra):
    mapping = write(tmp_path / 'm.json', '{"key": ["k", "k"], "fields": [["p", "p"]]}')
    code, err = refused(tmp_path, capsys, 'k,p\n1,x\n', args=('--mapping', mapping, *extra))
    assert code == 2 and '--mapping' in err


def test_key_or_mapping_is_required(tmp_path, capsys):
    code, err = refused(tmp_path, capsys, 'k,p\n1,x\n', args=('--field', 'p'))
    assert code == 2 and 'required' in err


@pytest.mark.parametrize('content,expected_err', [
    (b'\xff', 'not UTF-8'),
    (b'{not json', 'invalid JSON'),
    (b'{"key": ["k", "k"], "key": ["a", "b"], "fields": [["p", "p"]]}', 'duplicate member'),
    (b'[]', 'JSON object'),
    (b'{"key": ["k", "k"], "fields": [["p", "p"]], "extra": true}', 'unknown member'),
    (b'{"key": ["k", "k"]}', 'missing member'),
    (b'{"fields": [["p", "p"]]}', 'missing member'),
    (b'{"key": "k:k", "fields": [["p", "p"]]}', 'two-item list of strings'),
    (b'{"key": ["k"], "fields": [["p", "p"]]}', 'two-item list of strings'),
    (b'{"key": ["k", "k", "k"], "fields": [["p", "p"]]}', 'two-item list of strings'),
    (b'{"key": [1, "k"], "fields": [["p", "p"]]}', 'two-item list of strings'),
    (b'{"key": ["k", "k"], "fields": "p:p"}', 'non-empty list'),
    (b'{"key": ["k", "k"], "fields": []}', 'non-empty list'),
    (b'{"key": ["k", "k"], "fields": [["p"]]}', 'two-item list of strings'),
    (b'{"key": ["k", "k"], "fields": [["p", "p", "p"]]}', 'two-item list of strings'),
    (b'{"key": ["k", "k"], "fields": [["p", 2]]}', 'two-item list of strings'),
    (b'{"key": ["", "k"], "fields": [["p", "p"]]}', 'empty column name'),
    (b'{"key": ["k", "   "], "fields": [["p", "p"]]}', 'empty column name'),
    (b'{"key": ["k", "k"], "fields": [["", "p"]]}', 'empty column name'),
    (b'{"key": ["k", "k"], "fields": [["p", ""]]}', 'empty column name'),
    (b'{"key": ["k", "k"], "fields": [["p", "p1"], ["p", "p2"]]}', 'source field is repeated'),
])
def test_malformed_mapping_file_is_refused(tmp_path, capsys, content, expected_err):
    mapping = tmp_path / 'm.json'
    mapping.write_bytes(content)
    code, err = refused(tmp_path, capsys, 'k,p\n1,x\n', args=('--mapping', str(mapping)))
    assert code == 2 and err.startswith('refused:') and expected_err in err


def test_missing_mapping_file_is_refused(tmp_path, capsys):
    code, err = refused(tmp_path, capsys, 'k,p\n1,x\n', args=('--mapping', str(tmp_path / 'absent.json')))
    assert code == 2 and err.startswith('refused:')


def test_identical_content_refusal_names_override_flag(tmp_path, capsys):
    code, err = refused(tmp_path, capsys, 'k,p\n2,x\n')
    assert code == 2 and 'identical content' in err and '--allow-identical-content' in err


def test_identical_content_allowed_records_fields_and_prints_summary_line(tmp_path, capsys):
    out = tmp_path / 'report.json'
    code = verify.main([
        '--source', write(tmp_path / 's.csv', 'k,p\n2,x\n'),
        '--destination', write(tmp_path / 'd.csv', 'k,p\n2,x\n'),
        '--key', 'k', '--field', 'p',
        '--source-complete', '--destination-complete',
        '--allow-identical-content',
        '--json', str(out),
    ])
    assert code == 0
    stdout = capsys.readouterr().out
    assert 'identical' in stdout
    inputs = json.loads(out.read_text())['inputs']
    assert inputs['identical_content'] is True
    assert inputs['identical_content_allowed'] is True


def test_differing_content_records_identical_content_false(tmp_path, capsys):
    out = tmp_path / 'report.json'
    assert verify.main(cli('--source-complete', '--destination-complete', '--json', str(out))) == 1
    stdout = capsys.readouterr().out
    assert 'identical' not in stdout.lower()
    inputs = json.loads(out.read_text())['inputs']
    assert inputs['identical_content'] is False
    assert 'identical_content_allowed' not in inputs


def test_same_file_still_refused_even_with_allow_identical_content(tmp_path, capsys):
    source = tmp_path / 's.csv'
    source.write_text('k,p\n1,x\n')
    link = tmp_path / 'link.csv'
    link.symlink_to(source)
    code = verify.main([
        '--source', str(source), '--destination', str(link),
        '--key', 'k', '--field', 'p', '--allow-identical-content',
    ])
    assert code == 2 and 'same file' in capsys.readouterr().err


def test_max_bytes_at_limit_and_one_over_before_reading(tmp_path, monkeypatch, capsys):
    source = tmp_path / 's.csv'
    dest = tmp_path / 'd.csv'
    source.write_bytes(b'\xef\xbb\xbfk,p\n1,x\n')  # 11 bytes
    dest.write_bytes(b'k,p\n1,x\n')  # 8 bytes
    assert verify.main([
        '--source', str(source), '--destination', str(dest),
        '--key', 'k', '--field', 'p',
        '--source-complete', '--destination-complete',
        '--max-bytes', '11',
    ]) == 0
    capsys.readouterr()

    opened = []
    real_open = open

    def tracking_open(file, *a, **kw):
        opened.append(str(file))
        return real_open(file, *a, **kw)

    monkeypatch.setattr('builtins.open', tracking_open)
    code = verify.main([
        '--source', str(source), '--destination', str(dest),
        '--key', 'k', '--field', 'p',
        '--max-bytes', '10',
    ])
    err = capsys.readouterr().err
    assert code == 2 and str(source) in err and '10' in err
    assert opened == []


def test_max_bytes_destination_one_over(tmp_path, capsys):
    source = write(tmp_path / 's.csv', 'k,p\n1,x\n')  # 8 bytes
    dest = write(tmp_path / 'd.csv', 'k,p,extra\n1,x,y\n')  # 16 bytes
    code = verify.main([
        '--source', source, '--destination', dest,
        '--key', 'k', '--field', 'p',
        '--max-bytes', '15',
    ])
    err = capsys.readouterr().err
    assert code == 2 and dest in err and '15' in err


@pytest.mark.parametrize('flag', ['--max-bytes', '--max-rows'])
@pytest.mark.parametrize('bad_value', ['0', '-1', '-50', 'abc', '1.5'])
def test_non_positive_or_invalid_limits_are_refused(tmp_path, capsys, flag, bad_value):
    code, err = refused(tmp_path, capsys, 'k,p\n1,x\n', args=('--key', 'k', '--field', 'p', flag, bad_value))
    assert code == 2 and flag in err


def test_max_rows_at_limit_and_one_over_stops_while_reading(tmp_path, capsys):
    source = write(tmp_path / 's.csv', 'k,p\n1,a\n2,b\n3,c\n')
    dest = write(tmp_path / 'd.csv', 'p,k\na,1\nb,2\nc,3\n')
    assert verify.main([
        '--source', source, '--destination', dest,
        '--key', 'k', '--field', 'p',
        '--source-complete', '--destination-complete',
        '--max-rows', '3',
    ]) == 0
    capsys.readouterr()

    code = verify.main([
        '--source', source, '--destination', dest,
        '--key', 'k', '--field', 'p',
        '--max-rows', '2',
    ])
    err = capsys.readouterr().err
    assert code == 2 and source in err and '2' in err

    dest_over = write(tmp_path / 'd_over.csv', 'p,k\na,1\nb,2\nc,3\nd,4\n')
    code = verify.main([
        '--source', source, '--destination', dest_over,
        '--key', 'k', '--field', 'p',
        '--max-rows', '3',
    ])
    err = capsys.readouterr().err
    assert code == 2 and dest_over in err and '3' in err

    # Prove reading stops once --max-rows is passed rather than scanning to EOF.
    huge = tmp_path / 'huge.csv'
    huge.write_bytes(b'k,p\n' + (b'1,abcdefghij\n' * 5000) + b'\xff,broken\n')
    code = verify.main([
        '--source', str(huge), '--destination', dest,
        '--key', 'k', '--field', 'p',
        '--max-rows', '2',
    ])
    err = capsys.readouterr().err
    assert code == 2 and '--max-rows' in err and str(huge) in err


def test_max_details_zero_small_and_default(tmp_path, capsys):
    out_zero = tmp_path / 'zero.json'
    assert verify.main(cli('--source-complete', '--destination-complete', '--max-details', '0', '--json', str(out_zero))) == 1
    stdout_zero = capsys.readouterr().out
    assert '  record ' not in stdout_zero
    assert '... 3 more records not shown; use --json for all of them.' in stdout_zero
    assert len(json.loads(out_zero.read_text())['records']) == 4

    out_small = tmp_path / 'small.json'
    assert verify.main(cli('--source-complete', '--destination-complete', '--max-details', '2', '--json', str(out_small))) == 1
    stdout_small = capsys.readouterr().out
    assert 'SYN-002' in stdout_small and 'SYN-003' in stdout_small and 'SYN-004' not in stdout_small
    assert '... 1 more records not shown; use --json for all of them.' in stdout_small
    assert len(json.loads(out_small.read_text())['records']) == 4

    # Default limit is 50 non-Verified records; JSON report keeps every record.
    src_rows = 'k,p\n' + ''.join(f'SYN-{i:03d},expected-{i}\n' for i in range(1, 61))
    dst_rows = 'k,p\n' + ''.join(f'SYN-{i:03d},actual-{i}\n' for i in range(1, 61))
    out_default = tmp_path / 'default.json'
    assert verify.main([
        '--source', write(tmp_path / 's60.csv', src_rows),
        '--destination', write(tmp_path / 'd60.csv', dst_rows),
        '--key', 'k', '--field', 'p',
        '--source-complete', '--destination-complete',
        '--json', str(out_default),
    ]) == 1
    stdout_default = capsys.readouterr().out
    assert 'SYN-050' in stdout_default and 'SYN-051' not in stdout_default
    assert '... 10 more records not shown; use --json for all of them.' in stdout_default
    assert len(json.loads(out_default.read_text())['records']) == 60


@pytest.mark.parametrize('bad_value', ['-1', 'abc', '1.5'])
def test_invalid_max_details_is_refused(tmp_path, capsys, bad_value):
    out = tmp_path / 'unused.json'
    code = verify.main(cli('--max-details', bad_value, '--json', str(out)))
    assert code == 2 and '--max-details' in capsys.readouterr().err and not out.exists()


CONFORMANCE = ROOT / 'offline/conformance'
CONFORMANCE_KEYS = {
    'name', 'description', 'obligation', 'source_rows',
    'destination_rows', 'premises', 'expected',
}
EXPECTED_KEYS = {'cohort_state', 'record_states', 'expected_total'}


def load_conformance_cases(directory=CONFORMANCE):
    paths = sorted(Path(directory).glob('*.json'))
    if not paths:
        raise ValueError(f'no conformance cases found in {directory}')
    cases = []
    seen = set()
    for path in paths:
        case = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(case, dict) or set(case) != CONFORMANCE_KEYS:
            raise ValueError(f'{path.name}: must contain exactly {sorted(CONFORMANCE_KEYS)}')
        if not isinstance(case['expected'], dict) or set(case['expected']) != EXPECTED_KEYS:
            raise ValueError(f'{path.name}: expected must contain {sorted(EXPECTED_KEYS)}')
        if not isinstance(case['name'], str) or not case['name'].strip() or case['name'] in seen:
            raise ValueError(f'{path.name}: missing or duplicate case name')
        seen.add(case['name'])
        cases.append(case)
    return cases


def _conformance_params(directory=CONFORMANCE):
    try:
        return [pytest.param(c, id=c['name']) for c in load_conformance_cases(directory)]
    except ValueError as exc:
        return [pytest.param(exc, id='empty-or-invalid-conformance')]


@pytest.mark.parametrize('case', _conformance_params())
def test_conformance_case(case):
    if isinstance(case, Exception):
        pytest.fail(str(case))
    result = evaluator_v2.evaluate(
        case['obligation'],
        case['source_rows'],
        case['destination_rows'],
        **case['premises'],
    )
    actual = {
        'cohort_state': result['cohort_state'],
        'record_states': [r['state'] for r in result['records']],
        'expected_total': result['expected_total'],
    }
    assert actual == case['expected']


def test_conformance_loader_fails_on_empty_or_invalid_folder(tmp_path):
    with pytest.raises(ValueError, match='no conformance cases'):
        load_conformance_cases(tmp_path)
    params = _conformance_params(tmp_path)
    assert len(params) == 1 and isinstance(params[0].values[0], ValueError)

    bad = tmp_path / 'bad.json'
    bad.write_text('{"name": "only-name"}', encoding='utf-8')
    with pytest.raises(ValueError, match='must contain exactly'):
        load_conformance_cases(tmp_path)

    valid = json.loads((CONFORMANCE / 'no-rows.json').read_text(encoding='utf-8'))
    bad.write_text(json.dumps({**valid, 'expected': {'cohort_state': 'Unverified'}}), encoding='utf-8')
    with pytest.raises(ValueError, match='expected must contain'):
        load_conformance_cases(tmp_path)

    bad.write_text(json.dumps(valid), encoding='utf-8')
    (tmp_path / 'dup.json').write_text(json.dumps(valid), encoding='utf-8')
    with pytest.raises(ValueError, match='duplicate case name'):
        load_conformance_cases(tmp_path)


@pytest.mark.parametrize('conformance_name,fixture_name', [
    ('v1-a-verified', 'A-verified'),
    ('v1-b-mismatch', 'B-mismatch'),
    ('v1-e-row-verified-cohort-unverified', 'E-row-verified-cohort-unverified'),
])
def test_conformance_includes_shared_v1_cases(conformance_name, fixture_name):
    conformance = json.loads((CONFORMANCE / f'{conformance_name}.json').read_text(encoding='utf-8'))
    fixture = json.loads((ROOT / 'service/fixtures' / f'{fixture_name}.json').read_text(encoding='utf-8'))
    evidence, frozen = fixture['input_evidence'], fixture['proposed_response']['result']
    dest_rows = [r for page in evidence['destination']['pages'] for r in page['rows']]
    assert conformance['source_rows'] == evidence['source']['rows']
    assert conformance['destination_rows'] == dest_rows
    assert conformance['expected'] == {
        'cohort_state': frozen['cohort_state'],
        'record_states': [r['state'] for r in frozen['records']],
        'expected_total': frozen['expected_total'],
    }


def test_mapping_file_may_start_with_a_byte_order_mark(tmp_path, capsys):
    mapping = tmp_path / 'm.json'
    mapping.write_bytes('\ufeff{"key": ["k", "k"], "fields": [["p", "p"]]}'.encode('utf-8'))
    code = verify.main(['--source', write(tmp_path / 's.csv', 'k,p\n1,x\n'), '--destination', write(tmp_path / 'd.csv', 'p,k\nx,1\n'),
                        '--mapping', str(mapping), '--source-complete', '--destination-complete'])
    assert code == 0


# --- v0.2.0: reading once, memory and --details -------------------------------------------------

FIXTURES = Path(__file__).resolve().parent / 'fixtures'
# Members a v0.2.0 report adds to the v0.1.1 shape without any option.
NEW_REPORT_MEMBERS = ('evaluated_at', 'schema_version', 'details', 'premises')
V010_EXAMPLE = ['--source', 'offline/examples/source.csv', '--destination', 'offline/examples/destination.csv',
                '--key', 'external_id', '--field', 'phone', '--field', 'email:hs_email',
                '--source-complete', '--destination-complete']
V010_SUMMARY = """\
Mismatch: 4 rows of 4
Verified 1 · Mismatch 3 · Unverified 0
  record 2 SYN-002: Mismatch
    field:phone fail: exact string comparison ('+1 212 555 0102' vs '+1 212 555 0199')
  record 3 SYN-003: Mismatch
    existence fail: key not found in stated complete destination
    uniqueness unknown: insufficient evidence
    field:phone unknown: insufficient evidence
    field:email unknown: insufficient evidence
  record 4 SYN-004: Mismatch
    uniqueness fail: more than one destination row carries this key
    field:phone unknown: no arbitrary candidate selected
    field:email unknown: no arbitrary candidate selected
Files and completeness statements are not authenticated. Not assessed: whether a workflow ran, \
whether the source is true, whether a record existed by a past deadline.
"""


def check(tmp_path, capsys, source, destination, *args):
    """Run the check on two CSV texts. Return the exit status, stdout, stderr and the JSON report."""
    out = tmp_path / 'report.json'
    if out.exists():
        out.unlink()
    (tmp_path / 's.csv').write_bytes(source.encode('utf-8'))
    (tmp_path / 'd.csv').write_bytes(destination.encode('utf-8'))
    code = verify.main(['--source', str(tmp_path / 's.csv'), '--destination', str(tmp_path / 'd.csv'),
                        *args, '--json', str(out)])
    printed = capsys.readouterr()
    return code, printed.out, printed.err, json.loads(out.read_text()) if out.exists() else None


def test_v010_example_command_prints_the_same_summary_and_exits_1():
    result = subprocess.run([sys.executable, 'offline/verify.py', *V010_EXAMPLE], cwd=str(ROOT),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
    assert result.returncode == 1
    assert result.stdout.decode('utf-8') == V010_SUMMARY and result.stderr == b''


def test_details_all_report_is_the_v011_report(tmp_path, capsys):
    out = tmp_path / 'report.json'
    assert verify.main(cli('--source-complete', '--destination-complete', '--details', 'all', '--json', str(out))) == 1
    report = json.loads(out.read_text())
    expected = json.loads((FIXTURES / 'offline-v0.1.1-example-report.json').read_text())
    for name in NEW_REPORT_MEMBERS:
        report.pop(name, None)
        expected.pop(name, None)
    assert report == expected


def test_details_problems_shortens_only_verified_records(tmp_path, capsys):
    out = tmp_path / 'report.json'
    assert verify.main(cli('--source-complete', '--destination-complete', '--json', str(out))) == 1
    report = json.loads(out.read_text())
    full = json.loads((FIXTURES / 'offline-v0.1.1-example-report.json').read_text())
    assert report['details'] == 'problems'
    assert report['records'][0] == {'key': 'SYN-001', 'source_row': 0, 'state': 'Verified'}
    assert report['records'][1:] == full['records'][1:]
    assert report['counts'] == full['counts'] and report['cohort_state'] == full['cohort_state']


def test_details_do_not_change_the_verdict_or_the_summary(tmp_path, capsys):
    printed = []
    for details in ('problems', 'all'):
        printed.append((verify.main(cli('--source-complete', '--destination-complete', '--details', details)),
                        capsys.readouterr().out))
    assert printed[0] == printed[1] == (1, V010_SUMMARY)


@pytest.mark.parametrize('value', ['', 'none', 'ALL', 'problem', 'full'])
def test_unknown_details_value_is_refused(tmp_path, capsys, value):
    out = tmp_path / 'unused.json'
    assert verify.main(cli('--details', value, '--json', str(out))) == 2
    assert '--details must be one of: problems, all' in capsys.readouterr().err and not out.exists()


@pytest.mark.parametrize('source', ['k,p\n', 'k,p\n1,x\n2,y\n'])
def test_json_report_text_is_what_json_dump_would_write(tmp_path, capsys, source):
    code, _, _, report = check(tmp_path, capsys, source, 'p,k\nx,1\n', '--key', 'k', '--field', 'p',
                               '--source-complete', '--destination-complete', '--details', 'all')
    ordered = {'schema_version': report['schema_version']} if 'schema_version' in report else {}
    ordered.update(json.loads(json.dumps({k: v for k, v in report.items() if k != 'schema_version'}, sort_keys=True)))
    assert (tmp_path / 'report.json').read_text() == json.dumps(ordered, indent=2)


class Row(dict):
    """A row that can be watched with a weak reference."""


def test_evaluator_reads_each_row_once_and_keeps_none_of_them():
    watched = []

    def rows(items):
        for item in items:
            row = Row(item)
            watched.append(weakref.ref(row))
            yield row

    result = evaluator_v2.evaluate(KEY, rows([ROW, {'key': 'K2', 'phone': '2'}]),
                                   rows([ROW, {'key': 'K2', 'phone': '3'}, {'key': 'K3', 'phone': '4'}]), **COMPLETE)
    gc.collect()
    assert len(watched) == 5 and all(ref() is None for ref in watched)
    assert states(result) == ('Mismatch', ['Verified', 'Mismatch'])
    assert result['records'][1]['rules']['field:phone'] == {
        'status': 'fail', 'reason': 'exact string comparison', 'expected': '2', 'actual': '3'}


def test_csv_rows_keep_only_the_columns_the_check_uses(tmp_path):
    path = tmp_path / 'f.csv'
    path.write_bytes(b'a,k,b,p\n1,K1,2,x\n\n3,K2,4,y\n')
    rows = verify.CsvFile(str(path), ['k', 'p', 'k'])
    assert list(rows) == [{'k': 'K1', 'p': 'x'}, {'k': 'K2', 'p': 'y'}]
    assert rows.rows == 2 and rows.sha256 == hashlib.sha256(path.read_bytes()).hexdigest()


def test_records_are_a_read_only_sequence_built_on_demand():
    result = run([ROW, {'key': 'K2', 'phone': '2'}], [ROW], **COMPLETE)
    records = result['records']
    assert len(records) == 2 and records[-1]['key'] == 'K2' and records[0]['state'] == 'Verified'
    with pytest.raises(IndexError):
        records[2]
    records[1]['key'] = 'changed'
    assert records[1]['key'] == 'K2'
    assert [r['key'] for r in records.problems()] == ['K2']


def test_evaluator_details_problems_and_refusal():
    result = evaluator_v2.evaluate(KEY, [ROW], [ROW], details='problems', **COMPLETE)
    assert list(result['records']) == [{'key': 'K1', 'source_row': 0, 'state': 'Verified'}]
    with pytest.raises(ValueError):
        evaluator_v2.evaluate(KEY, [ROW], [ROW], details='some')


def test_large_files_are_checked_in_one_pass(tmp_path, capsys):
    n = 20000
    source = 'k,p,q\n' + ''.join(f'K{i},{i},q{i}\n' for i in range(n))
    destination = 'q,k,p\n' + ''.join(f'q{i},K{i},{i if i % 5000 else "x"}\n' for i in range(n))
    code, out, _, report = check(tmp_path, capsys, source, destination, '--key', 'k', '--field', 'p', '--field', 'q',
                                 '--source-complete', '--destination-complete')
    assert code == 1 and report['counts'] == {'Verified': n - 4, 'Mismatch': 4, 'Pending': 0, 'Unverified': 0}
    assert [r['source_row'] for r in report['records'] if r['state'] != 'Verified'] == [0, 5000, 10000, 15000]
    assert out.startswith(f'Mismatch: {n} rows of {n}\n')


# --- v0.2.0: file encodings --------------------------------------------------------------------

ENCODED_SOURCE = 'k,p\nK1,名字 Zoë\n'
ENCODED_DESTINATION = 'p,k\n名字 Zoë,K1\n'


def check_bytes(tmp_path, capsys, source, destination, *args):
    (tmp_path / 's.csv').write_bytes(source)
    (tmp_path / 'd.csv').write_bytes(destination)
    out = tmp_path / 'report.json'
    code = verify.main(['--source', str(tmp_path / 's.csv'), '--destination', str(tmp_path / 'd.csv'),
                        '--key', 'k', '--field', 'p', '--source-complete', '--destination-complete',
                        *args, '--json', str(out)])
    printed = capsys.readouterr()
    return code, printed.err, json.loads(out.read_text()) if out.exists() else None


ENCODERS = {
    'utf-8': lambda text: text.encode('utf-8'),
    'utf-8 with BOM': lambda text: codecs.BOM_UTF8 + text.encode('utf-8'),
    'utf-16': lambda text: text.encode('utf-16'),
    'utf-16 little-endian': lambda text: codecs.BOM_UTF16_LE + text.encode('utf-16-le'),
    'utf-16 big-endian': lambda text: codecs.BOM_UTF16_BE + text.encode('utf-16-be'),
    'gb18030': lambda text: text.encode('gb18030'),
}


@pytest.mark.parametrize('form', sorted(ENCODERS))
@pytest.mark.parametrize('side', ['source', 'destination'])
def test_each_encoding_is_read_and_recorded(tmp_path, capsys, form, side):
    encoding = form.split()[0]
    if side == 'source':
        data = ENCODERS[form](ENCODED_SOURCE)
        files = (data, ENCODED_DESTINATION.encode('utf-8'))
    else:
        data = ENCODERS[form](ENCODED_DESTINATION)
        files = (ENCODED_SOURCE.encode('utf-8'), data)
    code, err, report = check_bytes(tmp_path, capsys, *files, f'--{side}-encoding', encoding)
    assert (code, err) == (0, '')
    expected = {'source_encoding': 'utf-8', 'destination_encoding': 'utf-8', f'{side}_encoding': encoding}
    assert {k: report['inputs'][k] for k in expected} == expected
    assert report['inputs'][f'{side}_sha256'] == hashlib.sha256(data).hexdigest()


def test_both_files_may_use_different_encodings(tmp_path, capsys):
    code, _, report = check_bytes(tmp_path, capsys, ENCODED_SOURCE.encode('gb18030'),
                                  ENCODED_DESTINATION.encode('utf-16'),
                                  '--source-encoding', 'gb18030', '--destination-encoding', 'utf-16')
    assert code == 0
    assert (report['inputs']['source_encoding'], report['inputs']['destination_encoding']) == ('gb18030', 'utf-16')


def test_encodings_are_not_recorded_without_the_options(tmp_path, capsys):
    code, _, report = check_bytes(tmp_path, capsys, ENCODED_SOURCE.encode('utf-8'), ENCODED_DESTINATION.encode('utf-8'))
    assert code == 0 and 'source_encoding' not in report['inputs'] and 'destination_encoding' not in report['inputs']


@pytest.mark.parametrize('encoding,data,label', [
    ('utf-8', b'k,p\nK1,\xff\n', 'not UTF-8'),
    ('utf-8', ENCODED_SOURCE.encode('gb18030'), 'not UTF-8'),
    ('utf-16', 'k,p\nK1,x\n'.encode('utf-16-le'), 'not UTF-16 (no byte order mark)'),
    ('utf-16', 'k,p\nK1,x\n'.encode('utf-16') + b'\x00', 'not UTF-16'),
    ('utf-16', codecs.BOM_UTF16_LE + b'k\x00,\x00p\x00\n\x00K\x001\x00,\x00\x00\xd8\n\x00', 'not UTF-16'),
    ('gb18030', b'k,p\nK1,\xff\n', 'not GB18030'),
])
@pytest.mark.parametrize('side', ['source', 'destination'])
def test_a_decoding_error_is_refused_naming_file_and_encoding(tmp_path, capsys, encoding, data, label, side):
    other = (ENCODED_DESTINATION if side == 'source' else ENCODED_SOURCE).encode('utf-8')
    files = (data, other) if side == 'source' else (other, data)
    code, err, report = check_bytes(tmp_path, capsys, *files, f'--{side}-encoding', encoding)
    assert code == 2 and report is None
    assert err.startswith('refused:') and str(tmp_path / ('s.csv' if side == 'source' else 'd.csv')) in err
    assert label in err


@pytest.mark.parametrize('option', ['--source-encoding', '--destination-encoding'])
@pytest.mark.parametrize('name', ['latin-1', 'UTF-8', 'utf8', 'utf-8-sig', 'utf-16-le', 'gbk', 'GB18030', ''])
def test_an_unsupported_encoding_is_refused(tmp_path, capsys, option, name):
    code, err = refused(tmp_path, capsys, 'k,p\n1,x\n', args=('--key', 'k', '--field', 'p', option, name))
    assert code == 2 and f'{option} must be one of: utf-8, utf-16, gb18030' in err


# --- v0.2.0: stated premises in the report ------------------------------------------------------

def test_report_lists_each_stated_premise_with_its_origin(tmp_path, capsys):
    out = tmp_path / 'report.json'
    assert verify.main(cli('--source-complete', '--json', str(out))) == 1
    premises = json.loads(out.read_text())['premises']
    assert premises['source_complete'] == {'stated': True, 'origin': 'command-line option'}
    assert premises['destination_complete'] == {'stated': False, 'origin': 'command-line option'}
    assert 'allow_identical_content' not in premises


def test_allowing_identical_content_is_a_stated_premise(tmp_path, capsys):
    code, _, _, report = check(tmp_path, capsys, 'k,p\n1,x\n', 'k,p\n1,x\n', '--key', 'k', '--field', 'p',
                               '--source-complete', '--destination-complete', '--allow-identical-content')
    assert code == 0
    assert report['premises']['allow_identical_content'] == {'stated': True, 'origin': 'command-line option'}


def test_verified_claim_names_the_stated_premises(tmp_path, capsys):
    code, _, _, report = check(tmp_path, capsys, 'k,p\n1,x\n', 'p,k\nx,1\n', '--key', 'k', '--field', 'p',
                               '--source-complete', '--destination-complete')
    assert code == 0 and report['claim'] == (
        'At this evaluation, under the stated premises, the supplied destination rows satisfy the rules '
        'for the supplied source rows.')


def test_report_keeps_every_v011_inputs_member(tmp_path, capsys):
    out = tmp_path / 'report.json'
    assert verify.main(cli('--source-complete', '--destination-complete', '--json', str(out))) == 1
    expected = json.loads((FIXTURES / 'offline-v0.1.1-example-report.json').read_text())['inputs']
    inputs = json.loads(out.read_text())['inputs']
    assert {k: inputs[k] for k in expected} == expected


def test_evaluator_reports_its_premises():
    result = evaluator_v2.evaluate(KEY, [ROW], [ROW], source_complete='yes', destination_complete=True)
    assert result['premises']['source_complete'] == {'stated': False}
    assert result['premises']['destination_complete'] == {'stated': True}


# --- v0.2.0: count cross-check -----------------------------------------------------------------

COUNTED = ('k,p\n1,a\n2,b\n3,c\n', 'p,k\na,1\nb,2\nc,3\n')
COUNTED_ARGS = ('--key', 'k', '--field', 'p', '--source-complete', '--destination-complete')


@pytest.mark.parametrize('stated', ['3', '2', '4', '0'])
def test_source_count(tmp_path, capsys, stated):
    code, out, _, report = check(tmp_path, capsys, *COUNTED, *COUNTED_ARGS, '--source-count', stated)
    matched = stated == '3'
    assert report['premises']['source_count'] == {'stated': int(stated), 'observed': 3, 'matched': matched,
                                                  'origin': 'command-line option'}
    assert [r['state'] for r in report['records']] == ['Verified'] * 3
    line = f'Source count stated {stated}, file has 3 rows: the batch cannot be Verified.'
    if matched:
        assert code == 0 and report['cohort_state'] == 'Verified' and report['expected_total'] == 3
        assert 'count stated' not in out
    else:
        assert code == 3 and report['cohort_state'] == 'Unverified' and report['claim'] is None
        assert report['expected_total'] is None and report['source_population_known'] is False
        assert line in out.splitlines() and 'Source population unknown' in out


@pytest.mark.parametrize('stated', ['3', '2', '4', '0'])
def test_destination_count(tmp_path, capsys, stated):
    code, out, _, report = check(tmp_path, capsys, *COUNTED, *COUNTED_ARGS, '--destination-count', stated)
    matched = stated == '3'
    assert report['premises']['destination_count'] == {'stated': int(stated), 'observed': 3, 'matched': matched,
                                                       'origin': 'command-line option'}
    line = f'Destination count stated {stated}, file has 3 rows: absence and uniqueness stay unknown.'
    if matched:
        assert code == 0 and report['destination_coverage_sufficient'] is True and 'count stated' not in out
    else:
        assert code == 3 and report['cohort_state'] == 'Unverified'
        assert report['destination_coverage_sufficient'] is False and report['expected_total'] == 3
        assert [r['state'] for r in report['records']] == ['Unverified'] * 3
        assert line in out.splitlines()


def test_zero_counts_match_files_without_rows(tmp_path, capsys):
    code, out, _, report = check(tmp_path, capsys, 'k,p\n', 'p,k\n', *COUNTED_ARGS,
                                 '--source-count', '0', '--destination-count', '0')
    assert code == 3 and report['cohort_state'] == 'Unverified' and 'count stated' not in out
    assert report['premises']['source_count']['matched'] is True
    assert report['premises']['destination_count']['matched'] is True


def test_premises_without_counts_record_the_rows_read(tmp_path, capsys):
    code, out, _, report = check(tmp_path, capsys, *COUNTED, '--key', 'k', '--field', 'p')
    assert set(report['premises']) == {'source_complete', 'destination_complete', 'source_count', 'destination_count'}
    assert report['premises']['source_count'] == {'stated': None, 'observed': 3, 'matched': None,
                                                  'origin': 'command-line option'}


@pytest.mark.parametrize('option', ['--source-count', '--destination-count'])
@pytest.mark.parametrize('value', ['abc', '1.5', '-1', '', ' 3', '3 ', '٣', '1e3', '0x3'])
def test_a_count_that_is_not_a_non_negative_integer_is_refused(tmp_path, capsys, option, value):
    code, err = refused(tmp_path, capsys, 'k,p\n1,x\n', args=('--key', 'k', '--field', 'p', option, value))
    assert code == 2 and f'{option} must be a non-negative integer' in err


def test_matching_counts_do_not_replace_completeness_statements(tmp_path, capsys):
    code, out, _, report = check(tmp_path, capsys, *COUNTED, '--key', 'k', '--field', 'p',
                                 '--source-count', '3', '--destination-count', '3')
    assert code == 3 and report['expected_total'] is None and report['destination_coverage_sufficient'] is False
    assert [r['state'] for r in report['records']] == ['Unverified'] * 3


def test_a_count_mismatch_does_not_hide_a_field_that_differs(tmp_path, capsys):
    code, _, _, report = check(tmp_path, capsys, 'k,p\n1,a\n2,b\n', 'p,k\na,1\nx,2\n', *COUNTED_ARGS,
                               '--source-count', '5', '--destination-count', '5')
    assert code == 1 and report['cohort_state'] == 'Mismatch' and report['expected_total'] is None


def test_a_destination_count_mismatch_leaves_a_missing_key_unknown(tmp_path, capsys):
    code, _, _, report = check(tmp_path, capsys, *COUNTED, *COUNTED_ARGS)
    assert code == 0
    code, _, _, report = check(tmp_path, capsys, 'k,p\n1,a\n2,b\n3,c\n', 'p,k\na,1\nb,2\n', *COUNTED_ARGS,
                               '--destination-count', '3')
    assert code == 3 and [r['state'] for r in report['records']] == ['Unverified'] * 3
    assert report['records'][2]['rules']['existence'] == {
        'status': 'unknown', 'reason': 'destination row count differs from the stated count; absence not established'}


def test_without_destination_complete_a_count_mismatch_is_not_named_as_the_reason(tmp_path, capsys):
    code, _, _, report = check(tmp_path, capsys, 'k,p\n1,a\n2,b\n', 'p,k\na,1\n', '--key', 'k', '--field', 'p',
                               '--source-complete', '--destination-count', '2')
    assert code == 3 and report['records'][1]['rules']['existence'] == {
        'status': 'unknown', 'reason': 'destination not stated complete; absence not established'}


def test_the_destination_count_includes_rows_without_a_key(tmp_path, capsys):
    code, _, _, report = check(tmp_path, capsys, 'k,p\n1,a\n', 'p,k\na,1\nb,\n', *COUNTED_ARGS,
                               '--destination-count', '2')
    assert code == 3 and report['premises']['destination_count']['matched'] is True
    assert report['destination_rows_without_key'] == 1


def test_evaluator_counts_rows_and_refuses_a_bad_count():
    result = evaluator_v2.evaluate(KEY, [ROW], [ROW], source_count=1, destination_count=2, **COMPLETE)
    assert result['premises']['source_count'] == {'stated': 1, 'observed': 1, 'matched': True}
    assert result['premises']['destination_count'] == {'stated': 2, 'observed': 1, 'matched': False}
    assert states(result) == ('Unverified', ['Unverified'])
    for bad in (-1, True, 1.0, '1'):
        with pytest.raises(ValueError):
            evaluator_v2.evaluate(KEY, [ROW], [ROW], source_count=bad)


# --- v0.2.0: --scope exact ---------------------------------------------------------------------

SCOPED = ('k,p\n1,a\n2,b\n', 'p,k\na,1\nb,2\nz,9\nz,9\ny,8\n')
ONLY_REASON_COVERED = 'key not in the source, and destination coverage is sufficient'
ONLY_REASON_OPEN = 'key not in the source; destination coverage not established, so no conclusion'


def test_exact_scope_with_coverage_makes_destination_only_records_a_mismatch(tmp_path, capsys):
    code, out, _, report = check(tmp_path, capsys, *SCOPED, *COUNTED_ARGS, '--scope', 'exact')
    assert code == 1 and report['cohort_state'] == 'Mismatch'
    assert [r['state'] for r in report['records']] == ['Verified', 'Verified']
    assert report['counts']['Mismatch'] == 0 and report['obligation']['scope'] == 'exact'
    assert report['destination_only'] == [
        {'key': '9', 'destination_row': 2, 'rows': 2, 'state': 'Mismatch', 'reason': ONLY_REASON_COVERED},
        {'key': '8', 'destination_row': 4, 'rows': 1, 'state': 'Mismatch', 'reason': ONLY_REASON_COVERED}]
    assert report['destination_only_counts'] == {'Verified': 0, 'Mismatch': 2, 'Pending': 0, 'Unverified': 0}
    assert 'Destination-only: 2 records not in the source, each a Mismatch.' in out.splitlines()


def test_exact_scope_without_coverage_lists_destination_only_records_without_a_conclusion(tmp_path, capsys):
    code_source, _, _, source_scope = check(tmp_path, capsys, *SCOPED, '--key', 'k', '--field', 'p', '--source-complete')
    code, out, _, report = check(tmp_path, capsys, *SCOPED, '--key', 'k', '--field', 'p', '--source-complete',
                                 '--scope', 'exact')
    assert code == code_source == 3 and report['cohort_state'] == source_scope['cohort_state'] == 'Unverified'
    assert report['counts'] == source_scope['counts']
    assert [(r['key'], r['state'], r['reason']) for r in report['destination_only']] == [
        ('9', 'Unverified', ONLY_REASON_OPEN), ('8', 'Unverified', ONLY_REASON_OPEN)]
    assert report['destination_only_counts']['Unverified'] == 2
    assert 'Destination-only: 2 records not in the source, listed without a conclusion.' in out.splitlines()


def test_exact_scope_never_counts_rows_without_a_key(tmp_path, capsys):
    code, out, _, report = check(tmp_path, capsys, 'k,p\n1,a\n', 'p,k\na,1\nz,\nw, \n', *COUNTED_ARGS,
                                 '--scope', 'exact')
    assert code == 3 and report['destination_only'] == [] and report['destination_rows_without_key'] == 2
    assert report['destination_coverage_sufficient'] is False
    assert 'Destination-only: 0 records not in the source.' in out.splitlines()
    code, out, _, report = check(tmp_path, capsys, 'k,p\n1,a\n', 'p,k\na,1\nz,\ny,8\n', *COUNTED_ARGS,
                                 '--scope', 'exact')
    assert code == 3 and [(r['key'], r['state']) for r in report['destination_only']] == [('8', 'Unverified')]


def test_exact_scope_with_no_destination_only_record_can_verify(tmp_path, capsys):
    code, out, _, report = check(tmp_path, capsys, *COUNTED, *COUNTED_ARGS, '--scope', 'exact')
    assert code == 0 and report['cohort_state'] == 'Verified' and report['destination_only'] == []
    assert 'Destination-only: 0 records not in the source.' in out.splitlines()


def test_exact_scope_with_a_destination_count_mismatch_draws_no_conclusion(tmp_path, capsys):
    code, _, _, report = check(tmp_path, capsys, *SCOPED, *COUNTED_ARGS, '--scope', 'exact',
                               '--destination-count', '4')
    assert code == 3 and {r['state'] for r in report['destination_only']} == {'Unverified'}


def test_a_key_repeated_in_the_source_is_not_destination_only(tmp_path, capsys):
    code, _, _, report = check(tmp_path, capsys, 'k,p\n1,a\n1,a\n', 'p,k\na,1\n', *COUNTED_ARGS, '--scope', 'exact')
    assert code == 3 and report['destination_only'] == []


def test_source_scope_is_the_default_and_reports_no_destination_only_records(tmp_path, capsys):
    code_default, out_default, _, default = check(tmp_path, capsys, *SCOPED, *COUNTED_ARGS)
    code, out, _, report = check(tmp_path, capsys, *SCOPED, *COUNTED_ARGS, '--scope', 'source')
    assert code == code_default == 0 and out == out_default and 'Destination-only' not in out
    assert 'destination_only' not in report and 'destination_only_counts' not in report
    assert report['obligation']['scope'] == 'source' and 'scope' not in default['obligation']


@pytest.mark.parametrize('value', ['both', 'EXACT', 'Source', ''])
def test_an_unknown_scope_is_refused(tmp_path, capsys, value):
    code, err = refused(tmp_path, capsys, 'k,p\n1,x\n', args=('--key', 'k', '--field', 'p', '--scope', value))
    assert code == 2 and '--scope must be one of: source, exact' in err


def test_redaction_hides_destination_only_keys(tmp_path, capsys):
    code, out, _, report = check(tmp_path, capsys, *SCOPED, *COUNTED_ARGS, '--scope', 'exact', '--redact-values')
    assert code == 1 and [r['key'] for r in report['destination_only']] == ['[redacted]', '[redacted]']
    assert '"9"' not in (tmp_path / 'report.json').read_text()


def test_evaluator_scope():
    exact = dict(KEY, scope='exact')
    result = evaluator_v2.evaluate(exact, [ROW], [ROW, {'key': 'K2', 'phone': '1'}], **COMPLETE)
    assert states(result) == ('Mismatch', ['Verified']) and len(result['records']) == 1
    assert [r['key'] for r in result['destination_only']] == ['K2']
    assert 'destination_only' not in evaluator_v2.evaluate(KEY, [ROW], [ROW], **COMPLETE)
    with pytest.raises(ValueError):
        evaluator_v2.evaluate(dict(KEY, scope='both'), [ROW], [ROW])


# --- v0.2.0: explicit comparison rules ---------------------------------------------------------

def rule_result(rule, expected, actual):
    obligation = {'key': ('key', 'key'), 'fields': [('phone', 'phone', rule)]}
    result = evaluator_v2.evaluate(obligation, [{'key': 'K1', 'phone': expected}], [{'key': 'K1', 'phone': actual}],
                                   **COMPLETE)
    return result['records'][0]['rules']['field:phone'], result['cohort_state']


COHORT_FOR = {'pass': 'Verified', 'fail': 'Mismatch', 'unknown': 'Unverified'}


@pytest.mark.parametrize('rule,expected,actual,status,normalized', [
    ('trim', ' a\t', 'a', 'pass', ('a', 'a')),
    ('trim', 'a b', 'a  b', 'fail', ('a b', 'a  b')),
    ('trim', 'a', 'b ', 'fail', ('a', 'b')),
    ('trim', '  ', 'a', 'unknown', ('', 'a')),
    ('casefold', 'Straße', 'STRASSE', 'pass', ('strasse', 'strasse')),
    ('casefold', 'Ada@Example.test', 'ada@example.test', 'pass', ('ada@example.test', 'ada@example.test')),
    ('casefold', 'a@x', 'b@x', 'fail', ('a@x', 'b@x')),
    ('casefold', ' a', 'A', 'fail', (' a', 'a')),
    ('digits', '+1 (212) 555-0101', '12125550101', 'pass', ('12125550101', '12125550101')),
    ('digits', '555 0102', '5550199', 'fail', ('5550102', '5550199')),
    ('digits', 'n/a', '12', 'unknown', ('', '12')),
    ('digits', '12', 'none', 'unknown', ('12', '')),
    ('digits', '٣', '3', 'unknown', ('', '3')),
    ('date:%Y-%m-%d', '2026-01-02', '2026-01-02', 'pass', ('2026-01-02T00:00:00', '2026-01-02T00:00:00')),
    ('date:%Y-%m-%d', '2026-01-02', '2026-1-2', 'pass', ('2026-01-02T00:00:00', '2026-01-02T00:00:00')),
    ('date:%Y-%m-%d', '2026-01-02', '2026-01-03', 'fail', ('2026-01-02T00:00:00', '2026-01-03T00:00:00')),
    ('date:%Y-%m-%d', '2026-01-02', '02/01/2026', 'unknown', ('2026-01-02T00:00:00', None)),
    ('date:%Y-%m-%d', '2026-02-30', '2026-02-30', 'unknown', (None, None)),
    ('date:%d/%m/%Y %H:%M', '02/01/2026 10:00', '2/1/2026 10:00', 'pass',
     ('2026-01-02T10:00:00', '2026-01-02T10:00:00')),
    ('date:%d/%m/%Y %H:%M', '02/01/2026 10:00', '02/01/2026 11:00', 'fail',
     ('2026-01-02T10:00:00', '2026-01-02T11:00:00')),
])
def test_each_rule_passes_fails_or_stays_unknown(rule, expected, actual, status, normalized):
    result, cohort = rule_result(rule, expected, actual)
    assert result['status'] == status and cohort == COHORT_FOR[status]
    assert result['rule'] == rule and (result['expected'], result['actual']) == (expected, actual)
    assert (result['expected_normalized'], result['actual_normalized']) == normalized


@pytest.mark.parametrize('rule', ['exact', 'trim', 'casefold', 'digits', 'date:%Y-%m-%d'])
@pytest.mark.parametrize('expected,actual', [('', '1'), ('1', ''), ('', '')])
def test_an_empty_value_stays_unknown_under_every_rule(rule, expected, actual):
    result, cohort = rule_result(rule, expected, actual)
    assert result['status'] == 'unknown' and cohort == 'Unverified'
    assert result['reason'] == 'empty value; a missing value is not assumed to be a difference'


def test_exact_rule_results_keep_the_v011_shape():
    explicit, _ = rule_result('exact', '1', '2')
    pairs = run([ROW], [{'key': 'K1', 'phone': '2'}], **COMPLETE)['records'][0]['rules']['field:phone']
    assert explicit == pairs == {'status': 'fail', 'reason': 'exact string comparison', 'expected': '1', 'actual': '2'}


def test_a_rule_is_recorded_on_a_field_that_could_not_be_compared():
    obligation = {'key': ('key', 'key'), 'fields': [('phone', 'phone', 'digits')]}
    result = evaluator_v2.evaluate(obligation, [ROW], [ROW, ROW], **COMPLETE)
    assert result['records'][0]['rules']['field:phone'] == {
        'status': 'unknown', 'reason': 'no arbitrary candidate selected', 'rule': 'digits'}


@pytest.mark.parametrize('rule', ['exact', 'trim', 'casefold', 'digits', 'date:%Y-%m-%d', 'date:%d/%m/%Y %H:%M',
                                  'date:%Y-%m-%dT%H:%M:%S%z', 'date:%Y%m%d', 'date:%d %b %Y', 'date:%Y-%m-%d %%'])
def test_valid_rules_are_accepted(rule):
    assert evaluator_v2.parse_rule(rule) == rule


@pytest.mark.parametrize('rule,message', [
    ('', 'unknown comparison rule'), ('EXACT', 'unknown comparison rule'), ('Trim', 'unknown comparison rule'),
    ('digit', 'unknown comparison rule'), ('date', 'unknown comparison rule'), (None, 'unknown comparison rule'),
    (1, 'unknown comparison rule'), ('date:', 'has no format'), ('date:abc', 'has no directive'),
    ('date:%%', 'has no directive'), ('date:%q', 'malformed date format'), ('date:%Y-%', 'malformed date format'),
    ('date:%G', 'malformed date format'),
])
def test_an_unknown_or_malformed_rule_is_refused(rule, message):
    with pytest.raises(ValueError, match=message):
        evaluator_v2.parse_rule(rule)
    with pytest.raises(ValueError):
        evaluator_v2.evaluate({'key': ('key', 'key'), 'fields': [('phone', 'phone', rule)]}, [ROW], [ROW])


def test_redaction_removes_normalized_values_from_records():
    obligation = {'key': ('key', 'key'), 'fields': [('phone', 'phone', 'digits')]}
    result = evaluator_v2.evaluate(obligation, [{'key': 'K1', 'phone': '+1 555'}], [{'key': 'K1', 'phone': '1556'}],
                                   **COMPLETE)
    record = result['records'].redacted()[0]
    assert record['key'] == '[redacted]'
    assert record['rules']['field:phone'] == {'status': 'fail', 'reason': 'comparison of the digits 0-9 only',
                                              'rule': 'digits'}


# --- v0.2.0: configuration file ----------------------------------------------------------------

CONFIG_SOURCE = 'crm id,Contact: Phone,email\nA1,+1 (212) 555-0101,Ada@Example.test\nA2,+1 212 555 0102,g@x.test\n'
CONFIG_DESTINATION = 'Record ID,phone,hs_email\nA1,12125550101,ada@example.test\nA2,12125550199,G@X.TEST\n'
CONFIG = {'key': ['crm id', 'Record ID'], 'fields': [
    {'source': 'Contact: Phone', 'destination': 'phone', 'rule': 'digits'},
    {'source': 'email', 'destination': 'hs_email', 'rule': 'casefold'}]}


def config_file(tmp_path, content):
    path = tmp_path / 'config.json'
    path.write_bytes(content if isinstance(content, bytes) else json.dumps(content).encode('utf-8'))
    return str(path)


def test_config_file_sets_key_fields_and_rules(tmp_path, capsys):
    path = config_file(tmp_path, CONFIG)
    code, out, _, report = check(tmp_path, capsys, CONFIG_SOURCE, CONFIG_DESTINATION, '--config', path,
                                 '--source-complete', '--destination-complete', '--details', 'all')
    assert code == 1 and [r['state'] for r in report['records']] == ['Verified', 'Mismatch']
    assert report['obligation'] == {'type': 'current_state', 'key': ['crm id', 'Record ID'],
                                    'fields': [['Contact: Phone', 'phone'], ['email', 'hs_email']],
                                    'rules': ['digits', 'casefold'], 'comparison': 'per-field-rule'}
    assert report['inputs']['config_file_sha256'] == hashlib.sha256(Path(path).read_bytes()).hexdigest()
    assert 'mapping_file_sha256' not in report['inputs']
    assert report['records'][1]['rules']['field:email']['status'] == 'pass'
    assert ("    field:Contact: Phone fail: comparison of the digits 0-9 only ('+1 212 555 0102' vs '12125550199'), "
            "compared as ('12125550102' vs '12125550199')") in out.splitlines()


def test_mapping_file_still_means_exact(tmp_path, capsys):
    mapping = tmp_path / 'mapping.json'
    mapping.write_text(json.dumps({'key': ['crm id', 'Record ID'],
                                   'fields': [['Contact: Phone', 'phone'], ['email', 'hs_email']]}))
    code, _, _, report = check(tmp_path, capsys, CONFIG_SOURCE, CONFIG_DESTINATION, '--mapping', str(mapping),
                               '--source-complete', '--destination-complete')
    assert code == 1 and [r['state'] for r in report['records']] == ['Mismatch', 'Mismatch']
    assert report['obligation']['comparison'] == 'exact-string' and 'rules' not in report['obligation']


def test_a_config_rule_defaults_to_exact_and_scope_can_be_set(tmp_path, capsys):
    path = config_file(tmp_path, {'key': ['k', 'k'], 'fields': [{'source': 'p', 'destination': 'p'}],
                                  'scope': 'exact'})
    code, out, _, report = check(tmp_path, capsys, 'k,p\n1,a\n', 'p,k\na,1\nb,2\n', '--config', path,
                                 '--source-complete', '--destination-complete')
    assert code == 1 and report['obligation']['rules'] == ['exact']
    assert report['obligation']['comparison'] == 'exact-string' and report['obligation']['scope'] == 'exact'
    assert [r['key'] for r in report['destination_only']] == ['2']


def test_config_file_may_start_with_a_byte_order_mark(tmp_path, capsys):
    path = config_file(tmp_path, codecs.BOM_UTF8 + json.dumps(CONFIG).encode('utf-8'))
    code, _, _, report = check(tmp_path, capsys, CONFIG_SOURCE, CONFIG_DESTINATION, '--config', path)
    assert code == 1 and report['obligation']['rules'] == ['digits', 'casefold']


FIELD = {'source': 'p', 'destination': 'p'}


def config_with(**members):
    return json.dumps({'key': ['k', 'k'], 'fields': [FIELD], **members}).encode('utf-8')


def config_fields(*fields):
    return json.dumps({'key': ['k', 'k'], 'fields': list(fields)}).encode('utf-8')


@pytest.mark.parametrize('content,message', [
    (b'\xff', 'not UTF-8'),
    (b'{not json', 'invalid JSON'),
    (b'{"key": ["k", "k"], "key": ["k", "k"], "fields": [{"source": "p", "destination": "p"}]}', 'duplicate member'),
    (b'{"key": ["k", "k"], "fields": [{"source": "p", "source": "q", "destination": "p"}]}', 'duplicate member'),
    (b'[]', 'must be a JSON object'),
    (b'"key"', 'must be a JSON object'),
    (config_with(source_complete=True), 'source_complete cannot be set in a configuration file'),
    (config_with(destination_complete=True), 'destination_complete cannot be set in a configuration file'),
    (config_with(source_count=3), 'source_count cannot be set in a configuration file'),
    (config_with(destination_count=3), 'destination_count cannot be set in a configuration file'),
    (config_with(allow_identical_content=True), 'allow_identical_content cannot be set in a configuration file'),
    (config_with(**{'source-complete': True}), 'cannot be set in a configuration file'),
    (config_with(Destination_Count=3), 'cannot be set in a configuration file'),
    (config_with(extra=1), 'unknown member extra'),
    (config_with(rules={'p': 'trim'}), 'unknown member rules'),
    (config_with(details='all'), 'unknown member details'),
    (b'{"fields": [{"source": "p", "destination": "p"}]}', 'missing member key'),
    (b'{"key": ["k", "k"]}', 'missing member fields'),
    (b'{"key": "k", "fields": [{"source": "p", "destination": "p"}]}', 'key must be a two-item list of strings'),
    (b'{"key": ["k"], "fields": [{"source": "p", "destination": "p"}]}', 'key must be a two-item list of strings'),
    (b'{"key": [1, "k"], "fields": [{"source": "p", "destination": "p"}]}', 'key must be a two-item list of strings'),
    (b'{"key": ["", "k"], "fields": [{"source": "p", "destination": "p"}]}', 'empty column name in key'),
    (b'{"key": ["k", " "], "fields": [{"source": "p", "destination": "p"}]}', 'empty column name in key'),
    (b'{"key": ["k", "k"], "fields": "p"}', 'fields must be a non-empty list'),
    (b'{"key": ["k", "k"], "fields": []}', 'fields must be a non-empty list'),
    (config_fields(['p', 'p']), 'each field must be an object'),
    (config_fields({'source': 'p'}), 'missing member destination in field'),
    (config_fields({'destination': 'p'}), 'missing member source in field'),
    (config_fields(dict(FIELD, extra=1)), 'unknown member extra in field'),
    (config_fields({'source': 1, 'destination': 'p'}), 'field source must be a string'),
    (config_fields({'source': 'p', 'destination': None}), 'field destination must be a string'),
    (config_fields({'source': '', 'destination': 'p'}), 'empty column name in field'),
    (config_fields({'source': 'p', 'destination': '  '}), 'empty column name in field'),
    (config_fields(dict(FIELD, rule=1)), 'field rule must be a string'),
    (config_fields(dict(FIELD, rule=None)), 'field rule must be a string'),
    (config_fields(dict(FIELD, rule='fuzzy')), 'unknown comparison rule'),
    (config_fields(dict(FIELD, rule='Digits')), 'unknown comparison rule'),
    (config_fields(dict(FIELD, rule='date:')), 'has no format'),
    (config_fields(dict(FIELD, rule='date:%q')), 'malformed date format'),
    (config_fields(dict(FIELD, rule='date:abc')), 'has no directive'),
    (config_fields(FIELD, {'source': 'p', 'destination': 'q'}), 'a source field is repeated'),
    (config_with(scope='both'), 'scope must be one of: source, exact'),
    (config_with(scope=None), 'scope must be one of: source, exact'),
    (config_with(scope=['exact']), 'scope must be one of: source, exact'),
])
def test_malformed_config_file_is_refused(tmp_path, capsys, content, message):
    code, err = refused(tmp_path, capsys, 'k,p\n1,x\n', args=('--config', config_file(tmp_path, content)))
    assert code == 2 and err.startswith('refused:') and message in err


def test_missing_config_file_is_refused(tmp_path, capsys):
    code, err = refused(tmp_path, capsys, 'k,p\n1,x\n', args=('--config', str(tmp_path / 'absent.json')))
    assert code == 2 and err.startswith('refused:') and 'absent.json' in err


@pytest.mark.parametrize('extra,named', [
    (['--mapping', 'm.json'], '--mapping'), (['--key', 'k'], '--key'), (['--field', 'p'], '--field'),
    (['--scope', 'source'], '--scope'), (['--scope', 'exact'], '--scope'),
    (['--key', 'k', '--field', 'p', '--scope', 'exact'], '--key, --field, --scope'),
])
def test_config_cannot_be_combined_with_another_selection(tmp_path, capsys, extra, named):
    path = config_file(tmp_path, CONFIG)
    code, err = refused(tmp_path, capsys, 'k,p\n1,x\n', args=('--config', path, *extra))
    assert code == 2 and f'--config cannot be combined with {named}' in err


def test_redaction_removes_normalized_values_from_the_report(tmp_path, capsys):
    path = config_file(tmp_path, CONFIG)
    code, out, _, report = check(tmp_path, capsys, CONFIG_SOURCE, CONFIG_DESTINATION, '--config', path,
                                 '--source-complete', '--destination-complete', '--details', 'all', '--redact-values')
    text = (tmp_path / 'report.json').read_text()
    assert code == 1
    for value in ('A1', 'A2', '2125550101', '12125550199', '12125550102', 'ada@example', 'g@x', 'G@X'):
        assert value not in text and value not in out
    assert report['records'][1]['rules']['field:Contact: Phone'] == {
        'status': 'fail', 'reason': 'comparison of the digits 0-9 only', 'rule': 'digits'}


# --- v0.2.0: report format and HTML report -----------------------------------------------------

def test_json_report_starts_with_its_schema_version(tmp_path, capsys):
    out = tmp_path / 'report.json'
    assert verify.main(cli('--json', str(out))) == 1
    assert out.read_text().startswith('{\n  "schema_version": 1,\n')


HOSTILE_SOURCE = 'k,p\n<script>alert(1)</script>,"<img src=x onerror=alert(2)>"\nK2,b\n'
HOSTILE_DESTINATION = 'p,k\n"<b>bold</b>",<script>alert(1)</script>\nb,K2\nq,"<i>only</i>"\n'


def html_report(tmp_path, capsys, *args):
    (tmp_path / 's.csv').write_bytes(HOSTILE_SOURCE.encode('utf-8'))
    (tmp_path / 'd.csv').write_bytes(HOSTILE_DESTINATION.encode('utf-8'))
    out = tmp_path / 'report.html'
    code = verify.main(['--source', str(tmp_path / 's.csv'), '--destination', str(tmp_path / 'd.csv'),
                        '--key', 'k', '--field', 'p', *args, '--html', str(out)])
    capsys.readouterr()
    return code, out.read_text(encoding='utf-8')


def test_html_report_escapes_every_csv_value(tmp_path, capsys):
    code, text = html_report(tmp_path, capsys, '--source-complete', '--destination-complete', '--scope', 'exact')
    assert code == 1
    assert '<script' not in text.lower() and '<img' not in text and '<b>' not in text and '<i>only' not in text
    for value in ('<script>alert(1)</script>', '<img src=x onerror=alert(2)>', '<b>bold</b>', '<i>only</i>'):
        assert html.escape(value) in text


def test_html_report_is_self_contained_and_has_no_script(tmp_path, capsys):
    code, text = html_report(tmp_path, capsys, '--source-complete', '--destination-complete', '--scope', 'exact')
    tags = re.findall(r'<([a-zA-Z][a-zA-Z0-9]*)([^>]*)>', text)
    assert {name.lower() for name, _ in tags} <= {
        'html', 'head', 'meta', 'title', 'style', 'body', 'h1', 'h2', 'p', 'span', 'section', 'table', 'tr', 'th',
        'td', 'code', 'i'}
    for _, attributes in tags:
        assert not re.search(r'\b(src|href|on[a-z]+)\s*=', attributes, re.I)
    style = text[text.index('<style>'):text.index('</style>')]
    assert 'url(' not in style and '@import' not in style and '@font-face' not in style
    assert 'http://' not in text and 'https://' not in text
    assert text.startswith('<!DOCTYPE html>') and '<meta charset="utf-8">' in text


def test_html_report_shows_result_counts_premises_limitations_and_problem_records(tmp_path, capsys):
    code, text = html_report(tmp_path, capsys, '--source-complete', '--destination-complete', '--scope', 'exact',
                             '--source-count', '3')
    assert code == 1
    assert '<span class="state Mismatch">Mismatch</span>' in text
    for section in ('Stated premises', 'Counts', 'Limitations', 'Records that are not Verified (1)',
                    'Destination-only records (1)'):
        assert f'>{section}</h2>' in text
    for premise in ('source_complete', 'destination_complete', 'source_count', 'destination_count'):
        assert f'<td>{premise}</td>' in text
    assert '<tr><td>source_count</td><td>3</td><td>command-line option</td><td>2</td><td>no</td></tr>' in text
    assert html.escape(verify.LIMITS) in text
    assert '<th>Verified records</th><td>1</td>' in text and '<th>Mismatch records</th><td>1</td>' in text
    assert html.escape("'K2'") not in text  # a Verified record is not listed


def test_html_report_names_the_claim_only_when_verified(tmp_path, capsys):
    (tmp_path / 's.csv').write_text('k,p\n1,x\n')
    (tmp_path / 'd.csv').write_text('p,k\nx,1\n')
    out = tmp_path / 'report.html'
    code = verify.main(['--source', str(tmp_path / 's.csv'), '--destination', str(tmp_path / 'd.csv'),
                        '--key', 'k', '--field', 'p', '--source-complete', '--destination-complete',
                        '--html', str(out)])
    assert code == 0 and html.escape(verify.CLAIM) in out.read_text(encoding='utf-8')
    assert 'Records that are not Verified (0)' in out.read_text(encoding='utf-8')


def test_html_report_follows_redaction(tmp_path, capsys):
    code, text = html_report(tmp_path, capsys, '--source-complete', '--destination-complete', '--scope', 'exact',
                             '--redact-values')
    assert code == 1 and 'alert(' not in text and 'bold' not in text and html.escape('<i>only') not in text
    assert html.escape("'[redacted]'") in text


def test_html_report_never_overwrites_and_leaves_no_partial_output(tmp_path, capsys):
    page = tmp_path / 'report.html'
    page.write_text('keep')
    out = tmp_path / 'report.json'
    assert verify.main(cli('--json', str(out), '--html', str(page))) == 2
    assert page.read_text() == 'keep' and not out.exists()
    assert 'refused:' in capsys.readouterr().err


def test_json_and_html_cannot_share_a_path(tmp_path, capsys):
    out = tmp_path / 'report'
    assert verify.main(cli('--json', str(out), '--html', str(out))) == 2
    assert not out.exists()


def test_a_failed_html_write_removes_both_reports(tmp_path, capsys, monkeypatch):
    def full_disk(report, f):
        raise OSError(28, 'No space left on device')

    monkeypatch.setattr(verify, 'write_html', full_disk)
    out, page = tmp_path / 'report.json', tmp_path / 'report.html'
    assert verify.main(cli('--json', str(out), '--html', str(page))) == 2
    assert not out.exists() and not page.exists()
    assert 'No space left on device' in capsys.readouterr().err


def report_members(report):
    """Every member name in a report, including those inside its nested objects."""
    names = set(report)
    for name in ('inputs', 'obligation', 'counts', 'premises', 'destination_only_counts'):
        names |= set(report.get(name, {}))
    for premise in report['premises'].values():
        names |= set(premise)
    for record in report['records'] + report.get('destination_only', []):
        names |= set(record)
        for rule in record.get('rules', {}).values():
            names |= set(rule)
    return names


def test_report_format_documents_every_member(tmp_path, capsys):
    doc = (ROOT / 'docs/report-format.md').read_text(encoding='utf-8')
    path = config_file(tmp_path, dict(CONFIG, scope='exact'))
    code, _, _, report = check(tmp_path, capsys, CONFIG_SOURCE, CONFIG_DESTINATION + 'A9,1,z\n', '--config', path,
                               '--source-complete', '--destination-complete', '--details', 'all',
                               '--source-count', '2', '--destination-count', '3', '--source-encoding', 'utf-8')
    names = report_members(report)
    _, _, _, identical = check(tmp_path, capsys, 'k,p\n1,x\n', 'k,p\n1,x\n', '--mapping',
                               config_file(tmp_path, {'key': ['k', 'k'], 'fields': [['p', 'p']]}),
                               '--allow-identical-content')
    names |= report_members(identical)
    undocumented = sorted(n for n in names if f'`{n}`' not in doc)
    assert undocumented == []


# --- v0.2.0: conformance cases for the new behavior --------------------------------------------

def test_conformance_covers_every_v020_behavior():
    names = {case['name'] for case in load_conformance_cases()}
    for rule in ('trim', 'casefold', 'digits', 'date'):
        assert {f'rule-{rule}-pass', f'rule-{rule}-fail', f'rule-{rule}-unknown'} <= names
    assert {'source-count-mismatch', 'destination-count-mismatch', 'counts-match',
            'scope-exact-covered', 'scope-exact-not-covered', 'scope-exact-keyless-destination-row'} <= names


def test_conformance_cases_use_only_documented_inputs():
    for case in load_conformance_cases():
        assert set(case['obligation']) <= {'key', 'fields', 'scope'}, case['name']
        assert set(case['premises']) <= {'source_complete', 'destination_complete', 'source_count',
                                         'destination_count'}, case['name']
        for field in case['obligation']['fields']:
            assert len(field) in (2, 3) and (len(field) == 2 or evaluator_v2.parse_rule(field[2]) == field[2])


def test_conformance_case_names_match_file_names():
    for path in sorted(CONFORMANCE.glob('*.json')):
        assert json.loads(path.read_text(encoding='utf-8'))['name'] == path.stem
