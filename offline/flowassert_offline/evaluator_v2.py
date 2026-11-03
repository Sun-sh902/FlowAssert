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

Rows are consumed once, source first. The source rows are indexed, and each
destination row is folded into the entry for its key as it is read, so no
destination row is kept. Records are built when they are read from the result.
"""
from array import array
from collections.abc import Sequence

VERSION = "v2-current-state-1"
STATES = ("Verified", "Mismatch", "Pending", "Unverified")
DETAILS = ("problems", "all")
_STATE_CODE = {name: code for code, name in enumerate(STATES)}


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


class _Records(Sequence):
    """The records of one evaluation in source order, each built when it is read."""

    def __init__(self, evaluation, details, redact=False):
        self._e = evaluation
        self._details = details
        self._redact = redact

    def __len__(self):
        return len(self._e.states)

    def __getitem__(self, position):
        if not isinstance(position, int):
            raise TypeError("records are indexed by position")
        if position < 0:
            position += len(self)
        if not 0 <= position < len(self):
            raise IndexError("record position out of range")
        return self._build(position)

    def __iter__(self):
        for position in range(len(self)):
            yield self._build(position)

    def problems(self):
        """The records that are not Verified, in source order."""
        verified = _STATE_CODE["Verified"]
        for position, code in enumerate(self._e.states):
            if code != verified:
                yield self._build(position)

    def redacted(self):
        return _Records(self._e, self._details, redact=True)

    def _build(self, position):
        if self._details == "problems" and self._e.states[position] == _STATE_CODE["Verified"]:
            record = {"key": self._e.keys[position], "source_row": position, "state": "Verified"}
        else:
            record = self._e.record(position)
        if self._redact:
            record["key"] = "[redacted]"
            for rule in record.get("rules", {}).values():
                for name in ("expected", "actual"):
                    rule.pop(name, None)
        return record


class _Evaluation:
    def __init__(self, obligation, source_complete, destination_complete):
        self.source_key, self.destination_key = obligation["key"]
        self.fields = obligation["fields"]
        self.source_complete = source_complete is True
        self.destination_complete = destination_complete is True
        self.keys = []      # per source row: its key, or None
        self.values = []    # per source row: its compared field values
        self.first = {}     # key -> position of the first source row with it
        self.repeated = set()
        self.invalid_source_keys = 0
        self.candidates = None   # per first position: destination rows carrying the key
        self.actual = {}    # first position -> destination values, only where they differ from the source
        self.destination_rows = 0
        self.keyless = 0

    def add_source(self, row):
        position = len(self.keys)
        key = _key(row.get(self.source_key))
        if key is None:
            self.invalid_source_keys += 1
        elif self.first.setdefault(key, position) != position:
            self.repeated.add(key)
        self.keys.append(key)
        self.values.append(tuple(row.get(s) for s, _ in self.fields))

    def add_destination(self, row):
        if self.candidates is None:
            self.candidates = array("q", bytes(8 * len(self.keys)))
        self.destination_rows += 1
        key = _key(row.get(self.destination_key))
        if key is None:
            self.keyless += 1
            return
        position = self.first.get(key)
        if position is None:
            return
        self.candidates[position] += 1
        if key in self.repeated:
            return
        if self.candidates[position] == 1:
            actual = tuple(row.get(d) for _, d in self.fields)
            if actual != self.values[position]:
                self.actual[position] = actual
        else:
            self.actual.pop(position, None)  # no arbitrary candidate is selected

    def finish(self, details):
        if self.candidates is None:
            self.candidates = array("q", bytes(8 * len(self.keys)))
        # A destination row that cannot be matched could be the record being looked for.
        self.coverage = self.destination_complete and self.keyless == 0
        self.states = bytearray(_STATE_CODE[self.record(p)["state"]] for p in range(len(self.keys)))
        counts = {name: 0 for name in STATES}
        for code in self.states:
            counts[STATES[code]] += 1
        population_known = self.source_complete and self.invalid_source_keys == 0 and not self.repeated
        result = {"evaluator": VERSION, "counts": counts, "records": _Records(self, details),
                  "expected_total": len(self.keys) if population_known else None,
                  "source_rows_observed": len(self.keys), "source_population_known": population_known,
                  "destination_coverage_sufficient": self.coverage, "destination_rows_without_key": self.keyless,
                  "workflow_execution": "Not assessed", "business_truth": "Not assessed",
                  "existed_by_deadline": "Not assessed", "acquisition_authenticity": "not_authenticated",
                  "premises": self._premises()}
        if counts["Mismatch"]:
            cohort = "Mismatch"
        elif self.keys and population_known and counts["Verified"] == len(self.keys):
            cohort = "Verified"
        else:
            cohort = "Unverified"
        result["cohort_state"] = cohort
        return result

    def _premises(self):
        return {
            "source_complete": {"stated": self.source_complete},
            "destination_complete": {"stated": self.destination_complete},
        }

    def record(self, position):
        key = self.keys[position]
        names = ["existence", "uniqueness"] + ["field:" + s for s, _ in self.fields]
        rules = {name: _rule("unknown", "insufficient evidence") for name in names}
        candidates = self.candidates[self.first[key]] if key is not None else 0
        if key is None or key in self.repeated:
            for name in rules:
                rules[name]["reason"] = "invalid or duplicate source key"
        elif candidates > 1:
            rules["existence"] = _rule("pass", "candidates observed")
            rules["uniqueness"] = _rule("fail", "more than one destination row carries this key")
            for source_field, _ in self.fields:
                rules["field:" + source_field]["reason"] = "no arbitrary candidate selected"
        elif candidates:
            rules["existence"] = _rule("pass", "candidate observed")
            if self.coverage:
                rules["uniqueness"] = _rule("pass", "one row in stated complete destination")
            expected = self.values[position]
            actual = self.actual.get(position, expected)
            for (source_field, _), e, a in zip(self.fields, expected, actual):
                rules["field:" + source_field] = _compare(e, a)
        elif self.coverage:
            rules["existence"] = _rule("fail", "key not found in stated complete destination")
        else:
            rules["existence"] = _rule("unknown", "destination not stated complete; absence not established")
        return {"key": key, "source_row": position, "state": _state(rules), "candidates": candidates, "rules": rules}


def evaluate(obligation, source_rows, destination_rows, *, source_complete=False, destination_complete=False,
             details="all"):
    """`obligation` is {"key": (source, destination), "fields": [(source, destination), ...]}.
    Rows are mappings, read once each, source rows first.

    `details` "all" builds every record in full; "problems" keeps only key, source_row and state
    for a Verified record. The returned "records" is a read-only sequence."""
    if details not in DETAILS:
        raise ValueError(f"details must be one of {', '.join(DETAILS)}")
    evaluation = _Evaluation(obligation, source_complete, destination_complete)
    for row in source_rows:
        evaluation.add_source(row)
    for row in destination_rows:
        evaluation.add_destination(row)
    return evaluation.finish(details)
