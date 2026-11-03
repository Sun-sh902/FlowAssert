/**
 * Shared steps of the CSV check browser tests: open the page and let it load everything it needs, record every
 * request, run a check from files on disk, and read the downloaded reports.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type BrowserContext, type Page } from "@playwright/test";

export const REPO = resolve(process.cwd(), "..");
export const EXAMPLES = join(REPO, "offline/examples");
export const GOLDEN = join(REPO, "offline/golden");
export const golden = (name: string, file: string) => readFileSync(join(GOLDEN, name, file), "utf-8");
/** A golden report as the page writes it: the same bytes, the premises' origin "browser form". */
export const asBrowser = (text: string) =>
  text.replaceAll('"origin": "command-line option"', '"origin": "browser form"').replaceAll("<td>command-line option</td>", "<td>browser form</td>");
/** evaluated_at differs at every run. */
export const anyTime = (text: string) => text.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{6})?Z/g, "TIME");

export type Locale = "en" | "zh-CN";

/**
 * Open the CSV check. The page starts its worker and loads every font face when it opens; this waits until all of
 * that has arrived, so that what follows can be required to make no request at all.
 */
export async function openCheck(page: Page, url = "/#/check", locale: Locale = "en") {
  await page.addInitScript((l) => {
    try {
      localStorage.setItem("flowassert.locale", l);
    } catch {
      /* storage unavailable */
    }
  }, locale);
  await page.goto("about:blank");
  // Chrome fetches the tab icon on its own some time after the page loads; let it, before anything is recorded.
  const icon = page.waitForResponse((r) => r.url().endsWith("/favicon.svg"), { timeout: 5000 }).catch(() => null);
  await page.goto(url);
  await page.getByTestId("run-check").waitFor();
  await page.waitForFunction(() => [...document.fonts].every((f) => f.status === "loaded" || f.status === "error"));
  // The Pages build writes its icon into the page, so nothing is fetched for it.
  if (!(await page.locator('link[rel="icon"]').getAttribute("href"))?.startsWith("data:")) await icon;
  await page.waitForLoadState("networkidle");
}

/**
 * Every request the page, its frames and its workers make from now on. `urls` are network requests; `local` are
 * blob: and data: reads, which never leave the browser (WebKit reports reading a chosen file, or saving a report, as
 * a blob: request; Chrome does not).
 */
export function recordRequests(context: BrowserContext) {
  const urls: string[] = [];
  const local: string[] = [];
  const onRequest = (request: { url(): string }) => (/^(blob|data):/.test(request.url()) ? local : urls).push(request.url());
  context.on("request", onRequest);
  return { urls, local, stop: () => context.off("request", onRequest) };
}

/** No network request, and nothing local but blob: URLs of the page's own origin. */
export function expectNoNetwork(page: Page, requests: { urls: string[]; local: string[] }) {
  expect(requests.urls).toEqual([]);
  const origin = new URL(page.url()).origin;
  expect(requests.local.filter((u) => !u.startsWith(`blob:${origin}/`))).toEqual([]);
}

export interface Choices {
  source: string;
  destination: string;
  key?: [string, string];
  fields?: [string, string, string?][];
  config?: string;
  encodings?: [string, string];
  sourceComplete?: boolean;
  destinationComplete?: boolean;
}

/** Choose the files and columns, state the premises, and start the check. */
export async function check(page: Page, c: Choices) {
  if (c.encodings) {
    await page.getByTestId("source-encoding").selectOption(c.encodings[0]);
    await page.getByTestId("destination-encoding").selectOption(c.encodings[1]);
  }
  await page.getByTestId("source-file").setInputFiles(c.source);
  await page.getByTestId("destination-file").setInputFiles(c.destination);
  if (c.config) {
    await page.getByTestId("config-file").setInputFiles(c.config);
    await expect(page.getByTestId("download-config")).toBeEnabled();
  } else {
    await expect(page.getByTestId("key-source").locator("option").nth(1)).toBeAttached();
    await expect(page.getByTestId("key-destination").locator("option").nth(1)).toBeAttached();
    await page.getByTestId("key-source").selectOption(c.key![0]);
    await page.getByTestId("key-destination").selectOption(c.key![1]);
    for (const [i, [s, d, rule]] of c.fields!.entries()) {
      if (i > 0) await page.getByRole("button", { name: /^(Add a field|添加字段)$/ }).click();
      await page.getByTestId(`field-${i}-source`).selectOption(s);
      await page.getByTestId(`field-${i}-destination`).selectOption(d);
      if (rule) await page.getByTestId(`field-${i}-rule`).selectOption(rule);
    }
  }
  if (c.sourceComplete) await page.getByTestId("source-complete").check();
  if (c.destinationComplete) await page.getByTestId("destination-complete").check();
  await expect(page.getByTestId("run-check")).toBeEnabled();
  await page.getByTestId("run-check").click();
}

export const EXAMPLE: Choices = {
  source: join(EXAMPLES, "source.csv"),
  destination: join(EXAMPLES, "destination.csv"),
  key: ["external_id", "external_id"],
  fields: [
    ["phone", "phone"],
    ["email", "hs_email"],
  ],
  sourceComplete: true,
  destinationComplete: true,
};

/** Click a download button and return the saved file's text. */
export async function download(page: Page, testId: string): Promise<{ name: string; text: string }> {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testId).click()]);
  const path = await file.path();
  return { name: file.suggestedFilename(), text: readFileSync(path, "utf-8") };
}

/** Everything this origin keeps in the browser, and the address. */
export function storedState(page: Page) {
  return page.evaluate(async () => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    cookie: document.cookie,
    url: location.href,
    indexedDB: (await indexedDB.databases()).map((d) => d.name ?? ""),
  }));
}
