/**
 * Lifecycle of the browser network captures in e2e-lookup, e2e-local and e2e-history (Round 02 hardening FIX02).
 *
 * A captured response is read asynchronously (body, then headers). Before FIX02 each read was a floating promise and
 * settle() awaited only the reads started before it was called. A response that arrived just after a test's last
 * settle() was still being read when the test ended and Playwright closed the page; its allHeaders() then rejected
 * with "Target page, context or browser has been closed" as an unhandled rejection, which Playwright reports against
 * whichever test is running at that moment (the owner, or the next test) and which, in a serial file, stops every
 * later test. Reproduced in Chrome and WebKit: docs/product-dev/round-02-hardening/fix02/BROWSER_FAILURE_ROOT_CAUSE.md.
 *
 * settle() now waits until no read is in flight, including reads that start while it waits, and throws the first read
 * error. A read cut off because the page closed (Playwright's TargetClosedError; the client does not export the class
 * and names it "Error", so it is recognised by its fixed message) is recorded, never silently dropped: it is listed
 * in `interrupted`, annotated "capture-interrupted-by-close" on the test that owns the capture and printed on stderr.
 * It fails a later settle(), because a test that waits for its captures needs them complete; once the test has ended,
 * nothing awaits or asserts on it. Any other read error that no settle() awaits still rejects unhandled, as before.
 */
import { test, type Page, type TestInfo } from "@playwright/test";

export function captureLifecycle(page: Page) {
  const pending = new Set<Promise<void>>();
  const errors: unknown[] = [];
  const interrupted: string[] = [];
  const closedTarget = (e: unknown) => e instanceof Error && e.message.includes("Target page, context or browser has been closed");
  let owner: TestInfo | null = null;
  try {
    owner = test.info();
  } catch {
    owner = null; // created outside a test
  }
  const track = (url: string, read: Promise<void>) => {
    const p: Promise<void> = read
      .catch((e: unknown) => {
        if (closedTarget(e)) {
          interrupted.push(url);
          owner?.annotations.push({ type: "capture-interrupted-by-close", description: url });
          console.warn(`[capture] read interrupted by page close${page.isClosed() ? "" : " (page not yet reported closed)"}: ${url}`);
          return;
        }
        errors.push(e);
        throw e;
      })
      .finally(() => pending.delete(p));
    pending.add(p);
  };
  const settle = async () => {
    while (pending.size) await Promise.allSettled(pending);
    if (errors.length) throw errors[0];
    if (interrupted.length) throw new Error(`network capture interrupted by page close: ${interrupted.join(", ")}`);
  };
  return { track, settle, interrupted };
}
