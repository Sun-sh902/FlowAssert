#!/bin/sh
# Usage: venv.sh CLONE — pre-create service/.venv with Python 3.12 + the exact lock, then run bootstrap.
# A correct bootstrap must refuse (the Service requires Python 3.14). Prints bootstrap's exit code.
C="$1"; cd "$C" || exit 99
rm -rf service/.venv && python3.12 -m venv service/.venv && uv pip install -q --python service/.venv/bin/python --no-deps -r service/requirements.lock || exit 98
echo "venv python: $(service/.venv/bin/python --version)"
"$NOSIB" scripts/dev/bootstrap.sh > "$C/.venv-repro.out" 2>&1; rc=$?
grep -E "venv|py-env|BOOTSTRAP" "$C/.venv-repro.out"; echo "bootstrap exit=$rc"
