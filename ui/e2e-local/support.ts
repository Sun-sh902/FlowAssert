/**
 * Real-service E2E support: process custody for the isolated local Service, direct (non-browser)
 * reads for comparison, network capture, and evidence files.
 *
 * The Service is the exact-source isolated copy in .phase2-runtime/ (scripts/phase2/prepare_runtime.py),
 * launched only through scripts/phase2/local-service.sh, which fixes 127.0.0.1:8765. Each process is
 * owned by this suite, recorded with its PID, and stopped with SIGTERM to that PID only.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page, Response } from "@playwright/test";
import { captureLifecycle } from "../e2e/capture-lifecycle.ts";

export const UI = process.cwd();
export const SERVICE_ORIGIN = "http://127.0.0.1:8765";
export const KEY_FILE = join(UI, ".phase2-runtime/state/keys/cursor-hmac.key");
// Phase 3A: FA_E2E_EVIDENCE_DIR redirects evidence so a regression re-run never overwrites the accepted Phase 2 records.
export const EVIDENCE_DIR = process.env.FA_E2E_EVIDENCE_DIR ?? join(UI, "docs/phase2/evidence/e2e");
const HANDOFF = "/Users/zhangshenghe/Documents/FlowAssert-Phase2-Support";

/**
 * Expected outcomes fixed independently of the UI under test, transcribed from
 * FlowAssert-Phase2-Support/SYNTHETIC_CASES.md ("Actual record states", "Actual cohort", counts, expected_total).
 */
export const EXPECTED = {
  "SPEC-001": { fixture: "A-verified", cohort: "Verified", records: ["Verified"], counts: { Verified: 1, Mismatch: 0, Pending: 0, Unverified: 0 }, expectedTotal: 1, populationKnown: true },
  "SPEC-002": { fixture: "B-mismatch", cohort: "Mismatch", records: ["Mismatch"], counts: { Verified: 0, Mismatch: 1, Pending: 0, Unverified: 0 }, expectedTotal: 1, populationKnown: true },
  "SPEC-003": { fixture: "C-pending", cohort: "Pending", records: ["Pending"], counts: { Verified: 0, Mismatch: 0, Pending: 1, Unverified: 0 }, expectedTotal: 1, populationKnown: true },
  "SPEC-004": { fixture: "D-unverified", cohort: "Unverified", records: ["Unverified"], counts: { Verified: 0, Mismatch: 0, Pending: 0, Unverified: 1 }, expectedTotal: 1, populationKnown: true },
  "SPEC-005": {
    fixture: "E-row-verified-cohort-unverified",
    cohort: "Unverified",
    records: Array<string>(12).fill("Verified"),
    counts: { Verified: 12, Mismatch: 0, Pending: 0, Unverified: 0 },
    expectedTotal: null,
    populationKnown: false,
  },
} as const;
export type CaseId = keyof typeof EXPECTED;
export const CASES = Object.keys(EXPECTED) as CaseId[];

/** The evaluator's own result for a case, from the handoff's direct-execution trace (read-only). */
export function evaluatorComputed(id: CaseId): unknown {
  return JSON.parse(readFileSync(join(HANDOFF, `evidence/evaluator/${id}.json`), "utf8")).computed_result;
}

export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

export function writeEvidence(name: string, data: unknown) {
  const file = join(EVIDENCE_DIR, `${name}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/* ---------- Process custody ---------- */

export interface ServiceProcess {
  child: ChildProcess;
  pid: number;
  startedAt: string;
  log: string[];
}

const listener = () => {
  try {
    return execFileSync("lsof", ["-nP", "-iTCP:8765", "-sTCP:LISTEN"], { encoding: "utf8" });
  } catch {
    return "";
  }
};

async function until(fn: () => Promise<boolean> | boolean, ms: number, what: string) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Every start/stop, appended in order, for the custody record. */
export const custody: Record<string, unknown>[] = [];

export async function startService(label: string): Promise<ServiceProcess> {
  if (listener()) throw new Error("port 8765 already has a listener; refusing to start or kill an unknown process");
  const log: string[] = [];
  const child = spawn(join(UI, "scripts/phase2/local-service.sh"), [], { cwd: UI, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (d) => log.push(String(d)));
  child.stderr!.on("data", (d) => log.push(String(d)));
  await until(
    async () => {
      if (child.exitCode !== null) throw new Error(`service exited ${child.exitCode}: ${log.join("")}`);
      try {
        await fetch(`${SERVICE_ORIGIN}/api/v1/verifications/SPEC-001`);
        return true;
      } catch {
        return false;
      }
    },
    20_000,
    "the local service to listen",
  );
  const proc = { child, pid: child.pid!, startedAt: new Date().toISOString(), log };
  custody.push({ event: "start", label, pid: proc.pid, at: proc.startedAt, lsof: listener().trim() });
  return proc;
}

export async function stopService(proc: ServiceProcess, label: string) {
  if (proc.child.exitCode === null) {
    process.kill(proc.pid, "SIGTERM"); // the owned PID only
    await until(() => proc.child.exitCode !== null || proc.child.signalCode !== null, 10_000, "the service to exit");
  }
  await until(() => listener() === "", 10_000, "port 8765 to close");
  custody.push({ event: "stop", label, pid: proc.pid, exit: proc.child.exitCode, signal: proc.child.signalCode, at: new Date().toISOString(), listenerAfter: listener() });
}

/** Run `fn` with the runtime key temporarily group/world-readable, which the Service refuses with 503 (as in the handoff's process C). */
export async function withUnusableKey<T>(fn: () => Promise<T>): Promise<T> {
  const before = statSync(KEY_FILE).mode & 0o777;
  chmodSync(KEY_FILE, 0o644);
  try {
    return await fn();
  } finally {
    chmodSync(KEY_FILE, before);
    custody.push({ event: "key-mode-restored", mode: (statSync(KEY_FILE).mode & 0o777).toString(8) });
  }
}

/** A direct read of the Service, bypassing the browser and the proxy. */
export async function direct(pathAndQuery: string): Promise<{ status: number; text: string; headers: Record<string, string> }> {
  const res = await fetch(`${SERVICE_ORIGIN}${pathAndQuery}`);
  return { status: res.status, text: await res.text(), headers: Object.fromEntries(res.headers.entries()) };
}

/* ---------- Network capture ---------- */

export interface Exchange {
  url: string;
  pathAndQuery: string;
  host: string;
  method: string;
  status: number | null;
  failure: string | null;
  server: string | null;
  contentType: string | null;
  bodySha256: string | null;
  body: string | null;
}

export function captureNetwork(page: Page) {
  const all: Exchange[] = [];
  const hosts = new Set<string>();
  // FIX02: every read is tracked to completion; see e2e/capture-lifecycle.ts.
  const capture = captureLifecycle(page);
  page.on("request", (r) => hosts.add(new URL(r.url()).host));
  page.on("response", (res: Response) => {
    const u = new URL(res.url());
    if (!u.pathname.startsWith("/api/")) return;
    capture.track(
      res.url(),
      (async () => {
        let body: string | null = null;
        try {
          body = (await res.body()).toString("utf8");
        } catch {
          body = null;
        }
        const h = await res.allHeaders();
        all.push({
          url: res.url(),
          pathAndQuery: u.pathname + u.search,
          host: u.host,
          method: res.request().method(),
          status: res.status(),
          failure: null,
          server: h["server"] ?? null,
          contentType: h["content-type"] ?? null,
          bodySha256: body === null ? null : sha256(body),
          body,
        });
      })(),
    );
  });
  page.on("requestfailed", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/"))
      all.push({ url: r.url(), pathAndQuery: u.pathname + u.search, host: u.host, method: r.method(), status: null, failure: r.failure()?.errorText ?? "failed", server: null, contentType: null, bodySha256: null, body: null });
  });
  return {
    all,
    hosts,
    settle: capture.settle,
    interrupted: capture.interrupted,
    api: () => all.filter((x) => x.status !== null),
    /** Exchanges without bodies, for evidence files (bodies are summarised by digest). */
    summary: () => all.map(({ body: _b, ...rest }) => rest),
  };
}
