/**
 * History F14 regression (final-audit-followup-04): switching "Payloads" → "References only" while the first
 * include_payload=true evidence page's read is settling. Real Service, real gate, production build.
 * Instrumentation, test-only: (1) the first include_payload=true page is held until the probe is armed; (2) an init
 * script observes crypto.subtle.digest (the app checks each received payload's digest) and, once that page's 2nd
 * digest has resolved, clicks "References only" N microtasks later — inside the same task, after the read has
 * settled but before React has rendered it. N = 0–40. Before the fix, N ≥ 5 ended with 0 omitted references and
 * "cursor_out_of_sequence" (the stale payload page was admitted into the new acquisition) — the F14 failure.
 */
import { expect, test, type Page } from "@playwright/test";
import { FIRST, startService, stopService, writeEvidence, type ServiceProcess } from "./support.ts";

test.describe.configure({ mode: "serial" });
let service: ServiceProcess;
test.beforeAll(async ({ browserName }) => (service = await startService(`${browserName}:f14-race`, "ui-main")));
test.afterAll(async ({ browserName }) => stopService(service, `${browserName}:f14-race`));

const HID = FIRST["SPEC-003"];
const archived = (page: Page) => page.getByRole("region", { name: "Archived evidence" });

test("F14 · race: switch to References only N microtasks after the payload page's read settles (N = 0–40)", async ({ page, browserName }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __f04: { arm: number; digests: number; clicked: boolean } };
    w.__f04 = { arm: -1, digests: 0, clicked: false };
    const s = crypto.subtle;
    const orig = s.digest.bind(s);
    s.digest = ((...a: Parameters<SubtleCrypto["digest"]>) =>
      orig(...a).then((r) => {
        const f = w.__f04;
        if (f.arm >= 0 && !f.clicked && ++f.digests === 2) {
          f.clicked = true;
          let n = f.arm;
          const hop = () => {
            if (n-- > 0) queueMicrotask(hop);
            else ([...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "References only") as HTMLElement).click();
          };
          queueMicrotask(hop);
        }
        return r;
      })) as SubtleCrypto["digest"];
  });
  const outcomes: Record<number, { omitted: number; retrieval: string | null; refusal: string | null; checked: string | null; requests: string[] }> = {};
  for (let n = 0; n <= 40; n++) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    let held: (() => Promise<void>) | null = null;
    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/evidence?")) requests.push(new URL(r.url()).search.replace(/snapshot_id=[^&]+&/, "").replace(/cursor=[^&]+/, "cursor=…"));
    });
    await page.route(/\/evidence\?.*include_payload=true(?!.*cursor=)/, async (route) => {
      held = async () => {
        const real = await route.fetch();
        await route.fulfill({ response: real }).catch(() => {});
      };
    });
    await page.goto("about:blank");
    await page.goto(`/#/local/history/${HID}`);
    await expect(page.locator('.fa-seal[data-size="lg"]')).toHaveAttribute("data-s", "Pending", { timeout: 20_000 });
    await expect.poll(() => held !== null).toBe(true);
    await page.evaluate((k) => ((window as unknown as { __f04: { arm: number } }).__f04.arm = k), n);
    await held!();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __f04: { clicked: boolean } }).__f04.clicked)).toBe(true);
    await expect(archived(page).locator("[data-retrieval]")).not.toContainText("Reading", { timeout: 20_000 });
    await page.waitForTimeout(150);
    const refusal = await archived(page).locator('[data-access="REQUEST_ERROR"]').count();
    outcomes[n] = {
      omitted: await archived(page).getByText("payload omitted · omitted_by_request").count(),
      retrieval: await archived(page).locator("[data-retrieval]").textContent(),
      refusal: refusal ? await archived(page).locator('[data-access="REQUEST_ERROR"]').textContent() : null,
      checked: await archived(page).getByRole("radio", { name: "References only" }).getAttribute("aria-checked"),
      requests: [...requests],
    };
    page.removeAllListeners("request");
  }
  writeEvidence(`${browserName}/F14-mode-switch-race`, outcomes);
  const failed = Object.entries(outcomes).filter(([, o]) => o.omitted !== 2 || o.checked !== "true").map(([n]) => Number(n));
  expect(failed, `N values that ended without the F14 state: ${failed.join(",")}`).toEqual([]);
});
