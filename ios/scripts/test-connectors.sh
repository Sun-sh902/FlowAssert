#!/bin/zsh
# The app's connectors end to end, against the local fakes of Google Sheets and HubSpot (scripts/dev/serve_fakes.py),
# with synthetic credentials made up for this run. Nothing contacts Google or HubSpot.
#   ios/scripts/test-connectors.sh [DESTINATION] [DERIVED_DATA]
# 1. The command line checks the fakes' sheet against the fakes' contacts, plainly and with --export-dir: the expected
#    outputs, in ios/build/connector-expected/.
# 2. The app runs the same check (ConnectorEndToEndTests), compares, and searches what it wrote for the credentials.
# 3. The simulator's log of the app is searched for the credentials.
set -u
cd "$(dirname "$0")/../.."
DEST=${1:-"platform=iOS Simulator,name=iPhone 18 Pro"}
DD=${2:-ios/DerivedData}
PY=${FA_PYTHON:-python3}
SHEETS_TOKEN="fa-ios-sheets-synthetic-$(uuidgen)"
HUBSPOT_TOKEN="fa-ios-hubspot-synthetic-$(uuidgen)"
OUT=ios/build/connector-expected
rm -rf -- "${OUT:?}" && mkdir -p "$OUT"
printf '{\n  "key": [\n    "lead_id",\n    "lead_id"\n  ],\n  "fields": [\n    {\n      "source": "phone",\n      "destination": "phone",\n      "rule": "exact"\n    },\n    {\n      "source": "email",\n      "destination": "email",\n      "rule": "exact"\n    }\n  ],\n  "scope": "source"\n}\n' > "$OUT/configuration"

fakes() { # start the fakes for one check; sets ENV_FILE and FAKES
  ENV_FILE=$(mktemp); READY=$(mktemp -u)
  "$PY" scripts/dev/serve_fakes.py --sheets-token "$SHEETS_TOKEN" --hubspot-token "$HUBSPOT_TOKEN" --env-file "$ENV_FILE" --ready "$READY" --seconds 300 &
  FAKES=$!
  for i in {1..50}; do [[ -f "$READY" ]] && break; sleep 0.1; done
  source "$ENV_FILE"; export FLOWASSERT_SHEETS_TEST_ENDPOINT FLOWASSERT_HUBSPOT_TEST_ENDPOINT
}
cli() { # run the command line in $OUT/$1 with the extra arguments
  local dir="$OUT/$1"; shift; mkdir -p "$dir"
  (cd "$dir" && FLOWASSERT_SHEETS_TOKEN="$SHEETS_TOKEN" FLOWASSERT_HUBSPOT_TOKEN="$HUBSPOT_TOKEN" "$PY" ../../../../offline/verify.py \
    --source-sheet 1SyntheticSpreadsheet-FlowAssert_0001 --source-range 'Leads!A1:C4' --destination-hubspot contacts \
    --config ../configuration --source-complete --destination-complete "$@" > stdout.txt 2> stderr.txt; echo $? > exit_status.txt)
}
fakes; cli plain --json report.json --html report.html; kill $FAKES
fakes; cli exports --export-dir records-to-resend; kill $FAKES
cat "$OUT/plain/exit_status.txt" "$OUT/plain/stdout.txt"

fakes
started=$(date +"%Y-%m-%d %H:%M:%S")  # log show reads local time
TEST_RUNNER_FLOWASSERT_SHEETS_TEST_ENDPOINT=$FLOWASSERT_SHEETS_TEST_ENDPOINT TEST_RUNNER_FLOWASSERT_HUBSPOT_TEST_ENDPOINT=$FLOWASSERT_HUBSPOT_TEST_ENDPOINT \
TEST_RUNNER_FA_SHEETS_TOKEN=$SHEETS_TOKEN TEST_RUNNER_FA_HUBSPOT_TOKEN=$HUBSPOT_TOKEN \
  xcodebuild test -project ios/FlowAssert.xcodeproj -scheme FlowAssert -destination "$DEST" -derivedDataPath "$DD" \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= -only-testing:FlowAssertTests/ConnectorEndToEndTests > ios/build/connector-test.log 2>&1
code=$?
kill $FAKES
# The same check through the screens, against a fresh pair of fakes.
fakes
TEST_RUNNER_FLOWASSERT_SHEETS_TEST_ENDPOINT=$FLOWASSERT_SHEETS_TEST_ENDPOINT TEST_RUNNER_FLOWASSERT_HUBSPOT_TEST_ENDPOINT=$FLOWASSERT_HUBSPOT_TEST_ENDPOINT \
TEST_RUNNER_FA_SHEETS_TOKEN=$SHEETS_TOKEN TEST_RUNNER_FA_HUBSPOT_TOKEN=$HUBSPOT_TOKEN \
  xcodebuild test -project ios/FlowAssert.xcodeproj -scheme FlowAssert -destination "$DEST" -derivedDataPath "$DD" \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= -only-testing:FlowAssertUITests/ConnectorFormEndToEndTests >> ios/build/connector-test.log 2>&1
code=$(( code + $? ))
kill $FAKES
grep -E "Test Case.*(passed|failed)|error:" ios/build/connector-test.log
UDID=$(xcrun simctl list devices booted -j | "$PY" -c "import json,sys; d=json.load(sys.stdin)['devices']; print(next(x['udid'] for v in d.values() for x in v))")
xcrun simctl spawn "$UDID" log show --start "$started" --style compact --predicate 'process == "FlowAssert" OR process CONTAINS "WebKit"' > ios/build/connector-simulator.log 2>/dev/null
lines=$(grep -c "FlowAssert" ios/build/connector-simulator.log)
if [[ $lines -lt 1 ]]; then echo "The simulator's log of the app could not be read, so it was not searched"; exit 1; fi
if grep -q -e "$SHEETS_TOKEN" -e "$HUBSPOT_TOKEN" ios/build/connector-simulator.log ios/build/connector-test.log; then
  echo "A credential is in the simulator's log or the test's output"; exit 1
fi
echo "No credential in $(wc -l < ios/build/connector-simulator.log | tr -d ' ') lines of the simulator's log ($lines of the app) or in the test's output"
exit $code
