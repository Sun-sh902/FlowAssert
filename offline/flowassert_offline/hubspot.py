"""Read the destination rows from HubSpot's CRM contacts, read-only, page by page.

docs/connectors/hubspot.md is the design. HTTPS GET requests to one documented list endpoint, one after another,
following `paging.next.after` to the last page. Nothing is retried, no redirect is followed, no proxy is used, and TLS
certificates are always verified. The credential comes from one environment variable and goes only into the
Authorization header: never into a message, a report or an exception that leaves this module.

Reading every page shows which records the API listed to this token at that time. It does not show that the object is
complete: records the token cannot see, records changed during the read and archived records are not listed. The
statement that the rows cover the whole object stays the person's: --destination-complete.

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
from .sheets import _NotJson, _no_constant, _no_duplicates, canonical_row

HOST = "api.hubapi.com"
PATH = "/crm/v3/objects/contacts"
OBJECTS = ("contacts",)
SERVICE = "HubSpot CRM API v3"
TIMEOUT = 60
PAGE_LIMIT = 100
CANONICAL_FORM = "flowassert-hubspot-csv-1"
WHAT = "HubSpot contacts"
TOKEN_VARIABLE = "FLOWASSERT_HUBSPOT_TOKEN"
ENDPOINT_VARIABLE = "FLOWASSERT_HUBSPOT_TEST_ENDPOINT"

_CREDENTIAL = re.compile(r"[\x21-\x7e]{1,4096}")
_ENDPOINT = re.compile(r"http://(127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})")
_PROPERTY = re.compile(r"[A-Za-z0-9_]{1,100}")
_CURSOR = re.compile(r"[A-Za-z0-9_-]{1,512}")
_STATUS = re.compile(r"[A-Z_]{1,64}")


def _utc(moment):
    return moment.isoformat().replace("+00:00", "Z")


def credential(environ):
    """The private app access token, from the environment only."""
    token = environ.get(TOKEN_VARIABLE)
    if token is None:
        raise Refused(f"no credential: set {TOKEN_VARIABLE} to a private app access token with the scope "
                      "crm.objects.contacts.read only")
    if not _CREDENTIAL.fullmatch(token):
        raise Refused(f"{TOKEN_VARIABLE} does not hold a credential: printable ASCII without spaces, at most 4096 "
                      "characters")
    return token


def test_endpoint(environ):
    """(host, port) of a loopback fake of the endpoint, for tests only, or None for HubSpot itself."""
    value = environ.get(ENDPOINT_VARIABLE)
    if value is None:
        return None
    match = _ENDPOINT.fullmatch(value)
    if not match or int(match.group(2)) > 65535:
        raise Refused(f"{ENDPOINT_VARIABLE} must be http://127.0.0.1:PORT or http://[::1]:PORT; it is for tests only")
    return match.group(1).strip("[]"), int(match.group(2))


def check_property(name):
    if not isinstance(name, str) or not _PROPERTY.fullmatch(name):
        raise Refused(f"HubSpot property name {name!r} must be letters, digits and _, at most 100 characters")


def _not_json(detail):
    return Refused(f"{WHAT}: the response is not the JSON the API documents ({detail})")


def _error_status(body):
    """The category of a HubSpot error, or the errorType of a rate-limit response, as " NAME", or ""."""
    try:
        data = json.loads(body.decode("utf-8"))
        status = data.get("category", data.get("errorType"))
    except (ValueError, AttributeError, RecursionError):
        return ""
    return f" {status}" if isinstance(status, str) and _STATUS.fullmatch(status) else ""


def _status_refusal(code, body):
    s = _error_status(body)
    if code == 400:
        return Refused(f"{WHAT}: the request was not accepted (HTTP 400{s})")
    if code == 401:
        return Refused(f"{WHAT}: the credential was not accepted (HTTP 401{s}); it may have expired or been rotated")
    if code == 403:
        return Refused(f"{WHAT}: access was denied (HTTP 403{s}); the token may lack the scope "
                       "crm.objects.contacts.read")
    if code == 404:
        return Refused(f"{WHAT}: not found (HTTP 404{s})")
    if code == 429:
        return Refused(f"{WHAT}: rate limited (HTTP 429{s}); FlowAssert does not retry: wait, then run the check again")
    if 500 <= code <= 599:
        return Refused(f"{WHAT}: server error (HTTP {code}{s}); FlowAssert does not retry: run the check again later")
    return Refused(f"{WHAT}: unexpected response (HTTP {code}{s})")


class HubSpotDestination:
    """The destination rows of one HubSpot object, read once. Iterating requests the pages one after another and
    yields each record as a dict of the selected properties, as CsvFile yields rows; after a complete iteration
    `sha256`, `rows`, `pages` and `member` describe the read. Every option and the credential are checked when it
    is made, before any request."""

    def __init__(self, object_name, *, max_bytes, timeout=TIMEOUT, environ=None):
        environ = os.environ if environ is None else environ
        if object_name not in OBJECTS:
            raise Refused("--destination-hubspot must be contacts")
        self.object = object_name
        self._token = credential(environ)
        self._endpoint = test_endpoint(environ)
        self.max_bytes = max_bytes
        self.timeout = timeout
        self.columns = []
        self.max_rows = None
        self.sha256 = None
        self.rows = None
        self.pages = None
        self.member = None

    def select(self, columns, max_rows):
        for name in columns:
            check_property(name)
        self.columns = list(dict.fromkeys(columns))
        self.max_rows = max_rows

    # ---------- Requests ----------

    def _get(self, after):
        query = [("limit", str(PAGE_LIMIT)), ("archived", "false"), ("properties", ",".join(self.columns))]
        if after is not None:
            query.append(("after", after))
        target = PATH + "?" + urlencode(query, quote_via=quote, safe=",")
        headers = {"Accept": "application/json", "Accept-Encoding": "identity",
                   "User-Agent": f"flowassert-verify/{__version__}", "Authorization": "Bearer " + self._token}
        deadline = time.monotonic() + self.timeout
        if self._endpoint is None:
            connection = http.client.HTTPSConnection(HOST, 443, timeout=self.timeout,
                                                     context=ssl.create_default_context())
        else:
            connection = http.client.HTTPConnection(*self._endpoint, timeout=self.timeout)
        # Every failure becomes a fixed message: an exception from below could carry the request or its headers.
        try:
            connection.request("GET", target, headers=headers)
            self._remaining(connection, deadline)
            response = connection.getresponse()
            if 300 <= response.status <= 399:
                raise Refused(f"{WHAT}: redirected (HTTP {response.status}), and FlowAssert does not follow redirects")
            encoding = response.getheader("Content-Encoding", "identity").strip().lower()
            body = self._body(connection, response, deadline)
        except Refused:
            raise
        except ssl.SSLCertVerificationError:
            raise Refused(f"{WHAT}: the server's TLS certificate could not be verified") from None
        except socket.timeout:
            raise Refused(f"{WHAT}: no complete response within {self.timeout} seconds; FlowAssert does not retry") \
                from None
        except (OSError, http.client.HTTPException):
            raise Refused(f"{WHAT}: the connection failed") from None
        finally:
            connection.close()
        if response.status != 200:
            raise _status_refusal(response.status, body)
        if encoding != "identity":
            raise _not_json("a compressed body")
        try:
            data = json.loads(body.decode("utf-8"), object_pairs_hook=_no_duplicates, parse_constant=_no_constant)
        except UnicodeDecodeError:
            raise _not_json("not UTF-8") from None
        except _NotJson as e:
            raise _not_json(str(e)) from None
        except (ValueError, RecursionError):
            raise _not_json("not JSON") from None
        if not isinstance(data, dict):
            raise _not_json("not an object")
        return data

    def _remaining(self, connection, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise socket.timeout()
        if connection.sock is not None:
            connection.sock.settimeout(remaining)

    def _body(self, connection, response, deadline):
        chunks = []
        size = 0
        while True:
            self._remaining(connection, deadline)
            chunk = response.read1(65536) if hasattr(response, "read1") else response.read(65536)
            if not chunk:
                return b"".join(chunks)
            size += len(chunk)
            if size > self.max_bytes:
                raise Refused(f"{WHAT}: response exceeds --max-bytes limit of {self.max_bytes}")
            chunks.append(chunk)

    # ---------- Pages to rows ----------

    def _records(self, data, page):
        """The records of one page, checked, and the cursor of the next page or None."""
        results = data.get("results")
        if not isinstance(results, list):
            raise _not_json("results is not a list")
        if len(results) > PAGE_LIMIT:
            raise Refused(f"{WHAT}: page {page} has more than {PAGE_LIMIT} records")
        paging = data.get("paging")
        after = None
        if paging is not None:
            if not isinstance(paging, dict):
                raise _not_json("paging is not an object")
            following = paging.get("next")
            if following is not None:
                if not isinstance(following, dict) or not isinstance(following.get("after"), str):
                    raise _not_json("paging.next.after is not a string")
                after = following["after"]
                if not _CURSOR.fullmatch(after):
                    raise Refused(f"{WHAT}: page {page} gives a paging cursor that FlowAssert cannot send back "
                                  "unchanged")
        records = []
        for record in results:
            if not isinstance(record, dict) or not isinstance(record.get("id"), str) or not record["id"]:
                raise _not_json("a record has no id")
            properties = record.get("properties")
            if not isinstance(properties, dict):
                raise _not_json("a record has no properties")
            archived = record.get("archived", False)
            if not isinstance(archived, bool):
                raise _not_json("archived is not true or false")
            if archived:
                raise Refused(f"{WHAT}: page {page} lists an archived record, and the read asked for none")
            values = []
            for name in self.columns:
                if name not in properties:
                    raise Refused(f"{WHAT}: page {page} has a record without the property {name!r}; HubSpot leaves "
                                  "out a property the object does not have")
                value = properties[name]
                if value is None:
                    value = ""
                elif not isinstance(value, str):
                    raise Refused(f"{WHAT}: page {page} has a property value that is not text")
                try:
                    value.encode("utf-8")
                except UnicodeEncodeError:
                    raise _not_json("a value is not valid Unicode") from None
                values.append(value)
            records.append((record["id"], values))
        if after is not None and not records:
            raise Refused(f"{WHAT}: page {page} has a next page and no records")
        return records, after

    def __iter__(self):
        digest = hashlib.sha256(canonical_row(self.columns).encode("utf-8"))
        seen = {}
        cursors = set()
        count = 0
        page = 0
        after = None
        read_at = datetime.now(timezone.utc)
        while True:
            page += 1
            records, following = self._records(self._get(after), page)
            for record_id, values in records:
                first = seen.get(record_id)
                if first is not None:
                    raise Refused(f"{WHAT}: record ID appears twice (pages {first} and {page}): the list changed "
                                  "while it was read; run the check again")
                seen[record_id] = page
                if count == self.max_rows:
                    raise Refused(f"{WHAT}: exceeds --max-rows limit of {self.max_rows}")
                count += 1
                digest.update(canonical_row(values).encode("utf-8"))
                yield dict(zip(self.columns, values))
            if following is None:
                break
            if following in cursors:
                raise Refused(f"{WHAT}: page {page} repeats an earlier paging cursor")
            cursors.add(following)
            after = following
        finished_at = datetime.now(timezone.utc)
        self.rows = count
        self.pages = page
        self.sha256 = digest.hexdigest()
        self.member = {"read_by": "FlowAssert", "service": SERVICE, "object": self.object,
                       "properties": list(self.columns), "archived_excluded": True, "page_limit": PAGE_LIMIT,
                       "pages": page, "rows": count, "read_at": _utc(read_at), "read_finished_at": _utc(finished_at),
                       "canonical_form": CANONICAL_FORM}


def summary_lines(member):
    """What the summary says of a destination read from HubSpot: what was read, and what the read does not show."""
    yield (f"Destination read by FlowAssert from HubSpot: {member['object']}, {member['rows']} records in "
           f"{member['pages']} pages, from {member['read_at']} to {member['read_finished_at']}; archived records were "
           "not read.")
    yield "This lists what the token could see at that time; it does not show that the object is complete."
