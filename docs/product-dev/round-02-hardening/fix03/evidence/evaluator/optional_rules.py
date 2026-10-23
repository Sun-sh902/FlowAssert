"""Read-only: run the pinned Evaluator (service/vendor/model.py) on reviewed fixture A-verified with the two optional
requirements enabled (policy flags removed -> Evaluator default "required"). Prints the records and cohort it produces."""
import copy, json, os, sys
sys.path.insert(0, os.path.join(os.getcwd(), "vendor"))
import model
case = json.load(open("fixtures/A-verified.json"))
ev = copy.deepcopy(case["input_evidence"])
pol = ev["policy"] if "policy" in ev else ev["rule"]["policy"]
print("policy flags before:", {k: pol.get(k) for k in ("require_historical_deadline", "require_execution")}, file=sys.stderr)
out = {}
for name, drop in (("history", ["require_historical_deadline"]), ("execution", ["require_execution"]), ("both", ["require_historical_deadline", "require_execution"])):
    e = copy.deepcopy(ev); p = e["policy"] if "policy" in e else e["rule"]["policy"]
    for k in drop: p[k] = True
    r = model.evaluate(e)
    out[name] = {"cohort_state": r["cohort_state"], "counts": r["counts"], "records": r["records"]}
print(json.dumps(out, indent=1))
