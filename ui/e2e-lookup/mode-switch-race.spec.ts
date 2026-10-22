/**
 * Exact-ID lookup Detail (remediation-03) regression for the History F14 race (final-audit-followup-04): the lookup
 * Detail shares useEvidenceAcquisition. The first include_payload=true page of the real lookup Service is held until
 * armed; once all of its payload digests have resolved, "References only" is clicked N microtasks later
 * (N = 0–40). Expected: References only and 2 omitted references for the exact ID. Instrumentation is test-only.
 */
import { expect, test } from "@playwright/test";
import { openApp, retrieval, seal, startService, stopService, writeEvidence, type ServiceProcess } from "./support.ts";

let svc: ServiceProcess;
test.beforeAll(async ({ browserName }) => (svc = await startService(`mode-switch-race-${browserName}`)));
test.afterAll(async () => {
  await stopService(svc);
});

for (const id of ["x/evidence", "customer/001"])
  test(`lookup ${JSON.stringify(id)} · switch to References only N microtasks after the payload page settles (N = 0–40)`, async ({ page, browserName }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __f04: { arm: number; out: number; seen: number; clicked: boolean } };
      w.__f04 = { arm: -1, out: 0, seen: 0, clicked: false };
      const s = crypto.subtle;
      const orig = s.digest.bind(s);
      s.digest = ((...a: Parameters<SubtleCrypto["digest"]>) => {
        const f = w.__f04;
        if (f.arm >= 0) {
          f.out++;
          f.seen++;
        }
        return orig(...a).then((r) => {
          if (f.arm >= 0 && !f.clicked && --f.out === 0 && f.seen > 0) {
            f.clicked = true;
            let n = f.arm;
            const hop = () => {
              if (n-- > 0) queueMicrotask(hop);
              else ([...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "References only") as HTMLElement).click();
            };
            queueMicrotask(hop);
          }
          return r;
        });
      }) as SubtleCrypto["digest"];
    });
    const hash = `#/local/verification-lookup?${new URLSearchParams({ verification_id: id })}`;
    const outcomes: Record<number, unknown> = {};
    const failed: number[] = [];
    for (let n = 0; n <= 40; n++) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      let held: (() => Promise<void>) | null = null;
      await page.route(/\/api\/v1\/verification-evidence\?.*include_payload=true(?!.*cursor=)/, async (route) => {
        held = async () => {
          const real = await route.fetch();
          await route.fulfill({ response: real }).catch(() => {});
        };
      });
      await openApp(page, hash);
      await expect(seal(page)).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => held !== null).toBe(true);
      await page.evaluate((k) => ((window as unknown as { __f04: { arm: number } }).__f04.arm = k), n);
      await held!();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __f04: { clicked: boolean } }).__f04.clicked)).toBe(true);
      await expect(retrieval(page)).not.toContainText("Reading", { timeout: 20_000 });
      await page.waitForTimeout(150);
      const omitted = await page.getByText("payload omitted · omitted_by_request").count();
      const checked = await page.getByRole("radio", { name: "References only" }).getAttribute("aria-checked");
      const refusal = await page.locator('[data-access="REQUEST_ERROR"]').allTextContents();
      outcomes[n] = { omitted, checked, retrieval: await retrieval(page).textContent(), refusal: refusal.join(" | ").slice(0, 240) };
      if (omitted !== 2 || checked !== "true") failed.push(n);
    }
    writeEvidence(`mode-switch-race/${browserName}-${encodeURIComponent(id)}`, outcomes);
    expect(failed, `N values that ended without References only + 2 omitted: ${failed.join(",")}`).toEqual([]);
  });
