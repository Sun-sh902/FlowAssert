"""Disposable offline reasoning model, not a connector or production component.

Only evidence is accepted here. Hidden synthetic world facts and expected verdicts
belong to the test harness. Coverage attestations are premises, not API guarantees.

Round03.5 trust hardening (2026-10-15):
- Fail closed: every trust/coverage premise must be the exact boolean that
  permits a conclusion (``is True`` / ``is False``); a missing or non-boolean
  value never permits a conclusion. ``observed_at_trusted`` defaults to untrusted.
- Every time/number input must be a plain int (bool is rejected). Invalid inputs
  produce Unverified results, never an exception.
- A premise flag alone is no longer sufficient. Each one needs a matching,
  internally consistent evidence record:
    source.provenance  {channel, acquired_at, rows_sha256}   -> source independence
    source.inventory   {method, eligible_count, eligible_keys_sha256} -> complete population
    policy.approval    {version, comparison}                  -> rule approval
    destination.query_total (int, provider-reported match count) -> destination coverage
  These records are still supplied inputs. Consistency checks catch omissions,
  substitutions and version drift that the records reveal; they cannot
  authenticate a record that was fabricated consistently (see README in
  experiments/round03_5_trust_hardening/).
"""
from collections import Counter
import hashlib
import json

STATES = ("Verified", "Mismatch", "Pending", "Unverified")
ACCEPTED_SOURCE_CHANNELS = ("independent-source-read",)
ACCEPTED_INVENTORY_METHODS = ("independent-enumeration",)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     default=repr).encode()).hexdigest()


def key_set_digest(keys):
    """Order-independent digest of a key multiset; keys may be any JSON value."""
    return digest(sorted(json.dumps(k, sort_keys=True, default=repr) for k in keys))


def _int(value):
    return type(value) is int


def _dict(value):
    return value if isinstance(value, dict) else {}


def _nonempty_str(value):
    return isinstance(value, str) and bool(value.strip())


def source_provenance_valid(source):
    record = source.get("provenance")
    return (isinstance(record, dict) and record.get("channel") in ACCEPTED_SOURCE_CHANNELS
            and _int(record.get("acquired_at")) and _int(source.get("captured_at"))
            and record.get("acquired_at") == source.get("captured_at")
            and isinstance(source.get("rows"), list)
            and record.get("rows_sha256") == digest(source.get("rows")))


def source_inventory_valid(source):
    record = source.get("inventory")
    rows = source.get("rows")
    if not isinstance(record, dict) or not isinstance(rows, list):
        return False
    keys = [r.get("key") if isinstance(r, dict) else None for r in rows]
    return (record.get("method") in ACCEPTED_INVENTORY_METHODS
            and _int(record.get("eligible_count")) and record.get("eligible_count") == len(rows)
            and record.get("eligible_keys_sha256") == key_set_digest(keys))


def rule_approval_valid(policy):
    record = policy.get("approval")
    return (isinstance(record, dict) and _nonempty_str(policy.get("version"))
            and record.get("version") == policy.get("version")
            and record.get("comparison") == policy.get("comparison"))


def state(rules, can_wait):
    values = [r["status"] for r in rules.values()]
    if "fail" in values:
        return "Mismatch"
    if values and all(v == "pass" for v in values):
        return "Verified"
    return "Pending" if can_wait else "Unverified"


def evaluate(e):
    e = _dict(e)
    s, d, policy = _dict(e.get("source")), _dict(e.get("destination")), _dict(e.get("policy"))
    now, captured_at, deadline = e.get("now"), s.get("captured_at"), policy.get("deadline")
    rows_raw = s.get("rows")
    rows_listed = isinstance(rows_raw, list)
    source_rows = [r if isinstance(r, dict) else {} for r in (rows_raw if rows_listed else [])]

    clock_ok = _int(now) and _int(captured_at) and captured_at <= now
    timing_valid = clock_ok and _int(deadline) and deadline >= captured_at
    window = timing_valid and now < deadline and policy.get("retry_viable") is True
    namespace = s.get("namespace")
    provenance_ok = source_provenance_valid(s)
    source_ok = (rows_listed and _nonempty_str(namespace) and s.get("basis_bound") is True
                 and s.get("independent") is True and provenance_ok and clock_ok)
    approval_ok = policy.get("approved") is True and rule_approval_valid(policy)
    settling = policy.get("settling_allowed")
    deadline_ok = _int(deadline) and _int(captured_at) and deadline >= captured_at
    rule_ok = (approval_ok and policy.get("comparison") == "exact-string" and type(settling) is bool
               and deadline_ok)
    identity_ok = policy.get("identity_reliable") is True
    # Fail closed: anything other than an explicit False keeps the rule required.
    require_history = policy.get("require_historical_deadline") is not False
    require_execution = policy.get("require_execution") is not False
    # Only string keys can be valid; counting others would raise on unhashable values.
    keys = Counter(r.get("key") for r in source_rows if isinstance(r.get("key"), str))
    binding_ok = (_nonempty_str(policy.get("account")) and d.get("account") == policy.get("account")
                  and _nonempty_str(policy.get("object")) and d.get("object") == policy.get("object"))
    # A synthetic, declared observation-age policy; not a provider latency bound.
    observed_at = d.get("observed_at")
    max_age = policy.get("max_age")
    # The clock-trust premise must be explicit; absence means untrusted.
    clock_trusted = d.get("observed_at_trusted") is True
    observation_time_valid = (clock_ok and _int(observed_at) and clock_trusted
                              and captured_at <= observed_at <= now)
    fresh = (observation_time_valid and _int(max_age) and max_age >= 0
             and now - observed_at <= max_age)
    positive_ok = binding_ok and d.get("access") == "ok" and fresh and d.get("coherent") is True
    pages = d.get("pages")
    pages_ok = isinstance(pages, list) and bool(pages)
    sequence_valid = isinstance(pages, list)
    sequence_reason = ("valid reachable page sequence" if sequence_valid
                       else "destination pages are not a list")
    cursor = "start"
    seen_cursors = set()
    records = {}
    conflicts = set()
    for page in (pages if isinstance(pages, list) else []):
        page = _dict(page)
        token, next_token = page.get("cursor"), page.get("next")
        if (cursor is None or not isinstance(token, str) or not token
                or token != cursor or token in seen_cursors
                or (next_token is not None and (not isinstance(next_token, str) or not next_token))
                or not isinstance(page.get("rows"), list)):
            sequence_valid = False
            sequence_reason = "unreachable page, invalid cursor, or evidence after query termination"
            pages_ok = False
            break
        seen_cursors.add(token)
        if next_token in seen_cursors:
            sequence_valid = False
            sequence_reason = "pagination continuation cycle contradicts termination"
            pages_ok = False
            break
        cursor = next_token
        for r in page["rows"]:
            rid = r.get("id") if isinstance(r, dict) else None
            if not isinstance(rid, str) or not rid:
                pages_ok = False
                continue
            if rid in records and records[rid] != r:
                conflicts.add(rid)
            records.setdefault(rid, r)
    pages_ok = pages_ok and sequence_valid and cursor is None
    if not sequence_valid:
        # A contradictory chain invalidates the whole observation, including any
        # conflicts seen in its prefix; nothing from it is salvaged.
        records, conflicts = {}, set()
    # A missing continuation only limits coverage: reachable positive rows can
    # still disprove a rule. A contradictory chain invalidates this observation's
    # provenance, including its prefix; no arbitrary row is salvaged from it.
    positive_ok = positive_ok and sequence_valid
    query_total = d.get("query_total")
    query_total_ok = _int(query_total) and query_total == len(records)
    coverage_ok = (positive_ok and pages_ok and d.get("partial") is False and d.get("errors") == []
                   and d.get("visibility_complete") is True and d.get("predicate_valid") is True
                   and d.get("negative_reliable") is True and not conflicts and query_total_ok)
    results = []
    for i, row in enumerate(source_rows):
        key = row.get("key")
        valid_key = isinstance(key, str) and bool(key.strip()) and keys[key] == 1
        basis_ok = source_ok and rule_ok and identity_ok and valid_key
        expectation_ok = isinstance(row.get("phone"), str)
        rules = {name: {"status": "unknown", "reason": "insufficient evidence"}
                 for name in ("existence", "phone", "uniqueness")}
        candidates = []

        def set_rule(name, status, reason, **detail):
            rules[name] = dict(status=status, reason=reason, **detail)

        if not basis_ok:
            prerequisite = next(reason for valid, reason in (
                (rows_listed, "source rows are not a list"),
                (_nonempty_str(namespace), "source namespace missing or invalid"),
                (s.get("basis_bound") is True, "source basis is not bound to frozen obligation"),
                (s.get("independent") is True, "independent source provenance unavailable"),
                (provenance_ok, "source provenance record missing or inconsistent with captured rows"),
                (_int(now) and _int(captured_at), "evaluation or source capture time is not an integer tick"),
                (clock_ok, "source capture occurs after evaluation time"),
                (policy.get("approved") is True, "comparison rule is not approved"),
                (approval_ok, "approval record missing or does not bind this rule version"),
                (policy.get("comparison") == "exact-string", "unsupported comparison policy"),
                (type(settling) is bool, "settling policy is not an explicit boolean"),
                (deadline_ok, "policy deadline is not a valid integer tick at or after source capture"),
                (identity_ok, "identity policy is unreliable"),
                (valid_key, "invalid or duplicate frozen source key")) if not valid)
            for name in rules:
                set_rule(name, "unknown", prerequisite)
        elif not sequence_valid:
            for name in rules:
                set_rule(name, "unknown", sequence_reason)
        elif not positive_ok:
            for name in rules:
                set_rule(name, "unknown", "destination binding, access, freshness, clock trust, or coherence unavailable")
        else:
            candidates = [r for r in records.values()
                          if r.get("key") == key and r.get("namespace") == namespace]
            candidate_conflict = any(r["id"] in conflicts for r in candidates)
            if candidate_conflict:
                for name in rules:
                    set_rule(name, "unknown", "conflicting observations of same destination ID")
            elif len(candidates) > 1:
                set_rule("existence", "pass", "reliable candidates observed")
                set_rule("uniqueness", "fail", "distinct IDs violate configured key uniqueness")
                set_rule("phone", "unknown", "no arbitrary candidate selected")
            elif len(candidates) == 1:
                candidate = candidates[0]
                set_rule("existence", "pass", "reliable candidate observed")
                if coverage_ok:
                    set_rule("uniqueness", "pass", "complete relevant synthetic inventory")
                expected, actual = row.get("phone"), candidate.get("phone")
                if isinstance(expected, str) and isinstance(actual, str):
                    different = actual != expected
                    if different and settling is True and (not timing_valid or observed_at < deadline):
                        set_rule("phone", "unknown", "no qualifying observation at or after settling deadline", expected=expected, actual=actual)
                    else:
                        set_rule("phone", "fail" if different else "pass", "exact string comparison", expected=expected, actual=actual)
                else:
                    set_rule("phone", "unknown", "missing, null, inaccessible, or unsupported phone type")
            elif coverage_ok and timing_valid and observed_at >= deadline:
                set_rule("existence", "fail", "expected key not found at observation at or after deadline")
            else:
                set_rule("existence", "unknown", "waiting window or insufficient absence evidence")
        if basis_ok and not expectation_ok:
            set_rule("phone", "unknown", "invalid frozen expected phone; destination retry cannot repair source prerequisite")
        if require_history:
            rules["existed_by_deadline"] = {"status": "unknown", "reason": "current read cannot reconstruct historical deadline"}
        if require_execution:
            rules["workflow_execution"] = {"status": "unknown", "reason": "Approach B contains no execution evidence"}
        can_wait = (basis_ok and expectation_ok and binding_ok and window and d.get("access") != "denied"
                    and not conflicts and not require_history and not require_execution)
        results.append({"key": key, "source_row": i, "state": state(rules, can_wait),
                        "candidate_ids": sorted(r["id"] for r in candidates), "rules": rules})
    counts = {name: sum(r["state"] == name for r in results) for name in STATES}
    inventory_ok = source_inventory_valid(s)
    population_known = (s.get("complete") is True and source_ok and inventory_ok and all(
        isinstance(r.get("key"), str) and bool(r["key"].strip()) and keys[r["key"]] == 1
        for r in source_rows))
    if counts["Mismatch"]:
        cohort = "Mismatch"
    elif not population_known or not results:
        cohort = "Unverified"
    elif counts["Verified"] == len(results):
        cohort = "Verified"
    elif counts["Unverified"]:
        cohort = "Unverified"
    else:
        cohort = "Pending"
    return {"cohort_state": cohort, "counts": counts, "records": results,
            "expected_total": len(source_rows) if population_known else None,
            "source_rows_observed": len(source_rows), "source_population_known": population_known,
            "destination_coverage_sufficient": coverage_ok,
            "source_basis_sha256": digest(e.get("source")), "rule_basis_sha256": digest(e.get("policy")),
            "observed_at": observed_at, "deadline": deadline,
            "business_obligation_at": captured_at, "evaluation_at": now,
            "observation_time_valid": observation_time_valid,
            "destination_page_sequence_valid": sequence_valid,
            "destination_page_sequence_reason": sequence_reason,
            "premise_evidence": {"source_provenance_record": provenance_ok,
                                 "source_inventory_record": inventory_ok,
                                 "rule_approval_record": rule_approval_valid(policy),
                                 "destination_query_total_consistent": query_total_ok,
                                 "observation_clock_trusted": clock_trusted},
            "workflow_execution": "Not assessed", "business_truth": "Not assessed",
            "absence_cause": "Not inferred"}
