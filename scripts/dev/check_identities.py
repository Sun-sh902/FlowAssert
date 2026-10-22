"""Fail if the workspace Service's pinned Evaluator, frozen contracts or accepted backend source map drift from
the accepted Phase 3A baseline (PHASE3A_FINAL_OWNER_ACCEPTANCE/ACCEPTED_SOURCE_BASELINE.md). Read-only.

    /usr/bin/python3 -I -B scripts/dev/check_identities.py
"""
import hashlib, json, sys
from pathlib import Path

SVC = Path(__file__).resolve().parents[2] / "service"
PINNED = {
    "vendor/model.py": "b61779e198dd0213b67f8319b77a2daf9feb502dc553784df6d6600e8e3a842d",
    "contracts/openapi-v1-proposed.yaml": "0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230",
    "contracts/openapi-history-v1.yaml": "f341d8d5ec9da1b933b06efe998c07a1045226500a6b5837e9c8a9ead74bd69f",
    "contracts/openapi-id-addressability-v1.yaml": "59ac38631982147b547ed2dae57ab4e8b2d218e3fa718861eb0c5828befcd8ae",
    "contracts/verification-examples.json": "92ea5a883acf903e90543552eec279b1a32ab42403eee37384ca6c1ab6f7b20b",
}
BACKEND_MAP = "a5d68b75d67624e22223fa8ee9328447d96e639001dfac8cea271e4331b34b45"
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
problems = [f"{rel}: {sha(SVC / rel)} != {want}" for rel, want in PINNED.items() if sha(SVC / rel) != want]
files = json.loads((SVC / "docs/phase3a/id-addressability-remediation-03/evidence/source-identities.json").read_text())["files"]
current = {p: sha(SVC / p) for p in files}
ident = hashlib.sha256(json.dumps(current, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
if ident != BACKEND_MAP:
    problems.append(f"backend 39-file map {ident} != {BACKEND_MAP}: " + ", ".join(p for p in files if current[p] != files[p]))
print(json.dumps({"pinned": {k: "match" for k in PINNED if not any(x.startswith(k) for x in problems)}, "backend_map": ident, "problems": problems}, indent=1))
sys.exit(1 if problems else 0)
