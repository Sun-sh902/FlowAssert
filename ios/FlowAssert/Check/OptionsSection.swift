import SwiftUI

/// The command line's options that the CSV check page does not offer, each at the command line's default until
/// changed: --details, --redact-values, --max-bytes and --max-rows.
struct OptionsSection: View {
    @Bindable var model: CheckModel
    @State private var expanded = false

    var body: some View {
        Section {
            DisclosureGroup("Options", isExpanded: $expanded) {
                Picker("Details", selection: $model.details) {
                    Text("problems — the default").tag("problems")
                    Text("all — every record in full").tag("all")
                }
                .accessibilityIdentifier("details")
                Toggle(isOn: $model.redactValues) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Leave keys and compared values out of the reports")
                        Text("There are then no records to resend, because they would hold the values.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("redact-values")
                LimitField(title: "Largest file, in bytes", placeholder: "209715200 (200 MiB)", text: $model.maxBytes, id: "max-bytes")
                LimitField(title: "Most data rows in a file", placeholder: "1000000", text: $model.maxRows, id: "max-rows")
            }
            .accessibilityIdentifier("options")
        } footer: {
            Text("As the command line's --details, --redact-values, --max-bytes and --max-rows.")
        }
    }
}

struct LimitField: View {
    var title: String
    var placeholder: String
    @Binding var text: String
    var id: String

    var body: some View {
        LabeledContent(title) {
            TextField(placeholder, text: $text)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .font(.body.monospacedDigit())
                .accessibilityIdentifier(id)
        }
    }
}
