#!/bin/sh
# Historical protected-source custody, separate from the portable backend tests (round 02 hardening FIX01).
# Runs only the restored Phase 3A test tests/test_service.py::test_protected_repository_integrity, unchanged: every file
# digest, symlink target and read-only Git observation of the six protected roots named in
# service/evidence/protected-before.json (pinned a12bc4b2…) must equal that accepted baseline. The genuine roots are
# required; nothing is substituted. They are looked up under FLOWASSERT_PROTECTED_PARENT (default: this checkout's parent).
#   scripts/dev/protected_custody.sh [PYTEST_ARGS...]
#   exit 0   custody verified
#   exit 1   custody FAILED — a difference, or the check itself failed
#   exit 77  BLOCKED — a protected root is missing or unreadable here, so the check did not run (never a pass)
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SVC="$ROOT/service"
PARENT="${FLOWASSERT_PROTECTED_PARENT:-$(dirname "$ROOT")}"
echo "protected parent: $PARENT"
MISSING="$("$SVC/.venv/bin/python" -I -B -c '
import json, os, sys
for name in json.load(open(sys.argv[1])):
    path = os.path.join(sys.argv[2], name)
    try:
        os.listdir(path)
    except OSError as e:
        print(f"  {path}: {type(e).__name__}")
' "$SVC/evidence/protected-before.json" "$PARENT")" || { echo "could not read service/evidence/protected-before.json" >&2; exit 1; }
if [ -n "$MISSING" ]; then
  printf 'BLOCKED: protected custody NOT RUN — the accepted protected roots are not available here:\n%s\n' "$MISSING"
  echo "Set FLOWASSERT_PROTECTED_PARENT to the directory holding the genuine roots. No substitute is used."
  exit 77
fi
mkdir -p "$SVC/.runtime/tmp" && chmod 700 "$SVC/.runtime" "$SVC/.runtime/tmp"
cd "$SVC" && exec env LC_ALL=C PYTHONDONTWRITEBYTECODE=1 TMPDIR="$SVC/.runtime/tmp" FLOWASSERT_PROTECTED_PARENT="$PARENT" \
  .venv/bin/python -B -m pytest -p no:cacheprovider -q "$@" tests/test_service.py::test_protected_repository_integrity
