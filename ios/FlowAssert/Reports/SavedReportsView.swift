import SwiftUI
import UniformTypeIdentifiers

/// Reports kept on this device, newest first, and reports imported from Files.
struct SavedReportsView: View {
    @Environment(AppModel.self) private var app
    @State private var importing = false
    @State private var confirmingDeleteAll = false
    @State private var refusal: String?

    var body: some View {
        List {
            if let name = app.reading {
                Section {
                    HStack(spacing: 12) {
                        ProgressView()
                        Text("Reading \(name)…").foregroundStyle(.secondary).lineLimit(2)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("reading-report")
                }
            }
            if app.reports.entries.isEmpty && app.reading == nil {
                Section {
                    Text("No report is kept on this device. After a check, Keep this report keeps its JSON report here. You can also import a JSON report written by the command line, the browser, the GitHub Action or n8n.")
                        .foregroundStyle(.secondary)
                }
            }
            Section {
                ForEach(app.reports.entries) { entry in
                    NavigationLink(value: entry) { SavedReportRow(entry: entry) }
                }
                .onDelete { offsets in
                    for i in offsets { app.reports.delete(app.reports.entries[i]) }
                }
            } footer: {
                if !app.reports.entries.isEmpty {
                    Text("Kept only on this device, in the app's own storage. Imported reports are not authenticated.")
                }
            }
        }
        .navigationTitle("Saved reports")
        .navigationDestination(for: ReportStore.Entry.self) { entry in
            SavedReportScreen(entry: entry)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { importing = true } label: { Label("Import a report", systemImage: "square.and.arrow.down") }
                    .accessibilityIdentifier("import-report")
            }
            if !app.reports.entries.isEmpty {
                ToolbarItem(placement: .secondaryAction) {
                    Button("Delete all", role: .destructive) { confirmingDeleteAll = true }
                }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json, .data]) { result in
            guard case .success(let url) = result, let bytes = try? readSecurityScoped(url) else { return }
            Task { refusal = await app.importReport(bytes, name: url.lastPathComponent) }
        }
        .confirmationDialog("Delete every kept report?", isPresented: $confirmingDeleteAll, titleVisibility: .visible) {
            Button("Delete all \(app.reports.entries.count) reports", role: .destructive) { app.reports.deleteAll() }
        } message: {
            Text("They are removed from this device and cannot be brought back.")
        }
        .alert("Not a FlowAssert report", isPresented: Binding(get: { refusal != nil }, set: { if !$0 { refusal = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("\(refusal ?? "")\nNothing was kept.")
        }
    }
}

/// A kept report, opened again with the saved-report reader.
struct SavedReportScreen: View {
    var entry: ReportStore.Entry
    @Environment(AppModel.self) private var app
    @State private var opened: OpenResult?
    @State private var bytes: Data?

    var body: some View {
        Group {
            switch opened {
            case .opened(let report):
                ReportView(engine: app.engine, report: report, json: bytes.map { String(decoding: $0, as: UTF8.self) }, html: nil, summary: nil,
                           exports: nil, keptAs: entry.name, origin: entry.imported ? .imported : .kept)
            case .refused(_, let message):
                List { Text(message) }
            case nil:
                ProgressView()
            }
        }
        .task {
            bytes = app.reports.bytes(of: entry)
            if let bytes {
                let interval = Performance.signposter.beginInterval("Open report")
                opened = try? await app.engine.open(bytes, name: entry.name)
                Performance.signposter.endInterval("Open report", interval)
            }
        }
    }
}

struct SavedReportRow: View {
    var entry: ReportStore.Entry

    var body: some View {
        let detail = "\(entry.sourceRows.formatted()) rows · evaluated \(entry.evaluatedAt)" + (entry.imported ? " · imported" : "")
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.name).lineLimit(1)
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
            VerdictMark(verdict: Verdict(entry.cohort), font: .subheadline)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(entry.cohort). \(entry.name), \(detail)")
    }
}
