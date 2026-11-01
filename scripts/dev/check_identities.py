"""Verify the current Service identity and frozen inputs without rewriting historical acceptance.

    /usr/bin/python3 -I -B scripts/dev/check_identities.py
"""
import hashlib
import json
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SVC = ROOT / 'service'
identity = runpy.run_path(str(ROOT / 'scripts/dev/backend_identity.py'))
PINNED = {
    'vendor/model.py': 'b61779e198dd0213b67f8319b77a2daf9feb502dc553784df6d6600e8e3a842d',
    'contracts/openapi-v1-proposed.yaml': '0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230',
    'contracts/openapi-history-v1.yaml': 'f341d8d5ec9da1b933b06efe998c07a1045226500a6b5837e9c8a9ead74bd69f',
    'contracts/openapi-id-addressability-v1.yaml': '59ac38631982147b547ed2dae57ab4e8b2d218e3fa718861eb0c5828befcd8ae',
    'contracts/verification-examples.json': '92ea5a883acf903e90543552eec279b1a32ab42403eee37384ca6c1ab6f7b20b',
}
try:
    status = identity['inspect'](SVC)
    problems = ['current source mismatch: ' + p for p in status['problems']]
    pinned = {}
    for rel, want in PINNED.items():
        actual = hashlib.sha256((SVC / rel).read_bytes()).hexdigest()
        pinned[rel] = 'match' if actual == want else 'mismatch'
        if actual != want:
            problems.append(f'{rel}: {actual} != {want}')
    print(json.dumps({**status, 'pinned': pinned, 'problems': problems}, indent=1))
except (OSError, ValueError, KeyError, TypeError) as exc:
    problems = [str(exc)]
    print(json.dumps({'problems': problems}, indent=1))
sys.exit(1 if problems else 0)
