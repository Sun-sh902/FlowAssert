import SwiftUI
import UniformTypeIdentifiers

/// One input: a file chosen from Files, dropped on the section (iPad), or opened from another app; its encoding or
/// worksheet; and its profile, read by the checker before any check.
struct InputSection: View {
    var model: CheckModel
    var side: Side
    @State private var choosing = false
    @State private var dropping = false

    static let types: [UTType] = [.commaSeparatedText, .plainText, UTType("org.openxmlformats.spreadsheetml.sheet") ?? .data, .spreadsheet, .data]

    var body: some View {
        Section {
            if let input = model.input(side) {
                chosen(input)
            } else {
                Button {
                    choosing = true
                } label: {
                    Label("Choose a file", systemImage: "doc.badge.plus")
                }
                .accessibilityIdentifier("\(side.rawValue)-choose")
                Text(dropping ? "Drop the file here" : "CSV or Excel workbook (.xlsx). On iPad you can also drop a file here.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text(side.title)
        } footer: {
            Text(side.explanation)
        }
        .fileImporter(isPresented: $choosing, allowedContentTypes: Self.types) { result in
            guard case .success(let url) = result, let bytes = try? readSecurityScoped(url) else { return }
            Task { await model.choose(side, name: url.lastPathComponent, bytes: bytes) }
        }
        .onDrop(of: [.fileURL, .data], isTargeted: $dropping) { providers in
            guard providers.count == 1, let provider = providers.first else { return false }
            _ = provider.loadFileRepresentation(forTypeIdentifier: UTType.data.identifier) { url, _ in
                guard let url, let bytes = try? Data(contentsOf: url) else { return }
                let name = provider.suggestedName.map { n in (n as NSString).pathExtension.isEmpty ? n + "." + url.pathExtension : n } ?? url.lastPathComponent
                Task { @MainActor in await model.choose(side, name: name, bytes: bytes) }
            }
            return true
        }
    }

    @ViewBuilder
    private func chosen(_ input: InputFile) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(input.name).lineLimit(2)
                    Text(subtitle(input)).font(.footnote).foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: input.format == .xlsx ? "tablecells" : "doc.text")
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(side.title): \(input.name), \(subtitle(input))")
            .accessibilityIdentifier("\(side.rawValue)-file")
            Spacer()
            Button("Replace") { choosing = true }
                .buttonStyle(.borderless)
                .accessibilityLabel("Replace the \(side.rawValue) file")
                .accessibilityIdentifier("\(side.rawValue)-replace")
        }
        if input.format == .csv {
            Picker("Encoding", selection: Binding(get: { input.encoding }, set: { e in Task { await model.setEncoding(side, e) } })) {
                Text("UTF-8").tag("utf-8")
                Text("UTF-16").tag("utf-16")
                Text("GB18030").tag("gb18030")
            }
            .accessibilityIdentifier("\(side.rawValue)-encoding")
        }
        if let sheets = input.sheets, sheets.count > 1 {
            Picker("Worksheet", selection: Binding(get: { input.worksheet ?? "" }, set: { w in Task { await model.setWorksheet(side, w) } })) {
                if input.worksheet == nil { Text("Choose").tag("") }
                ForEach(sheets, id: \.self) { sheet in
                    Text(sheet.state == "visible" ? sheet.name : "\(sheet.name) (\(sheet.state))").tag(sheet.name)
                }
            }
            .accessibilityIdentifier("\(side.rawValue)-worksheet")
        }
        switch input.profile {
        case .reading:
            HStack { ProgressView(); Text("Reading the file…").foregroundStyle(.secondary) }
        case .chooseWorksheet:
            Text("The workbook has \(input.sheets?.count ?? 0) sheets. Nothing is read until you choose one.")
                .font(.footnote).foregroundStyle(.secondary)
        case .refused(let message):
            VStack(alignment: .leading, spacing: 4) {
                VerdictMark(verdict: .refused, font: .subheadline)
                Text(message).font(.callout.monospaced()).textSelection(.enabled)
                Text("A check would refuse this file with this message. Nothing was concluded.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("\(side.rawValue)-refused")
        case .ready(let profile):
            ProfileRows(profile: profile)
        }
    }

    private func subtitle(_ input: InputFile) -> String {
        let size = ByteCountFormatter.string(fromByteCount: Int64(input.bytes.count), countStyle: .file)
        return input.format == .xlsx ? "Excel workbook · \(size)" : "CSV · \(size)"
    }
}

/// The file profile: read from the file, before any check, and labelled so.
struct ProfileRows: View {
    var profile: ProfileResult.Profile
    @State private var showingColumns = false

    var body: some View {
        LabeledContent("Rows", value: profile.rows.formatted())
            .accessibilityIdentifier("profile-rows")
        if let book = profile.workbook {
            LabeledContent("Worksheet", value: book.worksheet)
            let shown = book.cells.filter { $0.value > 0 }.sorted { $0.key < $1.key }
            if !shown.isEmpty {
                Text("Read as stored, not as displayed: " + shown.map { "\($0.value.formatted()) \($0.key.replacingOccurrences(of: "_", with: " "))" }.joined(separator: ", "))
                    .font(.footnote).foregroundStyle(.secondary)
            }
        } else {
            LabeledContent("Read as", value: "\(profile.encoding.uppercased()) · \(bom(profile.bom)) · \(endings(profile.endings))")
        }
        DisclosureGroup("Columns and empty cells (\(profile.columns.count))", isExpanded: $showingColumns) {
            ForEach(Array(profile.columns.enumerated()), id: \.offset) { _, column in
                LabeledContent {
                    Text("\(column.empty.formatted()) empty")
                } label: {
                    Text(column.name).font(.body.monospaced())
                }
            }
        }
        Text("File profile · read from the file, before any check")
            .font(.caption).foregroundStyle(.secondary)
    }

    private func bom(_ b: String) -> String { b == "none" ? "no byte order mark" : "byte order mark" }

    private func endings(_ e: ProfileResult.Endings) -> String {
        let kinds = [("LF", e.lf), ("CRLF", e.crlf), ("CR", e.cr)].filter { $0.1 > 0 }
        if kinds.isEmpty { return "no line breaks" }
        if kinds.count == 1 { return "line endings \(kinds[0].0)" }
        return "line endings " + kinds.map { "\($0.0) \($0.1)" }.joined(separator: ", ")
    }
}
