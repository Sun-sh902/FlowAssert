"""The records to resend (offline/flowassert_offline/exports.py, docs/design/1.1-exports.md): every golden case run with
and without --export-dir gives the same reports, standard error and exit status, and a summary that only gains the
export's lines; each exported row is the row read, byte for byte under its file's header; and the refusals."""
import contextlib
import csv
import io
import json
import os
from pathlib import Path
import shutil
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'offline'))
sys.path.insert(0, str(ROOT / 'offline' / 'bench'))
from flowassert_offline import cli, exports, hubspot, sheets, xlsx  # noqa: E402
import golden  # noqa: E402

OUTPUTS = {'case.json', 'report.json', 'report.html', 'stdout.txt', 'stderr.txt', 'exit_status.txt', 'requests.json',
           'sheet-responses.json', 'hubspot-responses.json'}
KINDS = {'golden': None, 'golden-xlsx': None, 'golden-sheets': 'sheets', 'golden-hubspot': 'hubspot'}
CASES = [(root, p.name) for root in KINDS for p in sorted((ROOT / 'offline' / root).iterdir())
         if (p / 'case.json').exists()]
EXPORT = 'records-to-resend'


def _spec(root, name):
    folder = ROOT / 'offline' / root / name
    case = json.loads((folder / 'case.json').read_text(encoding='utf-8'))
    files = {p.name: p.read_bytes() for p in folder.iterdir() if p.is_file() and p.name not in OUTPUTS}
    spec = {'args': case['args'], 'files': files, 'credential': case.get('credential'), 'env': case.get('env', {})}
    for responses in ('sheet-responses.json', 'hubspot-responses.json'):
        if (folder / responses).exists():
            spec['responses'] = json.loads((folder / responses).read_text(encoding='utf-8'))
    return spec


def _run(kind, spec, folder, extra=()):
    """(exit status, stdout, stderr, {output file: bytes}) of one run in `folder`."""
    spec = dict(spec, args=list(spec['args']) + list(extra))
    for file, data in spec['files'].items():
        (folder / file).write_bytes(data)
    if kind:
        code, stdout, stderr, _ = golden.run_sheet_case(spec, str(folder), kind)
    else:
        out, err = io.StringIO(), io.StringIO()
        cwd = os.getcwd()
        os.chdir(folder)
        saved = cli.datetime
        cli.datetime = golden._FixedDatetime
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = cli.main(spec['args'] + ['--json', 'report.json', '--html', 'report.html'])
        finally:
            cli.datetime = saved
            os.chdir(cwd)
        stdout, stderr = out.getvalue(), err.getvalue()
    reports = {n: (folder / n).read_bytes() for n in ('report.json', 'report.html') if (folder / n).exists()}
    return code, stdout, stderr, reports


def _read_back(path):
    data = path.read_bytes()
    assert data.startswith(b'\xef\xbb\xbf')
    text = data[3:].decode('utf-8')
    assert text == '' or text.endswith('\r\n')
    rows = list(csv.reader(io.StringIO(text, newline=''), strict=True))
    return rows[0], rows[1:]


@pytest.mark.parametrize('root,name', CASES, ids=[f'{r}/{n}' for r, n in CASES])
def test_an_export_changes_no_report_summary_line_or_exit_status(root, name, tmp_path):
    kind = KINDS[root]
    spec = _spec(root, name)
    (tmp_path / 'a').mkdir()
    (tmp_path / 'b').mkdir()
    code, stdout, stderr, reports = _run(kind, spec, tmp_path / 'a')
    code2, stdout2, stderr2, reports2 = _run(kind, spec, tmp_path / 'b', ['--export-dir', EXPORT])
    directory = tmp_path / 'b' / EXPORT
    if '--redact-values' in spec['args']:
        assert code2 == 2 and not reports2 and not directory.exists()
        assert stderr2.endswith('--export-dir cannot be combined with --redact-values: the exported rows hold the '
                                'values\n')
        return
    assert (code2, stderr2, reports2) == (code, stderr, reports)
    if code == 2:
        assert stdout2 == stdout and not directory.exists()
        return
    assert stdout2.startswith(stdout)
    added = stdout2[len(stdout):].splitlines()
    report = json.loads(reports['report.json'])
    names = sorted(p.name for p in directory.iterdir())
    assert names == sorted(n for n in exports.FILES if (directory / n).exists())
    # Each file is listed with its row count, in the design's order.
    listed = [line.split(':')[0].strip() for line in added[1:] if line.strip().split(':')[0] in exports.FILES]
    assert listed == [n for n in exports.FILES if n in names]
    if not names:
        assert added[0] == f'Records to resend: none; {EXPORT} is empty.'
    else:
        assert added[0] == f'Records to resend, written to {EXPORT} (advice from this check, not a further conclusion):'
    # Each source record not Verified is in its one file, and the destination-only rows in theirs.
    want = {n: 0 for n in exports.FILES}
    for record in report['records']:
        file = exports.file_of(record)
        if file:
            want[file] += 1
    for record in report.get('destination_only', []):
        want[exports.ONLY if record['state'] == 'Mismatch' else exports.ONLY_UNKNOWN] += record['rows']
    got = {n: len(_read_back(directory / n)[1]) if n in names else 0 for n in exports.FILES}
    assert got == want
    if exports.MISSING in names:
        assert report['destination_coverage_sufficient']
    for n in names:
        assert f'  {n}: {got[n]} row{"" if got[n] == 1 else "s"}' in '\n'.join(added)


def _source_rows(root, spec, folder):
    """The source's header and data rows, read by an independent reader."""
    args = spec['args']
    path = folder / args[args.index('--source') + 1]
    if '--source-format' in args and args[args.index('--source-format') + 1] == 'xlsx':
        sheet = args[args.index('--source-worksheet') + 1] if '--source-worksheet' in args else None
        rows = list(xlsx.XlsxFile(str(path), [], worksheet=sheet).full_rows())
        return rows[0], rows[1:]
    encoding = args[args.index('--source-encoding') + 1] if '--source-encoding' in args else 'utf-8'
    text = path.read_bytes().decode(cli.ENCODINGS[encoding][0])
    rows = [r for r in csv.reader(io.StringIO(text, newline='')) if r]
    return rows[0], rows[1:]


FILE_CASES = [(r, n) for r, n in CASES if r in ('golden', 'golden-xlsx')
              and (ROOT / 'offline' / r / n / 'exit_status.txt').read_text().strip() != '2'
              and '--source' in json.loads((ROOT / 'offline' / r / n / 'case.json').read_text())['args']
              and '--redact-values' not in json.loads((ROOT / 'offline' / r / n / 'case.json').read_text())['args']]


@pytest.mark.parametrize('root,name', FILE_CASES, ids=[f'{r}/{n}' for r, n in FILE_CASES])
def test_an_exported_row_is_the_source_row_as_read(root, name, tmp_path):
    spec = _spec(root, name)
    _, _, _, reports = _run(None, spec, tmp_path, ['--export-dir', EXPORT])
    report = json.loads(reports['report.json'])
    header, rows = _source_rows(root, spec, tmp_path)
    for file in exports.FILES[:4]:
        path = tmp_path / EXPORT / file
        positions = [r['source_row'] for r in report['records'] if exports.file_of(r) == file]
        if not positions:
            assert not path.exists()
            continue
        got_header, got = _read_back(path)
        assert got_header == header
        assert got == [rows[p] for p in positions]
        # The check's own reader takes the byte order mark as UTF-8's and gives the rows back.
        reader = cli.CsvFile(str(path), header)
        assert [[row[c] for c in header] for row in reader] == got


# --- Bytes, hostile values and the warning ---------------------------------------------------------------------

def _check(folder, source, destination, *extra):
    (folder / 'source.csv').write_bytes(source.encode('utf-8'))
    (folder / 'destination.csv').write_bytes(destination.encode('utf-8'))
    out = io.StringIO()
    cwd = os.getcwd()
    os.chdir(folder)
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()) as err:
            code = cli.main(['--source', 'source.csv', '--destination', 'destination.csv', '--key', 'id',
                             '--field', 'v', '--source-complete', *extra])
    finally:
        os.chdir(cwd)
    return code, out.getvalue(), err.getvalue()


HOSTILE = ['say "hi"', 'two\nlines', 'cr\rhere', 'a,b', '﻿bom inside', '=1+1', '@SUM(A1)', '-2+3', '+44',
           '-5', '\tTab', 'Zoë 名字']


def test_hostile_values_are_kept_exactly_and_formula_like_ones_counted(tmp_path):
    def line(*values):
        return ','.join('"' + v.replace('"', '""') + '"' for v in values) + '\r\n'
    source = line('id', 'v', 'note') + ''.join(line(f'K{i}', v, v) for i, v in enumerate(HOSTILE))
    destination = line('id', 'v')
    code, stdout, _ = _check(tmp_path, source, destination, '--destination-complete', '--export-dir', 'out')
    assert code == 1
    header, rows = _read_back(tmp_path / 'out' / exports.MISSING)
    assert header == ['id', 'v', 'note']
    assert rows == [[f'K{i}', v, v] for i, v in enumerate(HOSTILE)]
    # =1+1, @SUM(A1), -2+3, a tab, twice each; a carriage return inside a value counts only at the start.
    assert '  8 exported fields begin with =, +, -, @, a tab or a carriage return: import the files rather than open ' \
           'them in a spreadsheet.' in stdout
    data = (tmp_path / 'out' / exports.MISSING).read_bytes()
    assert data.startswith(b'\xef\xbb\xbfid,v,note\r\n')
    assert b'K1,"two\nlines","two\nlines"\r\n' in data
    assert b'K0,"say ""hi""","say ""hi"""\r\n' in data
    assert b'K7,-2+3,-2+3\r\n' in data


def test_a_lone_empty_field_is_quoted_so_its_row_is_not_a_blank_line():
    assert exports.row_text(['']) == '""\r\n'
    assert exports.row_text(['', '']) == ',\r\n'
    assert [exports.formula_like(v) for v in ('-5', '+44', '1.5', '-1.5', '-', '=', '-x', '', 'a=b')] == \
        [False, False, False, False, True, True, True, False, False]


def test_one_row_and_one_field_are_singular(tmp_path):
    code, stdout, _ = _check(tmp_path, 'id,v\r\nK1,=x\r\n', 'id,v\r\n', '--destination-complete', '--export-dir',
                             'out')
    assert code == 1
    assert '  missing-from-destination.csv: 1 row\n' in stdout
    assert '  1 exported field begins with =' in stdout


def test_a_destination_not_stated_complete_gives_no_list_of_missing_records(tmp_path):
    code, stdout, _ = _check(tmp_path, 'id,v\r\nK1,a\r\nK2,b\r\n', 'id,v\r\nK2,b\r\n', '--export-dir', 'out')
    assert code == 3  # Unverified
    assert not (tmp_path / 'out' / exports.MISSING).exists()
    assert stdout.endswith('Records to resend, written to out (advice from this check, not a further conclusion):\n'
                           '  unknown-status-resending-may-create-duplicates.csv: 2 rows; resending them may create '
                           'duplicates\n'
                           '  No missing-from-destination.csv: the destination was not stated complete, so absence '
                           'is not established.\n')


def test_nothing_to_resend_leaves_an_empty_directory(tmp_path):
    code, stdout, _ = _check(tmp_path, 'id,v\r\nK1,a\r\n', 'v,id\r\na,K1\r\n', '--destination-complete',
                             '--export-dir', 'out')
    assert code == 0
    assert list((tmp_path / 'out').iterdir()) == []
    assert stdout.endswith('Records to resend: none; out is empty.\n')


# --- Refusals and all or nothing -------------------------------------------------------------------------------

def test_an_existing_directory_is_refused_before_anything_is_read(tmp_path):
    (tmp_path / 'out').mkdir()
    (tmp_path / 'out' / 'older.csv').write_text('x')
    code, _, stderr = _check(tmp_path, 'id,v\r\nK1,a\r\n', 'id,v\r\n', '--export-dir', 'out', '--json', 'r.json')
    assert code == 2 and stderr.endswith('out: exists; --export-dir writes to a new directory\n')
    assert sorted(p.name for p in (tmp_path / 'out').iterdir()) == ['older.csv']
    assert not (tmp_path / 'r.json').exists()
    (tmp_path / 'link').symlink_to(tmp_path / 'nowhere')
    code, _, stderr = _check(tmp_path, 'id,v\r\nK1,a\r\n', 'id,v\r\n', '--export-dir', 'link')
    assert code == 2 and stderr.endswith('link: exists; --export-dir writes to a new directory\n')


def test_redacted_values_are_refused(tmp_path):
    code, _, stderr = _check(tmp_path, 'id,v\r\nK1,a\r\n', 'id,v\r\n', '--export-dir', 'out', '--redact-values')
    assert code == 2 and 'cannot be combined with --redact-values' in stderr
    assert not (tmp_path / 'out').exists()


@pytest.mark.parametrize('side', ['source.csv', 'destination.csv'])
def test_a_file_changed_between_the_two_reads_is_refused_and_nothing_is_written(tmp_path, monkeypatch, side):
    real = exports.build

    def build(*args, **kwargs):
        (tmp_path / side).write_bytes((tmp_path / side).read_bytes() + b'K9,z\r\n')
        return real(*args, **kwargs)
    monkeypatch.setattr(exports, 'build', build)
    code, stdout, stderr = _check(tmp_path, 'id,v\r\nK1,a\r\n', 'id,v\r\nK2,b\r\n', '--destination-complete',
                                  '--scope', 'exact', '--export-dir', 'out', '--json', 'r.json')
    assert code == 2 and stderr.endswith(f'{side}: changed after it was checked; nothing was exported\n')
    assert not (tmp_path / 'out').exists() and not (tmp_path / 'r.json').exists() and stdout == ''


def test_a_report_that_cannot_be_written_removes_the_export(tmp_path):
    (tmp_path / 'r').mkdir()
    code, _, stderr = _check(tmp_path, 'id,v\r\nK1,a\r\n', 'id,v\r\n', '--destination-complete', '--export-dir', 'out',
                             '--json', 'r')
    assert code == 2
    assert not (tmp_path / 'out').exists()


def test_an_export_file_that_cannot_be_written_writes_nothing(tmp_path, monkeypatch):
    real = open

    def failing(path, mode='r', *args, **kwargs):
        if str(path).endswith(exports.DIFFERS):
            raise PermissionError(13, 'Permission denied')
        return real(path, mode, *args, **kwargs)
    monkeypatch.setattr('builtins.open', failing)
    code, _, stderr = _check(tmp_path, 'id,v\r\nK1,a\r\nK2,b\r\n', 'id,v\r\nK2,c\r\n', '--destination-complete',
                             '--export-dir', 'out', '--json', 'r.json')
    monkeypatch.undo()
    assert code == 2 and stderr.endswith('out: Permission denied\n')
    assert not (tmp_path / 'out').exists() and not (tmp_path / 'r.json').exists()


# --- The connectors: rows already read, never requested again ----------------------------------------------------

def spec_key(spec):
    key = spec['args'][spec['args'].index('--key') + 1] if '--key' in spec['args'] else None
    return key.split(':')[-1] if key else None


def test_a_hubspot_destination_is_listed_once_and_its_destination_only_rows_exported(tmp_path, monkeypatch):
    spec = _spec('golden-hubspot', 'hubspot-mismatch')
    spec['args'] = spec['args'] + ['--scope', 'exact']
    # Without C-002, the source leaves one HubSpot contact in the destination only.
    lines = spec['files']['source.csv'].splitlines(keepends=True)
    spec['files']['source.csv'] = b''.join(line for line in lines if not line.startswith(b'C-002,'))
    calls = []
    real = hubspot.HubSpotDestination.__iter__

    def counted(self):
        calls.append(1)
        return real(self)
    monkeypatch.setattr(hubspot.HubSpotDestination, '__iter__', counted)
    code, stdout, _, reports = _run('hubspot', spec, tmp_path, ['--export-dir', EXPORT])
    assert calls == [1]
    report = json.loads(reports['report.json'])
    only = report['destination_only']
    assert len(only) == 1
    header, rows = _read_back(tmp_path / EXPORT / (exports.ONLY if report['source_population_known']
                                                     else exports.ONLY_UNKNOWN))
    assert header == report['inputs']['destination_hubspot']['properties']
    assert len(rows) == 1 and rows[0][header.index(spec_key(spec))] == only[0]['key']


def test_a_sheet_source_is_requested_once(tmp_path):
    spec = _spec('golden-sheets', 'sheet-mismatch')
    (tmp_path / 'a').mkdir()
    (tmp_path / 'b').mkdir()
    for folder in ('a', 'b'):
        for file, data in spec['files'].items():
            (tmp_path / folder / file).write_bytes(data)
    plain = golden.run_sheet_case(spec, str(tmp_path / 'a'), 'sheets')
    exported = golden.run_sheet_case(dict(spec, args=spec['args'] + ['--export-dir', EXPORT]), str(tmp_path / 'b'),
                                     'sheets')
    assert exported[3] == plain[3] and exported[0] == plain[0] == 1
    header, rows = _read_back(tmp_path / 'b' / EXPORT / exports.DIFFERS)
    values = spec['responses']['values'][0]['json']['values']
    assert header == values[0]
    differs = [r['source_row'] for r in json.loads((tmp_path / 'b' / 'report.json').read_text())['records']
               if exports.file_of(r) == exports.DIFFERS]
    assert rows == [values[1 + p] + [''] * (len(values[0]) - len(values[1 + p])) for p in differs]
