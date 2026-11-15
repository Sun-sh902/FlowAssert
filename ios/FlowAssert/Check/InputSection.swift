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
            KindPicker(model: model, side: side)
            if side == .source && model.sourceKind == .sheet {
                SheetFields(model: model)
            } else if side == .destination && model.destinationKind == .hubspot {
                HubSpotFields()
            } else if let input = model.input(side) {
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

/// File or connector, for one side.
struct KindPicker: View {
    @Bindable var model: CheckModel
    var side: Side

    var body: some View {
        if side == .source {
            Picker("Read from", selection: $model.sourceKind) {
                Text("A file").tag(CheckModel.SourceKind.file)
                Text("Google Sheets").tag(CheckModel.SourceKind.sheet)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("source-kind")
        } else {
            Picker("Read from", selection: $model.destinationKind) {
                Text("A file").tag(CheckModel.DestinationKind.file)
                Text("HubSpot contacts").tag(CheckModel.DestinationKind.hubspot)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("destination-kind")
        }
    }
}

/// A Google Sheets range: what the read shows and what it does not, in the design note's words, shortened
/// (docs/connectors/google-sheets.md).
struct SheetFields: View {
    @Bindable var model: CheckModel
    @Environment(AppModel.self) private var app

    var body: some View {
        TextField("Spreadsheet ID", text: $model.spreadsheetId)
            .textInputAutocapitalization(.never).autocorrectionDisabled().font(.body.monospaced())
            .accessibilityIdentifier("spreadsheet-id")
        TextField("Range, such as Leads!A1:F or Leads!A1:F500", text: $model.sheetRange)
            .textInputAutocapitalization(.never).autocorrectionDisabled().font(.body.monospaced())
            .accessibilityIdentifier("sheet-range")
        Toggle(isOn: $model.skipRevision) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Do not read the file's version")
                Text("Without it the report says the read cannot be tied to a revision. Needed with a token that has only the Sheets scope.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .accessibilityIdentifier("skip-revision")
        CredentialStatus(saved: app.credentialSaved(.sheetsToken) ? "an OAuth access token" : app.credentialSaved(.sheetsKey) ? "an API key" : nil)
        Text("FlowAssert reads the range itself, read-only: the file's version before and after, and the values. It shows which values the range held when it was read, with no export step between. It does not show that the range holds every record that should exist: that stays your statement, below. The first row of the range is the header.")
            .font(.footnote).foregroundStyle(.secondary)
    }
}

/// HubSpot's contacts: what the read shows and what it does not (docs/connectors/hubspot.md), shortened.
struct HubSpotFields: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        LabeledContent("Object", value: "contacts")
        CredentialStatus(saved: app.credentialSaved(.hubspotToken) ? "a private app access token" : nil)
        Text("FlowAssert lists the contacts itself, read-only, page by page, with the properties you name as the key and the fields. It shows which contacts the API listed to this token at that time. It does not show that the object is complete: contacts the token cannot see, contacts changed during the read and archived contacts are not listed.")
            .font(.footnote).foregroundStyle(.secondary)
    }
}

struct CredentialStatus: View {
    var saved: String?
    @Environment(AppModel.self) private var app

    var body: some View {
        if let saved {
            LabeledContent("Credential", value: "Saved: \(saved)")
        } else {
            Button { app.section = .credentials } label: {
                Label("No credential saved: add one in Credentials", systemImage: "key")
            }
        }
    }
}
