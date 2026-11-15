#!/bin/zsh
# Launch, opening a 50 MB workbook, and scrolling a 100,000-record list, on one simulator; prints XCTest's averages.
# Usage: ios/scripts/measure-performance.sh [DEVICE] [OUT_DIR]   (defaults: "iPhone 18 Pro", ios/build/performance)
# The workbook is engine-cases.mjs --large's (written if missing); the report comes from the command line on two CSV
# files of 100,000 rows in which every 7th phone and every 11th email differ.
set -euo pipefail
cd "$(dirname "$0")/../.."
DEVICE=${1:-iPhone 18 Pro}
OUT=${2:-ios/build/performance}
DD=${DERIVED_DATA:-ios/DerivedData}
PY=${FA_PYTHON:-python3}
mkdir -p "$OUT"
WORKBOOK=$PWD/ios/build/engine-cases/large/files/workbook-50mb.xlsx
[[ -f $WORKBOOK ]] || "$PY" ios/scripts/large_workbook.py "$WORKBOOK" 500000 100
REPORT=$PWD/$OUT/report-100000.json
if [[ ! -f $REPORT ]]; then
  "$PY" - "$OUT" <<'EOF'
import sys
out = sys.argv[1]
def n(i): return str(i).zfill(7)
with open(f"{out}/source.csv", "w") as s, open(f"{out}/destination.csv", "w") as d:
    s.write("id,phone,email\n"); d.write("id,phone,email\n")
    for i in range(100_000):
        s.write(f"SYN-{n(i)},+1 555 {n(i)},u{n(i)}@ex.test\n")
        d.write(f"SYN-{n(i)},+1 555 {n(i)}{'x' if i % 7 == 3 else ''},u{n(i)}@ex.test{'m' if i % 11 == 5 else ''}\n")
EOF
  PYTHONPATH=offline "$PY" -c "import sys; from flowassert_offline.cli import main; sys.exit(main())" \
    --source "$OUT/source.csv" --destination "$OUT/destination.csv" --key id --field phone --field email \
    --source-complete --destination-complete --json "$REPORT" > /dev/null || true
fi
log="$OUT/${DEVICE// /-}.log"
TEST_RUNNER_FA_PERF=1 TEST_RUNNER_FA_PERF_WORKBOOK=$WORKBOOK TEST_RUNNER_FA_PERF_REPORT=$REPORT \
  xcodebuild test -project ios/FlowAssert.xcodeproj -scheme FlowAssert -destination "platform=iOS Simulator,name=$DEVICE" \
  -derivedDataPath "$DD" -only-testing:FlowAssertUITests/PerformanceTests \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= > "$log" 2>&1 || { echo "xcodebuild failed: $log"; tail -30 "$log"; exit 1; }
grep -E "measured \[" "$log" | sed -E "s/.*Test Case '-\[FlowAssertUITests.PerformanceTests ([^]]*)\]' measured \[([^]]*)\] average: ([0-9.]+), relative standard deviation: ([0-9.]+%).*/\1 | \2 | \3 (±\4)/"
