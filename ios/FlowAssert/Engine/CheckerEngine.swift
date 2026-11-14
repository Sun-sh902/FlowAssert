import Foundation
import WebKit

/// The packaged checker, `flowassert-check.js`, running in WebKit inside the app. The app has no checker of its own:
/// every verdict, rule result, count, refusal and byte of a report comes from here, as the checker wrote it.
///
/// The page runs in a `WKWebView` that is never shown. It is loaded from `flowassert://engine` through a scheme handler,
/// with a Content Security Policy that allows nothing remote, no persistent website data, and a content rule list that
/// blocks every request that is not to `flowassert:`. Inputs reach the page as bytes served by the scheme handler,
/// never as text in a script.
@MainActor
final class CheckerEngine: NSObject {
    struct Status: Equatable, Sendable {
        /// The checker's version, `FlowAssert.VERSION`.
        var version: String
        /// `hostProblem()` of the checker in this WebKit: nil when it has everything a check needs, otherwise the
        /// checker's own words for what is missing. The app shows them and does not check.
        var hostProblem: String?
    }

    enum EngineError: LocalizedError {
        case pageDidNotLoad(String)
        case unexpected(String)

        var errorDescription: String? {
            switch self {
            case .pageDidNotLoad(let detail): "The checker could not be loaded: \(detail)"
            case .unexpected(let detail): "The checker answered in a way the app does not know: \(detail)"
            }
        }
    }

    private let handler = EngineSchemeHandler()
    private var webView: WKWebView?
    private var loading: CheckedContinuation<Void, Error>?
    private var started: Task<Status, Error>?
    /// Checks run one after another.
    private var busy = false
    private var waiting: [CheckedContinuation<Void, Never>] = []

    private func acquire() async {
        if busy {
            await withCheckedContinuation { waiting.append($0) }
        } else {
            busy = true
        }
    }

    private func release() {
        if waiting.isEmpty { busy = false } else { waiting.removeFirst().resume() }
    }

    /// Loads the page once and asks the checker for its version and `hostProblem`.
    func start() async throws -> Status {
        if let started { return try await started.value }
        let task = Task { try await load() }
        started = task
        do {
            return try await task.value
        } catch {
            started = nil
            throw error
        }
    }

    private func load() async throws -> Status {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(handler, forURLScheme: EngineSchemeHandler.scheme)
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.suppressesIncrementalRendering = true
        if let rules = try? await Self.blockEverythingElse() {
            configuration.userContentController.add(rules)
        }
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
        view.navigationDelegate = self
        view.isInspectable = false
        webView = view
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            loading = continuation
            view.load(URLRequest(url: EngineSchemeHandler.pageURL))
        }
        let value = try await view.callAsyncJavaScript("return host.status()", contentWorld: .page)
        guard let dict = value as? [String: Any], let version = dict["version"] as? String else {
            throw EngineError.unexpected("no status")
        }
        return Status(version: version, hostProblem: dict["hostProblem"] as? String)
    }

    /// A content rule list that blocks every load but those of `flowassert://engine` and of the page's own blobs
    /// (`blob:flowassert://engine/…`), through which WebKit reads a Blob, as the workbook reader does.
    private static func blockEverythingElse() async throws -> WKContentRuleList? {
        let rules = """
        [{"trigger": {"url-filter": ".*"}, "action": {"type": "block"}},
         {"trigger": {"url-filter": "^flowassert://engine/"}, "action": {"type": "ignore-previous-rules"}},
         {"trigger": {"url-filter": "^blob:flowassert://engine/"}, "action": {"type": "ignore-previous-rules"}}]
        """
        return try await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "flowassert-engine-only-2", encodedContentRuleList: rules)
    }

    /// Runs one check. A refusal or a failure is a result, as the command line exits with 2 or 4; this throws only when
    /// the engine itself cannot run.
    func check(_ request: CheckRequest) async throws -> CheckResult {
        await acquire()
        defer { release() }
        // A host without what the check needs is refused by the checker itself, in its own words.
        _ = try await start()
        guard let webView else { throw EngineError.pageDidNotLoad("no page") }
        var tokens: [String] = []
        func token(_ data: Data) -> String {
            let t = handler.register(data)
            tokens.append(t)
            return t
        }
        defer { handler.release(tokens) }

        func side(_ file: EngineFile) -> [String: Any] {
            var out: [String: Any] = ["name": file.name, "token": token(file.bytes)]
            if let encoding = file.encoding { out["encoding"] = encoding }
            if let format = file.format { out["format"] = format }
            if let worksheet = file.worksheet { out["worksheet"] = worksheet }
            return out
        }
        let config: [String: Any]
        switch request.config {
        case .loaded(let data):
            config = ["token": token(data)]
        case .chosen(let key, let fields, let scope):
            config = ["chosen": [
                "key": [key.source, key.destination],
                "fields": fields.map { [$0.source, $0.destination, $0.rule] },
                "scope": scope,
            ] as [String: Any]]
        }
        var body: [String: Any] = [
            "source": side(request.source),
            "destination": side(request.destination),
            "config": config,
            "sourceComplete": request.sourceComplete,
            "destinationComplete": request.destinationComplete,
            "sourceCount": request.sourceCount as Any? ?? NSNull(),
            "destinationCount": request.destinationCount as Any? ?? NSNull(),
            "allowIdenticalContent": request.allowIdenticalContent,
        ]
        if request.exports { body["exports"] = true }
        if let details = request.details { body["details"] = details }
        if request.redactValues { body["redactValues"] = true }
        if let maxBytes = request.maxBytes { body["maxBytes"] = maxBytes }
        if let maxRows = request.maxRows { body["maxRows"] = maxRows }

        let value = try await webView.callAsyncJavaScript("return await host.check(request)", arguments: ["request": body], contentWorld: .page)
        return try Self.result(value)
    }

    #if DEBUG
    /// For tests only: runs a function body in the engine page and returns its value.
    func evaluateForTesting(_ body: String) async throws -> Any? {
        _ = try await start()
        return try await webView?.callAsyncJavaScript(body, contentWorld: .page)
    }
    #endif

    private static func result(_ value: Any?) throws -> CheckResult {
        guard let d = value as? [String: Any],
              let exit = (d["exit"] as? NSNumber)?.intValue,
              let state = d["state"] as? String,
              let summary = d["summary"] as? String,
              let message = d["message"] as? String else {
            throw EngineError.unexpected("a result without exit, state, summary or message")
        }
        var exports: [CheckExport]?
        if let list = d["exports"] as? [[String: Any]] {
            exports = try list.map { e in
                guard let file = e["file"] as? String, let rows = (e["rows"] as? NSNumber)?.intValue,
                      let meaning = e["meaning"] as? String, let formula = (e["formulaFields"] as? NSNumber)?.intValue,
                      let text = e["text"] as? String else {
                    throw EngineError.unexpected("an export without its members")
                }
                return CheckExport(file: file, rows: rows, meaning: meaning, formulaFields: formula, text: text)
            }
        }
        return CheckResult(
            exit: exit, state: state, summary: summary, message: message,
            json: d["json"] as? String, html: d["html"] as? String, exports: exports,
            milliseconds: (d["milliseconds"] as? NSNumber)?.doubleValue ?? 0)
    }
}

extension CheckerEngine: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        // The engine page is the only page; it never navigates.
        action.request.url == EngineSchemeHandler.pageURL ? .allow : .cancel
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading?.resume()
        loading = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loading?.resume(throwing: EngineError.pageDidNotLoad(error.localizedDescription))
        loading = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loading?.resume(throwing: EngineError.pageDidNotLoad(error.localizedDescription))
        loading = nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // A page that ended (for memory, say) is loaded again for the next check; the check that was running fails.
        started = nil
        self.webView = nil
    }
}
