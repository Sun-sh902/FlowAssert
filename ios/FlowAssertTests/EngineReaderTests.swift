import Foundation
import XCTest
@testable import FlowAssert

/// The app's readers (flowassert-app.js) in the app's WebKit: what the screens show before a check and after it.
@MainActor
final class EngineReaderTests: XCTestCase {
    static let repository = EngineParityTests.repository

    static func data(_ path: String) throws -> Data {
        try Data(contentsOf: repository.appendingPathComponent(path))
    }

    func testTheProfileOfACsvFileAndOfAFileACheckWouldRefuse() async throws {
        let engine = CheckerEngine()
        let ok = try await engine.profile(EngineFile(name: "source.csv", bytes: try Self.data("offline/examples/source.csv"), encoding: "utf-8"))
        XCTAssertTrue(ok.ok)
        XCTAssertEqual(ok.profile?.rows, 4)
        XCTAssertEqual(ok.profile?.columns.map(\.name), ["external_id", "phone", "email"])
        let refused = try await engine.profile(EngineFile(name: "source.csv", bytes: try Self.data("offline/golden/decode-utf8-invalid/source.csv"), encoding: "utf-8"))
        XCTAssertFalse(refused.ok)
        XCTAssertEqual(refused.message.map { "refused: \($0)\n" }, try String(contentsOf: Self.repository.appendingPathComponent("offline/golden/decode-utf8-invalid/stderr.txt"), encoding: .utf8))
    }

    func testAWorkbooksSheetsAreListedBeforeAnyIsRead() async throws {
        let engine = CheckerEngine()
        let listed = try await engine.sheets(EngineFile(name: "source.xlsx", bytes: try Self.data("offline/golden-xlsx/xlsx-refused-several-sheets/source.xlsx"), format: "xlsx"))
        XCTAssertEqual(listed.sheets?.map(\.name), ["Summary", "Contacts", "Notes"])
        let profile = try await engine.profile(EngineFile(name: "source.xlsx", bytes: try Self.data("offline/golden-xlsx/xlsx-refused-several-sheets/source.xlsx"), format: "xlsx", worksheet: "Contacts"))
        XCTAssertEqual(profile.profile?.workbook?.worksheet, "Contacts")
    }

    func testTheConfigurationIsWrittenAsTheCsvCheckPageWritesIt() async throws {
        let engine = CheckerEngine()
        let text = try await engine.configuration(key: ("external_id", "external_id"), fields: [("phone", "phone", "exact"), ("email", "hs_email", "exact")], scope: "source")
        XCTAssertEqual(Data(text.utf8), try Self.data("offline/golden/example-page/config.json"))
    }

    func testAReportIsOpenedWithTheSavedReportReaderAndAnythingElseIsRefused() async throws {
        let engine = CheckerEngine()
        guard case .opened(let report) = try await engine.open(try Self.data("offline/golden/example/report.json"), name: "report.json") else {
            return XCTFail("the golden report was refused")
        }
        XCTAssertEqual(report.cohort, "Mismatch")
        XCTAssertEqual(report.counts["Mismatch"], 3)
        XCTAssertEqual(report.rules, ["existence", "uniqueness", "field:phone", "field:email"])
        let matched = try await engine.query(report.id, state: "not-verified", rule: nil, status: nil, search: "")
        XCTAssertEqual(matched.matches, 3)
        let items = try await engine.window(report.id, start: 0, count: 10)
        XCTAssertEqual(items.map(\.record.key), ["SYN-002", "SYN-003", "SYN-004"])
        XCTAssertEqual(items.first?.record.rules?["field:phone"]?.actual, "+1 212 555 0199")
        await engine.release(report: report.id)

        let refused = try await engine.open(Data("{\"schema_version\": 9}".utf8), name: "other.json")
        guard case .refused(_, let message) = refused else { return XCTFail("a file that is not a report was opened") }
        XCTAssertTrue(message.hasPrefix("other.json: "), message)
    }

    func testTheResultOfACheckIsReadFromItsReport() async throws {
        let engine = CheckerEngine()
        var request = CheckRequest(
            source: EngineFile(name: "source.csv", bytes: try Self.data("offline/examples/source.csv"), encoding: "utf-8"),
            destination: EngineFile(name: "destination.csv", bytes: try Self.data("offline/examples/destination.csv"), encoding: "utf-8"),
            config: .chosen(key: ("external_id", "external_id"), fields: [("phone", "phone", "exact"), ("email", "hs_email", "exact")], scope: "source"))
        request.sourceComplete = true
        request.destinationComplete = true
        request.exports = true
        request.openReport = true
        let result = try await engine.check(request)
        XCTAssertEqual(result.report?.cohort, result.state)
        XCTAssertEqual(result.report?.counts["Verified"], 1)
        XCTAssertEqual(result.exports?.map(\.file), ["missing-from-destination.csv", "values-differ.csv", "duplicated-in-destination.csv"])
    }

    func testTheDiffDrawsInvisibleCharactersAsTokens() async throws {
        let engine = CheckerEngine()
        let diff = try await engine.diff("a b", "a\u{00A0}b")
        XCTAssertEqual(diff.notes, ["nfkc"])
        let tokens = diff.destination.flatMap(\.pieces).filter { $0.token == true }.map(\.text)
        XCTAssertEqual(tokens, ["NBSP"])
    }
}
