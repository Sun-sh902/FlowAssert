"""Evaluator v2 and the offline CSV check. v1 fixtures are the semantic reference."""
import json
from pathlib import Path
import sys

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
