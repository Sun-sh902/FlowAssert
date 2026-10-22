"""Copy the Phase 3A additive history schemas into the UI, verbatim.

    /usr/bin/python3 -I -B scripts/phase3a/extract_history_schemas.py

Reads (only) the reviewed additive contract delivered by the Phase 3A backend handoff and writes
src/data/contract/history.schemas.json: { source, source_sha256, contract_version, frozen_contract_sha256,
roots, schemas: {name: <exact schema object>} } — the $ref closure of the three history 200 bodies and the
Error envelope. The runtime decoder (src/data/history/decode.ts) validates live history responses against
this copy; src/test/history-contract-drift.test.ts proves it still equals the additive contract and that
every schema it shares with the frozen Phase 0 contract is byte-for-byte that frozen schema.
Nothing in either contract is edited or reinterpreted. The frozen copy (v1.schemas.json) is not touched.
"""
import hashlib, json, os

SRC = "/Users/zhangshenghe/Documents/FlowAssert-Phase3A-Service/contracts/openapi-history-v1.yaml"
EXPECTED = "f341d8d5ec9da1b933b06efe998c07a1045226500a6b5837e9c8a9ead74bd69f"
FROZEN = "0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230"
UI = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(UI, "src/data/contract/history.schemas.json")
ROOTS = ["HistoryList", "HistoryDetail", "HistoryEvidencePage", "Error"]

raw = open(SRC, "rb").read()
digest = hashlib.sha256(raw).hexdigest()
assert digest == EXPECTED, f"additive contract digest {digest} != {EXPECTED}"
spec = json.loads(raw)
assert spec["info"]["version"] == "phase3a-1.0.0"
assert spec["x-frozen-contract-sha256"] == FROZEN
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
    "source": "FlowAssert-Phase3A-Service/contracts/openapi-history-v1.yaml",
    "source_sha256": digest,
    "contract_version": spec["info"]["version"],
    "frozen_contract_sha256": spec["x-frozen-contract-sha256"],
    "roots": ROOTS,
    "schemas": {n: schemas[n] for n in sorted(seen)},
}
with open(OUT, "w") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
    f.write("\n")
print(len(seen), "schemas →", OUT)
