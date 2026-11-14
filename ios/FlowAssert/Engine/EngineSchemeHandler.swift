import Foundation
import WebKit

/// Serves the engine page under `flowassert://engine/`: the page, the packaged checker, the host script, and the bytes
/// of the inputs the app registered for one check. Nothing else is served, and nothing is read from a file URL.
@MainActor
final class EngineSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "flowassert"
    static let host = "engine"
    static let pageURL = URL(string: "flowassert://engine/engine.html")!

    /// The Content Security Policy of every response: scripts and connections from this scheme only.
    static let contentSecurityPolicy =
        "default-src 'none'; script-src flowassert://engine; connect-src flowassert://engine; base-uri 'none'; form-action 'none'"

    private static let resources: [String: (name: String, ext: String, type: String)] = [
        "/engine.html": ("engine", "html", "text/html; charset=utf-8"),
        "/host.js": ("host", "js", "text/javascript; charset=utf-8"),
        "/flowassert-check.js": ("flowassert-check", "js", "text/javascript; charset=utf-8"),
        "/flowassert-app.js": ("flowassert-app", "js", "text/javascript; charset=utf-8"),
    ]

    private var inputs: [String: Data] = [:]

    /// Makes `data` readable by the page once, under a new token.
    func register(_ data: Data) -> String {
        let token = UUID().uuidString
        inputs[token] = data
        return token
    }

    func release(_ tokens: [String]) {
        for token in tokens { inputs[token] = nil }
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url, url.scheme == Self.scheme, url.host == Self.host else {
            return fail(task, URLError(.unsupportedURL))
        }
        let path = url.path
        if let resource = Self.resources[path] {
            guard let file = Bundle.main.url(forResource: resource.name, withExtension: resource.ext),
                  let data = try? Data(contentsOf: file) else {
                return fail(task, URLError(.fileDoesNotExist))
            }
            return respond(task, url: url, type: resource.type, data: data)
        }
        if path.hasPrefix("/input/") {
            let token = String(path.dropFirst("/input/".count))
            guard let data = inputs[token] else { return fail(task, URLError(.fileDoesNotExist)) }
            return respond(task, url: url, type: "application/octet-stream", data: data)
        }
        fail(task, URLError(.fileDoesNotExist))
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}

    private func respond(_ task: any WKURLSchemeTask, url: URL, type: String, data: Data) {
        let headers = [
            "Content-Type": type,
            "Content-Length": String(data.count),
            "Content-Security-Policy": Self.contentSecurityPolicy,
            "Cache-Control": "no-store",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
            return fail(task, URLError(.badServerResponse))
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private func fail(_ task: any WKURLSchemeTask, _ error: Error) {
        task.didFailWithError(error)
    }
}
