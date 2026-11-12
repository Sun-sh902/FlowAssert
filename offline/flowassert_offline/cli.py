"""Compare a source CSV with a destination CSV export. Local files only, and no network, unless --source-sheet
reads the source from a Google Sheets range, read-only (docs/connectors/google-sheets.md), or --destination-hubspot
reads the destination from HubSpot's contacts, read-only (docs/connectors/hubspot.md).

    flowassert-verify --source leads.csv --destination contacts.csv \\
        --key external_id --field phone --field email:hs_email \\
        --source-complete --destination-complete --json report.json

Exit: 0 Verified, 1 Mismatch, 3 Unverified, 2 the input was refused, 4 internal failure.
"""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import html
import io
import json
import os
import sys

from . import __version__, chardiff, exports, hubspot, sheets, xlsx
from .errors import Refused
from .evaluator_v2 import DETAILS, SCOPES, STATES, evaluate, parse_rule

EXIT = {"Verified": 0, "Mismatch": 1, "Unverified": 3}
MAX_BYTES = 209_715_200
MAX_ROWS = 1_000_000
MAX_DETAILS = 50
SCHEMA_VERSION = 1
# A report whose source is a Google Sheets range: three members of version 1 mean something else for it.
SHEET_SCHEMA_VERSION = 2
# A report whose destination was read from HubSpot: its destination digest, row count and completeness statement are
# about the records the API listed, not about a file.
HUBSPOT_SCHEMA_VERSION = 3
# A report in which either side was read from an .xlsx workbook: that side's digest and rows describe a worksheet.
WORKBOOK_SCHEMA_VERSION = 4
CLAIM = ("At this evaluation, under the stated premises, the supplied destination rows satisfy the rules "
         "for the supplied source rows.")
LIMITS = ("Files and completeness statements are not authenticated. Not assessed: whether a workflow ran, "
          "whether the source is true, whether a record existed by a past deadline.")
ORIGIN = "command-line option"
# name: (Python codec, label). The utf-8 codec accepts an optional byte order mark.
ENCODINGS = {"utf-8": ("utf-8-sig", "UTF-8"), "utf-16": ("utf-16", "UTF-16"), "gb18030": ("gb18030", "GB18030")}
CONFIG_MEMBERS = ("key", "fields", "scope")
# Premises are stated at each run, so a configuration file cannot carry them.
COMMAND_LINE_ONLY = {"source_complete", "destination_complete", "source_count", "destination_count",
                     "allow_identical_content"}


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


def _read_json(path, max_bytes):
    """Read a UTF-8 JSON file, with an optional byte order mark, refusing duplicate members."""
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
    return data, hashlib.sha256(raw).hexdigest()


def read_mapping(path, max_bytes=MAX_BYTES):
    """Read and validate a UTF-8 JSON column mapping file."""
    data, digest = _read_json(path, max_bytes)
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
    return key, fields, digest


def _config_field(item, path):
    if not isinstance(item, dict):
        raise Refused(f"{path}: each field must be an object with source, destination and an optional rule")
    unknown = sorted(set(item) - {"source", "destination", "rule"})
    if unknown:
        raise Refused(f"{path}: unknown member {', '.join(unknown)} in field")
    missing = [k for k in ("source", "destination") if k not in item]
    if missing:
        raise Refused(f"{path}: missing member {', '.join(missing)} in field")
    for name in ("source", "destination"):
        if not isinstance(item[name], str):
            raise Refused(f"{path}: field {name} must be a string")
        if not item[name].strip():
            raise Refused(f"{path}: empty column name in field")
    rule = item.get("rule", "exact")
    if not isinstance(rule, str):
        raise Refused(f"{path}: field rule must be a string")
    try:
        parse_rule(rule)
    except ValueError as e:
        raise Refused(f"{path}: field {item['source']!r}: {e}")
    return item["source"], item["destination"], rule


def read_config(path, max_bytes=MAX_BYTES):
    """Read and validate a UTF-8 JSON configuration file: key, fields with rules, and scope."""
    data, digest = _read_json(path, max_bytes)
    if not isinstance(data, dict):
        raise Refused(f"{path}: configuration must be a JSON object")
    premises = sorted(n for n in data if n.replace("-", "_").lower() in COMMAND_LINE_ONLY)
    if premises:
        raise Refused(f"{path}: {', '.join(premises)} cannot be set in a configuration file; completeness "
                      "statements and counts are command-line options, chosen at each run")
    unknown = sorted(set(data) - set(CONFIG_MEMBERS))
    if unknown:
        raise Refused(f"{path}: unknown member {', '.join(unknown)}")
    missing = [k for k in ("key", "fields") if k not in data]
    if missing:
        raise Refused(f"{path}: missing member {', '.join(missing)}")
    key = _pair_list(data["key"], path, "key")
    if not isinstance(data["fields"], list) or not data["fields"]:
        raise Refused(f"{path}: fields must be a non-empty list")
    fields = [_config_field(f, path) for f in data["fields"]]
    if len({s for s, _, _ in fields}) != len(fields):
        raise Refused(f"{path}: a source field is repeated")
    scope = data.get("scope")
    if "scope" in data and scope not in SCOPES:
        raise Refused(f"{path}: scope must be one of: {', '.join(SCOPES)}")
    return key, fields, scope, digest


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

    def full_rows(self):
        """The header, then every data row with all its fields, read again for the records to resend. The file must
        have the bytes it had when it was checked."""
        path = self.path
        codec, _ = ENCODINGS[self.encoding]
        digest = hashlib.sha256()
        try:
            with open(path, "rb") as raw_file:
                with io.TextIOWrapper(_HashReader(raw_file, digest), encoding=codec, newline="") as text_file:
                    reader = csv.reader(text_file, strict=True)
                    yield next(reader, [])
                    for row in reader:
                        if row:
                            yield row
                for chunk in iter(lambda: raw_file.read(65536), b""):
                    digest.update(chunk)
        except (OSError, UnicodeError, csv.Error):
            raise Refused(f"{path}: changed after it was checked; nothing was exported")
        if digest.hexdigest() != self.sha256:
            raise Refused(f"{path}: changed after it was checked; nothing was exported")


def _rows_again(side):
    """A side's rows read again for the records to resend: the header, then every data row in full."""
    if isinstance(side, CsvFile):
        yield from side.full_rows()
    elif isinstance(side, xlsx.XlsxFile):
        checked = side.sha256
        try:
            yield from side.full_rows()
        except Refused:
            raise Refused(f"{side.path}: changed after it was checked; nothing was exported")
        if side.sha256 != checked:
            raise Refused(f"{side.path}: changed after it was checked; nothing was exported")
    elif isinstance(side, sheets.SheetSource):
        width = len(side._header)
        yield list(side._header)
        for row in side._data:
            yield list(row) + [""] * (width - len(row))
    else:
        yield list(side.columns)
        yield from (list(values) for values in side.kept)


def _export_dir(args):
    """The new directory for the records to resend, checked before any input is read, or None."""
    if args.export_dir is None:
        return None
    if args.redact_values:
        raise Refused("--export-dir cannot be combined with --redact-values: the exported rows hold the values")
    if os.path.lexists(args.export_dir):
        raise Refused(f"{args.export_dir}: exists; --export-dir writes to a new directory")
    return args.export_dir


def _selection(args, max_bytes):
    """Return key, fields as (source, destination, rule), scope, and which files chose them."""
    sha = {}
    if args.config is not None:
        conflicts = [name for name, given in (("--mapping", args.mapping is not None), ("--key", args.key is not None),
                                              ("--field", bool(args.field)), ("--scope", args.scope is not None))
                     if given]
        if conflicts:
            raise Refused(f"--config cannot be combined with {', '.join(conflicts)}")
        key, fields, scope, sha["config_file_sha256"] = read_config(args.config, max_bytes=max_bytes)
        return key, fields, scope, sha
    scope = None if args.scope is None else _choice("--scope", args.scope, SCOPES, None)
    if args.mapping is not None:
        if args.key is not None or args.field:
            raise Refused("--mapping cannot be combined with --key or --field")
        key, pairs, sha["mapping_file_sha256"] = read_mapping(args.mapping, max_bytes=max_bytes)
    else:
        if args.key is None:
            raise Refused("--key or --mapping is required")
        if not args.field:
            raise Refused("at least one --field is required")
        key = pair(args.key)
        pairs = [pair(f) for f in args.field]
    return key, [(s, d, "exact") for s, d in pairs], scope, sha


def _sheet_source(args, max_bytes):
    """The sheet source the options name, checked and with the credential read, or None for a file."""
    if args.source_sheet is None:
        for option, given in (("--source-range", args.source_range is not None),
                              ("--source-timeout", args.source_timeout is not None),
                              ("--skip-source-revision", args.skip_source_revision)):
            if given:
                raise Refused(f"{option} needs --source-sheet")
        return None
    if args.source is not None:
        raise Refused("--source and --source-sheet cannot be combined")
    if args.source_range is None:
        raise Refused("--source-sheet needs --source-range")
    if args.source_encoding is not None:
        raise Refused("--source-encoding does not apply to a sheet source")
    timeout = sheets.TIMEOUT if args.source_timeout is None else _int_arg("--source-timeout", args.source_timeout, 1)
    return sheets.SheetSource(args.source_sheet, args.source_range, max_bytes=max_bytes, timeout=timeout,
                              revision=not args.skip_source_revision)


def _hubspot_destination(args, max_bytes):
    """The HubSpot destination the options name, checked and with the credential read, or None for a file."""
    if args.destination_hubspot is None:
        if args.destination_timeout is not None:
            raise Refused("--destination-timeout needs --destination-hubspot")
        return None
    if args.destination is not None:
        raise Refused("--destination and --destination-hubspot cannot be combined")
    if args.destination_hubspot not in hubspot.OBJECTS:
        raise Refused("--destination-hubspot must be contacts")
    if args.destination_encoding is not None:
        raise Refused("--destination-encoding does not apply to a HubSpot destination")
    timeout = (hubspot.TIMEOUT if args.destination_timeout is None
               else _int_arg("--destination-timeout", args.destination_timeout, 1))
    return hubspot.HubSpotDestination(args.destination_hubspot, max_bytes=max_bytes, timeout=timeout)


def _formats(args):
    """The format of each side, checked against the other options. Before any file is read (spec R12.3)."""
    source_format = _choice("--source-format", args.source_format, xlsx.FORMATS, "csv")
    destination_format = _choice("--destination-format", args.destination_format, xlsx.FORMATS, "csv")
    if args.source_format is not None and args.source_sheet is not None:
        raise Refused("--source-format does not apply to a sheet source")
    if args.destination_format is not None and args.destination_hubspot is not None:
        raise Refused("--destination-format does not apply to a HubSpot destination")
    if args.source_worksheet is not None and source_format != "xlsx":
        raise Refused("--source-worksheet needs --source-format xlsx")
    if args.destination_worksheet is not None and destination_format != "xlsx":
        raise Refused("--destination-worksheet needs --destination-format xlsx")
    if args.source_encoding is not None and source_format == "xlsx":
        raise Refused("--source-encoding does not apply to a workbook")
    if args.destination_encoding is not None and destination_format == "xlsx":
        raise Refused("--destination-encoding does not apply to a workbook")
    return source_format == "xlsx", destination_format == "xlsx"


def run(args):
    """The report of one check."""
    return check(args)[0]


def check(args):
    """The report of one check, and with --export-dir the records to resend: {"directory", "files", "formulas"}, or
    None."""
    max_bytes = _int_arg("--max-bytes", args.max_bytes, 1)
    max_rows = _int_arg("--max-rows", args.max_rows, 1)
    counts = {name: None if value is None else _int_arg(option, value, 0) for name, option, value in (
        ("source_count", "--source-count", args.source_count),
        ("destination_count", "--destination-count", args.destination_count))}
    details = _choice("--details", args.details, DETAILS, "problems")
    source_encoding = _choice("--source-encoding", args.source_encoding, tuple(ENCODINGS), "utf-8")
    destination_encoding = _choice("--destination-encoding", args.destination_encoding, tuple(ENCODINGS), "utf-8")
    source_book, destination_book = _formats(args)
    export_dir = _export_dir(args)
    sheet = _sheet_source(args, max_bytes)
    crm = _hubspot_destination(args, max_bytes)
    key, fields, scope, selection_sha = _selection(args, max_bytes)
    if len({s for s, _, _ in fields}) != len(fields):
        raise Refused("a source field is repeated")
    destination_columns = [key[1]] + [d for _, d, _ in fields]
    if crm is not None:
        crm.select(destination_columns, max_rows)
    if sheet is None and crm is None:
        if os.path.realpath(args.source) == os.path.realpath(args.destination):
            raise Refused("source and destination are the same file, so the check would not be independent")
    if sheet is None:
        _check_size(args.source, max_bytes)
    if crm is None:
        _check_size(args.destination, max_bytes)
    source_columns = [key[0]] + [s for s, _, _ in fields]
    if source_book:
        source = xlsx.XlsxFile(args.source, source_columns, worksheet=args.source_worksheet, max_rows=max_rows,
                               max_bytes=max_bytes, option="--source-worksheet")
    elif sheet is None:
        source = CsvFile(args.source, source_columns, encoding=source_encoding, max_rows=max_rows)
    else:
        sheet.select(source_columns, max_rows)
        sheet.read()
        source = sheet
    if destination_book:
        destination = xlsx.XlsxFile(args.destination, destination_columns, worksheet=args.destination_worksheet,
                                    max_rows=max_rows, max_bytes=max_bytes, option="--destination-worksheet")
    elif crm is None:
        destination = CsvFile(args.destination, destination_columns, encoding=destination_encoding, max_rows=max_rows)
    else:
        destination = crm
    if export_dir is not None and crm is not None and (scope or "source") == "exact":
        crm.kept = []  # HubSpot is listed once: its records are kept for the destination-only rows
    obligation = {"key": key, "fields": fields, "scope": scope or "source"}
    report = evaluate(obligation, source, destination, source_complete=args.source_complete,
                      destination_complete=args.destination_complete, details=details, **counts)
    identical = source.sha256 == destination.sha256
    if identical and not args.allow_identical_content:
        raise Refused(
            "source and destination have identical content, so the check would not be independent; "
            "pass --allow-identical-content if they really come from different systems"
        )
    report["schema_version"] = (WORKBOOK_SCHEMA_VERSION if source_book or destination_book
                                else HUBSPOT_SCHEMA_VERSION if crm is not None
                                else SCHEMA_VERSION if sheet is None else SHEET_SCHEMA_VERSION)
    report["details"] = details
    report["evaluated_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    inputs = {"source_sha256": source.sha256, "destination_sha256": destination.sha256,
              "source_complete_stated": args.source_complete,
              "destination_complete_stated": args.destination_complete,
              "identical_content": identical}
    if identical:
        inputs["identical_content_allowed"] = True
    inputs.update(selection_sha)
    if crm is not None:
        # No destination encoding: the destination is not a file.
        if sheet is not None:
            inputs["source_sheet"] = sheet.member
        elif args.source_encoding is not None:
            inputs["source_encoding"] = source_encoding
        inputs["destination_hubspot"] = crm.member
    elif sheet is not None:
        inputs["source_sheet"] = sheet.member
        if args.destination_encoding is not None:
            inputs["destination_encoding"] = destination_encoding
    elif source_book or destination_book:
        # Only a CSV side has an encoding; it is recorded alone when it was stated.
        if args.source_encoding is not None:
            inputs["source_encoding"] = source_encoding
        if args.destination_encoding is not None:
            inputs["destination_encoding"] = destination_encoding
    elif args.source_encoding is not None or args.destination_encoding is not None:
        inputs["source_encoding"] = source_encoding
        inputs["destination_encoding"] = destination_encoding
    if source_book:
        inputs["source_workbook"] = source.member
    if destination_book:
        inputs["destination_workbook"] = destination.member
    report["inputs"] = inputs
    premises = report["premises"]
    if args.allow_identical_content:
        premises["allow_identical_content"] = {"stated": True}
    for premise in premises.values():
        premise["origin"] = ORIGIN
    rules = [rule for _, _, rule in fields]
    report["obligation"] = {"type": "current_state", "key": list(key), "fields": [[s, d] for s, d, _ in fields],
                            "comparison": "exact-string" if set(rules) == {"exact"} else "per-field-rule"}
    if args.config is not None:
        report["obligation"]["rules"] = rules
    if scope is not None:
        report["obligation"]["scope"] = scope
    report["claim"] = CLAIM if report["cohort_state"] == "Verified" else None
    report["limitations"] = LIMITS
    if args.redact_values:
        report["records"] = report["records"].redacted()
        for record in report.get("destination_only", []):
            record["key"] = "[redacted]"
    export = None
    if export_dir is not None:
        files, formulas = exports.build(report, _rows_again(source), _rows_again(destination), key[1])
        export = {"directory": export_dir, "files": files, "formulas": formulas}
    return report, export


def sheet_lines(sheet):
    """What the summary says of a source read from Google Sheets: where it was read, and whether it is tied to a
    revision. Never that the range is the whole cohort: that is the premise source_complete."""
    yield (f"Source read by FlowAssert from Google Sheets: spreadsheet {sheet['spreadsheet_id']}, "
           f"range {sheet['range_returned']}, at {sheet['read_at']}.")
    revision = sheet["revision"]
    if revision["available"]:
        yield f"Drive version {revision['before']['version']} before and after the values were read."
    else:
        yield f"The read cannot be tied to a revision: {revision['reason']}."


def _plural(n, one, many):
    return f"{n} {one}" if n == 1 else f"{n} {many}"


def workbook_lines(label, book):
    """What the summary says of a side read from a workbook: which worksheet, that cells were read as stored, and
    what a spreadsheet may display otherwise. docs/design/1.1-excel.md, "The printed summary"."""
    yield f"{label} read from worksheet {book['worksheet']!r} of an .xlsx workbook: cells as stored, not as displayed."
    cells = book["cells"]
    parts = [_plural(cells[name], one, many) for name, one, many in (
        ("number", "number", "numbers"),
        ("percentage", "percentage as a fraction", "percentages as fractions"),
        ("date_time", "date or time in ISO 8601", "dates or times in ISO 8601"),
        ("duration", "duration in days", "durations in days"),
        ("boolean", "boolean as TRUE or FALSE", "booleans as TRUE or FALSE"),
        ("formula", "formula result as last saved", "formula results as last saved")) if cells[name]]
    if parts:
        yield f"  Read as stored, where a spreadsheet may display them otherwise: {', '.join(parts)}."
    sentences = []
    hidden = [_plural(book[name], one, many) for name, one, many in (
        ("hidden_rows", "row", "rows"), ("hidden_columns", "column", "columns")) if book[name]]
    if hidden:
        sentences.append(f"Hidden: {', '.join(hidden)}, read like any other.")
    if book["merged_ranges"]:
        sentences.append(f"Merged ranges: {book['merged_ranges']}, read as stored: only the first cell of each holds "
                         "the value.")
    if sentences:
        yield "  " + " ".join(sentences)


def summary(report, max_details=MAX_DETAILS):
    c = report["counts"]
    total = report["expected_total"]
    yield f"{report['cohort_state']}: {report['source_rows_observed']} rows of {'unknown total' if total is None else total}"
    yield f"Verified {c['Verified']} · Mismatch {c['Mismatch']} · Unverified {c['Unverified']}"
    sheet = report.get("inputs", {}).get("source_sheet")
    if sheet is not None:
        yield from sheet_lines(sheet)
    crm = report.get("inputs", {}).get("destination_hubspot")
    if crm is not None:
        yield from hubspot.summary_lines(crm)
    for side, label in (("source_workbook", "Source"), ("destination_workbook", "Destination")):
        book = report.get("inputs", {}).get(side)
        if book is not None:
            yield from workbook_lines(label, book)
    if report.get("inputs", {}).get("identical_content"):
        yield "Source and destination files were identical (--allow-identical-content)."
    premises = report.get("premises", {})
    for name, label, consequence in (("source_count", "Source", "the batch cannot be Verified"),
                                     ("destination_count", "Destination", "absence and uniqueness stay unknown")):
        count = premises.get(name, {})
        if count.get("matched") is False:
            if crm is not None and name == "destination_count":
                yield f"{label} count stated {count['stated']}, HubSpot listed {count['observed']} records: {consequence}."
                continue
            held = "range has" if sheet is not None and name == "source_count" else "file has"
            yield f"{label} count stated {count['stated']}, {held} {count['observed']} rows: {consequence}."
    if not report["source_population_known"]:
        yield "Source population unknown: the batch cannot be Verified."
    if not report["destination_coverage_sufficient"]:
        yield "Destination coverage not established: absence and uniqueness stay unknown."
    if "destination_only" in report:
        n = len(report["destination_only"])
        if not n:
            yield "Destination-only: 0 records not in the source."
        elif report["source_population_known"]:
            yield f"Destination-only: {n} records not in the source, each a Mismatch."
        else:
            yield f"Destination-only: {n} records not in the source, listed without a conclusion."
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
                if "expected_normalized" in rule:
                    values += f", compared as ({rule['expected_normalized']!r} vs {rule['actual_normalized']!r})"
                yield f"    {name} {rule['status']}: {rule['reason']}{values}"
    if omitted:
        yield f"... {omitted} more records not shown; use --json for all of them."
    yield report["limitations"]


def _indented(value, prefix):
    # A JSON text has no raw line breaks inside strings, so this only indents structure.
    return json.dumps(value, indent=2, sort_keys=True).replace("\n", "\n" + prefix)


def write_json(report, f):
    """Write the report as json.dump(indent=2, sort_keys=True) would, with schema_version first,
    one record at a time so the whole text is never held in memory."""
    f.write('{\n  "schema_version": ' + json.dumps(report["schema_version"]))
    for name in sorted(report):
        if name == "schema_version":
            continue
        f.write(",\n  " + json.dumps(name) + ": ")
        if name != "records":
            f.write(_indented(report[name], "  "))
            continue
        separator = "[\n    "
        for record in report[name]:
            f.write(separator + _indented(record, "    "))
            separator = ",\n    "
        f.write("[]" if separator == "[\n    " else "\n  ]")
    f.write("\n}")


# The page's style: the Evidence Atelier palette of the browser check, light and dark, and a print layout. Fonts are
# the reader's own; nothing is loaded. ui/src/offline/report.ts writes the same style, byte for byte.
_HTML_STYLE = """
:root{color-scheme:light dark;--canvas:#f3efe6;--surface:#fbf9f4;--sunken:#ece6d9;--line:#d8d0bf;--line-2:#e6e0d2;
--line-3:#b9b09c;--ink:#1d1b16;--ink-2:#4b473e;--ink-3:#6d675a;--brand:#2f3590;--brand-soft:#e4e4f1;
--v:#255a3b;--v-soft:#dfe9df;--v-line:#b7cfba;--m:#a23117;--m-soft:#f5e0d6;--m-line:#e7b7a5;--u:#4b473e;
--u-soft:#ebe6da;--u-line:#b9b09c;--p:#845a08;
--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;
--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
@media (prefers-color-scheme:dark){:root{--canvas:#14120e;--surface:#1c1915;--sunken:#110f0c;--line:#34302a;
--line-2:#29261f;--line-3:#4d473d;--ink:#ece6d8;--ink-2:#bdb5a4;--ink-3:#8f8777;--brand:#b4b9ff;
--brand-soft:rgb(154 162 255/.14);--v:#7cc597;--v-soft:rgb(75 162 111/.13);--v-line:rgb(75 162 111/.35);--m:#f0937d;
--m-soft:rgb(226 101 74/.13);--m-line:rgb(226 101 74/.38);--u:#b6ae9d;--u-soft:rgb(138 132 118/.14);--u-line:#4d473d;
--p:#e3b35c}}
*{box-sizing:border-box}
html{background:var(--canvas)}
body{margin:0 auto;max-width:60rem;padding:2rem 1rem 3rem;font:15px/1.55 var(--sans);color:var(--ink);
background:var(--canvas);overflow-wrap:anywhere}
h1,h2,h3{font-family:var(--serif);font-weight:400;line-height:1.2;margin:0}
h2{font-size:1.45rem;margin:2.4rem 0 .5rem;padding-bottom:.35rem;border-bottom:1px solid var(--line)}
h3{font-size:1.08rem}
p{margin:.35rem 0}
code{font-family:var(--mono);font-size:.86em;white-space:pre-wrap}
.kicker{margin:0 0 .5rem;font-size:.72rem;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)}
.verdict{padding:1.4rem 1.5rem 1.2rem;background:var(--surface);border:1px solid var(--line);border-radius:10px}
.seal{display:inline-flex;align-items:center;gap:.5rem;padding:.3rem .9rem .35rem;font-size:2.1rem;border-radius:4px;
border:1.5px solid}
.claim{max-width:44rem;margin-top:.9rem;font-size:1.05rem}
.rows{color:var(--ink-2)}
.counts{display:flex;flex-wrap:wrap;gap:.4rem 1.6rem;margin:.6rem 0 0;padding:0}
.counts div{display:flex;gap:.45rem;align-items:baseline}.counts dt{color:var(--ink-2)}
.counts dd{margin:0;font-family:var(--mono);font-weight:600}
.meta{margin-top:.8rem;font-size:.82rem;color:var(--ink-3)}
.s-Verified{color:var(--v);background:var(--v-soft);border-color:var(--v-line)}
.s-Mismatch{color:var(--m);background:var(--m-soft);border-color:var(--m-line)}
.s-Unverified{color:var(--u);background:var(--u-soft);border-color:var(--u-line)}
.s-Pending{color:var(--p);background:var(--u-soft);border-color:var(--u-line)}
.counts .s-Verified,.counts .s-Mismatch,.counts .s-Unverified{background:none}
.premises{margin-top:1.4rem;padding:.9rem 1.2rem 1rem;border:2px solid var(--u-line);border-radius:10px}
.premises h2{margin-top:0;border:0;padding:0;font-size:1.25rem}
.note{font-size:.86rem;color:var(--ink-3)}
.premise{padding:.55rem 0;border-top:1px solid var(--line-2)}
.premise:first-of-type{border-top:0}
.premise p{margin:.1rem 0}.premise .name{font-weight:600}.premise .name code{font-weight:400;color:var(--ink-3)}
.applied{font-size:.86rem;font-weight:600}.applied.yes{color:var(--v)}.applied.no{color:var(--m)}
.applied.none{color:var(--ink-3);font-weight:400}
table.facts{border-collapse:collapse;width:100%;margin:.4rem 0;font-size:.9rem}
.facts th,.facts td{padding:.32rem .5rem;border-bottom:1px solid var(--line-2);text-align:left;vertical-align:top}
.facts th{width:38%;font-weight:500;color:var(--ink-2)}
.record{margin:.8rem 0;padding:.9rem 1.1rem 1rem;background:var(--surface);border:1px solid var(--line);
border-left:4px solid var(--line-3);border-radius:8px;break-inside:avoid}
.record.s-Mismatch{border-left-color:var(--m-line);color:inherit;background:var(--surface)}
.record.s-Unverified{border-left-color:var(--u-line);color:inherit;background:var(--surface)}
.record h3{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .6rem}
.badge{display:inline-block;padding:.05rem .5rem;font:600 .74rem/1.6 var(--sans);border:1px solid;border-radius:3px}
.carries{font-size:.84rem;color:var(--ink-2)}
.rules{list-style:none;margin:.5rem 0 0;padding:0}
.rule{padding:.55rem 0;border-top:1px solid var(--line-2)}
.rule p{margin:.12rem 0}.rule-head{display:flex;flex-wrap:wrap;gap:.2rem .6rem;align-items:baseline}
.st{font-size:.8rem;font-weight:600}.st-pass{color:var(--v)}.st-fail{color:var(--m)}.st-unknown{color:var(--p)}
.reason{font-size:.86rem;color:var(--ink-3)}
.values{display:grid;grid-template-columns:8.5rem minmax(0,1fr);gap:.15rem .8rem;margin:.35rem 0 0;font-size:.86rem}
.values dt{color:var(--ink-3)}.values dd{margin:0;min-width:0}
.v{color:var(--ink)}.none{color:var(--ink-3);font-style:italic}
.diff{margin:.5rem 0 0;padding:.55rem .75rem;background:var(--sunken);border:1px solid var(--line-2);border-radius:6px}
.diff figcaption{font-size:.7rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.diff dl{display:grid;grid-template-columns:7rem minmax(0,1fr);gap:.2rem .8rem;margin:.35rem 0 0;font-size:.9rem}
.diff dt{color:var(--ink-3)}.diff dd{margin:0;min-width:0}
.cps{display:block;font-family:var(--mono);font-size:.74rem;color:var(--ink-3)}
del{text-decoration:line-through 1.5px var(--m);background:var(--m-soft);color:var(--ink);border-radius:2px}
ins{text-decoration:underline 2px var(--brand);text-underline-offset:3px;background:var(--brand-soft);color:var(--ink);
border-radius:2px}
.tok{display:inline-block;margin:0 1px;padding:0 3px;border:1px dashed var(--line-3);border-radius:3px;
font-size:.8em;line-height:1.35;color:var(--ink-2)}
.aid{font-size:.8rem;color:var(--ink-3)}
@media (max-width:36rem){body{padding:1.2rem .9rem 2rem}.verdict{padding:1rem}.seal{font-size:1.7rem}
.values,.diff dl{grid-template-columns:minmax(0,1fr)}.values dd,.diff dd{margin-bottom:.3rem}.facts th{width:45%}}
@page{margin:16mm 14mm}
@media print{:root{color-scheme:light;--canvas:#fff;--surface:#fff;--sunken:#f6f3ec}
body{max-width:none;padding:0;font-size:10.5pt}html,body{background:#fff}
.verdict,.premises,.record,.diff{-webkit-print-color-adjust:exact;print-color-adjust:exact}
h2{break-after:avoid}.record,.premise,.facts tr{break-inside:avoid}}
"""

_GLYPH = {"Verified": "●", "Mismatch": "◆", "Unverified": "○", "Pending": "◔"}

_PREMISE_LABEL = {
    "source_complete": "The source is the whole batch",
    "destination_complete": "The destination covers the whole object",
    "source_count": "Source total in the original system",
    "destination_count": "Destination total in the original system",
}


def _h(value):
    if value is None:
        return "<i>none</i>"
    if isinstance(value, bool):
        return "yes" if value else "no"
    return html.escape(str(value))


def _state_class(state):
    return f"s-{state}" if state in STATES else ""


def _drawn(text, highlighted, start, end):
    out = ""
    for shown, ch in chardiff.pieces(text, highlighted, start, end):
        if ch is None:
            out += html.escape(shown)
        else:
            out += f'<span class="tok" title="{chardiff.code_point(ch)}">{html.escape(shown)}</span>'
    return out


def _value(value):
    """A value as the report records it: its leading and trailing invisible characters drawn as tokens."""
    if value is None:
        return '<span class="none">none</span>'
    if value == "":
        return "<code class=\"v none\">''</code>"
    return f'<code class="v">{_drawn(value, False, True, True)}</code>'


def _runs(runs):
    out = ""
    for i, (kind, text) in enumerate(runs):
        inner = _drawn(text, kind != "same", i == 0, i == len(runs) - 1)
        out += f"<del>{inner}</del>" if kind == "deleted" else f"<ins>{inner}</ins>" if kind == "inserted" else inner
    return out


def _diff(source, destination, caption):
    source_runs, destination_runs, too_long = chardiff.align(source, destination)
    out = f'<figure class="diff">\n<figcaption>{caption}</figcaption>\n<dl>\n'
    for label, runs in (("Source", source_runs), ("Destination", destination_runs)):
        points = chardiff.code_points(runs)
        listed = f'<span class="cps">{html.escape(" · ".join(points))}</span>' if points else ""
        out += f'<dt>{label}</dt><dd><code class="v">{_runs(runs)}</code>{listed}</dd>\n'
    out += "</dl>\n"
    if too_long:
        out += ("<p class=\"aid\">The values are too long to align character by character, so the differing parts "
                "are shown as replaced whole.</p>\n")
    return out + ("<p class=\"aid\">This highlights where the two values differ. The rule’s result above is the "
                  "conclusion.</p>\n</figure>\n")


def _rule(name, rule):
    out = (f'<li class="rule">\n<p class="rule-head"><code>{_h(name)}</code> '
           f'<span class="st st-{_h(rule["status"])}">{_h(rule["status"])}</span>')
    if "rule" in rule:
        out += f' <code class="reason">{_h(rule["rule"])}</code>'
    out += f'</p>\n<p class="reason">{_h(rule["reason"])}</p>\n'
    if "expected" in rule:
        out += (f'<dl class="values">\n<dt>Source value</dt><dd>{_value(rule["expected"])}</dd>\n'
                f'<dt>Destination value</dt><dd>{_value(rule.get("actual"))}</dd>\n')
        if "expected_normalized" in rule:
            out += (f'<dt>Compared as</dt><dd>{_value(rule["expected_normalized"])} and '
                    f'{_value(rule["actual_normalized"])}</dd>\n')
        out += "</dl>\n"
    normalised = "expected_normalized" in rule
    compared = (rule.get("expected_normalized"), rule.get("actual_normalized")) if normalised else (
        rule.get("expected"), rule.get("actual"))
    if rule["status"] == "fail" and isinstance(compared[0], str) and isinstance(compared[1], str):
        out += _diff(compared[0], compared[1],
                     "Where the compared values differ" if normalised else "Where the values differ")
    return out + "</li>\n"


def _carries(rows):
    return "1 destination row has this key" if rows == 1 else f"{rows} destination rows have this key"


def _key(key):
    return '<span class="none">no key</span>' if key is None else f"<code>{_drawn(key, False, True, True)}</code>"


def _applied(name, premise, premises):
    if name.endswith("_complete"):
        if premise.get("stated") is not True:
            return '<p class="applied none">not stated</p>'
        count = premises.get(name.replace("_complete", "_count"), {})
        if count.get("matched") is False:
            return '<p class="applied no">not applied: the stated total differs from the rows read</p>'
        return '<p class="applied yes">applied</p>'
    if name.endswith("_count"):
        if premise.get("stated") is None:
            return '<p class="applied none">not stated</p>'
        if premise.get("matched") is False:
            return '<p class="applied no">differs from the rows read</p>'
        return '<p class="applied yes">matches the rows read</p>'
    return ""


def _write_sheet(sheet, f):
    f.write("<section>\n<h2>Source read from Google Sheets</h2>\n"
            "<p>FlowAssert read the source rows itself, read-only, so no export step could cut them short or edit "
            "them. This does not show that the range holds every record that should exist: that is the stated "
            "premise source_complete.</p>\n")
    f.write("".join(f"<p>{_h(line)}</p>\n" for line in sheet_lines(sheet)))
    f.write('<table class="facts">\n')
    for name, value in sheet.items():
        if name == "revision":
            continue
        f.write(f"<tr><th>{_h(name)}</th><td>{_h(value)}</td></tr>\n")
    revision = sheet["revision"]
    if revision["available"]:
        for moment in ("before", "after"):
            for name in ("version", "modified_time"):
                f.write(f"<tr><th>revision {moment} {_h(name)}</th><td>{_h(revision[moment][name])}</td></tr>\n")
    else:
        f.write(f"<tr><th>revision</th><td>{_h(revision['reason'])}</td></tr>\n")
    f.write("</table>\n</section>\n")


def _write_hubspot(crm, f):
    f.write("<section>\n<h2>Destination read from HubSpot</h2>\n"
            "<p>FlowAssert listed the records itself, read-only, page by page, so no export step could filter, cut "
            "them short or edit them. The read shows which records the API listed to this token at that time. It does "
            "not show that the object is complete:</p>\n<ul>\n<li>records the token cannot see are not listed;</li>\n"
            "<li>records changed during the read may be missed;</li>\n<li>archived records are not read.</li>\n</ul>\n"
            "<p>That the records cover the whole object is the stated premise destination_complete.</p>\n")
    f.write("".join(f"<p>{_h(line)}</p>\n" for line in hubspot.summary_lines(crm)))
    f.write('<table class="facts">\n')
    for name, value in crm.items():
        shown = ", ".join(value) if isinstance(value, list) else value
        f.write(f"<tr><th>{_h(name)}</th><td>{_h(shown)}</td></tr>\n")
    f.write("</table>\n</section>\n")


_WORKBOOK_FACTS = ("worksheet", "worksheet_state", "sheets", "date_system", "columns", "rows", "hidden_rows",
                   "hidden_columns", "merged_ranges", "values", "file_sha256", "file_bytes", "inflated_bytes",
                   "canonical_form")


def _write_workbook(label, book, f):
    f.write(f"<section>\n<h2>{label} read from an .xlsx workbook</h2>\n"
            "<p>FlowAssert read one worksheet itself, each cell as it is stored in the file. A spreadsheet can display "
            "a cell otherwise: a number through its format, a date as text, a percentage multiplied by 100, a "
            "formula's value as calculated again. Dates and times are read in ISO 8601, and a formula's value as the "
            "file was last saved.</p>\n")
    f.write("".join(f"<p>{_h(line.strip())}</p>\n" for line in workbook_lines(label, book)))
    f.write('<table class="facts">\n')
    for name in _WORKBOOK_FACTS:
        f.write(f"<tr><th>{_h(name)}</th><td>{_h(book[name])}</td></tr>\n")
    for name, value in book["cells"].items():
        f.write(f"<tr><th>cells {_h(name)}</th><td>{_h(value)}</td></tr>\n")
    f.write("</table>\n</section>\n")


def write_html(report, f):
    """Write one self-contained HTML page: no scripts, and no external styles, fonts or images."""
    state = report["cohort_state"]
    c = report["counts"]
    total = report["expected_total"]
    f.write('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<meta name="color-scheme" content="light dark">\n'
            f"<title>FlowAssert report: {_h(state)}</title>\n<style>{_HTML_STYLE}</style>\n</head>\n<body>\n<main>\n"
            '<header class="verdict">\n<p class="kicker">FlowAssert report</p>\n'
            f'<h1 class="seal {_state_class(state)}"><span aria-hidden="true">{_GLYPH.get(state, "")}</span> '
            f"{_h(state)}</h1>\n")
    claim = report.get("claim")
    f.write(f'<p class="claim">{_h(claim)}</p>\n' if claim
            else '<p class="claim">No claim is made: the result is not Verified.</p>\n')
    f.write(f'<p class="rows">{_h(report["source_rows_observed"])} rows of '
            f'{"unknown total" if total is None else _h(total)}</p>\n<dl class="counts">\n')
    for name in ("Verified", "Mismatch", "Unverified"):
        f.write(f'<div class="{_state_class(name)}"><dt>{name}</dt><dd>{_h(c[name])}</dd></div>\n')
    f.write("</dl>\n"
            f'<p class="meta">Evaluated at {_h(report.get("evaluated_at"))} by evaluator '
            f'{_h(report.get("evaluator"))}.</p>\n</header>\n')

    premises = report.get("premises", {})
    f.write('<section class="premises">\n<h2>Stated premises</h2>\n'
            '<p class="note">FlowAssert does not verify these statements. A wrong statement gives a wrong result.</p>\n')
    for name, premise in premises.items():
        f.write(f'<div class="premise">\n<p class="name">{_h(_PREMISE_LABEL.get(name, name))} <code>{_h(name)}</code>'
                f'</p>\n<p>Stated: {_h(premise.get("stated"))} · origin: {_h(premise.get("origin"))}')
        if "observed" in premise:
            f.write(f' · rows read: {_h(premise["observed"])}')
        f.write(f"</p>\n{_applied(name, premise, premises)}\n</div>\n")
    f.write("</section>\n")

    f.write('<section>\n<h2>Counts</h2>\n<table class="facts">\n')
    rows = [("Source rows observed", report["source_rows_observed"]),
            ("Expected total", "unknown" if total is None else total)]
    rows += [(f"{name} records", c[name]) for name in STATES]
    rows += [("Source population known", report["source_population_known"]),
             ("Destination coverage sufficient", report["destination_coverage_sufficient"]),
             ("Destination rows without key", report["destination_rows_without_key"])]
    if "destination_only_counts" in report:
        rows += [(f"Destination-only {name}", report["destination_only_counts"][name]) for name in STATES]
    for label, value in rows:
        f.write(f"<tr><th>{_h(label)}</th><td>{_h(value)}</td></tr>\n")
    f.write("</table>\n</section>\n")

    problems = len(report["records"]) - c["Verified"]
    f.write(f"<section>\n<h2>Records that are not Verified ({problems})</h2>\n")
    if not problems:
        f.write('<p class="note">Every source record is Verified.</p>\n')
    for record in report["records"].problems():
        f.write(f'<article class="record {_state_class(record["state"])}">\n'
                f'<h3>Record {record["source_row"] + 1} <span aria-hidden="true">·</span> {_key(record["key"])} '
                f'<span class="badge {_state_class(record["state"])}">{_h(record["state"])}</span></h3>\n')
        if "candidates" in record:
            f.write(f'<p class="carries">{_carries(record["candidates"])}</p>\n')
        f.write('<ul class="rules">\n' + "".join(_rule(n, r) for n, r in record["rules"].items()) + "</ul>\n</article>\n")
    f.write("</section>\n")

    if "destination_only" in report:
        only = report["destination_only"]
        f.write(f"<section>\n<h2>Destination-only records ({len(only)})</h2>\n")
        for record in only:
            f.write(f'<article class="record {_state_class(record["state"])}">\n'
                    f'<h3>Destination row {record["destination_row"] + 1} <span aria-hidden="true">·</span> '
                    f'{_key(record["key"])} <span class="badge {_state_class(record["state"])}">{_h(record["state"])}'
                    f'</span></h3>\n<p class="carries">{_carries(record["rows"])}</p>\n'
                    f'<p class="reason">{_h(record["reason"])}</p>\n</article>\n')
        f.write("</section>\n")

    sheet = report.get("inputs", {}).get("source_sheet")
    if sheet is not None:
        _write_sheet(sheet, f)
    crm = report.get("inputs", {}).get("destination_hubspot")
    if crm is not None:
        _write_hubspot(crm, f)
    for side, label in (("source_workbook", "Source"), ("destination_workbook", "Destination")):
        book = report.get("inputs", {}).get(side)
        if book is not None:
            _write_workbook(label, book, f)

    f.write(f'<section>\n<h2>Limitations</h2>\n<p>{_h(report.get("limitations"))}</p>\n<table class="facts">\n')
    for name in ("workflow_execution", "business_truth", "existed_by_deadline", "acquisition_authenticity"):
        f.write(f"<tr><th>{_h(name)}</th><td>{_h(report.get(name))}</td></tr>\n")
    f.write("</table>\n</section>\n")

    f.write('<section>\n<h2>Inputs</h2>\n<table class="facts">\n')
    for name, value in report.get("inputs", {}).items():
        if name in ("source_sheet", "destination_hubspot", "source_workbook", "destination_workbook"):
            continue
        f.write(f"<tr><th>{_h(name)}</th><td>{_h(value)}</td></tr>\n")
    for name, value in report.get("obligation", {}).items():
        f.write(f"<tr><th>obligation {_h(name)}</th><td><code>{_h(json.dumps(value))}</code></td></tr>\n")
    f.write("</table>\n</section>\n</main>\n</body>\n</html>\n")


def _write_reports(report, targets):
    """Write each (path, writer) to a new file. If any cannot be written, remove the ones created."""
    opened = []
    try:
        for path, writer in targets:
            try:
                # newline="": the same bytes on every platform, never CR LF on Windows.
                opened.append((path, open(path, "x", encoding="utf-8", newline=""), writer))
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


def _write_exports(export):
    """Write the records to resend into their new directory, all or none. Returns what was written."""
    directory = export["directory"]
    try:
        os.mkdir(directory)
    except FileExistsError:
        raise Refused(f"{directory}: exists; --export-dir writes to a new directory")
    except OSError as e:
        raise Refused(f"{directory}: {e.strerror}")
    written = (directory, [])
    try:
        for name, _, text in export["files"]:
            path = os.path.join(directory, name)
            with open(path, "x", encoding="utf-8", newline="") as f:
                written[1].append(path)
                f.write(text)
    except OSError as e:
        _remove_exports(written)
        raise Refused(f"{directory}: {e.strerror}")
    except BaseException:
        _remove_exports(written)
        raise
    return written


def _remove_exports(written):
    if written is None:
        return
    directory, paths = written
    for path in paths:
        try:
            os.remove(path)
        except OSError:
            pass
    try:
        os.rmdir(directory)
    except OSError:
        pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--source")
    parser.add_argument("--destination")
    parser.add_argument("--source-sheet", metavar="ID",
                        help="read the source from this Google Sheets spreadsheet, read-only, in place of --source")
    parser.add_argument("--source-range", metavar="RANGE",
                        help="with --source-sheet: a tab and bounded columns, such as Leads!A1:F or Leads!A1:F500")
    parser.add_argument("--source-timeout", metavar="SECONDS",
                        help=f"with --source-sheet: the longest each request may take (default: {sheets.TIMEOUT})")
    parser.add_argument("--skip-source-revision", action="store_true",
                        help="with --source-sheet: do not read the Drive revision; the report says so")
    parser.add_argument("--destination-hubspot", metavar="OBJECT",
                        help="read the destination from HubSpot, read-only, in place of --destination: contacts")
    parser.add_argument("--destination-timeout", metavar="SECONDS",
                        help=f"with --destination-hubspot: the longest each request may take (default: {hubspot.TIMEOUT})")
    parser.add_argument("--key", help="source column, or source:destination")
    parser.add_argument("--field", action="append", default=[], help="source column, or source:destination; repeatable")
    parser.add_argument("--mapping", metavar="FILE", help="UTF-8 JSON file with key and fields column pairs")
    parser.add_argument("--config", metavar="FILE", help="UTF-8 JSON file with key, fields with rules, and scope")
    parser.add_argument("--scope", metavar="SCOPE", help="source (default) or exact: also check destination-only keys")
    parser.add_argument("--source-complete", action="store_true", help="state that the source is the whole cohort")
    parser.add_argument("--destination-complete", action="store_true", help="state that the export covers the whole object")
    parser.add_argument("--source-count", metavar="N", help="state the source total seen in the original system")
    parser.add_argument("--destination-count", metavar="N",
                        help="state the destination total seen in the original system")
    parser.add_argument("--allow-identical-content", action="store_true",
                        help="continue when two distinct files have identical content")
    parser.add_argument("--source-format", metavar="FORMAT",
                        help="csv (default) or xlsx: read --source as one worksheet of an .xlsx workbook")
    parser.add_argument("--destination-format", metavar="FORMAT",
                        help="csv (default) or xlsx: read --destination as one worksheet of an .xlsx workbook")
    parser.add_argument("--source-worksheet", metavar="NAME",
                        help="with --source-format xlsx: the worksheet to read; needed when the workbook has several")
    parser.add_argument("--destination-worksheet", metavar="NAME",
                        help="with --destination-format xlsx: the worksheet to read")
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
    parser.add_argument("--html", metavar="PATH", help="write a self-contained HTML report to this new file")
    parser.add_argument("--redact-values", action="store_true", help="omit compared values from the report")
    parser.add_argument("--export-dir", metavar="DIR",
                        help="also write the records to resend, as CSV files, into this new directory: advice from the "
                             "check, which changes no report and no exit status")
    args = parser.parse_args(argv)
    # As argparse words it for a required option: --source-sheet stands in for --source.
    missing = [option for option, absent in (("--source", args.source is None and args.source_sheet is None),
                                             ("--destination", args.destination is None
                                              and args.destination_hubspot is None)) if absent]
    if missing:
        parser.error(f"the following arguments are required: {', '.join(missing)}")
    try:
        max_details = _int_arg("--max-details", args.max_details, 0)
        report, export = check(args)
        # The records to resend first: if they cannot all be written, nothing is, and no report is either.
        written = _write_exports(export) if export else None
        try:
            _write_reports(report, [(path, writer) for path, writer in ((args.json, write_json),
                                                                        (args.html, write_html)) if path])
        except BaseException:
            _remove_exports(written)
            raise
        # The reports are written by now: a value the terminal cannot encode is escaped, not a failure.
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(errors="backslashreplace")
        lines = list(summary(report, max_details=max_details))
        if export:
            lines += exports.summary_lines(report, export["files"], export["directory"], export["formulas"])
        print("\n".join(lines))
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
