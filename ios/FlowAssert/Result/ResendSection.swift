import SwiftUI

/// The records to resend: the checker's export files, each with its rows and meaning, shared as the bytes the command
/// line's --export-dir writes.
struct ResendSection: View {
    var exports: [CheckExport]
    var shared: SharedFiles

    var body: some View {
        Section {
            ForEach(exports, id: \.file) { export in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(export.file).font(.body.monospaced()).lineLimit(2)
                        Spacer()
                        ShareLink(item: shared.url(export.text, export.file)) {
                            Label("Share \(export.file)", systemImage: "square.and.arrow.up")
                                .labelStyle(.iconOnly)
                        }
                        .accessibilityIdentifier("share-\(export.file)")
                    }
                    Text("\(export.rows.formatted()) \(export.rows == 1 ? "row" : "rows") · \(export.meaning)")
                        .font(.footnote).foregroundStyle(.secondary)
                    if export.formulaFields > 0 {
                        Text("\(export.formulaFields.formatted()) \(export.formulaFields == 1 ? "field begins" : "fields begin") with =, +, -, @, a tab or a carriage return; a spreadsheet may run it as a formula. FlowAssert does not change it.")
                            .font(.footnote).foregroundStyle(Verdict.unverified.color)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        } header: {
            Text("Records to resend")
        } footer: {
            Text("Each row as it was read, every column, in UTF-8 with a byte order mark, as the command line's --export-dir writes it.")
        }
    }
}
