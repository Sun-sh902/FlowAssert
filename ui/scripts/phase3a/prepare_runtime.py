"""Prepare an isolated, exact-source copy of the Phase 3A history Service for Phase 3A frontend
integration tests. Read-only toward every protected workspace.

    /usr/bin/python3 -I -B scripts/phase3a/prepare_runtime.py

Layout (gitignored, inside FlowAssert-Phase3A-UI):
    .phase3a-runtime/FlowAssert-Phase3A-Service/   complete backend tree except .runtime/ and bytecode
                                                   caches (app.identity.ROOT resolves here, so private
                                                   state, keys and SQLite live under its own .runtime/)
Checks, each against the Codex handoff (docs/phase3a/SOURCE_MANIFEST.json, final-identities.json):
  * all 46 manifest files: manifest digest = current original bytes = copied bytes;
  * source_snapshot_sha256 recomputed from the manifest mapping (Python canonical JSON);
  * additive contract, frozen contract, migration and evaluator digests;
  * the .venv tree (symlinks preserved) identical to the original.
Refuses to overwrite an existing runtime. No key, database or runtime state is copied: the copy
creates its own through the reviewed seed pipeline (archive_cli.py).
"""
import hashlib, json, os, shutil, stat, sys

UI = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RUNTIME = os.path.join(UI, ".phase3a-runtime")
SERVICE = "/Users/zhangshenghe/Documents/FlowAssert-Phase3A-Service"
DST = os.path.join(RUNTIME, "FlowAssert-Phase3A-Service")
OUT = os.path.join(UI, "docs/phase3a/evidence/runtime/runtime-manifest.json")
EXPECTED = {
    "source_snapshot_sha256": "2249569fa3a97fa3ab44aa0ba2088e5fc7ffd264cc8c824d062ae270d7ba6a65",
    "contracts/openapi-history-v1.yaml": "f341d8d5ec9da1b933b06efe998c07a1045226500a6b5837e9c8a9ead74bd69f",
    "contracts/openapi-v1-proposed.yaml": "0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230",
    "migrations/001.sql": "b6a09e4f7e79f76f169beac713c9793349ff8012a27b04ddd90705e1b7158f2a",
    "vendor/model.py": "b61779e198dd0213b67f8319b77a2daf9feb502dc553784df6d6600e8e3a842d",
}
SKIP_DIRS = {".runtime", "__pycache__", ".pytest_cache"}


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def tree(root, skip=()):
    out = {}
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if not (dirpath == root and d in skip) and d != "__pycache__")
        for name in sorted(dirnames + filenames):
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root)
            st = os.lstat(full)
            if stat.S_ISLNK(st.st_mode):
                out[rel] = "symlink:" + os.readlink(full)
            elif stat.S_ISREG(st.st_mode):
                out[rel] = sha(full)
    return out


def ignore(dirpath, names):
    return [n for n in names if n in SKIP_DIRS or n == ".DS_Store" and False]


def main():
    if os.path.exists(RUNTIME):
        sys.exit(f"refusing to overwrite existing runtime {RUNTIME}")
    manifest = json.load(open(os.path.join(SERVICE, "docs/phase3a/SOURCE_MANIFEST.json")))
    identities = json.load(open(os.path.join(SERVICE, "docs/phase3a/evidence/final-identities.json")))
    report = {"service": SERVICE, "copy": DST, "files": {}, "identities": {}, "venv": {}, "problems": []}
    canon = json.dumps(manifest["files"], sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    recomputed = hashlib.sha256(canon).hexdigest()
    report["identities"]["source_snapshot_sha256"] = {"manifest": manifest["source_snapshot_sha256"], "recomputed": recomputed, "handoff": EXPECTED["source_snapshot_sha256"]}
    if not (recomputed == manifest["source_snapshot_sha256"] == EXPECTED["source_snapshot_sha256"] == identities["source_snapshot_sha256"]):
        report["problems"].append("source snapshot identity mismatch")
    os.makedirs(RUNTIME, mode=0o700)
    shutil.copytree(SERVICE, DST, symlinks=True, ignore=lambda d, names: [n for n in names if n in SKIP_DIRS])
    for rel, want in sorted(manifest["files"].items()):
        cur, cop = sha(os.path.join(SERVICE, rel)), sha(os.path.join(DST, rel))
        ok = want == cur == cop
        report["files"][rel] = {"manifest": want, "original_now": cur, "copied": cop, "match": ok}
        if not ok:
            report["problems"].append(f"source identity mismatch: {rel}")
    for rel, want in EXPECTED.items():
        if rel == "source_snapshot_sha256":
            continue
        cur, cop = sha(os.path.join(SERVICE, rel)), sha(os.path.join(DST, rel))
        report["identities"][rel] = {"expected": want, "original_now": cur, "copied": cop}
        if not want == cur == cop:
            report["problems"].append(f"identity mismatch: {rel}")
    whole_a, whole_b = tree(SERVICE, skip=SKIP_DIRS), tree(DST, skip=SKIP_DIRS)
    report["whole_tree"] = {"files": len(whole_a), "identical": whole_a == whole_b}
    if whole_a != whole_b:
        report["problems"].append("whole-tree copy differs")
    va, vb = tree(os.path.join(SERVICE, ".venv")), tree(os.path.join(DST, ".venv"))
    report["venv"] = {"files": len(va), "identical": va == vb, "pyvenv.cfg": open(os.path.join(DST, ".venv/pyvenv.cfg")).read()}
    if va != vb:
        report["problems"].append("venv copy differs")
    report["handoff_identities"] = identities
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(report, f, indent=1, sort_keys=True)
    print(json.dumps({"manifest_files": len(manifest["files"]), "whole_tree_files": len(whole_a), "venv_files": len(va), "all_match": not report["problems"], "problems": report["problems"]}, indent=1))
    sys.exit(1 if report["problems"] else 0)


if __name__ == "__main__":
    main()
