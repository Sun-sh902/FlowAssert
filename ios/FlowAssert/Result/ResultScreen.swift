import SwiftUI
import UniformTypeIdentifiers

/// The result of the check that just ran: a report, or a refusal or failure with the checker's message.
struct ResultScreen: View {
    var model: CheckModel
    @Environment(AppModel.self) private var app

    var body: some View {
        switch model.run {
        case .finished(let result):
            if let report = result.report {
                ReportView(engine: model.engine, report: report, json: result.json, html: result.html, summary: result.summary, exports: result.exports,
                           keptAs: nil, origin: .thisCheck)
            } else {
                NoResultView(result: result)
            }
        case .broken(let message):
            List {
                Section {
                    VerdictMark(verdict: .failed, font: .title2)
                    Text(message)
                }
            }
            .navigationTitle("Result")
        case .running, .idle:
            ProgressView().navigationTitle("Result")
        }
    }
}

/// A refused or failed check: no result at all, only the checker's message.
struct NoResultView: View {
    var result: CheckResult

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    VerdictMark(verdict: Verdict(result.state), font: .largeTitle)
                    Text(result.message.trimmingCharacters(in: .newlines))
                        .font(.body.monospaced())
                        .textSelection(.enabled)
                        .accessibilityIdentifier("result-message")
                    Text(result.state == "refused" ? "Nothing was checked, and nothing is concluded." : "The check failed inside FlowAssert; nothing is concluded.")
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 6)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("verdict")
            }
        }
        .navigationTitle("Result")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// A report, read with the saved-report reader: the result of the check that just ran, or a kept or imported one.
struct ReportView: View {
    enum Origin { case thisCheck, kept, imported }

    var engine: CheckerEngine
    var report: OpenedReport
    var json: String?
    var html: String?
    /// The printed summary, for a check that just ran; a report alone does not hold it.
    var summary: String?
    var exports: [CheckExport]?
    var keptAs: String?
    var origin: Origin
    @Environment(AppModel.self) private var app
    @State private var shared = SharedFiles()
    @State private var kept = false
    @State private var showingSummary = false
    @State private var saving = false

    var verdict: Verdict { Verdict(report.cohort) }

    var body: some View {
        List {
            Section {
                VerdictHeader(report: report, summaryLine: summary.flatMap { $0.split(separator: "\n", maxSplits: 1).first.map(String.init) })
            }
            if origin == .imported {
                Section {
                    Text("This report was imported. It is not authenticated: its files, statements and numbers are what the file says.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            RecordsSection(engine: engine, report: report)
            ExplanationSection(explanation: report.explanation)
            if let exports, !exports.isEmpty {
                ResendSection(exports: exports, shared: shared)
            }
            Section("Reports") {
                if let json { ShareLink(item: shared.url(json, "flowassert-report.json"), label: { Label("Share the JSON report", systemImage: "square.and.arrow.up") }).accessibilityIdentifier("share-json") }
                if let html { ShareLink(item: shared.url(html, "flowassert-report.html"), label: { Label("Share the HTML report", systemImage: "square.and.arrow.up") }).accessibilityIdentifier("share-html") }
                if json != nil || html != nil || !(exports ?? []).isEmpty {
                    Button { saving = true } label: { Label("Save to Files", systemImage: "folder") }
                        .accessibilityIdentifier("save-to-files")
                }
                if origin == .thisCheck, let json {
                    Button {
                        kept = app.reports.keep(Data(json.utf8), report: report, imported: false, name: "flowassert-report.json") != nil
                    } label: {
                        Label(kept ? "Kept on this device" : "Keep this report on this device", systemImage: kept ? "checkmark" : "tray.and.arrow.down")
                    }
                    .disabled(kept)
                    .accessibilityIdentifier("keep-report")
                }
            }
            if let summary {
                Section {
                    DisclosureGroup("Printed summary", isExpanded: $showingSummary) {
                        Text(summary).font(.footnote.monospaced()).textSelection(.enabled)
                            .accessibilityIdentifier("printed-summary")
                    }
                } footer: {
                    Text("What the command line prints for the same files and statements.")
                }
            }
            PremisesResultSection(report: report)
            Section("Limitations") {
                Text(report.limitations).font(.footnote)
            }
        }
        .navigationTitle("Result")
        .navigationBarTitleDisplayMode(.inline)
        .fileExporter(isPresented: $saving, documents: savedDocuments, contentType: .data) { _ in }
    }

    /// The reports and the records to resend, each as the bytes the checker wrote, under the names the browser and the
    /// command line give them.
    private var savedDocuments: [ExactFile] {
        var files: [ExactFile] = []
        if let json { files.append(ExactFile(name: "flowassert-report.json", bytes: Data(json.utf8))) }
        if let html { files.append(ExactFile(name: "flowassert-report.html", bytes: Data(html.utf8))) }
        for e in exports ?? [] { files.append(ExactFile(name: e.file, bytes: Data(e.text.utf8))) }
        return files
    }
}

/// A file saved exactly as given: its name and its bytes.
struct ExactFile: FileDocument {
    static let readableContentTypes: [UTType] = [.data]
    var name: String
    var bytes: Data
    init(name: String, bytes: Data) { self.name = name; self.bytes = bytes }
    init(configuration: ReadConfiguration) throws { name = "file"; bytes = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        let wrapper = FileWrapper(regularFileWithContents: bytes)
        wrapper.preferredFilename = name
        return wrapper
    }
}

/// The verdict first: its shape and word, the summary line, the counts and the claim. VoiceOver reads it in that order.
struct VerdictHeader: View {
    var report: OpenedReport
    var summaryLine: String?

    var body: some View {
        let verdict = Verdict(report.cohort)
        let total = report.expectedTotal.map(String.init) ?? "unknown total"
        let line = summaryLine ?? "\(report.cohort): \(report.sourceRows) rows of \(total)"
        let counts = "Verified \(report.counts["Verified"] ?? 0) · Mismatch \(report.counts["Mismatch"] ?? 0) · Unverified \(report.counts["Unverified"] ?? 0)"
        let claim = report.claim ?? "No claim is made: the result is not Verified."
        VStack(alignment: .leading, spacing: 8) {
            VerdictMark(verdict: verdict, font: .largeTitle)
            Text(line).font(.title3.monospaced())
            Text(counts).font(.subheadline).foregroundStyle(.secondary)
            Text(claim).font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(verdict.rawValue). \(line). \(counts). \(claim)")
        .accessibilityIdentifier("verdict")
    }
}

/// "What this result means", read from the report; beside the result, never in it.
struct ExplanationSection: View {
    var explanation: Explanation

    var body: some View {
        Section {
            Text(explanation.lead)
            ForEach(explanation.points) { point in
                VStack(alignment: .leading, spacing: 4) {
                    PartsText(parts: point.text)
                    if let detail = point.detail { PartsText(parts: detail).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            if explanation.more > 0 {
                Text("\(explanation.more) more in the records.").font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("What this result means")
        }
    }
}

/// Words, with values from a file or a report set in a fixed-width face.
struct PartsText: View {
    var parts: [TextPart]

    var body: some View {
        parts.reduce(Text("")) { text, part in
            switch part {
            case .words(let s): text + Text(s)
            case .value(let v): text + Text(v).font(.body.monospaced())
            }
        }
    }
}

struct PremisesResultSection: View {
    var report: OpenedReport

    static let titles: [String: String] = [
        "source_complete": "The source file is the whole batch",
        "destination_complete": "The destination export covers the whole object",
        "source_count": "Source total seen in the original system",
        "destination_count": "Destination total seen in the original system",
        "allow_identical_content": "Allow identical content",
    ]

    var body: some View {
        Section {
            ForEach(Array(report.premises.enumerated()), id: \.offset) { _, pair in
                if pair.count == 2, let name = pair[0].string {
                    let p = pair[1]
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Self.titles[name] ?? name)
                        Text(describe(p)).font(.footnote).foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        } header: {
            Text("What was stated")
        } footer: {
            Text("FlowAssert did not verify these statements.")
        }
    }

    private func describe(_ p: JSONValue) -> String {
        var parts: [String] = []
        let stated = p["stated"] ?? .null
        parts.append(stated == .null ? "not stated" : "stated: \(stated.text)")
        if let observed = p["observed"], observed != .null { parts.append("rows read: \(observed.text)") }
        if let matched = p["matched"], matched != .null { parts.append(matched.bool == true ? "matches the rows read" : "differs from the rows read") }
        if let origin = p["origin"]?.string { parts.append("origin: \(origin)") }
        return parts.joined(separator: " · ")
    }
}

/// Temporary copies of the reports and exports for the share sheet, as the bytes the checker wrote, encoded as UTF-8.
@MainActor
final class SharedFiles {
    private let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Share", isDirectory: true).appendingPathComponent(UUID().uuidString, isDirectory: true)
    private var written: [String: URL] = [:]

    func url(_ text: String, _ name: String) -> URL {
        if let url = written[name] { return url }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent(name)
        try? Data(text.utf8).write(to: url, options: [.atomic, .completeFileProtection])
        written[name] = url
        return url
    }

    deinit {
        try? FileManager.default.removeItem(at: folder)
    }
}
