import SwiftUI

@main
struct FlowAssertApp: App {
    @State private var engine = CheckerEngine()
    @State private var status: String = "Loading the checker…"

    var body: some Scene {
        WindowGroup {
            Text(status)
                .padding()
                .task {
                    do {
                        let s = try await engine.start()
                        status = s.hostProblem.map { "This WebKit \($0)." } ?? "FlowAssert \(s.version) checker ready."
                    } catch {
                        status = error.localizedDescription
                    }
                }
        }
    }
}
