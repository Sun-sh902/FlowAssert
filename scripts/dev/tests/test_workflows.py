"""The GitHub Actions workflows parse, and the release and Pages workflows do what docs/verify-a-release.md says.

The standard library has no YAML reader, and the project takes no dependency for one: `parse` below reads the subset
of YAML the workflows use (block mappings and sequences, literal block scalars, flow sequences of plain words, quoted
and plain scalars, comments) and refuses anything else, so a workflow it cannot read fails the test rather than being
read wrongly. Where Ruby is installed, its YAML reader must give the same values.
"""
import json
from pathlib import Path
import re
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]
# The repository's workflows, and from 1.1.0 the example workflows people copy (examples/github-actions/).
WORKFLOWS = sorted((ROOT / '.github' / 'workflows').glob('*.yml')) + sorted((ROOT / 'examples' / 'github-actions').glob('*.yml'))


class Unsupported(ValueError):
    pass


def _scalar(text):
    text = text.strip()
    if text.startswith('"'):
        if not text.endswith('"') or len(text) < 2:
            raise Unsupported(f'unclosed string {text}')
        return json.loads(text)
    if text.startswith("'"):
        if not text.endswith("'") or len(text) < 2:
            raise Unsupported(f'unclosed string {text}')
        return text[1:-1].replace("''", "'")
    if text.startswith('['):
        if not text.endswith(']'):
            raise Unsupported(f'flow sequence {text}')
        inner = text[1:-1].strip()
        return [_scalar(item) for item in inner.split(',')] if inner else []
    if text.startswith(('{', '&', '*', '!', '>', '%', '@', '`')):
        raise Unsupported(f'scalar {text}')
    if text in ('true', 'false'):
        return text == 'true'
    if text in ('null', '~', ''):
        return None
    if re.fullmatch(r'-?[0-9]+', text):
        return int(text)
    return text


def _strip_comment(line):
    out, quote = '', None
    for i, ch in enumerate(line):
        if quote:
            if ch == quote:
                quote = None
        elif ch in '"\'' and (i == 0 or line[i - 1] in ' :[,-'):
            quote = ch
        elif ch == '#' and (i == 0 or line[i - 1] == ' '):
            return out.rstrip()
        out += ch
    return out.rstrip()


def parse(text):
    """The value of a YAML document in the workflows' subset."""
    lines = []
    for raw in text.split('\n'):
        if '\t' in raw[:len(raw) - len(raw.lstrip())]:
            raise Unsupported('a tab in indentation')
        lines.append(raw)
    pos = 0

    def skip():
        nonlocal pos
        while pos < len(lines) and not _strip_comment(lines[pos]).strip():
            pos += 1

    def indent_of(line):
        return len(line) - len(line.lstrip(' '))

    def block_scalar(parent_indent):
        nonlocal pos
        body = []
        indent = None
        while pos < len(lines):
            line = lines[pos]
            if line.strip() and indent_of(line) <= parent_indent:
                break
            if line.strip():
                indent = indent_of(line) if indent is None else indent
                if indent_of(line) < indent:
                    raise Unsupported('a block scalar line less indented than its first')
            body.append(line)
            pos += 1
        while body and not body[-1].strip():
            body.pop()
        return '\n'.join(line[indent:] if line.strip() else '' for line in body) + '\n'

    def value_after(rest, indent):
        nonlocal pos
        rest = _strip_comment(rest).strip() if not rest.strip().startswith(('"', "'")) else rest.strip()
        if rest == '|':
            return block_scalar(indent)
        if rest.startswith(('|', '>')):
            raise Unsupported(f'block scalar {rest}')
        if rest:
            return _scalar(rest)
        skip()
        if pos < len(lines) and indent_of(lines[pos]) > indent:
            return node(indent_of(lines[pos]))
        if pos < len(lines) and indent_of(lines[pos]) == indent and lines[pos].lstrip().startswith('- '):
            return node(indent)
        return None

    def node(indent):
        nonlocal pos
        skip()
        first = _strip_comment(lines[pos])
        if first[indent:].startswith('- ') or first[indent:] == '-':
            out = []
            while True:
                skip()
                if pos >= len(lines) or indent_of(lines[pos]) != indent or not lines[pos][indent:].startswith('-'):
                    break
                item = lines[pos][indent + 1:]
                inner = indent + 1 + (len(item) - len(item.lstrip(' ')))
                if re.match(r'\s*[A-Za-z0-9_-]+:(\s|$)', item):
                    lines[pos] = ' ' * inner + item.lstrip(' ')
                    out.append(mapping(inner))
                else:
                    pos += 1
                    out.append(value_after(item, indent))
            return out
        return mapping(indent)

    def mapping(indent):
        nonlocal pos
        out = {}
        while True:
            skip()
            if pos >= len(lines) or indent_of(lines[pos]) != indent:
                break
            line = lines[pos]
            if line[indent:].startswith('- '):
                break
            m = re.match(r'([A-Za-z0-9_.-]+|"[^"]+"):(?:\s(.*))?$', line[indent:])
            if not m:
                raise Unsupported(f'line {pos + 1}: {line.strip()}')
            key = m.group(1).strip('"')
            if key in out:
                raise Unsupported(f'line {pos + 1}: {key} twice')
            pos += 1
            out[key] = value_after(m.group(2) or '', indent)
        if pos < len(lines) and lines[pos].strip() and indent_of(lines[pos]) > indent:
            raise Unsupported(f'line {pos + 1}: unexpected indentation')
        return out

    skip()
    result = node(0)
    skip()
    if pos != len(lines):
        raise Unsupported(f'line {pos + 1}: not read')
    return result


def test_the_parser_reads_its_subset_and_refuses_the_rest():
    assert parse('a: 1\nb:\n  - x\n  - "y"\n  - k: v\n    l: [a, b]\nc: |\n  one\n  two\nd: true  # comment\n') == {
        'a': 1, 'b': ['x', 'y', {'k': 'v', 'l': ['a', 'b']}], 'c': 'one\ntwo\n', 'd': True}
    for text in ('a: &x 1\n', 'a: {b: 1}\n', 'a: >\n  folded\n', 'a: 1\na: 2\n', 'a:\n\tb: 1\n'):
        with pytest.raises(Unsupported):
            parse(text)


@pytest.mark.parametrize('path', WORKFLOWS, ids=[p.name for p in WORKFLOWS])
def test_every_workflow_parses_and_names_a_job_with_steps(path):
    workflow = parse(path.read_text(encoding='utf-8'))
    assert isinstance(workflow['name'], str) and 'on' in workflow
    for job in workflow['jobs'].values():
        assert job['steps'] and all('uses' in step or 'run' in step for step in job['steps'])


@pytest.mark.skipif(shutil.which('ruby') is None, reason='Ruby is not installed')
@pytest.mark.parametrize('path', WORKFLOWS, ids=[p.name for p in WORKFLOWS])
def test_where_ruby_is_installed_its_yaml_reader_gives_the_same_values(path):
    out = subprocess.run(['ruby', '-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.load_file(ARGV[0]))', str(path)],
                         capture_output=True, text=True, check=True).stdout
    ruby = json.loads(out)
    ruby['on'] = ruby.pop('true', ruby.get('on'))  # YAML 1.1 reads the key "on" as true
    assert parse(path.read_text(encoding='utf-8')) == ruby


def _workflow(name):
    return parse((ROOT / '.github' / 'workflows' / name).read_text(encoding='utf-8'))


def _uses(workflow):
    return [step['uses'] for job in workflow['jobs'].values() for step in job['steps'] if 'uses' in step]


def test_the_release_workflow_runs_only_on_a_tag_or_by_hand_and_makes_only_a_draft():
    w = _workflow('release.yml')
    assert w['on'] == {'push': {'tags': ['v*']}, 'workflow_dispatch': None}
    assert w['permissions'] == {'contents': 'read'}
    build, draft = w['jobs']['build'], w['jobs']['draft']
    assert build['permissions'] == {'contents': 'read', 'id-token': 'write', 'attestations': 'write'}
    assert draft['permissions'] == {'contents': 'write'}
    assert draft['if'] == "github.event_name == 'push'" and draft['needs'] == 'build'
    release = next(step['run'] for step in draft['steps'] if 'run' in step)
    assert 'gh release create' in release and '--draft' in release and '--verify-tag' in release
    assert 'publish' not in release.replace('published', '') and '--latest' not in release


def test_the_release_workflow_attests_every_file_it_uploads_and_writes_their_checksums():
    build = _workflow('release.yml')['jobs']['build']
    steps = build['steps']
    attest = next(step for step in steps if step.get('uses', '').startswith('actions/attest-build-provenance@'))
    subjects = attest['with']['subject-path'].split()
    assert subjects == ['release/*.whl', 'release/*.tar.gz', 'release/flowassert-check.js', 'release/SHA256SUMS']
    runs = '\n'.join(step.get('run', '') for step in steps)
    assert 'python -m build --sdist --wheel --outdir release ./offline' in runs
    assert 'build==1.6.1' in runs  # a release-only tool, at a fixed version
    assert 'cp dist-lib/flowassert-check.js ../release/' in runs and 'flowassert-site.tar.gz' in runs
    assert 'sha256sum -- * > SHA256SUMS' in runs
    # The checksums are written after every other file, and the attestation after the checksums.
    order = [i for i, step in enumerate(steps) if 'SHA256SUMS' in step.get('run', '') or step is attest]
    assert order == sorted(order) and steps.index(attest) > order[0]
    upload = next(step for step in steps if step.get('uses', '').startswith('actions/upload-artifact@'))
    assert upload['with']['path'] == 'release/' and steps.index(upload) > steps.index(attest)


def test_the_pages_workflow_attests_the_artifact_it_deploys():
    w = _workflow('pages.yml')
    build = w['jobs']['build']
    assert build['permissions'] == {'contents': 'read', 'id-token': 'write', 'attestations': 'write'}
    steps = build['steps']
    upload = next(i for i, s in enumerate(steps) if s.get('uses', '').startswith('actions/upload-pages-artifact@'))
    attest = next(i for i, s in enumerate(steps) if s.get('uses', '').startswith('actions/attest-build-provenance@'))
    assert attest == upload + 1
    assert steps[attest]['with']['subject-path'] == '${{ runner.temp }}/artifact.tar'
    assert steps[upload]['with']['retention-days'] == 90
    assert w['on'] == {'workflow_dispatch': None}


# The major versions checked with `gh api repos/actions/NAME/releases/latest` on 2026-11-10.
LATEST = {'actions/checkout': 'v7', 'actions/setup-node': 'v7', 'actions/setup-python': 'v7',
          'actions/upload-artifact': 'v7', 'actions/download-artifact': 'v8', 'actions/upload-pages-artifact': 'v5',
          'actions/deploy-pages': 'v5', 'actions/attest-build-provenance': 'v4'}


@pytest.mark.parametrize('path', WORKFLOWS, ids=[p.name for p in WORKFLOWS])
def test_every_action_is_a_known_action_at_its_current_major_version(path):
    # The examples use FlowAssert's own Action at the version the CHANGELOG's latest section names.
    own = re.search(r'^## (\d+\.\d+\.\d+)', (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8'), re.M).group(1)
    for uses in _uses(parse(path.read_text(encoding='utf-8'))):
        if uses.startswith('./'):
            continue
        if uses.startswith('Sun-sh902/FlowAssert@'):
            assert uses == f'Sun-sh902/FlowAssert@v{own}', uses
            continue
        name, version = uses.split('@')
        assert LATEST.get(name) == version, uses
