import Foundation

/// Sends the connectors' requests for the checker (ui/src/offline/connector.ts), as the command line's `_get` sends
/// them: one HTTPS GET to a documented host only, the credential added here and nowhere else, `Accept:
/// application/json`, `Accept-Encoding: identity`, no redirect followed (a 3xx is answered as it is), no proxy, no
/// cookie, no cache, no retry, the whole request within the timeout, and reading stopped as soon as the body is larger
/// than the limit. The answer is the status, the body and its Content-Encoding, or why there is none.
final class ConnectorTransport: NSObject, @unchecked Sendable {
    struct Request: Sendable {
        var service: String
        var host: String
        /// The path and query, percent-encoded by the checker as the command line encodes them.
        var target: String
        /// "token" (an Authorization header) or "key" (a last `key` query parameter).
        var credential: String
        var timeout: Double
        var maxBytes: Int
    }

    enum Outcome: Sendable, Equatable {
        case response(status: Int, body: Data, contentEncoding: String?)
        /// "timeout", "certificate", "connection" or "too-large", as connector.ts names them.
        case failure(String)
    }

    /// The documented hosts of each connector (docs/connectors/): nothing else is ever asked.
    static let hosts: [String: Set<String>] = [
        "sheets": ["sheets.googleapis.com", "www.googleapis.com"],
        "hubspot": ["api.hubapi.com"],
    ]

    static let userAgent = "flowassert-ios/1.2.0"

    let credentials: CredentialStore

    init(credentials: CredentialStore) {
        self.credentials = credentials
    }

    /// urllib.parse.quote(text, safe=""): every byte but the unreserved characters as %XX.
    static func quote(_ text: String) -> String {
        var out = ""
        for byte in text.utf8 {
            let c = Character(UnicodeScalar(byte))
            if c.isASCII && (c.isLetter || c.isNumber || "_.-~".contains(c)) { out.append(c) } else { out += String(format: "%%%02X", byte) }
        }
        return out
    }

    #if DEBUG
    /// For tests only, as FLOWASSERT_SHEETS_TEST_ENDPOINT and FLOWASSERT_HUBSPOT_TEST_ENDPOINT are for the command line:
    /// a loopback fake of the service. Not compiled into a Release build.
    static func testEndpoint(_ service: String) -> String? {
        let name = service == "hubspot" ? "FLOWASSERT_HUBSPOT_TEST_ENDPOINT" : "FLOWASSERT_SHEETS_TEST_ENDPOINT"
        guard let value = ProcessInfo.processInfo.environment[name],
              value.wholeMatch(of: /http:\/\/(127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}/) != nil else { return nil }
        return value
    }
    #endif

    func send(_ r: Request) async -> Outcome {
        guard let allowed = Self.hosts[r.service], allowed.contains(r.host), r.target.hasPrefix("/"),
              r.credential == "token" || (r.credential == "key" && r.service == "sheets") else { return .failure("connection") }
        let kind: CredentialKind = r.service == "hubspot" ? .hubspotToken : r.credential == "key" ? .sheetsKey : .sheetsToken
        guard let secret = credentials.value(kind) else { return .failure("connection") }
        var base = "https://\(r.host)"
        #if DEBUG
        if let endpoint = Self.testEndpoint(r.service) { base = endpoint }
        #endif
        let target = kind == .sheetsKey ? r.target + (r.target.contains("?") ? "&" : "?") + "key=" + Self.quote(secret) : r.target
        guard let url = URL(string: base + target) else { return .failure("connection") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: r.timeout)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        if kind != .sheetsKey { request.setValue("Bearer " + secret, forHTTPHeaderField: "Authorization") }
        return await OneRequest(request: request, timeout: r.timeout, maxBytes: r.maxBytes).run()
    }
}

/// One request, with its own ephemeral session and delegate.
private final class OneRequest: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    let request: URLRequest
    let timeout: Double
    let maxBytes: Int
    private var body = Data()
    private var response: HTTPURLResponse?
    private var tooLarge = false
    private var continuation: CheckedContinuation<ConnectorTransport.Outcome, Never>?
    private let lock = NSLock()

    init(request: URLRequest, timeout: Double, maxBytes: Int) {
        self.request = request
        self.timeout = timeout
        self.maxBytes = maxBytes
    }

    func run() async -> ConnectorTransport.Outcome {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.connectionProxyDictionary = [:]
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        configuration.waitsForConnectivity = false
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        return await withCheckedContinuation { continuation in
            lock.withLock { self.continuation = continuation }
            session.dataTask(with: request).resume()
        }
    }

    private func finish(_ outcome: ConnectorTransport.Outcome) {
        let c: CheckedContinuation<ConnectorTransport.Outcome, Never>? = lock.withLock {
            defer { continuation = nil }
            return continuation
        }
        c?.resume(returning: outcome)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // A redirect is never followed: the 3xx response is the answer.
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        lock.withLock { self.response = response as? HTTPURLResponse }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let over: Bool = lock.withLock {
            body.append(data)
            if body.count > maxBytes { tooLarge = true }
            return tooLarge
        }
        if over { dataTask.cancel() }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let (tooLarge, response, body) = lock.withLock { (self.tooLarge, self.response, self.body) }
        if tooLarge { return finish(.failure("too-large")) }
        if let error = error as? URLError {
            switch error.code {
            case .timedOut: return finish(.failure("timeout"))
            case .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid:
                return finish(.failure("certificate"))
            default: return finish(.failure("connection"))
            }
        }
        if error != nil { return finish(.failure("connection")) }
        guard let response else { return finish(.failure("connection")) }
        finish(.response(status: response.statusCode, body: body, contentEncoding: response.value(forHTTPHeaderField: "Content-Encoding")))
    }
}
