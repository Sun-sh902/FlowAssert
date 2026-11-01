"""Provision the current product Service E2E harness runtime (ui/.phase3a-runtime/FlowAssert-Phase3A-Service) from THIS
workspace's Service, for ui/scripts/phase3a/{seed_states.py,evaluator_oracle.py,history-service.sh} and e2e-history/.

    /usr/bin/python3 -I -B scripts/dev/prepare_harness_runtime.py

Replaces ui/scripts/phase3a/prepare_runtime.py inside the product workspace only. That accepted script checks the
Service against its PRE-remediation-03 manifest (docs/phase3a/SOURCE_MANIFEST.json) and therefore reports
app/history_api.py and app/service.py as mismatches against the final accepted Service. It is kept unchanged as
history. This script checks the current product identity separately from the historical accepted map:
  * the reviewed current backend map is recomputed on the source AND on the copy;
  * evaluator, frozen v1, history and ID-addressability contracts, examples and migration digests (pinned below);
  * the whole copied tree (symlinks preserved, runtime state and caches excluded) equals the source tree;
  * the copied .venv's installed distributions equal service/requirements.lock exactly.
Refuses to overwrite an existing runtime. No key, database or runtime state is copied.
"""
import hashlib, json, os, runpy, shutil, stat, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "service"
RUNTIME = ROOT / "ui/.phase3a-runtime"
DST = RUNTIME / "FlowAssert-Phase3A-Service"
identity = runpy.run_path(str(ROOT / "scripts/dev/backend_identity.py"))
PINNED = {
    "vendor/model.py": "b61779e198dd0213b67f8319b77a2daf9feb502dc553784df6d6600e8e3a842d",
    "contracts/openapi-v1-proposed.yaml": "0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230",
    "contracts/openapi-history-v1.yaml": "f341d8d5ec9da1b933b06efe998c07a1045226500a6b5837e9c8a9ead74bd69f",
    "contracts/openapi-id-addressability-v1.yaml": "59ac38631982147b547ed2dae57ab4e8b2d218e3fa718861eb0c5828befcd8ae",
    "contracts/verification-examples.json": "92ea5a883acf903e90543552eec279b1a32ab42403eee37384ca6c1ab6f7b20b",
    "migrations/001.sql": "b6a09e4f7e79f76f169beac713c9793349ff8012a27b04ddd90705e1b7158f2a",
}
SKIP = {".runtime", "__pycache__", ".pytest_cache", ".state"}


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def tree(root):
    out = {}
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP)
        for name in sorted(filenames + [d for d in dirnames if os.path.islink(os.path.join(dirpath, d))]):
            full = os.path.join(dirpath, name)
            st = os.lstat(full)
            rel = os.path.relpath(full, root)
            out[rel] = "link:" + os.readlink(full) if stat.S_ISLNK(st.st_mode) else sha(full) if stat.S_ISREG(st.st_mode) else "special"
    return out


def normalized(lines):
    return sorted(l.strip().lower().replace("_", "-") for l in lines if l.strip() and not l.startswith("#"))


def main():
    problems = []
    if DST.exists():
        sys.exit(f"refusing to overwrite existing runtime {DST}")
    if not (SRC / ".venv/bin/python").exists():
        sys.exit("service/.venv is missing — run scripts/dev/bootstrap.sh first")
    try:
        source_identity = identity["inspect"](SRC)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        sys.exit(f"cannot verify current Service identity: {exc}")
    if source_identity["problems"]:
        sys.exit("workspace service/ does not match its current map; nothing copied: " + ", ".join(source_identity["problems"]))
    for rel, want in PINNED.items():
        if sha(SRC / rel) != want:
            sys.exit(f"workspace service/{rel} does not match its pinned digest; nothing copied")
    RUNTIME.mkdir(mode=0o700, exist_ok=True)
    shutil.copytree(SRC, DST, symlinks=True, ignore=lambda d, names: [n for n in names if n in SKIP])
    copy_identity = identity["inspect"](DST)
    if copy_identity["problems"] or copy_identity["current_backend_map"] != source_identity["current_backend_map"]:
        problems.append("copied backend map differs")
    problems += [f"copied {rel} digest differs" for rel, want in PINNED.items() if sha(DST / rel) != want]
    a, b = tree(SRC), tree(DST)
    if a != b:
        problems.append(f"copied tree differs ({len(set(a) ^ set(b))} paths, {sum(1 for k in a.keys() & b.keys() if a[k] != b[k])} contents)")
    freeze = subprocess.run([str(DST / ".venv/bin/python"), "-m", "pip", "freeze"], capture_output=True, text=True)
    if freeze.returncode != 0 or normalized(freeze.stdout.splitlines()) != normalized((SRC / "requirements.lock").read_text().splitlines()):
        problems.append("copied .venv distributions differ from requirements.lock")
    print(json.dumps({"runtime": str(DST), "backend_map": source_identity["current_backend_map"], "historical_backend_map": source_identity["historical_backend_map"], "tree_files": len(a), "problems": problems}, indent=1))
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
