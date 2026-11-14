import Foundation

/// Any JSON value the page returns, kept as it is, for members the app shows without interpreting.
enum JSONValue: Codable, Equatable, Sendable {
    case string(String), number(Double), bool(Bool), null
    case array([JSONValue]), object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .null: try c.encodeNil()
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    var string: String? { if case .string(let s) = self { return s }; return nil }
    var bool: Bool? { if case .bool(let b) = self { return b }; return nil }
    var int: Int? { if case .number(let n) = self { return Int(exactly: n) }; return nil }
    var array: [JSONValue]? { if case .array(let a) = self { return a }; return nil }

    /// The value as the report writes it, for showing: a string as it is, a number without a fraction, true or false.
    var text: String {
        switch self {
        case .string(let s): s
        case .number(let n): n == n.rounded() && abs(n) < 1e15 ? String(Int(n)) : String(n)
        case .bool(let b): b ? "true" : "false"
        case .null: "null"
        case .array(let a): a.map(\.text).joined(separator: ", ")
        case .object: "…"
        }
    }
}

/// A piece of text that is either words or a value from a file or a report, shown as code.
enum TextPart: Codable, Equatable, Sendable {
    case words(String), value(String)

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { self = .words(s) } else {
            struct V: Decodable { var value: String }
            self = .value(try c.decode(V.self).value)
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .words(let s): try c.encode(s)
        case .value(let v): try c.encode(["value": v])
        }
    }

    var text: String { switch self { case .words(let s), .value(let s): s } }
}

/// The file profile of the CSV check page (profile.ts), or the refusal a check would give the file.
struct ProfileResult: Decodable, Equatable, Sendable {
    struct Column: Decodable, Equatable, Sendable { var name: String; var empty: Int }
    struct Endings: Decodable, Equatable, Sendable { var lf: Int; var crlf: Int; var cr: Int }
    struct Workbook: Decodable, Equatable, Sendable {
        var worksheet: String
        var state: String
        var sheets: [Sheet]
        var dateSystem: String
        var cells: [String: Int]
        var emptyCells: Int
        var hiddenRows: Int
        var hiddenColumns: Int
        var mergedRanges: Int
    }
    struct Profile: Decodable, Equatable, Sendable {
        var rows: Int
        var columns: [Column]
        var encoding: String
        var bom: String
        var endings: Endings
        var size: Int
        var workbook: Workbook?
    }
    var ok: Bool
    var profile: Profile?
    var message: String?
}

/// One sheet of a workbook as the .xlsx reader lists it.
struct Sheet: Decodable, Equatable, Sendable, Hashable {
    var name: String
    var state: String
    var bytes: Int?
    var worksheet: Bool
}

struct SheetsResult: Decodable, Equatable, Sendable {
    var ok: Bool
    var sheets: [Sheet]?
    var message: String?
}

struct RuleResult: Decodable, Equatable, Sendable {
    var status: String
    var reason: String
    var rule: String?
    var expected: String?
    var actual: String?
    var expected_normalized: String?
    var actual_normalized: String?
}

/// A record of a report, as the explorer lists it: a source record, or a destination-only one.
struct ReportItem: Decodable, Equatable, Sendable, Identifiable {
    struct Record: Decodable, Equatable, Sendable {
        var key: String?
        var source_row: Int?
        var destination_row: Int?
        var rows: Int?
        var state: String
        var candidates: Int?
        var reason: String?
        var rules: [String: RuleResult]?
    }
    var kind: String
    var index: Int?
    var record: Record

    var id: String { kind == "source" ? "s\(record.source_row ?? -1)" : "d\(index ?? -1)" }
    /// The row as the summary counts it, from 1.
    var row: Int { (kind == "source" ? record.source_row : record.destination_row).map { $0 + 1 } ?? 0 }
}

struct Matched: Decodable, Equatable, Sendable {
    var matches: Int
    var of: Int
    var untestable: Int
}

/// "What this result means" (explain.ts), read from the report.
struct Explanation: Decodable, Equatable, Sendable {
    struct Point: Decodable, Equatable, Sendable, Identifiable {
        var id: String
        var text: [TextPart]
        var detail: [TextPart]?
    }
    var state: String
    var lead: String
    var points: [Point]
    var more: Int
}

/// A report opened with the saved-report reader (savedReport.ts): what the result screen shows. It stays open in the
/// page, under `id`, for the explorer.
struct OpenedReport: Decodable, Equatable, Sendable {
    var id: Int
    var schemaVersion: Int
    var cohort: String
    var claim: String?
    var counts: [String: Int]
    var expectedTotal: Int?
    var sourceRows: Int
    var populationKnown: Bool
    var coverageSufficient: Bool
    var destinationRowsWithoutKey: Int
    var premises: [[JSONValue]]
    var inputs: [String: JSONValue]
    var obligation: JSONValue
    var limitations: String
    var evaluatedAt: String
    var details: String
    var redacted: Bool
    var rules: [String]
    var total: Int
    var destinationOnlyTotal: Int?
    var destinationOnlyCounts: [String: Int]?
    var explanation: Explanation
}

/// What opening a report gives: the report, or the reader's refusal.
enum OpenResult: Equatable, Sendable {
    case opened(OpenedReport)
    case refused(check: String, message: String)
}

/// Where two values differ (chardiff.ts), with invisible characters as the browser's visible tokens.
struct ValueDiff: Decodable, Equatable, Sendable {
    struct Piece: Decodable, Equatable, Sendable {
        var text: String
        var token: Bool?
    }
    struct Run: Decodable, Equatable, Sendable {
        var kind: String
        var pieces: [Piece]
    }
    var source: [Run]
    var destination: [Run]
    var tooLong: Bool
    var sourceCodePoints: [String]
    var destinationCodePoints: [String]
    var notes: [String]
}
