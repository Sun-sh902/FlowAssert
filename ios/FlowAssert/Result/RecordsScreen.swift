import SwiftUI

/// The records of a report, listed by the browser's explorer (explore.ts) in the page: a window of rows at a time.
@Observable
@MainActor
final class RecordsPager {
    static let page = 100
    let engine: CheckerEngine
    let report: OpenedReport
    var state: String?
    var search = ""
    var list = "source"
    private(set) var matched: Matched?
    private var pages: [Int: [ReportItem]] = [:]
    private var loading: Set<Int> = []
    private var generation = 0

    init(engine: CheckerEngine, report: OpenedReport, state: String?) {
        self.engine = engine
        self.report = report
        self.state = state
    }

    func reload() async {
        generation += 1
        let mine = generation
        pages = [:]
        loading = []
        let m = try? await engine.query(report.id, state: state, rule: nil, status: nil, search: search, list: list)
        guard mine == generation else { return }
        matched = m
        await load(page: 0, generation: mine)
    }

    func item(_ index: Int) -> ReportItem? {
        let p = index / Self.page
        if let items = pages[p] { return index - p * Self.page < items.count ? items[index - p * Self.page] : nil }
        if !loading.contains(p) { Task { await load(page: p, generation: generation) } }
        return nil
    }

    private func load(page p: Int, generation mine: Int) async {
        guard !loading.contains(p) else { return }
        loading.insert(p)
        let items = (try? await engine.window(report.id, start: p * Self.page, count: Self.page)) ?? []
        guard mine == generation else { return }
        pages[p] = items
        loading.remove(p)
    }
}

/// On the result: how many records are not Verified, the first of them, and the way to all of them.
struct RecordsSection: View {
    var engine: CheckerEngine
    var report: OpenedReport

    var body: some View {
        let notVerified = (report.counts["Mismatch"] ?? 0) + (report.counts["Unverified"] ?? 0)
        Section {
            NavigationLink {
                RecordsScreen(engine: engine, report: report, initialState: notVerified > 0 ? "not-verified" : nil)
            } label: {
                LabeledContent(notVerified == 0 ? "Every source record is Verified" : "Records that are not Verified", value: notVerified.formatted())
            }
            .accessibilityIdentifier("records-not-verified")
            NavigationLink {
                RecordsScreen(engine: engine, report: report, initialState: nil)
            } label: {
                LabeledContent("All records", value: report.total.formatted())
            }
            .accessibilityIdentifier("records-all")
            if let only = report.destinationOnlyTotal {
                NavigationLink {
                    RecordsScreen(engine: engine, report: report, initialState: nil, list: "destination-only")
                } label: {
                    LabeledContent("Destination keys not in the source", value: only.formatted())
                }
            }
        } header: {
            Text("Records")
        } footer: {
            if report.redacted { Text("This report was written without keys and values, so records cannot be searched.") }
        }
    }
}

struct RecordsScreen: View {
    @State private var pager: RecordsPager
    private let list: String

    init(engine: CheckerEngine, report: OpenedReport, initialState: String?, list: String = "source") {
        _pager = State(initialValue: RecordsPager(engine: engine, report: report, state: initialState))
        self.list = list
    }

    var body: some View {
        List {
            Section {
                if let m = pager.matched {
                    ForEach(0..<m.matches, id: \.self) { i in
                        if let item = pager.item(i) {
                            NavigationLink {
                                RecordDetail(engine: pager.engine, report: pager.report, item: item)
                            } label: {
                                RecordRow(item: item)
                            }
                        } else {
                            Text("…").foregroundStyle(.secondary).accessibilityLabel("Loading")
                        }
                    }
                }
            } header: {
                if let m = pager.matched {
                    Text("\(m.matches.formatted()) of \(m.of.formatted()) records match")
                        .accessibilityIdentifier("records-count")
                }
            }
        }
        .navigationTitle(list == "source" ? "Records" : "Destination-only")
        .searchable(text: $pager.search, prompt: "Key contains")
        .disabled(pager.report.redacted && !pager.search.isEmpty)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("State", selection: Binding(get: { pager.state ?? "any" }, set: { pager.state = $0 == "any" ? nil : $0 })) {
                        Text("Any state").tag("any")
                        Text("Not Verified").tag("not-verified")
                        Text("Verified").tag("Verified")
                        Text("Mismatch").tag("Mismatch")
                        Text("Unverified").tag("Unverified")
                    }
                } label: {
                    Label("Filter", systemImage: "line.3.horizontal.decrease.circle")
                }
                .accessibilityIdentifier("records-filter")
            }
        }
        .task(id: "\(pager.state ?? "any")|\(pager.search)") {
            pager.list = list
            await pager.reload()
        }
    }
}

struct RecordRow: View {
    var item: ReportItem

    var body: some View {
        HStack(spacing: 12) {
            Text(item.row.formatted()).font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
            Text(item.record.key ?? "(no key)").font(.body.monospaced()).lineLimit(1)
            Spacer(minLength: 8)
            VerdictMark(verdict: Verdict(item.record.state), font: .subheadline)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(item.record.state). Row \(item.row), key \(item.record.key ?? "none")")
    }
}

/// One record: its state, and every rule result with its reason and both values side by side.
struct RecordDetail: View {
    var engine: CheckerEngine
    var report: OpenedReport
    var item: ReportItem

    var body: some View {
        let r = item.record
        List {
            Section {
                VerdictMark(verdict: Verdict(r.state), font: .title2)
                LabeledContent(item.kind == "source" ? "Source row" : "Destination row", value: item.row.formatted())
                LabeledContent("Key") { Text(r.key ?? "(no key)").font(.body.monospaced()).textSelection(.enabled) }
                if let c = r.candidates { LabeledContent("Destination rows with this key", value: c.formatted()) }
                if let reason = r.reason { Text(reason) }
            }
            if let rules = r.rules {
                let names = report.rules.filter { rules[$0] != nil } + rules.keys.filter { !report.rules.contains($0) }.sorted()
                ForEach(names, id: \.self) { name in
                    RuleSection(engine: engine, name: name, result: rules[name]!)
                }
            } else if item.kind == "source" {
                Section {
                    Text("This report was written with details: problems. It records that this record is \(r.state), but not its rule results or values.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle(r.key ?? "Record")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct RuleSection: View {
    var engine: CheckerEngine
    var name: String
    var result: RuleResult
    @State private var diff: ValueDiff?
    @State private var compared: ValueDiff?

    var body: some View {
        Section {
            HStack {
                Text(name).font(.body.monospaced())
                Spacer()
                StatusMark(status: result.status)
            }
            .accessibilityElement(children: .combine)
            Text(result.rule.map { "\($0): \(result.reason)" } ?? result.reason).foregroundStyle(.secondary)
            if result.expected != nil || result.actual != nil {
                ValuesRow(title: "As written", diff: diff, source: result.expected, destination: result.actual)
            }
            if result.expected_normalized != nil || result.actual_normalized != nil {
                ValuesRow(title: "As compared", diff: compared, source: result.expected_normalized, destination: result.actual_normalized)
            }
            if result.status == "fail", let d = compared ?? diff {
                if !(d.sourceCodePoints + d.destinationCodePoints).isEmpty {
                    Text((d.sourceCodePoints + d.destinationCodePoints).joined(separator: "  ")).font(.footnote.monospaced()).foregroundStyle(.secondary)
                }
                Text("This highlights where the two values differ. The rule's result above is the conclusion.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .task {
            if let a = result.expected, let b = result.actual { diff = try? await engine.diff(a, b) }
            if let a = result.expected_normalized, let b = result.actual_normalized { compared = try? await engine.diff(a, b) }
        }
    }
}

/// The source and destination values side by side; where a failed rule compared them, what differs is marked
/// (struck through in the source, underlined in the destination), and invisible characters are drawn as tokens.
struct ValuesRow: View {
    var title: String
    var diff: ValueDiff?
    var source: String?
    var destination: String?

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 16) { column("Source", source, diff?.source, deleted: true); column("Destination", destination, diff?.destination, deleted: false) }
            VStack(alignment: .leading, spacing: 10) { column("Source", source, diff?.source, deleted: true); column("Destination", destination, diff?.destination, deleted: false) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }

    private func column(_ label: String, _ value: String?, _ runs: [ValueDiff.Run]?, deleted: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(label) · \(title.lowercased())").font(.caption).foregroundStyle(.secondary)
            if let value {
                if value.isEmpty { Text("empty").italic().foregroundStyle(.secondary) }
                else if let runs { DiffText(runs: runs, deleted: deleted).font(.body.monospaced()).textSelection(.enabled) }
                else { Text(value).font(.body.monospaced()).textSelection(.enabled) }
            } else {
                Text("none").italic().foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct DiffText: View {
    var runs: [ValueDiff.Run]
    var deleted: Bool

    var body: some View {
        runs.reduce(Text("")) { text, run in
            run.pieces.reduce(text) { t, piece in
                var p = Text(piece.text)
                if piece.token == true { p = p.foregroundStyle(.secondary).font(.caption.monospaced()) }
                if run.kind != "same" {
                    p = deleted ? p.strikethrough().bold() : p.underline().bold()
                }
                return t + p
            }
        }
    }
}
