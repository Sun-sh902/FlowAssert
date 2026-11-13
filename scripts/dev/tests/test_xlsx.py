"""The .xlsx reader (offline/flowassert_offline/xlsx.py, docs/design/1.1-excel.md) beyond its golden cases: workbooks
from independent writers, the same results as CSV files for every golden case a worksheet can express, and the bounds
and refusals a golden case cannot hold."""
import contextlib
import csv
import io
import json
import os
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'offline'))
sys.path.insert(0, str(ROOT / 'offline' / 'bench'))
from flowassert_offline import cli, xlsx  # noqa: E402
from flowassert_offline.errors import Refused  # noqa: E402
import xlsx_writer as w  # noqa: E402

FIXTURES = ROOT / 'offline' / 'xlsx-fixtures'
GOLDEN = ROOT / 'offline' / 'golden'
EXPECTED = json.loads((FIXTURES / 'expected.json').read_text(encoding='utf-8'))


@pytest.mark.parametrize('name', sorted(EXPECTED))
def test_a_workbook_from_an_independent_writer_is_read_as_the_design_note_says(name):
    expected = EXPECTED[name]
    path = FIXTURES / name.split('#')[0]
    f = xlsx.XlsxFile(str(path), [], worksheet=expected['worksheet'])
    assert list(f.full_rows()) == expected['rows']
    for member in ('cells', 'hidden_rows', 'merged_ranges', 'date_system', 'worksheet_state', 'sheets'):
        if member in expected:
            assert f.member[member] == expected[member], member


def test_the_fixtures_are_the_ones_the_readme_names():
    assert sorted(p.name for p in FIXTURES.glob('*.xlsx')) == ['exceljs-4.4.0.xlsx', 'sheetjs-0.18.5-1904.xlsx',
                                                               'sheetjs-0.18.5-inline.xlsx']
    assert json.loads((FIXTURES / 'package.json').read_text())['dependencies'] == {'exceljs': '4.4.0', 'xlsx': '0.18.5'}


# --- The same rows in a worksheet and in a CSV file give the same result -----------------------------------------

def _run(args, folder):
    stdout, stderr = io.StringIO(), io.StringIO()
    cwd = os.getcwd()
    os.chdir(folder)
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = cli.main(args + ['--json', 'report.json'])
    finally:
        os.chdir(cwd)
    report = json.loads((folder / 'report.json').read_text()) if (folder / 'report.json').exists() else None
    return code, report


def _expressible(data):
    """The rows of a CSV file when a worksheet can hold exactly them, else None."""
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        return None
    rows = list(csv.reader(io.StringIO(text, newline=''), strict=True))
    rows = [r for r in rows if r]
    if not rows or not rows[0] or rows[0][-1] == '' or any(len(r) != len(rows[0]) for r in rows):
        return None
    if any(all(v == '' for v in r) for r in rows[1:]) or any(len(v) > xlsx.FIELD_LIMIT for r in rows for v in r):
        return None
    return rows


VERDICT = ('records', 'counts', 'cohort_state', 'expected_total', 'source_rows_observed', 'source_population_known',
           'destination_coverage_sufficient', 'destination_rows_without_key', 'destination_only',
           'destination_only_counts', 'obligation', 'claim')


def _cases():
    out = []
    for folder in sorted(GOLDEN.iterdir()):
        case = json.loads((folder / 'case.json').read_text(encoding='utf-8'))
        code = int((folder / 'exit_status.txt').read_text())
        args = case['args']
        if code not in (0, 1, 3) or 'source.csv' not in args or any(a.endswith('-encoding') for a in args) and \
                any(e in args for e in ('utf-16', 'gb18030')):
            continue
        for side, other in (('source', 'destination'), ('destination', 'source')):
            rows = _expressible((folder / f'{side}.csv').read_bytes())
            # A worksheet whose canonical form is the other file's bytes is identical content, refused by design.
            if rows is not None and ''.join(xlsx.canonical_row(r) for r in rows).encode('utf-8') != \
                    (folder / f'{other}.csv').read_bytes():
                out.append((folder.name, side))
    return out


CASES = _cases()


def test_most_golden_results_are_also_checked_from_a_worksheet():
    assert len(CASES) >= 80


@pytest.mark.parametrize('name,side', CASES, ids=[f'{n}-{s}' for n, s in CASES])
def test_the_same_rows_in_a_worksheet_give_the_same_result(tmp_path, name, side):
    folder = GOLDEN / name
    for file in folder.iterdir():
        if file.name not in ('report.json', 'report.html', 'stdout.txt', 'stderr.txt', 'exit_status.txt', 'case.json'):
            (tmp_path / file.name).write_bytes(file.read_bytes())
    rows = _expressible((folder / f'{side}.csv').read_bytes())
    (tmp_path / f'{side}.xlsx').write_bytes(w.from_rows(rows))
    args = json.loads((folder / 'case.json').read_text(encoding='utf-8'))['args']
    args = [f'{side}.xlsx' if a == f'{side}.csv' else a for a in args]
    position = args.index(f'--{side}')
    args[position + 2:position + 2] = [f'--{side}-format', 'xlsx']
    # An encoding was stated for the CSV file; a workbook has none.
    for option in (f'--{side}-encoding',):
        while option in args:
            i = args.index(option)
            del args[i:i + 2]
    code, report = _run(args, tmp_path)
    expected = json.loads((folder / 'report.json').read_text(encoding='utf-8'))
    assert code == int((folder / 'exit_status.txt').read_text())
    assert report['schema_version'] == 4
    assert {k: report.get(k) for k in VERDICT} == {k: expected.get(k) for k in VERDICT}
    assert {k: {m: v for m, v in p.items() if m != 'origin'} for k, p in report['premises'].items()} == \
        {k: {m: v for m, v in p.items() if m != 'origin'} for k, p in expected['premises'].items()}


# --- Bounds and refusals no golden case holds --------------------------------------------------------------------

def _refusal(tmp_path, data, **options):
    path = tmp_path / 'book.xlsx'
    path.write_bytes(data)
    with pytest.raises(Refused) as e:
        list(xlsx.XlsxFile(str(path), [], **options))
    return str(e.value)


def test_more_than_ten_thousand_entries_are_refused(tmp_path):
    data = w.raw_zip([{'name': f'p{i}', 'data': b'', 'method': 0} for i in range(10_001)])
    assert _refusal(tmp_path, data).endswith('book.xlsx: more than 10000 ZIP entries')
    data = w.raw_zip([{'name': f'p{i}', 'data': b'', 'method': 0} for i in range(10_000)])
    assert _refusal(tmp_path, data).endswith('book.xlsx: missing part [Content_Types].xml')


def test_a_workbook_that_changes_while_it_is_read_is_refused(tmp_path, monkeypatch):
    path = tmp_path / 'book.xlsx'
    path.write_bytes(w.from_rows([['id'], ['a']]))
    original = xlsx.WorksheetReader.open

    def touch(self):
        original(self)
        os.utime(path, ns=(1, 1))
    monkeypatch.setattr(xlsx.WorksheetReader, 'open', touch)
    with pytest.raises(Refused, match='changed while it was read; run the check again$'):
        list(xlsx.XlsxFile(str(path), ['id']))


def test_the_fast_path_and_the_tokenizer_read_rows_the_same_way(tmp_path):
    # The same worksheet, once in the form the fast path takes and once spaced so that every element is an event.
    rows = [['id', 'n', 'when'], ['a', w.Cell(v='1.5'), w.Cell(v='45973', s=1)], ['b', w.Cell(f='1+1', v='2'),
                                                                               w.Cell(t='b', v='1')]]
    plain = w.Book(sheets=[w.Sheet('S', rows)], xfs=(0, 14))
    parts = w.parts(plain)
    spaced = dict(parts)
    spaced['xl/worksheets/sheet1.xml'] = parts['xl/worksheets/sheet1.xml'].replace(b'<c ', b'\n <c ').replace(
        b'<si>', b'\n<si>')
    read = []
    for items in (parts, spaced):
        path = tmp_path / f'{len(read)}.xlsx'
        path.write_bytes(w.zip_bytes(items.items()))
        f = xlsx.XlsxFile(str(path), [])
        read.append((list(f.full_rows()), f.sha256, f.member['cells']))
    assert read[0] == read[1]
    assert read[0][0] == [['id', 'n', 'when'], ['a', '1.5', '2025-11-12'], ['b', '2', 'TRUE']]


def test_number_text_follows_ecmascript():
    for x, text in ((0.0, '0'), (-0.0, '0'), (1e21, '1e+21'), (1e-7, '1e-7'), (123e-20, '1.23e-18'), (0.000001, '0.000001'),
                    (1.5, '1.5'), (-2.5e-7, '-2.5e-7'), (100.0, '100'), (123456789012345680000.0, '123456789012345680000'),
                    (5e-324, '5e-324'), (1.7976931348623157e308, '1.7976931348623157e+308')):
        assert xlsx.number_text(x) == text


# --- Found by fuzzing the two readers against each other (review of 2026-11-13) ---------------------------------

def test_a_sheet_without_a_name_is_recorded_with_an_empty_name(tmp_path):
    # ECMA-376 requires the name, but a hostile file can leave it out. xlsx.ts records it as '', and the schema's
    # worksheet is a string, so the command line records it the same way, in the report and in the summary.
    parts = w.parts(w.Book(sheets=[w.Sheet('Contacts', [['id', 'phone'], ['K1', '1']])]))
    parts['xl/workbook.xml'] = parts['xl/workbook.xml'].replace(b' name="Contacts"', b'')
    (tmp_path / 'source.xlsx').write_bytes(w.zip_bytes(parts.items()))
    (tmp_path / 'destination.csv').write_text('id,phone\nK1,1\nK2,2\n', encoding='utf-8')
    f = xlsx.XlsxFile(str(tmp_path / 'source.xlsx'), [])
    list(f.full_rows())
    assert f.member['worksheet'] == ''
    stdout = io.StringIO()
    cwd = os.getcwd()
    os.chdir(tmp_path)
    try:
        with contextlib.redirect_stdout(stdout):
            code = cli.main(['--source', 'source.xlsx', '--source-format', 'xlsx', '--destination', 'destination.csv',
                             '--key', 'id', '--field', 'phone', '--json', 'report.json'])
    finally:
        os.chdir(cwd)
    assert code == 3
    assert "Source read from worksheet '' of an .xlsx workbook: cells as stored, not as displayed.\n" in stdout.getvalue()
    report = json.loads((tmp_path / 'report.json').read_text(encoding='utf-8'))
    assert report['inputs']['source_workbook']['worksheet'] == ''
    import json_schema
    schema = json.loads((ROOT / 'docs/schema/report-v4.schema.json').read_text(encoding='utf-8'))
    assert json_schema.validate(schema, report) == []
