/**
 * LocalResearchProvider — LOCAL_RESEARCH over real HTTP to the accepted local Python Service.
 *
 * Only the two authorized reads, with the frozen wire names:
 *   GET /api/v1/verifications/{id}?snapshot_id=…
 *   GET /api/v1/verifications/{id}/evidence?snapshot_id=…&limit=…&include_payload=true|false&cursor=…
 * Requests are relative (same origin); the Vite dev/preview proxy forwards `/api/v1` to 127.0.0.1:8765.
 *
 * Every outcome is a ProviderResult. Nothing here falls back to MOCK, computes a verdict, retries,
 * caches or polls. A body is published only after frozen-schema validation and the F004 checks
 * (./decode.ts). Cancellation rejects with AbortError, as the provider contract requires.
 *
 * Outcome → result (docs/phase2/SNAPSHOT_AND_ERROR_MATRIX.md):
 *   200 + admitted body                    → ready
 *   200 + unparseable / refused body       → error REQUEST_ERROR (malformed_response | <decode code>)
 *   404 + Error envelope                   → not_found
 *   400 / 409 / 422 / 503 … + Error envelope → error, access from classifyHttpFailure, the service's own code
 *   any status without an Error envelope   → error SERVICE_UNAVAILABLE no_service_envelope (e.g. proxy 500 when the service is down)
 *   network failure / refused connection   → error SERVICE_UNAVAILABLE transport_failure
 *   time limit exceeded                    → error SERVICE_UNAVAILABLE timeout
 *   caller aborts                          → rejects AbortError (no result)
 *   route ID outside the frozen contract (P2-AUD-003) → error REQUEST_ERROR invalid_verification_id, no request sent
 *   contract-valid ID the path API cannot carry (P3A-AUD-001: ".", "..", "/", lone surrogate)
 *                                          → error REQUEST_ERROR verification_id_not_transportable, no request sent
 * Every admitted ID travels as one canonical path segment (encodeIdSegment, src/data/local/ids.ts).
 *
 * Addressing (ID-addressability remediation-03). One provider, two ways to NAME the same frozen operations,
 * fixed when the provider is created — never chosen per request, per ID or after an error:
 *   "path"  (default) the frozen Phase 0 routes above; unchanged, and the only addressing the accepted Phase 1
 *           Service (run.py) serves.
 *   "query" the additive phase3a-id-addressability-1.0.0 routes (FlowAssert-Phase3A-Service run_history.py only):
 *             GET /api/v1/verification-lookup?verification_id=…[&snapshot_id=…]
 *             GET /api/v1/verification-evidence?verification_id=…[&snapshot_id=…]&limit=…&include_payload=…[&cursor=…]
 *           The exact ID is one URLSearchParams value, encoded once; admission is checkLookupVerificationId (1–128
 *           code points, no lone surrogate), so ".", "..", "/", "?", "#", "+", "%" IDs are all requestable.
 *           The 200 bodies are the same frozen VerificationRun / EvidencePage DTOs (the additive contract's
 *           components.schemas equal the frozen ones), so they pass through the very same decoders, identity,
 *           snapshot, digest and chain checks. Cursors are opaque and stay inside the acquisition that received them.
 * A provider never falls back from one addressing to the other.
 */
import { toEvidenceReferenceView, wireToRunView } from "../../adapters/wireToView";
import type { EvidencePageView, EvidenceReferenceView } from "../../domain/evidence";
import type { RunView } from "../../domain/view";
import { abortError, classifyHttpFailure, type ProviderContext, type ProviderResult } from "../access";
import type { FlowAssertReadProvider } from "../provider";
import { checkPayloadDigest, losslessAt, losslessParse } from "./canonical";
import { LOCAL_API_PREFIX, LOCAL_LIMITS } from "./config";
import { decodeErrorEnvelope, decodeEvidencePage, decodeVerificationRun } from "./decode";
import { checkLookupVerificationId, checkVerificationId, encodeIdSegment, type IdCheck } from "./ids";

/** How a provider names a Verification ID on the wire (see the header). Fixed per provider instance. */
export type LocalAddressing = "path" | "query";

export interface LocalProviderOptions {
  /** Defaults to "path" (the frozen routes). */
  addressing?: LocalAddressing;
  /** Injected for tests; defaults to the browser's fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type Exchange =
  | { kind: "response"; status: number; contentType: string; text: string }
  | { kind: "transport"; message: string }
  | { kind: "timeout" };

type Failure = Extract<ProviderResult<never>, { kind: "error" }>;

export const failure = (access: Failure["access"], code: string, message: string, requestId: string | null = null, retryable = false): Failure => ({
  kind: "error",
  access,
  code,
  message,
  requestId,
  retryable,
});

/** One bounded GET (shared with the Phase 3A history provider, src/data/history/provider.ts). */
export async function exchange(fetchImpl: typeof fetch, url: string, timeoutMs: number, signal?: AbortSignal): Promise<Exchange> {
  if (signal?.aborted) throw abortError();
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { kind: "response", status: res.status, contentType: res.headers.get("content-type") ?? "", text };
  } catch (e) {
    if (signal?.aborted) throw abortError();
    if (timedOut) return { kind: "timeout" };
    return { kind: "transport", message: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Every non-success path. Returns null when the exchange is a 200 that the caller must decode. */
function nonSuccess(ex: Exchange, resource: "verification" | "evidence"): Failure | { kind: "not_found"; requestId: string | null } | null {
  if (ex.kind === "timeout") return failure("SERVICE_UNAVAILABLE", "timeout", `No response within ${LOCAL_LIMITS.timeoutMs / 1000} s. No result was received.`, null, true);
  if (ex.kind === "transport") return failure("SERVICE_UNAVAILABLE", "transport_failure", `The local service could not be reached (${ex.message}).`, null, true);
  if (ex.text.length > LOCAL_LIMITS.maxBodyChars) return failure("REQUEST_ERROR", "response_too_large", `Response body exceeds ${LOCAL_LIMITS.maxBodyChars} characters; it was not read.`);
  if (ex.status === 200) return null;
  const parsed = ex.contentType.includes("application/json") ? parseJson(ex.text) : { ok: false as const };
  const envelope = parsed.ok ? decodeErrorEnvelope(parsed.value) : null;
  if (!envelope)
    return failure(
      "SERVICE_UNAVAILABLE",
      "no_service_envelope",
      `HTTP ${ex.status} without a FlowAssert error envelope — the local service did not answer (proxy or transport failure).`,
      null,
      true,
    );
  const e = envelope.error;
  if (ex.status === 404) return { kind: "not_found", requestId: e.request_id };
  return failure(classifyHttpFailure(ex.status, resource), e.code, `HTTP ${ex.status} · ${e.code}. ${e.message}`, e.request_id, e.retryable);
}

function successBody(ex: Exchange): { ok: true; value: unknown } | Failure {
  if (ex.kind !== "response" || !ex.contentType.includes("application/json"))
    return failure("REQUEST_ERROR", "malformed_response", "HTTP 200 without a JSON body. Nothing was published.");
  const parsed = parseJson(ex.text);
  return parsed.ok ? parsed : failure("REQUEST_ERROR", "malformed_response", "HTTP 200 with a body that is not valid JSON. Nothing was published.");
}

const refusal = (code: string, problems: string[]) =>
  failure("REQUEST_ERROR", code, `Response refused (${code}): ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? ` (+${problems.length - 3} more)` : ""}. Nothing was published.`);

function context(meta: { workspace_id: string; contract_version: string; synthetic: boolean }, snapshotId: string, assurance?: RunView["local"]): ProviderContext {
  return {
    mode: "LOCAL_RESEARCH",
    synthetic: meta.synthetic,
    workspaceId: meta.workspace_id,
    contractVersion: meta.contract_version,
    snapshotId,
    requestId: null,
    researchAuthorization: assurance?.assurance.researchAuthorization ?? "research_only",
    acquisitionAuthenticity: assurance?.assurance.acquisitionAuthenticity ?? "not_authenticated",
    clockBasis: "Evaluation instant · synthetic tick mapping",
  };
}

export function verificationUrl(id: string, snapshotId?: string): string {
  const q = new URLSearchParams();
  if (snapshotId !== undefined) q.set("snapshot_id", snapshotId);
  const qs = q.toString();
  return `${LOCAL_API_PREFIX}/verifications/${encodeIdSegment(id)}${qs ? `?${qs}` : ""}`;
}

export function evidenceUrl(id: string, query: { snapshotId?: string; limit: number; includePayload: boolean; cursor?: string }): string {
  const q = new URLSearchParams();
  if (query.snapshotId !== undefined) q.set("snapshot_id", query.snapshotId);
  q.set("limit", String(query.limit));
  q.set("include_payload", query.includePayload ? "true" : "false");
  if (query.cursor !== undefined) q.set("cursor", query.cursor);
  return `${LOCAL_API_PREFIX}/verifications/${encodeIdSegment(id)}/evidence?${q.toString()}`;
}

/** The additive exact-ID Detail operation: the ID is one query value, encoded once by URLSearchParams. */
export function lookupUrl(id: string, snapshotId?: string): string {
  const q = new URLSearchParams();
  q.set("verification_id", id);
  if (snapshotId !== undefined) q.set("snapshot_id", snapshotId);
  return `${LOCAL_API_PREFIX}/verification-lookup?${q.toString()}`;
}

/** The additive exact-ID Evidence operation; the opaque cursor is forwarded verbatim as one query value. */
export function lookupEvidenceUrl(id: string, query: { snapshotId?: string; limit: number; includePayload: boolean; cursor?: string }): string {
  const q = new URLSearchParams();
  q.set("verification_id", id);
  if (query.snapshotId !== undefined) q.set("snapshot_id", query.snapshotId);
  q.set("limit", String(query.limit));
  q.set("include_payload", query.includePayload ? "true" : "false");
  if (query.cursor !== undefined) q.set("cursor", query.cursor);
  return `${LOCAL_API_PREFIX}/verification-evidence?${q.toString()}`;
}

const ADDRESSING: Record<LocalAddressing, { admit: (id: string) => IdCheck; detail: typeof verificationUrl; evidence: typeof evidenceUrl }> = {
  path: { admit: checkVerificationId, detail: verificationUrl, evidence: evidenceUrl },
  query: { admit: checkLookupVerificationId, detail: lookupUrl, evidence: lookupEvidenceUrl },
};

export function createLocalResearchProvider(options: LocalProviderOptions = {}): FlowAssertReadProvider {
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? LOCAL_LIMITS.timeoutMs;
  const addressing = ADDRESSING[options.addressing ?? "path"];
  return {
    mode: "LOCAL_RESEARCH",
    capabilities: { readRuns: true, readEvidence: true, liveAcquisition: false, requestRecheck: false },

    async getVerification(id, query = {}, signal): Promise<ProviderResult<RunView>> {
      // P2-AUD-003 / P3A-AUD-001: an ID outside the contract, or one this addressing cannot carry, is refused before any URL exists.
      const admitted = addressing.admit(id);
      if (!admitted.ok) return failure("REQUEST_ERROR", admitted.code, `No request was sent: ${admitted.reason}.`);
      const ex = await exchange(fetchImpl, addressing.detail(id, query.snapshotId), timeoutMs, signal);
      const fail = nonSuccess(ex, "verification");
      if (fail) return fail;
      const body = successBody(ex);
      if (!("ok" in body)) return body;
      const decoded = decodeVerificationRun(body.value, { id, snapshotId: query.snapshotId });
      if (!decoded.ok) return refusal(decoded.code, decoded.problems);
      const run = wireToRunView(decoded.value);
      return { kind: "ready", data: run, context: context(decoded.value.meta, decoded.value.snapshot_id, run.local) };
    },

    async getEvidence(id, query, signal): Promise<ProviderResult<EvidencePageView>> {
      const admitted = addressing.admit(id);
      if (!admitted.ok) return failure("REQUEST_ERROR", admitted.code, `No request was sent: ${admitted.reason}.`);
      const limit = query.limit ?? LOCAL_LIMITS.evidencePageLimit;
      const includePayload = query.includePayload ?? true;
      const ex = await exchange(fetchImpl, addressing.evidence(id, { snapshotId: query.snapshotId, limit, includePayload, cursor: query.cursor }), timeoutMs, signal);
      const fail = nonSuccess(ex, "evidence");
      if (fail) return fail;
      const body = successBody(ex);
      if (!("ok" in body)) return body;
      const decoded = decodeEvidencePage(body.value, { id, snapshotId: query.snapshotId, includePayload, limit });
      if (!decoded.ok) return refusal(decoded.code, decoded.problems);
      const page = decoded.value;
      // P2-AUD-002: digests are rebuilt from the response's own lexemes (lossless parse), never from JSON.parse values.
      const tree = ex.kind === "response" ? losslessParse(ex.text) : undefined;
      const items: EvidenceReferenceView[] = await Promise.all(
        page.items.map(async (item, i) => {
          const view = toEvidenceReferenceView(item.reference);
          if (item.reference.availability !== "available") return { ...view, payload: { state: "unavailable" as const, reason: item.payload_reason ?? "" } };
          if (!includePayload) return { ...view, payload: { state: "omitted" as const, reason: item.payload_reason ?? "omitted_by_request" } };
          const node = losslessAt(tree, ["items", i, "payload"]);
          const digest = node === undefined ? ("not_checkable" as const) : await checkPayloadDigest(item.payload, item.reference.sha256, node);
          return { ...view, payload: { state: "loaded" as const, value: item.payload, digest } };
        }),
      );
      if (signal?.aborted) throw abortError();
      return {
        kind: "ready",
        data: { runId: page.run_id, snapshotId: page.page.snapshot_id, items, nextCursor: page.page.next_cursor, total: page.page.total },
        context: context(page.meta, page.page.snapshot_id),
      };
    },
  };
}

let shared: FlowAssertReadProvider | null = null;
/** The app's single LOCAL_RESEARCH provider (browser fetch, default limits, frozen path addressing). */
export function localResearchProvider(): FlowAssertReadProvider {
  return (shared ??= createLocalResearchProvider());
}

let sharedLookup: FlowAssertReadProvider | null = null;
/** The same provider with exact-ID query addressing, used only by the #/local/verification-lookup route. */
export function localLookupProvider(): FlowAssertReadProvider {
  return (sharedLookup ??= createLocalResearchProvider({ addressing: "query" }));
}
