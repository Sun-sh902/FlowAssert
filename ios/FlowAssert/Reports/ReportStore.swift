import Foundation
import Observation

/// Reports kept on this device, only when the person asks: each the JSON report's bytes, unchanged, in Application
/// Support, and reopened through the checker's own saved-report reader. The list beside them holds what the reader
/// read when the report was kept, so the list does not read every report again.
@Observable
@MainActor
final class ReportStore {
    struct Entry: Codable, Identifiable, Hashable {
        var id: UUID
        var name: String
        var keptAt: Date
        var evaluatedAt: String
        var cohort: String
        var sourceRows: Int
        var expectedTotal: Int?
        var imported: Bool
        var bytes: Int
    }

    private(set) var entries: [Entry] = []
    let folder: URL

    init(folder: URL? = nil) {
        let base = folder ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Reports", isDirectory: true)
        self.folder = base
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let data = try? Data(contentsOf: indexURL), let list = try? decoder.decode([Entry].self, from: data) {
            entries = list.filter { FileManager.default.fileExists(atPath: url(of: $0).path) }
        }
    }

    private var indexURL: URL { folder.appendingPathComponent("index.json") }
    func url(of entry: Entry) -> URL { folder.appendingPathComponent("\(entry.id.uuidString).json") }

    private func saveIndex() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try? encoder.encode(entries).write(to: indexURL, options: [.atomic, .completeFileProtection])
    }

    /// Keeps the report's bytes as they are. The report has already been read by the saved-report reader.
    @discardableResult
    func keep(_ bytes: Data, report: OpenedReport, imported: Bool, name: String) -> Entry? {
        let entry = Entry(id: UUID(), name: name, keptAt: Date(timeIntervalSince1970: Date().timeIntervalSince1970.rounded(.down)), evaluatedAt: report.evaluatedAt, cohort: report.cohort,
                          sourceRows: report.sourceRows, expectedTotal: report.expectedTotal, imported: imported, bytes: bytes.count)
        do {
            try bytes.write(to: url(of: entry), options: [.atomic, .completeFileProtection])
        } catch {
            return nil
        }
        entries.insert(entry, at: 0)
        saveIndex()
        return entry
    }

    func bytes(of entry: Entry) -> Data? { try? Data(contentsOf: url(of: entry)) }

    func delete(_ entry: Entry) {
        try? FileManager.default.removeItem(at: url(of: entry))
        entries.removeAll { $0.id == entry.id }
        saveIndex()
    }

    func deleteAll() {
        for e in entries { try? FileManager.default.removeItem(at: url(of: e)) }
        entries = []
        try? FileManager.default.removeItem(at: indexURL)
    }
}
