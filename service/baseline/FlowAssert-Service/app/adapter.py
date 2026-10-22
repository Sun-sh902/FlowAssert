"""The research evaluator is the only verdict calculator."""
import copy
from datetime import datetime, timezone
from .identity import ServiceError, canonical, digest, check_sources, load_evaluator


def validate_input(value):
    def walk(v):
        if type(v) is int and abs(v) > 2**53-1:
            raise ServiceError(422, 'unsafe_integer')
        if isinstance(v, dict):
            if any(type(k) is not str for k in v):
                raise ServiceError(422, 'invalid_json')
            for x in v.values(): walk(x)
        elif isinstance(v, list):
            for x in v: walk(x)
        elif type(v) not in (str, int, float, bool, type(None)):
            raise ServiceError(422, 'invalid_json')
    walk(value)
    try: size = len(canonical(value))
    except (ValueError, TypeError): raise ServiceError(422, 'invalid_json') from None
    if size > 1048576 or len(value.get('source', {}).get('rows', [])) > 200:
        raise ServiceError(422, 'offline_scope_limit')


class Adapter:
    def __init__(self):
        self.calls = []

    def evaluate(self, evidence):
        validate_input(evidence)
        check_sources()
        evaluate = load_evaluator()
        supplied = copy.deepcopy(evidence)
        before = digest(supplied)
        at = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        try: result = evaluate(supplied)
        except Exception: raise ServiceError(503, 'evaluator_failure') from None
        if digest(supplied) != before:
            raise ServiceError(503, 'input_mutated')
        check_sources()
        self.calls.append({'input_sha256': before, 'result_sha256': digest(result), 'service_executed_at': at})
        return result, at
