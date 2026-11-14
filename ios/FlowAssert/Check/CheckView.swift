import SwiftUI
import UniformTypeIdentifiers

/// The check: one grouped form with the CSV check page's four parts, and the Check button floating over it.
struct CheckView: View {
    @Bindable var model: CheckModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var importingConfiguration = false
    @State private var exportingConfiguration: ConfigurationDocument?
    @State private var configurationProblem: String?
    @State private var showingResult = false

    var body: some View {
        List {
            if model.source == nil && model.destination == nil {
                EmptyCheckSection(model: model)
            }
            InputSection(model: model, side: .source)
            InputSection(model: model, side: .destination)
            MatchSection(model: model, importing: $importingConfiguration, exporting: $exportingConfiguration, problem: $configurationProblem)
            PremisesSection(model: model)
            OptionsSection(model: model)
            if !model.missing.isEmpty {
                Section {
                    ForEach(model.missing, id: \.self) { Text($0) }
                } header: {
                    Text("Before you can check")
                }
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("missing")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Check")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Use the example files") { Task { await model.useExample() } }
                    Button("Start again", role: .destructive) { model.reset() }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
                .accessibilityIdentifier("check-menu")
            }
        }
        .safeAreaInset(edge: .bottom) {
            CheckButton(model: model)
        }
        .fileImporter(isPresented: $importingConfiguration, allowedContentTypes: [.json, .data]) { result in
            guard case .success(let url) = result, let bytes = try? readSecurityScoped(url) else { return }
            model.importConfiguration(name: url.lastPathComponent, bytes: bytes)
        }
        .fileExporter(isPresented: Binding(get: { exportingConfiguration != nil }, set: { if !$0 { exportingConfiguration = nil } }),
                      document: exportingConfiguration, contentType: .json, defaultFilename: "flowassert-config.json") { _ in }
        .alert("The configuration cannot be written", isPresented: Binding(get: { configurationProblem != nil }, set: { if !$0 { configurationProblem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(configurationProblem ?? "")
        }
        .onChange(of: model.finishedChecks) { showingResult = true }
        .navigationDestination(isPresented: $showingResult) {
            ResultScreen(model: model)
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: model.finishedChecks)
        .animation(.state(reduceMotion), value: model.missing)
    }
}

/// Reads a file the person picked, inside its security scope.
func readSecurityScoped(_ url: URL) throws -> Data {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    return try Data(contentsOf: url)
}

struct ConfigurationDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.json]
    var text: String
    init(text: String) { self.text = text }
    init(configuration: ReadConfiguration) throws { text = String(decoding: configuration.file.regularFileContents ?? Data(), as: UTF8.self) }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: Data(text.utf8)) }
}

/// The first screen, with nothing chosen: what a check takes. No example is loaded unless asked for.
struct EmptyCheckSection: View {
    var model: CheckModel

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Text("Did the expected records arrive?")
                    .font(.title3.weight(.semibold))
                Text("Choose the records that should have arrived and an export of the system they should have reached. FlowAssert compares them record by record and says Verified only with enough evidence. The files are read on this device.")
                    .foregroundStyle(.secondary)
                Button("Use the example files") { Task { await model.useExample() } }
                    .accessibilityIdentifier("use-example")
                    .padding(.top, 4)
            }
            .padding(.vertical, 4)
        }
    }
}

/// The Check button: floating over the form, the system's glass on iOS 26 and later.
struct CheckButton: View {
    var model: CheckModel

    var body: some View {
        let running = model.run == .running
        Group {
            if running {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Checking on this device…").font(.headline)
                    Spacer()
                    Button("Cancel") { model.cancel() }
                        .accessibilityIdentifier("cancel-check")
                }
                .padding(.horizontal, 20)
                .frame(minHeight: 52)
                .modifier(Floating())
            } else {
                Button {
                    Task { await model.check() }
                } label: {
                    Text("Check").font(.headline).frame(maxWidth: .infinity, minHeight: 44)
                }
                .disabled(model.request == nil)
                .modifier(FloatingButton())
                .accessibilityIdentifier("run-check")
                .accessibilityHint(model.missing.first ?? "Runs the check on this device.")
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }
}

/// System glass for a floating control where the system has it; a solid capsule before iOS 26.
struct FloatingButton: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.buttonStyle(.glassProminent)
        } else {
            content.buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
        }
    }
}

struct Floating: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.glassEffect(.regular, in: .capsule)
        } else {
            content.background(.regularMaterial, in: .capsule)
        }
    }
}
