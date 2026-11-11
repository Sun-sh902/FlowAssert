/**
 * A first check that a newcomer can finish and understand (v0.6.0), in Chrome on the production build: "What this
 * result means" for a Verified, a Mismatch and an Unverified result and for an opened saved report; the hint under
 * each refusal it is written for, and none where it is not; the Chinese explanations of the English texts; every
 * scenario with the result it names for each set of premises; and the feedback link's address. None of it makes a
 * request or stores anything, and the axe audit of the changed pages passes in both themes at desktop and phone width.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { EXAMPLE, GOLDEN, REPO, audit, check, expectNoNetwork, golden, openCheck, recordRequests, storedState, type Locale } from "./check-helpers.ts";
import { writeReport } from "./helpers.ts";

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 375, height: 812 } } as const;
const SCENARIOS = (JSON.parse(readFileSync(join(REPO, "offline/examples/scenarios/scenarios.json"), "utf-8")) as {
  scenarios: { id: string; expect: { premises: { source_complete: boolean; destination_complete: boolean }; result: string }[] }[];
}).scenarios;
const SUFFIX = (p: { source_complete: boolean; destination_complete: boolean }) =>
  p.source_complete ? (p.destination_complete ? "both-statements" : "source-statement") : p.destination_complete ? "destination-statement" : "no-statements";
const csv = (name: string, text: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text) });

/** Open the saved reports page and wait for what it loads, as openCheck does for the CSV check. */
async function openSaved(page: Page) {
  await page.goto("about:blank");
  await page.goto("/#/check/reports");
  await page.getByTestId("import-report").waitFor();
  await page.waitForFunction(() => [...document.fonts].every((f) => f.status === "loaded" || f.status === "error"));
  await page.waitForLoadState("networkidle");
}

/** No request apart from the tab icon, which Chrome fetches again on its own after a navigation (saved-reports.spec.ts). */
const expectNoRequest = (page: Page, requests: { urls: string[]; local: string[] }) =>
  expectNoNetwork(page, { urls: requests.urls.filter((u) => new URL(u).pathname !== "/favicon.svg"), local: requests.local });

async function result(page: Page) {
  const region = page.locator("[data-result]");
  await region.waitFor({ timeout: 30_000 });
  return region;
}

/** Nothing of the check is kept: no session storage, cookie or database, the address unchanged, only preferences. */
async function expectNothingStored(page: Page, before: string) {
  const stored = await storedState(page);
  expect(stored.session).toEqual([]);
  expect(stored.cookie).toBe("");
  expect(stored.indexedDB).toEqual([]);
  expect(stored.url).toBe(before);
  expect(stored.local.map(([k]) => k).every((k) => k.startsWith("flowassert."))).toBe(true);
}

const pointsOf = (page: Page) => page.locator("[data-testid=explanation] [data-point]").evaluateAll((els) => els.map((e) => e.getAttribute("data-point")));

async function useScenario(page: Page, id: string, premises: { source_complete: boolean; destination_complete: boolean }) {
  await page.getByTestId(`scenario-${id}`).click();
  await expect(page.getByTestId("scenario-status")).not.toBeEmpty();
  await expect(page.getByTestId("run-check")).toBeEnabled();
  // Nothing is stated by the scenario.
  await expect(page.getByTestId("source-complete")).not.toBeChecked();
  await expect(page.getByTestId("destination-complete")).not.toBeChecked();
  if (premises.source_complete) await page.getByTestId("source-complete").check();
  if (premises.destination_complete) await page.getByTestId("destination-complete").check();
  await page.getByTestId("run-check").click();
}

test.describe("what the result means", () => {
  test("Verified, Mismatch and Unverified each explained from the report, with no request and nothing stored", async ({ page, context }) => {
    await openCheck(page);
    const before = page.url();
    const requests = recordRequests(context);

    await check(page, EXAMPLE);
    await expect(await result(page)).toHaveAttribute("data-result", "Mismatch");
    expect(await pointsOf(page)).toEqual(["mismatch-records", "fail:phone", "fail-missing", "fail-duplicate", "see-records"]);
    // The summary beside it is still the command line's.
    expect(await page.getByTestId("summary").textContent()).toBe(golden("example-page", "stdout.txt"));

    // A scenario replaces the files and the configuration, and states nothing.
    await useScenario(page, "orders-rules", { source_complete: true, destination_complete: true });
    await expect(await result(page)).toHaveAttribute("data-result", "Verified");
    await expect(page.getByTestId("explanation")).toHaveAttribute("data-explains", "Verified");
    expect(await pointsOf(page)).toEqual(["verified-records", "verified-premises", "verified-rules", "scope-source", "not-shown"]);
    await expect(page.locator('[data-point="verified-premises"]')).toContainText("If either is wrong, this result is wrong.");

    await page.getByTestId("source-complete").uncheck();
    await page.getByTestId("destination-complete").uncheck();
    await page.getByTestId("run-check").click();
    await expect(await result(page)).toHaveAttribute("data-result", "Unverified");
    expect(await pointsOf(page)).toEqual(["population-unknown", "source-not-stated", "coverage-not-established", "destination-not-stated", "found-once", "see-records"]);
    await expect(page.locator('[data-point="source-not-stated"]')).toContainText("FlowAssert cannot check the statement");

    requests.stop();
    expectNoNetwork(page, requests);
    await expectNothingStored(page, before);
  });

  test("an opened saved report is explained too", async ({ page, context }) => {
    await openSaved(page);
    const requests = recordRequests(context);
    await page.getByTestId("import-file").setInputFiles(join(GOLDEN, "rules-pass", "report.json"));
    await page.getByTestId("open-entry").click();
    await expect(page.getByTestId("explanation")).toHaveAttribute("data-explains", "Verified");
    expect(await pointsOf(page)).toEqual(["verified-records", "verified-premises", "verified-rules", "scope-source", "not-shown"]);
    requests.stop();
    expectNoRequest(page, requests);
  });
});

test.describe("help after a refusal", () => {
  /**
   * The hint shown, or null once the page has had time to show one: under a file, or, with `afterCheck`, under the
   * check's refusal (a file the check refuses has the same hint in its profile too, before any check).
   */
  async function hint(page: Page, afterCheck = false) {
    const box = (afterCheck ? page.locator('section[aria-labelledby="run-h"]') : page).getByTestId("refusal-hint");
    await box.waitFor({ timeout: 5000 }).catch(() => null);
    return (await box.count()) ? { kinds: await box.getAttribute("data-hint"), text: (await box.textContent()) ?? "" } : null;
  }

  test("an encoding hint under a refused header, which changes nothing itself", async ({ page, context }) => {
    await openCheck(page);
    const before = page.url();
    const requests = recordRequests(context);
    await page.getByTestId("source-file").setInputFiles(join(GOLDEN, "decode-wrong-encoding", "source.csv"));
    expect((await hint(page))?.kinds).toBe("gb18030");
    await expect(page.getByTestId("source-encoding")).toHaveValue("utf-8");
    await page.getByTestId("source-file").setInputFiles(join(GOLDEN, "encoding-utf16-le", "source.csv"));
    expect((await hint(page))?.kinds).toBe("utf-16");
    await page.getByTestId("source-encoding").selectOption("utf-16");
    await page.getByTestId("source-file").setInputFiles(join(GOLDEN, "decode-utf16-no-bom", "source.csv"));
    expect((await hint(page))?.kinds).toBe("utf-16-no-bom");
    await page.getByTestId("source-encoding").selectOption("utf-8");
    await page.getByTestId("source-file").setInputFiles(csv("r.csv", "k,p,p\n1,2,3\n"));
    const repeated = await hint(page);
    expect(repeated?.kinds).toBe("repeated-column");
    expect(repeated?.text).toContain("Give each column a name of its own");
    requests.stop();
    expectNoNetwork(page, requests);
    await expectNothingStored(page, before);
  });

  test("a refused check: missing columns of a file separated by semicolons, the fields of a line, identical content, the same file, the row limit", async ({ page, context }) => {
    test.setTimeout(120_000);
    await openCheck(page);
    const requests = recordRequests(context);
    // A configuration names columns the semicolon file does not have, so the check refuses it.
    await page.getByTestId("source-file").setInputFiles(csv("semi.csv", "k;p\n1;2\n3;4\n"));
    await page.getByTestId("destination-file").setInputFiles(csv("d.csv", "k,p\n1,2\n"));
    await page.getByTestId("config-file").setInputFiles(join(GOLDEN, "empty-values", "config.json"));
    await page.getByTestId("run-check").click();
    await expect(page.getByTestId("refusal")).toContainText("semi.csv: missing column k, p");
    let h = await hint(page, true);
    expect(h?.kinds).toBe("missing-column separator");
    expect(h?.text).toContain("FlowAssert reads only commas.");

    await check(page, { source: csv("s.csv", "k,p\n1,2\n3,4,5\n"), destination: csv("d.csv", "k,p\n1,2\n"), key: ["k", "k"], fields: [["p", "p"]] });
    await expect(page.getByTestId("refusal")).toContainText("s.csv: line 3 does not match the header");
    // The profile said so before the check, with the same hint.
    await expect(page.getByTestId("source-profile-refused")).toContainText("s.csv: line 3 does not match the header");
    await expect(page.getByTestId("source-profile-part").getByTestId("refusal-hint")).toContainText("Line 3 has 3 fields; the header has 2.");
    expect((await hint(page, true))?.text).toContain("Line 3 has 3 fields; the header has 2.");

    await page.getByTestId("source-file").setInputFiles(csv("a.csv", "k,p\n1,2\n"));
    await page.getByTestId("destination-file").setInputFiles(csv("b.csv", "k,p\n1,2\n"));
    await page.getByTestId("run-check").click();
    await expect(page.getByTestId("refusal")).toContainText("identical content");
    expect((await hint(page, true))?.kinds).toBe("identical-content");

    await page.getByTestId("destination-file").setInputFiles(join(REPO, "offline/examples/source.csv"));
    await page.getByTestId("source-file").setInputFiles(join(REPO, "offline/examples/source.csv"));
    await page.getByTestId("key-source").selectOption("external_id");
    await page.getByTestId("key-destination").selectOption("external_id");
    await page.getByTestId("field-0-source").selectOption("phone");
    await page.getByTestId("field-0-destination").selectOption("phone");
    await page.getByTestId("run-check").click();
    await expect(page.getByTestId("refusal")).toContainText("the same file");
    expect((await hint(page, true))?.kinds).toBe("same-file");

    const rows = "k,p\n" + "K,1\n".repeat(1_000_001);
    await page.getByTestId("source-file").setInputFiles(csv("many.csv", rows));
    await page.getByTestId("destination-file").setInputFiles(csv("d.csv", "k,p\nK,1\n"));
    await page.getByTestId("key-source").selectOption("k");
    await page.getByTestId("key-destination").selectOption("k");
    await page.getByTestId("field-0-source").selectOption("p");
    await page.getByTestId("field-0-destination").selectOption("p");
    await page.getByTestId("run-check").click();
    await expect(page.getByTestId("refusal")).toContainText("many.csv: exceeds --max-rows limit of 1000000", { timeout: 60_000 });
    expect((await hint(page, true))?.kinds).toBe("max-rows");
    requests.stop();
    expectNoNetwork(page, requests);
  });

  test("no hint where none is written: a quoted field left open", async ({ page }) => {
    await openCheck(page);
    await check(page, { source: join(GOLDEN, "refused-unexpected-end", "source.csv"), destination: join(GOLDEN, "refused-unexpected-end", "destination.csv"), key: ["k", "k"], fields: [["p", "p"]] });
    await expect(page.getByTestId("refusal")).toContainText("unexpected end of data");
    expect(await hint(page, true)).toBeNull();
    expect(await hint(page)).toBeNull();
  });
});

test("in Chinese, each English text stays as written, with its explanation next to it", async ({ page, context }) => {
  await page.setViewportSize(VIEWPORTS.phone);
  await openCheck(page, "/#/check", "zh-CN");
  const requests = recordRequests(context);
  await check(page, EXAMPLE);
  const region = await result(page);
  await expect(page.getByTestId("explanation").getByRole("heading")).toHaveText("这个结果是什么意思");
  // A reason: the evaluator's English, then the Chinese explanation, in the panel of the record chosen.
  await region.locator('[data-record="2"]').click();
  const record = region.getByTestId("record-panel");
  await expect(record.getByText("exact string comparison").first()).toBeVisible();
  await expect(record.locator('[data-gloss="reason-exact"]').first()).toHaveText("按原样比较字符串。");
  await expect(region.locator('[data-gloss="limitations"]')).toBeVisible();
  // The summary is the command line's, character for character; its lines are explained beside it.
  expect(await page.getByTestId("summary").textContent()).toBe(golden("example-page", "stdout.txt"));
  await expect(page.getByTestId("summary-glosses")).toContainText("批次结果：不一致。");
  // A refusal, in English, with its explanation.
  await page.getByTestId("source-file").setInputFiles(csv("r.csv", "k,p,p\n1,2,3\n"));
  await expect(page.getByText("r.csv: repeated column name")).toBeVisible();
  await expect(page.locator('[data-gloss="repeated-column"]')).toHaveText("r.csv：表头中有列名重复出现。");
  await expect(page.getByTestId("refusal-hint")).toContainText("可能有帮助的做法");
  requests.stop();
  expectNoNetwork(page, requests);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const s of SCENARIOS) {
  test(`scenario ${s.id}: the result it names for each set of premises, as its golden case`, async ({ page, context }) => {
    await openCheck(page);
    const before = page.url();
    const requests = recordRequests(context);
    for (const e of s.expect) {
      await useScenario(page, s.id, e.premises);
      await expect(await result(page)).toHaveAttribute("data-result", e.result);
      expect(await page.getByTestId("summary").textContent()).toBe(golden(`scenario-${s.id}-${SUFFIX(e.premises)}`, "stdout.txt"));
    }
    requests.stop();
    expectNoNetwork(page, requests);
    await expectNothingStored(page, before);
  });
}

test("the feedback link opens the trial form on GitHub in a new tab, with only the template in its address", async ({ page, context }) => {
  for (const open of [() => openCheck(page), () => openSaved(page)]) {
    await open();
    const requests = recordRequests(context);
    const link = page.getByTestId("give-feedback");
    await expect(link).toHaveAttribute("href", "https://github.com/Sun-sh902/FlowAssert/issues/new?template=trial_feedback.yml");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    requests.stop();
    // Showing the link requests nothing; only pressing it would open GitHub.
    expectNoRequest(page, requests);
  }
});

for (const theme of ["light", "dark"] as const) {
  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    for (const locale of ["en", "zh-CN"] as Locale[]) {
      test(`axe · ${theme} · ${width} · ${locale} · scenarios, an explained result, a hint and a saved report`, async ({ page, browserName }) => {
        await page.addInitScript((t) => localStorage.setItem("flowassert.theme", t), theme);
        await page.setViewportSize(viewport);
        await openCheck(page, "/#/check", locale);
        const violations: string[] = [];
        await useScenario(page, "extra-in-destination", { source_complete: false, destination_complete: false });
        await result(page);
        await page.waitForTimeout(400); // let fade-ins finish so contrast is measured at rest
        violations.push(...(await audit(page)));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.getByTestId("source-file").setInputFiles(join(GOLDEN, "decode-wrong-encoding", "source.csv"));
        await page.getByTestId("refusal-hint").waitFor();
        violations.push(...(await audit(page)));
        await page.goto("/#/check/reports");
        await page.getByTestId("import-file").setInputFiles(join(GOLDEN, "scope-exact-source-unknown", "report.json"));
        await page.getByTestId("open-entry").click();
        await page.getByTestId("explanation").waitFor();
        await page.waitForTimeout(400);
        violations.push(...(await audit(page)));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        writeReport(`axe-${browserName}-${theme}-${width}-${locale}-first-check`, violations);
        expect(violations).toEqual([]);
      });
    }
  }
}
