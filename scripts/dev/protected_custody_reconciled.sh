#!/bin/sh
# Custody against the Owner-approved reconciled baseline, not the historical one, which still fails.
# A PASS here means the protected roots still match what the Owner accepted on 2026-10-31. It does not
# show that original custody was unbroken. See BACKEND-ACCEPTANCE-20261031/custody-reconciliation/.
#   exit codes as scripts/dev/protected_custody.sh, plus exit 1 if the reconciled baseline changed
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASELINE="$ROOT/service/evidence/protected-reconciled-20261031.json"
EXPECTED='a73eb3c6f944d36da6d22609e9a7ad29ec0f18f449ba0e082c55cccfa48ed4c5'
ACTUAL="$(shasum -a 256 "$BASELINE" | cut -d' ' -f1)"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "reconciled baseline does not match its pinned digest" >&2; exit 1; }
FA_CUSTODY_BASELINE_PINNED=1 FLOWASSERT_INTEGRITY_BASELINE="$BASELINE" exec "$ROOT/scripts/dev/protected_custody.sh" "$@"
