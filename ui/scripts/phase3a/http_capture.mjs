/**
 * Genuine HTTP captures for the Phase 3A evidence folder.
 *
 *   npm run build && node scripts/phase3a/http_capture.mjs
 *
 * Owns two processes, each started here and stopped by its own PID: the production build behind the
 * local API gate (`vite preview` on 127.0.0.1:5183) and the isolated Phase 3A history Service
 * (scripts/phase3a/history-service.sh, 127.0.0.1:8765, stopped with SIGINT). For every archive state
 * (ui-main, ui-corrupt, ui-unverifiable, ui-empty) it records exact request targets and full responses
 * (status, headers, body) — through the gate as the browser sees them, and directly from the Service —
 * to docs/phase3a/evidence/http/<state>/NNN-<label>.json. Raw targets are sent with node:http (no client
 * normalization). Refuses to start if either port already has a listener.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";

const UI = process.cwd();
const OUT = join(UI, "docs/phase3a/evidence/http");
const SEED = JSON.parse(readFileSync(join(UI, "docs/phase3a/evidence/seed/states.json"), "utf8"));
const sha = (s) => createHash("sha256").update(s).digest("hex");
const listening = (port) => {
  try {
    return execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  } catch {
    return "";
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function raw(port, target, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: target, headers: { host: `127.0.0.1:${port}`, ...headers }, agent: false });
    req.on("response", (res) => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on("error", reject);
    req.end();
  });
}

const custody = [];
function start(label, cmd, args, env = {}) {
  const child = spawn(cmd, args, { cwd: UI, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  custody.push({ event: "start", label, pid: child.pid, at: new Date().toISOString() });
  return { child, log, label };
}
async function stop(p, signal) {
  if (p.child.exitCode === null && p.child.signalCode === null) {
    process.kill(p.child.pid, signal);
    await until(() => p.child.exitCode !== null || p.child.signalCode !== null, 15000, `${p.label} to exit`);
  }
  custody.push({ event: "stop", label: p.label, pid: p.child.pid, signal, exit: p.child.exitCode, at: new Date().toISOString() });
}

let n = 0;
async function capture(state, label, port, target, opts = {}) {
  const r = await raw(port, target, opts);
  n += 1;
  let body;
  try {
    body = JSON.parse(r.body);
  } catch {
    body = r.body.length > 600 ? `${r.body.slice(0, 600)}…(${r.body.length} chars)` : r.body;
  }
  const rec = {
    label,
    via: port === 5183 ? "gate (vite preview 127.0.0.1:5183)" : "direct (Service 127.0.0.1:8765)",
    request: { method: opts.method ?? "GET", target, headers: { host: `127.0.0.1:${port}`, ...opts.headers } },
    response: { status: r.status, headers: r.headers, body_sha256: sha(r.body), body },
    captured_at: new Date().toISOString(),
  };
  const dir = join(OUT, state);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${String(n).padStart(3, "0")}-${label}.json`), JSON.stringify(rec, null, 2) + "\n");
  return r;
}

if (listening(5183) || listening(8765)) throw new Error("5183 or 8765 already has a listener; refusing to start");
const preview = start("vite preview", process.execPath, [join(UI, "node_modules/vite/bin/vite.js"), "preview", "--port", "5183", "--strictPort"]);
await until(async () => (await raw(5183, "/").catch(() => null))?.status === 200, 30000, "preview");

try {
  for (const state of ["ui-main", "ui-corrupt", "ui-unverifiable", "ui-empty"]) {
    n = 0;
    const svc = start(`history service ${state}`, join(UI, "scripts/phase3a/history-service.sh"), [], { FA_HISTORY_STATE: state });
    await until(async () => (await raw(8765, "/api/v1/verifications/SPEC-001").catch(() => null))?.status === 200, 30000, "service");
    try {
      if (state === "ui-main") {
        const first = SEED["ui-main"].initial;
        const p1 = JSON.parse((await capture(state, "list-page1-gate", 5183, "/api/v1/history?limit=4")).body);
        await capture(state, "list-page1-direct", 8765, "/api/v1/history?limit=4");
        const p2 = JSON.parse((await capture(state, "list-page2-gate", 5183, `/api/v1/history?limit=4&cursor=${encodeURIComponent(p1.page.next_cursor)}`)).body);
        await capture(state, "list-page3-gate", 5183, `/api/v1/history?limit=4&cursor=${encodeURIComponent(p2.page.next_cursor)}`);
        await capture(state, "list-filter-SPEC-005-gate", 5183, "/api/v1/history?limit=4&verification_id=SPEC-005");
        for (const [i, id] of ["SPEC-001", "SPEC-002", "SPEC-003", "SPEC-004", "SPEC-005"].entries()) {
          const d = JSON.parse((await capture(state, `${id}-detail-gate`, 5183, `/api/v1/history/${first[i]}`)).body);
          if (id === "SPEC-005") await capture(state, `${id}-detail-direct`, 8765, `/api/v1/history/${first[i]}`);
          const e1 = JSON.parse((await capture(state, `${id}-evidence-page1-gate`, 5183, `/api/v1/history/${first[i]}/evidence?snapshot_id=${d.snapshot_id}&limit=2&include_payload=true`)).body);
          await capture(state, `${id}-evidence-page2-gate`, 5183, `/api/v1/history/${first[i]}/evidence?snapshot_id=${d.snapshot_id}&limit=2&include_payload=true&cursor=${encodeURIComponent(e1.page.next_cursor)}`);
        }
        const d1 = JSON.parse((await raw(8765, `/api/v1/history/${first[0]}`)).body);
        await capture(state, "evidence-payload-omitted-gate", 5183, `/api/v1/history/${first[0]}/evidence?snapshot_id=${d1.snapshot_id}&limit=2&include_payload=false`);
        const d2 = JSON.parse((await raw(8765, `/api/v1/history/${first[1]}`)).body);
        const foreign = JSON.parse((await raw(8765, `/api/v1/history/${first[1]}/evidence?snapshot_id=${d2.snapshot_id}&limit=2&include_payload=true`)).body).page.next_cursor;
        await capture(state, "error-cross-history-cursor-gate", 5183, `/api/v1/history/${first[0]}/evidence?snapshot_id=${d1.snapshot_id}&limit=2&include_payload=true&cursor=${encodeURIComponent(foreign)}`);
        await capture(state, "error-tampered-cursor-gate", 5183, `/api/v1/history?limit=4&cursor=${encodeURIComponent(`A${p1.page.next_cursor.slice(1)}`)}`);
        await capture(state, "error-snapshot-conflict-gate", 5183, `/api/v1/history/${first[0]}?snapshot_id=history-snapshot_other`);
        await capture(state, "error-not-found-gate", 5183, `/api/v1/history/hist_${"0".repeat(64)}`);
        await capture(state, "error-invalid-history-id-direct", 8765, "/api/v1/history/%2e%2e");
        await capture(state, "error-invalid-parameter-gate", 5183, "/api/v1/history?limit=0");
        await capture(state, "error-origin-not-allowed-direct", 8765, "/api/v1/history?limit=1", { headers: { origin: "http://evil.example" } });
        await capture(state, "error-method-not-allowed-direct", 8765, "/api/v1/history", { method: "POST" });
        await capture(state, "gate-refused-post", 5183, "/api/v1/history", { method: "POST" });
        await capture(state, "gate-refused-dot-segments", 5183, "/api/v1/../../docs");
        await capture(state, "gate-refused-encoded-dots", 5183, "/api/v1/%2e%2e/%2e%2e/openapi.json");
        await capture(state, "gate-refused-adjacent-prefix", 5183, "/api/v1x");
        await capture(state, "gate-refused-host", 5183, "/api/v1/history?limit=1", { headers: { host: "evil.example" } });
        await capture(state, "phase2-ephemeral-detail-gate", 5183, "/api/v1/verifications/SPEC-005");
      } else if (state === "ui-corrupt") {
        const bad = SEED["ui-corrupt"].damage.history_id;
        await capture(state, "corrupt-detail-503-gate", 5183, `/api/v1/history/${bad}`);
        await capture(state, "corrupt-evidence-payload-omitted-503-gate", 5183, `/api/v1/history/${bad}/evidence?include_payload=false`);
        await capture(state, "corrupt-list-503-gate", 5183, "/api/v1/history?limit=4");
        await capture(state, "intact-entry-200-gate", 5183, `/api/v1/history/${SEED["ui-corrupt"].history_ids[0]}`);
      } else if (state === "ui-unverifiable") {
        const bad = SEED["ui-unverifiable"].damage.history_id;
        await capture(state, "unverifiable-detail-503-gate", 5183, `/api/v1/history/${bad}`);
        await capture(state, "unverifiable-list-503-gate", 5183, "/api/v1/history?limit=4");
      } else {
        await capture(state, "empty-list-gate", 5183, "/api/v1/history");
      }
    } finally {
      await stop(svc, "SIGINT");
      await until(() => listening(8765) === "", 10000, "8765 to close");
    }
  }
} finally {
  await stop(preview, "SIGTERM");
  await until(() => listening(5183) === "", 10000, "5183 to close");
  writeFileSync(join(OUT, "custody.json"), JSON.stringify({ custody, listeners_after: { 5183: listening(5183), 8765: listening(8765) } }, null, 2) + "\n");
}
console.log("captured →", OUT);
