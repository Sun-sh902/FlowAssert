# FlowAssert for iPhone and iPad

The app runs the same check as the command line, on the device. It has no checker of its own: it runs the packaged
checker, `flowassert-check.js`, in a hidden WebKit view, and its parity tests hold every golden case to the command
line's result byte for byte. The [design note](../docs/design/1.2-ios-app.md) explains how it is built, what the owner
chose, and the measurements.

Released in 1.2.0 as source: it is not on the App Store or TestFlight, and is built from source with Xcode.

## What it needs

- A Mac with Xcode 26 or later (the icon is a layered Icon Composer file; tested with Xcode 27.2).
- iPhone or iPad with iOS 17 or later. On iOS 26 and later the app uses the system's Liquid Glass.
- Node 24 or later, to build the checker the app holds. Python 3 only for the tests.

## Build and run on a simulator

The app holds two scripts built from `ui/`: the packaged checker and the browser's readers. Build them and copy them
in (the copies are committed; CI fails when they are not these builds):

```bash
cd ui && npm ci && npm run build:lib && npm run build:app && cd ..
```

```bash
node ios/scripts/checker.mjs
```

Then open `ios/FlowAssert.xcodeproj`, choose the FlowAssert scheme and an iPhone or iPad simulator, and run.

## Install it on your iPhone with a free Apple account

A paid Apple Developer Program membership is not needed to run the app on your own device:

1. In Xcode, Settings → Accounts, add your Apple Account. Xcode makes a Personal Team for it.
2. Select the FlowAssert target → Signing & Capabilities. Choose your Personal Team, and change the bundle identifier
   to one of your own (for example `com.example.yourname.flowassert`): `io.github.sunsh902.flowassert` belongs to the
   project's team.
3. Connect the iPhone, unlock it, choose it as the run destination, and run. The first time, turn on Developer Mode on
   the iPhone (Settings → Privacy & Security → Developer Mode) and restart it when asked.
4. If the iPhone says the developer is not trusted: Settings → General → VPN & Device Management → your Apple Account
   → Trust.

**The seven-day limit.** An app signed by a Personal Team stops opening after seven days, when its provisioning profile
expires. Run it again from Xcode with the iPhone connected to install it again. Reinstalling over the app keeps what
it holds (kept reports, credentials in the Keychain); deleting the app removes them.

## Tests

On an iPhone simulator and an iPad simulator, as CI runs them (`python3 ios/scripts/simulators.py --names` names the
newest iPhone and the iPad your Xcode has; put their names in the destinations):

```bash
node ios/scripts/engine-cases.mjs
```

```bash
xcodebuild test -project ios/FlowAssert.xcodeproj -scheme FlowAssert -destination "platform=iOS Simulator,name=iPhone 18 Pro" -destination "platform=iOS Simulator,name=iPad Pro 11-inch (M5)" CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=
```

The build is signed ad hoc (no certificate, no team): unsigned, every Keychain call fails, and the credential tests
cannot run. `scripts/dev/test-inventory.json` lists every test; `scripts/dev/check_test_inventory.py ios` checks a run
against it from `xcrun xcresulttool get test-results tests`.

| Script | What it does |
| --- | --- |
| `ios/scripts/checker.mjs` | Copies the two builds into the app; `--check` fails when a copy is not its build |
| `ios/scripts/engine-cases.mjs` | Writes the engine cases and what Node and the command line give for each; `--large` adds 1,000,000-row files and a 50 MB workbook |
| `ios/scripts/test-connectors.sh` | Starts the local fakes of Google Sheets and HubSpot and checks the app against them, through the engine and through the screens, then searches the app's files and log for the made-up credentials |
| `ios/scripts/measure-layout.sh` | Records every screen's frames and checks the pixel grid, the margins and edges that nearly line up |
| `ios/scripts/measure-performance.sh` | Measures launch, opening a 50 MB workbook and scrolling a 100,000-record report |
| `ios/scripts/simulators.py` | Names the newest iPhone simulator and an iPad simulator for `xcodebuild` |

## Privacy

`FlowAssert/PrivacyInfo.xcprivacy`: no tracking and no data collected. Files, reports and credentials stay on the
device; credentials are kept in the Keychain, for this device only, and are never shown again. The app sends a request
only when you start a read of a Google Sheets range (`sheets.googleapis.com`, `www.googleapis.com`) or of HubSpot
contacts (`api.hubapi.com`), and to no other host.
