"""Evaluator v2: current state at observation, for selected fields.

Separate from the frozen v1 in service/vendor/model.py, which the Service keeps
using. v2 has no connector and no clock. It answers one question: do the supplied
destination rows satisfy the rules for the supplied source rows?

Premises are stated by the caller and never authenticated:
  source_complete       the source rows are the whole cohort
  destination_complete  the destination rows cover the whole object

Without a premise the matching conclusion stays unknown. Absence and uniqueness
need destination_complete. A field that differs is a Mismatch either way, because
a row that exists can disprove a rule on its own. Comparison is exact: no trimming,
case folding, or other normalization. There is no waiting window, so a result is
never Pending.
"""
from collections import Counter

VERSION = "v2-current-state-1"
STATES = ("Verified", "Mismatch", "Pending", "Unverified")


def _key(value):
    return value if isinstance(value, str) and value.strip() else None


def _rule(status, reason, **detail):
    return dict(status=status, reason=reason, **detail)


def _state(rules):
    values = [r["status"] for r in rules.values()]
    if "fail" in values:
        return "Mismatch"
    return "Verified" if values and all(v == "pass" for v in values) else "Unverified"


def _compare(expected, actual):
    if not expected or not actual:
        return _rule("unknown", "empty value; a missing value is not assumed to be a difference",
                     expected=expected, actual=actual)
    status = "pass" if expected == actual else "fail"
    return _rule(status, "exact string comparison", expected=expected, actual=actual)


def evaluate(obligation, source_rows, destination_rows, *, source_complete=False, destination_complete=False):
    """`obligation` is {"key": (source, destination), "fields": [(source, destination), ...]}."""
    source_key, destination_key = obligation["key"]
    fields = obligation["fields"]
    keys = Counter(_key(r.get(source_key)) for r in source_rows)
    index = {}
    keyless = 0
    for row in destination_rows:
        key = _key(row.get(destination_key))
        if key is None:
            keyless += 1
        else:
            index.setdefault(key, []).append(row)
    # A destination row that cannot be matched could be the record being looked for.
    coverage = destination_complete is True and keyless == 0

    records = []
    for position, row in enumerate(source_rows):
        key = _key(row.get(source_key))
        names = ["existence", "uniqueness"] + ["field:" + s for s, _ in fields]
        rules = {name: _rule("unknown", "insufficient evidence") for name in names}
        candidates = index.get(key, []) if key is not None else []
        if key is None or keys[key] != 1:
            for name in rules:
                rules[name] = _rule("unknown", "invalid or duplicate source key")
        elif len(candidates) > 1:
            rules["existence"] = _rule("pass", "candidates observed")
            rules["uniqueness"] = _rule("fail", "more than one destination row carries this key")
            for source_field, _ in fields:
                rules["field:" + source_field] = _rule("unknown", "no arbitrary candidate selected")
        elif candidates:
            rules["existence"] = _rule("pass", "candidate observed")
            if coverage:
                rules["uniqueness"] = _rule("pass", "one row in stated complete destination")
            for source_field, destination_field in fields:
                rules["field:" + source_field] = _compare(row.get(source_field), candidates[0].get(destination_field))
        elif coverage:
            rules["existence"] = _rule("fail", "key not found in stated complete destination")
        else:
            rules["existence"] = _rule("unknown", "destination not stated complete; absence not established")
        records.append({"key": key, "source_row": position, "state": _state(rules),
                        "candidates": len(candidates), "rules": rules})

    counts = {name: sum(r["state"] == name for r in records) for name in STATES}
    population_known = source_complete is True and all(k is not None and n == 1 for k, n in keys.items())
    if counts["Mismatch"]:
        cohort = "Mismatch"
    elif records and population_known and counts["Verified"] == len(records):
        cohort = "Verified"
    else:
        cohort = "Unverified"
    return {"evaluator": VERSION, "cohort_state": cohort, "counts": counts, "records": records,
            "expected_total": len(records) if population_known else None,
            "source_rows_observed": len(records), "source_population_known": population_known,
            "destination_coverage_sufficient": coverage, "destination_rows_without_key": keyless,
            "workflow_execution": "Not assessed", "business_truth": "Not assessed",
            "existed_by_deadline": "Not assessed", "acquisition_authenticity": "not_authenticated"}
