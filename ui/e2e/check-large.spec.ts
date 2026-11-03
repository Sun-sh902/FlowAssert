/**
 * Two files of 1,000,000 rows, generated as offline/bench/memory_check.py generates them, checked in the page.
 * Skipped unless FA_LARGE=1 (it writes about 90 MB and takes a while):
 *
 *   FA_LARGE=1 npx playwright test e2e/check-large.spec.ts --project chrome
 *
 * Reports the time from pressing Check to the result, and how late the page's own timers ran meanwhile (the tab is
 * responsive when they stay on time), and compares the summary with the command line's on the same files.
 */
import { execFileSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { REPO, openCheck } from "./check-helpers.ts";
import { writeReport } from "./helpers.ts";

const ROWS = 1_000_000;
const DIFFERENT = new Set([17, 500_000, 999_999]);

async function write(path: string, line: (i: number) => string) {
  const out = createWriteStream(path);
  out.write("id,phone,email\n");
  for (let i = 0; i < ROWS; i += 10_000) {
    let chunk = "";
    for (let j = i; j < i + 10_000; j++) chunk += line(j);
    if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
  }
  await new Promise<void>((r) => out.end(() => r()));
}

const id = (i: number) => String(i).padStart(7, "0");

test("two files of 1,000,000 rows are checked in the page, which stays responsive", async ({ page }, testInfo) => {
  test.skip(!process.env.FA_LARGE, "set FA_LARGE=1 to check two files of 1,000,000 rows");
  test.setTimeout(20 * 60_000);
  mkdirSync(testInfo.outputDir, { recursive: true });
  const source = join(testInfo.outputDir, "source.csv");
  const destination = join(testInfo.outputDir, "destination.csv");
  await write(source, (i) => `SYN-${id(i)},+1 555 ${id(i)},u${id(i)}@ex.test\n`);
  await write(destination, (i) => `SYN-${id(i)},${DIFFERENT.has(i) ? "+1 555 0000000x" : `+1 555 ${id(i)}`},u${id(i)}@ex.test\n`);

  await openCheck(page);
  await page.getByTestId("source-file").setInputFiles(source);
  await page.getByTestId("destination-file").setInputFiles(destination);
  await expect(page.getByTestId("key-source").locator("option").nth(1)).toBeAttached({ timeout: 60_000 });
  await expect(page.getByTestId("key-destination").locator("option").nth(1)).toBeAttached({ timeout: 60_000 });
  await page.getByTestId("key-source").selectOption("id");
  await page.getByTestId("key-destination").selectOption("id");
  await page.getByTestId("field-0-source").selectOption("phone");
  await page.getByTestId("field-0-destination").selectOption("phone");
  await page.getByRole("button", { name: "Add a field" }).click();
  await page.getByTestId("field-1-source").selectOption("email");
  await page.getByTestId("field-1-destination").selectOption("email");
  await page.getByTestId("source-complete").check();
  await page.getByTestId("destination-complete").check();

  // A timer every 100 ms on the page's own thread: how late it fires is how long the page could not respond.
  await page.evaluate(() => {
    const probe = { late: 0, ticks: 0, progress: [] as number[] };
    (window as unknown as { probe: typeof probe }).probe = probe;
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      probe.late = Math.max(probe.late, now - last - 100);
      probe.ticks++;
      last = now;
      const bar = document.querySelector('[role="progressbar"]');
      if (bar) probe.progress.push(Number(bar.getAttribute("aria-valuenow")));
    }, 100);
  });
  const started = Date.now();
  await page.getByTestId("run-check").click();
  await page.locator("[data-result]").waitFor({ timeout: 15 * 60_000 });
  const seconds = (Date.now() - started) / 1000;
  const probe = await page.evaluate(() => (window as unknown as { probe: { late: number; ticks: number; progress: number[] } }).probe);

  await expect(page.locator("[data-result]")).toHaveAttribute("data-result", "Mismatch");
  await expect(page.locator('[data-count="Mismatch"]')).toHaveText("3");
  await expect(page.locator('[data-count="Verified"]')).toHaveText(String(ROWS - 3));
  const summary = await page.getByTestId("summary").textContent();
  let cli = "";
  try {
    execFileSync(process.env.FA_PYTHON ?? "python3", [join(REPO, "offline/verify.py"), "--source", source, "--destination", destination,
      "--key", "id", "--field", "phone", "--field", "email", "--source-complete", "--destination-complete"], { encoding: "utf-8", maxBuffer: 1 << 26 });
  } catch (e) {
    cli = (e as { stdout: string; status: number }).stdout; // exit status 1: Mismatch
  }
  const report = { rows: ROWS, seconds, longestTimerDelayMs: Math.round(probe.late), timerTicks: probe.ticks, progressSeen: [...new Set(probe.progress)].length };
  writeReport("check-large", report);
  testInfo.annotations.push({ type: "large-file", description: JSON.stringify(report) });
  console.info(`large-file check: ${JSON.stringify(report)}`);
  expect(summary).toBe(cli);
  // Responsive: the page's timers never waited half a second, and the progress bar moved.
  expect(probe.late).toBeLessThan(500);
  expect(report.progressSeen).toBeGreaterThan(2);
});
