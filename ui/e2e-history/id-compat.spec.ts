/**
 * PHASE 3A · P3A-AUD-001 — frozen-contract Verification IDs end to end in real browsers:
 * address bar → router (decoded once) → provider (one canonical segment) → local API gate → REAL Service.
 *
 * The shipped catalog holds only SPEC-001…005, so a contract-valid unknown ID must be ROUTED and answered by
 * the Service's own structured 404 run_not_found — never refused locally, never a gate answer. (HTTP 200 for
 * such IDs on the unmodified Service is shown separately with test-only catalog aliases:
 * docs/phase3a/evidence/remediation-01/.) Non-transportable IDs and malformed address encodings send nothing.
 * The independent audit's own counterexamples (FINDINGS.md P3A-AUD-001) come first.
 */
import { expect, test } from "@playwright/test";
import { APP_HOST, captureNetwork, rawRequest, startService, stopService, writeEvidence, type ServiceProcess } from "./support.ts";

test.describe.configure({ mode: "serial" });

let service: ServiceProcess | null = null;
test.beforeAll(async ({ browserName }) => {
  service = await startService(`${browserName}:id-compat`, "ui-main");
});
test.afterAll(async ({ browserName }) => {
  if (service) await stopService(service, `${browserName}:id-compat`);
});

/** RFC 3986 strict segment encoding, written out independently of src/data/local/ids.ts. */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const AUDIT = ["SPEC:006", "中文", "\u{1F9EA}", "SPEC 006", "SPEC@006", "SPEC+006"];
const MORE = ["SPEC\\001", "%2E%2E", "100%", "a?b=1#c", " lead", "SPEC'(*)!"];

test("P3A-AUD-001 · contract-valid IDs reach the real Service as one canonical segment and get its own 404 run_not_found", async ({ page, browserName }) => {
  const net = captureNetwork(page);
  const outcomes: Record<string, unknown>[] = [];
  for (const id of [...AUDIT, ...MORE]) {
    const seg = enc(id);
    const before = net.all.length;
    await page.goto(`/#/local/verifications/${seg}`);
    const notice = page.locator('[data-access="NOT_FOUND"]');
    await expect(notice, id).toBeVisible({ timeout: 20_000 });
    await expect(notice.getByRole("heading", { level: 1 }), id).toContainText(id.trim());
    await net.settle();
    const sent = net.all.slice(before);
    expect(sent.map((x) => x.pathAndQuery), id).toEqual([`/api/v1/verifications/${seg}`]);
    expect([sent[0]!.status, sent[0]!.server, sent[0]!.gate], id).toEqual([404, "uvicorn", null]);
    expect(JSON.parse(sent[0]!.body!).error.code, id).toBe("run_not_found");
    outcomes.push({ id, segment: seg, request: sent[0]!.pathAndQuery, status: sent[0]!.status, server: sent[0]!.server, code: "run_not_found" });
  }
  // The control still reads a real run.
  await page.goto("/#/local/verifications/SPEC-001");
  await expect(page.locator("[data-s]").first()).toBeVisible({ timeout: 20_000 });
  // The control read starts its evidence requests: let them finish and their captures settle before the page closes.
  await page.waitForLoadState("networkidle");
  await net.settle();
  expect([...net.hosts].filter((h) => h !== "")).toEqual([APP_HOST]);
  writeEvidence(`${browserName}/P3A-AUD-001-valid-ids`, { outcomes });
});

test("P3A-AUD-001 · non-transportable IDs and malformed address encodings send nothing and say why", async ({ page, browserName }) => {
  const net = captureNetwork(page);
  const notRequestable = "This verification ID cannot be requested over the local API";
  const invalid = "This address does not name a valid verification ID";
  const cases: [string, string][] = [
    ["..", notRequestable],
    [".", notRequestable],
    ["%2E%2E", notRequestable],
    ["SPEC%2F001", notRequestable],
    ["x%2Fevidence", notRequestable],
    ["%E0%A4%A", invalid],
    ["100%", invalid],
    ["%zz", invalid],
    ["a".repeat(129), invalid],
  ];
  const outcomes: Record<string, string | null> = {};
  for (const [seg, title] of cases) {
    await page.goto(`/#/local/verifications/${seg}`);
    await expect(page.getByText(title, { exact: true }), seg).toBeVisible();
    outcomes[seg.slice(0, 24)] = await page.locator("[data-access] dd").nth(1).textContent();
  }
  await net.settle();
  expect(net.all).toEqual([]);
  writeEvidence(`${browserName}/P3A-AUD-001-refused-ids`, { requests_sent: net.all.length, outcomes });
});

test("P3A-AUD-001 · raw clients: the gate forwards canonical ID segments byte-for-byte; the Service sees the same 404 as directly", async () => {
  const rows: Record<string, unknown>[] = [];
  for (const id of [...AUDIT, ...MORE]) {
    for (const suffix of ["", "/evidence?limit=2&include_payload=true"]) {
      const target = `/api/v1/verifications/${enc(id)}${suffix}`;
      const via = await rawRequest(5183, target);
      const direct = await rawRequest(8765, target);
      expect([via.status, via.headers.server, via.headers["x-flowassert-gate"]], target).toEqual([404, "uvicorn", undefined]);
      expect(JSON.parse(via.body).error.code, target).toBe("run_not_found");
      expect([direct.status, JSON.parse(direct.body).error.code], target).toEqual([404, "run_not_found"]);
      rows.push({ target, gate: via.status, direct: direct.status });
    }
  }
  for (const target of ["/api/v1/verifications/SPEC:006", "/api/v1/verifications/SPEC%3a006", "/api/v1/verifications/%41", "/api/v1/verifications/%2E%2E", "/api/v1/verifications/x%2Fevidence", "/api/v1/verifications/%ED%A0%80"]) {
    const r = await rawRequest(5183, target);
    expect([r.status, JSON.parse(r.body).gate.code, r.headers.server], target).toEqual([400, "encoded_path_refused", undefined]);
    rows.push({ target, gate: r.status, refused: true });
  }
  writeEvidence("../proxy/P3A-AUD-001-raw", rows);
});
