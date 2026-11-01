"""Copy the frozen schemas reachable from the two authorized endpoints into the UI, verbatim.

    /usr/bin/python3 -I -B scripts/phase2/extract_schemas.py

Reads (only) the frozen Phase 0 contract and writes src/data/contract/v1.schemas.json:
{ source, source_sha256, roots, schemas: {name: <exact schema object>} }. The runtime decoder
(src/data/local/schema.ts) validates live responses against this copy; contract-drift tests prove
it still equals the frozen file. Nothing in the contract is edited or reinterpreted.
"""
import hashlib, json, os

SRC = "/Users/apple_sun/Documents/FlowAssert-Integration-Planning/contracts/openapi-v1-proposed.yaml"
EXPECTED = "0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230"
UI = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(UI, "src/data/contract/v1.schemas.json")
ROOTS = ["VerificationRun", "EvidencePage", "Error"]

raw = open(SRC, "rb").read()
digest = hashlib.sha256(raw).hexdigest()
assert digest == EXPECTED, f"frozen contract digest {digest} != {EXPECTED}"
spec = json.loads(raw)
schemas = spec["components"]["schemas"]

seen, todo = set(), list(ROOTS)
def refs(x):
    if isinstance(x, dict):
        for k, v in x.items():
            if k == "$ref":
                yield v.rsplit("/", 1)[-1]
            else:
                yield from refs(v)
    elif isinstance(x, list):
        for i in x:
            yield from refs(i)
while todo:
    n = todo.pop()
    if n in seen:
        continue
    seen.add(n)
    todo.extend(refs(schemas[n]))

out = {
    "source": "FlowAssert-Integration-Planning/contracts/openapi-v1-proposed.yaml",
    "source_sha256": digest,
    "contract_version": spec["info"]["version"],
    "roots": ROOTS,
    "schemas": {n: schemas[n] for n in sorted(seen)},
}
with open(OUT, "w") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
    f.write("\n")
print(len(seen), "schemas →", OUT)
