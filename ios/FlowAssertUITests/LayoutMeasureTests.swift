import XCTest

/// Records the frame of every element on each screen, for ios/scripts/measure-layout.py, which checks the margins, the
/// pixel grid and edges that nearly line up. Runs only when FA_MEASURE is set (the script sets it); it asserts nothing.
final class LayoutMeasureTests: XCTestCase {
    static let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    var app: XCUIApplication!

    func launch(_ arguments: [String: String] = [:]) {
        app = XCUIApplication()
        app.launchArguments = ["-uitestReset", "YES"] + arguments.flatMap { ["-\($0.key)", Self.repository.appendingPathComponent($0.value).path] }
        app.launch()
    }

    /// One line per screen: its name, the screen's scale, the window and each element with a frame on screen.
    func record(_ screen: String) {
        sleep(1)
        guard let snapshot = try? app.snapshot() else { return }
        let scale = XCUIScreen.main.screenshot().image.scale
        var elements: [[String: Any]] = []
        func walk(_ s: XCUIElementSnapshot, depth: Int) {
            let f = s.frame
            if !f.isEmpty {
                elements.append(["type": s.elementType.rawValue, "id": s.identifier, "label": String(s.label.prefix(60)),
                                 "x": f.minX, "y": f.minY, "w": f.width, "h": f.height, "depth": depth,
                                 "leaf": s.children.isEmpty])
            }
            for child in s.children { walk(child, depth: depth + 1) }
        }
        walk(snapshot, depth: 0)
        let window = app.windows.firstMatch.frame
        let line: [String: Any] = ["screen": screen, "scale": scale, "width": window.width, "height": window.height, "elements": elements]
        if let data = try? JSONSerialization.data(withJSONObject: line), let text = String(data: data, encoding: .utf8) {
            print("FA-LAYOUT " + text)
        }
    }

    func scrollAndRecord(_ screen: String, pages: Int) {
        record(screen + " 1")
        let window = app.windows.firstMatch
        for page in 2...max(2, pages) {
            window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
                .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)))
            record("\(screen) \(page)")
        }
    }

    func tapWhenThere(_ element: XCUIElement) {
        XCTAssertTrue(element.waitForExistence(timeout: 20), "\(element)")
        element.tap()
    }

    func testMeasureEveryScreen() throws {
        guard ProcessInfo.processInfo.environment["FA_MEASURE"] != nil else { throw XCTSkip("run ios/scripts/measure-layout.sh") }
        launch()
        record("Check, empty")
        app.buttons["use-example"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["destination-file"].firstMatch.waitForExistence(timeout: 20))
        scrollAndRecord("Check, example", pages: 6)

        launch(["uitest-open": "offline/golden/example/report.json"])
        tapWhenThere(app.buttons["A report to keep"].firstMatch)
        tapWhenThere(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Mismatch. report.json'")).firstMatch)
        XCTAssertTrue(app.descendants(matching: .any)["verdict"].firstMatch.waitForExistence(timeout: 20))
        scrollAndRecord("Result", pages: 6)
        let records = app.buttons["records-not-verified"]
        var tries = 0
        while !(records.exists && records.isHittable) && tries < 12 {
            app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
                .press(forDuration: 0.05, thenDragTo: app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6)))
            tries += 1
        }
        records.tap()
        XCTAssertTrue(app.staticTexts["records-count"].waitForExistence(timeout: 10))
        record("Records")
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Mismatch. Row'")).firstMatch.tap()
        sleep(1)
        scrollAndRecord("Record", pages: 2)

        launch()
        app.buttons["Saved reports"].firstMatch.tap()
        record("Saved reports, empty")
        app.buttons["Credentials"].firstMatch.tap()
        scrollAndRecord("Credentials", pages: 2)
    }
}
