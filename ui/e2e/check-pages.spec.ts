/**
 * The GitHub Pages build (vite build --mode pages), served from /FlowAssert/ as GitHub Pages serves it: its Content
 * Security Policy, the CSV check as its home page and working under that policy, and every page that needs the local
 * Service saying it works only locally without making a request.
 */
import { expect, test } from "@playwright/test";
import { EXAMPLE, check, expectNoNetwork, golden, openCheck, recordRequests } from "./check-helpers.ts";

const BASE = "http://127.0.0.1:4185/FlowAssert/";
const LOCAL_ROUTES = ["#/overview", "#/verifications", "#/local/verifications/SPEC-001", "#/local/verification-lookup?verification_id=SPEC-001", "#/local/history", "#/capture"];

test("the Pages build has a Content Security Policy that allows no connection and nothing from elsewhere", async ({ page, context }) => {
  const requests = recordRequests(context);
  await page.goto(BASE);
  await page.getByTestId("run-check").waitFor();
  await page.waitForLoadState("networkidle");
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toMatch(/script-src 'self' 'sha256-[^']+'(;|$)/);
  expect(policy).not.toMatch(/https?:/);
  // The recorder works: it saw the page load its own files, all from this folder.
  expect(requests.urls.length).toBeGreaterThan(3);
  expect(requests.urls.filter((u) => !u.startsWith(BASE))).toEqual([]);
  // A connection is refused by the policy, even to the same origin.
  const fetched = await page.evaluate(() => fetch(location.href).then(() => "connected", () => "blocked"));
  expect(fetched).toBe("blocked");
});

test("the home page is the CSV check, and it runs under the policy without a request", async ({ page, context }) => {
  await openCheck(page, BASE);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("CSV check");
  const requests = recordRequests(context);
  await check(page, EXAMPLE);
  await page.locator("[data-result]").waitFor({ timeout: 30_000 });
  expect(await page.getByTestId("summary").textContent()).toBe(golden("example-page", "stdout.txt"));
  requests.stop();
  expectNoNetwork(page, requests);
});

for (const hash of LOCAL_ROUTES) {
  test(`${hash} says it works only locally and makes no request`, async ({ page, context }) => {
    await openCheck(page, BASE + "#/check");
    const requests = recordRequests(context);
    await page.evaluate((h) => (location.hash = h), hash);
    await expect(page.getByRole("heading", { level: 1, name: "Works only locally" })).toBeVisible();
    await expect(page.getByText("works only locally").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Check the local Service now" })).toHaveCount(0);
    await page.waitForTimeout(1500);
    requests.stop();
    expectNoNetwork(page, requests);
  });
}

test("a Service page opened directly still requests nothing from a Service", async ({ page, context }) => {
  const requests = recordRequests(context);
  await page.goto(BASE + "#/verifications");
  await expect(page.getByRole("heading", { level: 1, name: "Works only locally" })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(requests.urls.filter((u) => u.includes("/api/") || !u.startsWith(BASE))).toEqual([]);
});

test("the MOCK demo pages stay available", async ({ page }) => {
  await page.goto(BASE + "#/demo/verifications");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Works only locally")).toHaveCount(0);
});
