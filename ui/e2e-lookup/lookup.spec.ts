/**
 * ID-addressability remediation-03 — real browsers, real HTTP, the isolated Service at the handoff identity.
 *
 * Every identifier below is a TEST-ONLY identity alias registered by the backend's own launcher (17) or the two the
 * frontend suite adds by the same mechanism (labelled fe-*). An alias changes only run.identity.id of one of the five
 * evaluator-backed synthetic cases; it is not an external business record and observes no external source.
 *
 * For each ID, in each browser: direct entry at #/local/verification-lookup?verification_id=…, the exact ID shown,
 * the real Detail request, the exact ID the Service's Catalog received (Python-decoded UTF-8 bytes), the evaluator's
 * result for the basis case, every evidence page to next_cursor = null with one snapshot, the cursor chain verbatim,
 * the exact ordered reference inventory, integrity messaging, and no other ID on the wire.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  aliasManifest,
  captureNetwork,
  catalogReceipts,
  codePoints,
  EVIDENCE_DIR,
  EXPECTED,
  indexCells,
  integrity,
  openApp,
  retrieval,
  seal,
  startService,
  stopService,
  utf8Hex,
  wireReceipts,
  writeEvidence,
  type ServiceProcess,
} from "./support.ts";

const LAB = "\u{1F9EA}";
/** label → exact ID. The backend corpus (corpus.ALIASES) plus the two frontend-added aliases. */
const IDS: [string, string][] = [
  ["dot", "."],
  ["dotdot", ".."],
  ["evidence-suffix", "x/evidence"],
  ["slash", "customer/001"],
  ["colon", "SPEC:006"],
  ["chinese", "中文"],
  ["emoji128", LAB.repeat(128)],
  ["punctuation", "a?b#c"],
  ["plus", "a+b"],
  ["percent-literal", "a%2Fb"],
  ["suffix-trap-control", "x"],
  ["decoded-slash-control", "a/b"],
  ["space-control", "a b"],
  ["nfc", "é"],
  ["nfd", "é"],
  ["whitespace", " leading and trailing "],
  ["controls", "\x00\t\n\x1f\x7f"],
  ["fe-emoji-single", LAB],
  ["fe-bmp128", "中文".repeat(64)],
];

/** The address the app itself builds (router.ts lookupHref): one URLSearchParams value. */
const lookupHash = (id: string) => `#/local/verification-lookup?${new URLSearchParams({ verification_id: id })}`;

let svc: ServiceProcess;
const results: Record<string, unknown>[] = [];

test.beforeAll(async ({ browserName }, info) => {
  svc = await startService(`lookup-${info.project.name}-${browserName}`);
});
test.afterAll(async ({ browserName }, info) => {
  const audit = await stopService(svc);
  writeEvidence(`browser/${info.project.name}/summary`, { project: info.project.name, browserName, results, networkAudit: audit });
  expect(audit?.connects.every((c) => c.host === "127.0.0.1" || c.host === "::1" || c.host === "localhost") ?? true).toBe(true);
});

/** Read all evidence (user-controlled buttons) and return when retrieval reports completion. */
async function readAllEvidence(page: Page) {
  // Wait for a settled first read: either more pages remain (then ask for all of them) or it is already complete.
  await expect(retrieval(page)).toContainText(/more pages remain|All evidence pages retrieved/, { timeout: 20_000 });
  if (/more pages remain/.test((await retrieval(page).textContent()) ?? "")) await page.getByRole("button", { name: "Read all remaining" }).click();
  await expect(retrieval(page)).toContainText("All evidence pages retrieved", { timeout: 20_000 });
}

for (const [label, id] of IDS) {
  test(`${label}: direct entry, exact Detail, full evidence chain, exact receipts`, async ({ page }, info) => {
    const manifest = aliasManifest(svc);
    const alias = manifest.find((a) => a.identity === id);
    expect(alias, "the backend registered this test alias").toBeTruthy();
    const want = EXPECTED[alias!.basis];
    const receiptsBefore = catalogReceipts(svc).length;
    const wireBefore = wireReceipts(svc).length;
    const net = captureNetwork(page);

    const hash = lookupHash(id);
    await openApp(page, hash);
    await expect(seal(page)).toHaveAttribute("data-s", want.cohort);
    // The address the browser kept is exactly the one requested (no dot-segment removal, no fragment split).
    expect(page.url()).toBe(`http://127.0.0.1:5183/${hash}`);
    // Exact ID displayed (breadcrumb text node), and every record identity is ID:row.
    const crumbs = await page.locator("b.mono-id").allTextContents();
    expect(crumbs).toContain(id);
    const rowIds = await page.locator("ul [data-row-id]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rowId!));
    expect(rowIds).toHaveLength(want.records.length);
    for (const r of rowIds) expect(r.startsWith(`${id}:`), r).toBe(true);
    expect(await indexCells(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.s))).toEqual([...want.records]);
    if (!want.populationKnown) {
      // SPEC-005 invariant: 12 record-level Verified, cohort Unverified, population Unknown (never 12 expected).
      const facts = page.locator('dl[aria-label="Case facts"]');
      await expect(facts.getByText("Expected total").locator("xpath=following-sibling::*[1]")).toHaveText("unknown");
    }

    await readAllEvidence(page);
    await expect(integrity(page)).toHaveAttribute("data-integrity", "verified");
    await expect(integrity(page)).toContainText("internal consistency only");
    await net.settle();

    const api = net.all.filter((x) => x.path.startsWith("/api/"));
    const detail = api.filter((x) => x.path === "/api/v1/verification-lookup");
    const evidence = api.filter((x) => x.path === "/api/v1/verification-evidence");
    expect(api.filter((x) => !["/api/v1/verification-lookup", "/api/v1/verification-evidence"].includes(x.path)), "no path-addressed request").toEqual([]);
    expect(detail).toHaveLength(1);
    expect(detail[0]!.status).toBe(200);
    expect(detail[0]!.gate).toBeNull();
    const run = JSON.parse(detail[0]!.body!);
    expect(run.identity.id).toBe(id);
    const snapshot: string = run.snapshot_id;
    const refs: string[] = run.evidence_references.map((r: { id: string }) => r.id);

    // Every request names exactly this ID, the Detail's snapshot, a constant limit and payload flag.
    let expectedCursor: string | null = null;
    const got: string[] = [];
    for (const [i, ex] of evidence.entries()) {
      expect(ex.status, `evidence page ${i + 1}`).toBe(200);
      const q = new URLSearchParams(ex.query);
      expect([...q.keys()]).toEqual(i === 0 ? ["verification_id", "snapshot_id", "limit", "include_payload"] : ["verification_id", "snapshot_id", "limit", "include_payload", "cursor"]);
      expect(q.get("verification_id")).toBe(id);
      expect(q.get("snapshot_id")).toBe(snapshot);
      expect(q.get("limit")).toBe("2");
      expect(q.get("include_payload")).toBe("true");
      expect(q.get("cursor")).toBe(expectedCursor);
      const page_ = JSON.parse(ex.body!);
      expect(page_.run_id).toBe(id);
      expect(page_.page.snapshot_id).toBe(snapshot);
      got.push(...page_.items.map((it: { reference: { id: string } }) => it.reference.id));
      expectedCursor = page_.page.next_cursor;
    }
    expect(expectedCursor, "the chain ended at next_cursor = null").toBeNull();
    expect(got, "ordered references: none missing, duplicated or foreign").toEqual(refs);
    for (const ex of [...detail, ...evidence]) expect(ex.url.length).toBeLessThanOrEqual(4096 + "http://127.0.0.1:5183".length);

    // What the Service received: Catalog.read got exactly these UTF-8 bytes; every query that reached the
    // ASGI app (Python side) names only this ID.
    const receipts = catalogReceipts(svc).slice(receiptsBefore);
    expect(receipts.length).toBeGreaterThan(0);
    for (const r of receipts) expect(r.run_id_utf8_hex).toBe(utf8Hex(id));
    const wire = wireReceipts(svc).slice(wireBefore);
    expect(wire.length).toBe(detail.length + evidence.length);
    for (const w of wire) {
      expect(["/api/v1/verification-lookup", "/api/v1/verification-evidence"]).toContain(w.raw_path);
      expect(new URLSearchParams(w.query_string).get("verification_id")).toBe(id);
      expect(w.status).toBe(200);
    }
    expect(onlyLoopback(net.hosts)).toEqual(["127.0.0.1:5183"]);

    const record = {
      project: info.project.name,
      label,
      id_json: JSON.stringify(id),
      id_utf8_hex: utf8Hex(id),
      code_points: codePoints(id),
      utf16_units: id.length,
      basis_case_test_alias: alias!.basis,
      cohort: want.cohort,
      app_address: hash,
      detail_request: detail[0]!.url,
      detail_request_length: detail[0]!.url.length,
      evidence_requests: evidence.map((e) => ({ url: e.url, length: e.url.length, status: e.status })),
      max_request_url_length: Math.max(...[...detail, ...evidence].map((e) => e.url.length)),
      snapshot_id: snapshot,
      references: refs,
      pages: evidence.length,
      catalog_receipts_utf8_hex: receipts.map((r) => r.run_id_utf8_hex),
      server_wire: wire,
    };
    results.push(record);
    writeEvidence(`browser/${info.project.name}/${label}`, record);
  });
}

const onlyLoopback = (hosts: Set<string>) => [...hosts].filter((h) => h !== "").sort();

test("in-app navigation: legacy x/evidence refusal → lookup link → Back → Forward → Reload", async ({ page }, info) => {
  const net = captureNetwork(page);
  await openApp(page, "#/local/verifications/x%2Fevidence");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This verification ID cannot be requested over the local API");
  const link = page.getByRole("link", { name: "Open with exact-ID lookup" });
  await expect(link).toHaveAttribute("href", "#/local/verification-lookup?verification_id=x%2Fevidence");
  await net.settle();
  expect(net.all, "the refusal page sends nothing").toEqual([]);

  await link.click();
  await expect(seal(page)).toHaveAttribute("data-s", "Unverified"); // SPEC-005 basis, not the evidence of "x"
  expect(page.url()).toBe("http://127.0.0.1:5183/#/local/verification-lookup?verification_id=x%2Fevidence");
  await expect(indexCells(page)).toHaveCount(12);

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This verification ID cannot be requested over the local API");
  expect(page.url()).toBe("http://127.0.0.1:5183/#/local/verifications/x%2Fevidence");

  await page.goForward();
  await expect(seal(page)).toHaveAttribute("data-s", "Unverified");
  expect(page.url()).toBe("http://127.0.0.1:5183/#/local/verification-lookup?verification_id=x%2Fevidence");

  // Record selection replaces the address (no history entry) and keeps the ID first.
  await indexCells(page).nth(4).click();
  await expect.poll(() => page.url()).toContain("&record=");
  const selected = page.url();
  expect(selected.startsWith("http://127.0.0.1:5183/#/local/verification-lookup?verification_id=x%2Fevidence&")).toBe(true);

  const before = net.all.length;
  await page.reload();
  await page.locator("#main").waitFor();
  await expect(seal(page)).toHaveAttribute("data-s", "Unverified");
  expect(page.url()).toBe(selected);
  await net.settle();
  const after = net.all.slice(before);
  expect(after[0]!.url).toBe("http://127.0.0.1:5183/api/v1/verification-lookup?verification_id=x%2Fevidence");
  for (const ex of after) expect(new URLSearchParams(ex.query).get("verification_id")).toBe("x/evidence");
  writeEvidence(`browser/${info.project.name}/navigation`, { urls: net.all.map((x) => ({ url: x.url, status: x.status })), selected });
});

test("no cross-ID contamination: x/evidence → x → a%2Fb → a/b → Back, each read by its own exact ID", async ({ page }, info) => {
  const net = captureNetwork(page);
  const steps: [string, string][] = [
    ["x/evidence", "Unverified"],
    ["x", "Mismatch"],
    ["a%2Fb", "Unverified"],
    ["a/b", "Verified"],
  ];
  await openApp(page, lookupHash(steps[0]![0]));
  for (const [i, [id, cohort]] of steps.entries()) {
    if (i > 0) await page.evaluate((h) => (window.location.hash = h), lookupHash(id)); // in-app: same document
    await expect(seal(page)).toHaveAttribute("data-s", cohort);
    await expect(page.locator("b.mono-id").first()).toHaveText(id);
    await expect(retrieval(page)).toContainText(/references/);
  }
  await page.goBack();
  await expect(seal(page)).toHaveAttribute("data-s", "Unverified");
  await expect(page.locator("b.mono-id").first()).toHaveText("a%2Fb");
  await net.settle();
  // Each request's ID equals the ID of the page that was showing when it was sent: requests are grouped in order.
  const seq = net.all.map((x) => new URLSearchParams(x.query).get("verification_id"));
  const order = [...steps.map((s) => s[0]), "a%2Fb"];
  const runs: string[] = [];
  for (const v of seq) if (runs[runs.length - 1] !== v) runs.push(v!);
  expect(runs).toEqual(order);
  for (const ex of net.all.filter((x) => x.path === "/api/v1/verification-lookup")) expect(JSON.parse(ex.body!).identity.id).toBe(new URLSearchParams(ex.query).get("verification_id"));
  writeEvidence(`browser/${info.project.name}/cross-id`, { sequence: net.all.map((x) => ({ url: x.url, status: x.status })) });
});

test("tampered continuation cursor: the Service's 400 invalid_cursor is shown as a retrieval error, never a verdict", async ({ page }, info) => {
  let tampered: string | null = null;
  await page.route(/\/api\/v1\/verification-evidence\?.*cursor=/, async (route) => {
    const u = route.request().url();
    const q = new URLSearchParams(u.slice(u.indexOf("?") + 1));
    const c = q.get("cursor")!;
    q.set("cursor", c.slice(0, -2) + (c.endsWith("AA") ? "BB" : "AA"));
    tampered = `${u.slice(0, u.indexOf("?"))}?${q}`;
    await route.continue({ url: tampered });
  });
  const net = captureNetwork(page);
  await openApp(page, lookupHash("x/evidence"));
  await expect(seal(page)).toHaveAttribute("data-s", "Unverified");
  await page.getByRole("button", { name: "Read next page" }).click();
  await expect(page.getByText("The service rejected the continuation cursor.", { exact: false })).toBeVisible();
  await expect(page.getByText("invalid_cursor", { exact: true })).toBeVisible();
  await expect(seal(page)).toHaveAttribute("data-s", "Unverified"); // stored verdict unchanged
  await net.settle();
  const last = net.all[net.all.length - 1]!;
  expect(last.status).toBe(400);
  expect(JSON.parse(last.body!).error.code).toBe("invalid_cursor");
  expect(last.gate).toBeNull(); // the Service's own envelope, through the gate
  writeEvidence(`browser/${info.project.name}/tampered-cursor`, { tampered, status: last.status, body: JSON.parse(last.body!) });
});

test("Service restart: an old cursor is 409 snapshot_unavailable — shown, nothing merged; Re-read starts a new snapshot", async ({ page }, info) => {
  const net = captureNetwork(page);
  await openApp(page, lookupHash("中文"));
  await expect(seal(page)).toHaveAttribute("data-s", "Unverified");
  await expect(retrieval(page)).toContainText("more pages remain");
  const firstSnapshot = JSON.parse(net.all.find((x) => x.path === "/api/v1/verification-lookup")!.body!).snapshot_id;

  await stopService(svc);
  svc = await startService(`lookup-${info.project.name}-restarted`);

  await page.getByRole("button", { name: "Read next page" }).click();
  await expect(page.getByText("A cursor issued before a service restart is no longer valid.", { exact: false })).toBeVisible();
  await expect(seal(page)).toHaveAttribute("data-s", "Unverified");
  await net.settle();
  const stale = net.all[net.all.length - 1]!;
  expect(stale.status).toBe(409);
  expect(JSON.parse(stale.body!).error.code).toBe("snapshot_unavailable");

  // The provenance band and the stale-snapshot notice both offer it; use the notice's.
  await page.getByRole("button", { name: "Re-read the whole case" }).last().click();
  await readAllEvidence(page);
  await net.settle();
  const reread = net.all.filter((x) => x.path === "/api/v1/verification-lookup").pop()!;
  const secondSnapshot = JSON.parse(reread.body!).snapshot_id;
  expect(secondSnapshot).not.toBe(firstSnapshot);
  const after = net.all.slice(net.all.indexOf(reread) + 1);
  for (const ex of after) {
    expect(new URLSearchParams(ex.query).get("snapshot_id")).toBe(secondSnapshot);
    expect(new URLSearchParams(ex.query).get("verification_id")).toBe("中文");
  }
  writeEvidence(`browser/${info.project.name}/restart-409`, { firstSnapshot, secondSnapshot, stale: { url: stale.url, status: stale.status, body: JSON.parse(stale.body!) }, sequence: net.all.map((x) => ({ url: x.url, status: x.status })) });
});

test("an invalid 129-code-point ID and malformed lookup addresses are refused; nothing is requested", async ({ page }) => {
  const net = captureNetwork(page);
  for (const hash of [lookupHash(LAB.repeat(129)), "#/local/verification-lookup?verification_id=%FF", "#/local/verification-lookup?verification_id=a&verification_id=b", "#/local/verification-lookup"]) {
    await openApp(page, hash);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This address does not name a valid verification ID");
  }
  await page.waitForTimeout(300);
  await net.settle();
  expect(net.all).toEqual([]);
});

test("visual record: lookup Detail and the legacy refusal's lookup link (light, dark, 390 px)", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "one visual record is enough; layout is shared with the accepted Detail");
  const shots: string[] = [];
  for (const theme of ["light", "dark"] as const)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("flowassert.theme", t);
        } catch {
          /* storage unavailable */
        }
      }, theme);
      await openApp(page, lookupHash("x/evidence"));
      await expect(seal(page)).toHaveAttribute("data-s", "Unverified");
      await expect(retrieval(page)).toContainText(/more pages remain|All evidence pages retrieved/);
      const a = `screens/lookup-x-evidence-${theme}-${width}.png`;
      await page.screenshot({ path: `${EVIDENCE_DIR}/${a}`, fullPage: false, animations: "disabled" });
      await openApp(page, "#/local/verifications/x%2Fevidence");
      await expect(page.getByRole("link", { name: "Open with exact-ID lookup" })).toBeVisible();
      const b = `screens/legacy-refusal-lookup-link-${theme}-${width}.png`;
      await page.screenshot({ path: `${EVIDENCE_DIR}/${b}`, fullPage: false, animations: "disabled" });
      shots.push(a, b);
    }
  writeEvidence(`browser/${info.project.name}/screens`, shots);
});
