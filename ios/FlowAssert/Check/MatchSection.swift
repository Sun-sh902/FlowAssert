import SwiftUI

/// The key column in each input, the compared fields with a rule each, and the scope: chosen by the person, never
/// guessed. Or an imported configuration file, used as its bytes while its choices are unchanged.
struct MatchSection: View {
    @Bindable var model: CheckModel
    @Binding var importing: Bool
    @Binding var exporting: ConfigurationDocument?
    @Binding var problem: String?

    var body: some View {
        Section {
            ColumnPicker(title: "Key in the source", columns: model.source?.columns ?? [], selection: $model.keySource, typed: model.sourceKind == .sheet)
                .accessibilityIdentifier("key-source")
            ColumnPicker(title: "Key in the destination", columns: model.destination?.columns ?? [], selection: $model.keyDestination, typed: model.destinationKind == .hubspot)
                .accessibilityIdentifier("key-destination")
        } header: {
            Text("Key")
        } footer: {
            Text("The stable record identifier, as each file names it. Chosen by you, never guessed.")
        }

        Section {
            ForEach($model.fields) { $field in
                FieldEditor(field: $field, sourceColumns: model.source?.columns ?? [], destinationColumns: model.destination?.columns ?? [],
                            index: (model.fields.firstIndex { $0.id == field.id } ?? 0) + 1,
                            sourceTyped: model.sourceKind == .sheet, destinationTyped: model.destinationKind == .hubspot)
            }
            .onDelete { model.fields.remove(atOffsets: $0) }
            Button {
                model.fields.append(FieldRow())
            } label: {
                Label("Add a field", systemImage: "plus")
            }
            .accessibilityIdentifier("add-field")
            Picker("Scope", selection: $model.scope) {
                Text("source — check each source record").tag("source")
                Text("exact — also report destination keys that are not in the source").tag("exact")
            }
            .accessibilityIdentifier("scope")
        } header: {
            Text("Compared fields")
        } footer: {
            Text("Comparison is exact unless you choose a rule. Rules are never inferred.")
        }

        Section {
            if let loaded = model.loaded {
                LabeledContent("Configuration file", value: loaded.name)
                Text(model.usesLoadedConfiguration
                     ? "The check reads this file as it is. Changing a choice above uses your choices instead."
                     : "Your choices differ from the file, so the check uses your choices.")
                    .font(.footnote).foregroundStyle(.secondary)
                Button("Stop using the file", role: .destructive) { model.dropLoadedConfiguration() }
            }
            Button("Import a configuration file") { importing = true }
                .accessibilityIdentifier("import-config")
            Button("Export the configuration") {
                Task {
                    do { exporting = ConfigurationDocument(text: try await model.configurationText()) } catch { problem = error.localizedDescription }
                }
            }
            .disabled(model.keySource.isEmpty || model.keyDestination.isEmpty)
        } footer: {
            Text("The configuration file holds the key, the fields with their rules and the scope — never a premise.")
        }
    }
}

struct ColumnPicker: View {
    var title: String
    var columns: [String]
    @Binding var selection: String
    /// A side read by a connector has no file to list columns from: its column (a sheet's header, a HubSpot
    /// property's internal name) is typed.
    var typed = false

    var body: some View {
        if typed {
            LabeledContent(title) {
                TextField("Column", text: $selection)
                    .multilineTextAlignment(.trailing).font(.body.monospaced())
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
            }
        } else {
            picker
        }
    }

    private var picker: some View {
        Picker(title, selection: $selection) {
            Text("Choose").tag("")
            if !selection.isEmpty && !columns.contains(selection) {
                Text("\(selection) (not in the file)").tag(selection)
            }
            ForEach(columns, id: \.self) { Text($0).tag($0) }
        }
    }
}

struct FieldEditor: View {
    @Binding var field: FieldRow
    var sourceColumns: [String]
    var destinationColumns: [String]
    var index: Int
    var sourceTyped = false
    var destinationTyped = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ColumnPicker(title: "Source column", columns: sourceColumns, selection: $field.source, typed: sourceTyped)
                .accessibilityIdentifier("field-\(index)-source")
            ColumnPicker(title: "Destination column", columns: destinationColumns, selection: $field.destination, typed: destinationTyped)
                .accessibilityIdentifier("field-\(index)-destination")
            Picker("Rule", selection: $field.rule) {
                ForEach(FieldRow.Rule.allCases) { Text($0.label).tag($0) }
            }
            .accessibilityIdentifier("field-\(index)-rule")
            if field.rule == .date {
                TextField("Date format, such as %Y-%m-%d", text: $field.dateFormat)
                    .font(.body.monospaced())
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("field-\(index)-format")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Field \(index)")
    }
}
