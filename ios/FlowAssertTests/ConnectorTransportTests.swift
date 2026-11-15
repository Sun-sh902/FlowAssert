import Foundation
import Network
import XCTest
@testable import FlowAssert

/// A small HTTP/1.1 server on a loopback port, answering each request with the next canned response and recording
/// what it received: enough to see what the transport sends and how it reads what comes back.
final class LoopbackServer: @unchecked Sendable {
    struct Canned {
        var status: Int
        var headers: [String: String] = [:]
        var body = Data()
        /// Seconds to wait before answering.
        var delay: Double = 0
    }

    private let listener: NWListener
    private let queue = DispatchQueue(label: "loopback-server")
    private var responses: [Canned]
    private(set) var received: [String] = []
    private(set) var port: UInt16 = 0

    init(_ responses: [Canned]) throws {
        self.responses = responses
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: parameters)
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { if case .ready = $0 { ready.signal() } }
        listener.newConnectionHandler = { [weak self] in self?.serve($0) }
        listener.start(queue: queue)
        _ = ready.wait(timeout: .now() + 5)
        port = listener.port?.rawValue ?? 0
    }

    var endpoint: String { "http://127.0.0.1:\(port)" }

    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, _ in
            guard let self else { return }
            self.received.append(String(decoding: data ?? Data(), as: UTF8.self))
            let canned = self.responses.isEmpty ? Canned(status: 599) : self.responses.removeFirst()
            var head = "HTTP/1.1 \(canned.status) X\r\nContent-Length: \(canned.body.count)\r\nConnection: close\r\n"
            for (k, v) in canned.headers { head += "\(k): \(v)\r\n" }
            let bytes = Data((head + "\r\n").utf8) + canned.body
            self.queue.asyncAfter(deadline: .now() + canned.delay) {
                connection.send(content: bytes, completion: .contentProcessed { _ in connection.cancel() })
            }
        }
    }

    func stop() { listener.cancel() }
}

final class ConnectorTransportTests: XCTestCase {
    let token = "synthetic-token-FA-ios-not-a-real-credential"
    let key = "synthetic+key/FA-ios"
    var store: CredentialStore!

    override func setUp() {
        store = CredentialStore(service: "io.github.sunsh902.flowassert.tests.\(UUID().uuidString)")
    }

    override func tearDown() {
        for kind in CredentialKind.allCases { try? store.remove(kind) }
        unsetenv("FLOWASSERT_SHEETS_TEST_ENDPOINT")
        unsetenv("FLOWASSERT_HUBSPOT_TEST_ENDPOINT")
    }

    func request(_ service: String = "sheets", host: String = "sheets.googleapis.com", target: String = "/v4/x?a=1", credential: String = "token", timeout: Double = 5, maxBytes: Int = 1000) -> ConnectorTransport.Request {
        .init(service: service, host: host, target: target, credential: credential, timeout: timeout, maxBytes: maxBytes)
    }

    func serve(_ responses: [LoopbackServer.Canned], service: String = "sheets") throws -> LoopbackServer {
        let server = try LoopbackServer(responses)
        setenv(service == "hubspot" ? "FLOWASSERT_HUBSPOT_TEST_ENDPOINT" : "FLOWASSERT_SHEETS_TEST_ENDPOINT", server.endpoint, 1)
        return server
    }

    func testATokenGoesOnlyIntoTheAuthorizationHeader() async throws {
        try store.save(token, as: .sheetsToken)
        let server = try serve([.init(status: 200, body: Data("{}".utf8))])
        defer { server.stop() }
        let outcome = await ConnectorTransport(credentials: store).send(request())
        XCTAssertEqual(outcome, .response(status: 200, body: Data("{}".utf8), contentEncoding: nil))
        let sent = try XCTUnwrap(server.received.first)
        XCTAssertTrue(sent.hasPrefix("GET /v4/x?a=1 HTTP/1.1\r\n"), sent)
        XCTAssertTrue(sent.contains("Authorization: Bearer \(token)\r\n"))
        XCTAssertTrue(sent.lowercased().contains("accept-encoding: identity\r\n"))
        XCTAssertTrue(sent.lowercased().contains("accept: application/json\r\n"))
        XCTAssertFalse(sent.lowercased().contains("cookie"))
    }

    func testAnApiKeyIsTheLastQueryParameterPercentEncodedAndNoHeader() async throws {
        try store.save(key, as: .sheetsKey)
        let server = try serve([.init(status: 200, body: Data("{}".utf8))])
        defer { server.stop() }
        _ = await ConnectorTransport(credentials: store).send(request(credential: "key"))
        let sent = try XCTUnwrap(server.received.first)
        XCTAssertTrue(sent.hasPrefix("GET /v4/x?a=1&key=synthetic%2Bkey%2FFA-ios HTTP/1.1\r\n"), sent)
        XCTAssertFalse(sent.contains("Authorization"))
    }

    func testARedirectIsAnsweredNotFollowed() async throws {
        try store.save(token, as: .hubspotToken)
        let server = try serve([.init(status: 302, headers: ["Location": "http://127.0.0.1:9/elsewhere"])], service: "hubspot")
        defer { server.stop() }
        let outcome = await ConnectorTransport(credentials: store).send(request("hubspot", host: "api.hubapi.com", target: "/crm/v3/objects/contacts?limit=100"))
        guard case .response(let status, _, _) = outcome else { return XCTFail("\(outcome)") }
        XCTAssertEqual(status, 302)
        XCTAssertEqual(server.received.count, 1)
    }

    func testABodyLargerThanTheLimitIsNotReadToTheEnd() async throws {
        try store.save(token, as: .sheetsToken)
        let server = try serve([.init(status: 200, body: Data(repeating: 0x61, count: 50_000))])
        defer { server.stop() }
        let outcome = await ConnectorTransport(credentials: store).send(request(maxBytes: 100))
        XCTAssertEqual(outcome, .failure("too-large"))
    }

    func testNoCompleteResponseWithinTheTimeoutIsATimeout() async throws {
        try store.save(token, as: .sheetsToken)
        let server = try serve([.init(status: 200, body: Data("{}".utf8), delay: 3)])
        defer { server.stop() }
        let started = Date()
        let outcome = await ConnectorTransport(credentials: store).send(request(timeout: 1))
        XCTAssertEqual(outcome, .failure("timeout"))
        XCTAssertLessThan(Date().timeIntervalSince(started), 2.5)
    }

    func testOnlyTheDocumentedHostsAreAskedAndOnlyWithASavedCredential() async throws {
        let transport = ConnectorTransport(credentials: store)
        let server = try serve([])
        defer { server.stop() }
        try store.save(token, as: .sheetsToken)
        for (service, host) in [("sheets", "example.com"), ("sheets", "api.hubapi.com"), ("hubspot", "sheets.googleapis.com"), ("other", "api.hubapi.com")] {
            let outcome = await transport.send(request(service, host: host))
            XCTAssertEqual(outcome, .failure("connection"), "\(service) \(host)")
        }
        // A HubSpot request without a saved HubSpot token is not sent.
        let outcome = await transport.send(request("hubspot", host: "api.hubapi.com"))
        XCTAssertEqual(outcome, .failure("connection"))
        XCTAssertEqual(server.received, [])
    }

    func testQuoteIsPythonsQuote() {
        XCTAssertEqual(ConnectorTransport.quote("Leads!A1:C"), "Leads%21A1%3AC")
        XCTAssertEqual(ConnectorTransport.quote("a b~_.-é"), "a%20b~_.-%C3%A9")
    }
}

final class CredentialStoreTests: XCTestCase {
    var store: CredentialStore!

    override func setUp() {
        store = CredentialStore(service: "io.github.sunsh902.flowassert.tests.\(UUID().uuidString)")
    }

    override func tearDown() {
        for kind in CredentialKind.allCases { try? store.remove(kind) }
    }

    func testAKeptCredentialIsOnlyTheKeychainsAndTheCheckerIsToldOnlyThatItIsSet() throws {
        XCTAssertFalse(store.isSaved(.hubspotToken))
        try store.save("pat-synthetic-1", as: .hubspotToken)
        XCTAssertTrue(store.isSaved(.hubspotToken))
        XCTAssertEqual(store.value(.hubspotToken), "pat-synthetic-1")
        XCTAssertEqual(store.environment(), ["FLOWASSERT_HUBSPOT_TOKEN": "saved-in-the-keychain"])
        try store.remove(.hubspotToken)
        XCTAssertFalse(store.isSaved(.hubspotToken))
        XCTAssertNil(store.value(.hubspotToken))
    }

    func testGoogleSheetsKeepsOneKindOfCredentialAtATime() throws {
        try store.save("token-1", as: .sheetsToken)
        try store.save("key-1", as: .sheetsKey)
        XCTAssertFalse(store.isSaved(.sheetsToken))
        XCTAssertEqual(store.value(.sheetsKey), "key-1")
    }

    /// The command line's rule and texts (golden-sheets/sheet-refused-malformed-credential and its HubSpot twin).
    func testACredentialOfAnotherFormIsRefusedInTheCommandLinesWords() throws {
        for (kind, golden) in [(CredentialKind.sheetsToken, "golden-sheets/sheet-refused-malformed-credential"), (.hubspotToken, "golden-hubspot/hubspot-refused-malformed-credential")] {
            let expected = try String(contentsOf: EngineParityTests.repository.appendingPathComponent("offline/\(golden)/stderr.txt"), encoding: .utf8)
            for bad in ["two words", "", String(repeating: "a", count: 4097), "naïve", "tab\there"] {
                XCTAssertThrowsError(try store.save(bad, as: kind)) { error in
                    XCTAssertEqual("refused: \(error.localizedDescription)\n", expected)
                }
            }
        }
        XCTAssertNoThrow(try store.save(String(repeating: "a", count: 4096), as: .sheetsKey))
        XCTAssertNoThrow(try store.save("!~", as: .sheetsKey))
    }
}
