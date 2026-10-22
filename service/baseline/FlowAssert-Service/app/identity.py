"""Fixed source identities; compile precisely the bytes whose digest was checked."""
import hashlib
import json
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT.parent / 'FlowAssert-round03-oracle-fix/experiments/round03/model.py'
MODEL_HASH = 'b61779e198dd0213b67f8319b77a2daf9feb502dc553784df6d6600e8e3a842d'
CONTRACT_HASH = '0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230'
EXAMPLES_HASH = '92ea5a883acf903e90543552eec279b1a32ab42403eee37384ca6c1ab6f7b20b'

class ServiceError(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def checked_bytes(path, expected):
    try:
        data = path.read_bytes()
    except OSError:
        raise ServiceError(503, 'identity_unavailable') from None
    if hashlib.sha256(data).hexdigest() != expected:
        raise ServiceError(503, 'source_identity_mismatch')
    return data


def check_sources():
    checked_bytes(MODEL, MODEL_HASH)
    checked_bytes(ROOT / 'contracts/openapi-v1-proposed.yaml', CONTRACT_HASH)
    checked_bytes(ROOT / 'contracts/verification-examples.json', EXAMPLES_HASH)


def load_evaluator():
    module = ModuleType('_flowassert_pinned_model')
    exec(compile(checked_bytes(MODEL, MODEL_HASH), str(MODEL), 'exec'), module.__dict__)
    return module.evaluate
