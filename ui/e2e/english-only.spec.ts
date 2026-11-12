/**
 * The interface is English only from 1.1.0. A browser that chose Chinese in 1.0 (the stored "flowassert.locale"), or
 * whose own language is Chinese, gets the English page: no error or warning in the console, no reload, the stored
 * choice cleared once, and <html lang="en">.
 */
import { expect, test } from "@playwright/test";

for (const [what, options] of [
  ["a browser that stored Chinese in 1.0", { stored: true, locale: "en-US" }],
  ["a browser whose own language is Chinese", { stored: false, locale: "zh-CN" }],
] as const) {
  test(`${what} gets the English page, once, with nothing in the console`, async ({ browser }) => {
    const context = await browser.newContext({ locale: options.locale });
    const page = await context.newPage();
    if (options.stored) await page.addInitScript(() => sessionStorage.getItem("seeded") || (localStorage.setItem("flowassert.locale", "zh-CN"), sessionStorage.setItem("seeded", "1")));
    const messages: string[] = [];
    page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && messages.push(`${m.type()}: ${m.text()}`));
    page.on("pageerror", (e) => messages.push(`pageerror: ${e.message}`));
    let loads = 0;
    page.on("load", () => void loads++);
    await page.goto("/#/check");
    await page.getByTestId("run-check").waitFor();
    await page.waitForTimeout(1000);
    expect(loads).toBe(1);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("CSV check");
    await expect(page.getByRole("radiogroup", { name: "Language" })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("flowassert.locale"))).toBeNull();
    expect(messages).toEqual([]);
    await context.close();
  });
}
