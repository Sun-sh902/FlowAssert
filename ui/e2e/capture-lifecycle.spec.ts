/**
 * Round 02 hardening FIX02: the suites' network capture across a page close (e2e/capture-lifecycle.ts).
 *
 * A loopback server sends a response's headers at once and its body only later, so the capture's body read is still
 * in flight when the page closes — the mechanism of the Round 02 e2e-local test 12 and e2e-lookup in-app navigation
 * failures, made deterministic. The capture under test is the real e2e-local captureNetwork.
 */
import { expect, test } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { captureNetwork } from "../e2e-local/support.ts";

async function slowServer(bodyDelayMs: number) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
    res.flushHeaders();
    setTimeout(() => res.end("late body"), bodyDelayMs);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/slow`, close: () => server.close() };
}

test("a capture read cut off by the page closing is recorded and fails a later settle — no unhandled rejection", async ({ browser }) => {
  const srv = await slowServer(3_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const net = captureNetwork(page);
  const responded = page.waitForEvent("response", (r) => r.url() === srv.url);
  await page.evaluate((u) => void fetch(u), srv.url);
  await responded; // headers arrived; the body read is pending
  await ctx.close();
  await expect.poll(() => net.interrupted).toEqual([srv.url]);
  await expect(net.settle()).rejects.toThrow(`network capture interrupted by page close: ${srv.url}`);
  expect(net.all).toEqual([]);
  expect(test.info().annotations).toContainEqual({ type: "capture-interrupted-by-close", description: srv.url });
  srv.close();
});

test("settle waits for a read still in flight and captures it completely", async ({ page }) => {
  const srv = await slowServer(400);
  const net = captureNetwork(page);
  const responded = page.waitForEvent("response", (r) => r.url() === srv.url);
  await page.evaluate((u) => void fetch(u), srv.url);
  await responded;
  await net.settle();
  expect(net.all.map((x) => [x.url, x.status, x.body])).toEqual([[srv.url, 200, "late body"]]);
  expect(net.interrupted).toEqual([]);
  srv.close();
});
