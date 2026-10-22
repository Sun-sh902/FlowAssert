"""Independent oracle: run the pinned evaluator directly on the five reviewed synthetic inputs.

    .phase3a-runtime/FlowAssert-Phase3A-Service/.venv/bin/python -I -B scripts/phase3a/evaluator_oracle.py

Loads vendor/model.py through the backend's own digest-checked loader (app.identity.load_evaluator,
which refuses any bytes but b61779e1…842d) from the isolated runtime copy, evaluates each case's
input_evidence from contracts/verification-examples.json (digest-checked), and writes
docs/phase3a/evidence/evaluator/<SPEC>.json with the computed result. The real-service E2E suite
compares every archived run.result with these outputs; nothing here reads the UI or the archive.
"""
import hashlib, json, os, sys
from pathlib import Path

UI = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT = os.path.join(UI, ".phase3a-runtime/FlowAssert-Phase3A-Service")
OUT = os.path.join(UI, "docs/phase3a/evidence/evaluator")
sys.path.insert(0, ROOT)
from app.identity import EXAMPLES_HASH, MODEL, MODEL_HASH, canonical, checked_bytes, load_evaluator  # noqa: E402

evaluate = load_evaluator()
examples = json.loads(checked_bytes(Path(ROOT, "contracts/verification-examples.json"), EXAMPLES_HASH))["examples"]
os.makedirs(OUT, exist_ok=True)
summary = {}
for case in examples:
    vid = case["proposed_response"]["identity"]["id"]
    result = evaluate(json.loads(canonical(case["input_evidence"])))
    record = {"verification_id": vid, "reviewed_case": case["case_id"], "model_path": str(MODEL), "model_sha256": hashlib.sha256(open(MODEL, "rb").read()).hexdigest(),
              "expected_model_sha256": MODEL_HASH, "computed_result": result, "computed_result_sha256": hashlib.sha256(canonical(result)).hexdigest()}
    with open(os.path.join(OUT, f"{vid}.json"), "w") as f:
        json.dump(record, f, indent=1, sort_keys=True)
    summary[vid] = {"cohort_state": result["cohort_state"], "records": [r["state"] for r in result["records"]], "expected_total": result["expected_total"], "source_population_known": result["source_population_known"]}
print(json.dumps(summary, indent=1))
