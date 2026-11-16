import Foundation
import XCTest
@testable import FlowAssert

/// The packaged checker in the app's WebKit gives what the command line and Node give, byte for byte.
///
/// The cases and what each must give are written by `node ios/scripts/engine-cases.mjs` into `ios/build/engine-cases/`
/// (see that script): every golden case the CSV check page can run, every case of `offline/golden-xlsx/`, every
/// conformance case, the hostile workbooks of the .xlsx parity test and, with `--large`, two files of 1,000,000 rows and
/// workbooks of about 3 MB and 50 MB. Each case is run through `CheckerEngine`, exactly as the app runs a check, and its
/// exit status, summary, message and both reports are compared, as bytes, with each reference; only `evaluated_at`,
/// which is the time of the check, is left out. The test reads the repository from the Mac, so it runs on a simulator.
@MainActor
final class EngineParityTests: XCTestCase {
    static let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    static let cases = repository.appendingPathComponent("ios/build/engine-cases")

    struct Manifest: Decodable {
        var origin: String
        var version: String
        var cases: [Case]
    }

    struct Case: Decodable {
        var group: String
        var name: String
        var request: String
        var references: [String: String]
        var pythonNotRun: String?
        var conformance: String?
        var bytes: Int?
    }

    struct Request: Decodable {
        struct Side: Decodable {
            var name: String
            var path: String
            var encoding: String?
            var format: String?
            var worksheet: String?
        }
        struct Config: Decodable {
            struct Chosen: Decodable {
                var key: [String]
                var fields: [[String]]
                var scope: String
            }
            var path: String?
            var chosen: Chosen?
        }
        var source: Side
        var destination: Side
        var config: Config
        var sourceComplete: Bool
        var destinationComplete: Bool
        var sourceCount: String?
        var destinationCount: String?
        var allowIdenticalContent: Bool
        var exports: Bool?
        var details: String?
        var redactValues: Bool?
        var maxBytes: String?
        var maxRows: String?
    }

    static func manifest() throws -> Manifest {
        let url = cases.appendingPathComponent("manifest.json")
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw NSError(domain: "EngineParityTests", code: 1, userInfo: [NSLocalizedDescriptionKey:
                "\(url.path) does not exist: run `node ios/scripts/engine-cases.mjs` after `npm run build:lib` in ui/"])
        }
        return try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: url))
    }

    static func checkRequest(_ path: String) throws -> CheckRequest {
        let r = try JSONDecoder().decode(Request.self, from: Data(contentsOf: repository.appendingPathComponent(path)))
        func file(_ s: Request.Side) throws -> EngineFile {
            EngineFile(name: s.name, bytes: try Data(contentsOf: repository.appendingPathComponent(s.path)),
                       encoding: s.encoding, format: s.format, worksheet: s.worksheet)
        }
        let config: EngineConfig
        if let path = r.config.path {
            config = .loaded(try Data(contentsOf: repository.appendingPathComponent(path)))
        } else if let c = r.config.chosen {
            config = .chosen(key: (c.key[0], c.key[1]), fields: c.fields.map { ($0[0], $0[1], $0[2]) }, scope: c.scope)
        } else {
            throw NSError(domain: "EngineParityTests", code: 2, userInfo: [NSLocalizedDescriptionKey: "\(path): no configuration"])
        }
        var request = CheckRequest(source: try file(r.source), destination: try file(r.destination), config: config)
        request.sourceComplete = r.sourceComplete
        request.destinationComplete = r.destinationComplete
        request.sourceCount = r.sourceCount
        request.destinationCount = r.destinationCount
        request.allowIdenticalContent = r.allowIdenticalContent
        request.exports = r.exports ?? false
        request.details = r.details
        request.redactValues = r.redactValues ?? false
        request.maxBytes = r.maxBytes
        request.maxRows = r.maxRows
        return request
    }

    /// The time of a check, the one value a reference cannot share: the first `evaluated_at` of a JSON report and the
    /// time in the HTML report's verdict line, as golden-cases.ts leaves them out.
    static func withoutTime(_ text: String?) -> Data? {
        guard var text else { return nil }
        if let r = text.firstRange(of: /"evaluated_at": "[^"]*"/) { text.replaceSubrange(r, with: "\"evaluated_at\": \"\"") }
        if let r = text.firstRange(of: />Evaluated at [^ ]* by/) { text.replaceSubrange(r, with: ">Evaluated at by") }
        return Data(text.utf8)
    }

    /// What differs between a result and a reference's files, member by member, as bytes (never as Swift strings, which
    /// compare canonically equivalent text as equal).
    static func differences(_ result: CheckResult, _ folder: String) -> [String] {
        let dir = repository.appendingPathComponent(folder)
        func file(_ name: String) -> String? { try? String(contentsOf: dir.appendingPathComponent(name), encoding: .utf8) }
        var out: [String] = []
        if file("exit.txt") != String(result.exit) { out.append("exit \(result.exit), expected \(file("exit.txt") ?? "?")") }
        for (name, actual, expected) in [
            ("summary", Data(result.summary.utf8), file("summary.txt").map { Data($0.utf8) }),
            ("message", Data(result.message.utf8), file("message.txt").map { Data($0.utf8) }),
            ("report.json", withoutTime(result.json), withoutTime(file("report.json"))),
            ("report.html", withoutTime(result.html), withoutTime(file("report.html"))),
        ] where actual != expected {
            let a = actual.map { String(decoding: $0.prefix(400), as: UTF8.self) } ?? "none"
            let e = expected.map { String(decoding: $0.prefix(400), as: UTF8.self) } ?? "none"
            out.append("\(name) differs: got \(a.debugDescription) expected \(e.debugDescription)")
        }
        return out
    }

    struct Outcome: Encodable {
        var group: String
        var name: String
        var references: [String]
        var exit: Int
        /// From asking the engine to the result in Swift: the bytes to the page, the check, the reports back.
        var milliseconds: Double
        /// `checkCsv` alone, by the page's clock.
        var checkMilliseconds: Double
        var differences: [String]
    }

    func run(groups: Set<String>, only: String? = nil, results file: String) async throws -> [Outcome] {
        let manifest = try Self.manifest()
        let engine = CheckerEngine()
        let status = try await engine.start()
        XCTAssertNil(status.hostProblem, "hostProblem() in the app's WebKit")
        XCTAssertEqual(status.version, manifest.version)
        var outcomes: [Outcome] = []
        for c in manifest.cases where groups.contains(c.group) && (only == nil || c.name == only) {
            let request = try Self.checkRequest(c.request)
            let started = Date()
            let result = try await engine.check(request)
            let elapsed = Date().timeIntervalSince(started) * 1000
            var diffs: [String] = []
            for (reference, folder) in c.references.sorted(by: { $0.key < $1.key }) {
                diffs += Self.differences(result, folder).map { "\(reference): \($0)" }
            }
            if let expectedPath = c.conformance {
                diffs += try Self.conformanceDifferences(result, expected: expectedPath)
            }
            outcomes.append(Outcome(group: c.group, name: c.name, references: c.references.keys.sorted(), exit: result.exit, milliseconds: elapsed, checkMilliseconds: result.milliseconds, differences: diffs))
            for d in diffs { XCTFail("\(c.group)/\(c.name): \(d)") }
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(outcomes).write(to: Self.repository.appendingPathComponent("ios/build/\(file)"))
        return outcomes
    }

    /// A conformance case's `expected`: the cohort state, each record's state and the expected total, read from the
    /// report the checker wrote.
    static func conformanceDifferences(_ result: CheckResult, expected path: String) throws -> [String] {
        struct Expected: Decodable, Equatable {
            var cohort_state: String
            var record_states: [String]
            var expected_total: Int?
        }
        struct Report: Decodable {
            struct Record: Decodable { var state: String }
            var cohort_state: String
            var records: [Record]
            var expected_total: Int?
        }
        let expected = try JSONDecoder().decode(Expected.self, from: Data(contentsOf: repository.appendingPathComponent(path)))
        guard let json = result.json else { return ["conformance: no report (\(result.message))"] }
        let report = try JSONDecoder().decode(Report.self, from: Data(json.utf8))
        let actual = Expected(cohort_state: report.cohort_state, record_states: report.records.map(\.state), expected_total: report.expected_total)
        return actual == expected ? [] : ["conformance: got \(actual), expected \(expected)"]
    }

    func testEveryCaseGivesWhatTheCommandLineAndNodeGive() async throws {
        let outcomes = try await run(groups: ["golden", "xlsx", "conformance", "hostile"], results: "engine-results.json")
        let counts = Dictionary(grouping: outcomes, by: \.group).mapValues(\.count)
        // The suite cannot pass by running nothing.
        XCTAssertEqual(counts["golden"], 60)
        XCTAssertEqual(counts["xlsx"], 71)
        XCTAssertEqual(counts["conformance"], 39)
        XCTAssertEqual(counts["hostile"], 31)
        print("engine parity: \(outcomes.count) cases, \(outcomes.filter { !$0.differences.isEmpty }.count) with a difference")
    }

    /// Two files of 1,000,000 rows and workbooks of about 3 MB and 50 MB; generated only with `--large`.
    func testLargeInputs() async throws {
        let manifest = try Self.manifest()
        try XCTSkipUnless(manifest.cases.contains { $0.group == "large" }, "run node ios/scripts/engine-cases.mjs --large to write the large cases")
        // FA_LARGE_CASE (TEST_RUNNER_FA_LARGE_CASE for xcodebuild) runs one of them, so that its memory can be measured alone.
        let only = ProcessInfo.processInfo.environment["FA_LARGE_CASE"]
        let outcomes = try await run(groups: ["large"], only: only, results: "engine-large-results\(only.map { "-" + $0 } ?? "").json")
        for o in outcomes { print("large \(o.name): exit \(o.exit), \(Int(o.milliseconds)) ms in all, \(Int(o.checkMilliseconds)) ms in checkCsv") }
        XCTAssertEqual(outcomes.count, only == nil ? 3 : 1)
    }
}
