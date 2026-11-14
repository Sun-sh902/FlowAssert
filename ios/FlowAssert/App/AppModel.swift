import Foundation
import Observation

/// What the whole app shares: the engine (one page for every check and reader), the check, the kept reports, and a
/// file opened from another app that waits to be given a side.
@Observable
@MainActor
final class AppModel {
    let engine: CheckerEngine
    let check: CheckModel
    let reports: ReportStore
    /// A file opened from Files or another app's share sheet, until the person says what it is.
    var opening: (name: String, bytes: Data)?
    var section: AppSection = .check
    /// The engine's own state: nil until loaded; a host problem makes the app refuse to check.
    var status: CheckerEngine.Status?
    var engineProblem: String?

    init(engine: CheckerEngine? = nil, reports: ReportStore? = nil) {
        let engine = engine ?? CheckerEngine()
        self.engine = engine
        self.check = CheckModel(engine: engine)
        self.reports = reports ?? ReportStore()
    }

    func start() async {
        do {
            status = try await engine.start()
        } catch {
            engineProblem = error.localizedDescription
        }
    }

    /// A file from another app: kept until the person chooses source, destination or (for JSON) a report.
    func open(url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let bytes = try? Data(contentsOf: url) else { return }
        opening = (url.lastPathComponent, bytes)
        // A copy the system put in the app's Inbox is not kept.
        if url.path.contains("/Inbox/") { try? FileManager.default.removeItem(at: url) }
    }

    func use(_ file: (name: String, bytes: Data), as side: Side) async {
        opening = nil
        section = .check
        await check.choose(side, name: file.name, bytes: file.bytes)
    }

    /// Reads a report with the saved-report reader and keeps it when it is one; returns the refusal otherwise.
    func importReport(_ bytes: Data, name: String) async -> String? {
        do {
            switch try await engine.open(bytes, name: name) {
            case .opened(let report):
                await engine.release(report: report.id)
                return reports.keep(bytes, report: report, imported: true, name: name) == nil ? "\(name): could not be kept on this device" : nil
            case .refused(_, let message):
                return message
            }
        } catch {
            return error.localizedDescription
        }
    }

    func keepReport(_ file: (name: String, bytes: Data)) async -> String? {
        opening = nil
        section = .reports
        return await importReport(file.bytes, name: file.name)
    }
}

enum AppSection: Hashable { case check, reports }
