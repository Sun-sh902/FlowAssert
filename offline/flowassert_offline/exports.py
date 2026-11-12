"""The records to resend: CSV files of the rows a check says need action. docs/design/1.1-exports.md is the design.

An export is advice. It is computed from the records the check concluded and changes none of them: no state, no
report, no summary line of a command without --export-dir, no exit status. A row whose state is unknown is never
placed beside rows the check showed missing, and a destination not stated complete never gives a file of missing
rows. Each row is written as it was read, under its file's own header, so the file can be imported again.
"""
import re

from .evaluator_v2 import _key

MISSING = "missing-from-destination.csv"
DIFFERS = "values-differ.csv"
DUPLICATED = "duplicated-in-destination.csv"
UNKNOWN = "unknown-status-resending-may-create-duplicates.csv"
ONLY = "only-in-destination.csv"
ONLY_UNKNOWN = "only-in-destination-not-concluded.csv"
# In the order the files are listed.
FILES = (MISSING, DIFFERS, DUPLICATED, UNKNOWN, ONLY, ONLY_UNKNOWN)
MEANING = {
    MISSING: "The destination, stated complete, has no row with this key: these records did not arrive.",
    DIFFERS: "The destination has one row with this key, and at least one compared field differs.",
    DUPLICATED: "More than one destination row has this key: resending would add another; the destination needs "
                "merging.",
    UNKNOWN: "The check could not conclude: the record may already be in the destination, so resending it may create "
             "a duplicate.",
    ONLY: "Scope exact, source population known: the destination has rows whose key is not in the source.",
    ONLY_UNKNOWN: "Scope exact, source population unknown: rows whose key is not among the source rows supplied, "
                  "listed without a conclusion.",
}
BOM = "\ufeff"
# A field a spreadsheet may run as a formula when it opens the file; a plain number is not counted.
_FORMULA = re.compile("[=+\\-@\t\r]")
_NUMBER = re.compile(r"[+-]?[0-9]+(?:\.[0-9]+)?")


def file_of(record):
    """The file a source record belongs to, or None for a Verified record."""
    state = record["state"]
    if state == "Verified":
        return None
    if state != "Mismatch":
        return UNKNOWN
    rules = record["rules"]
    if rules["existence"]["status"] == "fail":
        return MISSING
    if rules["uniqueness"]["status"] == "fail":
        return DUPLICATED
    return DIFFERS


def plan(report):
    """{file: [source positions]} and {file: set of destination-only keys}, from the report's records."""
    source = {name: [] for name in (MISSING, DIFFERS, DUPLICATED, UNKNOWN)}
    for record in report["records"].problems():
        name = file_of(record)
        if name is not None:
            source[name].append(record["source_row"])
    destination = {ONLY: set(), ONLY_UNKNOWN: set()}
    for record in report.get("destination_only", []):
        destination[ONLY if record["state"] == "Mismatch" else ONLY_UNKNOWN].add(record["key"])
    return source, destination


def absence_not_established(report):
    """True when records were not found but the destination was not stated complete: no file of missing rows."""
    if report["destination_coverage_sufficient"]:
        return False
    return any(record["key"] is not None and record.get("candidates") == 0 and
               record["rules"]["existence"]["status"] == "unknown" for record in report["records"].problems())


def _field(value):
    if any(c in value for c in ',"\r\n'):
        return '"' + value.replace('"', '""') + '"'
    return value


def row_text(row):
    """One row of an exported file, with its CR LF."""
    if len(row) == 1 and row[0] == "":
        return '""\r\n'  # an empty line would be a blank line, which a reader skips
    return ",".join(_field(v) for v in row) + "\r\n"


def formula_like(value):
    return bool(value) and _FORMULA.match(value) is not None and _NUMBER.fullmatch(value) is None


def build(report, source_rows, destination_rows, destination_key):
    """The files to write, as [(name, rows, text)] in FILES order, each with at least one row, and the number of
    exported fields that begin like a formula. `source_rows` and `destination_rows` iterate the header, then every
    data row as a list of texts, read again."""
    by_position, by_key = plan(report)
    wanted = {}
    for name, positions in by_position.items():
        for position in positions:
            wanted[position] = name
    out = {name: [] for name in FILES}
    header = None
    for i, row in enumerate(source_rows):
        if i == 0:
            header = row
            continue
        name = wanted.get(i - 1)
        if name is not None:
            out[name].append(row)
    headers = dict.fromkeys(FILES, header)
    if by_key[ONLY] or by_key[ONLY_UNKNOWN]:
        index = None
        for i, row in enumerate(destination_rows):
            if i == 0:
                index = row.index(destination_key)
                headers[ONLY] = headers[ONLY_UNKNOWN] = row
                continue
            key = _key(row[index])
            for name in (ONLY, ONLY_UNKNOWN):
                if key in by_key[name]:
                    out[name].append(row)
    files = []
    formulas = 0
    for name in FILES:
        rows = out[name]
        if rows:
            formulas += sum(1 for row in rows for value in row if formula_like(value))
            files.append((name, len(rows), BOM + "".join(row_text(r) for r in [headers[name]] + rows)))
    return files, formulas


def _plural(n, one, many):
    return f"{n} {one}" if n == 1 else f"{n} {many}"


def summary_lines(report, files, directory, formulas):
    """The lines the summary adds after the limitations when --export-dir was given."""
    if not files:
        yield f"Records to resend: none; {directory} is empty."
    else:
        yield f"Records to resend, written to {directory} (advice from this check, not a further conclusion):"
        for name, rows, _ in files:
            note = "; resending them may create duplicates" if name == UNKNOWN else ""
            yield f"  {name}: {_plural(rows, 'row', 'rows')}{note}"
    if absence_not_established(report):
        yield (f"  No {MISSING}: the destination was not stated complete, so absence is not established.")
    if formulas:
        verb = "begins" if formulas == 1 else "begin"
        yield (f"  {_plural(formulas, 'exported field', 'exported fields')} {verb} with =, +, -, @, a tab or a "
               "carriage return: import the files rather than open them in a spreadsheet.")
