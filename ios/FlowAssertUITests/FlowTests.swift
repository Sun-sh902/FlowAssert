import XCTest

/// Each flow of the app on the device it runs on (CI runs it on an iPhone and an iPad simulator), driven as a person
/// would, with the accessibility labels VoiceOver reads checked: the verdict is always read first. Files come from the
/// repository through debug-only launch arguments, because a test cannot drive the system's Files picker.
final class FlowTests: XCTestCase {
    static let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
    }

    func launch(_ arguments: [String: String] = [:]) {
        app = XCUIApplication()
        app.launchArguments = ["-uitestReset", "YES"] + arguments.flatMap { ["-\($0.key)", Self.repository.appendingPathComponent($0.value).path] }
        app.launch()
    }

    /// Scrolls the form in short drags, down then up, until the element is on screen and clear of the floating
    /// controls (the tab bar above, the Check button below), so that a tap reaches it and nothing over it. A list keeps
    /// only the rows on screen, so a long swipe can pass a row without its ever existing.
    @discardableResult
    func reveal(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        let window = app.windows.firstMatch
        let height = window.frame.height
        func clear() -> Bool { element.exists && element.isHittable && element.frame.minY > 120 && element.frame.maxY < height - 160 }
        func drag(_ from: CGFloat, _ to: CGFloat) {
            window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: from))
                .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: to)))
        }
        for (from, to) in [(0.55, 0.35), (0.35, 0.55)] {
            var tries = 0
            while !clear() && tries < 40 {
                drag(from, to)
                tries += 1
            }
            if clear() { break }
        }
        XCTAssertTrue(clear(), "\(element) not found clear of the floating controls", file: file, line: line)
        return element
    }

    func pick(_ identifier: String, _ value: String) {
        reveal(app.buttons[identifier]).tap()
        let item = app.buttons[value].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "\(value) is not offered by \(identifier)")
        item.tap()
    }

    func toggle(_ identifier: String) {
        let element = reveal(app.switches[identifier])
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
    }

    func chooseExampleColumns() {
        pick("key-source", "external_id")
        pick("key-destination", "external_id")
        pick("field-1-source", "phone")
        pick("field-1-destination", "phone")
        reveal(app.buttons["add-field"]).tap()
        pick("field-2-source", "email")
        pick("field-2-destination", "hs_email")
    }

    func openTab(_ name: String) {
        let tab = app.buttons[name].firstMatch
        XCTAssertTrue(tab.waitForExistence(timeout: 5))
        tab.tap()
    }

    // MARK: Flows

    func testTheExampleCheckShowsTheReportsVerdictRecordsAndValues() {
        launch()
        app.buttons["use-example"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["source-file"].waitForExistence(timeout: 20) || app.otherElements["source-file"].waitForExistence(timeout: 1))
        let source = app.descendants(matching: .any)["source-file"].firstMatch
        XCTAssertEqual(source.label, "Source: source.csv, CSV · 194 bytes")
        chooseExampleColumns()
        toggle("source-complete")
        toggle("destination-complete")
        app.buttons["run-check"].tap()

        let verdict = app.descendants(matching: .any)["verdict"].firstMatch
        XCTAssertTrue(verdict.waitForExistence(timeout: 30))
        XCTAssertEqual(verdict.label, "Mismatch. Mismatch: 4 rows of 4. Verified 1 · Mismatch 3 · Unverified 0. No claim is made: the result is not Verified.")

        reveal(app.buttons["records-not-verified"]).tap()
        let count = app.staticTexts["records-count"]
        XCTAssertTrue(count.waitForExistence(timeout: 10))
        XCTAssertEqual(count.label, "3 of 4 records match")
        let first = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Mismatch. Row 2, key SYN-002'")).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 10))
        first.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS '+1 212 555 0199'")).firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["field:phone"].exists)

        app.buttons["BackButton"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["records-count"].waitForExistence(timeout: 5))
        app.buttons["BackButton"].firstMatch.tap()
        reveal(app.buttons["keep-report"]).tap()
        XCTAssertTrue(app.buttons["keep-report"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["keep-report"].label, "Kept on this device")

        openTab("Saved reports")
        let kept = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Mismatch. flowassert-report.json'")).firstMatch
        XCTAssertTrue(kept.waitForExistence(timeout: 10))
        kept.tap()
        let reopened = app.descendants(matching: .any)["verdict"].firstMatch
        XCTAssertTrue(reopened.waitForExistence(timeout: 20))
        XCTAssertTrue(reopened.label.hasPrefix("Mismatch. Mismatch: 4 rows of 4."), reopened.label)
    }

    func testARefusalShowsTheCheckersMessageAndNoResult() {
        launch()
        app.buttons["use-example"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["destination-file"].firstMatch.waitForExistence(timeout: 20))
        pick("key-source", "external_id")
        pick("key-destination", "external_id")
        pick("field-1-source", "phone")
        pick("field-1-destination", "phone")
        reveal(app.buttons["add-field"]).tap()
        pick("field-2-source", "phone")
        pick("field-2-destination", "hs_email")
        app.buttons["run-check"].tap()
        let verdict = app.descendants(matching: .any)["verdict"].firstMatch
        XCTAssertTrue(verdict.waitForExistence(timeout: 30))
        XCTAssertTrue(verdict.label.hasPrefix("refused"), verdict.label)
        XCTAssertTrue(verdict.label.contains("refused: "), verdict.label)
        XCTAssertFalse(app.buttons["records-all"].exists)
    }

    func testAWorkbookWithSeveralSheetsIsReadOnlyAfterAWorksheetIsChosen() {
        launch(["uitest-source": "offline/golden-xlsx/xlsx-refused-several-sheets/source.xlsx",
                "uitest-destination": "offline/golden-xlsx/xlsx-refused-several-sheets/destination.csv"])
        let source = app.descendants(matching: .any)["source-file"].firstMatch
        XCTAssertTrue(source.waitForExistence(timeout: 20))
        XCTAssertTrue(source.label.hasPrefix("Source: source.xlsx, Excel workbook"), source.label)
        let waiting = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Nothing is read until you choose one'")).firstMatch
        XCTAssertTrue(waiting.waitForExistence(timeout: 20))
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "profile-rows").count, 1, "only the destination is profiled")
        pick("source-worksheet", "Contacts (hidden)")
        XCTAssertFalse(waiting.waitForExistence(timeout: 3))
        // The source's own profile: the worksheet it read, as the checker's profile names it.
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Contacts' OR value == 'Contacts' OR label == 'Worksheet, Contacts'")).firstMatch.waitForExistence(timeout: 20))
    }

    func testAFileOpenedFromAnotherAppAsksWhichSideItIs() {
        launch(["uitest-open": "offline/examples/source.csv"])
        let source = app.buttons["The source"].firstMatch
        XCTAssertTrue(source.waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["A report to keep"].exists)
        source.tap()
        let file = app.descendants(matching: .any)["source-file"].firstMatch
        XCTAssertTrue(file.waitForExistence(timeout: 20))
        XCTAssertEqual(file.label, "Source: source.csv, CSV · 194 bytes")
    }

    func testAReportOpenedFromAnotherAppIsReadAndKept() {
        launch(["uitest-open": "offline/golden/example/report.json"])
        let keep = app.buttons["A report to keep"].firstMatch
        XCTAssertTrue(keep.waitForExistence(timeout: 20))
        keep.tap()
        let entry = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Mismatch. report.json' AND label CONTAINS 'imported'")).firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout: 20))
        entry.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'This report was imported. It is not authenticated'")).firstMatch.waitForExistence(timeout: 20))
    }

    func testAFileThatIsNotAReportIsRefusedAndNothingIsKept() {
        launch(["uitest-open": "offline/golden/example/case.json"])
        let keep = app.buttons["A report to keep"].firstMatch
        XCTAssertTrue(keep.waitForExistence(timeout: 20))
        keep.tap()
        XCTAssertTrue(app.alerts["Not a FlowAssert report"].waitForExistence(timeout: 20))
        app.alerts.buttons["OK"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'No report is kept on this device'")).firstMatch.waitForExistence(timeout: 5))
    }
}
