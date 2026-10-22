/**
 * Phase 3A real-service E2E support: process custody for the isolated SQLite-backed history Service,
 * archive-state selection, direct (non-browser) reads for comparison, network capture and evidence files.
 *
 * The Service is the exact-source isolated copy in .phase3a-runtime/ (scripts/phase3a/prepare_runtime.py),
 * with archives created only by the reviewed seed pipeline (scripts/phase3a/seed_states.py), launched only
 * through scripts/phase3a/history-service.sh, which fixes 127.0.0.1:8765. Each process is owned by this
 * suite, recorded with its PID, and stopped with SIGINT (Ctrl-C, as the handoff says) to that PID only —
 * which lets the backend's own socket audit (scripts/guarded_entry.py) write its outbound-connection record.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page, Response } from "@playwright/test";

export const UI = process.cwd();
export const SERVICE_ORIGIN = "http://127.0.0.1:8765";
export const APP_HOST = "127.0.0.1:5183";
export const RUNTIME = join(UI, ".phase3a-runtime/FlowAssert-Phase3A-Service");
export const EVIDENCE_DIR = process.env.FA_HISTORY_EVIDENCE_DIR ?? join(UI, "docs/phase3a/evidence/e2e");

export type ArchiveState = "ui-main" | "ui-empty" | "ui-corrupt" | "ui-unverifiable";

/**
 * Expected outcomes fixed independently of the UI under test — the backend handoff's case table and
 * FlowAssert-Phase2-Support/SYNTHETIC_CASES.md. Never derived from rendered output.
 */
export const EXPECTED = {
  "SPEC-001": { cohort: "Verified", records: ["Verified"], counts: { Verified: 1, Mismatch: 0, Pending: 0, Unverified: 0 }, expectedTotal: 1, populationKnown: true },
  "SPEC-002": { cohort: "Mismatch", records: ["Mismatch"], counts: { Verified: 0, Mismatch: 1, Pending: 0, Unverified: 0 }, expectedTotal: 1, populationKnown: true },
  "SPEC-003": { cohort: "Pending", records: ["Pending"], counts: { Verified: 0, Mismatch: 0, Pending: 1, Unverified: 0 }, expectedTotal: 1, populationKnown: true },
  "SPEC-004": { cohort: "Unverified", records: ["Unverified"], counts: { Verified: 0, Mismatch: 0, Pending: 0, Unverified: 1 }, expectedTotal: 1, populationKnown: true },
  "SPEC-005": {
    cohort: "Unverified",
    records: Array<string>(12).fill("Verified"),
    counts: { Verified: 12, Mismatch: 0, Pending: 0, Unverified: 0 },
    expectedTotal: null,
    populationKnown: false,
  },
} as const;
export type CaseId = keyof typeof EXPECTED;
export const CASES = Object.keys(EXPECTED) as CaseId[];

/** Archive identities as the seed pipeline reported them (identities only — no verdict is read from here). */
interface SeedStates {
  "ui-main": { initial: string[]; reevaluated: string[] };
  "ui-corrupt": { history_ids: string[]; damage: { history_id: string; reference_id: string } };
  "ui-unverifiable": { history_ids: string[]; damage: { history_id: string; reference_id: string } };
}
export const SEED: SeedStates = JSON.parse(readFileSync(join(UI, "docs/phase3a/evidence/seed/states.json"), "utf8"));
/** First seeded batch, by case. */
export const FIRST: Record<CaseId, string> = Object.fromEntries(CASES.map((c, i) => [c, SEED["ui-main"].initial[i]!])) as Record<CaseId, string>;

/** The pinned evaluator's own output for a case (scripts/phase3a/evaluator_oracle.py, run directly). */
export function evaluatorComputed(id: CaseId): unknown {
  return JSON.parse(readFileSync(join(UI, `docs/phase3a/evidence/evaluator/${id}.json`), "utf8")).computed_result;
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
  state: ArchiveState;
  startedAt: string;
  log: string[];
}

export const listener = () => {
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

export const custody: Record<string, unknown>[] = [];

export async function startService(label: string, state: ArchiveState = "ui-main"): Promise<ServiceProcess> {
  if (listener()) throw new Error("port 8765 already has a listener; refusing to start or kill an unknown process");
  const log: string[] = [];
  const child = spawn(join(UI, "scripts/phase3a/history-service.sh"), [], { cwd: UI, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FA_HISTORY_STATE: state } });
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
    30_000,
    "the local history service to listen",
  );
  const proc = { child, pid: child.pid!, state, startedAt: new Date().toISOString(), log };
  custody.push({ event: "start", label, state, pid: proc.pid, at: proc.startedAt, lsof: listener().trim() });
  return proc;
}

export async function stopService(proc: ServiceProcess, label: string) {
  if (proc.child.exitCode === null && proc.child.signalCode === null) {
    process.kill(proc.pid, "SIGINT"); // the owned PID only; Ctrl-C lets the socket audit be written
    await until(() => proc.child.exitCode !== null || proc.child.signalCode !== null, 15_000, "the service to exit");
  }
  await until(() => listener() === "", 10_000, "port 8765 to close");
  custody.push({ event: "stop", label, state: proc.state, pid: proc.pid, exit: proc.child.exitCode, signal: proc.child.signalCode, at: new Date().toISOString(), listenerAfter: listener() });
}

/** Every socket-audit record the backend's guarded entry wrote for services started since `since` (ms). */
export function socketAudits(since: number): { file: string; connects: unknown[]; unauthorized: unknown[] }[] {
  const dir = join(RUNTIME, ".runtime/net");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("service-") && statSync(join(dir, f)).mtimeMs >= since)
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(dir, f), "utf8")) }));
}

/** A direct read of the Service, bypassing the browser and the gate. */
export async function direct(pathAndQuery: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string; headers: Record<string, string> }> {
  const res = await fetch(`${SERVICE_ORIGIN}${pathAndQuery}`, { headers });
  return { status: res.status, text: await res.text(), headers: Object.fromEntries(res.headers.entries()) };
}

/**
 * A raw request with the exact target bytes (like `curl --path-as-is`): no URL parsing or dot-segment
 * resolution happens on this side, unlike fetch/WHATWG URL. For probing the Service and the gate as a
 * non-browser client would.
 */
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

/* ---------- Network capture ---------- */

export interface Exchange {
  url: string;
  pathAndQuery: string;
  host: string;
  method: string;
  status: number | null;
  failure: string | null;
  server: string | null;
  gate: string | null;
  contentType: string | null;
  bodySha256: string | null;
  body: string | null;
  requestHeaders: Record<string, string>;
}

export function captureNetwork(page: Page) {
  const all: Exchange[] = [];
  const hosts = new Set<string>();
  const pending: Promise<void>[] = [];
  page.on("request", (r) => hosts.add(new URL(r.url()).host));
  page.on("response", (res: Response) => {
    const u = new URL(res.url());
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
        const rq = await res.request().allHeaders();
        all.push({
          url: res.url(),
          pathAndQuery: u.pathname + u.search,
          host: u.host,
          method: res.request().method(),
          status: res.status(),
          failure: null,
          server: h["server"] ?? null,
          gate: h["x-flowassert-gate"] ?? null,
          contentType: h["content-type"] ?? null,
          bodySha256: body === null ? null : sha256(body),
          body,
          requestHeaders: { origin: rq["origin"] ?? "", cookie: rq["cookie"] ?? "", referer: rq["referer"] ?? "" },
        });
      })(),
    );
  });
  page.on("requestfailed", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/"))
      all.push({ url: r.url(), pathAndQuery: u.pathname + u.search, host: u.host, method: r.method(), status: null, failure: r.failure()?.errorText ?? "failed", server: null, gate: null, contentType: null, bodySha256: null, body: null, requestHeaders: {} });
  });
  return {
    all,
    hosts,
    settle: () => Promise.all(pending),
    api: () => all.filter((x) => x.status !== null),
    summary: () => all.map(({ body: _b, ...rest }) => rest),
  };
}

/** The only origin the browser may contact is the app itself. */
export const onlyAppOrigin = (hosts: Set<string>) => [...hosts].filter((h) => h !== "");
