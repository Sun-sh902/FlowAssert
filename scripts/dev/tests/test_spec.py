"""The 1.0 trust commitment: the specification cites cases that exist, the JSON Schemas are current and describe every
golden report, the schema validator of the tests does what JSON Schema says, and the conformance runner passes the
reference implementation and fails one that answers wrongly."""
import copy
import json
from pathlib import Path
import re
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'offline' / 'bench'))
import conformance  # noqa: E402
import json_schema  # noqa: E402
import schemas  # noqa: E402

SPEC = (ROOT / 'docs/spec/verification.md').read_text(encoding='utf-8')
VALIDATOR_CASES = json.loads((ROOT / 'offline/bench/json_schema_cases.json').read_text(encoding='utf-8'))
CASE_ROOTS = {'golden': ROOT / 'offline/golden', 'golden-sheets': ROOT / 'offline/golden-sheets',
              'golden-hubspot': ROOT / 'offline/golden-hubspot', 'golden-xlsx': ROOT / 'offline/golden-xlsx'}
CITED = re.compile(r'`((?:golden|golden-sheets|golden-hubspot|golden-xlsx|conformance)/[A-Za-z0-9._-]+)`')
REQUIREMENTS = [line for line in SPEC.splitlines() if re.match(r'- \*\*R\d+\.\d+\*\*', line)]


def _exists(case):
    kind, name = case.split('/', 1)
    if kind == 'conformance':
        return (ROOT / 'offline/conformance' / f'{name}.json').is_file()
    return (CASE_ROOTS[kind] / name / 'case.json').is_file()


# --- The specification -------------------------------------------------------------------------

def test_the_specification_has_numbered_requirements_each_once():
    numbers = [re.match(r'- \*\*(R\d+\.\d+)\*\*', line).group(1) for line in REQUIREMENTS]
    assert len(numbers) > 60
    assert len(set(numbers)) == len(numbers)


def test_every_must_is_a_numbered_requirement():
    # Outside the requirements, MUST appears only where the conventions explain the word.
    for line in SPEC.splitlines():
        if re.search(r'\bMUST\b', line) and line not in REQUIREMENTS:
            assert 'RFC 2119' in line or 'every requirement with MUST' in line, line


@pytest.mark.parametrize('line', [r for r in REQUIREMENTS if re.search(r'\bMUST\b', r)],
                         ids=lambda line: re.match(r'- \*\*(R\d+\.\d+)', line).group(1))
def test_a_requirement_with_must_cites_a_golden_case_that_exists(line):
    cited = CITED.findall(line)
    assert any(c.startswith('golden') for c in cited), 'no golden case is cited'
    assert [c for c in cited if not _exists(c)] == []


def test_every_case_the_specification_names_exists():
    cited = set(CITED.findall(SPEC)) - {'golden/NAME', 'golden-sheets/NAME', 'golden-hubspot/NAME', 'golden-xlsx/NAME',
                                        'conformance/NAME'}
    assert len(cited) > 80
    assert sorted(c for c in cited if not _exists(c)) == []


def test_the_tests_the_specification_names_outside_the_golden_cases_exist():
    source = (ROOT / 'scripts/dev/tests/test_offline_verify.py').read_text(encoding='utf-8')
    named = re.findall(r'`(test_[a-z0-9_]+)`', SPEC)
    assert len(named) >= 4
    assert [name for name in named if f'def {name}(' not in source] == []


def test_the_specification_lists_every_refusal_the_checker_can_give():
    # Every fixed part of a Refused message in cli.py is in the specification's table (connectors have their notes).
    cli = (ROOT / 'offline/flowassert_offline/cli.py').read_text(encoding='utf-8')
    for text in ('must be a {kind} integer', 'cannot be combined with', 'is required', 'does not match the header',
                 'exceeds --max-rows limit', 'exceeds --max-bytes limit', 'repeated column name', 'missing column',
                 'a source field is repeated', 'are the same file', 'have identical content', 'unknown member',
                 'missing member', 'must be a two-item list of strings', 'must be a non-empty list',
                 'cannot be set in a configuration file'):
        assert text in cli, text
        assert text.replace('{kind} ', 'positive ') in SPEC or text.replace('{kind} ', 'non-negative ') in SPEC, text


# --- The schema validator ----------------------------------------------------------------------

@pytest.mark.parametrize('case', VALIDATOR_CASES['cases'], ids=lambda c: c['description'])
def test_validator_accepts_and_refuses(case):
    for instance in case['valid']:
        assert json_schema.validate(case['schema'], instance) == []
    for instance in case['invalid']:
        assert json_schema.validate(case['schema'], instance) != [], instance


@pytest.mark.parametrize('case', VALIDATOR_CASES['unsupported'], ids=lambda c: c['description'])
def test_validator_refuses_a_schema_it_does_not_support(case):
    with pytest.raises(json_schema.SchemaError):
        json_schema.validate(case['schema'], case.get('instance', {'a': 1}))


@pytest.mark.parametrize('case', VALIDATOR_CASES['undeclared'], ids=lambda c: c['description'])
def test_validator_lists_undeclared_members(case):
    assert json_schema.undeclared(case['schema'], case['instance']) == case['undeclared']


def test_validator_errors_name_the_path():
    schema = {'properties': {'records': {'items': {'properties': {'state': {'enum': ['Verified']}}}}}}
    assert json_schema.validate(schema, {'records': [{'state': 'Verified'}, {'state': 'x'}]}) == [
        "records[1].state: must be one of ['Verified'], not 'x'"]


# --- The schemas -------------------------------------------------------------------------------

def _schema(version):
    return json.loads(schemas.path(version).read_text(encoding='utf-8'))


def _reports():
    found = []
    for kind, root in CASE_ROOTS.items():
        if root.is_dir():
            for path in sorted(root.glob('*/report.json')):
                found.append((f'{kind}/{path.parent.name}', json.loads(path.read_text(encoding='utf-8'))))
    for path in sorted((ROOT / 'ui/src/test/offline/comparison-cases').glob('*.json')):
        case = json.loads(path.read_text(encoding='utf-8'))
        for side in ('earlier', 'later'):
            if 'report' in case[side]:
                found.append((f'comparison/{path.stem}/{side}', case[side]['report']))
    return found


REPORTS = _reports()


def test_schema_files_are_what_schemas_py_writes_now():
    assert schemas.main(['--check']) == 0
    assert sorted(p.name for p in schemas.OUT.glob('*.json')) == [f'report-v{v}.schema.json' for v in schemas.VERSIONS]


def test_there_is_a_schema_for_every_schema_version_a_report_has():
    assert {report['schema_version'] for _, report in REPORTS} == set(schemas.VERSIONS)
    assert len(REPORTS) > 90


@pytest.mark.parametrize('version', schemas.VERSIONS)
def test_a_schema_is_draft_2020_12_and_stands_alone(version):
    schema = _schema(version)
    assert schema['$schema'] == 'https://json-schema.org/draft/2020-12/schema'
    assert schema['$id'].endswith(f'/schema/report-v{version}.schema.json')
    text = json.dumps(schema)
    assert set(re.findall(r'"\$ref": "([^"]+)"', text)) <= {f'#/$defs/{name}' for name in schema['$defs']}
    assert schema['properties']['schema_version'] == {'const': version}


@pytest.mark.parametrize('name,report', REPORTS, ids=[name for name, _ in REPORTS])
def test_a_report_is_valid_and_the_schema_describes_every_member(name, report):
    schema = _schema(report['schema_version'])
    assert json_schema.validate(schema, report) == []
    assert json_schema.undeclared(schema, report) == []


def _example():
    return json.loads((ROOT / 'offline/golden/rules-fail/report.json').read_text(encoding='utf-8'))


def _mutations():
    def edit(change):
        report = _example()
        change(report)
        return report
    verified = json.loads((ROOT / 'offline/golden/rules-pass/report.json').read_text(encoding='utf-8'))
    exact = json.loads((ROOT / 'offline/golden/scope-exact-source-known/report.json').read_text(encoding='utf-8'))
    sheet = json.loads((ROOT / 'offline/golden-sheets/sheet-verified/report.json').read_text(encoding='utf-8'))
    return {
        'another schema_version': edit(lambda r: r.update(schema_version=9)),
        'no cohort_state': edit(lambda r: r.pop('cohort_state')),
        'a fifth state': edit(lambda r: r.update(cohort_state='Pending')),
        'a claim on a result that is not Verified': edit(lambda r: r.update(claim='It is fine.')),
        'a Verified result without its claim': {**verified, 'claim': None},
        'a Verified result with another claim': {**verified, 'claim': 'Everything arrived.'},
        'a Pending count': edit(lambda r: r['counts'].update(Pending=1)),
        'a negative count': edit(lambda r: r['counts'].update(Mismatch=-1)),
        'a count as text': edit(lambda r: r.update(source_rows_observed='3')),
        'a total while the source population is unknown': edit(lambda r: r.update(source_population_known=False)),
        'a digest that is not one': edit(lambda r: r['inputs'].update(source_sha256='abc')),
        'one encoding without the other': edit(lambda r: r['inputs'].pop('source_encoding')),
        'identical content that was not allowed': edit(lambda r: r['inputs'].update(identical_content=True)),
        'a premise without its origin': edit(lambda r: r['premises']['source_complete'].pop('origin')),
        'a stated count without matched': edit(lambda r: r['premises']['source_count'].pop('matched')),
        'matched without a stated count': edit(lambda r: r['premises']['source_count'].update(matched=True)),
        'a record without a state': edit(lambda r: r['records'][0].pop('state')),
        'a problem record without its rules': edit(lambda r: r['records'][0].pop('rules')),
        'a rule status that does not exist': edit(lambda r: r['records'][0]['rules']['existence'].update(status='ok')),
        'a rule result under another name': edit(lambda r: r['records'][0]['rules'].update(freshness={'status': 'pass', 'reason': 'x'})),
        'a source value without the destination value': edit(lambda r: r['records'][0]['rules']['field:code'].pop('actual')),
        'another evaluator': edit(lambda r: r.update(evaluator='v3')),
        'a local time': edit(lambda r: r.update(evaluated_at='2026-11-02T08:15:30+08:00')),
        'other limitations': edit(lambda r: r.update(limitations='None.')),
        'an assessed workflow': edit(lambda r: r.update(workflow_execution='Ran')),
        'an obligation without fields': edit(lambda r: r['obligation'].update(fields=[])),
        'a key of three columns': edit(lambda r: r['obligation'].update(key=['a', 'b', 'c'])),
        'a rule that does not exist': edit(lambda r: r['obligation'].update(rules=['Trim'] * 6)),
        'scope exact without destination_only': {k: v for k, v in exact.items() if k != 'destination_only'},
        'destination_only with scope source': edit(lambda r: r.update(destination_only=[], destination_only_counts=dict(r['counts']))),
        'a Verified record with rules in a problems report': {
            **verified, 'records': [{**verified['records'][0], 'candidates': 1, 'rules': copy.deepcopy(_example()['records'][0]['rules'])}]},
        'a sheet report without its sheet': {**sheet, 'inputs': {k: v for k, v in sheet['inputs'].items() if k != 'source_sheet'}},
        'a sheet report with a source encoding': {**sheet, 'inputs': {**sheet['inputs'], 'source_encoding': 'utf-8', 'destination_encoding': 'utf-8'}},
        'a sheet whose revision is neither read nor explained': {**sheet, 'inputs': {**sheet['inputs'], 'source_sheet': {**sheet['inputs']['source_sheet'], 'revision': {'available': False}}}},
    }


@pytest.mark.parametrize('name,report', list(_mutations().items()), ids=list(_mutations()))
def test_a_schema_refuses_a_report_that_is_not_one(name, report):
    version = report['schema_version'] if report['schema_version'] in schemas.VERSIONS else 1
    assert json_schema.validate(_schema(version), report) != []


def test_a_schema_allows_a_member_it_does_not_know():
    # docs/compatibility.md: a 1.x release may add a member, and a reader ignores it.
    report = _example()
    report['added_in_a_later_release'] = {'anything': 1}
    report['inputs']['another_digest'] = 'x'
    report['premises']['another_premise'] = {'stated': True, 'origin': 'command-line option'}
    assert json_schema.validate(_schema(1), report) == []
    assert sorted(json_schema.undeclared(_schema(1), report)) == ['added_in_a_later_release',
                                                                  'added_in_a_later_release.anything', 'inputs.another_digest']


# --- The conformance runner --------------------------------------------------------------------

def _run(*args):
    return subprocess.run([sys.executable, str(ROOT / 'offline/bench/conformance.py'), *args], capture_output=True,
                          text=True, timeout=600)


def test_the_reference_implementation_passes_every_case_byte_for_byte():
    done = _run('--bytes', '--html', '--connectors')
    assert done.returncode == 0, done.stdout[-2000:]
    lines = done.stdout.splitlines()
    assert not [line for line in lines if line.startswith('FAIL')]
    listed = _run('--connectors', '--list').stdout.split()
    assert lines[-1] == f'{len(listed)} of {len(listed)} cases pass'
    expected = sum(1 for root in CASE_ROOTS.values() if root.is_dir() for _ in root.iterdir())
    expected += len(list((ROOT / 'offline/conformance').glob('*.json')))
    assert len(listed) == expected


def test_a_command_that_answers_wrongly_fails(tmp_path):
    # An implementation that calls everything Verified: exit 0, a summary, and a report copied from another case.
    wrong = tmp_path / 'always-verified.py'
    report = ROOT / 'offline/golden/rules-pass/report.json'
    wrong.write_text('import shutil, sys\n'
                     f'shutil.copyfile({str(report)!r}, sys.argv[sys.argv.index("--json") + 1])\n'
                     'print("Verified: 3 rows of 3")\n', encoding='utf-8')
    done = _run('--command', f'{sys.executable} {wrong}', '--no-cases', '--only', 'example', '--only', 'rules-pass',
                '--only', 'refused-max-rows')
    assert done.returncode == 1
    assert 'FAIL  golden/example' in done.stdout and 'exit status 0, expected 1' in done.stdout
    assert 'FAIL  golden/refused-max-rows' in done.stdout and 'report.json was written, and the case has none' in done.stdout
    assert 'FAIL  golden/rules-pass' in done.stdout  # the right report, but not the summary
    assert done.stdout.splitlines()[-1] == '0 of 3 cases pass'


def test_an_evaluator_that_answers_wrongly_fails(tmp_path):
    wrong = tmp_path / 'always-verified.py'
    wrong.write_text('import json, sys\ncase = json.load(sys.stdin)\nassert "expected" not in case\n'
                     'n = len(case["source_rows"])\n'
                     'print(json.dumps({"cohort_state": "Verified", "record_states": ["Verified"] * n, "expected_total": n}))\n',
                     encoding='utf-8')
    done = _run('--evaluator', f'{sys.executable} {wrong}', '--no-golden')
    assert done.returncode == 1
    assert 'PASS  conformance/all-verified' in done.stdout
    assert 'FAIL  conformance/field-differs' in done.stdout


def test_a_report_that_differs_only_in_its_time_passes_and_one_without_a_time_fails(tmp_path):
    folder = conformance.GOLDEN / 'example'
    options = conformance.argparse.Namespace(bytes=True, html=False)
    for name in ('report.json',):
        text = (folder / name).read_text(encoding='utf-8')
        (tmp_path / name).write_text(text.replace('2000-01-01T00:00:00Z', '2026-11-09T10:11:12.000123Z'), encoding='utf-8')
    outputs = [(folder / n).read_bytes() for n in ('stdout.txt', 'stderr.txt')]
    assert conformance.compare(folder, tmp_path, 1, *outputs, options) == []
    (tmp_path / 'report.json').write_text(text.replace('2000-01-01T00:00:00Z', 'yesterday'), encoding='utf-8')
    problems = conformance.compare(folder, tmp_path, 1, *outputs, options)
    assert any('is not valid' in p for p in problems) and any("'yesterday' where a UTC time belongs" in p for p in problems)
