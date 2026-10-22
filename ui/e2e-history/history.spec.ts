/**
 * PHASE 3A — real end-to-end: browser → Evidence Atelier → LocalHistoryProvider → same-origin gate →
 * isolated exact-source Phase 3A Service → SQLite archive (created by the reviewed seed pipeline) →
 * rendered history. Nothing here is a test double: every /api response comes from the Service this suite
 * starts, restarts, switches between archive states and stops. Interception is used only where a scenario
 * needs it (a held or late copy of a real answer, a corrupted copy of a real body, a foreign-but-genuine
 * cursor sent to the real Service) and is named in each test. Test IDs F01–F24 follow the Phase 3A brief.
 *
 *   npx playwright test -c playwright.history.config.ts                      (Chrome)
 *   FA_BROWSERS=chrome,webkit,firefox npx playwright test -c playwright.history.config.ts
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { AXE_PATH } from "../e2e/helpers.ts";
import {
  APP_HOST,
  CASES,
  EXPECTED,
  FIRST,
  SEED,
  captureNetwork,
  custody,
  direct,
  evaluatorComputed,
  onlyAppOrigin,
  rawRequest,
  socketAudits,
  startService,
  stopService,
  writeEvidence,
  type ArchiveState,
  type ServiceProcess,
} from "./support.ts";

test.describe.configure({ mode: "serial" });

const suiteStart = Date.now();
const allHosts = new Set<string>();
let service: ServiceProcess;

async function switchTo(state: ArchiveState, label: string) {
  await stopService(service, `${label}:stop`);
  service = await startService(`${label}:start`, state);
}

test.beforeAll(async ({ browserName }) => {
  service = await startService(`${browserName}:suite`, "ui-main");
});
test.afterAll(async ({ browserName }) => {
  await stopService(service, `${browserName}:suite`);
  writeEvidence(`${browserName}/process-custody`, custody);
});

async function openApp(page: Page, hash: string, theme: "light" | "dark" = "light") {
  page.on("request", (r) => allHosts.add(new URL(r.url()).host));
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
const archived = (page: Page) => page.getByRole("region", { name: "Archived evidence" });
const retrieval = (page: Page) => page.locator("[data-retrieval]");
const integrityLine = (page: Page) => page.locator("[data-integrity]");
const topIntegrity = (page: Page) => page.locator("[data-archive-evidence-integrity]");
const rows = (page: Page) => page.locator("tr[data-history-id]");
const VERIFIED_LINE = "Stored-content integrity verified · 4 of 4 references — the Service’s stored-byte check and this browser’s SHA-256 agree";
const RETRIEVED_LINE = "All evidence pages retrieved · 2 pages · all 4 references, in the archive’s order";

/* ======================================================================================
 * Main archive (ui-main: two genuine five-case batches, 10 entries)
 * ====================================================================================== */

for (const id of CASES) {
  test(`F01 F02 F03 F07 F08 F09 F14 · ${id}: browser → gate → Service → SQLite; archived result = evaluator result = rendered; evidence bound and verified`, async ({ page, browserName }) => {
    const want = EXPECTED[id];
    const hid = FIRST[id];
    const net = captureNetwork(page);
    await openApp(page, `#/local/history/${hid}`);
    await expect(seal(page)).toHaveAttribute("data-s", want.cohort, { timeout: 20_000 });
    await expect(retrieval(page)).toHaveText("1 page retrieved · 2 of 4 references · more pages remain", { timeout: 20_000 });
    // F14: the first page is not integrity; the set is pending until every page is retrieved and checked.
    await expect(integrityLine(page)).toHaveText("Integrity not established yet · 2 of 4 references verified so far");
    await expect(topIntegrity(page)).toHaveAttribute("data-archive-evidence-integrity", "pending");
    await archived(page).getByRole("button", { name: "Read all remaining" }).click();
    await expect(retrieval(page)).toHaveText(RETRIEVED_LINE, { timeout: 20_000 });
    await expect(integrityLine(page)).toHaveText(VERIFIED_LINE);
    await expect(topIntegrity(page)).toHaveAttribute("data-archive-evidence-integrity", "verified");
    await net.settle();

    // F01: genuine HTTP — the Detail came through the gate from uvicorn, byte-identical to a direct read.
    const detail = net.api().find((x) => x.pathAndQuery === `/api/v1/history/${hid}` && x.status === 200)!;
    expect(detail, "browser Detail response").toBeTruthy();
    expect(detail.server).toBe("uvicorn");
    expect(detail.gate).toBeNull();
    const viaService = await direct(`/api/v1/history/${hid}`);
    expect(viaService.status).toBe(200);
    expect(viaService.text).toBe(detail.body);
    const dto = JSON.parse(detail.body!);

    // F03: the archived result is the pinned evaluator's own output (run directly by the oracle), unchanged.
    expect(dto.run.result).toEqual(evaluatorComputed(id));
    expect(dto.evaluator.model_sha256).toBe("b61779e198dd0213b67f8319b77a2daf9feb502dc553784df6d6600e8e3a842d");
    expect(dto.provenance).toMatchObject({ kind: "synthetic_local", research_authorization: "research_only", acquisition_authenticity: "not_authenticated" });
    // F02 / F07: independently fixed expectations, archived and rendered, in archive (capture) order.
    expect(dto.original_verification_id).toBe(id);
    expect(dto.run.result.cohort_state).toBe(want.cohort);
    expect(dto.run.result.records.map((r: { state: string }) => r.state)).toEqual(want.records);
    expect(dto.run.result.counts).toEqual(want.counts);
    expect(dto.run.result.expected_total).toBe(want.expectedTotal);
    expect(dto.result_summary).toEqual({ cohort_state: want.cohort, counts: want.counts, expected_total: want.expectedTotal, source_population_known: want.populationKnown });
    expect(await indexCells(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-s")))).toEqual(want.records);
    expect((await page.locator("[data-row-id]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rowId))).sort()).toEqual(want.records.map((_, i) => `${id}:${i}`).sort());
    const facts = page.locator('dl[aria-label="Case facts"]');
    await expect(facts.getByText("Expected total").locator("xpath=following-sibling::dd")).toHaveText(want.expectedTotal === null ? "unknown" : String(want.expectedTotal));

    // F08 / F09: archived evidence — pinned to the persistent history snapshot (never run.snapshot_id),
    // constant limit/payload, the opaque cursor sent back unchanged, references = the archived run's, in order.
    const pages = net.api().filter((x) => x.pathAndQuery.startsWith(`/api/v1/history/${hid}/evidence`) && x.status === 200);
    expect(pages).toHaveLength(2);
    const [p1, p2] = pages.map((x) => ({ url: new URL(x.url), body: JSON.parse(x.body!), server: x.server }));
    for (const p of [p1!, p2!]) {
      expect(p.server).toBe("uvicorn");
      expect(p.url.searchParams.get("snapshot_id")).toBe(dto.snapshot_id);
      expect(p.url.searchParams.get("snapshot_id")).not.toBe(dto.original_snapshot_id);
      expect(p.url.searchParams.get("limit")).toBe("2");
      expect(p.url.searchParams.get("include_payload")).toBe("true");
      expect(p.body.history_id).toBe(hid);
      expect(p.body.page.snapshot_id).toBe(dto.snapshot_id);
      expect(p.body.integrity.status).toBe("INTEGRITY_VERIFIED");
    }
    expect(p1!.url.searchParams.has("cursor")).toBe(false);
    expect(p2!.url.searchParams.get("cursor")).toBe(p1!.body.page.next_cursor);
    expect(p2!.body.page.next_cursor).toBeNull();
    const items = [...p1!.body.items, ...p2!.body.items];
    expect(items.map((x: { reference: unknown }) => x.reference)).toEqual(dto.run.evidence_references);
    for (const it of items) expect(it.integrity).toMatchObject({ status: "INTEGRITY_VERIFIED", checked_sha256: it.reference.sha256, content_scope: "evidence_canonical_bytes" });
    const ledger = page.getByRole("table", { name: "Archived evidence references for this entry" });
    expect(await ledger.locator("tbody tr .mono-id").allTextContents()).toEqual(dto.run.evidence_references.map((r: { id: string }) => r.id));
    await expect(ledger.locator('[data-integrity-item][data-i="verified"]')).toHaveCount(4);
    await expect(ledger.getByText("payload read · sha256 reproduced")).toHaveCount(4);

    // The archive is the only source: never the ephemeral verification routes, never another origin.
    expect(net.all.filter((x) => !x.pathAndQuery.startsWith("/api/v1/history/"))).toEqual([]);
    expect(onlyAppOrigin(net.hosts)).toEqual([APP_HOST]);
    for (const x of net.all) expect(x.requestHeaders.cookie ?? "").toBe("");
    writeEvidence(`${browserName}/F01-${id}-chain`, {
      case: id,
      history_id: hid,
      expected: want,
      rendered: { cohort: await seal(page).getAttribute("data-s"), records: await indexCells(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-s"))), retrieval: await retrieval(page).textContent(), integrity: await integrityLine(page).textContent() },
      service: { server: detail.server, detail_body_sha256: detail.bodySha256, direct_read_identical: true, snapshot_id: dto.snapshot_id, original_snapshot_id: dto.original_snapshot_id, archive_created_at: dto.archive_created_at, service_executed_at: dto.run.evaluation_context.service_executed_at },
      evaluator: { result_equals_direct_execution: true, model_sha256: dto.evaluator.model_sha256 },
      evidence: { pages: pages.map((x) => x.pathAndQuery.replace(/cursor=[^&]+/, "cursor=<opaque>")), references: items.map((x: { reference: { id: string } }) => x.reference.id), item_integrity: items.map((x: { integrity: { status: string } }) => x.integrity.status) },
      hosts: [...net.hosts],
      network: net.summary(),
    });
  });
}

test("F04 · SPEC-005: 12 Verified records, Unverified cohort, unknown population — copied, not inferred; an invented total is refused", async ({ page, browserName }) => {
  const hid = FIRST["SPEC-005"];
  await openApp(page, `#/local/history/${hid}`);
  await expect(seal(page)).toHaveAttribute("data-s", "Unverified", { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("All 12 visible records match — but the source total is unconfirmed.");
  await expect(page.locator('section[aria-labelledby="index-title"] i.fa-cell[data-s="unknown"]')).toHaveCount(3);
  await expect(indexCells(page)).toHaveCount(12);
  // Data-origin probe (interception of a REAL body): a consistent rewrite of the archived cohort is drawn as
  // written — proof the cohort is copied, not computed from 12 Verified rows (P2-AUD-006 boundary).
  await page.route(`**/api/v1/history/${hid}`, async (route) => {
    const real = await route.fetch();
    const body = JSON.parse(await real.text());
    body.run.result.cohort_state = "Verified";
    body.result_summary.cohort_state = "Verified";
    await route.fulfill({ response: real, body: JSON.stringify(body) });
  });
  await openApp(page, `#/local/history/${hid}`);
  await expect(seal(page)).toHaveAttribute("data-s", "Verified", { timeout: 20_000 });
  await page.unroute(`**/api/v1/history/${hid}`);
  // An invented total (12) on an unknown population is refused, not drawn.
  await page.route(`**/api/v1/history/${hid}`, async (route) => {
    const real = await route.fetch();
    const body = JSON.parse(await real.text());
    body.run.result.expected_total = 12;
    body.result_summary.expected_total = 12;
    await route.fulfill({ response: real, body: JSON.stringify(body) });
  });
  await openApp(page, `#/local/history/${hid}`);
  await expect(page.locator('[data-access="REQUEST_ERROR"]')).toContainText("population_conflict", { timeout: 20_000 });
  await expect(seal(page)).toHaveCount(0);
  await page.unroute(`**/api/v1/history/${hid}`);
  // The list says "total unknown" for SPEC-005, never 0 or 12.
  await openApp(page, "#/local/history?case=SPEC-005");
  await expect(rows(page)).toHaveCount(2, { timeout: 20_000 });
  for (const r of await rows(page).all()) {
    await expect(r).toContainText("12 records · total unknown");
    await expect(r).not.toContainText("12 expected");
  }
  writeEvidence(`${browserName}/F04-SPEC-005`, { history_id: hid, rendered_cohort: "Unverified", unknown_cells: 3, records: 12, consistent_rewrite_drawn_as_written: true, invented_total_refused: "population_conflict" });
});

test("F06 · list: both genuine batches, stable IDs, archive order, three pages under one list snapshot", async ({ page, browserName }) => {
  const net = captureNetwork(page);
  await openApp(page, "#/local/history");
  await expect(rows(page)).toHaveCount(4, { timeout: 20_000 });
  await page.getByRole("button", { name: "Load older entries" }).click();
  await expect(rows(page)).toHaveCount(8, { timeout: 20_000 });
  await page.getByRole("button", { name: "Load older entries" }).click();
  await expect(rows(page)).toHaveCount(10, { timeout: 20_000 });
  await expect(page.locator("[data-list-status]")).toContainText("All 10 archive entries shown · 3 pages, in archive order");
  const ids = await rows(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.historyId));
  // Newest archive sequence first: the re-evaluated batch, then the initial batch, each SPEC-005 → SPEC-001.
  expect(ids).toEqual([...[...SEED["ui-main"].reevaluated].reverse(), ...[...SEED["ui-main"].initial].reverse()]);
  const directAll = JSON.parse((await direct("/api/v1/history?limit=100")).text);
  expect(ids).toEqual(directAll.items.map((x: { history_id: string }) => x.history_id));
  expect(directAll.page.total).toBe(10);
  const cases = directAll.items.map((x: { original_verification_id: string }) => x.original_verification_id) as (keyof typeof EXPECTED)[];
  expect(await rows(page).evaluateAll((els) => els.map((e) => e.querySelector(".fa-seal")!.getAttribute("data-s")))).toEqual(cases.map((c) => EXPECTED[c].cohort));
  await net.settle();
  const lists = net.api().filter((x) => x.pathAndQuery.startsWith("/api/v1/history?"));
  expect(lists).toHaveLength(3);
  const bodies = lists.map((x) => JSON.parse(x.body!));
  expect(new Set(bodies.map((b) => b.page.snapshot_id)).size).toBe(1);
  expect(bodies.map((b) => b.page.total)).toEqual([10, 10, 10]);
  expect(new URL(lists[0]!.url).searchParams.has("cursor")).toBe(false);
  expect(new URL(lists[1]!.url).searchParams.get("cursor")).toBe(bodies[0].page.next_cursor);
  expect(new URL(lists[2]!.url).searchParams.get("cursor")).toBe(bodies[1].page.next_cursor);
  expect(bodies[2].page.next_cursor).toBeNull();
  for (const x of lists) expect(new URL(x.url).searchParams.get("limit")).toBe("4");
  // Filter: the contract's verification_id; one case has two archived evaluations, each its own history ID.
  await openApp(page, "#/local/history?case=SPEC-005");
  await expect(rows(page)).toHaveCount(2, { timeout: 20_000 });
  expect(await rows(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.historyId))).toEqual([SEED["ui-main"].reevaluated[4], SEED["ui-main"].initial[4]]);
  writeEvidence(`${browserName}/F06-list`, { ids, list_snapshot: bodies[0].page.snapshot_id, totals: bodies.map((b) => b.page.total), pages: lists.map((x) => x.pathAndQuery.replace(/cursor=[^&]+/, "cursor=<opaque>")) });
});

test("F10 · a genuine cursor from another history is rejected by the real Service: request error, nothing merged", async ({ page, browserName }) => {
  const A = FIRST["SPEC-001"];
  const B = FIRST["SPEC-002"];
  const bDetail = JSON.parse((await direct(`/api/v1/history/${B}`)).text);
  const bPage = JSON.parse((await direct(`/api/v1/history/${B}/evidence?snapshot_id=${bDetail.snapshot_id}&limit=2&include_payload=true`)).text);
  const foreign: string = bPage.page.next_cursor;
  expect(foreign).toBeTruthy();
  // Direct, non-browser probe first.
  const aDetail = JSON.parse((await direct(`/api/v1/history/${A}`)).text);
  const probe = await direct(`/api/v1/history/${A}/evidence?snapshot_id=${aDetail.snapshot_id}&limit=2&include_payload=true&cursor=${encodeURIComponent(foreign)}`);
  expect(probe.status).toBe(400);
  expect(JSON.parse(probe.text).error.code).toBe("cursor_query_conflict");
  // In the browser: interception swaps only the cursor of A's continuation for B's genuine one; the Service answers for real.
  const net = captureNetwork(page);
  const pattern = new RegExp(`/api/v1/history/${A}/evidence\\?.*cursor=`);
  await page.route(pattern, async (route) => {
    const u = new URL(route.request().url());
    u.searchParams.set("cursor", foreign);
    await route.continue({ url: u.toString() });
  });
  await openApp(page, `#/local/history/${A}`);
  await expect(retrieval(page)).toContainText("2 of 4 references", { timeout: 20_000 });
  await archived(page).getByRole("button", { name: "Read next page" }).click();
  await expect(page.getByText(/rejected the continuation cursor for this archive/)).toBeVisible({ timeout: 20_000 });
  await net.settle();
  const rejected = net.api().find((x) => x.status === 400)!;
  expect(rejected.server).toBe("uvicorn");
  expect(JSON.parse(rejected.body!).error.code).toBe("cursor_query_conflict");
  await expect(retrieval(page)).toHaveText("Evidence retrieval stopped · nothing kept");
  await expect(archived(page).getByText(/payload read/)).toHaveCount(0);
  await expect(seal(page)).toHaveAttribute("data-s", "Verified");
  await expect(topIntegrity(page)).toHaveAttribute("data-archive-evidence-integrity", "pending");
  await page.unroute(pattern);
  writeEvidence(`${browserName}/F10-cross-history-cursor`, { history_a: A, history_b: B, direct_probe: { status: probe.status, code: "cursor_query_conflict" }, browser: { status: 400, code: "cursor_query_conflict", server: rejected.server }, network: net.summary() });
});

test("F11 · malformed history and verification IDs are refused before any request (P2-AUD-003)", async ({ page, browserName }) => {
  const net = captureNetwork(page);
  const hostile = [".", "..", "%2E%2E", "%2e%2E", "%252E%252E", "hist_ABC", `hist_${"A".repeat(64)}`, `hist_${"a".repeat(65)}`, "SPEC%2F001", "..%2F..%2Fdocs", "SPEC%5C001", "%E0%A4%A", "%00", "SPEC%0A001", "a".repeat(300)];
  const outcomes: Record<string, string | null> = {};
  for (const seg of hostile) {
    await openApp(page, `#/local/history/${seg}`);
    await expect(page.getByText("This address does not name a valid history entry"), seg).toBeVisible();
    outcomes[`history ${seg.slice(0, 24)}`] = await page.locator("[data-access] dd").nth(1).textContent();
  }
  // P3A-AUD-001: dot segments and "/" are contract-valid but not transportable (said so, never called invalid);
  // malformed address encoding and over-long IDs are invalid. "%00" (a contract-valid control character) is no
  // longer refused: contract-valid IDs are covered end to end by id-compat.spec.ts.
  for (const [seg, title] of [
    [".", "This verification ID cannot be requested over the local API"],
    ["..", "This verification ID cannot be requested over the local API"],
    ["%2E%2E", "This verification ID cannot be requested over the local API"],
    ["SPEC%2F001", "This verification ID cannot be requested over the local API"],
    ["%E0%A4%A", "This address does not name a valid verification ID"],
    ["a".repeat(129), "This address does not name a valid verification ID"],
  ] as const) {
    await openApp(page, `#/local/verifications/${seg}`);
    await expect(page.getByText(title), seg).toBeVisible();
    outcomes[`verification ${seg.slice(0, 24)}`] = await page.locator("[data-access] dd").nth(1).textContent();
  }
  await net.settle();
  expect(net.all).toEqual([]); // nothing at all was sent
  // The Service itself also refuses them (defence in depth, direct non-browser probes).
  // Raw targets (no client-side normalization), as a non-browser client would send them.
  for (const p of ["/api/v1/history/%2e%2e", "/api/v1/history/%2E%2E/secret", "/api/v1/history/hist_ABC", "/api/v1/history/x/y/z"]) expect((await rawRequest(8765, p)).status, p).toBe(422);
  writeEvidence(`${browserName}/F11-invalid-ids`, { requests_sent: net.all.length, outcomes });
});

test("F14 · payloads omitted by request: all pages retrieved, integrity unverifiable — never 'verified'", async ({ page, browserName }) => {
  const net = captureNetwork(page);
  const hid = FIRST["SPEC-003"];
  await openApp(page, `#/local/history/${hid}`);
  await expect(seal(page)).toHaveAttribute("data-s", "Pending", { timeout: 20_000 });
  await archived(page).getByRole("radio", { name: "References only" }).click();
  await expect(archived(page).getByText("payload omitted · omitted_by_request")).toHaveCount(2, { timeout: 20_000 });
  await archived(page).getByRole("button", { name: "Read all remaining" }).click();
  await expect(retrieval(page)).toHaveText(RETRIEVED_LINE, { timeout: 20_000 });
  await expect(integrityLine(page)).toContainText("Integrity unverifiable · 4 of 4 references not verified (payload omitted by request");
  await expect(topIntegrity(page)).toHaveAttribute("data-archive-evidence-integrity", "unverifiable");
  await expect(page.getByText("Stored-content integrity verified")).toHaveCount(0);
  await net.settle();
  const last = net.api().filter((x) => x.pathAndQuery.includes("include_payload=false"));
  expect(last).toHaveLength(2);
  for (const x of last) for (const it of JSON.parse(x.body!).items) expect([it.payload, it.payload_reason, it.integrity.status]).toEqual([null, "omitted_by_request", "INTEGRITY_VERIFIED"]);
  writeEvidence(`${browserName}/F14-payload-omitted`, { history_id: hid, retrieval: await retrieval(page).textContent(), integrity: await integrityLine(page).textContent(), service_item_status: "INTEGRITY_VERIFIED (stored content still checked)" });
});

test("F12 F14 · P2-AUD-001: a payload altered after the Service answered is a conspicuous integrity failure naming the reference", async ({ page, browserName }) => {
  const hid = FIRST["SPEC-001"];
  // Interception: the REAL second evidence page is fetched from the Service; one payload is altered in the copy.
  const pattern = new RegExp(`/api/v1/history/${hid}/evidence\\?.*cursor=`);
  await page.route(pattern, async (route) => {
    const real = await route.fetch();
    const body = JSON.parse(await real.text());
    body.items[0].payload.phase3a_altered = true;
    await route.fulfill({ response: real, body: JSON.stringify(body) });
  });
  await openApp(page, `#/local/history/${hid}`);
  await expect(retrieval(page)).toContainText("2 of 4", { timeout: 20_000 });
  await archived(page).getByRole("button", { name: "Read next page" }).click();
  await expect(topIntegrity(page)).toHaveAttribute("data-archive-evidence-integrity", "failed", { timeout: 20_000 });
  await expect(retrieval(page)).toHaveText(RETRIEVED_LINE); // retrieval complete …
  await expect(integrityLine(page)).toHaveText("Integrity failed · SPEC-001-policy — content failed internal consistency verification"); // … integrity failed
  const alert = archived(page).getByRole("alert");
  await expect(alert).toContainText("SPEC-001-policy");
  await expect(alert).toContainText("not a Mismatch");
  await expect(page.locator('[data-digest-mismatch="SPEC-001-policy"]')).toBeVisible();
  await expect(page.locator('.fa-iseal[data-i="verified"]')).toHaveCount(0);
  await expect(page.getByText("Stored-content integrity verified")).toHaveCount(0);
  await expect(seal(page)).toHaveAttribute("data-s", "Verified"); // the archived verdict is not re-evaluated
  await page.unroute(pattern);
  writeEvidence(`${browserName}/P2-AUD-001-browser-mismatch`, { history_id: hid, affected: "SPEC-001-policy", top_integrity: "failed", verified_seals: 0, verdict_unchanged: "Verified" });
});

test("F16 · invalid HTTP responses fail closed (corrupted copies of real Service bodies)", async ({ page, browserName }) => {
  const hid = FIRST["SPEC-005"];
  const outcomes: Record<string, string | null> = {};
  for (const [name, corrupt] of [
    ["missing-required-key", (d: any) => delete d.result_summary],
    ["summary-contradicts-archived-run", (d: any) => (d.result_summary.cohort_state = "Verified")],
    ["unknown-verdict", (d: any) => (d.run.result.records[0].state = "Passed")],
    ["foreign-evaluator", (d: any) => (d.evaluator.model_sha256 = "0".repeat(64))],
    ["record-order-swapped", (d: any) => ([d.run.result.records[0], d.run.result.records[1]] = [d.run.result.records[1], d.run.result.records[0]])],
  ] as const) {
    await page.route(`**/api/v1/history/${hid}`, async (route) => {
      const real = await route.fetch();
      const body = JSON.parse(await real.text());
      corrupt(body);
      await route.fulfill({ response: real, body: JSON.stringify(body) });
    });
    await openApp(page, `#/local/history/${hid}`);
    const notice = page.locator('[data-access="REQUEST_ERROR"]');
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(seal(page)).toHaveCount(0);
    outcomes[name] = await notice.locator("dd").nth(2).textContent();
    await page.unroute(`**/api/v1/history/${hid}`);
  }
  expect(outcomes).toEqual({
    "missing-required-key": "schema_invalid",
    "summary-contradicts-archived-run": "summary_conflict",
    "unknown-verdict": "schema_invalid",
    "foreign-evaluator": "evaluator_identity_conflict",
    "record-order-swapped": "row_inventory_conflict",
  });
  // INTEGRITY_FAILED inside a 200 is an integrity failure, never a success.
  await page.route(`**/api/v1/history/${hid}`, async (route) => {
    const real = await route.fetch();
    const body = JSON.parse(await real.text());
    body.integrity.status = "INTEGRITY_FAILED";
    await route.fulfill({ response: real, body: JSON.stringify(body) });
  });
  await openApp(page, `#/local/history/${hid}`);
  await expect(page.locator('[data-integrity-notice="failed"]')).toContainText("integrity_status_conflict", { timeout: 20_000 });
  await expect(seal(page)).toHaveCount(0);
  await page.unroute(`**/api/v1/history/${hid}`);
  // Not JSON at all.
  await page.route("**/api/v1/history?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{not json" }));
  await openApp(page, "#/local/history");
  await expect(page.locator('[data-access="REQUEST_ERROR"]')).toContainText("malformed_response", { timeout: 20_000 });
  await expect(rows(page)).toHaveCount(0);
  await page.unroute("**/api/v1/history?**");
  writeEvidence(`${browserName}/F16-malformed`, { ...outcomes, "integrity-failed-in-200": "integrity_status_conflict", "list-not-json": "malformed_response" });
});

test("F17 F18 · cancellation and late responses: nothing published after cancel; history A never overwrites B; A's evidence never attaches to B", async ({ page, browserName }) => {
  const A = FIRST["SPEC-003"];
  const B = FIRST["SPEC-002"];
  // Interception: the REAL answer for A is held 1.5 s and altered, so a late admission would be visible.
  const holdDetail = async (route: Route) => {
    const real = await route.fetch();
    const body = JSON.parse(await real.text());
    body.run.workflow.name = "LATE RESPONSE";
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ response: real, body: JSON.stringify(body) }).catch(() => {});
  };
  await page.route(`**/api/v1/history/${A}`, holdDetail);
  await openApp(page, `#/local/history/${A}`);
  await page.getByRole("button", { name: "Cancel read" }).click();
  await expect(page.getByText(/Read cancelled/)).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(seal(page)).toHaveCount(0);
  await expect(page.getByText("LATE RESPONSE")).toHaveCount(0);

  await openApp(page, `#/local/history/${A}`);
  await page.evaluate((b) => (window.location.hash = `#/local/history/${b}`), B);
  await expect(seal(page)).toHaveAttribute("data-s", "Mismatch", { timeout: 20_000 });
  await page.waitForTimeout(2000);
  await expect(seal(page)).toHaveAttribute("data-s", "Mismatch");
  await expect(page.locator("[data-history-entry]")).toHaveAttribute("data-history-entry", B);
  await expect(page.getByText("LATE RESPONSE")).toHaveCount(0);
  await page.unroute(`**/api/v1/history/${A}`);

  // A's first evidence page (real, held) arrives after the view moved to B: it is never attached to B.
  const evPattern = new RegExp(`/api/v1/history/${A}/evidence`);
  await page.route(evPattern, async (route) => {
    const real = await route.fetch();
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ response: real }).catch(() => {});
  });
  await openApp(page, `#/local/history/${A}`);
  await expect(seal(page)).toHaveAttribute("data-s", "Pending", { timeout: 20_000 });
  await page.evaluate((b) => (window.location.hash = `#/local/history/${b}`), B);
  await expect(retrieval(page)).toContainText("2 of 4", { timeout: 20_000 });
  await page.waitForTimeout(2000);
  const ids = await page.getByRole("table", { name: "Archived evidence references for this entry" }).locator("tbody tr .mono-id").allTextContents();
  expect(ids.every((x) => x.startsWith("SPEC-002-"))).toBe(true);
  await expect(retrieval(page)).toHaveText("1 page retrieved · 2 of 4 references · more pages remain");
  await page.unroute(evPattern);
  writeEvidence(`${browserName}/F17-F18-async`, { cancelled_published: false, late_detail_published: false, late_evidence_attached_to_other_history: false });
});

test("F19 · MOCK / LOCAL_RESEARCH separation: demo pages never call the Service; history pages call only the history routes", async ({ page, browserName }) => {
  const net = captureNetwork(page);
  // Product round 01: the MOCK demo moved under #/demo; #/capture is LOCAL_RESEARCH but reads nothing.
  for (const hash of ["#/demo", "#/demo/verifications", "#/demo/verifications/VR-2025", "#/connections", "#/rules", "#/settings", "#/capture"]) {
    await openApp(page, hash);
    await page.locator("main :is(h1, h2)").first().waitFor();
  }
  await net.settle();
  expect(net.all).toEqual([]);
  await openApp(page, "#/local/history");
  await expect(rows(page)).toHaveCount(4, { timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Local research register" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary" }).first();
  await expect(nav.getByRole("link", { name: /History/ })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Verifications", exact: true })).not.toHaveAttribute("aria-current", "page");
  await net.settle();
  expect(net.all.map((x) => x.pathAndQuery.split("?")[0])).toEqual(["/api/v1/history"]);
  await openApp(page, "#/demo");
  await expect(page.getByRole("region", { name: "Demo register" })).toBeVisible();
  await expect(page.getByText(/hist_[a-f0-9]{8}/)).toHaveCount(0);
  writeEvidence(`${browserName}/F19-mode-separation`, { demo_requests: 0, history_requests: net.all.map((x) => x.pathAndQuery.split("?")[0]) });
});

test("F20 · the accepted Phase 2 Detail/Evidence paths still work on the Phase 3A Service, through the gate", async ({ page, browserName }) => {
  const report: Record<string, unknown> = {};
  for (const id of CASES) {
    const net = captureNetwork(page);
    await openApp(page, `#/local/verifications/${id}`);
    await expect(seal(page)).toHaveAttribute("data-s", EXPECTED[id].cohort, { timeout: 20_000 });
    const panel = page.getByRole("region", { name: "Evidence references" });
    await expect(retrieval(page)).toContainText("2 of 4 references", { timeout: 20_000 });
    await panel.getByRole("button", { name: "Read all remaining" }).click();
    await expect(retrieval(page)).toHaveText("All evidence pages retrieved · 2 pages · all 4 references, in the Detail’s order", { timeout: 20_000 });
    await expect(integrityLine(page)).toHaveText("Payload digests reproduced in this browser · 4 of 4 — internal consistency only");
    await net.settle();
    const detail = net.api().find((x) => x.pathAndQuery === `/api/v1/verifications/${id}`)!;
    expect(detail.server).toBe("uvicorn");
    expect(JSON.parse(detail.body!).result).toEqual(evaluatorComputed(id));
    // Product round 01: besides its own verification reads, the Detail reads ONLY this case's archive list
    // (Archive status axis) — scoped by verification_id, never another case, never a Detail or evidence of history.
    const ownArchive = new RegExp(`^/api/v1/history\\?limit=4&verification_id=${id}(&cursor=[^&]+)?$`);
    expect(net.all.filter((x) => !x.pathAndQuery.startsWith(`/api/v1/verifications/${id}`)).map((x) => x.pathAndQuery).filter((q) => !ownArchive.test(q))).toEqual([]);
    expect(net.all.some((x) => ownArchive.test(x.pathAndQuery))).toBe(true);
    report[id] = { cohort: EXPECTED[id].cohort, requests: net.all.map((x) => x.pathAndQuery.replace(/cursor=[^&]+/, "cursor=<opaque>")) };
  }
  writeEvidence(`${browserName}/F20-phase2-paths`, report);
});

test("F05 F21 · real Service restart: history IDs, bodies and history cursors survive; the ephemeral cursor still gets 409 and an explicit re-read", async ({ page, context, browserName }) => {
  const A = FIRST["SPEC-004"];
  // Before restart: a list view at page 1, an archived entry at evidence page 1, a Phase 2 case at evidence page 1.
  const listNet = captureNetwork(page);
  await openApp(page, "#/local/history");
  await expect(rows(page)).toHaveCount(4, { timeout: 20_000 });
  const entry = await context.newPage();
  const entryNet = captureNetwork(entry);
  await openApp(entry, `#/local/history/${A}`);
  await expect(retrieval(entry)).toContainText("2 of 4", { timeout: 20_000 });
  const eph = await context.newPage();
  const ephNet = captureNetwork(eph);
  await openApp(eph, "#/local/verifications/SPEC-001");
  await expect(retrieval(eph)).toContainText("2 of 4", { timeout: 20_000 });
  await ephNet.settle();
  const before = JSON.parse(ephNet.api().find((x) => x.pathAndQuery === "/api/v1/verifications/SPEC-001")!.body!).snapshot_id;
  const allIds = [...SEED["ui-main"].initial, ...SEED["ui-main"].reevaluated];
  const bodiesBefore = Object.fromEntries(await Promise.all(allIds.map(async (h) => [h, (await direct(`/api/v1/history/${h}`)).text] as const)));

  await stopService(service, `${browserName}:restart`);
  service = await startService(`${browserName}:restart`, "ui-main");

  // F05: the list continuation issued before the restart continues the same pinned view.
  await page.getByRole("button", { name: "Load older entries" }).click();
  await expect(rows(page)).toHaveCount(8, { timeout: 20_000 });
  await listNet.settle();
  const lists = listNet.api().filter((x) => x.pathAndQuery.startsWith("/api/v1/history?"));
  expect(lists.map((x) => x.status)).toEqual([200, 200]);
  expect(JSON.parse(lists[1]!.body!).page.snapshot_id).toBe(JSON.parse(lists[0]!.body!).page.snapshot_id);
  // F05: the archived evidence continuation issued before the restart completes, verified.
  await archived(entry).getByRole("button", { name: "Read next page" }).click();
  await expect(retrieval(entry)).toHaveText(RETRIEVED_LINE, { timeout: 20_000 });
  await expect(integrityLine(entry)).toHaveText(VERIFIED_LINE);
  await entryNet.settle();
  expect(entryNet.api().filter((x) => x.pathAndQuery.includes("/evidence")).map((x) => x.status)).toEqual([200, 200]);
  // F06: every history ID and Detail body is identical after the restart.
  for (const h of allIds) expect((await direct(`/api/v1/history/${h}`)).text, h).toBe(bodiesBefore[h]);
  // F21: the accepted ephemeral behaviour is unchanged — old cursor → 409, stale state, explicit re-read.
  await eph.getByRole("region", { name: "Evidence references" }).getByRole("button", { name: "Read next page" }).click();
  await expect(eph.getByText("This case was read from a snapshot the service no longer serves")).toBeVisible({ timeout: 20_000 });
  await ephNet.settle();
  const conflict = ephNet.api().find((x) => x.status === 409)!;
  expect(JSON.parse(conflict.body!).error.code).toBe("snapshot_unavailable");
  expect(new URL(conflict.url).searchParams.get("snapshot_id")).toBe(before);
  await expect(seal(eph)).toHaveAttribute("data-s", "Verified");
  await eph.getByRole("button", { name: "Re-read the whole case" }).first().click();
  await expect(retrieval(eph)).toContainText("2 of 4", { timeout: 20_000 });
  const after = JSON.parse((await direct("/api/v1/verifications/SPEC-001")).text).snapshot_id;
  expect(after).not.toBe(before);
  await entry.close();
  await eph.close();
  writeEvidence(`${browserName}/F05-F21-restart`, {
    history_ids_stable: true,
    detail_bodies_identical: allIds.length,
    list_continuation_after_restart: lists.map((x) => x.status),
    list_snapshot: JSON.parse(lists[0]!.body!).page.snapshot_id,
    evidence_continuation_after_restart: "200, all pages retrieved, integrity verified",
    ephemeral: { before, after, conflict: "409 snapshot_unavailable" },
  });
});

test("F15 · local Service stopped: SERVICE_UNAVAILABLE, no entries, no verdict, no demo data — then a real read once it is back", async ({ page, browserName }) => {
  const net = captureNetwork(page);
  await stopService(service, `${browserName}:outage`);
  try {
    await openApp(page, "#/local/history");
    const notice = page.locator('[data-access="SERVICE_UNAVAILABLE"]');
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText("none — no other data source is used");
    await expect(rows(page)).toHaveCount(0);
    await openApp(page, `#/local/history/${FIRST["SPEC-002"]}`);
    await expect(page.locator('[data-access="SERVICE_UNAVAILABLE"]')).toBeVisible({ timeout: 20_000 });
    await expect(seal(page)).toHaveCount(0);
    await expect(page.getByText(/VR-20\d\d/)).toHaveCount(0);
    await net.settle();
    for (const x of net.api()) {
      expect(x.server).not.toBe("uvicorn"); // the gate answered, not the Service
      expect(x.gate).toBe("refused");
      expect(JSON.parse(x.body!).gate.code).toBe("service_unreachable");
    }
  } finally {
    service = await startService(`${browserName}:outage-recovered`, "ui-main");
  }
  await page.getByRole("button", { name: "Read again" }).click();
  await expect(seal(page)).toHaveAttribute("data-s", "Mismatch", { timeout: 20_000 });
  writeEvidence(`${browserName}/F15-service-unavailable`, net.summary());
});

test("accessibility and layout of the history pages (axe, both themes, 375–1440 px, keyboard)", async ({ page, browserName }) => {
  const report: Record<string, unknown> = {};
  for (const theme of ["light", "dark"] as const)
    for (const hash of ["#/local/history", `#/local/history/${FIRST["SPEC-005"]}`, `#/local/history/${FIRST["SPEC-002"]}`]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openApp(page, hash, theme);
      if (hash.includes("hist_")) {
        await expect(seal(page)).toHaveCount(1, { timeout: 20_000 });
        await expect(retrieval(page)).toContainText("2 of 4", { timeout: 20_000 });
        await archived(page).getByRole("button", { name: "Read all remaining" }).click();
        await expect(retrieval(page)).toHaveText(RETRIEVED_LINE, { timeout: 20_000 });
      } else await expect(rows(page)).toHaveCount(4, { timeout: 20_000 });
      const collapsed = page.locator('main button[aria-expanded="false"]:visible');
      for (let i = 0; i < 20 && (await collapsed.count()) > 0; i++) await collapsed.first().click();
      await page.waitForTimeout(500);
      await page.addScriptTag({ path: AXE_PATH });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const r = await axe.run({ exclude: [["[data-ornament]"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] }, resultTypes: ["violations"] });
        return r.violations.map((v) => `${v.impact} ${v.id} ×${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      });
      const key = `${theme} ${hash.replace(/hist_[a-f0-9]{64}/, (m) => `${m.slice(0, 13)}…`)}`;
      report[key] = violations;
      expect(violations, key).toEqual([]);
      for (const w of [375, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width: w, height: 900 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${key} @${w}`).toBeLessThanOrEqual(0);
      }
    }
  // Keyboard: the first entry is reachable with Tab from the filter, and arrow keys move between entries.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "#/local/history");
  await expect(rows(page)).toHaveCount(4, { timeout: 20_000 });
  const links = page.locator('[data-history-layout="wide"] a[data-history-link]');
  await links.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(links.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(links.nth(3)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(seal(page)).toHaveCount(1, { timeout: 20_000 });
  writeEvidence(`${browserName}/axe-layout-keyboard`, report);
});

test("narrow screens (375 px): the retrieval and integrity lines stay visible and readable in both evidence panels", async ({ page, browserName }) => {
  const report: Record<string, unknown> = {};
  for (const hash of [`#/local/history/${FIRST["SPEC-005"]}`, "#/local/verifications/SPEC-005"]) {
    await page.setViewportSize({ width: 375, height: 812 });
    await openApp(page, hash);
    await expect(retrieval(page)).toContainText("2 of 4", { timeout: 20_000 });
    for (const loc of [retrieval(page), integrityLine(page)]) {
      await expect(loc).toBeVisible();
      const box = (await loc.boundingBox())!;
      expect(box.width, hash).toBeGreaterThan(180);
    }
    report[hash.replace(/hist_[a-f0-9]{64}/, "hist_…")] = { retrieval: (await retrieval(page).boundingBox())!.width, integrity: (await integrityLine(page).boundingBox())!.width };
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  writeEvidence(`${browserName}/narrow-evidence-status`, report);
});

/* ======================================================================================
 * Negative and empty archives (each switched to explicitly, then back to ui-main)
 * ====================================================================================== */

test("F12 · corrupted stored evidence (ui-corrupt): real 503 INTEGRITY_FAILED — conspicuous failure, no verdict; intact entries still read", async ({ page, browserName }) => {
  await switchTo("ui-corrupt", `${browserName}:corrupt`);
  try {
    const bad = SEED["ui-corrupt"].damage.history_id;
    const ok = SEED["ui-corrupt"].history_ids[0]!;
    const d1 = await direct(`/api/v1/history/${bad}`);
    expect(d1.status).toBe(503);
    expect(JSON.parse(d1.text).error).toMatchObject({ code: "evidence_digest_mismatch", details: [{ path: "archive", code: "INTEGRITY_FAILED" }] });
    const badDetail = await direct(`/api/v1/history/${bad}/evidence?include_payload=false`);
    expect(badDetail.status).toBe(503); // integrity checks precede payload omission
    const net = captureNetwork(page);
    await openApp(page, "#/local/history");
    const listAlert = page.locator('[data-integrity-notice="failed"]');
    await expect(listAlert).toBeVisible({ timeout: 20_000 });
    await expect(listAlert).toHaveAttribute("role", "alert");
    await expect(listAlert).toContainText("evidence_digest_mismatch");
    await expect(rows(page)).toHaveCount(0);
    await openApp(page, `#/local/history/${bad}`);
    const alert = page.locator('[data-integrity-notice="failed"]');
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert.locator("h1")).toContainText("Stored content failed internal consistency verification");
    await expect(alert).toContainText("INTEGRITY_FAILED");
    await expect(seal(page)).toHaveCount(0);
    await expect(page.locator("[data-row-id]")).toHaveCount(0);
    await expect(page.locator('.fa-iseal[data-i="verified"]')).toHaveCount(0);
    await openApp(page, `#/local/history/${ok}`);
    await expect(seal(page)).toHaveAttribute("data-s", "Verified", { timeout: 20_000 });
    await archived(page).getByRole("button", { name: "Read all remaining" }).click();
    await expect(integrityLine(page)).toHaveText(VERIFIED_LINE, { timeout: 20_000 });
    await openApp(page, "#/local/history?case=SPEC-001");
    await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
    await net.settle();
    const failures = net.api().filter((x) => x.status === 503);
    expect(failures.length).toBeGreaterThanOrEqual(2);
    for (const f of failures) expect(f.server).toBe("uvicorn");
    writeEvidence(`${browserName}/F12-corrupt-archive`, { damaged: SEED["ui-corrupt"].damage, direct: JSON.parse(d1.text), evidence_with_payload_omitted: badDetail.status, network: net.summary() });
  } finally {
    await switchTo("ui-main", `${browserName}:corrupt-restore`);
  }
});

test("F13 · expected stored content missing (ui-unverifiable): real 503 INTEGRITY_UNVERIFIABLE — never shown as verified or as a verdict", async ({ page, browserName }) => {
  await switchTo("ui-unverifiable", `${browserName}:unverifiable`);
  try {
    const bad = SEED["ui-unverifiable"].damage.history_id;
    const d1 = await direct(`/api/v1/history/${bad}`);
    expect(d1.status).toBe(503);
    expect(JSON.parse(d1.text).error).toMatchObject({ code: "archived_evidence_missing", details: [{ path: "archive", code: "INTEGRITY_UNVERIFIABLE" }] });
    await openApp(page, `#/local/history/${bad}`);
    const notice = page.locator('[data-integrity-notice="unverifiable"]');
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toHaveAttribute("role", "status");
    await expect(notice.locator("h1")).toContainText("Stored content could not be verified");
    await expect(seal(page)).toHaveCount(0);
    await expect(page.locator('.fa-iseal[data-i="verified"]')).toHaveCount(0);
    await expect(page.getByText(/integrity verified/i)).toHaveCount(0);
    await openApp(page, "#/local/history");
    await expect(page.locator('[data-integrity-notice="unverifiable"]')).toBeVisible({ timeout: 20_000 });
    await expect(rows(page)).toHaveCount(0);
    writeEvidence(`${browserName}/F13-unverifiable-archive`, { damaged: SEED["ui-unverifiable"].damage, direct: JSON.parse(d1.text) });
  } finally {
    await switchTo("ui-main", `${browserName}:unverifiable-restore`);
  }
});

test("empty archive (ui-empty): EMPTY — not Verified, not a failure, total 0", async ({ page, browserName }) => {
  await switchTo("ui-empty", `${browserName}:empty`);
  try {
    const d = JSON.parse((await direct("/api/v1/history")).text);
    expect([d.items, d.page.total, d.page.next_cursor]).toEqual([[], 0, null]);
    await openApp(page, "#/local/history");
    await expect(page.getByText("The local archive holds no evaluations")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-access="EMPTY"]')).toBeVisible();
    await expect(page.locator(".fa-seal")).toHaveCount(0);
    await expect(rows(page)).toHaveCount(0);
    writeEvidence(`${browserName}/empty-archive`, { direct: d });
  } finally {
    await switchTo("ui-main", `${browserName}:empty-restore`);
  }
});

test("F24 · no external network request: the browser contacted only the app origin; the Service made no outbound connection", async ({ browserName }) => {
  expect([...allHosts].filter((h) => h !== "")).toEqual([APP_HOST]);
  await stopService(service, `${browserName}:audit`); // the socket audit is written at exit
  const audits = socketAudits(suiteStart);
  service = await startService(`${browserName}:audit-restarted`, "ui-main");
  expect(audits.length).toBeGreaterThan(0);
  for (const a of audits) {
    expect(a.unauthorized, a.file).toEqual([]);
    for (const c of a.connects as { host: string }[]) expect(["127.0.0.1", "localhost", "::1"]).toContain(c.host);
  }
  writeEvidence(`${browserName}/F24-no-external`, { browser_hosts: [...allHosts], service_socket_audits: audits });
});
