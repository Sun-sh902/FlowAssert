#!/usr/bin/env python3
"""Serve the local fakes of Google Sheets and HubSpot for one synthetic check, for the Action's self-test.

    python scripts/dev/serve_fakes.py --sheets-token T --hubspot-token U --env-file "$GITHUB_ENV" --seconds 900 &

It starts offline/bench/fake_sheets_api.py and fake_hubspot_api.py on loopback ports, with the responses of one check
of SHEET (a range of three leads) against CONTACTS (three HubSpot contacts: one the same, one with another phone, one
not in the sheet), and accepts only the two credentials given. It appends FLOWASSERT_SHEETS_TEST_ENDPOINT and
FLOWASSERT_HUBSPOT_TEST_ENDPOINT to the env file, so that later steps of the job reach the fakes, writes "ready" to
--ready when it listens, and stops after --seconds. It never writes a credential anywhere. Every value is synthetic,
and nothing here contacts Google or HubSpot. scripts/dev/tests/test_action.py runs the same check in-process.
"""
import argparse
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "offline" / "bench"))
from fake_hubspot_api import FakeHubSpotApi, contact, page  # noqa: E402
from fake_sheets_api import FakeSheetsApi, drive, values  # noqa: E402

SPREADSHEET = "1SyntheticSpreadsheet-FlowAssert_0001"
RANGE = "Leads!A1:C4"
SHEET = [["lead_id", "phone", "email"], ["L-1", "+1 555 0001", "a@example.test"],
         ["L-2", "+1 555 0002", "b@example.test"], ["L-3", "+1 555 0003", "c@example.test"]]
CONTACTS = [contact("901", {"lead_id": "L-1", "phone": "+1 555 0001", "email": "a@example.test"}),
            contact("902", {"lead_id": "L-2", "phone": "+1 555 0099", "email": "b@example.test"}),
            contact("903", {"lead_id": "L-9", "phone": "+1 555 0009", "email": "z@example.test"})]


def sheet_responses():
    return {"drive": [drive(7), drive(7)], "values": [values(RANGE, SHEET)]}


def hubspot_responses():
    return [page(CONTACTS)]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--sheets-token", required=True)
    parser.add_argument("--hubspot-token", required=True)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--ready")
    parser.add_argument("--seconds", type=float, default=900)
    args = parser.parse_args(argv)
    with FakeSheetsApi(sheet_responses(), credential=("token", args.sheets_token)) as google, \
            FakeHubSpotApi(hubspot_responses(), token=args.hubspot_token) as crm:
        with open(args.env_file, "a", encoding="utf-8") as f:
            f.write(f"FLOWASSERT_SHEETS_TEST_ENDPOINT={google.endpoint}\n"
                    f"FLOWASSERT_HUBSPOT_TEST_ENDPOINT={crm.endpoint}\n")
        if args.ready:
            Path(args.ready).write_text("ready\n", encoding="utf-8")
        time.sleep(args.seconds)
    return 0


if __name__ == "__main__":
    sys.exit(main())
