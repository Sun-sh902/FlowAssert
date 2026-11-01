/**
 * PHASE 2 — real end-to-end: browser → same-origin proxy → unchanged local Python Service →
 * pinned evaluator → rendered Evidence Atelier. Nothing here is a test double: every /api/ response
 * comes from the isolated exact-source Service this suite starts, restarts and stops. Interception
 * is used only where the scenario needs it (a tampered cursor sent to the real Service, a corrupted
 * copy of a real body to prove fail-closed admission) and is named in each test.
 *
 *   npm run test:e2e:local                       (Chrome)
 *   FA_BROWSERS=chrome,webkit npm run test:e2e:local
 */
import { expect, test, type Page } from "@playwright/test";
import { AXE_PATH } from "../e2e/helpers.ts";
import {
  CASES,
  EXPECTED,
  captureNetwork,
  custody,
  direct,
  evaluatorComputed,
  startService,
  stopService,
  withUnusableKey,
  writeEvidence,
  type ServiceProcess,
} from "./support.ts";

test.describe.configure({ mode: "serial" });

let service: ServiceProcess;
test.beforeAll(async ({ browserName }) => {
  service = await startService(`${browserName}:suite`);
});
test.afterAll(async ({ browserName }) => {
  await stopService(service, `${browserName}:suite`);
  writeEvidence(`${browserName}/process-custody`, custody);
});

async function openLocal(page: Page, hash: string, theme: "light" | "dark" = "light") {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("flowassert.theme", t);
    } catch {
      /* storage unavailable */
    }
  }, theme);
  await page.goto("about:blank");
  await page.goto(`/${hash}`);
  await page.locator("#main").waitFor();
}

const seal = (page: Page) => page.locator('.fa-seal[data-size="lg"]');
const indexCells = (page: Page) => page.locator('section[aria-labelledby="index-title"] button.fa-cell');
const evidenceStatus = (page: Page) => page.getByRole("region", { name: "Evidence references" }).getByRole("status");

async function waitForCase(page: Page, cohort: string) {
  await expect(seal(page)).toHaveAttribute("data-s", cohort, { timeout: 15_000 });
  // Product round 02: the Detail also reads its archive status and match. Wait until those reads have settled, so a
  // test never ends with a capture pending (the accepted F15 harness mechanism, R05).
  await expect(page.locator('[data-archive-list="pending"], [data-candidate-reads="pending"]')).toHaveCount(0, { timeout: 15_000 });
}

/** The only origin the browser may contact is the app itself; the proxy target is loopback (vite.config.ts). */
function expectOnlyAppOrigin(hosts: Set<string>) {
  expect([...hosts].filter((h) => h !== "")).toEqual(["127.0.0.1:4184"]);
}

for (const id of CASES) {
  test(`${id} · real HTTP chain: service result = evaluator result = rendered result; evidence bound to the Detail`, async ({ page, browserName }) => {
    const want = EXPECTED[id];
    const net = captureNetwork(page);
    await openLocal(page, `#/local/verifications/${id}`);
    await waitForCase(page, want.cohort);
    await expect(evidenceStatus(page)).toContainText(/1 page read · 2 of 4 references|Complete/, { timeout: 15_000 });
    await net.settle();

    // 1–3. Genuine HTTP: the browser's Detail response came through the proxy from uvicorn, and is
    //      byte-identical to a direct read of the Service (bypassing browser and proxy).
    const detail = net.api().find((x) => x.pathAndQuery === `/api/v1/verifications/${id}?phase3b=true` && x.status === 200)!;
    expect(detail, "browser Detail response").toBeTruthy();
    expect(detail.server).toBe("uvicorn");
    expect(detail.contentType).toContain("application/json");
    const viaService = await direct(`/api/v1/verifications/${id}?phase3b=true`);
    expect(viaService.status).toBe(200);
    expect(viaService.text).toBe(detail.body);
    const dto = JSON.parse(detail.body!);

    // 3. The result is the pinned evaluator's own output (handoff direct-execution trace), unchanged.
    expect(dto.result).toEqual(evaluatorComputed(id));
    expect(dto.evaluation_context.evaluator.model_sha256).toBe("b61779e198dd0213b67f8319b77a2daf9feb502dc553784df6d6600e8e3a842d");

    // 4–6. Independently fixed expectations: cohort, record states in capture order, counts, totals.
    expect(dto.result.cohort_state).toBe(want.cohort);
    expect(dto.result.records.map((r: { state: string }) => r.state)).toEqual(want.records);
    expect(dto.result.counts).toEqual(want.counts);
    expect(dto.result.expected_total).toBe(want.expectedTotal);
    await expect(seal(page)).toHaveAttribute("data-s", want.cohort);
    expect(await indexCells(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-s")))).toEqual(want.records);
    expect(await page.locator("[data-row-id]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rowId).sort())).toEqual(
      want.records.map((_, i) => `${id}:${i}`).sort(),
    );
    const facts = page.locator('dl[aria-label="Case facts"]');
    await expect(facts.getByText("Expected total").locator("xpath=following-sibling::dd")).toHaveText(want.expectedTotal === null ? "unknown" : String(want.expectedTotal));
    if (want.expectedTotal === null) await expect(page.locator('section[aria-labelledby="index-title"] i.fa-cell[data-s="unknown"]')).toHaveCount(3);

    // Mode and provenance are visible, including on Verified.
    const band = page.getByRole("region", { name: "Data provenance" });
    await expect(band.getByText("Local research · synthetic · unapproved research version")).toBeVisible();
    await expect(band.locator(`[title="${dto.snapshot_id}"]`)).toHaveCount(1);
    await expect(band.getByText("research_only", { exact: true })).toBeVisible();

    // 7–9. Evidence: pinned to the Detail's snapshot, constant limit/payload, opaque cursor sent back unchanged,
    //      references identical to the Detail's in order, every payload digest reproduced.
    if (await page.getByRole("button", { name: "Read all remaining" }).isVisible()) await page.getByRole("button", { name: "Read all remaining" }).click();
    // Phase 3A (P2-AUD-001): "Complete" became "All evidence pages retrieved"; integrity is reported separately.
    await expect(evidenceStatus(page)).toContainText("All evidence pages retrieved · 2 pages · all 4 references", { timeout: 15_000 });
    await expect(page.locator("[data-integrity]")).toHaveText("Payload digests reproduced in this browser · 4 of 4 — internal consistency only");
    await net.settle();
    const pages = net.api().filter((x) => x.pathAndQuery.startsWith(`/api/v1/verifications/${id}/evidence`) && x.status === 200);
    expect(pages).toHaveLength(2);
    const [p1, p2] = pages.map((x) => ({ url: new URL(x.url), body: JSON.parse(x.body!) }));
    for (const p of [p1!, p2!]) {
      expect(p.url.searchParams.get("snapshot_id")).toBe(dto.snapshot_id);
      expect(p.url.searchParams.get("limit")).toBe("2");
      expect(p.url.searchParams.get("include_payload")).toBe("true");
      expect(p.body.page.snapshot_id).toBe(dto.snapshot_id);
    }
    expect(p1!.url.searchParams.has("cursor")).toBe(false);
    expect(p2!.url.searchParams.get("cursor")).toBe(p1!.body.page.next_cursor);
    expect(p2!.body.page.next_cursor).toBeNull();
    const refs: { id: string }[] = [...p1!.body.items, ...p2!.body.items].map((x: { reference: { id: string } }) => x.reference);
    expect(refs).toEqual(dto.evidence_references);
    const ledger = page.getByRole("table", { name: "Evidence references for this case" });
    expect(await ledger.locator("tbody tr .mono-id").allTextContents()).toEqual(dto.evidence_references.map((r: { id: string }) => r.id));
    await expect(ledger.getByText("payload read · sha256 reproduced")).toHaveCount(4);

    // 15. No external business API: the browser only talked to the app's own origin.
    expectOnlyAppOrigin(net.hosts);
    writeEvidence(`${browserName}/${id}-chain`, {
      case: id,
      expected: want,
      rendered: { cohort: await seal(page).getAttribute("data-s"), records: await indexCells(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-s"))) },
      service: { snapshot_id: dto.snapshot_id, service_executed_at: dto.evaluation_context.service_executed_at, server: detail.server, detail_body_sha256: detail.bodySha256, direct_read_identical: true },
      evaluator: { result_equals_direct_execution: true, model_sha256: dto.evaluation_context.evaluator.model_sha256 },
      evidence: { pages: pages.map((x) => x.pathAndQuery.replace(/cursor=[^&]+/, "cursor=<opaque>")), references: refs.map((r) => r.id), digests_reproduced: 4 },
      hosts: [...net.hosts],
      network: net.summary(),
    });
  });
}

test("SPEC-004 · denied read and missing observation time stay unavailable in the browser", async ({ page }) => {
  await openLocal(page, "#/local/verifications/SPEC-004");
  await waitForCase(page, "Unverified");
  await expect(page.getByText("Time unavailable (missing_time_tick)", { exact: false })).toBeVisible();
  await expect(page.locator(".fa-axis-ev")).toHaveCount(3);
  await expect(page.locator('ol[aria-label="From source to verdict"]').getByText("HubSpot read denied")).toBeVisible();
});

test("payload omission by request: include_payload=false, stored availability unchanged", async ({ page, browserName }) => {
  const net = captureNetwork(page);
  await openLocal(page, "#/local/verifications/SPEC-003");
  await waitForCase(page, "Pending");
  await page.getByRole("radio", { name: "References only" }).click();
  const ledger = page.getByRole("table", { name: "Evidence references for this case" });
  await expect(ledger.getByText("payload omitted · omitted_by_request")).toHaveCount(2, { timeout: 15_000 });
  await net.settle();
  const last = net.api().filter((x) => x.pathAndQuery.includes("/evidence")).at(-1)!;
  expect(new URL(last.url).searchParams.get("include_payload")).toBe("false");
  expect(JSON.parse(last.body!).items.map((i: { payload: unknown; payload_reason: string }) => [i.payload, i.payload_reason])).toEqual([
    [null, "omitted_by_request"],
    [null, "omitted_by_request"],
  ]);
  await expect(ledger.getByText("available", { exact: true })).toHaveCount(4);
  writeEvidence(`${browserName}/payload-omitted`, net.summary());
});

test("10 · a tampered cursor sent to the real Service is rejected 400 invalid_cursor — a request error, not a verdict", async ({ page, browserName }) => {
  const net = captureNetwork(page);
  // Interception rewrites only the cursor of the outgoing request; the Service answers for real.
  await page.route(/\/api\/v1\/verifications\/SPEC-002\/evidence\?.*cursor=/, async (route) => {
    const u = new URL(route.request().url());
    const c = u.searchParams.get("cursor")!;
    u.searchParams.set("cursor", (c[0] === "A" ? "B" : "A") + c.slice(1));
    await route.continue({ url: u.toString() });
  });
  await openLocal(page, "#/local/verifications/SPEC-002");
  await waitForCase(page, "Mismatch");
  await expect(evidenceStatus(page)).toContainText("2 of 4 references", { timeout: 15_000 });
  await page.getByRole("button", { name: "Read next page" }).click();
  await expect(page.getByText(/rejected the continuation cursor/)).toBeVisible({ timeout: 15_000 });
  await net.settle();
  const rejected = net.api().find((x) => x.status === 400)!;
  expect(JSON.parse(rejected.body!).error.code).toBe("invalid_cursor");
  expect(rejected.server).toBe("uvicorn");
  await expect(seal(page)).toHaveAttribute("data-s", "Mismatch");
  await expect(page.getByRole("table", { name: "Evidence references for this case" }).getByText(/payload read/)).toHaveCount(0);
  await page.unroute(/\/api\/v1\/verifications\/SPEC-002\/evidence\?.*cursor=/);
  await page.getByRole("button", { name: /Restart evidence read/ }).click();
  await expect(evidenceStatus(page)).toContainText("2 of 4 references", { timeout: 15_000 });
  writeEvidence(`${browserName}/invalid-cursor`, net.summary());
});

test("11 · real Service restart between pages: old cursor → 409, nothing merged, explicit re-read takes the new snapshot", async ({ page, browserName }) => {
  const net = captureNetwork(page);
  await openLocal(page, "#/local/verifications/SPEC-001");
  await waitForCase(page, "Verified");
  await expect(evidenceStatus(page)).toContainText("2 of 4 references", { timeout: 15_000 });
  await net.settle();
  const before = JSON.parse(net.api().find((x) => x.pathAndQuery === "/api/v1/verifications/SPEC-001?phase3b=true")!.body!).snapshot_id;

  await stopService(service, `${browserName}:restart`);
  service = await startService(`${browserName}:restart`);
  const after = JSON.parse((await direct("/api/v1/verifications/SPEC-001")).text).snapshot_id;
  expect(after).not.toBe(before);

  await page.getByRole("button", { name: "Read next page" }).click();
  await expect(page.getByText("This case was read from a snapshot the service no longer serves")).toBeVisible({ timeout: 15_000 });
  await net.settle();
  const conflict = net.api().find((x) => x.status === 409)!;
  expect(JSON.parse(conflict.body!).error.code).toBe("snapshot_unavailable");
  expect(new URL(conflict.url).searchParams.get("snapshot_id")).toBe(before);
  await expect(page.getByRole("table", { name: "Evidence references for this case" }).getByText(/payload read/)).toHaveCount(0);
  await expect(seal(page)).toHaveAttribute("data-s", "Verified"); // the stored verdict is not rewritten by a read failure

  const n = net.all.length;
  await page.getByRole("button", { name: "Re-read the whole case" }).first().click();
  await expect(evidenceStatus(page)).toContainText("2 of 4 references", { timeout: 15_000 });
  await net.settle();
  const reread = net.all.slice(n).filter((x) => x.status === 200);
  expect(reread[0]!.pathAndQuery).toBe("/api/v1/verifications/SPEC-001?phase3b=true"); // fresh, unpinned Detail first
  expect(JSON.parse(reread[0]!.body!).snapshot_id).toBe(after);
  expect(new URL(reread[1]!.url).searchParams.get("snapshot_id")).toBe(after);
  await expect(page.getByRole("region", { name: "Data provenance" }).locator(`[title="${after}"]`)).toHaveCount(1);
  await expect(page.getByText("This case was read from a snapshot the service no longer serves")).toHaveCount(0);
  writeEvidence(`${browserName}/restart-409`, { before, after, network: net.summary() });
});

test("12 · Service stopped: SERVICE_UNAVAILABLE, no seal, no demo data — then a real read once it is back", async ({ page, browserName }) => {
  const net = captureNetwork(page);
  await stopService(service, `${browserName}:outage`);
  try {
    await openLocal(page, "#/local/verifications/SPEC-002");
    const notice = page.locator('[data-access="SERVICE_UNAVAILABLE"]');
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice).toContainText("none — no other data source is used");
    await expect(seal(page)).toHaveCount(0);
    await expect(page.locator("[data-row-id]")).toHaveCount(0);
    await expect(page.getByText(/VR-20\d\d/)).toHaveCount(0);
    await net.settle();
    const outage = net.all.find((x) => x.pathAndQuery === "/api/v1/verifications/SPEC-002?phase3b=true")!;
    expect(outage.server).not.toBe("uvicorn"); // the proxy answered, not the Service
  } finally {
    service = await startService(`${browserName}:outage-recovered`);
  }
  await page.getByRole("button", { name: "Read again" }).click();
  await waitForCase(page, "Mismatch");
  // FIX02: the re-read Detail also reads its first evidence page; wait for it so the test does not end with that read in
  // flight (it was the capture cut off by the page close in the Round 02 failure).
  await expect(evidenceStatus(page)).toContainText(/more pages remain|All evidence pages retrieved/, { timeout: 15_000 });
  // Product round 02: settle every capture before the page closes (the accepted F15 mechanism, R05 — a capture still
  // pending at close rejects later and is reported in the NEXT test). Errors are not swallowed.
  await net.settle();
  writeEvidence(`${browserName}/service-stopped`, net.summary());
});

test("12 · real 503 from the Service (cursor key unusable) is SERVICE_UNAVAILABLE with its code — never Unverified", async ({ page, browserName }) => {
  const net = captureNetwork(page);
  await stopService(service, `${browserName}:503`);
  await withUnusableKey(async () => {
    service = await startService(`${browserName}:503`);
    await openLocal(page, "#/local/verifications/SPEC-001");
    const notice = page.locator('[data-access="SERVICE_UNAVAILABLE"]');
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice).toContainText("cursor_key_unavailable");
    await expect(seal(page)).toHaveCount(0);
    await net.settle();
    const r = net.api().find((x) => x.status === 503)!;
    expect(r.server).toBe("uvicorn");
    expect(JSON.parse(r.body!).error).toMatchObject({ code: "cursor_key_unavailable", retryable: true });
    await stopService(service, `${browserName}:503`);
  });
  service = await startService(`${browserName}:503-recovered`);
  writeEvidence(`${browserName}/service-503`, net.summary());
});

test("404 · an unknown ID is not found, answered by the real Service", async ({ page, browserName }) => {
  const net = captureNetwork(page);
  await openLocal(page, "#/local/verifications/SPEC-404");
  await expect(page.locator('[data-access="NOT_FOUND"]')).toBeVisible({ timeout: 15_000 });
  await net.settle();
  const r = net.api()[0]!;
  expect([r.status, r.server, JSON.parse(r.body!).error.code]).toEqual([404, "uvicorn", "run_not_found"]);
  await expect(seal(page)).toHaveCount(0);
  writeEvidence(`${browserName}/not-found`, net.summary());
});

test("13 · malformed responses fail closed (a corrupted copy of a real Service body)", async ({ page, browserName }) => {
  const outcomes: Record<string, string | null> = {};
  for (const [name, corrupt] of [
    ["missing-required-key", (d: any) => delete d.result.cohort_state],
    ["counts-contradiction", (d: any) => (d.result.counts.Verified = 7)],
    ["unknown-verdict", (d: any) => (d.result.records[0].state = "Passed")],
    ["foreign-evaluator", (d: any) => (d.evaluation_context.evaluator.model_sha256 = "0".repeat(64))],
  ] as const) {
    await page.route("**/api/v1/verifications/SPEC-005?phase3b=true", async (route) => {
      const real = await route.fetch(); // the real Service answers; only the copy handed to the page is altered
      const body = JSON.parse(await real.text());
      corrupt(body);
      await route.fulfill({ response: real, body: JSON.stringify(body) });
    });
    await openLocal(page, "#/local/verifications/SPEC-005");
    const notice = page.locator('[data-access="REQUEST_ERROR"]');
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(seal(page)).toHaveCount(0);
    outcomes[name] = await notice.locator("dd").nth(2).textContent();
    await page.unroute("**/api/v1/verifications/SPEC-005?phase3b=true");
  }
  expect(outcomes).toEqual({
    "missing-required-key": "schema_invalid",
    "counts-contradiction": "counts_conflict",
    "unknown-verdict": "schema_invalid",
    "foreign-evaluator": "evaluator_identity_conflict",
  });
  await page.route("**/api/v1/verifications/SPEC-005?phase3b=true", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{not json" }));
  await openLocal(page, "#/local/verifications/SPEC-005");
  await expect(page.locator('[data-access="REQUEST_ERROR"]')).toContainText("malformed_response", { timeout: 15_000 });
  await page.unroute("**/api/v1/verifications/SPEC-005?phase3b=true");
  writeEvidence(`${browserName}/malformed`, outcomes);
});

test("cancellation and late responses: nothing published after cancel or navigation", async ({ page }) => {
  // The real SPEC-003 answer is held for 1.5 s and altered, so a late admission would be visible.
  const hold = async (route: import("@playwright/test").Route) => {
    const real = await route.fetch();
    const body = JSON.parse(await real.text());
    body.workflow.name = "LATE RESPONSE";
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ response: real, body: JSON.stringify(body) }).catch(() => {});
  };
  await page.route("**/api/v1/verifications/SPEC-003?phase3b=true", hold);
  await openLocal(page, "#/local/verifications/SPEC-003");
  await page.getByRole("button", { name: "Cancel read" }).click();
  await expect(page.getByText(/Read cancelled/)).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(seal(page)).toHaveCount(0);
  await expect(page.getByText("LATE RESPONSE")).toHaveCount(0);

  await openLocal(page, "#/local/verifications/SPEC-003");
  await page.evaluate(() => (window.location.hash = "#/local/verifications/SPEC-002"));
  await waitForCase(page, "Mismatch");
  await page.waitForTimeout(2000);
  await expect(seal(page)).toHaveAttribute("data-s", "Mismatch");
  await expect(page.getByText("LATE RESPONSE")).toHaveCount(0);
  await page.unroute("**/api/v1/verifications/SPEC-003?phase3b=true");
});

test("14 · UIA-009: a real response with n8n_label null renders, keeps search working, and searches no fallback", async ({ page }) => {
  await page.route("**/api/v1/verifications/SPEC-005?phase3b=true", async (route) => {
    const real = await route.fetch();
    const body = JSON.parse(await real.text());
    body.workflow.n8n_label = null;
    await route.fulfill({ response: real, body: JSON.stringify(body) });
  });
  await openLocal(page, "#/local/verifications/SPEC-005");
  await waitForCase(page, "Unverified");
  await expect(page.getByRole("region", { name: "Data provenance" }).getByText("Workflow label unavailable")).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search records" });
  await search.fill("unavailable");
  await expect(page.getByText("No records match")).toBeVisible();
  await search.fill("SYN-007");
  await expect(page.locator("[data-row-id]")).toHaveCount(1);
  await page.unroute("**/api/v1/verifications/SPEC-005?phase3b=true");
  // The MOCK list search is null-safe as well.
  await openLocal(page, "#/demo/verifications?q=label%20unavailable");
  await expect(page.getByText("No runs match")).toBeVisible();
});

test("mode separation: demo pages stay MOCK and never call the Service; local pages always show their mode", async ({ page }) => {
  const net = captureNetwork(page);
  for (const hash of ["#/demo", "#/demo/verifications", "#/demo/verifications/VR-2025", "#/connections", "#/rules", "#/settings"]) {
    await openLocal(page, hash);
    await expect(page.getByRole("region", { name: "Demo register" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Data provenance" })).toHaveCount(0);
    // Settings names the mode in its provider register (as one of three modes); nowhere else on a demo page.
    const register = page.getByRole("list", { name: "Data provider" }); // FIX03: a list, no longer a static radiogroup
    const total = await page.getByText("LOCAL_RESEARCH", { exact: true }).count();
    const inRegister = (await register.count()) ? await register.getByText("LOCAL_RESEARCH", { exact: true }).count() : 0;
    expect(total - inRegister, hash).toBe(0);
  }
  expect(net.all).toEqual([]);
  // Product round 02: the case list reads one live Detail per known case and the Phase 3A archive. The Phase 2
  // Service has no history routes: the archive read is answered without a FlowAssert envelope and reported as not
  // read, while the five live verdicts — real reads — are shown; nothing is compared and no archived verdict appears.
  await openLocal(page, "#/local/verifications");
  await expect(page.getByRole("region", { name: "Local research register" })).toBeVisible();
  await expect(page.locator('[data-access="SERVICE_UNAVAILABLE"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-case-table] [data-comparison]")).toHaveCount(5, { timeout: 15_000 });
  await expect(page.locator('[data-case-table] [data-comparison="SAME_INPUT_AGREE"]')).toHaveCount(0);
  await expect(page.locator("[data-case-table] .fa-seal")).toHaveCount(5); // live only — no archived verdict without an archive read
  await net.settle();
  expect(net.all.map((x) => x.pathAndQuery.split("?")[0]).sort()).toEqual(["/api/v1/history/verifications", ...["SPEC-001", "SPEC-002", "SPEC-003", "SPEC-004", "SPEC-005"].map((id) => `/api/v1/verifications/${id}`)]);
  expectOnlyAppOrigin(net.hosts);
});

test("accessibility and layout of the local pages (axe, both themes, 375–1440 px)", async ({ page, browserName }) => {
  const report: Record<string, unknown> = {};
  for (const theme of ["light", "dark"] as const)
    for (const hash of ["#/local/verifications", "#/local/verifications/SPEC-005", "#/local/verifications/SPEC-004"]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openLocal(page, hash, theme);
      if (hash.includes("SPEC")) {
        await expect(seal(page)).toHaveCount(1, { timeout: 15_000 });
        await expect(evidenceStatus(page)).toContainText(/references/, { timeout: 15_000 });
      }
      const collapsed = page.locator('main button[aria-expanded="false"]:visible');
      for (let i = 0; i < 20 && (await collapsed.count()) > 0; i++) await collapsed.first().click();
      await page.waitForTimeout(400);
      await page.addScriptTag({ path: AXE_PATH });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const r = await axe.run({ exclude: [["[data-ornament]"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] }, resultTypes: ["violations"] });
        return r.violations.map((v) => `${v.impact} ${v.id} ×${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      });
      report[`${theme} ${hash}`] = violations;
      expect(violations, `${theme} ${hash}`).toEqual([]);
      for (const w of [375, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width: w, height: 900 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${theme} ${hash} @${w}`).toBeLessThanOrEqual(0);
      }
    }
  writeEvidence(`${browserName}/axe-layout`, report);
});
