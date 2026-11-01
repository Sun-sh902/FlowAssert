"""Changed-file inventory of the Phase 3A frontend against the accepted Phase 2 source (read-only).

    /usr/bin/python3 -I -B scripts/phase3a/changed_files.py

Compares every regular file of FlowAssert-Phase3A-UI with FlowAssert-UI, excluding generated or
runtime trees on both sides (node_modules, .git, the isolated runtimes, scratch, build and test
output). Writes docs/phase3a/evidence/source-integrity/changed-files.json (added / modified / removed,
with SHA-256 before and after) and accepted-files.diff (a unified diff of every modified accepted file).
"""
import difflib, hashlib, json, os

UI = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ACCEPTED = "/Users/apple_sun/Documents/FlowAssert-UI"
OUT = os.path.join(UI, "docs/phase3a/evidence/source-integrity")
SKIP_TOP = {"node_modules", ".git", ".phase2-runtime", ".phase3a-runtime", ".phase3a-tmp", "dist", "test-results", "test-results-local", "test-results-history"}
SKIP_PREFIX = ("e2e/.output/",)


def files(root):
    out = {}
    for dp, dns, fns in os.walk(root):
        rel_dir = os.path.relpath(dp, root)
        if rel_dir == ".":
            dns[:] = [d for d in dns if d not in SKIP_TOP]
        for f in fns:
            rel = os.path.normpath(os.path.join(rel_dir, f))
            if rel.startswith(SKIP_PREFIX) or f == ".DS_Store":
                continue
            p = os.path.join(dp, f)
            if os.path.islink(p) or not os.path.isfile(p):
                continue
            out[rel] = hashlib.sha256(open(p, "rb").read()).hexdigest()
    return out


def main():
    a, b = files(ACCEPTED), files(UI)
    added = sorted(set(b) - set(a))
    removed = sorted(set(a) - set(b))
    modified = sorted(k for k in set(a) & set(b) if a[k] != b[k])
    os.makedirs(OUT, exist_ok=True)
    def group(paths):
        g = {}
        for p in paths:
            top = p.split("/")[0] if "/" in p else "(root)"
            if p.startswith("docs/phase3a/evidence/"): top = "docs/phase3a/evidence"
            elif p.startswith("docs/screenshots/phase3a/"): top = "docs/screenshots/phase3a"
            g[top] = g.get(top, 0) + 1
        return g
    report = {
        "accepted": ACCEPTED, "candidate": UI,
        "excluded": sorted(SKIP_TOP) + list(SKIP_PREFIX) + [".DS_Store"],
        "counts": {"added": len(added), "modified": len(modified), "removed": len(removed)},
        "added_by_area": group(added),
        "modified": [{"path": p, "sha256_before": a[p], "sha256_after": b[p]} for p in modified],
        "removed": removed,
        "added": [{"path": p, "sha256": b[p]} for p in added],
    }
    with open(os.path.join(OUT, "changed-files.json"), "w") as f:
        json.dump(report, f, indent=1)
    with open(os.path.join(OUT, "accepted-files.diff"), "w") as f:
        for p in modified:
            try:
                x = open(os.path.join(ACCEPTED, p), encoding="utf8").read().splitlines(keepends=True)
                y = open(os.path.join(UI, p), encoding="utf8").read().splitlines(keepends=True)
            except UnicodeDecodeError:
                f.write(f"Binary file {p} differs\n")
                continue
            f.writelines(difflib.unified_diff(x, y, f"accepted/{p}", f"phase3a/{p}"))
    print(json.dumps({"counts": report["counts"], "modified": modified, "added_by_area": report["added_by_area"], "removed": removed}, indent=1))


if __name__ == "__main__":
    main()
