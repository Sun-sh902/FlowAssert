import SwiftUI

/// The credentials of the two read-only connectors: typed once, kept in this device's Keychain only, never shown again.
/// What each is for and which scope to grant, in the connector notes' words (docs/connectors/), shortened.
struct CredentialsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        List {
            Section {
                Text("Each credential is kept only in this device's Keychain: not synced, not backed up to another device, never shown again. It is sent only to Google's or HubSpot's documented hosts, read-only, when you run a check that reads from them. It is never in a report, a file or a log. FlowAssert does not sign in for you.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            CredentialSection(
                title: "Google Sheets",
                kinds: [(.sheetsToken, "OAuth access token"), (.sheetsKey, "API key")],
                explanation: "An OAuth access token with the read-only scopes spreadsheets.readonly and drive.metadata.readonly (without the second, turn off reading the file's version), or an API key, for a sheet shared so that anyone with the link can view it. One of the two at a time.")
            CredentialSection(
                title: "HubSpot",
                kinds: [(.hubspotToken, "Private app access token")],
                explanation: "A private app access token with the scope crm.objects.contacts.read only. The sensitive-data scopes are not needed and should not be granted.")
        }
        .navigationTitle("Credentials")
    }
}

struct CredentialSection: View {
    var title: String
    var kinds: [(CredentialKind, String)]
    var explanation: String
    @Environment(AppModel.self) private var app
    @State private var kind: CredentialKind?
    @State private var typed = ""
    @State private var problem: String?
    @FocusState private var focused: Bool

    var body: some View {
        let saved = kinds.first { app.credentialSaved($0.0) }
        Section {
            if let saved {
                LabeledContent(saved.1, value: "Saved")
                    .accessibilityIdentifier("\(saved.0.rawValue)-saved")
                Button("Remove", role: .destructive) {
                    try? app.engine.credentials.remove(saved.0)
                    app.credentialsChanged += 1
                }
                .accessibilityIdentifier("\(saved.0.rawValue)-remove")
            } else {
                if kinds.count > 1 {
                    Picker("Kind", selection: Binding(get: { kind ?? kinds[0].0 }, set: { kind = $0 })) {
                        ForEach(kinds, id: \.0) { Text($0.1).tag($0.0) }
                    }
                }
                let chosen = kind ?? kinds[0].0
                SecureField(kinds.first { $0.0 == chosen }?.1 ?? "", text: $typed)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .textContentType(.password)
                    .focused($focused)
                    .accessibilityIdentifier("\(chosen.rawValue)-field")
                Button("Save in the Keychain") {
                    do {
                        try app.engine.credentials.save(typed, as: chosen)
                        problem = nil
                        app.credentialsChanged += 1
                    } catch {
                        problem = error.localizedDescription
                    }
                    // Whatever was typed is not kept in the screen.
                    typed = ""
                    focused = false
                }
                .disabled(typed.isEmpty)
                .accessibilityIdentifier("\(chosen.rawValue)-save")
                if let problem {
                    Text(problem).font(.footnote).foregroundStyle(Verdict.mismatch.color)
                        .accessibilityIdentifier("credential-problem")
                }
            }
        } header: {
            Text(title)
        } footer: {
            Text(explanation)
        }
    }
}
