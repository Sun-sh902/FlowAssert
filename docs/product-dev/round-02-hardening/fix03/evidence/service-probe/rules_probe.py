"""In-process (no TCP port) read of the real Service: rule keys/status per record for SPEC-001..005,
plus the history list's archive-record integrity statuses. Read-only."""
import json
import os
import sys

sys.path.insert(0, os.getcwd())
from archive_cli import configure_ephemeral_key

configure_ephemeral_key(os.environ['FLOWASSERT_HISTORY_STATE'])
from fastapi.testclient import TestClient
from app.history_api import create_history_app

out = {}
with TestClient(create_history_app()) as c:
    for n in range(1, 6):
        vid = f"SPEC-00{n}"
        r = c.get(f"/api/v1/verifications/{vid}")
        body = r.json()
        if r.status_code != 200:
            out[vid] = {"http": r.status_code, "body": body}
            continue
        res = body["result"]
        out[vid] = {"http": r.status_code, "cohort": res["cohort_state"], "records": [
            {"key": rec["key"], "state": rec["state"],
             "rules": {k: f'{v["status"]} | {v["reason"]}' for k, v in rec["rules"].items()}}
            for rec in res["records"]]}
    lst = c.get("/api/v1/history?limit=50")
    j = lst.json()
    out["history_list"] = {"http": lst.status_code, "total": j["page"]["total"],
                           "integrity_statuses": sorted({i["integrity"]["status"] for i in j["items"]}),
                           "ids": [(i.get("original_verification_id"), i["result_summary"].get("cohort_state")) for i in j["items"]]}
print(json.dumps(out, indent=1, ensure_ascii=False))
