import XCTest
@testable import FlowAssert

/// The page the checker runs in: what it can do (read its own Blobs, decode utf-16 and gb18030) and what it cannot
/// (reach anything outside flowassert://engine).
@MainActor
final class EngineHostTests: XCTestCase {
    func testTheCheckerFindsEverythingItNeedsInThisWebKit() async throws {
        let engine = CheckerEngine()
        let status = try await engine.start()
        XCTAssertNil(status.hostProblem)
        XCTAssertFalse(status.version.isEmpty)
    }

    func testThePageReadsItsOwnBlobs() async throws {
        let engine = CheckerEngine()
        let value = try await engine.evaluateForTesting("""
            const b = new Blob([new Uint8Array([1, 2, 3, 4, 5])]);
            return [(await b.arrayBuffer()).byteLength, (await b.slice(1, 3).arrayBuffer()).byteLength, location.origin];
            """) as? [Any]
        XCTAssertEqual(value?[0] as? Int, 5)
        XCTAssertEqual(value?[1] as? Int, 2)
        XCTAssertEqual(value?[2] as? String, "flowassert://engine")
    }

    /// No request leaves the page: a connection, an image and a script from anywhere but flowassert://engine are refused
    /// before any is sent (the Content Security Policy and the content rule list), and the page cannot navigate.
    func testThePageReachesNothingRemote() async throws {
        let engine = CheckerEngine()
        let value = try await engine.evaluateForTesting("""
            const out = {};
            for (const url of ["https://example.com/", "http://127.0.0.1:9/", "file:///etc/hosts", "data:text/plain,x"]) {
              try { await fetch(url); out[url] = "loaded"; } catch (e) { out[url] = "refused"; }
            }
            out.image = await new Promise((resolve) => {
              const img = new Image();
              img.onload = () => resolve("loaded");
              img.onerror = () => resolve("refused");
              img.src = "https://example.com/x.png";
            });
            out.script = await new Promise((resolve) => {
              const s = document.createElement("script");
              s.onload = () => resolve("loaded");
              s.onerror = () => resolve("refused");
              s.src = "https://example.com/x.js";
              document.head.appendChild(s);
            });
            return out;
            """) as? [String: String]
        XCTAssertEqual(value, [
            "https://example.com/": "refused", "http://127.0.0.1:9/": "refused", "file:///etc/hosts": "refused",
            "data:text/plain,x": "refused", "image": "refused", "script": "refused",
        ])
    }

    func testAnUnknownInputIsNotServed() async throws {
        let engine = CheckerEngine()
        let value = try await engine.evaluateForTesting("""
            try { const r = await fetch("flowassert://engine/input/unknown"); return "status " + r.status; } catch (e) { return "refused"; }
            """) as? String
        XCTAssertEqual(value, "refused")
    }

    func testTheAppsOriginIsRecordedOnEveryPremise() async throws {
        let engine = CheckerEngine()
        let csv = Data("id,phone\nK1,1\n".utf8)
        var request = CheckRequest(
            source: EngineFile(name: "source.csv", bytes: csv, encoding: "utf-8"),
            destination: EngineFile(name: "destination.csv", bytes: Data("id,phone\nK1,2\n".utf8), encoding: "utf-8"),
            config: .chosen(key: ("id", "id"), fields: [("phone", "phone", "exact")], scope: "source"))
        request.sourceComplete = true
        let result = try await engine.check(request)
        XCTAssertEqual(result.state, "Mismatch")
        XCTAssertEqual(result.exit, 1)
        let json = try XCTUnwrap(result.json)
        XCTAssertTrue(json.contains("\"origin\": \"iPhone and iPad app\""))
        XCTAssertFalse(json.contains("\"origin\": \"JavaScript call\""))
    }
}
