"""TEST ONLY — real-Service backend for the exact-ID browser suite (e2e-lookup/), on this workspace's current Service.

Serves the genuine composed app (app.history_api.create_history_app) from the identity-checked runtime copy
(.phase3a-runtime, scripts/dev/prepare_harness_runtime.py) on 127.0.0.1:8765, with TEST-ONLY identity aliases registered
in that one process: run.identity.id is the ONLY change to one of the five evaluator-backed cases. Verdicts, records and
evidence are the case's own, every read goes through the unchanged Catalog.read checks, and nothing is shipped or stored.

It replaces the launcher that ran an accepted historical Service copy, which refuses phase3b=true. No service/ file is
changed. Receipts, as e2e-lookup/support.ts reads them, go to OUT_DIR:
    alias-manifest.json       the aliases of this process
    catalog-receipts.jsonl    each run_id Catalog.read received, as Python decoded it
    server-wire.jsonl         each request as it reached the ASGI app, with its status
    network-audit.json        outbound connections, written at exit

Usage (from scripts/phase3a/lookup-alias-service.sh, cwd = the runtime copy):
    .venv/bin/python -B lookup_alias_entry.py OUT_DIR STATE_DIR
"""
import atexit
import hashlib
import json
import os
import sys
from pathlib import Path

RUNTIME = Path.cwd().resolve()
sys.dont_write_bytecode = True
sys.path.insert(0, str(RUNTIME))

OUT, STATE = Path(sys.argv[1]), sys.argv[2]
LAB = "\U0001F9EA"
# label, exact identity, basis case. The identities are the ID matrix of src/test/local/idMatrix.ts.
ALIASES = [
    ("dot", ".", "SPEC-001"),
    ("dotdot", "..", "SPEC-002"),
    ("evidence-suffix", "x/evidence", "SPEC-005"),
    ("slash", "customer/001", "SPEC-001"),
    ("colon", "SPEC:006", "SPEC-003"),
    ("chinese", "中文", "SPEC-005"),
    ("emoji128", LAB * 128, "SPEC-004"),
    ("punctuation", "a?b#c", "SPEC-002"),
    ("plus", "a+b", "SPEC-001"),
    ("percent-literal", "a%2Fb", "SPEC-005"),
    ("suffix-trap-control", "x", "SPEC-002"),
    ("decoded-slash-control", "a/b", "SPEC-001"),
    ("space-control", "a b", "SPEC-003"),
    ("nfc", "é", "SPEC-001"),
    ("nfd", "é", "SPEC-002"),
    ("whitespace", " leading and trailing ", "SPEC-004"),
    ("controls", "\x00\t\n\x1f\x7f", "SPEC-005"),
    ("fe-emoji-single", LAB, "SPEC-002"),
    ("fe-bmp128", "中文" * 64, "SPEC-005"),
]

connects = []


def audit(event, args):
    if event == "socket.connect" and isinstance(args[1], tuple):
        connects.append({"host": args[1][0], "port": args[1][1]})


sys.addaudithook(audit)
atexit.register(lambda: (OUT / "network-audit.json").write_text(json.dumps({"connects": connects}, indent=1)))


def append(name, record):
    with open(OUT / name, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


import uvicorn  # noqa: E402

import app.main as service_main  # noqa: E402
from app.history_api import create_history_app  # noqa: E402
from app.identity import canonical  # noqa: E402
from app.service import Catalog  # noqa: E402
from archive_cli import configure_ephemeral_key  # noqa: E402


class AliasCatalog(Catalog):
    """The Service's Catalog with test-only identities over its own sealed bundles."""

    def __init__(self):
        super().__init__()
        for _, identity, basis in ALIASES:
            bundle = json.loads(self._runs[basis])
            bundle["run"]["identity"]["id"] = identity
            data = canonical(bundle)
            self._runs[identity] = data
            self._seals[identity] = hashlib.sha256(data).hexdigest()

    def read(self, run_id, snapshot=None):
        append("catalog-receipts.jsonl", {"run_id": run_id, "run_id_utf8_hex": run_id.encode("utf-8", "surrogatepass").hex(), "snapshot": snapshot})
        return super().read(run_id, snapshot)


class WireReceipts:
    """Records each request as it reached the app, and how the app answered."""

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.inner(scope, receive, send)
        seen = {"status": None}

        async def capture(message):
            if message["type"] == "http.response.start":
                seen["status"] = message["status"]
            await send(message)

        try:
            await self.inner(scope, receive, capture)
        finally:
            append("server-wire.jsonl", {"raw_path": scope.get("raw_path", b"").decode("latin-1"), "query_string": scope["query_string"].decode("latin-1"), "method": scope["method"], "status": seen["status"]})


(OUT / "alias-manifest.json").write_text(
    json.dumps({"aliases": [{"label": label, "identity": identity, "basis": basis, "code_points": len(identity), "utf8_hex": identity.encode("utf-8").hex()} for label, identity, basis in ALIASES]}, indent=1)
)
configure_ephemeral_key(STATE)
service_main.Catalog = AliasCatalog
if __name__ == "__main__":
    uvicorn.run(WireReceipts(create_history_app(STATE)), host="127.0.0.1", port=8765, access_log=False)
