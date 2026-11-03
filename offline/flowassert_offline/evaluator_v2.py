"""Evaluator v2: current state at observation, for selected fields.

Separate from the frozen v1 in service/vendor/model.py, which the Service keeps
using. v2 has no connector and no clock. It answers one question: do the supplied
destination rows satisfy the rules for the supplied source rows?

Premises are stated by the caller and never authenticated:
  source_complete       the source rows are the whole cohort
  destination_complete  the destination rows cover the whole object
  source_count          the number of source rows the caller saw in the original system
  destination_count     the same for the destination

Without a premise the matching conclusion stays unknown. Absence and uniqueness
need destination_complete. A stated count that differs from the rows supplied
withdraws the matching completeness premise; a count that agrees adds nothing.
A field that differs is a Mismatch either way, because a row that exists can
disprove a rule on its own. There is no waiting window, so a result is never
Pending.

Each field has one comparison rule, chosen by the caller and never inferred:
  exact        the strings as they are (the default)
  trim         after removing leading and trailing whitespace
  casefold     after Unicode case folding
  digits       only the digits 0-9; no digits is unknown, not a match
  date:FORMAT  both parsed with datetime.strptime; a value that does not parse is unknown.
               A value with a UTC offset is compared as an instant, in UTC
An empty value is unknown under every rule.

The obligation's scope is "source" (each source record is checked) or "exact"
(also, a destination key that is not in the source is a destination-only record).
A destination-only row exists, so it needs no destination premise; it is a Mismatch
only when the source population is known, because otherwise the key could belong
to a source row that was not supplied.

Rows are consumed once, source first. The source rows are indexed, and each
destination row is folded into the entry for its key as it is read, so no
destination row is kept. Records are built when they are read from the result.
"""
from array import array
from collections.abc import Sequence
from datetime import datetime, timezone

VERSION = "v2-current-state-1"
STATES = ("Verified", "Mismatch", "Pending", "Unverified")
SCOPES = ("source", "exact")
DETAILS = ("problems", "all")
_STATE_CODE = {name: code for code, name in enumerate(STATES)}
_EMPTY = "empty value; a missing value is not assumed to be a difference"
_DATE_SAMPLE = datetime(2001, 2, 3, 4, 5, 6, 7000, tzinfo=timezone.utc)


def _key(value):
    return value if isinstance(value, str) and value.strip() else None


def _rule(status, reason, **detail):
    return dict(status=status, reason=reason, **detail)


def _state(rules):
    values = [r["status"] for r in rules.values()]
    if "fail" in values:
        return "Mismatch"
    return "Verified" if values and all(v == "pass" for v in values) else "Unverified"


def parse_rule(rule):
    """Return a comparison rule unchanged if it is valid, else raise ValueError."""
    if rule in ("exact", "trim", "casefold", "digits"):
        return rule
    if isinstance(rule, str) and rule.startswith("date:"):
        fmt = rule[5:]
        if not fmt:
            raise ValueError(f"date rule {rule!r} has no format")
        if "%" not in fmt.replace("%%", ""):
            raise ValueError(f"date format {fmt!r} has no directive")
        try:
            datetime.strptime(_DATE_SAMPLE.strftime(fmt), fmt)
        except ValueError as e:
            raise ValueError(f"malformed date format {fmt!r} ({e})")
        return rule
    raise ValueError(f"unknown comparison rule {rule!r}; use exact, trim, casefold, digits or date:FORMAT")


def _normalize(rule, value):
    """The value a rule compares, or None when there is nothing to compare."""
    if not isinstance(value, str):
        return None
    if rule == "trim":
        return value.strip()
    if rule == "casefold":
        return value.casefold()
    if rule == "digits":
        return "".join(c for c in value if "0" <= c <= "9")
    try:
        parsed = datetime.strptime(value, rule[5:])
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc)
    return parsed.isoformat()


def _compare(expected, actual, rule="exact"):
    if rule == "exact":
        if not expected or not actual:
            return _rule("unknown", _EMPTY, expected=expected, actual=actual)
        status = "pass" if expected == actual else "fail"
        return _rule(status, "exact string comparison", expected=expected, actual=actual)
    e, a = _normalize(rule, expected), _normalize(rule, actual)
    detail = dict(rule=rule, expected=expected, actual=actual, expected_normalized=e, actual_normalized=a)
    if not expected or not actual:
        return _rule("unknown", _EMPTY, **detail)
    if rule == "trim":
        if not e or not a:
            return _rule("unknown", "empty after trimming whitespace; a missing value is not assumed to be "
                                    "a difference", **detail)
        reason = "comparison after trimming leading and trailing whitespace"
    elif rule == "casefold":
        reason = "comparison after Unicode case folding"
    elif rule == "digits":
        if not e or not a:
            return _rule("unknown", "no digits to compare", **detail)
        reason = "comparison of the digits 0-9 only"
    else:
        if e is None or a is None:
            return _rule("unknown", f"value does not match date format {rule[5:]!r}", **detail)
        reason = f"date comparison with format {rule[5:]!r}"
    return _rule("pass" if e == a else "fail", reason, **detail)


def _count(name, value):
    if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
        raise ValueError(f"{name} must be None or a non-negative integer")
    return value


def _fields(obligation):
    fields = []
    for field in obligation["fields"]:
        if len(field) == 2:
            fields.append((field[0], field[1], "exact"))
        elif len(field) == 3:
            fields.append((field[0], field[1], parse_rule(field[2])))
        else:
            raise ValueError("a field is (source, destination) or (source, destination, rule)")
    return fields


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
                for name in ("expected", "actual", "expected_normalized", "actual_normalized"):
                    rule.pop(name, None)
        return record


class _Evaluation:
    def __init__(self, obligation, source_complete, destination_complete, source_count, destination_count):
        self.source_key, self.destination_key = obligation["key"]
        self.fields = _fields(obligation)
        self.scope = obligation.get("scope", "source")
        if self.scope not in SCOPES:
            raise ValueError(f"scope must be one of {', '.join(SCOPES)}")
        self.source_complete = source_complete is True
        self.destination_complete = destination_complete is True
        self.source_count = _count("source_count", source_count)
        self.destination_count = _count("destination_count", destination_count)
        self.keys = []      # per source row: its key, or None
        self.values = []    # per source row: its compared field values
        self.first = {}     # key -> position of the first source row with it
        self.repeated = set()
        self.invalid_source_keys = 0
        self.candidates = None   # per first position: destination rows carrying the key
        self.actual = {}    # first position -> destination values, only where they differ from the source
        self.destination_only = {}   # key -> [first destination row, rows], only for scope "exact"
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
        self.values.append(tuple(row.get(s) for s, _, _ in self.fields))

    def add_destination(self, row):
        if self.candidates is None:
            self.candidates = array("q", bytes(8 * len(self.keys)))
        number = self.destination_rows
        self.destination_rows += 1
        key = _key(row.get(self.destination_key))
        if key is None:
            self.keyless += 1
            return
        position = self.first.get(key)
        if position is None:
            if self.scope == "exact":
                entry = self.destination_only.setdefault(key, [number, 0])
                entry[1] += 1
            return
        self.candidates[position] += 1
        if key in self.repeated:
            return
        if self.candidates[position] == 1:
            actual = tuple(row.get(d) for _, d, _ in self.fields)
            if actual != self.values[position]:
                self.actual[position] = actual
        else:
            self.actual.pop(position, None)  # no arbitrary candidate is selected

    def finish(self, details):
        if self.candidates is None:
            self.candidates = array("q", bytes(8 * len(self.keys)))
        self.source_count_matches = None if self.source_count is None else self.source_count == len(self.keys)
        self.destination_count_matches = (None if self.destination_count is None
                                          else self.destination_count == self.destination_rows)
        # A destination row that cannot be matched could be the record being looked for.
        self.coverage = (self.destination_complete and self.keyless == 0
                         and self.destination_count_matches is not False)
        self.states = bytearray(_STATE_CODE[self.record(p)["state"]] for p in range(len(self.keys)))
        counts = {name: 0 for name in STATES}
        for code in self.states:
            counts[STATES[code]] += 1
        population_known = (self.source_complete and self.invalid_source_keys == 0 and not self.repeated
                            and self.source_count_matches is not False)
        result = {"evaluator": VERSION, "counts": counts, "records": _Records(self, details),
                  "expected_total": len(self.keys) if population_known else None,
                  "source_rows_observed": len(self.keys), "source_population_known": population_known,
                  "destination_coverage_sufficient": self.coverage, "destination_rows_without_key": self.keyless,
                  "workflow_execution": "Not assessed", "business_truth": "Not assessed",
                  "existed_by_deadline": "Not assessed", "acquisition_authenticity": "not_authenticated",
                  "premises": self._premises()}
        extra_mismatch = False
        if self.scope == "exact":
            only = self._destination_only(population_known)
            result["destination_only"] = only
            result["destination_only_counts"] = {name: sum(r["state"] == name for r in only) for name in STATES}
            extra_mismatch = result["destination_only_counts"]["Mismatch"] > 0
        if counts["Mismatch"] or extra_mismatch:
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
            "source_count": {"stated": self.source_count, "observed": len(self.keys),
                             "matched": self.source_count_matches},
            "destination_count": {"stated": self.destination_count, "observed": self.destination_rows,
                                  "matched": self.destination_count_matches},
        }

    def _destination_only(self, population_known):
        if population_known:
            state, reason = "Mismatch", "key not in the source, and the source population is known"
        else:
            state = "Unverified"
            reason = "key not in the source; source population unknown, so no conclusion"
        return [{"key": key, "destination_row": number, "rows": rows, "state": state, "reason": reason}
                for key, (number, rows) in self.destination_only.items()]

    def record(self, position):
        key = self.keys[position]
        names = ["existence", "uniqueness"] + ["field:" + s for s, _, _ in self.fields]
        rules = {name: _rule("unknown", "insufficient evidence") for name in names}
        for source_field, _, rule in self.fields:
            if rule != "exact":
                rules["field:" + source_field]["rule"] = rule
        candidates = self.candidates[self.first[key]] if key is not None else 0
        if key is None or key in self.repeated:
            for name in rules:
                rules[name]["reason"] = "invalid or duplicate source key"
        elif candidates > 1:
            rules["existence"] = _rule("pass", "candidates observed")
            rules["uniqueness"] = _rule("fail", "more than one destination row carries this key")
            for source_field, _, _ in self.fields:
                rules["field:" + source_field]["reason"] = "no arbitrary candidate selected"
        elif candidates:
            rules["existence"] = _rule("pass", "candidate observed")
            if self.coverage:
                rules["uniqueness"] = _rule("pass", "one row in stated complete destination")
            expected = self.values[position]
            actual = self.actual.get(position, expected)
            for (source_field, _, rule), e, a in zip(self.fields, expected, actual):
                rules["field:" + source_field] = _compare(e, a, rule)
        elif self.coverage:
            rules["existence"] = _rule("fail", "key not found in stated complete destination")
        elif self.destination_complete and self.keyless == 0 and self.destination_count_matches is False:
            rules["existence"] = _rule("unknown", "destination row count differs from the stated count; "
                                                  "absence not established")
        else:
            rules["existence"] = _rule("unknown", "destination not stated complete; absence not established")
        return {"key": key, "source_row": position, "state": _state(rules), "candidates": candidates, "rules": rules}


def evaluate(obligation, source_rows, destination_rows, *, source_complete=False, destination_complete=False,
             source_count=None, destination_count=None, details="all"):
    """`obligation` is {"key": (source, destination), "fields": [(source, destination[, rule]), ...]},
    with an optional "scope". Rows are mappings, read once each, source rows first.

    `details` "all" builds every record in full; "problems" keeps only key, source_row and state
    for a Verified record. The returned "records" is a read-only sequence."""
    if details not in DETAILS:
        raise ValueError(f"details must be one of {', '.join(DETAILS)}")
    evaluation = _Evaluation(obligation, source_complete, destination_complete, source_count, destination_count)
    for row in source_rows:
        evaluation.add_source(row)
    for row in destination_rows:
        evaluation.add_destination(row)
    return evaluation.finish(details)
