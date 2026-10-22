"""Prepare an isolated, exact-source copy of the accepted FlowAssert Python Service for Phase 2
browser integration tests. Read-only toward every protected workspace.

    /usr/bin/python3 -I -B scripts/phase2/prepare_runtime.py

Layout (gitignored, inside FlowAssert-UI):
    .phase2-runtime/FlowAssert-Service/                    34 accepted source/config/test/doc files + copied .venv
    .phase2-runtime/FlowAssert-round03-oracle-fix/experiments/round03/model.py   pinned evaluator (sibling layout
                                                           required by app/identity.py MODEL = ROOT.parent / ...)
    .phase2-runtime/state/keys/                            created by the Service itself (FLOWASSERT_CURSOR_KEY_FILE)
    .phase2-runtime/state/tmp/                             TMPDIR for the Python process

Every copied file is compared against the accepted digests recorded in the Codex handoff
(accepted-source-comparison.json, `accepted` column) and against the current original bytes.
Refuses to overwrite an existing runtime. Key material is never copied: the runtime gets its own key.
"""
import hashlib, json, os, shutil, sys

UI = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RUNTIME = os.path.join(UI, ".phase2-runtime")
SERVICE = "/Users/zhangshenghe/Documents/FlowAssert-Service"
RESEARCH_MODEL = "/Users/zhangshenghe/Documents/FlowAssert-round03-oracle-fix/experiments/round03/model.py"
HANDOFF = "/Users/zhangshenghe/Documents/FlowAssert-Phase2-Support/evidence/identity/accepted-source-comparison.json"
MODEL_SHA256 = "b61779e198dd0213b67f8319b77a2daf9feb502dc553784df6d6600e8e3a842d"
# Phase 3A: FA_PHASE2_RUNTIME_MANIFEST redirects this record so a re-preparation never overwrites the accepted Phase 2 evidence.
OUT = os.environ.get("FA_PHASE2_RUNTIME_MANIFEST", os.path.join(UI, "docs/phase2/evidence/runtime/runtime-manifest.json"))


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def tree(root):
    out = {}
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        for name in sorted(dirnames + filenames):
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root)
            if os.path.islink(full):
                out[rel] = "symlink:" + os.readlink(full)
            elif os.path.isfile(full):
                out[rel] = sha(full)
    return out


def main():
    if os.path.exists(RUNTIME):
        sys.exit(f"refusing to overwrite existing runtime {RUNTIME}")
    accepted = json.load(open(HANDOFF))
    files = accepted["files"]
    if accepted["drift"]:
        sys.exit("handoff reports source drift; stop")
    report = {"service_files": {}, "model": {}, "venv": {}, "problems": []}
    dst_service = os.path.join(RUNTIME, "FlowAssert-Service")
    for rel, ids in sorted(files.items()):
        src = os.path.join(SERVICE, rel)
        current = sha(src)
        dst = os.path.join(dst_service, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        copied = sha(dst)
        ok = ids["accepted"] == current == copied
        report["service_files"][rel] = {"accepted": ids["accepted"], "original_now": current, "copied": copied, "match": ok}
        if not ok:
            report["problems"].append(f"source identity mismatch: {rel}")
    model_dst = os.path.join(RUNTIME, "FlowAssert-round03-oracle-fix/experiments/round03/model.py")
    os.makedirs(os.path.dirname(model_dst), exist_ok=True)
    shutil.copy2(RESEARCH_MODEL, model_dst)
    report["model"] = {"expected": MODEL_SHA256, "original_now": sha(RESEARCH_MODEL), "copied": sha(model_dst)}
    if not (MODEL_SHA256 == report["model"]["original_now"] == report["model"]["copied"]):
        report["problems"].append("model identity mismatch")
    venv_src, venv_dst = os.path.join(SERVICE, ".venv"), os.path.join(dst_service, ".venv")
    shutil.copytree(venv_src, venv_dst, symlinks=True)
    a, b = tree(venv_src), tree(venv_dst)
    report["venv"] = {"files": len(a), "identical": a == b}
    if a != b:
        report["problems"].append("venv copy differs")
    os.makedirs(os.path.join(RUNTIME, "state/tmp"), mode=0o700, exist_ok=True)
    report["service_file_count"] = len(files)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(report, f, indent=1, sort_keys=True)
    print(json.dumps({"service_files": len(files), "all_match": not report["problems"], "venv_files": len(a), "problems": report["problems"]}, indent=1))
    sys.exit(1 if report["problems"] else 0)


if __name__ == "__main__":
    main()
