/**
 * TEST DOUBLE of the local Service's documented HTTP behaviour, for unit and component tests only.
 *
 * Bodies are the real responses captured by the Codex handoff (FlowAssert-Phase2-Support/evidence/http,
 * read-only), vendored in fixtures/phase2-handoff/http (FLOWASSERT_HANDOFF_HTTP overrides) and identity-checked
 * against the handoff manifest (fixture-identity.test.ts). Pagination, snapshot and cursor rules follow
 * FROZEN_API_HANDOFF.md. Cursors here are fake and unsigned — the real HMAC cursors, restarts and 409s are
 * exercised against the real Service by the browser E2E suite (e2e-local/). Nothing in the app imports this file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requiredFixture } from "../fixtures/sources";

/** Resolved on first read: a missing copy fails every test that reads a body — explicitly, never as a skip. */
export const handoffHttp = () => requiredFixture("FLOWASSERT_HANDOFF_HTTP", "ui/src/test/fixtures/phase2-handoff/http");

export const CASE_IDS = ["SPEC-001", "SPEC-002", "SPEC-003", "SPEC-004", "SPEC-005"] as const;

/** A captured body, parsed fresh each call so a test can mutate its copy freely. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function captured(name: string): any {
  return JSON.parse(readFileSync(join(handoffHttp(), `${name}.json`), "utf8"));
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const envelope = (code: string, status: number) =>
  json({ error: { code, message: "Offline request could not be completed.", request_id: `req-${code}-${status}`, retryable: status === 503, details: [] } }, status);

interface Cursor {
  s: string;
  l: number;
  p: boolean;
  o: number;
  r: string;
}
const enc = (c: Cursor) => btoa(JSON.stringify(c));
function dec(t: string): Cursor | null {
  try {
    const c = JSON.parse(atob(t)) as Cursor;
    return typeof c.o === "number" ? c : null;
  } catch {
    return null;
  }
}

export interface FakeService {
  fetch: typeof fetch;
  /** Every URL requested, in order (path + query, as sent). */
  log: string[];
  snapshot: () => string;
  /** Simulate a service restart: a new catalog snapshot; old cursors and snapshot IDs become 409. */
  restart: () => void;
  /** Answer the next matching request with this instead (once). */
  intercept: (match: (url: URL) => boolean, respond: (url: URL) => Response | Promise<Response>) => void;
}

export function fakeService(): FakeService {
  let generation = 1;
  const snap = () => `snapshot-fake-${generation}`;
  const log: string[] = [];
  const intercepts: { match: (u: URL) => boolean; respond: (u: URL) => Response | Promise<Response> }[] = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "http://127.0.0.1:4183");
    log.push(url.pathname + url.search);
    if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const i = intercepts.findIndex((x) => x.match(url));
    if (i >= 0) return intercepts.splice(i, 1)[0]!.respond(url);

    const m = url.pathname.match(/^\/api\/v1\/verifications\/([^/]+)(\/evidence)?$/);
    if (!m) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    const id = decodeURIComponent(m[1]!);
    if (!(CASE_IDS as readonly string[]).includes(id)) return envelope("run_not_found", 404);
    const q = url.searchParams;
    const pinned = q.get("snapshot_id");
    if (!m[2]) {
      if (pinned !== null && pinned !== snap()) return envelope("snapshot_unavailable", 409);
      const body = captured(`${id}-detail`);
      body.snapshot_id = snap();
      return json(body);
    }
    const limit = Number(q.get("limit") ?? "25");
    const include = (q.get("include_payload") ?? "true") === "true";
    const cursor = q.get("cursor");
    let offset = 0;
    if (cursor !== null) {
      const c = dec(cursor);
      if (!c) return envelope("invalid_cursor", 400);
      if (c.l !== limit || c.p !== include || c.r !== id) return envelope("cursor_query_conflict", 400);
      if (c.s !== snap()) return envelope(pinned !== null && pinned !== c.s ? "snapshot_conflict" : "snapshot_unavailable", 409);
      offset = c.o;
    }
    if (pinned !== null && pinned !== snap()) return envelope("snapshot_unavailable", 409);
    const full = captured(`${id}-evidence`);
    const items = full.items.slice(offset, offset + limit).map((it: { payload: unknown; payload_reason: string | null; reference: { availability: string } }) =>
      include || it.reference.availability !== "available" ? it : { ...it, payload: null, payload_reason: "omitted_by_request" },
    );
    const next = offset + limit < full.items.length ? enc({ s: snap(), l: limit, p: include, o: offset + limit, r: id }) : null;
    return json({ meta: full.meta, run_id: id, items, page: { snapshot_id: snap(), next_cursor: next, total: full.items.length } });
  }) as typeof fetch;

  return {
    fetch: fetchImpl,
    log,
    snapshot: snap,
    restart: () => void generation++,
    intercept: (match, respond) => void intercepts.push({ match, respond }),
  };
}
