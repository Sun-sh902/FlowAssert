"""Prepare an isolated, exact-source copy of the Phase 3A Service at the ID-addressability handoff identity
(remediation-03) for frontend integration tests. Read-only toward every protected workspace.

    /usr/bin/python3 -I -B scripts/phase3a/prepare_lookup_runtime.py

Layout (gitignored, inside FlowAssert-Phase3A-UI):
    .phase3a-lookup-runtime/FlowAssert-Phase3A-Service/   backend tree without .runtime/, docs/ and bytecode
                                                          caches (app.identity.ROOT resolves here, so private
                                                          state, keys and SQLite live under its own .runtime/)
    + docs/phase3a/id-addressability-remediation-03/evidence/{http_server.py,corpus.py}
                                                          the backend's own TEST-ONLY identity-alias launcher
    + docs/phase3a/evidence/baseline-source.json          read by the Service when it seeds an archive
Checks, each against the backend handoff (docs/phase3a/id-addressability-remediation-03/):
  * all 39 files of evidence/source-identities.json: handoff digest = current original bytes = copied bytes;
  * backend source identity recomputed from that map (Python canonical JSON) = a5d68b75…b45 (pinned below);
  * new additive contract digest = 59ac3863…d8ae (pinned below);
  * the three docs files: original bytes = copied bytes;
  * the .venv tree (symlinks preserved) identical to the original.
Refuses to overwrite an existing runtime. No key, database or runtime state is copied.
"""
import hashlib, json, os, shutil, stat, sys

UI = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RUNTIME = os.path.join(UI, ".phase3a-lookup-runtime")
SERVICE = "/Users/zhangshenghe/Documents/FlowAssert-Phase3A-Service"
DST = os.path.join(RUNTIME, "FlowAssert-Phase3A-Service")
HANDOFF = "docs/phase3a/id-addressability-remediation-03"
OUT = os.path.join(UI, "docs/phase3a/id-addressability-remediation-03/evidence/runtime/runtime-manifest.json")
PINNED = {
    "backend_source_sha256": "a5d68b75d67624e22223fa8ee9328447d96e639001dfac8cea271e4331b34b45",
    "contracts/openapi-id-addressability-v1.yaml": "59ac38631982147b547ed2dae57ab4e8b2d218e3fa718861eb0c5828befcd8ae",
}
# docs/ is not copied (370 MB of reports). Exactly these docs files are: the backend's own test-only alias launcher
# and its corpus, and the one docs file the Service reads at runtime (app/history_store.py source_identity()).
HELPERS = [f"{HANDOFF}/evidence/http_server.py", f"{HANDOFF}/evidence/corpus.py", "docs/phase3a/evidence/baseline-source.json"]
SKIP_TOP = {".runtime", "docs", "baseline", "evidence"}
SKIP_ANY = {"__pycache__", ".pytest_cache", ".DS_Store"}


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def tree(root):
    out = {}
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")
        for name in sorted(dirnames + filenames):
            full = os.path.join(dirpath, name)
            st = os.lstat(full)
            rel = os.path.relpath(full, root)
            if stat.S_ISLNK(st.st_mode):
                out[rel] = "symlink:" + os.readlink(full)
            elif stat.S_ISREG(st.st_mode):
                out[rel] = sha(full)
    return out


def main():
    if os.path.exists(RUNTIME):
        sys.exit(f"refusing to overwrite existing runtime {RUNTIME}")
    ids = json.load(open(os.path.join(SERVICE, HANDOFF, "evidence/source-identities.json")))
    report = {"service": SERVICE, "copy": DST, "pinned": PINNED, "files": {}, "helpers": {}, "venv": {}, "problems": []}
    os.makedirs(RUNTIME, mode=0o700)
    shutil.copytree(SERVICE, DST, symlinks=True,
                    ignore=lambda d, names: [n for n in names if n in SKIP_ANY or (d == SERVICE and n in SKIP_TOP)])
    mapping = {}
    for rel, want in sorted(ids["files"].items()):
        cur, cop = sha(os.path.join(SERVICE, rel)), sha(os.path.join(DST, rel))
        mapping[rel] = cop
        ok = want == cur == cop
        report["files"][rel] = {"handoff": want, "original_now": cur, "copied": cop, "match": ok}
        if not ok:
            report["problems"].append(f"source identity mismatch: {rel}")
    canon = json.dumps(mapping, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()
    recomputed = hashlib.sha256(canon).hexdigest()
    report["backend_source_sha256"] = {"handoff": ids["backend_source_sha256"], "recomputed_from_copy": recomputed, "pinned": PINNED["backend_source_sha256"]}
    if not (recomputed == ids["backend_source_sha256"] == PINNED["backend_source_sha256"]):
        report["problems"].append("backend source identity mismatch")
    contract = "contracts/openapi-id-addressability-v1.yaml"
    report["contract"] = {"original": sha(os.path.join(SERVICE, contract)), "copied": sha(os.path.join(DST, contract)), "pinned": PINNED[contract]}
    if not (report["contract"]["original"] == report["contract"]["copied"] == PINNED[contract]):
        report["problems"].append("contract digest mismatch")
    for rel in HELPERS:
        os.makedirs(os.path.dirname(os.path.join(DST, rel)), exist_ok=True)
        shutil.copy2(os.path.join(SERVICE, rel), os.path.join(DST, rel))
        a, b = sha(os.path.join(SERVICE, rel)), sha(os.path.join(DST, rel))
        report["helpers"][rel] = {"original": a, "copied": b, "match": a == b}
        if a != b:
            report["problems"].append(f"helper mismatch: {rel}")
    v_orig, v_copy = tree(os.path.join(SERVICE, ".venv")), tree(os.path.join(DST, ".venv"))
    report["venv"] = {"entries": len(v_orig), "identical": v_orig == v_copy,
                      "aggregate_sha256": hashlib.sha256(json.dumps(v_orig, sort_keys=True).encode()).hexdigest()}
    if v_orig != v_copy:
        report["problems"].append(".venv differs from original")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(report, f, indent=1, sort_keys=True)
    print(json.dumps({"problems": report["problems"], "backend_source_sha256": report["backend_source_sha256"], "contract": report["contract"], "venv": report["venv"]}, indent=1))
    sys.exit(1 if report["problems"] else 0)


if __name__ == "__main__":
    main()
