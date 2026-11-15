import XCTest

/// The three numbers step 5 asks for, measured on the device the tests run on: launch, opening a 50 MB workbook, and
/// scrolling the list of a 100,000-record report. Run by ios/scripts/measure-performance.sh, which writes the files and
/// passes their paths (FA_PERF_WORKBOOK, FA_PERF_REPORT); skipped otherwise. They assert nothing: XCTest prints the
/// averages and the script collects them.
final class PerformanceTests: XCTestCase {
    var environment: [String: String] { ProcessInfo.processInfo.environment }
    let subsystem = "io.github.sunsh902.flowassert"

    func app(_ arguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uitestReset", "YES"] + arguments
        return app
    }

    func testLaunch() throws {
        guard environment["FA_PERF"] != nil else { throw XCTSkip("run ios/scripts/measure-performance.sh") }
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)], options: options) {
            app().launch()
        }
    }

    func testOpeningA50MBWorkbook() throws {
        guard let workbook = environment["FA_PERF_WORKBOOK"] else { throw XCTSkip("run ios/scripts/measure-performance.sh") }
        let options = XCTMeasureOptions()
        options.iterationCount = 3
        options.invocationOptions = [.manuallyStop]
        measure(metrics: [XCTOSSignpostMetric(subsystem: subsystem, category: "performance", name: "Open file"), XCTMemoryMetric()], options: options) {
            let app = app(["-uitest-source", workbook])
            app.launch()
            let profile = app.descendants(matching: .any)["profile-rows"].firstMatch
            XCTAssertTrue(profile.waitForExistence(timeout: 180), "the workbook's profile")
            stopMeasuring()
            app.terminate()
        }
    }

    func testScrollingA100000RecordList() throws {
        guard let report = environment["FA_PERF_REPORT"] else { throw XCTSkip("run ios/scripts/measure-performance.sh") }
        let app = app(["-uitest-open", report])
        app.launch()
        let keep = app.buttons["A report to keep"].firstMatch
        XCTAssertTrue(keep.waitForExistence(timeout: 30))
        keep.tap()
        let entry = app.buttons.matching(NSPredicate(format: "label CONTAINS 'report-100000.json'")).firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout: 120))
        entry.tap()
        XCTAssertTrue(app.descendants(matching: .any)["verdict"].firstMatch.waitForExistence(timeout: 120))
        let all = app.buttons["records-all"]
        var tries = 0
        while !(all.exists && all.isHittable) && tries < 12 { app.swipeUp(); tries += 1 }
        all.tap()
        XCTAssertTrue(app.staticTexts["records-count"].waitForExistence(timeout: 60))
        let list = app.collectionViews.firstMatch
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric], options: options) {
            list.swipeUp(velocity: .fast)
            list.swipeUp(velocity: .fast)
        }
    }
}
