/**
 * Behaviour that needs a real browser: focus visibility, focus order, the modal drawer,
 * reduced motion, theme persistence across reloads, and console cleanliness.
 */
import { expect, test } from "@playwright/test";
import { ROUTES, open, writeReport } from "./helpers.ts";

/** WebKit follows Safari's default: Tab reaches form fields only; Option+Tab reaches every item. */
const tabKey = (browserName: string) => (browserName === "webkit" ? "Alt+Tab" : "Tab");

test("no console errors or failed requests on any route", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("requestfailed", (r) => problems.push(`failed ${r.url()}`));
  for (const r of ROUTES) await open(page, r.hash);
  expect(problems).toEqual([]);
});

test("the only network traffic is the app's own static files", async ({ page }) => {
  const hosts = new Set<string>();
  const api: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    hosts.add(u.host);
    if (u.pathname.startsWith("/api/")) api.push(u.pathname);
  });
  for (const r of ROUTES) await open(page, r.hash);
  // Phase 2: the preview binds to loopback (127.0.0.1). The MOCK demo routes never call the local service.
  expect([...hosts]).toEqual(["127.0.0.1:4183"]);
  expect(api).toEqual([]);
});

/**
 * Installs `window.__fvStyle(el)`: the computed styles that can carry a focus indicator, for the element
 * and its ::before / ::after. Callers read it after the element's transitions settle.
 */
const installIndicatorStyle = () => {
  (window as unknown as { __fvStyle: (el: Element) => string }).__fvStyle = (el) => {
    const s = getComputedStyle(el);
    const a = getComputedStyle(el, "::after");
    const b = getComputedStyle(el, "::before");
    return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.textDecorationLine, s.borderBottomStyle, s.borderBottomWidth, s.borderBottomColor, s.backgroundColor, s.color, a.boxShadow, a.outlineStyle, b.boxShadow, b.outlineStyle].join("|");
  };
};
type FvWindow = Window & { __fvStyle: (el: Element) => string };

test("every keyboard-focusable element shows a visible focus indicator", async ({ page, browserName }) => {
  const TAB = tabKey(browserName);
  const missing: Record<string, string[]> = {};
  const unchanged: Record<string, string[]> = {};
  const counts: Record<string, number> = {};
  const underlineOnly: string[] = [];
  await page.addInitScript(installIndicatorStyle);
  for (const r of ROUTES) {
    await open(page, r.hash);
    await page.locator("body").press(TAB); // establish keyboard modality
    missing[r.name] = [];
    unchanged[r.name] = [];
    let n = 0;
    for (; n < 200; n++) {
      const info = await page.evaluate(async () => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        if (el.dataset.fvSeen) return { cycled: true } as const;
        el.dataset.fvSeen = "1";
        await Promise.all(el.getAnimations().map((x) => x.finished.catch(() => undefined)));
        const s = getComputedStyle(el);
        const after = getComputedStyle(el, "::after");
        // Form fields in the draft editor use a 1.5px indigo underline as their focus indicator.
        const underlineField = s.borderBottomStyle === "solid" && parseFloat(s.borderBottomWidth) >= 1.5 && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
        const visible =
          (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) ||
          s.boxShadow !== "none" ||
          after.boxShadow !== "none" ||
          s.textDecorationLine.includes("underline") ||
          underlineField;
        const id = `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)} [border-bottom ${s.borderBottomStyle} ${s.borderBottomWidth}; outline ${s.outlineStyle}; shadow ${s.boxShadow.slice(0, 30)}]`;
        const focused = (window as unknown as FvWindow).__fvStyle(el);
        return { cycled: false, id, visible, underlineField, matches: el.matches(":focus-visible"), focused } as const;
      });
      if (!info || info.cycled) break;
      if (!info.visible || !info.matches) missing[r.name]!.push(info.id);
      if (info.underlineField) underlineOnly.push(`${r.name} ${info.id}`);
      // A resting shadow or underline is not a focus indicator: the same element must look different
      // focused and unfocused (UIA-001). Blur, measure, then refocus and continue the Tab sequence.
      const resting = await page.evaluate(async () => {
        const el = document.activeElement as HTMLElement;
        el.dataset.fvMark = "1";
        el.blur();
        await Promise.all(el.getAnimations().map((x) => x.finished.catch(() => undefined)));
        return (window as unknown as FvWindow).__fvStyle(el);
      });
      if (resting === info.focused) unchanged[r.name]!.push(info.id);
      await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>("[data-fv-mark]")!;
        el.removeAttribute("data-fv-mark");
        el.focus();
      });
      await page.keyboard.press(TAB);
    }
    counts[r.name] = n;
  }
  writeReport(`focus-visibility-${browserName}`, { counts, missing, unchanged, underlineOnly });
  for (const [route, ids] of Object.entries(missing)) expect.soft(ids, route).toEqual([]);
  for (const [route, ids] of Object.entries(unchanged)) expect.soft(ids, `${route}: focused style equals resting style`).toEqual([]);
});

test("the first Tab stop is the skip link, and it moves focus to main", async ({ page, browserName }) => {
  await open(page, "#/verifications/VR-2025");
  await page.keyboard.press(tabKey(browserName));
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("mobile drawer traps focus, closes on Escape and restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, "#/");
  const menu = page.getByRole("button", { name: "Open navigation" });
  await menu.click();
  const dialog = page.getByRole("dialog", { name: "Navigation" });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();
});

test("theme and preferences survive a reload", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByRole("radio", { name: "Night ledger (dark)" }).click();
  await page.getByRole("radiogroup", { name: "Density" }).getByRole("radio", { name: "Compact" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await page.getByRole("button", { name: /Reset local preferences/ }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
});

test("reduced motion stops the loading breath and fades", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "#/states");
  const d = await page.locator(".fa-breathe").first().evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(d)).toBeLessThan(0.001);
});

test("the in-app reduce-motion preference also stops it", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("flowassert.prefs", JSON.stringify({ motion: "reduce" })));
  await open(page, "#/states");
  const d = await page.locator(".fa-breathe").first().evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(d)).toBeLessThan(0.001);
});

test("a simulated read announces loading, then the result, in a live region", async ({ page }) => {
  await open(page, "#/states");
  await page.getByRole("radio", { name: "Service down" }).click();
  await page.getByRole("button", { name: /^Read VR-/ }).click();
  const status = page.locator("#st-live p[aria-live=polite]");
  await expect(status).toHaveText("reading");
  const alert = page.locator("[data-live-result]").getByRole("alert");
  await expect(alert).toHaveAttribute("data-access", "SERVICE_UNAVAILABLE");
  await expect(status).toHaveText("settled · service unavailable");
});
