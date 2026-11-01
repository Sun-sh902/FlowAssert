"""Verify the historical source map and the separately recorded current Service map.

The accepted Phase 3A map remains historical evidence; a changed workspace is
never identified as that accepted source.  Current identities are explicit and
must be reviewed and updated along with code changes.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SVC = ROOT / 'service'
BASELINE = SVC / 'docs/phase3a/id-addressability-remediation-03/evidence/source-identities.json'
CURRENT = ROOT / 'scripts/dev/backend-current-identity.json'
ACCEPTED_MAP = 'a5d68b75d67624e22223fa8ee9328447d96e639001dfac8cea271e4331b34b45'
CURRENT_MAP = 'df69b8e803c01ae16ab5babe8638c5654855ff42fce85d4814c25df8a0552e0a'


def digest_map(files):
    raw = json.dumps(files, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()
    return hashlib.sha256(raw).hexdigest()


def expected_files():
    baseline = json.loads(BASELINE.read_text())['files']
    current = json.loads(CURRENT.read_text())
    if digest_map(baseline) != ACCEPTED_MAP:
        raise ValueError('historical accepted source map has changed')
    if current['historical_backend_map'] != ACCEPTED_MAP:
        raise ValueError('current identity references an unexpected historical map')
    files = current['files']
    if not set(baseline).issubset(files):
        raise ValueError('current identity omits files in the historical source map')
    for path, digest in files.items():
        p = Path(path)
        if p.is_absolute() or '..' in p.parts or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError('invalid path or digest in current identity')
    if digest_map(files) != current['backend_map'] or current['backend_map'] != CURRENT_MAP:
        raise ValueError('current identity map digest does not match the pinned current identity')
    return baseline, files


def inspect(root):
    baseline, expected = expected_files()
    for directory in ('app', 'tests', 'scripts'):
        actual_names = {str(p.relative_to(root)) for p in (root / directory).glob('*.py')}
        expected_names = {p for p in expected if p.startswith(directory + '/') and p.endswith('.py')}
        if actual_names != expected_names:
            raise ValueError(f'{directory} source inventory differs: {sorted(actual_names ^ expected_names)}')
    actual = {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in expected}
    problems = [p for p in expected if actual[p] != expected[p]]
    return {'historical_backend_map': ACCEPTED_MAP,
            'current_backend_map': digest_map(actual),
            'expected_backend_map': digest_map(expected),
            'changed_from_historical': sorted(p for p in baseline if baseline[p] != expected[p]),
            'additional_current_coverage': sorted(set(expected) - set(baseline)),
            'problems': problems}
