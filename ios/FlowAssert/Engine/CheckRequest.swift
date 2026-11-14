import Foundation

/// One side of a check, as the packaged checker takes it: its bytes, never decoded or looked into by Swift.
struct EngineFile: Sendable {
    /// What refusals name, as the CSV check page names a chosen file.
    var name: String
    var bytes: Data
    /// `utf-8`, `utf-16` or `gb18030` for a CSV file; nil for a workbook, which has none.
    var encoding: String?
    /// `csv` or `xlsx`; nil is `csv`.
    var format: String?
    /// For a workbook: the worksheet, exactly as the workbook names it.
    var worksheet: String?
}

/// The configuration: one the person chose in the app, written by the checker as the CSV check page writes it, or a
/// configuration file the person imported, passed as its bytes so that its SHA-256 is that of the file.
enum EngineConfig: Sendable {
    case chosen(key: (source: String, destination: String), fields: [(source: String, destination: String, rule: String)], scope: String)
    case loaded(Data)
}

/// Everything a check takes. The premises are the person's statements; each is false or absent unless stated.
struct CheckRequest: Sendable {
    var source: EngineFile
    var destination: EngineFile
    var config: EngineConfig
    var sourceComplete = false
    var destinationComplete = false
    /// As typed, or nil when left empty.
    var sourceCount: String?
    var destinationCount: String?
    var allowIdenticalContent = false
    /// Also the records to resend.
    var exports = false
    /// `problems` (the default) or `all`.
    var details: String?
    var redactValues = false
    var maxBytes: String?
    var maxRows: String?
    /// Also open the JSON report with the saved-report reader, so that the result is read from the report.
    var openReport = false
}

/// One file of the records to resend, as the checker wrote it.
struct CheckExport: Sendable, Equatable {
    var file: String
    var rows: Int
    var meaning: String
    var formulaFields: Int
    /// The file's text, beginning with its byte order mark; written as UTF-8 it is the command line's file.
    var text: String
}

/// The checker's result, exactly as `checkCsv` returned it.
struct CheckResult: Sendable, Equatable {
    var exit: Int
    /// `Verified`, `Mismatch`, `Unverified`, `refused` or `failed`.
    var state: String
    var summary: String
    var message: String
    var json: String?
    var html: String?
    var exports: [CheckExport]?
    /// How long `checkCsv` took in the page, by the page's clock.
    var milliseconds: Double
    /// The JSON report, opened with the saved-report reader, when the request asked for it and there is one.
    var report: OpenedReport?
}
