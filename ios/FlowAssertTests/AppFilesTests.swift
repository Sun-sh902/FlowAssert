import Foundation
import XCTest
@testable import FlowAssert

/// What the app writes and keeps: the reports and records to resend as the checker's bytes, kept reports unchanged,
/// and the example files the same as the command line's.
@MainActor
final class AppFilesTests: XCTestCase {
    static let repository = EngineParityTests.repository

    func exampleResult() async throws -> CheckResult {
        let engine = CheckerEngine()
        var request = CheckRequest(
            source: EngineFile(name: "source.csv", bytes: try Data(contentsOf: Self.repository.appendingPathComponent("offline/examples/source.csv")), encoding: "utf-8"),
            destination: EngineFile(name: "destination.csv", bytes: try Data(contentsOf: Self.repository.appendingPathComponent("offline/examples/destination.csv")), encoding: "utf-8"),
            config: .chosen(key: ("external_id", "external_id"), fields: [("phone", "phone", "exact"), ("email", "hs_email", "exact")], scope: "source"))
        request.sourceComplete = true
        request.destinationComplete = true
        request.exports = true
        request.openReport = true
        return try await engine.check(request)
    }

    func testSharedAndSavedFilesAreTheCheckersBytes() async throws {
        let result = try await exampleResult()
        let json = try XCTUnwrap(result.json)
        let shared = SharedFiles()
        XCTAssertEqual(try Data(contentsOf: shared.url(json, "flowassert-report.json")), Data(json.utf8))
        for export in try XCTUnwrap(result.exports) {
            let bytes = try Data(contentsOf: shared.url(export.text, export.file))
            XCTAssertEqual(Array(bytes.prefix(3)), [0xEF, 0xBB, 0xBF], "\(export.file) begins with its byte order mark")
            XCTAssertEqual(bytes, Data(export.text.utf8))
        }
        let saved = ExactFile(name: "flowassert-report.html", bytes: Data(try XCTUnwrap(result.html).utf8))
        XCTAssertEqual(saved.bytes, Data(result.html!.utf8))
    }

    func testAKeptReportIsKeptAsItsBytesAndReopenedByTheReader() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = ReportStore(folder: folder)
        let result = try await exampleResult()
        let bytes = Data(try XCTUnwrap(result.json).utf8)
        let entry = try XCTUnwrap(store.keep(bytes, report: try XCTUnwrap(result.report), imported: false, name: "flowassert-report.json"))
        XCTAssertEqual(store.bytes(of: entry), bytes)
        XCTAssertEqual(ReportStore(folder: folder).entries, [entry], "the list survives a restart")
        guard case .opened(let report) = try await CheckerEngine().open(bytes, name: entry.name) else { return XCTFail("refused") }
        XCTAssertEqual(report.cohort, "Mismatch")
        store.delete(entry)
        XCTAssertTrue(store.entries.isEmpty)
        XCTAssertNil(store.bytes(of: entry))
        store.keep(bytes, report: report, imported: true, name: "a.json")
        store.keep(bytes, report: report, imported: true, name: "b.json")
        store.deleteAll()
        XCTAssertTrue(store.entries.isEmpty)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path), [])
    }

    func testTheExampleFilesAreTheCommandLinesFirstExample() throws {
        for (bundled, original) in [("example-source", "offline/examples/source.csv"), ("example-destination", "offline/examples/destination.csv")] {
            let url = try XCTUnwrap(Bundle.main.url(forResource: bundled, withExtension: "csv"))
            XCTAssertEqual(try Data(contentsOf: url), try Data(contentsOf: Self.repository.appendingPathComponent(original)))
        }
    }

    /// FlowAssert is English only (since 1.1.0): no Chinese text in the app's sources, so none on its screens.
    func testTheAppsTextIsEnglishOnly() throws {
        let sources = Self.repository.appendingPathComponent("ios/FlowAssert")
        let chinese = try NSRegularExpression(pattern: "[\u{3000}-\u{303F}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{F900}-\u{FAFF}\u{FF01}-\u{FF60}]")
        let files = FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil)!.compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" || $0.pathExtension == "html" || $0.lastPathComponent == "host.js" || $0.pathExtension == "plist" }
        XCTAssertGreaterThan(files.count, 10)
        for file in files {
            let text = try String(contentsOf: file, encoding: .utf8)
            XCTAssertNil(chinese.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)), file.lastPathComponent)
        }
    }

    /// The privacy manifest the app is built with: no tracking, no tracking domains, no data collected, and no API that
    /// needs a declared reason.
    func testThePrivacyManifestSaysNoTrackingAndNoDataCollected() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"), "PrivacyInfo.xcprivacy is in the app")
        let manifest = try XCTUnwrap(try PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil) as? [String: Any])
        XCTAssertEqual(manifest["NSPrivacyTracking"] as? Bool, false)
        for key in ["NSPrivacyTrackingDomains", "NSPrivacyCollectedDataTypes", "NSPrivacyAccessedAPITypes"] {
            XCTAssertEqual((manifest[key] as? [Any])?.count, 0, key)
        }
        XCTAssertEqual(Set(manifest.keys), ["NSPrivacyTracking", "NSPrivacyTrackingDomains", "NSPrivacyCollectedDataTypes", "NSPrivacyAccessedAPITypes"])
    }
}
