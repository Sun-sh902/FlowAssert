/**
 * TEST DOUBLE of the additive exact-ID query routes (ID-addressability remediation-03), for unit and component tests
 * only. It answers GET /api/v1/verification-lookup and /api/v1/verification-evidence from the captured frozen bodies
 * of a basis case (./fakeService.ts), changing only the identity (run.identity.id / run_id) — the backend's own
 * test-alias technique. Queries are decoded with the strict canonical decoder; anything else is a 400 envelope or a
 * plain 404. The real Service and its HMAC cursors are exercised by the browser suite (e2e-lookup/).
 */
import { LOOKUP_PATHS } from "../../data/contract/lookup";
import { decodeStrictQuery } from "../../data/local/ids";
import { captured, fakeService, json } from "./fakeService";

/**
 * Test double: answers the two query routes from the captured frozen bodies of a basis case, changing only the
 * identity (run.identity.id / run_id) — the backend's own alias technique. Every other URL is a 404 text body.
 */
export function lookupService(aliases: Record<string, string>) {
  const base = fakeService();
  const log: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(input);
    log.push(raw);
    const qi = raw.indexOf("?");
    const path = qi === -1 ? raw : raw.slice(0, qi);
    const evidence = path === LOOKUP_PATHS.evidence;
    if (path !== LOOKUP_PATHS.detail && !evidence) return new Response("not found", { status: 404 });
    const d = decodeStrictQuery(raw.slice(qi + 1), evidence ? ["verification_id", "snapshot_id", "limit", "include_payload", "cursor"] : ["verification_id", "snapshot_id"], true);
    if (!d.ok) return json({ error: { code: "invalid_query", message: "x", request_id: "r", retryable: false, details: [] } }, 400);
    const id = d.params.get("verification_id")!;
    const basis = aliases[id];
    if (!basis) return json(captured("invalid-id"), 404);
    const q = new URLSearchParams();
    for (const [k, v] of d.params) if (k !== "verification_id") q.set(k, v);
    const res = await base.fetch(`/api/v1/verifications/${basis}${evidence ? "/evidence" : ""}${q.size ? `?${q}` : ""}`, init);
    if (res.status !== 200) return res;
    const body = await res.json();
    if (evidence) body.run_id = id;
    else body.identity.id = id;
    return json(body);
  }) as typeof fetch;
  return { fetch: fetchImpl, log, base };
}
