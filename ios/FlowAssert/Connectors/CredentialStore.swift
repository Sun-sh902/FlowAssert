import Foundation
import Security

/// The credentials of the two read-only connectors, kept only in the Keychain of this device: generic passwords with
/// `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, never synchronized, never in `UserDefaults` or a file, never shown
/// again once saved. They leave the Keychain only into the request a `ConnectorTransport` sends; JavaScript, the
/// reports, the logs and the files never see them.
///
/// The forms accepted are exactly the command line's (docs/connectors/): for Google Sheets an OAuth access token or an
/// API key (only one at a time), for HubSpot a private app access token; each printable ASCII without spaces, at most
/// 4,096 characters. A credential of another form is refused with the command line's text.
enum CredentialKind: String, CaseIterable, Identifiable, Sendable {
    case sheetsToken = "sheets-token"
    case sheetsKey = "sheets-key"
    case hubspotToken = "hubspot-token"

    var id: String { rawValue }

    /// The environment variable the command line reads it from, which its refusals name.
    var variable: String {
        switch self {
        case .sheetsToken: "FLOWASSERT_SHEETS_TOKEN"
        case .sheetsKey: "FLOWASSERT_SHEETS_API_KEY"
        case .hubspotToken: "FLOWASSERT_HUBSPOT_TOKEN"
        }
    }

    var service: String { self == .hubspotToken ? "hubspot" : "sheets" }
}

enum CredentialError: LocalizedError, Equatable {
    case notACredential(String)
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .notACredential(let variable): "\(variable) does not hold a credential: printable ASCII without spaces, at most 4096 characters"
        case .keychain(let status): "The Keychain did not keep it (status \(status))."
        }
    }
}

final class CredentialStore: @unchecked Sendable {
    static let service = "io.github.sunsh902.flowassert.credentials"
    let service: String

    init(service: String = CredentialStore.service) {
        self.service = service
    }

    /// The command line's rule: printable ASCII without spaces (0x21 to 0x7E), 1 to 4,096 characters.
    static func isCredential(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        return (1...4096).contains(bytes.count) && bytes.count == value.unicodeScalars.count && bytes.allSatisfy { (0x21...0x7E).contains($0) }
    }

    private func query(_ kind: CredentialKind) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: kind.rawValue,
         kSecAttrSynchronizable as String: kCFBooleanFalse as Any]
    }

    /// Saves a credential. Google Sheets holds one kind at a time, as the command line refuses both.
    func save(_ value: String, as kind: CredentialKind) throws {
        guard Self.isCredential(value) else { throw CredentialError.notACredential(kind.variable) }
        if kind == .sheetsToken { try remove(.sheetsKey) }
        if kind == .sheetsKey { try remove(.sheetsToken) }
        try remove(kind)
        var item = query(kind)
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw CredentialError.keychain(status) }
    }

    func remove(_ kind: CredentialKind) throws {
        let status = SecItemDelete(query(kind) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw CredentialError.keychain(status) }
    }

    func isSaved(_ kind: CredentialKind) -> Bool {
        var q = query(kind)
        q[kSecReturnAttributes as String] = true
        return SecItemCopyMatching(q as CFDictionary, nil) == errSecSuccess
    }

    /// Only for the request a transport sends.
    func value(_ kind: CredentialKind) -> String? {
        var q = query(kind)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// What the checker is told: which variables the command line would find set, each with a placeholder that has
    /// the accepted form. Never a credential.
    func environment() -> [String: String] {
        var out: [String: String] = [:]
        for kind in CredentialKind.allCases where isSaved(kind) { out[kind.variable] = "saved-in-the-keychain" }
        return out
    }
}
