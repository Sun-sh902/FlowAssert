#!/bin/zsh
# Records every screen's frames on an iPhone and an iPad simulator and checks them with measure_layout.py.
# Usage: ios/scripts/measure-layout.sh [OUT_DIR]   (default ios/build/layout)
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=${1:-ios/build/layout}
mkdir -p "$OUT"
DD=${DERIVED_DATA:-ios/DerivedData}
code=0
for dev in "iPhone 18 Pro" "iPad Pro 11-inch (M5)"; do
  log="$OUT/${dev// /-}.log"
  TEST_RUNNER_FA_MEASURE=1 xcodebuild test -project ios/FlowAssert.xcodeproj -scheme FlowAssert \
    -destination "platform=iOS Simulator,name=$dev" -derivedDataPath "$DD" \
    -only-testing:FlowAssertUITests/LayoutMeasureTests \
    CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= > "$log" 2>&1 || { echo "xcodebuild failed on $dev: $log"; exit 1; }
  echo "== $dev"
  python3 ios/scripts/measure_layout.py "$log" || code=$?
done
exit $code
