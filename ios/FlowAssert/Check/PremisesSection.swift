import SwiftUI

/// What the person states, with the CSV check page's titles and explanations word for word. FlowAssert cannot check
/// any of them; each is recorded in the report with its origin, the iPhone and iPad app.
struct PremisesSection: View {
    @Bindable var model: CheckModel

    var body: some View {
        Section {
            Text("FlowAssert cannot check these statements. Each one you make is recorded in the report, with its origin, the iPhone and iPad app. A wrong statement gives a wrong result.")
                .font(.footnote).foregroundStyle(.secondary)
            Statement(title: "The source file is the whole batch",
                      explanation: "Tick only if this file holds every record that should have reached the destination. Without this statement the batch can never be Verified.",
                      isOn: $model.sourceComplete, id: "source-complete")
            Statement(title: "The destination export covers the whole object",
                      explanation: "Tick only if the export holds every record of that object in the destination system, not a filtered view or one page of it. Without this statement, missing records and duplicates stay unknown.",
                      isOn: $model.destinationComplete, id: "destination-complete")
            CountField(title: "Source total seen in the original system (optional)",
                       hint: "Compared with the rows in the file. A count that differs withdraws the source statement.",
                       text: $model.sourceCount, id: "source-count")
            CountField(title: "Destination total seen in the original system (optional)",
                       hint: "Compared with the rows in the export. A count that differs withdraws the destination statement.",
                       text: $model.destinationCount, id: "destination-count")
            Statement(title: "Allow identical content",
                      explanation: "Two files with exactly the same bytes are refused, because the check would not be independent. Tick only if they really come from different systems.",
                      isOn: $model.allowIdenticalContent, id: "allow-identical")
        } header: {
            Text("What you state")
        } footer: {
            Text("Not checked by FlowAssert.")
        }
    }
}

struct Statement: View {
    var title: String
    var explanation: String
    @Binding var isOn: Bool
    var id: String

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                Text(explanation).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .accessibilityIdentifier(id)
    }
}

struct CountField: View {
    var title: String
    var hint: String
    @Binding var text: String
    var id: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
            // Typed as it is: the checker decides whether it is a count, and refuses it in its own words otherwise.
            TextField("Not stated", text: $text)
                .keyboardType(.numberPad)
                .font(.body.monospacedDigit())
                .accessibilityLabel(title)
                .accessibilityIdentifier(id)
            Text(hint).font(.footnote).foregroundStyle(.secondary)
        }
    }
}
