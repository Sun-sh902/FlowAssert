/**
 * TEST DOUBLE of the Phase 3A history routes, for unit and component tests only.
 *
 * Bodies are the real responses the Phase 3A backend captured over HTTP and schema-validated
 * (FlowAssert-Phase3A-Service/contracts/history-examples.json, read-only): the 10-entry list
 * "021-list-after-insert" (two genuine evaluation batches), and the five first-batch Details and full
 * evidence pages. Pagination, filter, snapshot pin and payload omission follow the handoff; cursors
 * here are fake and unsigned — the real HMAC cursors, restarts and SQLite archive are exercised against
 * the real Service by e2e-history/. Nothing in the app imports this file.
 * As in the Service, the list and Detail exist twice: /api/v1/history/verifications… adds the Phase 3B fields, and
 * /api/v1/history… is the frozen shape. A `phase3b` query key is refused on all of them.
 */
import { readFileSync } from "node:fs";
import { requiredFixture } from "../fixtures/sources";
import { LEGACY_ADMISSION } from "./fakeService";

/** The Service's own copy (service/contracts, in the accepted backend source map); FLOWASSERT_HISTORY_EXAMPLES overrides. */
export const HISTORY_EXAMPLES = requiredFixture("FLOWASSERT_HISTORY_EXAMPLES", "service/contracts/history-examples.json");

interface Example {
  name: string;
  request: { method: string; path: string };
  http_status: number;
  schema: string;
  response: unknown;
}

const examples: Example[] = (JSON.parse(readFileSync(HISTORY_EXAMPLES, "utf8")) as { examples: Example[] }).examples;

/** A captured response body, parsed fresh each call so a test can mutate its copy freely. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function example(name: string): any {
  const e = examples.find((x) => x.name === name);
  if (!e) throw new Error(`no captured example ${name}`);
  return JSON.parse(JSON.stringify(e.response));
}

export const DETAIL_EXAMPLES = ["002-SPEC-001-history-detail", "005-SPEC-002-history-detail", "008-SPEC-003-history-detail", "011-SPEC-004-history-detail", "014-SPEC-005-history-detail"] as const;
export const EVIDENCE_EXAMPLES = ["003-SPEC-001-history-evidence", "006-SPEC-002-history-evidence", "009-SPEC-003-history-evidence", "012-SPEC-004-history-evidence", "015-SPEC-005-history-evidence"] as const;

/** The first-batch history IDs, by case, read from the captured Details (handoff table). */
export const FIRST_BATCH: Record<string, string> = Object.fromEntries(DETAIL_EXAMPLES.map((n) => [example(n).original_verification_id, example(n).history_id]));

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const historyEnvelope = (code: string, status: number, details: { path: string; code: string }[] = []) =>
  json({ error: { code, message: "Historical request could not be completed.", request_id: `req-${code}-${status}`, retryable: status === 503, details } }, status);

const enc = (c: object) => btoa(JSON.stringify(c));
function dec<T>(t: string): T | null {
  try {
    return JSON.parse(atob(t)) as T;
  } catch {
    return null;
  }
}

export interface FakeHistoryService {
  fetch: typeof fetch;
  /** Every URL requested, in order (path + query, as sent). */
  log: string[];
  /** The archive's entries, newest first, as the Service would list them. */
  entries: () => { history_id: string; original_verification_id: string }[];
  /** Answer the next matching request with this instead (once). */
  intercept: (match: (url: URL) => boolean, respond: (url: URL) => Response | Promise<Response>) => void;
  /** Replace the archive with an empty one (init only). */
  empty: () => void;
}

export function fakeHistoryService(): FakeHistoryService {
  let list = example("021-list-after-insert").items;
  const details = new Map<string, unknown>(DETAIL_EXAMPLES.map((n) => [example(n).history_id, example(n)]));
  const evidence = new Map<string, { items: unknown[] }>(EVIDENCE_EXAMPLES.map((n) => [example(n).history_id, example(n)]));
  const log: string[] = [];
  const intercepts: { match: (u: URL) => boolean; respond: (u: URL) => Response | Promise<Response> }[] = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "http://127.0.0.1:5183");
    log.push(url.pathname + url.search);
    if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const i = intercepts.findIndex((x) => x.match(url));
    if (i >= 0) return intercepts.splice(i, 1)[0]!.respond(url);
    const q = url.searchParams;
    if (q.has("phase3b")) return historyEnvelope("invalid_query", 400);
    const extended = url.pathname.startsWith("/api/v1/history/verifications");
    const path = extended ? url.pathname.replace("/history/verifications", "/history") : url.pathname;

    if (path === "/api/v1/history") {
      const limit = Number(q.get("limit") ?? "25");
      const filter = q.get("verification_id");
      const scoped = list.filter((x: { original_verification_id: string }) => filter === null || x.original_verification_id === filter);
      let offset = 0;
      const cursor = q.get("cursor");
      if (cursor !== null) {
        const c = dec<{ o: number; l: number; v: string | null }>(cursor);
        if (!c || typeof c.o !== "number") return historyEnvelope("invalid_cursor", 400);
        if (c.l !== limit || c.v !== filter) return historyEnvelope("cursor_query_conflict", 400);
        offset = c.o;
      }
      const items = scoped.slice(offset, offset + limit).map((x: object) => (extended ? { ...x, ...LEGACY_ADMISSION } : x));
      const next = offset + limit < scoped.length ? enc({ o: offset + limit, l: limit, v: filter }) : null;
      return json({ contract_version: "phase3a-1.0.0", workspace_id: "ws-synthetic-01", items, page: { snapshot_id: `list_fake_${filter ?? "all"}_${limit}`, next_cursor: next, total: scoped.length } });
    }
    const m = path.match(/^\/api\/v1\/history\/([^/]+)(\/evidence)?$/);
    if (!m) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    const id = decodeURIComponent(m[1]!);
    if (!/^hist_[a-f0-9]{64}$/.test(id)) return historyEnvelope("invalid_history_id", 422);
    const detail = details.get(id) as { snapshot_id: string } | undefined;
    if (!detail) return historyEnvelope("history_not_found", 404);
    const pinned = q.get("snapshot_id");
    if (!m[2]) {
      if (pinned !== null && pinned !== detail.snapshot_id) return historyEnvelope("history_snapshot_conflict", 409);
      return json({ ...(JSON.parse(JSON.stringify(detail)) as object), ...(extended ? LEGACY_ADMISSION : {}) });
    }
    const full = JSON.parse(JSON.stringify(evidence.get(id))) as { items: { payload: unknown; payload_reason: string | null; reference: { availability: string } }[]; page: unknown };
    const limit = Number(q.get("limit") ?? "25");
    const include = (q.get("include_payload") ?? "true") === "true";
    let offset = 0;
    const cursor = q.get("cursor");
    if (cursor !== null) {
      const c = dec<{ h: string; o: number; l: number; p: boolean; s: string }>(cursor);
      if (!c || typeof c.o !== "number") return historyEnvelope("invalid_cursor", 400);
      if (c.h !== id || c.l !== limit || c.p !== include) return historyEnvelope("cursor_query_conflict", 400);
      if (pinned !== null && pinned !== c.s) return historyEnvelope("history_snapshot_conflict", 409);
      offset = c.o;
    }
    if (pinned !== null && pinned !== detail.snapshot_id) return historyEnvelope("history_snapshot_conflict", 409);
    const items = full.items
      .slice(offset, offset + limit)
      .map((it) => (include || it.reference.availability !== "available" ? it : { ...it, payload: null, payload_reason: "omitted_by_request" }));
    const next = offset + limit < full.items.length ? enc({ h: id, o: offset + limit, l: limit, p: include, s: detail.snapshot_id }) : null;
    return json({ ...full, items, page: { snapshot_id: detail.snapshot_id, next_cursor: next, total: full.items.length } });
  }) as typeof fetch;

  return {
    fetch: fetchImpl,
    log,
    entries: () => list,
    intercept: (match, respond) => void intercepts.push({ match, respond }),
    empty: () => void (list = []),
  };
}
