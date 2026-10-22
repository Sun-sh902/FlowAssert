/**
 * ID-addressability remediation-03 real-service E2E support: custody of the isolated Service process (the
 * backend's own test-only alias launcher, scripts/phase3a/lookup-alias-service.sh), its receipts, raw HTTP probes,
 * browser network capture and evidence files.
 *
 * Expected verdicts are fixed independently of the UI: an alias's basis case (from the backend-written
 * alias-manifest.json) and the case table of FlowAssert-Phase2-Support/SYNTHETIC_CASES.md.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page, Response } from "@playwright/test";

export const UI = process.cwd();
export const SERVICE_PORT = 8765;
export const APP_PORT = 5183;
export const EVIDENCE_DIR = process.env.FA_LOOKUP_EVIDENCE_DIR ?? join(UI, "docs/phase3a/id-addressability-remediation-03/evidence/e2e");

export const EXPECTED = {
  "SPEC-001": { cohort: "Verified", records: ["Verified"], populationKnown: true },
  "SPEC-002": { cohort: "Mismatch", records: ["Mismatch"], populationKnown: true },
  "SPEC-003": { cohort: "Pending", records: ["Pending"], populationKnown: true },
  "SPEC-004": { cohort: "Unverified", records: ["Unverified"], populationKnown: true },
  "SPEC-005": { cohort: "Unverified", records: Array<string>(12).fill("Verified"), populationKnown: false },
} as const;
export type CaseId = keyof typeof EXPECTED;

export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
export const utf8Hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
export const codePoints = (s: string) => [...s].length;

export function writeEvidence(name: string, data: unknown) {
  const file = join(EVIDENCE_DIR, `${name}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/* ---------- Process custody ---------- */

export const listener = (port = SERVICE_PORT) => {
  try {
    return execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
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

export interface ServiceProcess {
  child: ChildProcess;
  pid: number;
  out: string;
  label: string;
  log: string[];
}

export const custody: Record<string, unknown>[] = [];

/** Start the alias Service; receipts go to EVIDENCE_DIR/backend/<label>. Refuses to touch a foreign listener. */
export async function startService(label: string): Promise<ServiceProcess> {
  if (listener()) throw new Error("port 8765 already has a listener; refusing to start or kill an unknown process");
  const out = join(EVIDENCE_DIR, "backend", label);
  mkdirSync(out, { recursive: true });
  const log: string[] = [];
  const child = spawn(join(UI, "scripts/phase3a/lookup-alias-service.sh"), [], { cwd: UI, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FA_LOOKUP_BACKEND_OUT: out } });
  child.stdout!.on("data", (d) => log.push(String(d)));
  child.stderr!.on("data", (d) => log.push(String(d)));
  await until(
    async () => {
      if (child.exitCode !== null) throw new Error(`service exited ${child.exitCode}: ${log.join("")}`);
      try {
        return (await rawRequest(SERVICE_PORT, "/id-addressability-openapi.json")).status === 200;
      } catch {
        return false;
      }
    },
    30_000,
    "the local Service to listen",
  );
  const proc = { child, pid: child.pid!, out, label, log };
  custody.push({ event: "start", label, pid: proc.pid, at: new Date().toISOString(), lsof: listener().trim() });
  return proc;
}

export async function stopService(proc: ServiceProcess) {
  if (proc.child.exitCode === null && proc.child.signalCode === null) {
    process.kill(proc.pid, "SIGINT"); // the owned PID only (the launcher exec's Python); Ctrl-C lets its audit be written
    await until(() => proc.child.exitCode !== null || proc.child.signalCode !== null, 15_000, "the Service to exit");
  }
  await until(() => listener() === "", 10_000, "port 8765 to close");
  const auditFile = join(proc.out, "network-audit.json");
  const audit = existsSync(auditFile) ? JSON.parse(readFileSync(auditFile, "utf8")) : null;
  custody.push({ event: "stop", label: proc.label, pid: proc.pid, exit: proc.child.exitCode, signal: proc.child.signalCode, at: new Date().toISOString(), listenerAfter: listener(), networkAudit: audit });
  writeEvidence(`custody/${proc.label}`, custody.filter((c) => c.label === proc.label));
  return audit as { connects: { host: string; port: number }[] } | null;
}

/** Identity aliases the backend registered for this process (backend-written; test-only). */
export function aliasManifest(proc: ServiceProcess): { label: string; identity: string; basis: CaseId; code_points: number; utf8_hex: string }[] {
  return JSON.parse(readFileSync(join(proc.out, "alias-manifest.json"), "utf8")).aliases;
}

const jsonl = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** What the Service's Catalog received (run_id as Python decoded it) and what reached its ASGI app, in order. */
export const catalogReceipts = (p: ServiceProcess): { run_id: string; run_id_utf8_hex: string; snapshot: string | null }[] => jsonl(join(p.out, "catalog-receipts.jsonl"));
export const wireReceipts = (p: ServiceProcess): { raw_path: string; query_string: string; method: string; status: number }[] => jsonl(join(p.out, "server-wire.jsonl"));

/* ---------- Raw HTTP ---------- */

/** Exact target bytes (like curl --path-as-is): no URL parsing, dot-segment resolution or re-encoding here. */
export function rawRequest(
  port: number,
  target: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: opts.method ?? "GET", path: target, headers: { host: `127.0.0.1:${port}`, ...opts.headers }, agent: false });
    req.on("response", (res) => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: b }));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

export function code(body: string): string | null {
  try {
    const j = JSON.parse(body);
    return j.error?.code ?? (j.gate ? `gate:${j.gate.code}` : null);
  } catch {
    return null;
  }
}

/* ---------- Browser network capture ---------- */

export interface Exchange {
  url: string;
  path: string;
  query: string;
  host: string;
  method: string;
  status: number;
  gate: string | null;
  body: string | null;
}

export function captureNetwork(page: Page) {
  const all: Exchange[] = [];
  const hosts = new Set<string>();
  const pending: Promise<void>[] = [];
  page.on("request", (r) => hosts.add(new URL(r.url()).host));
  page.on("response", (res: Response) => {
    const raw = res.url();
    const u = new URL(raw);
    if (!u.pathname.startsWith("/api/")) return;
    pending.push(
      (async () => {
        let body: string | null = null;
        try {
          body = (await res.body()).toString("utf8");
        } catch {
          body = null;
        }
        const h = await res.allHeaders();
        const qi = raw.indexOf("?");
        all.push({ url: raw, path: u.pathname, query: qi === -1 ? "" : raw.slice(qi + 1), host: u.host, method: res.request().method(), status: res.status(), gate: h["x-flowassert-gate"] ?? null, body });
      })(),
    );
  });
  return { all, hosts, settle: () => Promise.all(pending) };
}

/** The app's own page, at a hash, from a blank document (a direct link / typed address). */
export async function openApp(page: Page, hash: string) {
  await page.goto("about:blank");
  await page.goto(`/${hash}`);
  await page.locator("#main").waitFor();
}

export const seal = (page: Page) => page.locator('.fa-seal[data-size="lg"]');
export const indexCells = (page: Page) => page.locator('section[aria-labelledby="index-title"] button.fa-cell');
export const retrieval = (page: Page) => page.locator("[data-retrieval]");
export const integrity = (page: Page) => page.locator("[data-integrity]");
