/**
 * Two files of 1,000,000 rows, generated as offline/bench/memory_check.py generates them, checked in the page.
 * Skipped unless FA_LARGE=1 (it writes about 90 MB and takes a while):
 *
 *   FA_LARGE=1 npx playwright test e2e/check-large.spec.ts --project chrome
 *
 * Reports the time from pressing Check to the result, how late the page's own timers ran meanwhile (the tab is
 * responsive when they stay on time), and the peak memory of the page and of its worker, read through the Chrome
 * DevTools Protocol every 50 ms (Runtime.getHeapUsage: the JavaScript heap in use, and the backing stores of array
 * buffers, where a file read whole is held). It compares the summary with the command line's on the same files.
 */
import { execFileSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
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

interface HeapUsage {
  usedSize: number;
  backingStorageSize?: number;
}

/**
 * Peak memory of the page and of every worker it starts, in bytes, sampled until `stop` is called. A worker is its
 * own DevTools target: it is attached to from the page's session and asked through Target.sendMessageToTarget.
 */
async function watchHeap(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const peak = { pageHeap: 0, workerHeap: 0, workerBuffers: 0, workerTotal: 0, samples: 0 };
  const workers = new Set<string>();
  let next = 0;
  cdp.on("Target.attachedToTarget", (event) => {
    if (event.targetInfo.type === "worker") workers.add(event.sessionId);
  });
  cdp.on("Target.detachedFromTarget", (event) => void workers.delete(event.sessionId));
  cdp.on("Target.receivedMessageFromTarget", (event) => {
    const usage = (JSON.parse(event.message) as { result?: HeapUsage }).result;
    if (!usage || typeof usage.usedSize !== "number" || (JSON.parse(event.message) as { id: number }).id >= 1_000_000) return;
    const buffers = usage.backingStorageSize ?? 0;
    peak.samples++;
    peak.workerHeap = Math.max(peak.workerHeap, usage.usedSize);
    peak.workerBuffers = Math.max(peak.workerBuffers, buffers);
    peak.workerTotal = Math.max(peak.workerTotal, usage.usedSize + buffers);
  });
  await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
  const sample = async () => {
    for (const sessionId of workers) {
      cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: ++next, method: "Runtime.getHeapUsage" }) }).catch(() => undefined);
    }
    const usage = (await cdp.send("Runtime.getHeapUsage").catch(() => null)) as HeapUsage | null;
    if (usage) peak.pageHeap = Math.max(peak.pageHeap, usage.usedSize);
  };
  const timer = setInterval(() => void sample(), 50);
  return {
    peak,
    /** Stop sampling; then collect garbage in each worker and read what the result still holds. */
    async stop() {
      clearInterval(timer);
      await sample();
      const held = { heap: 0, buffers: 0 };
      const answered = new Promise<void>((resolve) => {
        let waiting = workers.size;
        if (!waiting) resolve();
        cdp.on("Target.receivedMessageFromTarget", (event) => {
          const message = JSON.parse(event.message) as { id: number; result?: HeapUsage };
          if (message.id < 1_000_000 || !message.result) return;
          held.heap = Math.max(held.heap, message.result.usedSize);
          held.buffers = Math.max(held.buffers, message.result.backingStorageSize ?? 0);
          if (--waiting === 0) resolve();
        });
      });
      let id = 1_000_000;
      for (const sessionId of workers) {
        await cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: 1, method: "HeapProfiler.collectGarbage" }) });
        await cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: ++id, method: "Runtime.getHeapUsage" }) });
      }
      await Promise.race([answered, new Promise((r) => setTimeout(r, 10_000))]);
      await cdp.detach().catch(() => undefined);
      return held;
    },
  };
}

const MiB = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;

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
  const chosen = Date.now();
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
  // The file profiles, read in their own worker as soon as the files are chosen, count what the check counts. A person
  // takes longer than they do to choose the columns; the check is started once they and the key profiles are read.
  await expect(page.getByTestId("source-profile")).toHaveAttribute("data-rows", String(ROWS), { timeout: 60_000 });
  await expect(page.getByTestId("destination-profile")).toHaveAttribute("data-rows", String(ROWS), { timeout: 60_000 });
  await expect(page.getByTestId("source-panel")).toHaveAttribute("data-key-profile", "ready", { timeout: 60_000 });
  await expect(page.getByTestId("destination-panel")).toHaveAttribute("data-key-profile", "ready", { timeout: 60_000 });
  const profiledSeconds = (Date.now() - chosen) / 1000;
  await expect(page.getByTestId("before-check")).toHaveCount(0);

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
  const heap = await watchHeap(page);
  // The time is taken in the page: from the click to the moment the result is in the document.
  await page.evaluate(() => {
    const timing = { clicked: 0, shown: 0 };
    (window as unknown as { timing: typeof timing }).timing = timing;
    const button = document.querySelector('[data-testid="run-check"]')!;
    button.addEventListener("click", () => (timing.clicked = performance.now()), { capture: true, once: true });
    const observer = new MutationObserver(() => {
      if (!document.querySelector("[data-result]")) return;
      timing.shown = performance.now();
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await page.getByTestId("run-check").click();
  await page.locator("[data-result]").waitFor({ timeout: 15 * 60_000 });
  const seconds = await page.evaluate(() => {
    const { clicked, shown } = (window as unknown as { timing: { clicked: number; shown: number } }).timing;
    return Math.round(shown - clicked) / 1000;
  });
  const probe = await page.evaluate(() => (window as unknown as { probe: { late: number; ticks: number; progress: number[] } }).probe);
  const held = await heap.stop();

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
  const report = { rows: ROWS, seconds, profiledSeconds, longestTimerDelayMs: Math.round(probe.late), timerTicks: probe.ticks, progressSeen: new Set(probe.progress).size,
    peakPageHeapMiB: MiB(heap.peak.pageHeap), peakWorkerHeapMiB: MiB(heap.peak.workerHeap), peakWorkerBuffersMiB: MiB(heap.peak.workerBuffers),
    peakWorkerTotalMiB: MiB(heap.peak.workerTotal), heldWorkerHeapMiB: MiB(held.heap), heldWorkerBuffersMiB: MiB(held.buffers), heapSamples: heap.peak.samples };
  writeReport("check-large", report);
  testInfo.annotations.push({ type: "large-file", description: JSON.stringify(report) });
  console.info(`large-file check: ${JSON.stringify(report)}`);
  expect(summary).toBe(cli);
  // Responsive: the page's timers were never 100 ms late, and the progress bar moved.
  expect(probe.late).toBeLessThan(100);
  // Bounded: a file read as a stream is never held whole. The two files are 45 MB each; before 1.0 the worker's
  // array buffers peaked above 150 MiB and its heap above 500 MiB (docs/design/1.0-streaming.md).
  expect(report.peakWorkerBuffersMiB).toBeLessThan(90);
  expect(report.peakWorkerHeapMiB).toBeLessThan(300);
  expect(report.progressSeen).toBeGreaterThan(2);
});
