"""Read the source rows from one bounded range of a Google Sheets spreadsheet, read-only.

docs/connectors/google-sheets.md is the design. Three HTTPS GET requests, one after another: Google Drive's revision
metadata, the values, and the revision metadata again. Nothing is retried, no redirect is followed, no proxy is used,
and TLS certificates are always verified. The credential comes from one environment variable and goes only into the
requests: never into a message, a report or an exception that leaves this module.

A failed or doubtful read is refused, like a malformed file. A read that succeeds gives the same rows a CSV file with
the same cells would give, and `sha256` is the digest of that CSV text, the canonical form.
"""
from datetime import datetime, timezone
import hashlib
import http.client
import json
import os
import re
import socket
import ssl
import time
from urllib.parse import quote, urlencode

from . import __version__
from .errors import Refused

SHEETS_HOST = "sheets.googleapis.com"
DRIVE_HOST = "www.googleapis.com"
TIMEOUT = 60
SERVICE = "Google Sheets API v4"
VALUE_RENDER_OPTION = "FORMATTED_VALUE"
DATE_TIME_RENDER_OPTION = "FORMATTED_STRING"
MAJOR_DIMENSION = "ROWS"
CANONICAL_FORM = "flowassert-sheet-csv-1"
NOT_REQUESTED = "not requested (--skip-source-revision)"
NO_VERSION = "Google Drive returned no version"
VALUES = "Google Sheets values"
DRIVE = "Google Drive revision metadata"

_ID = re.compile(r"[A-Za-z0-9_-]{1,200}")
_CREDENTIAL = re.compile(r"[\x21-\x7e]{1,4096}")
_TAB = r"'(?:[^']|'')+'|[\w.]+"
_CELL = r"([A-Za-z]{1,3})([1-9][0-9]{0,7})?"
_RANGE = re.compile(rf"({_TAB})!{_CELL}:{_CELL}")
_RETURNED = re.compile(rf"({_TAB})!{_CELL}(?::{_CELL})?")
_ENDPOINT = re.compile(r"http://(127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})")
_STATUS = re.compile(r"[A-Z_]{1,64}")
_VERSION = re.compile(r"[0-9]{1,20}")


def _column(letters):
    number = 0
    for letter in letters.upper():
        number = number * 26 + ord(letter) - 64
    return number


def _tab(text):
    return text[1:-1].replace("''", "'") if text.startswith("'") else text


def _utc(moment):
    return moment.isoformat().replace("+00:00", "Z")


class SheetRange:
    """A range in A1 notation with a tab and bounded columns: TAB!A1:F or TAB!A1:F500."""

    def __init__(self, text):
        match = _RANGE.fullmatch(text)
        if not match:
            raise Refused(f"--source-range {text!r} must name a tab and bounded columns, such as Leads!A1:F or "
                          "Leads!A1:F500")
        tab, first_column, first_row, last_column, last_row = match.groups()
        self.text = text
        self.tab = _tab(tab)
        self.first_column, self.last_column = _column(first_column), _column(last_column)
        self.first_row = int(first_row) if first_row else 1
        self.last_row = int(last_row) if last_row else None
        if self.first_column > self.last_column or (self.last_row is not None and self.first_row > self.last_row):
            raise Refused(f"--source-range {text!r} starts after it ends")

    def returned(self, text):
        """The last row of the range the API says it read, or False when that is not the range asked for."""
        match = _RETURNED.fullmatch(text)
        if not match:
            return False
        tab, first_column, first_row, last_column, last_row = match.groups()
        if last_column is None:
            last_column, last_row = first_column, first_row
        if (_tab(tab), _column(first_column), _column(last_column), int(first_row) if first_row else 1) != (
                self.tab, self.first_column, self.last_column, self.first_row):
            return False
        last = int(last_row) if last_row else None
        if self.last_row is not None:
            return last if last == self.last_row else False
        return last if last is None or last >= self.first_row else False


def credential(environ):
    """("token" or "key", the credential), from the environment only."""
    token = environ.get("FLOWASSERT_SHEETS_TOKEN")
    key = environ.get("FLOWASSERT_SHEETS_API_KEY")
    if token is None and key is None:
        raise Refused("no credential: set FLOWASSERT_SHEETS_TOKEN to a read-only OAuth access token, or "
                      "FLOWASSERT_SHEETS_API_KEY to an API key for a sheet shared for viewing")
    if token is not None and key is not None:
        raise Refused("set only one of FLOWASSERT_SHEETS_TOKEN and FLOWASSERT_SHEETS_API_KEY")
    if token is not None and not _CREDENTIAL.fullmatch(token):
        raise Refused("FLOWASSERT_SHEETS_TOKEN does not hold a credential: printable ASCII without spaces, "
                      "at most 4096 characters")
    if key is not None and not _CREDENTIAL.fullmatch(key):
        raise Refused("FLOWASSERT_SHEETS_API_KEY does not hold a credential: printable ASCII without spaces, "
                      "at most 4096 characters")
    return ("token", token) if token is not None else ("key", key)


def test_endpoint(environ):
    """(host, port) of a loopback fake of the two APIs, for tests only, or None for Google itself."""
    value = environ.get("FLOWASSERT_SHEETS_TEST_ENDPOINT")
    if value is None:
        return None
    match = _ENDPOINT.fullmatch(value)
    if not match or int(match.group(2)) > 65535:
        raise Refused("FLOWASSERT_SHEETS_TEST_ENDPOINT must be http://127.0.0.1:PORT or http://[::1]:PORT; "
                      "it is for tests only")
    return match.group(1).strip("[]"), int(match.group(2))


def _cell(value):
    if any(c in value for c in ',"\r\n'):
        return '"' + value.replace('"', '""') + '"'
    return value


def canonical_row(row):
    """One row of the canonical form (flowassert-sheet-csv-1), with its line feed."""
    if len(row) == 1 and row[0] == "":
        return '""\n'  # an empty line would be a blank line, which a CSV reader skips
    return ",".join(_cell(value) for value in row) + "\n"


class _NotJson(ValueError):
    pass


def _no_duplicates(pairs):
    obj = {}
    for name, value in pairs:
        if name in obj:
            raise _NotJson("a duplicate member")
        obj[name] = value
    return obj


def _no_constant(name):
    raise _NotJson(f"{name} is not JSON")


def _not_json(what, detail):
    return Refused(f"{what}: the response is not the JSON the API documents ({detail})")


def _error_status(body):
    """The status name of a Google JSON error ({"error": {"status": ...}}), as " NAME", or ""."""
    try:
        error = json.loads(body.decode("utf-8")).get("error")
        status = error.get("status")
    except (ValueError, AttributeError, RecursionError):
        return ""
    return f" {status}" if isinstance(status, str) and _STATUS.fullmatch(status) else ""


def _status_refusal(what, code, body):
    s = _error_status(body)
    if code == 400:
        return Refused(f"{what}: the request was not accepted (HTTP 400{s}); check that the tab exists and the range "
                       "lies inside it")
    if code == 401:
        return Refused(f"{what}: the credential was not accepted (HTTP 401{s}); it may have expired or been revoked")
    if code == 403:
        return Refused(f"{what}: access was denied (HTTP 403{s}); the credential may lack the read-only scope, its "
                       "project may not have the API enabled, or the sheet is not shared with it")
    if code == 404:
        return Refused(f"{what}: not found (HTTP 404{s}); check the spreadsheet ID and that the credential can see it")
    if code == 429:
        return Refused(f"{what}: rate limited (HTTP 429{s}); FlowAssert does not retry: wait, then run the check again")
    if 500 <= code <= 599:
        return Refused(f"{what}: server error (HTTP {code}{s}); FlowAssert does not retry: run the check again later")
    return Refused(f"{what}: unexpected response (HTTP {code}{s})")


class SheetSource:
    """The source rows of one range, read once. `read()` makes the requests; iterating then yields each data row as a
    dict of the selected columns, as CsvFile does, and after a complete iteration `sha256` and `rows` describe the
    whole range. Every option and the credential are checked when it is made, before any request."""

    def __init__(self, spreadsheet_id, range_text, *, max_bytes, timeout=TIMEOUT, revision=True, environ=None):
        environ = os.environ if environ is None else environ
        if not _ID.fullmatch(spreadsheet_id):
            raise Refused("--source-sheet must be a spreadsheet ID: letters, digits, - and _, at most 200 characters")
        self.spreadsheet_id = spreadsheet_id
        self.range = SheetRange(range_text)
        self._kind, self._secret = credential(environ)
        self._endpoint = test_endpoint(environ)
        self.max_bytes = max_bytes
        self.timeout = timeout
        self.revision = revision
        self.columns = []
        self.max_rows = None
        self.sha256 = None
        self.rows = None
        self.member = None
        self._header = None
        self._data = None

    def select(self, columns, max_rows):
        self.columns = list(dict.fromkeys(columns))
        self.max_rows = max_rows

    # ---------- Requests ----------

    def _get(self, what, host, path, query):
        if self._kind == "key":
            query = query + [("key", self._secret)]
        target = path + "?" + urlencode(query, quote_via=quote, safe="")
        headers = {"Accept": "application/json", "Accept-Encoding": "identity",
                   "User-Agent": f"flowassert-verify/{__version__}"}
        if self._kind == "token":
            headers["Authorization"] = "Bearer " + self._secret
        deadline = time.monotonic() + self.timeout
        if self._endpoint is None:
            connection = http.client.HTTPSConnection(host, 443, timeout=self.timeout,
                                                     context=ssl.create_default_context())
        else:
            connection = http.client.HTTPConnection(*self._endpoint, timeout=self.timeout)
        # Every failure becomes a fixed message: an exception from below could carry the request's address.
        try:
            connection.request("GET", target, headers=headers)
            self._remaining(connection, deadline)
            response = connection.getresponse()
            if 300 <= response.status <= 399:
                raise Refused(f"{what}: redirected (HTTP {response.status}), and FlowAssert does not follow redirects")
            encoding = response.getheader("Content-Encoding", "identity").strip().lower()
            body = self._body(connection, response, what, deadline)
        except Refused:
            raise
        except ssl.SSLCertVerificationError:
            raise Refused(f"{what}: the server's TLS certificate could not be verified") from None
        except socket.timeout:
            raise Refused(f"{what}: no complete response within {self.timeout} seconds; FlowAssert does not retry") \
                from None
        except (OSError, http.client.HTTPException):
            raise Refused(f"{what}: the connection failed") from None
        finally:
            connection.close()
        if response.status != 200:
            raise _status_refusal(what, response.status, body)
        if encoding != "identity":
            raise _not_json(what, "a compressed body")
        try:
            data = json.loads(body.decode("utf-8"), object_pairs_hook=_no_duplicates, parse_constant=_no_constant)
        except UnicodeDecodeError:
            raise _not_json(what, "not UTF-8") from None
        except _NotJson as e:
            raise _not_json(what, str(e)) from None
        except (ValueError, RecursionError):
            raise _not_json(what, "not JSON") from None
        if not isinstance(data, dict):
            raise _not_json(what, "not an object")
        return data

    def _remaining(self, connection, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise socket.timeout()
        if connection.sock is not None:
            connection.sock.settimeout(remaining)

    def _body(self, connection, response, what, deadline):
        chunks = []
        size = 0
        while True:
            self._remaining(connection, deadline)
            chunk = response.read1(65536) if hasattr(response, "read1") else response.read(65536)
            if not chunk:
                return b"".join(chunks)
            size += len(chunk)
            if size > self.max_bytes:
                raise Refused(f"{what}: response exceeds --max-bytes limit of {self.max_bytes}")
            chunks.append(chunk)

    def _drive(self):
        data = self._get(DRIVE, DRIVE_HOST, "/drive/v3/files/" + quote(self.spreadsheet_id, safe=""),
                         [("fields", "version,modifiedTime"), ("supportsAllDrives", "true")])
        version = data.get("version")
        if version is None:
            return None
        if not isinstance(version, str) or not _VERSION.fullmatch(version):
            raise _not_json(DRIVE, "version is not a whole number written as a string")
        modified = data.get("modifiedTime")
        if modified is not None and not isinstance(modified, str):
            raise _not_json(DRIVE, "modifiedTime is not a string")
        return {"version": version, "modified_time": modified}

    def _values(self):
        path = ("/v4/spreadsheets/" + quote(self.spreadsheet_id, safe="") + "/values/"
                + quote(self.range.text, safe=""))
        return self._get(VALUES, SHEETS_HOST, path, [("majorDimension", MAJOR_DIMENSION),
                                                     ("valueRenderOption", VALUE_RENDER_OPTION),
                                                     ("dateTimeRenderOption", DATE_TIME_RENDER_OPTION)])

    def read(self):
        """Make the requests and check the response. Refuses anything doubtful; concludes nothing."""
        before = self._drive() if self.revision else None
        read_at = datetime.now(timezone.utc)
        data = self._values()
        after = self._drive() if self.revision else None
        if not self.revision:
            revision = {"available": False, "reason": NOT_REQUESTED}
        elif before is None and after is None:
            revision = {"available": False, "reason": NO_VERSION}
        elif before is None or after is None:
            raise Refused("the sheet's revision could not be read the same way before and after the values; "
                          "run the check again")
        elif before != after:
            raise Refused(f"the sheet changed while it was read: Drive version {before['version']} modified "
                          f"{before['modified_time']} before the values, version {after['version']} modified "
                          f"{after['modified_time']} after; run the check again")
        else:
            revision = {"available": True, "before": before, "after": after}

        returned = data.get("range")
        if not isinstance(returned, str):
            raise _not_json(VALUES, "range is missing")
        if data.get("majorDimension") != MAJOR_DIMENSION:
            raise _not_json(VALUES, "majorDimension is not ROWS")
        values = data.get("values", [])
        if not isinstance(values, list) or not all(isinstance(row, list) for row in values):
            raise _not_json(VALUES, "values is not a list of rows")
        last_row = self.range.returned(returned)
        if last_row is False:
            raise Refused(f"Google Sheets returned the range {returned!r} for {self.range.text!r}, which is not the "
                          "range asked for")
        where = self.range.text
        if last_row is not None and len(values) > last_row - self.range.first_row + 1:
            raise Refused(f"{where}: the response has more rows than the range holds")
        width = self.range.last_column - self.range.first_column + 1
        for number, row in enumerate(values, start=self.range.first_row):
            if len(row) > width:
                raise Refused(f"{where}: row {number} has more cells than the range has columns")
            for value in row:
                if not isinstance(value, str):
                    raise Refused(f"{where}: row {number} has a cell that is not text; FlowAssert reads formatted "
                                  "values only")
                try:
                    value.encode("utf-8")
                except UnicodeEncodeError:
                    raise _not_json(VALUES, "a cell is not valid Unicode") from None
        self._header = values[0] if values else []
        self._data = values[1:]
        self.member = {"read_by": "FlowAssert", "service": SERVICE, "spreadsheet_id": self.spreadsheet_id,
                       "range_requested": self.range.text, "range_returned": returned,
                       "value_render_option": VALUE_RENDER_OPTION, "date_time_render_option": DATE_TIME_RENDER_OPTION,
                       "major_dimension": MAJOR_DIMENSION, "read_at": _utc(read_at), "revision": revision,
                       "canonical_form": CANONICAL_FORM}

    # ---------- Rows ----------

    def __iter__(self):
        where = self.range.text
        header = self._header
        if len(set(header)) != len(header):
            raise Refused(f"{where}: repeated column name")
        missing = [c for c in self.columns if c not in header]
        if missing:
            raise Refused(f"{where}: missing column {', '.join(missing)}")
        index = [(c, header.index(c)) for c in self.columns]
        width = len(header)
        digest = hashlib.sha256(canonical_row(header).encode("utf-8"))
        count = 0
        for number, row in enumerate(self._data, start=self.range.first_row + 1):
            if len(row) > width:
                raise Refused(f"{where}: row {number} has a value beyond the header")
            if count == self.max_rows:
                raise Refused(f"{where}: exceeds --max-rows limit of {self.max_rows}")
            count += 1
            row = row + [""] * (width - len(row))  # cells omitted at the end of a row are empty
            digest.update(canonical_row(row).encode("utf-8"))
            yield {c: row[i] for c, i in index}
        self.rows = count
        self.sha256 = digest.hexdigest()
