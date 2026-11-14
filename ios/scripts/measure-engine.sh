#!/bin/zsh
# Time and peak memory of each large case of the engine test, one xcodebuild run each, on a simulator.
#   node ios/scripts/engine-cases.mjs --large && ios/scripts/measure-engine.sh [DESTINATION] [DERIVED_DATA]
set -u
cd "$(dirname "$0")/../.."
DEST=${1:-"platform=iOS Simulator,name=iPhone 18 Pro"}
DD=${2:-ios/DerivedData}
xcodebuild build-for-testing -project ios/FlowAssert.xcodeproj -scheme FlowAssert -destination "$DEST" -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO -quiet || exit 1
for c in csv-1000000-rows workbook-3mb workbook-50mb; do
  stop=$(mktemp -u)
  python3 ios/scripts/peak_memory.py "$stop" > "ios/build/memory-$c.json" &
  sampler=$!
  TEST_RUNNER_FA_LARGE_CASE=$c xcodebuild test-without-building -project ios/FlowAssert.xcodeproj -scheme FlowAssert -destination "$DEST" \
    -derivedDataPath "$DD" -only-testing:FlowAssertTests/EngineParityTests/testLargeInputs 2>&1 | grep -E "^large |error:|Test Case.*(passed|failed)"
  touch "$stop"; wait $sampler; rm -f "$stop"
  echo "$c peak RSS MiB: $(cat ios/build/memory-$c.json)"
done
