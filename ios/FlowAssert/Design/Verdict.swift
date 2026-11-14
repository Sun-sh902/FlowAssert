import SwiftUI
import UIKit

/// A state the checker gives: the batch's or a record's result, a refusal or a failure. Colour is the only place the
/// app uses colour for meaning, and it is never alone: every state has its own shape and its word is always shown.
enum Verdict: String, CaseIterable, Sendable {
    case verified = "Verified"
    case mismatch = "Mismatch"
    case unverified = "Unverified"
    case refused = "refused"
    case failed = "failed"

    init(_ state: String) {
        self = Verdict(rawValue: state) ?? (state == "Pending" ? .unverified : .failed)
    }

    /// Filled for a conclusion the evidence supports, outlined or dashed for one it does not.
    var symbol: String {
        switch self {
        case .verified: "checkmark.circle.fill"
        case .mismatch: "xmark.diamond.fill"
        case .unverified: "questionmark.circle.dashed"
        case .refused: "nosign"
        case .failed: "exclamationmark.triangle"
        }
    }

    /// Light, dark, and each with Increase Contrast; checked against the system backgrounds for 4.5:1 or more.
    var color: Color {
        switch self {
        case .verified: Self.dynamic(light: 0x1F7A47, dark: 0x5FD08C, lightHigh: 0x135C33, darkHigh: 0x8AE6AE)
        case .mismatch: Self.dynamic(light: 0xC0341D, dark: 0xFF7A63, lightHigh: 0x962412, darkHigh: 0xFFA595)
        case .unverified: Self.dynamic(light: 0x8A5A00, dark: 0xF0B848, lightHigh: 0x6B4500, darkHigh: 0xFFD27A)
        case .refused, .failed: Color(uiColor: .secondaryLabel)
        }
    }

    private static func dynamic(light: UInt32, dark: UInt32, lightHigh: UInt32, darkHigh: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            let high = traits.accessibilityContrast == .high
            let hex = traits.userInterfaceStyle == .dark ? (high ? darkHigh : dark) : (high ? lightHigh : light)
            return UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        })
    }
}

/// The verdict as a shape and its word, read by VoiceOver as the word.
struct VerdictMark: View {
    var verdict: Verdict
    var font: Font = .body

    var body: some View {
        // Not a Label: in a list row a Label's icon is set in the leading margin, past the content's edge.
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: verdict.symbol).fontWeight(.semibold)
            Text(verdict.rawValue).fontWeight(.semibold)
        }
        .font(font)
        .foregroundStyle(verdict.color)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(verdict.rawValue)
    }
}

/// A rule result: pass, fail or unknown, each with its own shape and its word.
struct StatusMark: View {
    var status: String

    var body: some View {
        let (symbol, verdict): (String, Verdict) = switch status {
        case "pass": ("checkmark", .verified)
        case "fail": ("xmark", .mismatch)
        default: ("questionmark", .unverified)
        }
        Label(status, systemImage: symbol)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(verdict.color)
            .labelStyle(.titleAndIcon)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(status)
    }
}

extension Animation {
    /// State changes: a spring without bounce, or nothing when Reduce Motion is on.
    static func state(_ reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .smooth(duration: 0.3)
    }
}
