import Foundation
import Observation
import UniformTypeIdentifiers

/// One input of a check, as the person chose it. Its bytes are never decoded or read by Swift: the profile, the
/// worksheet listing and the check all come from the engine.
struct InputFile: Equatable {
    enum Format: String { case csv, xlsx }
    enum Profile: Equatable {
        case reading
        /// A workbook with several sheets: nothing is read until one is chosen.
        case chooseWorksheet
        case ready(ProfileResult.Profile)
        /// The refusal a check would give this file, in the checker's words.
        case refused(String)
    }

    var name: String
    var bytes: Data
    var format: Format
    var encoding = "utf-8"
    var sheets: [Sheet]?
    var worksheet: String?
    var profile: Profile = .reading

    /// A file is read as a workbook when its name says so, or its first bytes are a ZIP archive's or an OLE compound
    /// file's, as the CSV check page decides (so a legacy or protected workbook gets the workbook refusal, not a CSV one).
    static func format(name: String, bytes: Data) -> Format {
        let ext = (name as NSString).pathExtension.lowercased()
        if ["xlsx", "xlsm", "xlsb", "xltx", "xls"].contains(ext) { return .xlsx }
        let head = [UInt8](bytes.prefix(8))
        let zip = head.count >= 4 && head[0] == 0x50 && head[1] == 0x4B && head[2] == 3 && head[3] == 4
        let ole = head == [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
        return zip || ole ? .xlsx : .csv
    }

    var engineFile: EngineFile {
        EngineFile(name: name, bytes: bytes, encoding: format == .csv ? encoding : nil, format: format == .xlsx ? "xlsx" : nil,
                   worksheet: format == .xlsx ? worksheet : nil)
    }

    var columns: [String] {
        if case .ready(let p) = profile { return p.columns.map(\.name) }
        return []
    }
}

enum Side: String, CaseIterable, Identifiable {
    case source, destination
    var id: String { rawValue }
    /// The CSV check page's names for the two files.
    var title: String { self == .source ? "Source" : "Destination" }
    var explanation: String {
        self == .source ? "The records that should have reached the destination." : "An export from the system the records should have reached."
    }
}

/// A compared field: a source column, a destination column and a rule, never inferred.
struct FieldRow: Identifiable, Equatable {
    enum Rule: String, CaseIterable, Identifiable {
        case exact, trim, casefold, digits, date
        var id: String { rawValue }
        /// The CSV check page's words for each rule.
        var label: String {
            switch self {
            case .exact: "exact — the strings as they are"
            case .trim: "trim — without leading and trailing spaces"
            case .casefold: "casefold — ignoring upper and lower case"
            case .digits: "digits — only the digits 0–9"
            case .date: "date — read with a date format"
            }
        }
    }

    let id = UUID()
    var source = ""
    var destination = ""
    var rule: Rule = .exact
    var dateFormat = ""

    /// The rule as a configuration writes it: `date:FORMAT` for a date.
    var ruleText: String { rule == .date ? "date:\(dateFormat)" : rule.rawValue }
}

/// A configuration file the person imported, kept as its bytes so that its SHA-256 is the file's.
struct LoadedConfiguration: Equatable {
    var name: String
    var bytes: Data
}

@Observable
@MainActor
final class CheckModel {
    enum Run: Equatable {
        case idle
        case running
        /// A check that ran: a result, a refusal or a failure, exactly as the checker gave it.
        case finished(CheckResult)
        /// The engine itself could not run the check (not a refusal, which is a result).
        case broken(String)
    }

    let engine: CheckerEngine
    var source: InputFile?
    var destination: InputFile?
    var keySource = ""
    var keyDestination = ""
    var fields: [FieldRow] = [FieldRow()]
    var scope = "source"
    /// An imported configuration, used as long as the choices it filled in are not changed.
    var loaded: LoadedConfiguration?
    private var loadedChoices: String?

    // What the person states. The CSV check page's words are in PremisesSection.
    var sourceComplete = false
    var destinationComplete = false
    var sourceCount = ""
    var destinationCount = ""
    var allowIdenticalContent = false

    // The command line's options the CSV check page does not have, each at its default until changed.
    var details = "problems"
    var redactValues = false
    var maxBytes = ""
    var maxRows = ""

    var run: Run = .idle
    /// How many checks have finished, for the haptic and for tests.
    var finishedChecks = 0

    init(engine: CheckerEngine) {
        self.engine = engine
    }

    func input(_ side: Side) -> InputFile? { side == .source ? source : destination }

    private func set(_ side: Side, _ input: InputFile?) {
        if side == .source { source = input } else { destination = input }
    }

    // MARK: Inputs

    /// Takes a file for one side and reads what the page reads before a check: a workbook's sheets, the profile.
    func choose(_ side: Side, name: String, bytes: Data) async {
        var input = InputFile(name: name, bytes: bytes, format: InputFile.format(name: name, bytes: bytes))
        set(side, input)
        if side == .source { keySource = "" } else { keyDestination = "" }
        if input.format == .xlsx {
            let listed = try? await engine.sheets(input.engineFile)
            guard self.input(side)?.bytes == bytes else { return }
            if let listed, listed.ok, let sheets = listed.sheets {
                input.sheets = sheets
                if sheets.count > 1 {
                    input.profile = .chooseWorksheet
                    set(side, input)
                    return
                }
            } else if let listed, let message = listed.message {
                input.profile = .refused(message)
                set(side, input)
                return
            }
        }
        set(side, input)
        await readProfile(side)
    }

    func setEncoding(_ side: Side, _ encoding: String) async {
        guard var input = input(side), input.encoding != encoding else { return }
        input.encoding = encoding
        input.profile = .reading
        set(side, input)
        await readProfile(side)
    }

    func setWorksheet(_ side: Side, _ worksheet: String) async {
        guard var input = input(side) else { return }
        input.worksheet = worksheet
        input.profile = .reading
        set(side, input)
        await readProfile(side)
    }

    func remove(_ side: Side) {
        set(side, nil)
        if side == .source { keySource = "" } else { keyDestination = "" }
    }

    private func readProfile(_ side: Side) async {
        guard let asked = input(side) else { return }
        let profile: InputFile.Profile
        do {
            let result = try await engine.profile(asked.engineFile)
            if result.ok, let p = result.profile { profile = .ready(p) } else { profile = .refused(result.message ?? "") }
        } catch {
            profile = .refused(error.localizedDescription)
        }
        // A newer choice for this side wins.
        guard var now = input(side), now.bytes == asked.bytes, now.encoding == asked.encoding, now.worksheet == asked.worksheet else { return }
        now.profile = profile
        set(side, now)
        // The only column, or the one both sides share as the first, is not chosen for the person: keys are chosen.
    }

    // MARK: Configuration

    private func choicesFingerprint() -> String {
        ([keySource, keyDestination, scope] + fields.flatMap { [$0.source, $0.destination, $0.ruleText] }).joined(separator: "\u{1F}")
    }

    /// Fills the choices from an imported configuration file and keeps its bytes. What it holds is shown; the check
    /// reads the file itself and refuses it in its own words when it is not a configuration.
    func importConfiguration(name: String, bytes: Data) {
        var text = bytes
        if text.starts(with: [0xEF, 0xBB, 0xBF]) { text = text.dropFirst(3) }
        if let object = try? JSONSerialization.jsonObject(with: text) as? [String: Any] {
            if let key = object["key"] as? [String], key.count == 2 { keySource = key[0]; keyDestination = key[1] }
            if let list = object["fields"] as? [Any] {
                fields = list.compactMap { item in
                    var row = FieldRow()
                    if let pair = item as? [String], pair.count >= 2 {
                        row.source = pair[0]; row.destination = pair[1]
                    } else if let f = item as? [String: Any] {
                        row.source = f["source"] as? String ?? ""
                        row.destination = f["destination"] as? String ?? ""
                        let rule = f["rule"] as? String ?? "exact"
                        if rule.hasPrefix("date:") { row.rule = .date; row.dateFormat = String(rule.dropFirst(5)) } else { row.rule = FieldRow.Rule(rawValue: rule) ?? .exact }
                    } else { return nil }
                    return row
                }
            }
            if let s = object["scope"] as? String { scope = s }
        }
        loaded = LoadedConfiguration(name: name, bytes: bytes)
        loadedChoices = choicesFingerprint()
    }

    /// The imported file is used only while its choices are unchanged.
    var usesLoadedConfiguration: Bool { loaded != nil && loadedChoices == choicesFingerprint() }

    func dropLoadedConfiguration() {
        loaded = nil
        loadedChoices = nil
    }

    /// The configuration file of the current choices, written by the checker's own writer.
    func configurationText() async throws -> String {
        try await engine.configuration(key: (keySource, keyDestination), fields: fields.map { ($0.source, $0.destination, $0.ruleText) }, scope: scope)
    }

    // MARK: Checking

    /// What is still missing before a check can run, in order; empty when it can run.
    var missing: [String] {
        var out: [String] = []
        if source == nil { out.append("Choose a source file.") }
        if destination == nil { out.append("Choose a destination file.") }
        if source?.profile == .chooseWorksheet { out.append("Choose the source worksheet.") }
        if destination?.profile == .chooseWorksheet { out.append("Choose the destination worksheet.") }
        if !usesLoadedConfiguration {
            if keySource.isEmpty || keyDestination.isEmpty { out.append("Choose the key column in both files.") }
            if !fields.contains(where: { !$0.source.isEmpty && !$0.destination.isEmpty }) { out.append("Choose at least one compared field.") }
        }
        return out
    }

    var request: CheckRequest? {
        guard let source, let destination, missing.isEmpty else { return nil }
        let config: EngineConfig = usesLoadedConfiguration
            ? .loaded(loaded!.bytes)
            : .chosen(key: (keySource, keyDestination), fields: fields.filter { !$0.source.isEmpty || !$0.destination.isEmpty }.map { ($0.source, $0.destination, $0.ruleText) }, scope: scope)
        var r = CheckRequest(source: source.engineFile, destination: destination.engineFile, config: config)
        r.sourceComplete = sourceComplete
        r.destinationComplete = destinationComplete
        r.sourceCount = sourceCount.isEmpty ? nil : sourceCount
        r.destinationCount = destinationCount.isEmpty ? nil : destinationCount
        r.allowIdenticalContent = allowIdenticalContent
        r.details = details == "problems" ? nil : details
        r.redactValues = redactValues
        r.exports = !redactValues
        r.maxBytes = maxBytes.isEmpty ? nil : maxBytes
        r.maxRows = maxRows.isEmpty ? nil : maxRows
        r.openReport = true
        return r
    }

    func check() async {
        guard let request else { return }
        run = .running
        do {
            let result = try await engine.check(request)
            run = .finished(result)
        } catch {
            run = run == .running ? .broken(error.localizedDescription) : run
        }
        finishedChecks += 1
    }

    func cancel() {
        engine.cancel()
        run = .idle
    }

    /// Back to nothing chosen and nothing stated: every check starts from what the person chooses and states.
    func reset() {
        source = nil
        destination = nil
        keySource = ""
        keyDestination = ""
        fields = [FieldRow()]
        scope = "source"
        dropLoadedConfiguration()
        sourceComplete = false
        destinationComplete = false
        sourceCount = ""
        destinationCount = ""
        allowIdenticalContent = false
        details = "problems"
        redactValues = false
        maxBytes = ""
        maxRows = ""
        run = .idle
    }

    /// The files of the command line's first example (offline/examples/), bundled in the app, for a first check.
    func useExample() async {
        guard let s = Bundle.main.url(forResource: "example-source", withExtension: "csv"),
              let d = Bundle.main.url(forResource: "example-destination", withExtension: "csv"),
              let sb = try? Data(contentsOf: s), let db = try? Data(contentsOf: d) else { return }
        await choose(.source, name: "source.csv", bytes: sb)
        await choose(.destination, name: "destination.csv", bytes: db)
    }
}
