import Foundation
import XCTest
@testable import FlowAssert

/// A check whose source is a Google Sheets range and whose destination is HubSpot's contacts, run by the app against
/// the local fakes of both services (ios/scripts/test-connectors.sh starts them, with synthetic credentials made up for
/// the run, and runs the command line first for the expected outputs). The result must be the command line's, and the
/// credentials must be nowhere but in the Keychain and the requests: not in anything handed to JavaScript, the result,
/// the reports, the records to resend, UserDefaults or any file the app wrote.
@MainActor
final class ConnectorEndToEndTests: XCTestCase {
    static let expected = EngineParityTests.repository.appendingPathComponent("ios/build/connector-expected")

    /// Times of the check and of the reads, which no two runs share.
    static func timeless(_ text: String?) -> String? {
        text?.replacing(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{6})?Z/, with: "TIME")
    }

    func testASheetAgainstHubSpotGivesTheCommandLinesResultAndTheCredentialsStayInTheKeychain() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let sheetsToken = env["FA_SHEETS_TOKEN"], let hubspotToken = env["FA_HUBSPOT_TOKEN"], env["FLOWASSERT_SHEETS_TEST_ENDPOINT"] != nil else {
            throw XCTSkip("run ios/scripts/test-connectors.sh, which starts the local fakes")
        }
        let store = CredentialStore()
        try store.save(sheetsToken, as: .sheetsToken)
        try store.save(hubspotToken, as: .hubspotToken)
        defer { for kind in CredentialKind.allCases { try? store.remove(kind) } }

        let engine = CheckerEngine(credentials: store)
        var request = CheckRequest(source: EngineFile(name: "", bytes: Data()), destination: EngineFile(name: "", bytes: Data()),
                                   config: .chosen(key: ("lead_id", "lead_id"), fields: [("phone", "phone", "exact"), ("email", "email", "exact")], scope: "source"))
        request.sourceSheet = SheetChoice(spreadsheetId: "1SyntheticSpreadsheet-FlowAssert_0001", range: "Leads!A1:C4")
        request.destinationHubspot = HubSpotChoice()
        request.sourceComplete = true
        request.destinationComplete = true
        request.exports = true
        request.openReport = true
        let result = try await engine.check(request)

        // The command line's result, the premises' origin and the times aside.
        func file(_ path: String) throws -> String { try String(contentsOf: Self.expected.appendingPathComponent(path), encoding: .utf8) }
        let app = { (text: String) in text.replacingOccurrences(of: "command-line option", with: "iPhone and iPad app") }
        XCTAssertEqual("\(result.exit)\n", try file("plain/exit_status.txt"))
        XCTAssertEqual(result.message, try file("plain/stderr.txt"))
        XCTAssertEqual(Data(Self.timeless(result.summary)!.utf8), Data(Self.timeless(try file("plain/stdout.txt"))!.utf8))
        XCTAssertEqual(Data(Self.timeless(result.json)!.utf8), Data(Self.timeless(app(try file("plain/report.json")))!.utf8))
        XCTAssertEqual(Data(Self.timeless(result.html)!.utf8), Data(Self.timeless(app(try file("plain/report.html")))!.utf8))
        let exportFolder = Self.expected.appendingPathComponent("exports/records-to-resend")
        let names = try FileManager.default.contentsOfDirectory(atPath: exportFolder.path).sorted()
        XCTAssertEqual(result.exports?.map(\.file).sorted(), names)
        for e in result.exports ?? [] {
            XCTAssertEqual(Data(e.text.utf8), try Data(contentsOf: exportFolder.appendingPathComponent(e.file)), e.file)
        }
        XCTAssertEqual(result.report?.schemaVersion, 3)
        XCTAssertNotNil(result.report?.inputs["source_sheet"])
        XCTAssertNotNil(result.report?.inputs["destination_hubspot"])

        // Nowhere but the Keychain and the requests.
        let secrets = [sheetsToken, hubspotToken].map { Data($0.utf8) }
        func clean(_ data: Data, _ what: String) {
            for secret in secrets { XCTAssertNil(data.range(of: secret), "a credential is in \(what)") }
        }
        let texts = [result.summary, result.message, result.json ?? "", result.html ?? ""] + (result.exports ?? []).map(\.text)
        for text in texts { clean(Data(text.utf8), "the result") }
        XCTAssertFalse(engine.argumentsSent.isEmpty)
        for argument in engine.argumentsSent { clean(Data(argument.utf8), "a value handed to JavaScript") }
        XCTAssertFalse(engine.bytesServed.isEmpty)
        for data in engine.bytesServed { clean(data, "the bytes served to the page") }
        let defaults = try PropertyListSerialization.data(fromPropertyList: UserDefaults.standard.dictionaryRepresentation(), format: .binary, options: 0)
        clean(defaults, "UserDefaults")
        // Every file in the app's container: Documents, Library (preferences, caches, WebKit's data) and tmp.
        var searched = 0
        let home = URL(fileURLWithPath: NSHomeDirectory())
        for case let url as URL in FileManager.default.enumerator(at: home, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey]) ?? FileManager.default.enumerator(atPath: "/")! {
            let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            guard values?.isRegularFile == true, (values?.fileSize ?? 0) < 200_000_000, let data = try? Data(contentsOf: url) else { continue }
            searched += 1
            clean(data, url.path)
        }
        XCTAssertGreaterThan(searched, 0)
        print("credential search: \(engine.argumentsSent.count) values handed to JavaScript, \(engine.bytesServed.count) byte bodies served, \(searched) files in the app's container")
    }
}
