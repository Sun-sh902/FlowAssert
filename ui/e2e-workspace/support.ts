/**
 * Product round 01 real-service E2E support: custody of the workspace Service process and fixed expectations.
 *
 * The Service is ../service (the product workspace copy of the accepted Phase 3A Service), launched only through
 * ../scripts/dev/service.sh (fixed 127.0.0.1:8765, socket audit by the Service's own scripts/guarded_entry.py).
 * Each process is started by this suite, recorded with its PID, and stopped with SIGINT to that PID only.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";

export const UI = process.cwd();
export const ROOT = join(UI, "..");
export const SERVICE_ORIGIN = "http://127.0.0.1:8765";
export const APP_ORIGIN = "http://127.0.0.1:5183";
// Round 02 hardening FIX02: the defaults are git-ignored. They used to be the committed Round 02 evidence and screenshot
// directories, so every run silently rewrote those records. Point FA_WORKSPACE_EVIDENCE_DIR / FA_WORKSPACE_SCREENSHOT_DIR
// at a docs/ directory only to capture new evidence deliberately.
export const OUT = process.env.FA_WORKSPACE_EVIDENCE_DIR ?? join(UI, "test-results-evidence/e2e-workspace");
export const SHOTS = process.env.FA_WORKSPACE_SCREENSHOT_DIR ?? join(UI, "test-results-evidence/e2e-workspace/screenshots");

export type State = "dev-main" | "dev-single" | "dev-empty";

/**
 * Expected newest archived cohort result per case — the backend handoff's case table
 * (FlowAssert-Phase3A-Service/docs/phase3a/FRONTEND_HANDOFF.md). Fixed here, never read from the UI.
 */
export const EXPECTED_COHORT = { "SPEC-001": "Verified", "SPEC-002": "Mismatch", "SPEC-003": "Pending", "SPEC-004": "Unverified", "SPEC-005": "Unverified" } as const;
export const CASES = Object.keys(EXPECTED_COHORT) as (keyof typeof EXPECTED_COHORT)[];

export function writeEvidence(name: string, data: unknown) {
  const file = join(OUT, `${name}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export const listener = () => {
  try {
    return execFileSync("lsof", ["-nP", "-iTCP:8765", "-sTCP:LISTEN"], { encoding: "utf8" });
  } catch {
    return "";
  }
};

async function until(fn: () => Promise<boolean>, ms: number, what: string) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export interface ServiceProcess {
  child: ChildProcess;
  pid: number;
  state: State;
  log: string[];
}

export const custody: Record<string, unknown>[] = [];

export async function startService(state: State): Promise<ServiceProcess> {
  if (listener()) throw new Error("port 8765 already has a listener; refusing to start or kill an unknown process");
  const log: string[] = [];
  const child = spawn(join(ROOT, "scripts/dev/service.sh"), [], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FA_STATE: state } });
  child.stdout!.on("data", (d) => log.push(String(d)));
  child.stderr!.on("data", (d) => log.push(String(d)));
  await until(
    async () => {
      if (child.exitCode !== null) throw new Error(`service exited ${child.exitCode}: ${log.join("")}`);
      try {
        return (await fetch(`${SERVICE_ORIGIN}/api/v1/history?limit=1`)).status === 200;
      } catch {
        return false;
      }
    },
    30_000,
    "the workspace Service to listen",
  );
  custody.push({ event: "start", state, pid: child.pid, at: new Date().toISOString() });
  return { child, pid: child.pid!, state, log };
}

export async function stopService(p: ServiceProcess | null) {
  if (!p || p.child.exitCode !== null) return;
  const exited = new Promise((r) => p.child.once("exit", r));
  process.kill(p.pid, "SIGINT");
  await exited;
  await until(async () => listener() === "", 10_000, "port 8765 to be released");
  custody.push({ event: "stop", state: p.state, pid: p.pid, at: new Date().toISOString(), exit: p.child.exitCode, signal: p.child.signalCode });
}

/** Every request the page makes, to prove the browser talks only to its own origin. */
export function recordRequests(page: Page): { method: string; url: string }[] {
  const seen: { method: string; url: string }[] = [];
  page.on("request", (r) => seen.push({ method: r.method(), url: r.url() }));
  return seen;
}

export async function open(page: Page, hash: string, theme: "light" | "dark" = "light") {
  await page.goto("about:blank");
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("flowassert.theme", t);
    } catch {
      /* storage unavailable */
    }
  }, theme);
  await page.goto(`/${hash}`);
}

export const seals = (page: Page, scope = "body") => page.locator(`${scope} .fa-seal`).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.s));
