import XCTest

/// The connectors' screens on the device the tests run on: credentials kept and never shown again, and the check form
/// with a sheet as its source and HubSpot as its destination. No request is sent: ConnectorEndToEndTests runs a check
/// against the local fakes.
final class ConnectorFlowTests: XCTestCase {
    var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-uitestReset", "YES"]
        app.launch()
    }

    override func tearDown() {
        // Leave no credential behind for the next test.
        app.terminate()
        let reset = XCUIApplication()
        reset.launchArguments = ["-uitestReset", "YES"]
        reset.launch()
        reset.terminate()
    }

    func openTab(_ name: String) {
        let tab = app.buttons[name].firstMatch
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()
    }

    func testACredentialIsRefusedInTheCommandLinesWordsOrKeptAndNeverShownAgain() {
        openTab("Credentials")
        let field = app.secureTextFields["hubspot-token-field"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("two words")
        app.buttons["hubspot-token-save"].tap()
        let problem = app.staticTexts["credential-problem"]
        XCTAssertTrue(problem.waitForExistence(timeout: 5))
        XCTAssertEqual(problem.label, "FLOWASSERT_HUBSPOT_TOKEN does not hold a credential: printable ASCII without spaces, at most 4096 characters")

        let secret = "pat-synthetic-ui-FA-not-a-real-credential"
        field.tap()
        field.typeText(secret)
        app.buttons["hubspot-token-save"].tap()
        let saved = app.descendants(matching: .any)["hubspot-token-saved"].firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        XCTAssertTrue(saved.label.contains("Saved"), saved.label)
        XCTAssertFalse(app.secureTextFields["hubspot-token-field"].exists)
        XCTAssertEqual(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", secret, secret)).count, 0)

        openTab("Check")
        let kind = app.segmentedControls["destination-kind"]
        // Hosted CI machines are slow; the tab is drawn when the main thread is free.
        XCTAssertTrue(kind.waitForExistence(timeout: 15))
        kind.buttons["HubSpot contacts"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Saved: a private app access token'")).firstMatch.waitForExistence(timeout: 5))

        openTab("Credentials")
        app.buttons["hubspot-token-remove"].tap()
        XCTAssertTrue(app.secureTextFields["hubspot-token-field"].waitForExistence(timeout: 5))
    }

    func testTheFormTakesASheetRangeAndHubSpotWithTypedColumns() {
        let source = app.segmentedControls["source-kind"]
        XCTAssertTrue(source.waitForExistence(timeout: 10))
        source.buttons["Google Sheets"].tap()
        let id = app.textFields["spreadsheet-id"]
        XCTAssertTrue(id.waitForExistence(timeout: 5))
        id.tap()
        id.typeText("1SyntheticSpreadsheet-FlowAssert_0001")
        let range = app.textFields["sheet-range"]
        range.tap()
        range.typeText("Leads!A1:C4\n")
        // The row is drawn once the keyboard has gone: wait for it, as for every other element here.
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'No credential saved'")).firstMatch.waitForExistence(timeout: 10))
        let destination = app.segmentedControls["destination-kind"]
        var scrolls = 0
        while !(destination.exists && destination.isHittable && destination.frame.maxY < app.windows.firstMatch.frame.height - 160) && scrolls < 15 {
            app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55))
                .press(forDuration: 0.05, thenDragTo: app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35)))
            scrolls += 1
        }
        destination.buttons["HubSpot contacts"].tap()
        // Without files there is nothing to list columns from: the key and the fields are typed.
        XCTAssertFalse(app.staticTexts["Choose a source file."].exists)
        XCTAssertFalse(app.staticTexts["Choose a destination file."].exists)
        let typed = app.textFields.matching(NSPredicate(format: "placeholderValue == 'Column'"))
        var tries = 0
        while typed.count < 2 && tries < 10 { app.swipeUp(velocity: .slow); tries += 1 }
        XCTAssertGreaterThanOrEqual(typed.count, 2, "the two key columns are typed")
        XCTAssertFalse(app.buttons["run-check"].isEnabled, "nothing to check until the key and a field are typed")
    }
}

/// The same check as ConnectorEndToEndTests, driven through the screens against the local fakes; run by
/// ios/scripts/test-connectors.sh, which starts the fakes and makes up the credentials.
final class ConnectorFormEndToEndTests: XCTestCase {
    func testACheckFromTheFormAgainstTheLocalFakes() throws {
        let env = ProcessInfo.processInfo.environment
        guard let sheets = env["FA_SHEETS_TOKEN"], let hubspot = env["FA_HUBSPOT_TOKEN"],
              let sheetsEndpoint = env["FLOWASSERT_SHEETS_TEST_ENDPOINT"], let hubspotEndpoint = env["FLOWASSERT_HUBSPOT_TEST_ENDPOINT"] else {
            throw XCTSkip("run ios/scripts/test-connectors.sh, which starts the local fakes")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-uitestReset", "YES"]
        app.launchEnvironment = ["FLOWASSERT_SHEETS_TEST_ENDPOINT": sheetsEndpoint, "FLOWASSERT_HUBSPOT_TEST_ENDPOINT": hubspotEndpoint]
        app.launch()
        defer {
            app.terminate()
            let reset = XCUIApplication()
            reset.launchArguments = ["-uitestReset", "YES"]
            reset.launch()
            reset.terminate()
        }
        let window = app.windows.firstMatch
        func drag(_ from: CGFloat, _ to: CGFloat) {
            window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: from)).press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: to)))
        }
        func reveal(_ element: XCUIElement) -> XCUIElement {
            func clear() -> Bool { element.exists && element.isHittable && element.frame.minY > 120 && element.frame.maxY < window.frame.height - 160 }
            for (from, to) in [(0.55, 0.35), (0.35, 0.55)] {
                var tries = 0
                while !clear() && tries < 30 { drag(from, to); tries += 1 }
                if clear() { break }
            }
            return element
        }

        app.buttons["Credentials"].firstMatch.tap()
        for (field, value) in [("sheets-token-field", sheets), ("hubspot-token-field", hubspot)] {
            let f = app.secureTextFields[field]
            XCTAssertTrue(f.waitForExistence(timeout: 10))
            f.tap()
            f.typeText(value)
            app.buttons[field.replacingOccurrences(of: "-field", with: "-save")].tap()
        }
        XCTAssertTrue(app.descendants(matching: .any)["hubspot-token-saved"].firstMatch.waitForExistence(timeout: 5))

        app.buttons["Check"].firstMatch.tap()
        XCTAssertTrue(app.segmentedControls["source-kind"].waitForExistence(timeout: 10))
        app.segmentedControls["source-kind"].buttons["Google Sheets"].tap()
        for (id, text) in [("spreadsheet-id", "1SyntheticSpreadsheet-FlowAssert_0001"), ("sheet-range", "Leads!A1:C4")] {
            let f = app.textFields[id]
            f.tap()
            f.typeText(text + "\n")
        }
        reveal(app.segmentedControls["destination-kind"]).buttons["HubSpot contacts"].tap()
        reveal(app.buttons["add-field"]).tap()
        // The typed columns: the key in each, then each field's source and destination.
        for (id, name) in [("key-source", "lead_id"), ("key-destination", "lead_id"), ("field-1-source", "phone"), ("field-1-destination", "phone"),
                           ("field-2-source", "email"), ("field-2-destination", "email")] {
            let f = reveal(app.textFields[id])
            var tries = 0
            // The field shares its row with its label; the typed text sits at its trailing end.
            repeat {
                f.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
                tries += 1
            } while !((f.value(forKey: "hasKeyboardFocus") as? Bool) ?? false) && tries < 5
            f.typeText(name + "\n")
        }
        for id in ["source-complete", "destination-complete"] {
            reveal(app.switches[id]).coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        }
        app.buttons["run-check"].tap()
        let verdict = app.descendants(matching: .any)["verdict"].firstMatch
        XCTAssertTrue(verdict.waitForExistence(timeout: 30))
        XCTAssertEqual(verdict.label, "Mismatch. Mismatch: 3 rows of 3. Verified 1 · Mismatch 2 · Unverified 0. No claim is made: the result is not Verified.")
    }
}
