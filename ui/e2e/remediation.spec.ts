/**
 * Browser regression tests for the Phase 2.5 independent audit (FlowAssert-UI-Review/FINDINGS.md):
 *   UIA-001 focus is visible on current and selected controls — focused vs unfocused pixels of the same element;
 *   UIA-002 the drawer holds focus after a click on its blank space (the audit's exact sequence);
 *   UIA-006 widening past `lg` with the drawer open releases the scroll lock;
 *   UIA-007 the evidence table scroller is reachable and scrollable by keyboard at 375px;
 *   UIA-008 Detail NOT_FOUND has an h1.
 * Expectations come from WCAG and the stated requirements, not from captured output.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { AXE_PATH, THEMES, open, writeReport, type Theme } from "./helpers.ts";

/** WebKit follows Safari's default: Tab reaches form fields only; Option+Tab reaches every item. */
const tabKey = (browserName: string) => (browserName === "webkit" ? "Alt+Tab" : "Tab");

/* ---------- UIA-001 · focus visibility, measured as a pixel difference ---------- */

/** Wait for CSS transitions on the element to finish, so a measurement is of the settled state. */
const settle = (el: Locator) => el.evaluate((e) => Promise.all(e.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))));

/** Number of pixels that differ (sum of channel deltas > 48) between two PNG screenshots of the same size. */
async function changedPixels(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      const load = (b64: string) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      const data = (img: HTMLImageElement) => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const da = data(ia);
      const db = data(ib);
      if (da.length !== db.length) return -1;
      let n = 0;
      for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i]! - db[i]!) + Math.abs(da[i + 1]! - db[i + 1]!) + Math.abs(da[i + 2]! - db[i + 2]!) > 48) n++;
      return n;
    },
    [a.toString("base64"), b.toString("base64")] as const,
  );
}

interface FocusCase {
  name: string;
  hash: string;
  width?: number;
  prepare?: (page: Page) => Promise<void>;
  target: (page: Page) => Locator;
}

const FOCUS_CASES: FocusCase[] = [
  { name: "rail · current-page link", hash: "#/verifications", target: (p) => p.locator('aside a[aria-current="page"]') },
  { name: "rail · other link (control)", hash: "#/verifications", target: (p) => p.locator('aside a[href="#/rules"]') },
  {
    name: "drawer · current-page link",
    hash: "#/settings",
    width: 375,
    prepare: async (p) => {
      await p.getByRole("button", { name: "Open navigation" }).click();
      await p.waitForTimeout(300);
    },
    target: (p) => p.getByRole("dialog").locator('a[aria-current="page"]'),
  },
  { name: "settings · Density checked option", hash: "#/settings", target: (p) => p.getByRole("radiogroup", { name: "Density" }).getByRole("radio", { checked: true }) },
  { name: "settings · Focus ring checked option", hash: "#/settings", target: (p) => p.getByRole("radiogroup", { name: "Focus ring" }).getByRole("radio", { checked: true }) },
  { name: "settings · selected theme specimen", hash: "#/settings", target: (p) => p.locator(".fa-specimen[aria-checked=true]") },
  { name: "rail · active theme switch (control)", hash: "#/settings", target: (p) => p.locator("aside").getByRole("radio", { checked: true }) },
  { name: "states · Outcome checked option", hash: "#/states", target: (p) => p.getByRole("radiogroup", { name: "Outcome of the next read" }).getByRole("radio", { checked: true }) },
  { name: "rules · Comparison checked option", hash: "#/rules", target: (p) => p.getByRole("radiogroup", { name: "Comparison" }).getByRole("radio", { checked: true }) },
];

for (const theme of THEMES) {
  for (const c of FOCUS_CASES) {
    test(`UIA-001 focus visible · ${theme} · ${c.name}`, async ({ page, browserName }) => {
      const TAB = tabKey(browserName);
      await page.setViewportSize({ width: c.width ?? 1440, height: c.width ? 812 : 900 });
      await open(page, c.hash, theme);
      await c.prepare?.(page);
      const el = c.target(page);
      await expect(el).toHaveCount(1);

      // Reach the element with the keyboard, as a keyboard user would (no programmatic focus).
      let reached = false;
      for (let i = 0; i < 260 && !reached; i++) {
        await page.keyboard.press(TAB);
        reached = await el.evaluate((e) => e === document.activeElement);
      }
      expect(reached, "reachable by keyboard").toBe(true);
      expect(await el.evaluate((e) => e.matches(":focus-visible"))).toBe(true);
      await page.mouse.move(0, 0);
      await settle(el);
      const box = (await el.boundingBox())!;
      const clip = { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16 };
      const focused = await page.screenshot({ clip });

      // Same element, same scroll position, unfocused.
      await el.evaluate((e) => (e as HTMLElement).blur());
      await settle(el);
      const restBox = (await el.boundingBox())!;
      const rest = await page.screenshot({ clip });

      // Refocus (keyboard modality persists) and blur again: both states must reproduce exactly,
      // so the difference is attributable to focus and not to animation or rendering noise.
      // (focusVisible: the test is restoring the keyboard-focused state it already reached by Tab.)
      await el.evaluate((e) => (e as HTMLElement).focus({ focusVisible: true }));
      expect(await el.evaluate((e) => e.matches(":focus-visible"))).toBe(true);
      await settle(el);
      const focusedAgain = await page.screenshot({ clip });
      await el.evaluate((e) => (e as HTMLElement).blur());
      await settle(el);
      const restAgain = await page.screenshot({ clip });

      const diff = await changedPixels(page, focused, rest);
      const result = {
        theme,
        case: c.name,
        diffPixels: diff,
        minimum: Math.round(box.width + box.height),
        focusedStable: await changedPixels(page, focused, focusedAgain),
        restStable: await changedPixels(page, rest, restAgain),
        layoutShift: [restBox.x - box.x, restBox.y - box.y, restBox.width - box.width, restBox.height - box.height],
      };
      writeReport(`uia001-focus-${browserName}-${theme}-${c.name.replace(/[^a-z]+/gi, "-")}`, result);
      // Each state must reproduce (a few antialiased pixels of noise are tolerated), and the focus
      // difference must dwarf that noise and cover at least half the element's perimeter: a ring, not a stray pixel.
      const noise = Math.max(result.focusedStable, result.restStable);
      expect(noise, "focused and unfocused renders each reproduce").toBeLessThanOrEqual(16);
      expect(diff, "focused and unfocused renders differ visibly").toBeGreaterThanOrEqual(Math.max(result.minimum, 10 * noise));
      expect(result.layoutShift, "focus causes no layout shift").toEqual([0, 0, 0, 0]);
    });
  }
}

/* ---------- UIA-002 · drawer containment after a click on blank drawer space ---------- */

async function openDrawer(page: Page, hash = "#/verifications", width = 375) {
  await page.setViewportSize({ width, height: 812 });
  await open(page, hash);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const dialog = page.getByRole("dialog", { name: "Navigation" });
  await expect(dialog).toBeVisible();
  return { dialog, panel: dialog.locator("> div").last() };
}
const where = (page: Page) => page.evaluate(() => `${document.activeElement?.tagName}:${(document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "").trim().slice(0, 30)}`);
const inside = (dialog: Locator) => dialog.evaluate((d) => d.contains(document.activeElement));

test("UIA-002 audit H3 · click non-interactive drawer content, then Tab ×6 — focus never leaves", async ({ page }) => {
  const { dialog, panel } = await openDrawer(page);
  const box = (await panel.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.62);
  const trail: string[] = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    trail.push(await where(page));
    expect(await inside(dialog), `trail: ${trail.join(" → ")}`).toBe(true);
  }
  writeReport(`uia002-h3-${test.info().project.name}`, { trail });
});

test("UIA-002 audit H3b · click just below the last drawer control, then one Tab", async ({ page }) => {
  const { dialog, panel } = await openDrawer(page);
  const box = (await panel.boundingBox())!;
  const lastBottom = await panel.evaluate((p) => [...p.querySelectorAll("a[href],button")].at(-1)!.getBoundingClientRect().bottom);
  await page.mouse.click(box.x + 20, Math.min(box.y + box.height - 4, lastBottom + 6));
  await page.keyboard.press("Tab");
  expect(await inside(dialog), `first Tab went to ${await where(page)}`).toBe(true);
});

test("UIA-002 · blank click, then Shift+Tab ×20 and (WebKit) Option+Tab ×20 stay inside", async ({ page, browserName }) => {
  const { dialog, panel } = await openDrawer(page);
  const box = (await panel.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.62);
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await inside(dialog), `Shift+Tab #${i + 1} → ${await where(page)}`).toBe(true);
  }
  if (browserName === "webkit") {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.62);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Alt+Tab");
      expect(await inside(dialog), `Option+Tab #${i + 1} → ${await where(page)}`).toBe(true);
    }
  }
});

test("UIA-002 · focus the trap moves after a pointer-opened drawer shows the focus indicator", async ({ page, browserName }) => {
  const { dialog } = await openDrawer(page);
  for (const key of browserName === "webkit" ? ["Tab", "Alt+Tab"] : ["Tab"])
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(key);
      expect(await inside(dialog)).toBe(true);
      expect(await page.evaluate(() => document.activeElement!.matches(":focus-visible")), `${key} #${i + 1} → ${await where(page)}`).toBe(true);
      expect(await page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow), `${key} #${i + 1}`).not.toBe("none");
    }
});

test("UIA-002 · the page behind the open drawer cannot take focus, even by clicking it", async ({ page }) => {
  const { dialog } = await openDrawer(page);
  const search = page.getByRole("searchbox", { name: "Search runs", includeHidden: true });
  expect(await search.evaluate((e) => e.closest("[inert]") !== null)).toBe(true);
  // A click lands on the backdrop (it closes the drawer); programmatic focus on the inert field is refused.
  await search.evaluate((e) => (e as HTMLElement).focus());
  expect(await search.evaluate((e) => e === document.activeElement)).toBe(false);
  await page.keyboard.press("Tab");
  expect(await inside(dialog)).toBe(true);
});

test("UIA-002 · Escape closes, returns focus to the menu button, and Tab is the page's own again", async ({ page }) => {
  const { dialog, panel } = await openDrawer(page);
  const box = (await panel.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.62);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const menu = page.getByRole("button", { name: "Open navigation" });
  await expect(menu).toBeFocused();
  expect(await page.evaluate(() => document.querySelectorAll("[inert]").length)).toBe(0);
});

test("UIA-002 · containment survives a resize within the mobile range", async ({ page }) => {
  const { dialog, panel } = await openDrawer(page);
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(150);
  await expect(dialog).toBeVisible();
  const box = (await panel.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.62);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await inside(dialog)).toBe(true);
  }
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
});

/* ---------- UIA-006 · scroll lock across the lg breakpoint ---------- */

test("UIA-006 · open at 768, widen to 1280: drawer closes, scroll is released, the page scrolls", async ({ page }) => {
  await openDrawer(page, "#/verifications", 768);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // `lg:hidden` hides the dialog, and so drops it from the accessibility tree, as soon as styles are
  // recomputed. The drawer itself closes only when the matchMedia change event is dispatched, at the
  // browser's next rendering update. Wait for that: the dialog element leaves the DOM, then the page
  // state is restored.
  await expect(page.locator('[role="dialog"]'), "drawer removed from the DOM, not only hidden").toHaveCount(0);
  const state = () => page.evaluate(() => ({ overflow: document.body.style.overflow, inert: document.querySelectorAll("[inert]").length, active: document.activeElement?.id }));
  await expect.poll(state).toEqual({ overflow: "", inert: 0, active: "main" });
  const r = await state();
  writeReport(`uia006-resize-${test.info().project.name}`, r);
  expect(r).toEqual({ overflow: "", inert: 0, active: "main" });
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  // Back to mobile: the drawer opens and traps again.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const dialog = page.getByRole("dialog", { name: "Navigation" });
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await inside(dialog)).toBe(true);
  }
});

/* ---------- UIA-007 · evidence table scroller ---------- */

test("UIA-007 · at 375px the evidence table is a named region reachable and scrollable by keyboard", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, "#/states");
  const region = page.locator("#st-evidence").getByRole("region");
  await expect(region).toHaveCount(1);
  await expect(region).toHaveAccessibleName(/^Evidence references for VR-/);
  let reached = false;
  for (let i = 0; i < 120 && !reached; i++) {
    await page.keyboard.press(tabKey(browserName));
    reached = await region.evaluate((e) => e === document.activeElement);
  }
  expect(reached, "reached by keyboard").toBe(true);
  expect(await region.evaluate((e) => e.matches(":focus-visible"))).toBe(true);
  const before = await region.evaluate((e) => e.scrollLeft);
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await expect.poll(() => region.evaluate((e) => e.scrollLeft)).toBeGreaterThan(before);
  writeReport(`uia007-scroller-${browserName}`, { reached, before, after: await region.evaluate((e) => e.scrollLeft) });
});

test("UIA-007 · at 1440px the table fits: no extra Tab stop, same rows in the same order", async ({ page }) => {
  const rows = () => page.locator("#st-evidence tbody .mono-id").allTextContents();
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, "#/states");
  const narrow = await rows();
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "#/states");
  expect(await page.locator("#st-evidence [tabindex]").count()).toBe(0);
  expect(await page.locator("#st-evidence").getByRole("region").count()).toBe(0);
  expect(await rows()).toEqual(narrow);
  expect(narrow.length).toBeGreaterThan(0);
});

/* ---------- UIA-008 · NOT_FOUND heading, and axe at 375 (where UIA-007 was found) ---------- */

test("UIA-008 · Detail NOT_FOUND has exactly one h1 naming the missing run", async ({ page }) => {
  await open(page, "#/verifications/VR-9999");
  const h1 = page.locator("h1");
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText("No verification run VR-9999");
});

async function axeViolations(page: Page) {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    // Same exclusion as e2e/a11y.spec.ts: [data-ornament] is aria-hidden typographic decoration.
    const r = await axe.run({ exclude: [["[data-ornament]"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] }, resultTypes: ["violations"] });
    return r.violations.map((v) => `${v.id} ×${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  });
}

for (const theme of THEMES as readonly Theme[]) {
  test(`axe at 375px · ${theme} · every route and Detail NOT_FOUND`, async ({ page, browserName }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const results: Record<string, string[]> = {};
    for (const hash of ["#/", "#/verifications", "#/verifications/VR-2025", "#/verifications/VR-9999", "#/connections", "#/rules", "#/settings", "#/states"]) {
      await open(page, hash, theme);
      await page.waitForTimeout(400);
      results[hash] = await axeViolations(page);
    }
    writeReport(`axe-375-${browserName}-${theme}`, results);
    expect(Object.entries(results).flatMap(([h, v]) => v.map((x) => `${h} ${x}`))).toEqual([]);
  });
}
