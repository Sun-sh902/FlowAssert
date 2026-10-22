import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";

export const OUT = join(process.cwd(), "e2e", ".output");

/** Every route of the app, plus the specimen page and a deep Detail link. */
export const ROUTES = [
  { name: "overview", hash: "#/" },
  { name: "verifications", hash: "#/verifications" },
  { name: "detail", hash: "#/verifications/VR-2025" },
  { name: "connections", hash: "#/connections" },
  { name: "rules", hash: "#/rules" },
  { name: "settings", hash: "#/settings" },
  { name: "states", hash: "#/states" },
] as const;

export const WIDTHS = [375, 768, 1024, 1280, 1440] as const;
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** Open a route with a stored theme, as a returning visitor would. */
export async function open(page: Page, hash: string, theme: Theme = "light") {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("flowassert.theme", t);
    } catch {
      /* storage unavailable */
    }
  }, theme);
  // A hash-only change is a same-document navigation; load a blank page first so every route starts fresh.
  await page.goto("about:blank");
  await page.goto(`/${hash}`);
  await page.locator("#main").waitFor();
  // Wait for the page's own heading so lazily loaded routes (#/states) are rendered before any check.
  await page.locator("main :is(h1, h2)").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
}

export function writeReport(name: string, data: unknown) {
  const file = join(OUT, `${name}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}

const require = createRequire(import.meta.url);
export const AXE_PATH = require.resolve("axe-core/axe.min.js");
