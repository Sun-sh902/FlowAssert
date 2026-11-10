#!/usr/bin/env python3
"""The JSON Schemas of the report, one per schema_version, written to docs/schema/.

    python3 offline/bench/schemas.py           write docs/schema/report-v*.schema.json again
    python3 offline/bench/schemas.py --check   exit 1 if a file is not what this script writes now

The schemas are JSON Schema draft 2020-12. Each file stands alone: it refers to nothing outside itself. The versions
share most of their definitions, which is why they are written from one description here and not by hand three times.

A schema says what a report of its version holds. It is open where the format is open: a member the schema does not
name is allowed, because a later 1.x release may add one and a reader must ignore it (docs/compatibility.md). It is
closed where a reader depends on the exact set: the rule results of a record, and the four states of a count.

What a schema cannot say, the reader checks: that the counts add up to the records, that a record's state follows from
its rule results, that `matched` is `stated == observed` (ui/src/offline/savedReport.ts, docs/report-comparison.md).
"""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "schema"
BASE = "https://sun-sh902.github.io/FlowAssert/schema/"
DRAFT = "https://json-schema.org/draft/2020-12/schema"

CLAIM = ("At this evaluation, under the stated premises, the supplied destination rows satisfy the rules "
         "for the supplied source rows.")
LIMITS = ("Files and completeness statements are not authenticated. Not assessed: whether a workflow ran, "
          "whether the source is true, whether a record existed by a past deadline.")
STATES = ["Verified", "Mismatch", "Pending", "Unverified"]
UTC = r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{6})?Z$"
SHA256 = "^[0-9a-f]{64}$"

STRING = {"type": "string"}
BOOLEAN = {"type": "boolean"}
COUNT = {"type": "integer", "minimum": 0}
TEXT_OR_NULL = {"type": ["string", "null"]}


def ref(name):
    return {"$ref": f"#/$defs/{name}"}


def obj(description, properties, required=None, **more):
    schema = {"description": description, "type": "object", "properties": properties}
    if required is not None:
        schema["required"] = required
    schema.update(more)
    return schema


def defs():
    """The definitions every version shares."""
    return {
        "counts": obj("The number of records in each state. Pending is always 0: this check has no waiting window.",
                      {"Verified": COUNT, "Mismatch": COUNT, "Pending": {"const": 0}, "Unverified": COUNT},
                      STATES, additionalProperties=False),
        "ruleResult": obj(
            "One rule's result for one record.",
            {"status": {"enum": ["pass", "fail", "unknown"]},
             "reason": {"description": "Why, in words.", **STRING},
             "rule": {"description": "The field's comparison rule, when it is not exact.", **STRING},
             "expected": {"description": "The source value, when a value was compared.", **TEXT_OR_NULL},
             "actual": {"description": "The destination value, when a value was compared.", **TEXT_OR_NULL},
             "expected_normalized": {"description": "The source value as the rule compared it; null when there was "
                                                    "nothing to compare.", **TEXT_OR_NULL},
             "actual_normalized": {"description": "The same for the destination value.", **TEXT_OR_NULL}},
            ["status", "reason"],
            dependentRequired={"expected": ["actual"], "actual": ["expected"],
                               "expected_normalized": ["actual_normalized", "rule"],
                               "actual_normalized": ["expected_normalized", "rule"]}),
        "rules": obj("existence, uniqueness, and one field:COLUMN result per compared field, named after the source "
                     "column.",
                     {"existence": ref("ruleResult"), "uniqueness": ref("ruleResult")},
                     ["existence", "uniqueness"],
                     patternProperties={"^field:": ref("ruleResult")}, additionalProperties=False),
        "record": obj(
            "One source row. With details problems a Verified record has only key, source_row and state.",
            {"key": {"description": "The source key; null when it is empty; [redacted] with --redact-values.",
                     **TEXT_OR_NULL},
             "source_row": {"description": "The row's position among the source data rows, from 0.", **COUNT},
             "state": {"enum": ["Verified", "Mismatch", "Unverified"]},
             "candidates": {"description": "The number of destination rows carrying this key.", **COUNT},
             "rules": ref("rules")},
            ["key", "source_row", "state"],
            dependentRequired={"candidates": ["rules"], "rules": ["candidates"]},
            **{"if": {"properties": {"state": {"enum": ["Mismatch", "Unverified"]}}, "required": ["state"]},
               "then": {"required": ["candidates", "rules"]}}),
        "destinationOnlyRecord": obj(
            "Scope exact: one destination key that no source row has.",
            {"key": STRING,
             "destination_row": {"description": "The position of the first destination data row with this key, "
                                                "from 0.", **COUNT},
             "rows": {"description": "The number of destination rows with this key.", "type": "integer", "minimum": 1},
             "state": {"enum": ["Mismatch", "Unverified"]},
             "reason": STRING},
            ["key", "destination_row", "rows", "state", "reason"]),
        "statement": obj("A completeness statement, or the permission for identical content.",
                         {"stated": BOOLEAN, "origin": ref("origin")}, ["stated", "origin"]),
        "statedCount": obj(
            "A total the caller saw in the original system, the rows read, and whether they are equal.",
            {"stated": {"description": "The number stated, of any size, or null when none was.",
                        "type": ["integer", "null"], "minimum": 0},
             "observed": {"description": "The data rows read on that side.", **COUNT},
             "matched": {"description": "Whether stated equals observed; null when no count was stated.",
                         "type": ["boolean", "null"]},
             "origin": ref("origin")},
            ["stated", "observed", "matched", "origin"],
            **{"if": {"properties": {"stated": {"type": "null"}}, "required": ["stated"]},
               "then": {"properties": {"matched": {"type": "null"}}},
               "else": {"properties": {"matched": {"type": "boolean"}}}}),
        "otherPremise": obj("A premise a later release may add: still a statement FlowAssert did not verify.",
                            {"stated": {"type": ["boolean", "integer", "null"]}, "origin": ref("origin")},
                            ["stated", "origin"]),
        "origin": {"description": "Where the statement came from: command-line option, browser form, JavaScript call "
                                  "or n8n Code node. A reader shows a value it does not know as it is.", **STRING},
        "premises": obj(
            "Every premise stated or not stated at this run. FlowAssert verifies none of them.",
            {"source_complete": ref("statement"), "destination_complete": ref("statement"),
             "source_count": ref("statedCount"), "destination_count": ref("statedCount"),
             "allow_identical_content": {"allOf": [ref("statement"), {"properties": {"stated": {"const": True}}}]}},
            ["source_complete", "destination_complete", "source_count", "destination_count"],
            additionalProperties=ref("otherPremise")),
        "pair": {"description": "[source column, destination column]", "type": "array", "items": STRING,
                 "minItems": 2, "maxItems": 2},
        "obligation": obj(
            "What was checked.",
            {"type": {"const": "current_state"},
             "key": ref("pair"),
             "fields": {"type": "array", "items": ref("pair"), "minItems": 1},
             "comparison": {"description": "exact-string when every field is compared exactly; per-field-rule when "
                                           "any field has another rule.",
                            "enum": ["exact-string", "per-field-rule"]},
             "rules": {"description": "One rule per field, in order: exact, trim, casefold, digits or date:FORMAT. "
                                      "Present when a configuration gave the rules.",
                       "type": "array", "minItems": 1,
                       "items": {"type": "string", "pattern": "^(exact|trim|casefold|digits)$|^date:."}},
             "scope": {"enum": ["source", "exact"]}},
            ["type", "key", "fields", "comparison"]),
        "utcTime": {"description": "UTC, ISO 8601, with microseconds only when they are not 0.", "type": "string",
                    "pattern": UTC},
        "sha256": {"description": "A SHA-256 digest in lower-case hex.", "type": "string", "pattern": SHA256},
    }


def source_sheet():
    revision_at = obj("Google Drive's version and modification time at one moment.",
                      {"version": {"type": "string", "pattern": "^[0-9]{1,20}$"},
                       "modified_time": TEXT_OR_NULL}, ["version", "modified_time"])
    return obj(
        "Where FlowAssert read the source rows: one range of a Google Sheets spreadsheet, read-only.",
        {"read_by": {"const": "FlowAssert"},
         "service": {"const": "Google Sheets API v4"},
         "spreadsheet_id": {"type": "string", "pattern": "^[A-Za-z0-9_-]{1,200}$"},
         "range_requested": STRING,
         "range_returned": STRING,
         "value_render_option": {"const": "FORMATTED_VALUE"},
         "date_time_render_option": {"const": "FORMATTED_STRING"},
         "major_dimension": {"const": "ROWS"},
         "read_at": ref("utcTime"),
         "revision": {
             "description": "The Drive revision just before and just after the values were read, which are equal; "
                            "or why the read cannot be tied to a revision.",
             "oneOf": [
                 obj("The revision was read both times.",
                     {"available": {"const": True}, "before": revision_at, "after": revision_at},
                     ["available", "before", "after"]),
                 obj("The read cannot be tied to a revision.",
                     {"available": {"const": False},
                      "reason": {"enum": ["not requested (--skip-source-revision)",
                                          "Google Drive returned no version"]}},
                     ["available", "reason"])]},
         "canonical_form": {"const": "flowassert-sheet-csv-1"}},
        ["read_by", "service", "spreadsheet_id", "range_requested", "range_returned", "value_render_option",
         "date_time_render_option", "major_dimension", "read_at", "revision", "canonical_form"])


def destination_hubspot():
    return obj(
        "Where FlowAssert read the destination rows: the contacts HubSpot listed to the token, read-only.",
        {"read_by": {"const": "FlowAssert"},
         "service": {"const": "HubSpot CRM API v3"},
         "object": {"const": "contacts"},
         "properties": {"description": "The property names requested, in order.", "type": "array", "minItems": 1,
                        "items": {"type": "string", "pattern": "^[A-Za-z0-9_]{1,100}$"}},
         "archived_excluded": {"const": True},
         "page_limit": {"const": 100},
         "pages": {"type": "integer", "minimum": 1},
         "rows": COUNT,
         "read_at": ref("utcTime"),
         "read_finished_at": ref("utcTime"),
         "canonical_form": {"const": "flowassert-hubspot-csv-1"}},
        ["read_by", "service", "object", "properties", "archived_excluded", "page_limit", "pages", "rows", "read_at",
         "read_finished_at", "canonical_form"])


def inputs(version):
    encoding = {"enum": ["utf-8", "utf-16", "gb18030"]}
    properties = {
        "source_sha256": ref("sha256"),
        "destination_sha256": ref("sha256"),
        "source_complete_stated": BOOLEAN,
        "destination_complete_stated": BOOLEAN,
        "identical_content": {"description": "Whether the two digests are equal.", **BOOLEAN},
        "identical_content_allowed": {"const": True},
        "mapping_file_sha256": ref("sha256"),
        "config_file_sha256": ref("sha256"),
        "source_encoding": encoding,
        "destination_encoding": encoding,
    }
    required = ["source_sha256", "destination_sha256", "source_complete_stated", "destination_complete_stated",
                "identical_content"]
    rules = [{"if": {"properties": {"identical_content": {"const": True}}, "required": ["identical_content"]},
              "then": {"required": ["identical_content_allowed"]}}]
    more = {}
    if version == 1:
        description = "The digests of the two files' bytes, and how the files were read."
        more["dependentRequired"] = {"source_encoding": ["destination_encoding"],
                                     "destination_encoding": ["source_encoding"]}
    elif version == 2:
        description = ("The digest of the canonical form of the values read from the sheet, the digest of the "
                       "destination file's bytes, and how each was read.")
        properties["source_sheet"] = ref("sourceSheet")
        required.append("source_sheet")
        rules.append({"description": "A sheet has no encoding.", "not": {"required": ["source_encoding"]}})
    else:
        description = ("The digest of the source (a file's bytes, or the canonical form of a sheet's values), the "
                       "digest of the canonical form of the records HubSpot listed, and how each was read.")
        properties["source_sheet"] = ref("sourceSheet")
        properties["destination_hubspot"] = ref("destinationHubspot")
        required.append("destination_hubspot")
        rules.append({"description": "The records HubSpot lists have no encoding.",
                      "not": {"required": ["destination_encoding"]}})
        rules.append({"description": "A sheet has no encoding.",
                      "if": {"required": ["source_sheet"]}, "then": {"not": {"required": ["source_encoding"]}}})
    return obj(description, properties, required, allOf=rules, **more)


TITLES = {
    1: ("FlowAssert report, schema_version 1",
        "The JSON report of a check of two CSV files, as flowassert-verify --json, the CSV check page and the "
        "packaged JavaScript checker write it. docs/report-format.md describes each member in words."),
    2: ("FlowAssert report, schema_version 2",
        "The JSON report of a check whose source FlowAssert read from a Google Sheets range and whose destination is "
        "a CSV file. Every member of version 1, with inputs.source_sheet, and no inputs.source_encoding."),
    3: ("FlowAssert report, schema_version 3",
        "The JSON report of a check whose destination FlowAssert read from HubSpot Contacts. The source is a CSV "
        "file, or a Google Sheets range when inputs.source_sheet is present. Every member of version 1, with "
        "inputs.destination_hubspot, and no inputs.destination_encoding."),
}


def schema(version):
    title, description = TITLES[version]
    definitions = defs()
    definitions["inputs"] = inputs(version)
    if version >= 2:
        definitions["sourceSheet"] = source_sheet()
    if version == 3:
        definitions["destinationHubspot"] = destination_hubspot()
    properties = {
        "schema_version": {"const": version},
        "cohort_state": {"description": "The batch result. The exit status follows it: 0, 1, 3.",
                         "enum": ["Verified", "Mismatch", "Unverified"]},
        "claim": {"description": "The claim of a Verified result; null otherwise.", "type": ["string", "null"]},
        "counts": ref("counts"),
        "expected_total": {"description": "The number of source records when the source population is known; "
                                          "null otherwise.", "type": ["integer", "null"], "minimum": 0},
        "source_rows_observed": COUNT,
        "source_population_known": BOOLEAN,
        "destination_coverage_sufficient": BOOLEAN,
        "destination_rows_without_key": COUNT,
        "records": {"description": "One record per source row, in order.", "type": "array", "items": ref("record")},
        "destination_only": {"description": "Scope exact only.", "type": "array",
                             "items": ref("destinationOnlyRecord")},
        "destination_only_counts": ref("counts"),
        "details": {"enum": ["problems", "all"]},
        "premises": ref("premises"),
        "inputs": ref("inputs"),
        "obligation": ref("obligation"),
        "evaluator": {"const": "v2-current-state-1"},
        "evaluated_at": ref("utcTime"),
        "limitations": {"const": LIMITS},
        "workflow_execution": {"const": "Not assessed"},
        "business_truth": {"const": "Not assessed"},
        "existed_by_deadline": {"const": "Not assessed"},
        "acquisition_authenticity": {"const": "not_authenticated"},
    }
    required = [name for name in properties if name not in ("destination_only", "destination_only_counts")]
    rules = [
        {"description": "Only a Verified result carries the claim.",
         "if": {"properties": {"cohort_state": {"const": "Verified"}}, "required": ["cohort_state"]},
         "then": {"properties": {"claim": {"const": CLAIM}}},
         "else": {"properties": {"claim": {"type": "null"}}}},
        {"description": "expected_total is a number exactly when the source population is known.",
         "if": {"properties": {"source_population_known": {"const": True}}, "required": ["source_population_known"]},
         "then": {"properties": {"expected_total": {"type": "integer"}}},
         "else": {"properties": {"expected_total": {"type": "null"}}}},
        {"description": "Destination-only records are reported exactly when the scope is exact.",
         "if": {"properties": {"obligation": {"properties": {"scope": {"const": "exact"}}, "required": ["scope"]}},
                "required": ["obligation"]},
         "then": {"required": ["destination_only", "destination_only_counts"]},
         "else": {"not": {"anyOf": [{"required": ["destination_only"]}, {"required": ["destination_only_counts"]}]}}},
        {"description": "With details all, every record has its rule results; with problems, a Verified record has "
                        "none.",
         "if": {"properties": {"details": {"const": "all"}}, "required": ["details"]},
         "then": {"properties": {"records": {"items": {"required": ["candidates", "rules"]}}}},
         "else": {"properties": {"records": {"items": {
             "if": {"properties": {"state": {"const": "Verified"}}, "required": ["state"]},
             "then": {"not": {"anyOf": [{"required": ["candidates"]}, {"required": ["rules"]}]}}}}}}},
    ]
    return {"$schema": DRAFT, "$id": f"{BASE}report-v{version}.schema.json", "title": title,
            "description": description, "type": "object", "properties": properties, "required": required,
            "allOf": rules, "$defs": definitions}


VERSIONS = (1, 2)  # 3 is added with the HubSpot destination


def text(version):
    return json.dumps(schema(version), indent=2, ensure_ascii=False) + "\n"


def path(version):
    return OUT / f"report-v{version}.schema.json"


def main(argv):
    if argv == ["--check"]:
        stale = [p.name for v in VERSIONS for p in [path(v)]
                 if not p.exists() or p.read_text(encoding="utf-8") != text(v)]
        for name in stale:
            print(f"docs/schema/{name} is not current", file=sys.stderr)
        if stale:
            print("run python3 offline/bench/schemas.py to write it again", file=sys.stderr)
        return 1 if stale else 0
    if argv:
        print(__doc__, file=sys.stderr)
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    for version in VERSIONS:
        path(version).write_text(text(version), encoding="utf-8")
    print(f"wrote {len(VERSIONS)} schemas to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
