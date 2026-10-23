"""Read-only: pinned Evaluator on A-verified with an incomplete destination read (partial=True) and the HubSpot phone
withheld (null). Shows whether existence=pass, uniqueness=unknown, phone=unknown with state Unverified is produced."""
import copy, json, os, sys
sys.path.insert(0, os.path.join(os.getcwd(), "vendor"))
import model
case = json.load(open("fixtures/A-verified.json"))
e = copy.deepcopy(case["input_evidence"])
d = e["destination"]
print("destination keys:", sorted(d), file=sys.stderr)
d["partial"] = True
def walk(o):
    if isinstance(o, dict):
        if "phone" in o and o.get("key") == "SYN-001" and "id" in o: o["phone"] = None
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(d)
r = model.evaluate(e)
print(json.dumps({"cohort_state": r["cohort_state"], "records": r["records"]}, indent=1))
