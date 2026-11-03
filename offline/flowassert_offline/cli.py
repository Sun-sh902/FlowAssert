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
from .evaluator_v2 import DETAILS, evaluate

EXIT = {"Verified": 0, "Mismatch": 1, "Unverified": 3}
MAX_BYTES = 209_715_200
MAX_ROWS = 1_000_000
MAX_DETAILS = 50
CLAIM = ("At this evaluation, under the stated premises, the supplied destination rows satisfy the rules "
         "for the supplied source rows.")
LIMITS = ("Files and completeness statements are not authenticated. Not assessed: whether a workflow ran, "
          "whether the source is true, whether a record existed by a past deadline.")
ORIGIN = "command-line option"
# name: (Python codec, label). The utf-8 codec accepts an optional byte order mark.
ENCODINGS = {"utf-8": ("utf-8-sig", "UTF-8"), "utf-16": ("utf-16", "UTF-16"), "gb18030": ("gb18030", "GB18030")}


class Refused(Exception):
    pass


class _HashReader(io.BufferedIOBase):
    def __init__(self, raw, digest):
        self._raw = raw
        self._digest = digest

    def readable(self):
        return True

    def read(self, size=-1):
        chunk = self._raw.read(size)
        self._digest.update(chunk)
        return chunk

    def read1(self, size=-1):
        chunk = self._raw.read1(size)
        self._digest.update(chunk)
        return chunk


def _int_arg(name, value, minimum):
    if isinstance(value, str) and value.isascii() and value.strip() == value:
        try:
            value = int(value, 10)
        except ValueError:
            pass
    kind = "positive" if minimum == 1 else "non-negative"
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise Refused(f"{name} must be a {kind} integer")
    return value


def _choice(name, value, allowed, default):
    if value is None:
        return default
    if value not in allowed:
        raise Refused(f"{name} must be one of: {', '.join(allowed)}")
    return value


def _check_size(path, max_bytes):
    try:
        size = os.stat(path).st_size
    except OSError as e:
        raise Refused(f"{path}: {e.strerror}")
    if size > max_bytes:
        raise Refused(f"{path}: file size {size} bytes exceeds --max-bytes limit of {max_bytes}")


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


def read_mapping(path, max_bytes=MAX_BYTES):
    """Read and validate a UTF-8 JSON column mapping file."""
    _check_size(path, max_bytes)
    try:
        with open(path, "rb") as f:
            raw = f.read()
        text = raw.decode("utf-8-sig")  # editors on Windows often add a BOM
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


class CsvFile:
    """One CSV file, read strictly and once. Iterating yields each data row as a dict of the
    selected columns only. A malformed or oversized file is refused rather than partly read;
    after a complete read, `sha256` and `rows` describe the whole file."""

    def __init__(self, path, columns, encoding="utf-8", max_rows=MAX_ROWS):
        self.path = path
        self.columns = list(dict.fromkeys(columns))
        self.encoding = encoding
        self.max_rows = max_rows
        self.sha256 = None
        self.rows = None

    def __iter__(self):
        path = self.path
        codec, label = ENCODINGS[self.encoding]
        digest = hashlib.sha256()
        count = 0
        try:
            with open(path, "rb") as raw_file:
                with io.TextIOWrapper(_HashReader(raw_file, digest), encoding=codec, newline="") as text_file:
                    reader = csv.reader(text_file, strict=True)
                    header = next(reader, [])
                    if len(set(header)) != len(header):
                        raise Refused(f"{path}: repeated column name")
                    missing = [c for c in self.columns if c not in header]
                    if missing:
                        raise Refused(f"{path}: missing column {', '.join(missing)}")
                    index = [(c, header.index(c)) for c in self.columns]
                    width = len(header)
                    for row in reader:
                        if not row:
                            continue  # a blank line is not a record
                        if len(row) != width:
                            raise Refused(f"{path}: line {reader.line_num} does not match the header")
                        if count == self.max_rows:
                            raise Refused(f"{path}: exceeds --max-rows limit of {self.max_rows}")
                        count += 1
                        yield {c: row[i] for c, i in index}
                for chunk in iter(lambda: raw_file.read(65536), b""):
                    digest.update(chunk)
        except OSError as e:
            raise Refused(f"{path}: {e.strerror}")
        except UnicodeError as e:
            # Python 3.9 raises a plain UnicodeError here, later versions a UnicodeDecodeError.
            hint = " (no byte order mark)" if "BOM" in str(e) else ""
            raise Refused(f"{path}: not {label}{hint}")
        except csv.Error as e:
            raise Refused(f"{path}: {e}")
        self.rows = count
        self.sha256 = digest.hexdigest()


def run(args):
    max_bytes = _int_arg("--max-bytes", args.max_bytes, 1)
    max_rows = _int_arg("--max-rows", args.max_rows, 1)
    counts = {name: None if value is None else _int_arg(option, value, 0) for name, option, value in (
        ("source_count", "--source-count", args.source_count),
        ("destination_count", "--destination-count", args.destination_count))}
    details = _choice("--details", args.details, DETAILS, "problems")
    source_encoding = _choice("--source-encoding", args.source_encoding, tuple(ENCODINGS), "utf-8")
    destination_encoding = _choice("--destination-encoding", args.destination_encoding, tuple(ENCODINGS), "utf-8")
    if args.mapping is not None:
        if args.key is not None or args.field:
            raise Refused("--mapping cannot be combined with --key or --field")
        key, fields, mapping_sha = read_mapping(args.mapping, max_bytes=max_bytes)
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
    _check_size(args.source, max_bytes)
    _check_size(args.destination, max_bytes)
    source = CsvFile(args.source, [key[0]] + [s for s, _ in fields], encoding=source_encoding, max_rows=max_rows)
    destination = CsvFile(args.destination, [key[1]] + [d for _, d in fields],
                          encoding=destination_encoding, max_rows=max_rows)
    report = evaluate({"key": key, "fields": fields}, source, destination, source_complete=args.source_complete,
                      destination_complete=args.destination_complete, details=details, **counts)
    identical = source.sha256 == destination.sha256
    if identical and not args.allow_identical_content:
        raise Refused(
            "source and destination have identical content, so the check would not be independent; "
            "pass --allow-identical-content if they really come from different systems"
        )
    report["details"] = details
    report["evaluated_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    inputs = {"source_sha256": source.sha256, "destination_sha256": destination.sha256,
              "source_complete_stated": args.source_complete,
              "destination_complete_stated": args.destination_complete,
              "identical_content": identical}
    if identical:
        inputs["identical_content_allowed"] = True
    if mapping_sha is not None:
        inputs["mapping_file_sha256"] = mapping_sha
    if args.source_encoding is not None or args.destination_encoding is not None:
        inputs["source_encoding"] = source_encoding
        inputs["destination_encoding"] = destination_encoding
    report["inputs"] = inputs
    premises = report["premises"]
    if args.allow_identical_content:
        premises["allow_identical_content"] = {"stated": True}
    for premise in premises.values():
        premise["origin"] = ORIGIN
    report["obligation"] = {"type": "current_state", "key": list(key), "fields": [list(f) for f in fields],
                            "comparison": "exact-string"}
    report["claim"] = CLAIM if report["cohort_state"] == "Verified" else None
    report["limitations"] = LIMITS
    if args.redact_values:
        report["records"] = report["records"].redacted()
    return report


def summary(report, max_details=MAX_DETAILS):
    c = report["counts"]
    total = report["expected_total"]
    yield f"{report['cohort_state']}: {report['source_rows_observed']} rows of {'unknown total' if total is None else total}"
    yield f"Verified {c['Verified']} · Mismatch {c['Mismatch']} · Unverified {c['Unverified']}"
    if report.get("inputs", {}).get("identical_content"):
        yield "Source and destination files were identical (--allow-identical-content)."
    premises = report.get("premises", {})
    for name, label, consequence in (("source_count", "Source", "the batch cannot be Verified"),
                                     ("destination_count", "Destination", "absence and uniqueness stay unknown")):
        count = premises.get(name, {})
        if count.get("matched") is False:
            yield f"{label} count stated {count['stated']}, file has {count['observed']} rows: {consequence}."
    if not report["source_population_known"]:
        yield "Source population unknown: the batch cannot be Verified."
    if not report["destination_coverage_sufficient"]:
        yield "Destination coverage not established: absence and uniqueness stay unknown."
    shown = 0
    omitted = 0
    for record in report["records"].problems():
        if shown >= max_details:
            omitted += 1
            continue
        shown += 1
        yield f"  record {record['source_row'] + 1} {record['key'] or '(no key)'}: {record['state']}"
        for name, rule in record["rules"].items():
            if rule["status"] != "pass":
                values = f" ({rule['expected']!r} vs {rule['actual']!r})" if "expected" in rule else ""
                yield f"    {name} {rule['status']}: {rule['reason']}{values}"
    if omitted:
        yield f"... {omitted} more records not shown; use --json for all of them."
    yield report["limitations"]


def _indented(value, prefix):
    # A JSON text has no raw line breaks inside strings, so this only indents structure.
    return json.dumps(value, indent=2, sort_keys=True).replace("\n", "\n" + prefix)


def write_json(report, f):
    """Write the report as json.dump(indent=2, sort_keys=True) would, one record at a time
    so the whole text is never held in memory."""
    for number, name in enumerate(sorted(report)):
        f.write(("{\n  " if number == 0 else ",\n  ") + json.dumps(name) + ": ")
        if name != "records":
            f.write(_indented(report[name], "  "))
            continue
        separator = "[\n    "
        for record in report[name]:
            f.write(separator + _indented(record, "    "))
            separator = ",\n    "
        f.write("[]" if separator == "[\n    " else "\n  ]")
    f.write("\n}")


def _write_reports(report, targets):
    """Write each (path, writer) to a new file. If any cannot be written, remove the ones created."""
    opened = []
    try:
        for path, writer in targets:
            try:
                opened.append((path, open(path, "x", encoding="utf-8"), writer))
            except OSError as e:
                raise Refused(f"{path}: {e.strerror}")
        for path, f, writer in opened:
            try:
                with f:
                    writer(report, f)
            except OSError as e:
                raise Refused(f"{path}: {e.strerror}")
    except BaseException:
        for path, f, _ in opened:
            f.close()
            try:
                os.remove(path)
            except OSError:
                pass
        raise


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
    parser.add_argument("--source-count", metavar="N", help="state the source total seen in the original system")
    parser.add_argument("--destination-count", metavar="N",
                        help="state the destination total seen in the original system")
    parser.add_argument("--allow-identical-content", action="store_true",
                        help="continue when two distinct files have identical content")
    parser.add_argument("--source-encoding", metavar="NAME", help="utf-8 (default), utf-16 or gb18030")
    parser.add_argument("--destination-encoding", metavar="NAME", help="utf-8 (default), utf-16 or gb18030")
    parser.add_argument("--max-bytes", default=MAX_BYTES, metavar="N",
                        help=f"maximum bytes per file before reading (default: {MAX_BYTES})")
    parser.add_argument("--max-rows", default=MAX_ROWS, metavar="N",
                        help=f"maximum rows per CSV file while reading (default: {MAX_ROWS})")
    parser.add_argument("--max-details", default=MAX_DETAILS, metavar="N",
                        help=f"maximum non-Verified records shown in summary; 0 shows none (default: {MAX_DETAILS})")
    parser.add_argument("--details", metavar="LEVEL",
                        help="problems (default): Verified records in --json keep only key, source_row and state; "
                             "all: every record in full")
    parser.add_argument("--json", help="write the full report to this new file")
    parser.add_argument("--redact-values", action="store_true", help="omit compared values from the report")
    args = parser.parse_args(argv)
    try:
        max_details = _int_arg("--max-details", args.max_details, 0)
        report = run(args)
        _write_reports(report, [(args.json, write_json)] if args.json else [])
        print("\n".join(summary(report, max_details=max_details)))
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
