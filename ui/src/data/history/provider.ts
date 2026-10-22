/**
 * LocalHistoryProvider — Phase 3A LOCAL_RESEARCH archive reads over real HTTP to the local Python
 * Service's SQLite-backed history routes. Exactly the three additive read operations, wire names as
 * in the reviewed additive contract (contracts/openapi-history-v1.yaml):
 *   GET /api/v1/history?limit=…&verification_id=…&cursor=…
 *   GET /api/v1/history/{history_id}?snapshot_id=…
 *   GET /api/v1/history/{history_id}/evidence?snapshot_id=…&limit=…&include_payload=true|false&cursor=…
 * Requests are relative (same origin) and use the accepted Phase 2 transport (exchange: GET only,
 * credentials omitted, redirects refused, bounded time and body). Nothing falls back to MOCK,
 * computes a verdict, retries, caches or polls. Every body is admitted by ./decode.ts first.
 *
 * Outcome → result (docs/phase3a/SNAPSHOT_AND_ERROR_MATRIX.md):
 *   malformed history ID                       → error REQUEST_ERROR invalid_history_id, nothing sent
 *   200 + admitted body                        → ready
 *   200 + refused body                         → error REQUEST_ERROR <decode code> (+ integrity when the refusal is about integrity)
 *   404 history_not_found                      → not_found
 *   409 history_snapshot_conflict              → error STALE_SNAPSHOT
 *   503 + error.details INTEGRITY_*            → error SERVICE_UNAVAILABLE (EVIDENCE_UNAVAILABLE on evidence) + integrity
 *   400 / 403 / 405 / 422 / 500 / other 4xx     → error REQUEST_ERROR with the Service's own code
 *   any status without an Error envelope       → error SERVICE_UNAVAILABLE no_service_envelope (proxy/gate answered)
 *   network failure / timeout                  → error SERVICE_UNAVAILABLE transport_failure | timeout
 *   caller aborts                              → rejects AbortError (no result)
 */
import { toArchivedEvidenceView, toHistoryDetailView, toHistoryListPageView } from "../../adapters/historyToView";
import type { EvidencePageView, EvidenceReferenceView } from "../../domain/evidence";
import type { HistoryDetailView, HistoryListPageView } from "../../domain/history";
import { abortError, type ProviderContext, type ProviderResult } from "../access";
import { HISTORY_CONTRACT_VERSION } from "../contract/history";
import { checkPayloadDigest, losslessAt, losslessParse } from "../local/canonical";
import { LOCAL_LIMITS } from "../local/config";
import { checkHistoryId } from "../local/ids";
import { exchange, failure, parseJson, type Exchange } from "../local/provider";
import type { FlowAssertHistoryProvider, HistoryDetailQuery, HistoryEvidenceQuery, HistoryListQuery } from "../provider";
import { HISTORY_API, HISTORY_SCOPE } from "./config";
import { decodeHistoryDetail, decodeHistoryError, decodeHistoryEvidencePage, decodeHistoryList, integrityFromDetails, type IntegrityOutcome } from "./decode";

export interface HistoryProviderOptions {
  /** Injected for tests; defaults to the browser's fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type Failure = Extract<ProviderResult<never>, { kind: "error" }>;
type Resource = "list" | "detail" | "evidence";

const withStatus = (f: Failure, httpStatus: number | undefined, integrity?: IntegrityOutcome | null): Failure => ({
  ...f,
  ...(httpStatus !== undefined ? { httpStatus } : {}),
  ...(integrity ? { integrity } : {}),
});

/** Every non-success path. Returns null when the exchange is a 200 that the caller must decode. */
function nonSuccess(ex: Exchange, resource: Resource): Failure | { kind: "not_found"; requestId: string | null } | null {
  if (ex.kind === "timeout") return failure("SERVICE_UNAVAILABLE", "timeout", `No response within ${LOCAL_LIMITS.timeoutMs / 1000} s. No archived result was received.`, null, true);
  if (ex.kind === "transport") return failure("SERVICE_UNAVAILABLE", "transport_failure", `The local service could not be reached (${ex.message}).`, null, true);
  if (ex.text.length > LOCAL_LIMITS.maxBodyChars) return withStatus(failure("REQUEST_ERROR", "response_too_large", `Response body exceeds ${LOCAL_LIMITS.maxBodyChars} characters; it was not read.`), ex.status);
  if (ex.status === 200) return null;
  const parsed = ex.contentType.includes("application/json") ? parseJson(ex.text) : { ok: false as const };
  const envelope = parsed.ok ? decodeHistoryError(parsed.value) : null;
  if (!envelope)
    return withStatus(
      failure("SERVICE_UNAVAILABLE", "no_service_envelope", `HTTP ${ex.status} without a FlowAssert error envelope — the local service did not answer (proxy, gate or transport failure).`, null, true),
      ex.status,
    );
  const e = envelope.error;
  if (ex.status === 404 && e.code === "history_not_found") return { kind: "not_found", requestId: e.request_id };
  const access = ex.status === 409 ? "STALE_SNAPSHOT" : ex.status === 503 ? (resource === "evidence" ? "EVIDENCE_UNAVAILABLE" : "SERVICE_UNAVAILABLE") : "REQUEST_ERROR";
  return withStatus(failure(access, e.code, `HTTP ${ex.status} · ${e.code}. ${e.message}`, e.request_id, e.retryable), ex.status, ex.status === 503 ? integrityFromDetails(envelope) : null);
}

function successBody(ex: Exchange): { ok: true; value: unknown } | Failure {
  if (ex.kind !== "response" || !ex.contentType.includes("application/json"))
    return withStatus(failure("REQUEST_ERROR", "malformed_response", "HTTP 200 without a JSON body. Nothing was published."), ex.kind === "response" ? ex.status : undefined);
  const parsed = parseJson(ex.text);
  return parsed.ok ? parsed : withStatus(failure("REQUEST_ERROR", "malformed_response", "HTTP 200 with a body that is not valid JSON. Nothing was published."), ex.status);
}

const refusal = (code: string, problems: string[], integrity?: IntegrityOutcome) =>
  withStatus(
    failure("REQUEST_ERROR", code, `Response refused (${code}): ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? ` (+${problems.length - 3} more)` : ""}. Nothing was published.`),
    200,
    integrity,
  );

const context = (snapshotId: string): ProviderContext => ({
  mode: "LOCAL_RESEARCH",
  synthetic: true,
  workspaceId: HISTORY_SCOPE.workspaceId,
  contractVersion: HISTORY_CONTRACT_VERSION,
  snapshotId,
  requestId: null,
  researchAuthorization: "research_only",
  acquisitionAuthenticity: "not_authenticated",
  clockBasis: "Archive time (UTC) · original evaluation instant · synthetic tick mapping",
});

const invalidId = (reason: string) => failure("REQUEST_ERROR", "invalid_history_id", `No request was sent: ${reason}.`);

export function historyListUrl(query: { limit: number; cursor?: string; verificationId?: string }): string {
  const q = new URLSearchParams();
  q.set("limit", String(query.limit));
  if (query.verificationId !== undefined) q.set("verification_id", query.verificationId);
  if (query.cursor !== undefined) q.set("cursor", query.cursor);
  return `${HISTORY_API}?${q.toString()}`;
}

export function historyDetailUrl(historyId: string, snapshotId?: string): string {
  const q = new URLSearchParams();
  if (snapshotId !== undefined) q.set("snapshot_id", snapshotId);
  const qs = q.toString();
  return `${HISTORY_API}/${encodeURIComponent(historyId)}${qs ? `?${qs}` : ""}`;
}

export function historyEvidenceUrl(historyId: string, query: { snapshotId: string; limit: number; includePayload: boolean; cursor?: string }): string {
  const q = new URLSearchParams();
  q.set("snapshot_id", query.snapshotId);
  q.set("limit", String(query.limit));
  q.set("include_payload", query.includePayload ? "true" : "false");
  if (query.cursor !== undefined) q.set("cursor", query.cursor);
  return `${HISTORY_API}/${encodeURIComponent(historyId)}/evidence?${q.toString()}`;
}

export function createLocalHistoryProvider(options: HistoryProviderOptions = {}): FlowAssertHistoryProvider {
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? LOCAL_LIMITS.timeoutMs;
  return {
    mode: "LOCAL_RESEARCH",

    async listHistory(query: HistoryListQuery, signal?: AbortSignal): Promise<ProviderResult<HistoryListPageView>> {
      const ex = await exchange(fetchImpl, historyListUrl(query), timeoutMs, signal);
      const fail = nonSuccess(ex, "list");
      if (fail) return fail;
      const body = successBody(ex);
      if (!("ok" in body)) return body;
      const decoded = decodeHistoryList(body.value, { limit: query.limit, verificationId: query.verificationId });
      if (!decoded.ok) return refusal(decoded.code, decoded.problems, decoded.integrity);
      return { kind: "ready", data: toHistoryListPageView(decoded.value), context: context(decoded.value.page.snapshot_id) };
    },

    async getHistory(historyId: string, query: HistoryDetailQuery = {}, signal?: AbortSignal): Promise<ProviderResult<HistoryDetailView>> {
      const admitted = checkHistoryId(historyId);
      if (!admitted.ok) return invalidId(admitted.reason);
      const ex = await exchange(fetchImpl, historyDetailUrl(historyId, query.snapshotId), timeoutMs, signal);
      const fail = nonSuccess(ex, "detail");
      if (fail) return fail;
      const body = successBody(ex);
      if (!("ok" in body)) return body;
      const decoded = decodeHistoryDetail(body.value, { historyId, snapshotId: query.snapshotId });
      if (!decoded.ok) return refusal(decoded.code, decoded.problems, decoded.integrity);
      return { kind: "ready", data: toHistoryDetailView(decoded.value), context: context(decoded.value.snapshot_id) };
    },

    async getHistoryEvidence(historyId: string, query: HistoryEvidenceQuery, signal?: AbortSignal): Promise<ProviderResult<EvidencePageView>> {
      const admitted = checkHistoryId(historyId);
      if (!admitted.ok) return invalidId(admitted.reason);
      const { binding, limit, includePayload, cursor } = query;
      // Evidence is bound to the Detail it belongs to: same history, same persistent snapshot.
      if (binding.historyId !== historyId) return failure("REQUEST_ERROR", "binding_conflict", "Evidence was requested for a different history than its Detail. Nothing was sent.");
      const ex = await exchange(fetchImpl, historyEvidenceUrl(historyId, { snapshotId: binding.snapshotId, limit, includePayload, cursor }), timeoutMs, signal);
      const fail = nonSuccess(ex, "evidence");
      if (fail) return fail;
      const body = successBody(ex);
      if (!("ok" in body)) return body;
      const decoded = decodeHistoryEvidencePage(body.value, { ...binding, includePayload, limit });
      if (!decoded.ok) return refusal(decoded.code, decoded.problems, decoded.integrity);
      const page = decoded.value;
      // P2-AUD-002: digests are rebuilt from the response's own lexemes (lossless parse).
      const tree = ex.kind === "response" ? losslessParse(ex.text) : undefined;
      const items: EvidenceReferenceView[] = await Promise.all(
        page.items.map(async (item, i) => {
          if (item.reference.availability !== "available") return toArchivedEvidenceView(item, { state: "unavailable", reason: item.payload_reason ?? "" });
          if (!includePayload) return toArchivedEvidenceView(item, { state: "omitted", reason: item.payload_reason ?? "omitted_by_request" });
          const node = losslessAt(tree, ["items", i, "payload"]);
          const digest = node === undefined ? ("not_checkable" as const) : await checkPayloadDigest(item.payload, item.reference.sha256, node);
          return toArchivedEvidenceView(item, { state: "loaded", value: item.payload, digest });
        }),
      );
      if (signal?.aborted) throw abortError();
      return {
        kind: "ready",
        data: { runId: page.history_id, snapshotId: page.page.snapshot_id, items, nextCursor: page.page.next_cursor, total: page.page.total },
        context: context(page.page.snapshot_id),
      };
    },
  };
}

let shared: FlowAssertHistoryProvider | null = null;
/** The app's single LOCAL_RESEARCH history provider (browser fetch, default limits). */
export function localHistoryProvider(): FlowAssertHistoryProvider {
  return (shared ??= createLocalHistoryProvider());
}
