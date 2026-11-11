"""A local fake of HubSpot's contacts list endpoint, for tests and golden cases only.

    with FakeHubSpotApi(pages_of(records)) as api:
        environ["FLOWASSERT_HUBSPOT_TEST_ENDPOINT"] = api.endpoint

It listens on a loopback port and answers GET /crm/v3/objects/contacts with the responses given, in order, in the
shapes HubSpot's documentation gives (docs/connectors/hubspot.md). Every request is recorded, whatever its method or
path, so a test can prove what the checker sent: the method, the host, the path and the query. A request without the
expected bearer token gets a 401 in HubSpot's error format; one for which no response is left gets a 599 the checker
would refuse. Nothing here contacts HubSpot, and every value is synthetic.

A response is {"status": N, "json": VALUE} or {"status": N, "text": STR}, with optional "headers", "delay" (seconds
before answering) and "drip" (seconds between the bytes of the body).
"""
import http.server
import json
import threading
import time
from urllib.parse import parse_qsl, urlsplit

# The token the golden cases and tests use: recognisable, and never a real one.
FAKE_TOKEN = "pat-na1-fake-FA10-not-a-real-credential"
PATH = "/crm/v3/objects/contacts"


def contact(record_id, properties, archived=False):
    """One record as the API lists it."""
    return {"id": str(record_id), "properties": properties, "createdAt": "2026-11-01T09:00:00.000Z",
            "updatedAt": "2026-11-01T09:00:00.000Z", "archived": archived}


def page(records, after=None):
    """One page: the records, and the cursor of the next page when there is one."""
    body = {"results": records}
    if after is not None:
        body["paging"] = {"next": {"after": after, "link": "https://api.hubapi.example.test/next"}}
    return {"status": 200, "json": body}


def pages_of(records, size=100):
    """The pages a list of records is served in, `size` at a time; the cursor is the next record's ID, as the guide
    describes it. An empty list is one empty page."""
    out = []
    for start in range(0, max(len(records), 1), size):
        chunk = records[start:start + size]
        following = records[start + size]["id"] if start + size < len(records) else None
        out.append(page(chunk, following))
    return out


def records_of(rows, id_column=None):
    """Records holding the cells of CSV rows (a header, then data rows): every cell a property, an empty cell None."""
    header, data = rows[0], rows[1:]
    out = []
    for number, row in enumerate(data, start=1):
        properties = {name: (value if value != "" else None) for name, value in zip(header, row)}
        record_id = properties.get(id_column) if id_column else None
        out.append(contact(record_id or str(900000 + number), properties))
    return out


def error(code, category, message="Synthetic error from the local fake."):
    """An error response in HubSpot's error format."""
    return {"status": code, "json": {"status": "error", "message": message, "correlationId": "00000000-fake",
                                     "category": category}}


def rate_limited():
    """A 429 response with the members the usage guidelines describe."""
    return {"status": 429, "json": {"status": "error", "message": "Synthetic rate limit.", "errorType": "RATE_LIMIT",
                                    "correlationId": "00000000-fake", "policyName": "TEN_SECONDLY_ROLLING"}}


class _Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _serve(self):
        api = self.server.api
        parts = urlsplit(self.path)
        request = {"method": self.command, "path": parts.path, "query": parse_qsl(parts.query, keep_blank_values=True),
                   "raw_query": parts.query, "host": self.headers.get("Host"), "headers": dict(self.headers.items())}
        api.requests.append(request)
        if self.command != "GET" or parts.path != PATH:
            response = error(404 if self.command == "GET" else 405, "OBJECT_NOT_FOUND")
        elif request["headers"].get("Authorization") != f"Bearer {api.token}":
            response = error(401, "INVALID_AUTHENTICATION", "Authentication credentials not found.")
        elif not api.responses:
            response = error(599, "NO_RESPONSE_LEFT", "The fake has no response left for this request.")
        else:
            response = api.responses.pop(0)
        time.sleep(response.get("delay", 0))
        body = (json.dumps(response["json"]) if "json" in response else response.get("text", "")).encode("utf-8")
        self.send_response(response["status"])
        headers = {"Content-Type": "application/json;charset=utf-8", "Content-Length": str(len(body)),
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
        # Never print: the checker's own stderr is being captured in this process.
        self.api.errors.append(client_address)


class _Server6(_Server):
    import socket as _socket
    address_family = _socket.AF_INET6


class FakeHubSpotApi:
    """The fake, serving `responses` (a list, in order) on 127.0.0.1, or on ::1 with ipv6=True."""

    def __init__(self, responses, token=FAKE_TOKEN, ipv6=False):
        self.responses = list(responses)
        self.token = token
        self.requests = []
        self.errors = []
        self._server = (_Server6 if ipv6 else _Server)(("::1" if ipv6 else "127.0.0.1", 0), _Handler)
        self._server.api = self
        port = self._server.server_address[1]
        self.endpoint = f"http://[::1]:{port}" if ipv6 else f"http://127.0.0.1:{port}"
        self._thread = threading.Thread(target=self._server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._server.shutdown()
        self._server.server_close()
