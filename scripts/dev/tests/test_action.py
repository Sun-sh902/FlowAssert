"""The GitHub Action (action.yml and action/run_action.py): inputs to arguments, refusals, the pass or fail decision,
the step outputs, the job summary, and reports identical to flowassert-verify's."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'action'))
sys.path.insert(0, str(ROOT / 'offline'))
import run_action  # noqa: E402
from flowassert_offline import cli  # noqa: E402

EXAMPLES = ROOT / 'offline' / 'examples'
GOLDEN = ROOT / 'offline' / 'golden'
ACTION_YML = (ROOT / 'action.yml').read_text(encoding='utf-8')
EXAMPLE = {'source': str(EXAMPLES / 'source.csv'), 'destination': str(EXAMPLES / 'destination.csv'),
           'key': 'external_id', 'fields': 'phone\nemail:hs_email\n'}
# Values from the example files that must never reach a log or summary unless show-records is true.
VALUES = ('SYN-002', 'SYN-003', 'SYN-004', '+1 212 555 0199', '+1 212 555 0102')


def env(tmp_path, **inputs):
    environ = {k: v for k, v in os.environ.items() if not k.startswith('FA_')}
    environ.update({run_action.env_name(name.replace('_', '-')): value for name, value in inputs.items()})
    environ['GITHUB_OUTPUT'] = str(tmp_path / 'output.txt')
    environ['GITHUB_STEP_SUMMARY'] = str(tmp_path / 'summary.md')
    return environ


def outputs(tmp_path):
    """Read GITHUB_OUTPUT as the runner does: name<<DELIMITER, the value's lines, DELIMITER."""
    lines = (tmp_path / 'output.txt').read_text(encoding='utf-8').split('\n')
    assert lines.pop() == ''
    found = {}
    while lines:
        name, delimiter = lines.pop(0).split('<<')
        assert re.fullmatch(r'FLOWASSERT_[0-9a-f]{32}', delimiter)
        value = []
        while lines[0] != delimiter:
            value.append(lines.pop(0))
        lines.pop(0)
        found[name] = '\n'.join(value)
    return found


def act(tmp_path, capsys, **inputs):
    code = run_action.run(env(tmp_path, **inputs))
    printed = capsys.readouterr().out
    summary = (tmp_path / 'summary.md').read_text(encoding='utf-8')
    return code, printed, outputs(tmp_path), summary


# -- inputs to arguments ------------------------------------------------------------------------------------------

def inputs(**given):
    values = dict(run_action.DEFAULTS)
    values.update({name.replace('_', '-'): value for name, value in given.items()})
    return values


def test_every_value_input_maps_to_its_option():
    given = {name: f'v-{name}' for name, _ in run_action.VALUES}
    argv = run_action.arguments(inputs(**given))
    assert argv == [f'{option}=v-{name}' for name, option in run_action.VALUES] + ['--max-details=0']


def test_empty_inputs_are_left_out_so_the_checker_defaults_apply():
    assert run_action.arguments(inputs()) == ['--max-details=0']


def test_each_flag_is_given_only_when_true():
    for name, option in run_action.FLAGS:
        assert option in run_action.arguments(inputs(**{name: 'true'}))
        assert option not in run_action.arguments(inputs(**{name: 'false'}))


def test_fields_one_per_line_unchanged_and_blank_lines_skipped():
    argv = run_action.arguments(inputs(fields='phone\r\n\nemail:hs_email \n  \n-x\n'))
    assert [a for a in argv if a.startswith('--field')] == ['--field=phone', '--field=email:hs_email ', '--field=-x']


def test_a_value_that_looks_like_an_option_stays_a_value():
    argv = run_action.arguments(inputs(key='--source-complete', source='-s.csv'))
    assert '--key=--source-complete' in argv and '--source=-s.csv' in argv
    assert '--source-complete' not in argv


def test_show_records_lets_the_checker_print_records():
    assert '--max-details=0' not in run_action.arguments(inputs(show_records='true'))


@pytest.mark.parametrize('name', ['source-complete', 'destination-complete', 'allow-identical-content',
                                  'redact-values', 'show-records'])
@pytest.mark.parametrize('value', ['', 'True', 'TRUE', 'yes', '1', ' true', 'false\n', 'on'])
def test_a_boolean_is_exactly_true_or_false(name, value):
    with pytest.raises(run_action.Refused, match=f'^{name} must be true or false'):
        run_action.arguments(inputs(**{name: value}))


@pytest.mark.parametrize('value', ['', 'Mismatch', 'never', 'unverified', 'not-verified '])
def test_fail_on_is_one_of_two(value):
    with pytest.raises(run_action.Refused, match='^fail-on must be one of: not-verified, mismatch$'):
        run_action.arguments(inputs(fail_on=value))


def test_premises_default_to_not_stated():
    for name in ('source-complete', 'destination-complete', 'allow-identical-content'):
        assert run_action.DEFAULTS[name] == 'false'
    for name in ('source-count', 'destination-count'):
        assert run_action.DEFAULTS[name] == ''
    assert run_action.DEFAULTS['show-records'] == 'false'
    assert run_action.DEFAULTS['fail-on'] == 'not-verified'


# -- action.yml ---------------------------------------------------------------------------------------------------

def yml_inputs():
    """The inputs block of action.yml: name -> default (None when it has none)."""
    block = ACTION_YML.split('\ninputs:\n', 1)[1].split('\noutputs:\n', 1)[0]
    found, name = {}, None
    for line in block.splitlines():
        m = re.fullmatch(r'  ([a-z-]+):', line)
        if m:
            name = m.group(1)
            found[name] = None
        m = re.fullmatch(r'    default: (.*)', line)
        if m:
            found[name] = m.group(1).strip('"')
    return found


def run_block():
    return ACTION_YML.split('      run: |\n', 1)[1]


def test_action_yml_declares_the_inputs_the_wrapper_reads_with_the_same_defaults():
    declared = yml_inputs()
    assert set(declared) == set(run_action.DEFAULTS)
    for name, default in declared.items():
        # From 1.1.0 no input is required: a sheet or HubSpot can stand in for source and destination.
        assert f'  {name}:\n    description: ' in ACTION_YML and default is not None, name
        assert default == run_action.DEFAULTS[name], name
        assert f'        {run_action.env_name(name)}: ${{{{ inputs.{name} }}}}\n' in ACTION_YML


def test_no_input_is_written_into_the_script():
    assert '${{' not in run_block()
    assert ACTION_YML.count('${{ inputs.') == len(run_action.DEFAULTS)
    assert 'uses:' not in ACTION_YML.split('\nruns:\n', 1)[1]


def test_premise_inputs_say_that_flowassert_cannot_check_them():
    block = ACTION_YML.split('\ninputs:\n', 1)[1]
    for name in ('source-complete', 'destination-complete', 'source-count', 'destination-count',
                 'allow-identical-content'):
        description = block.split(f'\n  {name}:\n', 1)[1].split('\n', 1)[0]
        assert 'Premise, not checked by FlowAssert' in description, name


# -- the pass or fail decision ------------------------------------------------------------------------------------

@pytest.mark.parametrize('code,stdout,state', [
    (0, 'Verified: 3 rows of 3\n', 'Verified'),
    (1, 'Mismatch: 4 rows of 4\n', 'Mismatch'),
    (3, 'Unverified: 4 rows of unknown total\n', 'Unverified'),
    (2, '', 'refused'),
    (4, '', 'failed'),
    # The exit status and the summary must agree; anything else is a failure, never a pass.
    (0, '', 'failed'),
    (0, 'Unverified: 1 rows of 1\n', 'failed'),
    (1, '', 'failed'),
    (3, 'Verified: 1 rows of 1\n', 'failed'),
    (5, 'Verified: 1 rows of 1\n', 'failed'),
    (-11, '', 'failed'),
    (127, '', 'failed'),
])
def test_state_of_exit_status(code, stdout, state):
    assert run_action.state_of(code, stdout) == state


@pytest.mark.parametrize('state,not_verified,mismatch', [
    ('Verified', True, True),
    ('Unverified', False, True),
    ('Mismatch', False, False),
    ('refused', False, False),
    ('failed', False, False),
])
def test_passes(state, not_verified, mismatch):
    assert run_action.passes(state, 'not-verified') is not_verified
    assert run_action.passes(state, 'mismatch') is mismatch


@pytest.mark.parametrize('code,stdout,stderr,fail_on,state,step', [
    (0, 'Verified: 1 rows of 1\n', '', 'not-verified', 'Verified', 0),
    (0, 'Verified: 1 rows of 1\n', '', 'mismatch', 'Verified', 0),
    (1, 'Mismatch: 1 rows of 1\n', '', 'not-verified', 'Mismatch', 1),
    (1, 'Mismatch: 1 rows of 1\n', '', 'mismatch', 'Mismatch', 1),
    (3, 'Unverified: 1 rows of unknown total\n', '', 'not-verified', 'Unverified', 1),
    (3, 'Unverified: 1 rows of unknown total\n', '', 'mismatch', 'Unverified', 0),
    (2, '', 'refused: a.csv: missing column k\n', 'not-verified', 'refused', 1),
    (2, '', 'refused: a.csv: missing column k\n', 'mismatch', 'refused', 1),
    (4, '', 'failed: MemoryError\n', 'not-verified', 'failed', 1),
    (4, '', 'failed: MemoryError\n', 'mismatch', 'failed', 1),
    (1, '', 'Traceback (most recent call last):\nModuleNotFoundError: x\n', 'mismatch', 'failed', 1),
    (-9, '', '', 'mismatch', 'failed', 1),
])
def test_step_result_for_every_exit_status(tmp_path, capsys, monkeypatch, code, stdout, stderr, fail_on, state, step):
    def fake(argv, **kwargs):
        return subprocess.CompletedProcess(argv, code, stdout.encode(), stderr.encode())
    monkeypatch.setattr(run_action.subprocess, 'run', fake)
    result, printed, out, summary = act(tmp_path, capsys, source='s.csv', destination='d.csv', fail_on=fail_on,
                                        json='r.json')
    assert result == step
    assert out == {'state': state, 'exit-code': str(code), 'json': 'r.json' if state[0].isupper() else '', 'html': '',
                   'export-dir': ''}
    assert summary.startswith(f'## FlowAssert: {state}\n\nExit status {code}. This step '
                              f'{"passed" if step == 0 else "failed"} (fail-on: {fail_on}).\n')
    assert ('::error title=FlowAssert::' in printed) is (step == 1)


def test_an_action_refusal_never_runs_the_checker(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(run_action.subprocess, 'run', lambda *a, **k: pytest.fail('the checker ran'))
    code, printed, out, summary = act(tmp_path, capsys, **EXAMPLE, source_complete='yes')
    assert code == 1
    assert out == {'state': 'refused', 'exit-code': '2', 'json': '', 'html': '', 'export-dir': ''}
    assert "refused: source-complete must be true or false, not 'yes'" in printed
    assert "::error title=FlowAssert::FlowAssert: refused: source-complete must be true or false, not 'yes'; " \
           "nothing was concluded." in printed
    assert 'Stated premises' not in summary


# -- runs of the real checker -------------------------------------------------------------------------------------

def test_example_mismatch_shows_no_values_by_default(tmp_path, capsys):
    code, printed, out, summary = act(tmp_path, capsys, **EXAMPLE, source_complete='true',
                                      destination_complete='true')
    assert code == 1
    assert out == {'state': 'Mismatch', 'exit-code': '1', 'json': '', 'html': '', 'export-dir': ''}
    for text in (printed, summary, (tmp_path / 'output.txt').read_text(encoding='utf-8')):
        for value in VALUES + ('phone', 'hs_email', 'external_id'):
            assert value not in text
    assert 'Mismatch: 4 rows of 4\nVerified 1 · Mismatch 3 · Unverified 0\n' \
           '... 3 more records not shown; use --json for all of them.\n' + cli.LIMITS + '\n' in printed
    assert cli.LIMITS in summary and 'Verified 1 · Mismatch 3 · Unverified 0' in summary
    assert run_action.HIDDEN in printed and run_action.HIDDEN in summary
    assert '| source_complete | yes | command-line option |\n| destination_complete | yes | command-line option |\n' \
           '| source_count | none | command-line option |\n| destination_count | none | command-line option |\n' in summary
    assert 'allow_identical_content' not in summary


def test_show_records_prints_the_checker_summary_as_it_is(tmp_path, capsys):
    code, printed, out, summary = act(tmp_path, capsys, **EXAMPLE, source_complete='true',
                                      destination_complete='true', show_records='true')
    expected = (GOLDEN / 'example' / 'stdout.txt').read_text(encoding='utf-8')
    assert expected in printed and expected.rstrip('\n') in summary
    assert run_action.HIDDEN not in printed
    for value in VALUES:
        assert value in printed


def test_counts_and_identical_content_in_the_summary(tmp_path, capsys):
    given = action_inputs(cli_args(GOLDEN / 'identical-content-allowed'))
    given.update(source_count='7', destination_count='1')
    code, printed, out, summary = act(tmp_path, capsys, **given)
    assert (code, out['state']) == (1, 'Unverified')
    assert '| source_count | 7 | command-line option |' in summary
    assert '| destination_count | 1 | command-line option |' in summary
    assert '| allow_identical_content | yes | command-line option |' in summary
    assert 'Source and destination files were identical (--allow-identical-content).' in summary
    assert 'Source count stated 7, file has' in summary


def test_unverified_passes_only_with_fail_on_mismatch(tmp_path, capsys):
    unverified = action_inputs(cli_args(GOLDEN / 'duplicate-source-key'))
    code, printed, out, summary = act(tmp_path, capsys, **unverified)
    assert (code, out['state'], out['exit-code']) == (1, 'Unverified', '3')
    (tmp_path / 'second').mkdir()
    code, printed, out, summary = act(tmp_path / 'second', capsys, **unverified, fail_on='mismatch')
    assert (code, out['state']) == (0, 'Unverified')
    assert '::error' not in printed
    assert 'This step passed (fail-on: mismatch).' in summary


def test_a_checker_refusal_fails_and_leaves_no_report(tmp_path, capsys):
    folder = GOLDEN / 'refused-missing-columns'
    code, printed, out, summary = act(tmp_path, capsys, source=str(folder / 'source.csv'),
                                      destination=str(folder / 'destination.csv'), config=str(folder / 'config.json'),
                                      fail_on='mismatch', json=str(tmp_path / 'r.json'))
    assert code == 1
    assert out == {'state': 'refused', 'exit-code': '2', 'json': '', 'html': '', 'export-dir': ''}
    assert f'refused: {folder / "destination.csv"}: missing column k, q' in printed
    assert not (tmp_path / 'r.json').exists()


def test_a_missing_required_input_is_the_checkers_refusal(tmp_path, capsys):
    code, printed, out, summary = act(tmp_path, capsys, destination=EXAMPLE['destination'], key='k', fields='p')
    assert (code, out['state'], out['exit-code']) == (1, 'refused', '2')
    assert 'flowassert-verify: error: the following arguments are required: --source' in printed


def test_record_values_cannot_act_as_workflow_commands(tmp_path, capsys):
    (tmp_path / 's.csv').write_text('k,p\n"a\n::error::forged",1\n', encoding='utf-8')
    (tmp_path / 'd.csv').write_text('k,p\n"a\n::error::forged",2\n', encoding='utf-8')
    code, printed, out, summary = act(tmp_path, capsys, source=str(tmp_path / 's.csv'),
                                      destination=str(tmp_path / 'd.csv'), key='k', fields='p', show_records='true')
    assert out['state'] == 'Mismatch' and '\n::error::forged' in printed
    stop = re.search(r'^::stop-commands::([0-9a-f]{32})$', printed, re.M)
    assert stop and printed.index(stop.group(0)) < printed.index('::error::forged') < printed.index(f'::{stop.group(1)}::')


def test_a_python_module_in_the_working_directory_is_not_imported(tmp_path, capsys, monkeypatch):
    (tmp_path / 'csv.py').write_text('raise SystemExit(99)\n', encoding='utf-8')
    (tmp_path / 'flowassert_offline').mkdir()
    (tmp_path / 'flowassert_offline' / '__init__.py').write_text('raise SystemExit(98)\n', encoding='utf-8')
    monkeypatch.chdir(tmp_path)
    code, printed, out, summary = act(tmp_path, capsys, **EXAMPLE, source_complete='true',
                                      destination_complete='true')
    assert (out['state'], out['exit-code']) == ('Mismatch', '1')


def test_an_output_value_never_contains_its_delimiter(tmp_path, monkeypatch):
    tokens = iter(['0' * 32, '0' * 32, '1' * 32])
    monkeypatch.setattr(run_action.secrets, 'token_hex', lambda n: next(tokens))
    path = tmp_path / 'output.txt'
    run_action.write_outputs(str(path), {'json': 'a\nFLOWASSERT_' + '0' * 32 + '\nb'})
    assert path.read_text(encoding='utf-8') == (
        'json<<FLOWASSERT_' + '1' * 32 + '\na\nFLOWASSERT_' + '0' * 32 + '\nb\nFLOWASSERT_' + '1' * 32 + '\n')


def test_a_summary_code_block_is_never_closed_by_a_value():
    assert run_action._code('a ``` b ```` c') == '`````text\na ``` b ```` c\n`````\n\n'


# -- reports identical to flowassert-verify's ---------------------------------------------------------------------

def cli_args(folder):
    import json
    case = json.loads((folder / 'case.json').read_text(encoding='utf-8'))
    argv, args = case['args'], []
    i = 0
    while i < len(argv):
        option = argv[i]
        if option in ('--source-complete', '--destination-complete', '--allow-identical-content',
                      '--redact-values'):
            args.append(option)
            i += 1
            continue
        value = argv[i + 1]
        if option in ('--source', '--destination', '--config'):
            value = str(folder / value)
        args.append(f'{option}={value}')
        i += 2
    return args


def action_inputs(args):
    given, fields = {}, []
    for arg in args:
        option, _, value = arg.partition('=')
        name = option[2:]
        if name == 'field':
            fields.append(value)
        elif not value:
            given[name.replace('-', '_')] = 'true'
        elif name == 'max-details':
            continue
        else:
            given[name.replace('-', '_')] = value
    if fields:
        given['fields'] = '\n'.join(fields)
    return given


REPORT_CASES = ['example', 'example-details-all', 'example-redacted', 'rules-pass', 'rules-fail', 'scope-exact-cli',
                'counts-match', 'count-cli-forms', 'encoding-gb18030', 'encoding-utf16-be', 'encoding-cli-options',
                'identical-content-allowed', 'unsafe-values', 'keyless-rows']


def without_time(text):
    text = re.sub(r'"evaluated_at": "[^"]*"', '"evaluated_at": ""', text)
    return re.sub(r'>Evaluated at [^ ]* by', '>Evaluated at by', text)


@pytest.mark.parametrize('name', REPORT_CASES)
def test_reports_are_flowassert_verifys(tmp_path, capsys, name):
    folder = GOLDEN / name
    args = cli_args(folder)
    reports = {kind: tmp_path / f'action.{kind}' for kind in ('json', 'html')}
    code, printed, out, summary = act(tmp_path, capsys, **action_inputs(args), json=str(reports['json']),
                                      html=str(reports['html']), show_records='true')
    expected_code = int((folder / 'exit_status.txt').read_text())
    assert out['exit-code'] == str(expected_code)
    assert out['json'] == str(reports['json']) and out['html'] == str(reports['html'])
    direct = subprocess.run([sys.executable, '-m', 'flowassert_offline.cli', *args, f'--json={tmp_path}/cli.json',
                             f'--html={tmp_path}/cli.html'], cwd=str(ROOT / 'offline'), stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, encoding='utf-8')
    assert direct.returncode == expected_code
    assert direct.stdout in printed
    for kind in ('json', 'html'):
        action_bytes = reports[kind].read_bytes().decode('utf-8')
        cli_bytes = (tmp_path / f'cli.{kind}').read_bytes().decode('utf-8')
        assert without_time(action_bytes) == without_time(cli_bytes)
        assert without_time(action_bytes) == without_time((folder / f'report.{kind}').read_text(encoding='utf-8'))
    assert direct.stdout == (folder / 'stdout.txt').read_text(encoding='utf-8')


# -- the step's own script in action.yml ---------------------------------------------------------------------------

def fake_python(folder, name, version):
    script = folder / name
    script.write_text('#!/bin/sh\n'
                      f'case "$1" in --version) echo "Python {version}"; exit 0;; -c) exit 1;; esac\n'
                      'exit 1\n', encoding='utf-8')
    script.chmod(0o755)


@pytest.mark.skipif(not shutil.which('bash') or os.name == 'nt', reason='the step runs in bash; this test needs a POSIX bash')
def test_the_step_needs_python_39_or_later(tmp_path):
    bin_dir = tmp_path / 'bin'
    bin_dir.mkdir()
    os.symlink(shutil.which('head'), bin_dir / 'head')
    fake_python(bin_dir, 'python3', '3.8.18')
    environ = env(tmp_path, **EXAMPLE)
    environ.update(PATH=str(bin_dir), GITHUB_ACTION_PATH=str(ROOT))
    result = subprocess.run([shutil.which('bash'), '-e', '-c', run_block()], env=environ, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, encoding='utf-8')
    assert result.returncode == 1
    assert result.stdout == ('::error title=FlowAssert::FlowAssert needs Python 3.9 or later on the runner (found: '
                             'Python 3.8.18). Add actions/setup-python before this step.\n')
    assert (tmp_path / 'output.txt').read_text(encoding='utf-8') == 'state=failed\nexit-code=\n'


@pytest.mark.skipif(not shutil.which('bash') or os.name == 'nt', reason='the step runs in bash; this test needs a POSIX bash')
def test_the_step_falls_back_to_python_and_runs_the_check(tmp_path):
    bin_dir = tmp_path / 'bin'
    bin_dir.mkdir()
    fake_python(bin_dir, 'python3', '3.8.18')
    os.symlink(sys.executable, bin_dir / 'python')
    environ = env(tmp_path, **EXAMPLE, source_complete='true', destination_complete='true', fail_on='mismatch')
    environ.update(PATH=str(bin_dir), GITHUB_ACTION_PATH=str(ROOT))
    result = subprocess.run([shutil.which('bash'), '-e', '-c', run_block()], env=environ, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, encoding='utf-8')
    assert result.returncode == 1, result.stderr
    assert 'Mismatch: 4 rows of 4\n' in result.stdout
    assert outputs(tmp_path)['state'] == 'Mismatch'


def test_the_action_is_named_at_one_released_version_everywhere():
    # README.md and action.yml show `uses: Sun-sh902/FlowAssert@vX.Y.Z`. They name one version, and
    # it has a dated section in CHANGELOG.md, so no example points at a version that was never released.
    uses = re.compile(r'uses: Sun-sh902/FlowAssert@v(\d+\.\d+\.\d+)\b')
    found = {name: uses.findall((ROOT / name).read_text(encoding='utf-8'))
             for name in ('README.md', 'action.yml')}
    assert all(found.values()), found
    versions = {v for values in found.values() for v in values}
    assert len(versions) == 1, found
    version = versions.pop()
    changelog = (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
    assert re.search(rf'^## {re.escape(version)} \(\d{{4}}-\d{{2}}-\d{{2}}\)$', changelog, re.M), version


# -- 1.1.0: the run summary, connectors, workbooks and the records to resend ---------------------------------------

sys.path.insert(0, str(ROOT / 'offline' / 'bench'))
from fake_hubspot_api import FakeHubSpotApi  # noqa: E402
from fake_sheets_api import FakeSheetsApi  # noqa: E402

GOLDEN_XLSX = ROOT / 'offline' / 'golden-xlsx'
# Recognisable credentials for the leak test: synthetic, and never real ones.
SHEET_TOKEN = 'fake-oauth-token-FA11-LEAK-CANARY-not-a-real-credential'
HUBSPOT_TOKEN = 'pat-na1-fake-FA11-LEAK-CANARY-not-a-real-credential'
sys.path.insert(0, str(ROOT / 'scripts' / 'dev'))
import serve_fakes  # noqa: E402


def test_the_fake_server_of_the_self_test_serves_one_check_and_writes_only_endpoints(tmp_path):
    import threading
    env_file = tmp_path / 'env'
    ready = tmp_path / 'ready'
    thread = threading.Thread(target=serve_fakes.main, args=(['--sheets-token', SHEET_TOKEN, '--hubspot-token',
                                                              HUBSPOT_TOKEN, '--env-file', str(env_file), '--ready',
                                                              str(ready), '--seconds', '1'],), daemon=True)
    thread.start()
    thread.join(5)
    lines = env_file.read_text(encoding='utf-8').splitlines()
    assert [line.split('=')[0] for line in lines] == ['FLOWASSERT_SHEETS_TEST_ENDPOINT', 'FLOWASSERT_HUBSPOT_TEST_ENDPOINT']
    assert all(re.fullmatch(r'[A-Z_]+=http://127\.0\.0\.1:\d+', line) for line in lines)
    assert ready.read_text(encoding='utf-8') == 'ready\n'


def run_part(summary):
    assert summary.count('### What this run shows\n') == 1
    return summary.split('### What this run shows\n', 1)[1]


def test_the_run_summary_follows_the_job_summary_of_1_0(tmp_path, capsys):
    code, printed, out, summary = act(tmp_path, capsys, **EXAMPLE, source_complete='true',
                                      destination_complete='true', destination_count='4')
    assert code == 1
    before, part = summary.split('### What this run shows\n')
    assert before.startswith('## FlowAssert: Mismatch\n\nExit status 1. This step failed (fail-on: not-verified).\n')
    assert part == (
        '\n**Mismatch.** No claim is made: the result is not Verified.\n\n'
        '| Verified | Mismatch | Unverified | Source rows | Expected total |\n| --- | --- | --- | --- | --- |\n'
        '| 1 | 3 | 0 | 4 | 4 |\n\n'
        '| Premise | Stated | Applied |\n| --- | --- | --- |\n'
        '| source_complete | yes | applied |\n| destination_complete | yes | applied |\n'
        '| source_count | none | not stated |\n| destination_count | 4 | matches the rows read |\n\n'
        '| Input | Read as | SHA-256 |\n| --- | --- | --- |\n'
        '| Source | CSV file | `f0ae4524abfc7a500c5ea5bd888848730f650e6ec920ef955198bdc990466fdd` |\n'
        '| Destination | CSV file | `acf9ad723a89e42df3379eebe5c786b270b3e753345ad59a4e647484d15b5cb5` |\n\n'
        'This run is a new observation; it does not change any earlier report.\n')
    for value in VALUES + ('phone', 'hs_email'):
        assert value not in summary


def test_a_verified_run_states_its_claim_and_a_premise_not_applied_says_why(tmp_path, capsys):
    folder = GOLDEN / 'count-destination-mismatch'
    _, _, _, summary = act(tmp_path, capsys, source=str(folder / 'source.csv'),
                           destination=str(folder / 'destination.csv'), config=str(folder / 'config.json'),
                           source_complete='true', destination_complete='true', destination_count='3')
    part = run_part(summary)
    assert '| destination_complete | yes | not applied: the stated total differs from the rows read |\n' in part
    assert '| destination_count | 3 | differs from the rows read |\n' in part
    (tmp_path / 'summary.md').unlink()
    folder = GOLDEN / 'rules-pass'
    _, _, _, summary = act(tmp_path, capsys, source=str(folder / 'source.csv'),
                           destination=str(folder / 'destination.csv'), config=str(folder / 'config.json'),
                           source_complete='true', destination_complete='true')
    report = json.loads((GOLDEN / 'rules-pass' / 'report.json').read_text(encoding='utf-8'))
    assert run_part(summary).startswith(f'\n**Verified.** {report["claim"]}\n\n')


def test_identical_content_allowed_is_a_premise_of_the_run_summary(tmp_path, capsys):
    folder = GOLDEN / 'identical-content-allowed'
    _, _, _, summary = act(tmp_path, capsys, source=str(folder / 'source.csv'), destination=str(folder / 'destination.csv'),
                           config=str(folder / 'config.json'), allow_identical_content='true')
    assert '| allow_identical_content | yes | applied: the two inputs were identical |\n' in run_part(summary)


def test_summary_false_writes_no_job_summary_and_summary_keys_lists_keys_only(tmp_path, capsys):
    act_env = env(tmp_path, **EXAMPLE, summary='false')
    assert run_action.run(act_env) == 1
    capsys.readouterr()
    assert not (tmp_path / 'summary.md').exists()
    _, _, _, summary = act(tmp_path, capsys, **EXAMPLE, source_complete='true', destination_complete='true',
                           summary_keys='true')
    part = run_part(summary)
    assert 'Keys of the records that are not Verified (3):\n\n```text\nSYN-002\nSYN-003\nSYN-004\n```\n' in part
    for value in ('+1 212 555 0199', '+1 212 555 0102', 'grace@example.test'):
        assert value not in summary
    (tmp_path / 'summary.md').unlink()
    _, _, _, summary = act(tmp_path, capsys, **EXAMPLE, summary_keys='true', redact_values='true')
    assert 'The keys are not listed: the report was written with redact-values.' in run_part(summary)
    assert 'SYN-' not in summary


def test_summary_inputs_must_be_true_or_false(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(run_action.subprocess, 'run', lambda *a, **k: pytest.fail('the checker ran'))
    for name in ('summary', 'summary_keys', 'skip_source_revision'):
        code, printed, out, _ = act(tmp_path, capsys, **EXAMPLE, **{name: 'yes'})
        assert code == 1 and out['state'] == 'refused'
        assert f"refused: {name.replace('_', '-')} must be true or false, not 'yes'" in printed


def test_keys_are_cut_and_at_most_50_are_listed(tmp_path, capsys):
    long = 'K' * 300
    rows = ['id,v'] + [f'{long if i == 0 else f"K{i:03d}"},a' for i in range(60)]
    (tmp_path / 's.csv').write_text('\r\n'.join(rows) + '\r\n', encoding='utf-8')
    (tmp_path / 'd.csv').write_text('id,v\r\n', encoding='utf-8')
    _, _, _, summary = act(tmp_path, capsys, source=str(tmp_path / 's.csv'), destination=str(tmp_path / 'd.csv'),
                           key='id', fields='v', summary_keys='true')
    part = run_part(summary)
    assert 'Keys of the records that are not Verified (60, the first 50 shown):' in part
    listed = part.split('```text\n', 1)[1].split('\n```', 1)[0].split('\n')
    assert len(listed) == 50 and listed[0] == 'K' * 199 + '…' and listed[-1] == 'K049'


def test_a_summary_over_the_limit_leaves_out_the_printed_summary_and_the_keys(tmp_path, capsys, monkeypatch):
    huge = 'Mismatch: 1 rows of 1\n' + 'x' * (run_action.SUMMARY_LIMIT + 10) + '\n'
    real = subprocess.run

    def fake(argv, **kwargs):
        real(argv, **kwargs)  # writes the report the run summary reads
        return subprocess.CompletedProcess(argv, 1, huge.encode(), b'')
    monkeypatch.setattr(run_action.subprocess, 'run', fake)
    _, _, _, summary = act(tmp_path, capsys, **EXAMPLE, source_complete='true', destination_complete='true',
                           summary_keys='true')
    assert len(summary.encode('utf-8')) < run_action.SUMMARY_LIMIT
    assert 'xxxxxxxxxx' not in summary and 'SYN-' not in summary
    assert "The checker's printed summary and the keys are left out here: with them, this summary would pass " \
           "GitHub's limit of 1 MiB for a step." in summary
    assert '### What this run shows' in summary


def test_the_temporary_report_is_removed(tmp_path, capsys):
    temp = tmp_path / 'runner-temp'
    temp.mkdir()
    environ = env(tmp_path, **EXAMPLE)
    environ['RUNNER_TEMP'] = str(temp)
    run_action.run(environ)
    capsys.readouterr()
    assert list(temp.iterdir()) == []
    assert '### What this run shows' in (tmp_path / 'summary.md').read_text(encoding='utf-8')


def test_a_workbook_source_and_the_records_to_resend(tmp_path, capsys, monkeypatch):
    folder = GOLDEN_XLSX / 'xlsx-mismatch'
    case = json.loads((folder / 'case.json').read_text(encoding='utf-8'))
    args = case['args']
    given = {'source': str(folder / args[args.index('--source') + 1]),
             'destination': str(folder / args[args.index('--destination') + 1]),
             'source_format': 'xlsx', 'source_complete': 'true', 'destination_complete': 'true',
             'export_dir': str(tmp_path / 'resend')}
    if '--key' in args:
        given['key'] = args[args.index('--key') + 1]
        given['fields'] = '\n'.join(args[i + 1] for i, a in enumerate(args) if a == '--field')
    else:
        given['config'] = str(folder / args[args.index('--config') + 1])
    if '--source-worksheet' in args:
        given['source_worksheet'] = args[args.index('--source-worksheet') + 1]
    code, printed, out, summary = act(tmp_path, capsys, **given)
    assert code == 1 and out['export-dir'] == str(tmp_path / 'resend')
    part = run_part(summary)
    report = json.loads((folder / 'report.json').read_text(encoding='utf-8'))
    book = report['inputs']['source_workbook']
    assert (f"| Source | worksheet `{book['worksheet']!r}` of an .xlsx workbook | `{report['inputs']['source_sha256']}` "
            f"(canonical form), file `{book['file_sha256']}` |") in part
    files = sorted(p.name for p in (tmp_path / 'resend').iterdir())
    assert files and f'Records to resend, in {tmp_path / "resend"}: ' in part
    for name in files:
        assert name in part


def test_a_sheet_to_hubspot_check_leaks_no_credential(tmp_path, capsys, monkeypatch):
    with FakeSheetsApi(serve_fakes.sheet_responses(), credential=('token', SHEET_TOKEN)) as google, \
            FakeHubSpotApi(serve_fakes.hubspot_responses(), token=HUBSPOT_TOKEN) as crm:
        environ = env(tmp_path, source_sheet=serve_fakes.SPREADSHEET, source_range=serve_fakes.RANGE,
                      destination_hubspot='contacts', key='lead_id', fields='phone\nemail', scope='exact',
                      source_complete='true', destination_complete='true', json=str(tmp_path / 'r.json'),
                      html=str(tmp_path / 'r.html'), export_dir=str(tmp_path / 'resend'), summary_keys='true',
                      show_records='true')
        environ.update({'FLOWASSERT_SHEETS_TEST_ENDPOINT': google.endpoint, 'FLOWASSERT_SHEETS_TOKEN': SHEET_TOKEN,
                        'FLOWASSERT_HUBSPOT_TEST_ENDPOINT': crm.endpoint, 'FLOWASSERT_HUBSPOT_TOKEN': HUBSPOT_TOKEN})
        code = run_action.run(environ)
    printed = capsys.readouterr()
    assert code == 1
    part = run_part((tmp_path / 'summary.md').read_text(encoding='utf-8'))
    assert '| Source | Google Sheets range Leads!A1:C4, revision 7 | `' in part
    assert '| Destination | HubSpot contacts, 3 records | `' in part
    assert 'Destination-only records (scope exact): Mismatch 1, Unverified 0.\n' in part
    assert ('Records to resend, in ' + str(tmp_path / 'resend') + ': missing-from-destination.csv 1 row, '
            'values-differ.csv 1 row, only-in-destination.csv 1 row.') in part
    texts = [printed.out, printed.err, (tmp_path / 'output.txt').read_text(encoding='utf-8'),
             (tmp_path / 'summary.md').read_text(encoding='utf-8')]
    texts += [p.read_text(encoding='utf-8') for p in (tmp_path / 'r.json', tmp_path / 'r.html')]
    texts += [p.read_text(encoding='utf-8') for p in (tmp_path / 'resend').iterdir()]
    for text in texts:
        for secret in (SHEET_TOKEN, HUBSPOT_TOKEN, 'LEAK-CANARY'):
            assert secret not in text


@pytest.mark.parametrize('name, shown', [
    ('[Verified, see details](https://attacker.example/) <img src="https://attacker.example/p.png"> | x',
     '`\'[Verified, see details](https://attacker.example/) <img src="https://attacker.example/p.png"> \\| x\'`'),
    ('a `tick`', "``'a `tick`'``"),
    ('two\nlines', "`'two\\nlines'`"),
    ('', "`''`"),
])
def test_a_worksheet_name_is_shown_in_the_run_summary_and_never_rendered(tmp_path, capsys, name, shown):
    # The name comes from the workbook, which another system may have written. Before, it went into the run summary's
    # table as Markdown, so a name could put a link or an image (an <img> GitHub loads) into the summary.
    sys.path.insert(0, str(ROOT / 'offline' / 'bench'))
    import xlsx_writer as w
    book = w.Book(sheets=[w.Sheet('S', [['id', 'phone'], ['K1', '1']])])
    parts = w.parts(book)
    parts['xl/workbook.xml'] = parts['xl/workbook.xml'].replace(
        b'name="S"', b'name=' + w.quoteattr(name).encode('utf-8').replace(b'\n', b'&#10;'))
    (tmp_path / 'source.xlsx').write_bytes(w.zip_bytes(parts.items()))
    (tmp_path / 'destination.csv').write_text('id,phone\nK1,2\n', encoding='utf-8')
    code, printed, out, summary = act(tmp_path, capsys, source=str(tmp_path / 'source.xlsx'), source_format='xlsx',
                                      destination=str(tmp_path / 'destination.csv'), key='id', fields='phone')
    assert out['state'] == 'Mismatch'
    rows = [line for line in run_part(summary).split('\n') if line.startswith('| Source |')]
    assert len(rows) == 1 and rows[0].startswith(f'| Source | worksheet {shown} of an .xlsx workbook | `'), rows
