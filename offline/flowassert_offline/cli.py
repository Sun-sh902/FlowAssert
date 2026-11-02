"""Compare a source CSV with a destination CSV export. Local files only; no network.

    flowassert-verify --source leads.csv --destination contacts.csv \\
        --key external_id --field phone --field email:hs_email \\
        --source-complete --destination-complete --json report.json

Exit: 0 Verified, 1 Mismatch, 3 Unverified, 2 the input was refused, 4 internal failure.
"""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import os
import sys

from . import __version__
from .evaluator_v2 import evaluate

EXIT = {"Verified": 0, "Mismatch": 1, "Unverified": 3}
CLAIM = "At this evaluation, the supplied destination rows satisfy the rules for the supplied source rows."
LIMITS = ("Files and completeness statements are not authenticated. Not assessed: whether a workflow ran, "
          "whether the source is true, whether a record existed by a past deadline.")


class Refused(Exception):
    pass


def pair(text):
    source, _, destination = text.partition(":")
    if not source:
        raise Refused("empty column name in " + repr(text))
    return source, destination or source


def _pair_list(item, path, label):
    if not isinstance(item, list) or len(item) != 2 or not all(isinstance(c, str) for c in item):
        raise Refused(f"{path}: {label} must be a two-item list of strings")
    if not all(c.strip() for c in item):
        raise Refused(f"{path}: empty column name in {label}")
    return item[0], item[1]


def _no_duplicate_members(pairs):
    obj = {}
    for name, value in pairs:
        if name in obj:
            raise Refused(f"duplicate member {name!r}")
        obj[name] = value
    return obj


def read_mapping(path):
    """Read and validate a UTF-8 JSON column mapping file."""
    try:
        with open(path, "rb") as f:
            raw = f.read()
        text = raw.decode("utf-8")
    except OSError as e:
        raise Refused(f"{path}: {e.strerror}")
    except UnicodeDecodeError:
        raise Refused(f"{path}: not UTF-8")
    try:
        data = json.loads(text, object_pairs_hook=_no_duplicate_members)
    except Refused as e:
        raise Refused(f"{path}: {e}")
    except json.JSONDecodeError as e:
        raise Refused(f"{path}: invalid JSON ({e.msg})")
    if not isinstance(data, dict):
        raise Refused(f"{path}: mapping must be a JSON object")
    unknown = sorted(set(data) - {"key", "fields"})
    if unknown:
        raise Refused(f"{path}: unknown member {', '.join(unknown)}")
    missing = [k for k in ("key", "fields") if k not in data]
    if missing:
        raise Refused(f"{path}: missing member {', '.join(missing)}")
    key = _pair_list(data["key"], path, "key")
    if not isinstance(data["fields"], list) or not data["fields"]:
        raise Refused(f"{path}: fields must be a non-empty list")
    fields = [_pair_list(f, path, "field") for f in data["fields"]]
    return key, fields, hashlib.sha256(raw).hexdigest()


def read_rows(path, columns):
    """Read one CSV strictly. A malformed file is refused rather than partly read."""
    try:
        with open(path, "rb") as f:
            raw = f.read()
        text = raw.decode("utf-8-sig")
    except OSError as e:
        raise Refused(f"{path}: {e.strerror}")
    except UnicodeDecodeError:
        raise Refused(f"{path}: not UTF-8")
    try:
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        header = reader.fieldnames or []
        if len(set(header)) != len(header):
            raise Refused(f"{path}: repeated column name")
        missing = [c for c in columns if c not in header]
        if missing:
            raise Refused(f"{path}: missing column {', '.join(missing)}")
        rows = []
        for row in reader:
            if None in row or None in row.values():
                raise Refused(f"{path}: line {reader.line_num} does not match the header")
            rows.append(row)
    except csv.Error as e:
        raise Refused(f"{path}: {e}")
    return rows, hashlib.sha256(raw).hexdigest()


def run(args):
    if args.mapping is not None:
        if args.key is not None or args.field:
            raise Refused("--mapping cannot be combined with --key or --field")
        key, fields, mapping_sha = read_mapping(args.mapping)
    else:
        if args.key is None:
            raise Refused("--key or --mapping is required")
        if not args.field:
            raise Refused("at least one --field is required")
        key = pair(args.key)
        fields = [pair(f) for f in args.field]
        mapping_sha = None
    if len({s for s, _ in fields}) != len(fields):
        raise Refused("a source field is repeated")
    if os.path.realpath(args.source) == os.path.realpath(args.destination):
        raise Refused("source and destination are the same file, so the check would not be independent")
    source_rows, source_sha = read_rows(args.source, [key[0]] + [s for s, _ in fields])
    destination_rows, destination_sha = read_rows(args.destination, [key[1]] + [d for _, d in fields])
    identical = source_sha == destination_sha
    if identical and not args.allow_identical_content:
        raise Refused(
            "source and destination have identical content, so the check would not be independent; "
            "pass --allow-identical-content if they really come from different systems"
        )
    report = evaluate({"key": key, "fields": fields}, source_rows, destination_rows,
                      source_complete=args.source_complete, destination_complete=args.destination_complete)
    report["evaluated_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    inputs = {"source_sha256": source_sha, "destination_sha256": destination_sha,
              "source_complete_stated": args.source_complete,
              "destination_complete_stated": args.destination_complete,
              "identical_content": identical}
    if identical:
        inputs["identical_content_allowed"] = True
    if mapping_sha is not None:
        inputs["mapping_file_sha256"] = mapping_sha
    report["inputs"] = inputs
    report["obligation"] = {"type": "current_state", "key": list(key), "fields": [list(f) for f in fields],
                            "comparison": "exact-string"}
    report["claim"] = CLAIM if report["cohort_state"] == "Verified" else None
    report["limitations"] = LIMITS
    if args.redact_values:
        for record in report["records"]:
            record["key"] = "[redacted]"
            for rule in record["rules"].values():
                rule.pop("expected", None)
                rule.pop("actual", None)
    return report


def summary(report):
    c = report["counts"]
    total = report["expected_total"]
    yield f"{report['cohort_state']}: {report['source_rows_observed']} rows of {'unknown total' if total is None else total}"
    yield f"Verified {c['Verified']} · Mismatch {c['Mismatch']} · Unverified {c['Unverified']}"
    if report.get("inputs", {}).get("identical_content"):
        yield "Source and destination files were identical (--allow-identical-content)."
    if not report["source_population_known"]:
        yield "Source population unknown: the batch cannot be Verified."
    if not report["destination_coverage_sufficient"]:
        yield "Destination coverage not established: absence and uniqueness stay unknown."
    for record in report["records"]:
        if record["state"] == "Verified":
            continue
        yield f"  record {record['source_row'] + 1} {record['key'] or '(no key)'}: {record['state']}"
        for name, rule in record["rules"].items():
            if rule["status"] != "pass":
                values = f" ({rule['expected']!r} vs {rule['actual']!r})" if "expected" in rule else ""
                yield f"    {name} {rule['status']}: {rule['reason']}{values}"
    yield report["limitations"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--key", help="source column, or source:destination")
    parser.add_argument("--field", action="append", default=[], help="source column, or source:destination; repeatable")
    parser.add_argument("--mapping", metavar="FILE", help="UTF-8 JSON file with key and fields column pairs")
    parser.add_argument("--source-complete", action="store_true", help="state that the source is the whole cohort")
    parser.add_argument("--destination-complete", action="store_true", help="state that the export covers the whole object")
    parser.add_argument("--allow-identical-content", action="store_true",
                        help="continue when two distinct files have identical content")
    parser.add_argument("--json", help="write the full report to this new file")
    parser.add_argument("--redact-values", action="store_true", help="omit compared values from the report")
    args = parser.parse_args(argv)
    try:
        report = run(args)
        if args.json:
            try:
                with open(args.json, "x", encoding="utf-8") as f:
                    json.dump(report, f, indent=2, sort_keys=True)
            except OSError as e:
                raise Refused(f"{args.json}: {e.strerror}")
        print("\n".join(summary(report)))
        sys.stdout.flush()
    except Refused as e:
        print(f"refused: {e}", file=sys.stderr)
        return 2
    except Exception as e:
        # Python's default exit status 1 would read as a Mismatch.
        if isinstance(e, BrokenPipeError):
            os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        print(f"failed: {type(e).__name__}", file=sys.stderr)
        return 4
    return EXIT[report["cohort_state"]]


if __name__ == "__main__":
    sys.exit(main())
