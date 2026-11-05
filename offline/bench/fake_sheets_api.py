"""A local fake of the two Google endpoints the sheet source reads, for tests and golden cases only.

    with FakeSheetsApi({"drive": [drive(7), drive(7)], "values": [values("Leads!A1:C3", rows)]}) as api:
        environ["FLOWASSERT_SHEETS_TEST_ENDPOINT"] = api.endpoint

It listens on a loopback port and serves, in order, the responses given for each kind of request: "drive" for
GET /drive/v3/files/ID and "values" for GET /v4/spreadsheets/ID/values/RANGE, in the shapes Google's API
descriptions give (docs/connectors/google-sheets.md). Every request is recorded, whatever its method or path, so a
test can prove what the checker sent. A request that carries a credential other than the expected one gets a 401 in
Google's error format; one for which no response is left gets a 599 the checker would refuse. Nothing here contacts
Google, and every value is synthetic.

A response is {"status": N, "json": VALUE} or {"status": N, "text": STR}, with optional "headers" (a mapping),
"delay" (seconds to wait before answering) and "drip" (seconds to wait between the bytes of the body).
"""
import http.server
import json
import threading
import time
from urllib.parse import parse_qsl, unquote, urlsplit

# The credential the golden cases and tests use: recognisable, and never a real one.
FAKE_TOKEN = "fake-oauth-token-FA7-not-a-real-credential"
FAKE_KEY = "fake-api-key-FA7-not-a-real-credential"


def values(range_text, rows, major="ROWS"):
    """A values response: the range as returned, and the rows, omitted when there are none, as the API omits them."""
    body = {"range": range_text, "majorDimension": major}
    if rows:
        body["values"] = rows
    return {"status": 200, "json": body}


def drive(version, modified="2026-11-01T09:00:00.000Z"):
    """A files.get response with fields=version,modifiedTime; version None leaves the member out."""
    body = {}
    if version is not None:
        body["version"] = str(version)
    if modified is not None:
        body["modifiedTime"] = modified
    return {"status": 200, "json": body}


def error(code, status, message="Synthetic error from the local fake."):
    """An error response in Google's JSON error format."""
    return {"status": code, "json": {"error": {"code": code, "message": message, "status": status}}}


def sheet_rows(rows):
    """Rows as the values API returns them: trailing empty cells left out of each row, and trailing empty rows
    left out of the range. Returns None when that would lose a row a CSV reader keeps (a row with no value at the end
    of the file), so the same rows cannot be held by a sheet."""
    trimmed = []
    for row in rows:
        row = list(row)
        while row and row[-1] == "":
            row.pop()
        trimmed.append(row)
    if trimmed and len(trimmed) > 1 and not trimmed[-1]:
        return None
    return trimmed


class _Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _serve(self):
        api = self.server.api
        parts = urlsplit(self.path)
        request = {"method": self.command, "path": parts.path, "query": parse_qsl(parts.query, keep_blank_values=True),
                   "host": self.headers.get("Host"), "headers": dict(self.headers.items())}
        api.requests.append(request)
        kind = None
        if self.command == "GET" and parts.path.startswith("/drive/v3/files/"):
            kind = "drive"
        elif self.command == "GET" and parts.path.startswith("/v4/spreadsheets/") and "/values/" in parts.path:
            kind = "values"
            request["range"] = unquote(parts.path.split("/values/", 1)[1])
        if kind is None:
            response = error(404 if self.command == "GET" else 405, "NOT_FOUND" if self.command == "GET" else
                             "METHOD_NOT_ALLOWED")
        elif not api.authorized(request):
            response = error(401, "UNAUTHENTICATED", "Request is missing a valid credential.")
        elif not api.responses.get(kind):
            response = error(599, "NO_RESPONSE_LEFT", "The fake has no response left for this request.")
        else:
            response = api.responses[kind].pop(0)
        time.sleep(response.get("delay", 0))
        body = (json.dumps(response["json"]) if "json" in response else response.get("text", "")).encode("utf-8")
        self.send_response(response["status"])
        headers = {"Content-Type": "application/json; charset=UTF-8", "Content-Length": str(len(body)),
                   **response.get("headers", {})}
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header("Connection", "close")
        self.end_headers()
        drip = response.get("drip")
        if drip:
            for i in range(len(body)):
                self.wfile.write(body[i:i + 1])
                self.wfile.flush()
                time.sleep(drip)
        else:
            self.wfile.write(body)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _serve


class _Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def handle_error(self, request, client_address):
        # A client that closes its connection first is normal here. Never print: the checker's own stderr is being
        # captured in this process, and a stray traceback would land in it.
        self.api.errors.append(client_address)


class _Server6(_Server):
    import socket as _socket
    address_family = _socket.AF_INET6


class FakeSheetsApi:
    """The fake, serving `responses` ({"drive": [...], "values": [...]}) on 127.0.0.1, or on ::1 with ipv6=True.
    `credential` is ("token", VALUE) or ("key", VALUE): requests without it get a 401."""

    def __init__(self, responses, credential=("token", FAKE_TOKEN), ipv6=False):
        self.responses = {kind: list(items) for kind, items in responses.items()}
        self.credential = credential
        self.requests = []
        self.errors = []
        self._server = (_Server6 if ipv6 else _Server)(("::1" if ipv6 else "127.0.0.1", 0), _Handler)
        self._server.api = self
        port = self._server.server_address[1]
        self.endpoint = f"http://[::1]:{port}" if ipv6 else f"http://127.0.0.1:{port}"
        self._thread = threading.Thread(target=self._server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)

    def authorized(self, request):
        kind, value = self.credential
        if kind == "token":
            return request["headers"].get("Authorization") == f"Bearer {value}"
        return ("key", value) in request["query"]

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._server.shutdown()
        self._server.server_close()
