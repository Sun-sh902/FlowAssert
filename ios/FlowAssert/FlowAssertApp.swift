import SwiftUI

@main
struct FlowAssertApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .task {
                    await app.start()
                    #if DEBUG
                    await TestHooks.apply(app)
                    #endif
                }
                .onOpenURL { app.open(url: $0) }
        }
    }
}

/// Check and Saved reports: a sidebar on iPad, tabs on iPhone.
struct RootView: View {
    @Environment(AppModel.self) private var app
    @State private var openRefusal: String?

    var body: some View {
        @Bindable var app = app
        Group {
            if let problem = app.status?.hostProblem {
                HostProblemView(problem: "This WebKit \(problem), which the check needs. FlowAssert does not decode, encode or hash another way, so it does not check here.")
            } else if let problem = app.engineProblem {
                HostProblemView(problem: problem)
            } else {
                tabs
            }
        }
        .confirmationDialog(app.opening.map { "Open \($0.name) as" } ?? "", isPresented: Binding(get: { app.opening != nil }, set: { if !$0 { app.opening = nil } }), titleVisibility: .visible) {
            // Each button carries the file it was shown for: the dialog is dismissed before its action runs.
            if let file = app.opening {
                Button("The source") { Task { await app.use(file, as: .source) } }
                Button("The destination") { Task { await app.use(file, as: .destination) } }
                if (file.name as NSString).pathExtension.lowercased() == "json" {
                    Button("A report to keep") { Task { openRefusal = await app.keepReport(file) } }
                }
            }
            Button("Cancel", role: .cancel) { app.opening = nil }
        }
        .alert("Not a FlowAssert report", isPresented: Binding(get: { openRefusal != nil }, set: { if !$0 { openRefusal = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("\(openRefusal ?? "")\nNothing was kept.")
        }
    }

    @ViewBuilder
    private var tabs: some View {
        @Bindable var app = app
        if #available(iOS 18, *) {
            TabView(selection: $app.section) {
                Tab("Check", systemImage: "checklist", value: AppSection.check) {
                    NavigationStack { CheckView(model: app.check) }
                }
                Tab("Saved reports", systemImage: "tray.full", value: AppSection.reports) {
                    NavigationStack { SavedReportsView() }
                }
            }
            .tabViewStyle(.sidebarAdaptable)
        } else {
            TabView(selection: $app.section) {
                NavigationStack { CheckView(model: app.check) }
                    .tabItem { Label("Check", systemImage: "checklist") }
                    .tag(AppSection.check)
                NavigationStack { SavedReportsView() }
                    .tabItem { Label("Saved reports", systemImage: "tray.full") }
                    .tag(AppSection.reports)
            }
        }
    }
}

struct HostProblemView: View {
    var problem: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VerdictMark(verdict: .refused, font: .title)
            Text(problem)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

#if DEBUG
/// For the UI tests only, which cannot drive the system's Files picker: launch arguments that hand the app files from
/// paths the simulator can read, as choosing or opening them would. Not compiled into a Release build.
@MainActor
enum TestHooks {
    static func apply(_ app: AppModel) async {
        let d = UserDefaults.standard
        if d.bool(forKey: "uitestReset") { app.reports.deleteAll() }
        for side in Side.allCases {
            if let path = d.string(forKey: "uitest-\(side.rawValue)"), let bytes = try? Data(contentsOf: URL(fileURLWithPath: path)) {
                await app.check.choose(side, name: (path as NSString).lastPathComponent, bytes: bytes)
            }
        }
        if d.bool(forKey: "uitestExample") {
            // The example check with every choice made, for screenshots and measurements.
            await app.check.useExample()
            app.check.keySource = "external_id"
            app.check.keyDestination = "external_id"
            app.check.fields = [FieldRow(source: "phone", destination: "phone"), FieldRow(source: "email", destination: "hs_email")]
            app.check.sourceComplete = true
            app.check.destinationComplete = true
            if d.bool(forKey: "uitestRun") { await app.check.check() }
        }
        if let path = d.string(forKey: "uitest-open") {
            // As the system hands over a file opened in FlowAssert: a copy in the app's own folder.
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent((path as NSString).lastPathComponent)
            try? FileManager.default.removeItem(at: copy)
            try? FileManager.default.copyItem(at: URL(fileURLWithPath: path), to: copy)
            app.open(url: copy)
        }
    }
}
#endif
