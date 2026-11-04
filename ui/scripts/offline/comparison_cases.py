#!/usr/bin/env python3
"""Shared cases for comparing two reports (docs/report-comparison.md, ui/src/offline/compare.ts).

    python3 ui/scripts/offline/comparison_cases.py           write ui/src/test/offline/comparison-cases/ again
    python3 ui/scripts/offline/comparison_cases.py --check   exit 1 if those files are not what this script writes now

Each case is one JSON file with two reports, `earlier` and `later` in the order they are compared, and the expected
comparison, `expected`. A report is either a golden case's report, {"golden": NAME} (offline/golden/NAME/report.json),
or one the command-line checker wrote here from synthetic files, {"report": {...}}, with `evaluated_at` fixed per
report. The expected comparisons are written by hand below; nothing in them is computed by the code under test.

The `expected` value is a projection of compareReports' result (see ui/src/test/offline/compare.test.ts):
classes list [key, earlier state, later state] in order, `rule_changes` names the rule results that differ for each
key in both reports ("not available" when a report has none for it), `unmatched` lists
[report, key, source row, reason], and a refusal lists its reason codes.
"""
import contextlib
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "offline"))
from flowassert_offline import cli  # noqa: E402

TARGET = ROOT / "ui" / "src" / "test" / "offline" / "comparison-cases"

HEADER = "key,phone,email\n"
CONFIG = {"key": ["key", "key"], "fields": [{"source": "phone", "destination": "phone", "rule": "exact"},
                                           {"source": "email", "destination": "email", "rule": "exact"}],
          "scope": "source"}


def at(day, micro=0):
    return datetime(2026, 11, day, 9, 30, 0, micro, tzinfo=timezone.utc)


def report(source, destination, args, when, config=None, origin=None):
    """Run flowassert-verify on two synthetic files and return the JSON report it writes."""
    class Fixed(datetime):
        @classmethod
        def now(cls, tz=None):
            return when

    with tempfile.TemporaryDirectory() as folder:
        old = os.getcwd()
        os.chdir(folder)
        saved = cli.datetime
        cli.datetime = Fixed
        try:
            Path("source.csv").write_bytes(source.encode("utf-8"))
            Path("destination.csv").write_bytes(destination.encode("utf-8"))
            if config is not None:
                Path("config.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
                args = ["--config", "config.json"] + args
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as err:
                code = cli.main(["--source", "source.csv", "--destination", "destination.csv"] + args
                                + ["--json", "report.json"])
            if code not in (0, 1, 3):
                raise SystemExit(f"the checker refused: {err.getvalue()}")
            value = json.loads(Path("report.json").read_text(encoding="utf-8"))
        finally:
            cli.datetime = saved
            os.chdir(old)
    if origin is not None:
        for premise in value["premises"].values():
            premise["origin"] = origin
    return {"report": value}


FIELDS = ["--key", "key", "--field", "phone", "--field", "email"]
COMPLETE = ["--source-complete", "--destination-complete"]

# Seven keys: K1 stays Verified, K2 becomes a Mismatch, K3 stops being one, K4 stays a Mismatch, K5 goes from Mismatch
# to Unverified (an empty destination value), K6 is only in the earlier source and K7 only in the later one.
EARLIER_SOURCE = HEADER + "K1,111,a@x.test\nK2,222,b@x.test\nK3,333,c@x.test\nK4,444,d@x.test\nK5,555,e@x.test\nK6,666,f@x.test\n"
EARLIER_DESTINATION = HEADER + "K1,111,a@x.test\nK2,222,b@x.test\nK3,330,c@x.test\nK4,440,d@x.test\nK5,550,e@x.test\nK6,666,f@x.test\n"
LATER_SOURCE = HEADER + "K1,111,a@x.test\nK2,222,b@x.test\nK3,333,c@x.test\nK4,444,d@x.test\nK5,555,e@x.test\nK7,777,g@x.test\n"
LATER_DESTINATION = HEADER + "K1,111,a@x.test\nK2,999,b@x.test\nK3,333,c@x.test\nK4,441,d@x.test\nK5,,e@x.test\nK7,777,g@x.test\n"

ALL_CLASSES = {
    "became-problem": [["K2", "Verified", "Mismatch"]],
    "stopped-problem": [["K3", "Mismatch", "Verified"]],
    "still-problem": [["K4", "Mismatch", "Mismatch"], ["K5", "Mismatch", "Unverified"]],
    "still-verified": [["K1", "Verified", "Verified"]],
    "only-earlier": [["K6", "Verified", None]],
    "only-later": [["K7", None, "Verified"]],
}


def facts(**changes):
    """The expected facts of a comparison, with the defaults of two complete reports of the same files."""
    out = {"comparable": True, "order": "chronological", "same_files_same_premises": False, "premise_differences": [],
           "digests_changed": {"source": True, "destination": True},
           "source_population_known": [True, True], "destination_coverage_sufficient": [True, True]}
    out.update(changes)
    return out


def refused(*codes):
    return {"comparable": False, "reasons": list(codes)}


def cases():
    yield "classes-details-all", (
        "Every class of a key found in both reports or in one, with details all: rule-level changes for every pair.",
        report(EARLIER_SOURCE, EARLIER_DESTINATION, FIELDS + COMPLETE + ["--details", "all"], at(1)),
        report(LATER_SOURCE, LATER_DESTINATION, FIELDS + COMPLETE + ["--details", "all"], at(2)),
        facts(cohort_state=["Mismatch", "Mismatch"], records=ALL_CLASSES,
              rule_changes={"K1": [], "K2": ["field:phone"], "K3": ["field:phone"], "K4": ["field:phone"],
                            "K5": ["field:phone"]},
              rule_level_unavailable=0, destination_only=None, unmatched=[]))

    yield "classes-details-problems", (
        "The same files with details problems: a Verified record has no rule results, so for any pair with a"
        " Verified record only the states are compared.",
        report(EARLIER_SOURCE, EARLIER_DESTINATION, FIELDS + COMPLETE, at(1)),
        report(LATER_SOURCE, LATER_DESTINATION, FIELDS + COMPLETE, at(2)),
        facts(cohort_state=["Mismatch", "Mismatch"], records=ALL_CLASSES,
              rule_changes={"K1": "not available", "K2": "not available", "K3": "not available",
                            "K4": ["field:phone"], "K5": ["field:phone"]},
              rule_level_unavailable=3, destination_only=None, unmatched=[]))

    yield "details-all-against-problems", (
        "One report with details all and one with details problems: a pair is compared rule by rule only when both"
        " reports have the rule results.",
        report(EARLIER_SOURCE, EARLIER_DESTINATION, FIELDS + COMPLETE + ["--details", "all"], at(1)),
        report(LATER_SOURCE, LATER_DESTINATION, FIELDS + COMPLETE, at(2)),
        facts(cohort_state=["Mismatch", "Mismatch"], records=ALL_CLASSES,
              rule_changes={"K1": "not available", "K2": ["field:phone"], "K3": "not available",
                            "K4": ["field:phone"], "K5": ["field:phone"]},
              rule_level_unavailable=2, destination_only=None, unmatched=[]))

    yield "not-matched", (
        "A record without a key, and keys on more than one record of either report, are not matched: nothing is guessed.",
        report(HEADER + "K1,1,a\n,2,b\nK8,8,h\nK9,9,i\nK9,9,i\n", HEADER + "K1,1,a\nK8,8,h\nK9,9,i\n", FIELDS + COMPLETE, at(1)),
        report(HEADER + "K1,1,a\nK8,8,h\nK8,8,h\nK9,9,i\n", HEADER + "K1,1,a\nK8,8,h\nK9,9,i\n", FIELDS + COMPLETE, at(2)),
        facts(cohort_state=["Unverified", "Unverified"], source_population_known=[False, False],
              digests_changed={"source": True, "destination": False},
              records={"became-problem": [], "stopped-problem": [], "still-problem": [],
                       "still-verified": [["K1", "Verified", "Verified"]], "only-earlier": [], "only-later": []},
              rule_changes={"K1": "not available"}, rule_level_unavailable=1, destination_only=None,
              unmatched=[["earlier", None, 1, "no-key"], ["earlier", "K8", 2, "repeated-key", 1, 2],
                         ["earlier", "K9", 3, "repeated-key", 2, 1], ["earlier", "K9", 4, "repeated-key", 2, 1],
                         ["later", "K8", 1, "repeated-key", 1, 2], ["later", "K8", 2, "repeated-key", 1, 2],
                         ["later", "K9", 3, "repeated-key", 2, 1]]))

    exact = dict(CONFIG, scope="exact")
    yield "destination-only", (
        "Scope exact: destination-only keys are compared by key. X1 is in both (Unverified, then a Mismatch once the"
        " source is stated complete), X2 only in the earlier report and X3 only in the later one. The source"
        " statement differs, so the premise difference comes first.",
        report(HEADER + "K1,1,a\n", HEADER + "K1,1,a\nX1,0,x\nX2,0,y\n", ["--destination-complete"], at(1), config=exact),
        report(HEADER + "K1,1,a\n", HEADER + "K1,1,a\nX1,0,x\nX3,0,z\n", COMPLETE, at(2), config=exact),
        facts(cohort_state=["Unverified", "Mismatch"], source_population_known=[False, True],
              digests_changed={"source": False, "destination": True},
              premise_differences=[["source_complete", True, False]],
              records={"became-problem": [], "stopped-problem": [], "still-problem": [],
                       "still-verified": [["K1", "Verified", "Verified"]], "only-earlier": [], "only-later": []},
              rule_changes={"K1": "not available"}, rule_level_unavailable=1,
              destination_only={"still-problem": [["X1", "Unverified", "Mismatch"]], "only-earlier": [["X2", "Unverified", None]],
                                "only-later": [["X3", None, "Mismatch"]]},
              unmatched=[]))

    same_source = HEADER + "K1,1,a\nK2,2,b\n"
    same_destination = HEADER + "K1,1,a\nK2,0,b\n"
    yield "premise-flags-differ", (
        "The same files with different completeness statements: every record's change comes from the premises, which"
        " the comparison says first.",
        report(same_source, same_destination, FIELDS, at(1)),
        report(same_source, same_destination, FIELDS + COMPLETE, at(2)),
        facts(cohort_state=["Mismatch", "Mismatch"], source_population_known=[False, True],
              destination_coverage_sufficient=[False, True], digests_changed={"source": False, "destination": False},
              premise_differences=[["destination_complete", True, False], ["source_complete", True, False]],
              records={"became-problem": [], "stopped-problem": [["K1", "Unverified", "Verified"]],
                       "still-problem": [["K2", "Mismatch", "Mismatch"]], "still-verified": [], "only-earlier": [],
                       "only-later": []},
              rule_changes={"K1": "not available", "K2": ["uniqueness"]}, rule_level_unavailable=1,
              destination_only=None, unmatched=[]))

    yield "premise-counts-differ", (
        "Stated counts that differ: a source count that matches in one report, and a destination count that does not"
        " match in the other.",
        report(same_source, same_destination, FIELDS + COMPLETE + ["--source-count", "2"], at(1)),
        report(same_source, same_destination, FIELDS + COMPLETE + ["--destination-count", "5"], at(2)),
        facts(cohort_state=["Mismatch", "Mismatch"], destination_coverage_sufficient=[True, False],
              digests_changed={"source": False, "destination": False},
              premise_differences=[["destination_count", True, False], ["source_count", True, False]],
              records={"became-problem": [["K1", "Verified", "Unverified"]], "stopped-problem": [],
                       "still-problem": [["K2", "Mismatch", "Mismatch"]], "still-verified": [], "only-earlier": [],
                       "only-later": []},
              rule_changes={"K1": "not available", "K2": ["uniqueness"]}, rule_level_unavailable=1,
              destination_only=None, unmatched=[]))

    yield "premise-origin-differs", (
        "A command-line report and a report of the browser page, of the same files with the same statements: only"
        " the origin of each premise differs. The browser's report records rules and scope; the command line's,"
        " run without --config, does not, and means every rule exact and scope source, so the obligation is the same.",
        report(same_source, same_destination, FIELDS + COMPLETE, at(1)),
        report(same_source, same_destination, COMPLETE + ["--source-encoding", "utf-8", "--destination-encoding", "utf-8"],
               at(2), config=CONFIG, origin="browser form"),
        facts(cohort_state=["Mismatch", "Mismatch"], digests_changed={"source": False, "destination": False},
              premise_differences=[["destination_complete", False, True], ["destination_count", False, True],
                                   ["source_complete", False, True], ["source_count", False, True]],
              records={"became-problem": [], "stopped-problem": [], "still-problem": [["K2", "Mismatch", "Mismatch"]],
                       "still-verified": [["K1", "Verified", "Verified"]], "only-earlier": [], "only-later": []},
              rule_changes={"K1": "not available", "K2": []}, rule_level_unavailable=1, destination_only=None,
              unmatched=[]))

    identical = HEADER + "K1,1,a\n"
    yield "premise-in-one-report-only", (
        "allow_identical_content is stated in one report only, whose two files have the same content; the other"
        " report's destination is another file.",
        report(identical, identical, FIELDS + COMPLETE + ["--allow-identical-content"], at(1)),
        report(identical, HEADER + "K1,1,b\n", FIELDS + COMPLETE, at(2)),
        facts(cohort_state=["Verified", "Mismatch"], digests_changed={"source": False, "destination": True},
              premise_differences=[["allow_identical_content", True, True]],
              records={"became-problem": [["K1", "Verified", "Mismatch"]], "stopped-problem": [], "still-problem": [],
                       "still-verified": [], "only-earlier": [], "only-later": []},
              rule_changes={"K1": "not available"}, rule_level_unavailable=1, destination_only=None, unmatched=[]))

    yield "same-files-same-premises", (
        "The same files under the same premises, checked twice: the comparison says so, and every record keeps its state.",
        report(same_source, same_destination, FIELDS + COMPLETE, at(1)),
        report(same_source, same_destination, FIELDS + COMPLETE, at(1, 1)),
        facts(cohort_state=["Mismatch", "Mismatch"], same_files_same_premises=True,
              digests_changed={"source": False, "destination": False},
              records={"became-problem": [], "stopped-problem": [], "still-problem": [["K2", "Mismatch", "Mismatch"]],
                       "still-verified": [["K1", "Verified", "Verified"]], "only-earlier": [], "only-later": []},
              rule_changes={"K1": "not available", "K2": []}, rule_level_unavailable=1, destination_only=None,
              unmatched=[]))

    yield "swapped-order", (
        "The person swapped the two: the report compared as earlier was evaluated after the other, and the"
        " comparison says the order is reversed.",
        report(same_source, HEADER + "K2,2,b\nK1,1,a\n", FIELDS + COMPLETE, at(3)),
        report(same_source, same_destination, FIELDS + COMPLETE, at(2)),
        facts(order="reversed", cohort_state=["Verified", "Mismatch"], digests_changed={"source": False, "destination": True},
              records={"became-problem": [["K2", "Verified", "Mismatch"]], "stopped-problem": [], "still-problem": [],
                       "still-verified": [["K1", "Verified", "Verified"]], "only-earlier": [], "only-later": []},
              rule_changes={"K1": "not available", "K2": "not available"}, rule_level_unavailable=2,
              destination_only=None, unmatched=[]))

    yield "refused-different-key", (
        "Another key column is another obligation.",
        report(HEADER + "K1,1,a\n", HEADER + "K1,1,a\n", ["--key", "key", "--field", "phone"] + COMPLETE + ["--allow-identical-content"], at(1)),
        report(HEADER + "K1,1,a\n", HEADER + "K1,1,b\n", ["--key", "phone", "--field", "key"] + COMPLETE, at(2)),
        refused("different-key", "different-fields"))

    yield "refused-different-fields", (
        "Another set of compared fields is another obligation.",
        report(same_source, same_destination, FIELDS + COMPLETE, at(1)),
        report(same_source, same_destination, ["--key", "key", "--field", "phone"] + COMPLETE, at(2)),
        refused("different-fields"))

    trim = dict(CONFIG, fields=[dict(f, rule="trim") for f in CONFIG["fields"]])
    casefold = dict(CONFIG, fields=[dict(f, rule="casefold") for f in CONFIG["fields"]])
    yield "refused-different-rules", (
        "The same fields under other rules are another obligation.",
        report(same_source, same_destination, COMPLETE, at(1), config=trim),
        report(same_source, same_destination, COMPLETE, at(2), config=casefold),
        refused("different-rules"))

    yield "refused-different-comparison", (
        "Exact rules against another rule: both the rules and the comparison differ.",
        report(same_source, same_destination, FIELDS + COMPLETE, at(1)),
        report(same_source, same_destination, COMPLETE, at(2), config=trim),
        refused("different-rules", "different-comparison"))

    yield "refused-different-scope", (
        "Scope exact against scope source is another obligation.",
        report(same_source, same_destination, COMPLETE, at(1), config=CONFIG),
        report(same_source, same_destination, COMPLETE, at(2), config=dict(CONFIG, scope="exact")),
        refused("different-scope"))

    yield "refused-redacted", (
        "A redacted report has no keys to match.",
        report(same_source, same_destination, FIELDS + COMPLETE, at(1)),
        report(same_source, same_destination, FIELDS + COMPLETE + ["--redact-values"], at(2)),
        refused("redacted"))

    yield "refused-redacted-golden", (
        "Two golden reports: the example and the same check redacted, which is also the same report twice.",
        {"golden": "example"},
        {"golden": "example-redacted"},
        refused("redacted", "same-report"))

    yield "refused-same-report", (
        "The same report twice: the same files, premises and evaluation time, even with another details level.",
        {"golden": "example"},
        {"golden": "example-details-all"},
        refused("same-report"))


def contents():
    out = {}
    for name, (about, earlier, later, expected) in cases():
        value = {"name": name, "about": about, "earlier": earlier, "later": later, "expected": expected}
        out[name + ".json"] = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
    return out


def main(argv):
    files = contents()
    if argv[1:] == ["--check"]:
        present = {p.name: p.read_text(encoding="utf-8") for p in TARGET.glob("*.json")}
        if present != files:
            print("ui/src/test/offline/comparison-cases/ is not current; run ui/scripts/offline/comparison_cases.py",
                  file=sys.stderr)
            return 1
        return 0
    if argv[1:]:
        print(__doc__, file=sys.stderr)
        return 2
    TARGET.mkdir(exist_ok=True)
    for path in TARGET.glob("*.json"):
        path.unlink()
    for name, text in files.items():
        (TARGET / name).write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
