/**
 * Route identifier admission (P2-AUD-003, corrected by P3A-AUD-001). An ID is checked BEFORE any request
 * URL is built; a refused ID never reaches fetch. Nothing is repaired, trimmed, case-folded, normalized or
 * re-decoded: an ID is either accepted exactly as given or refused with a reason. This module has no
 * imports so the local API gate (server/localApiGate.ts) applies the very same language to raw requests.
 *
 *  History ID       exactly the additive contract's path pattern  ^hist_[a-f0-9]{64}$
 *                   (FlowAssert-Phase3A-Service/contracts/openapi-history-v1.yaml, history_id).
 *  Verification ID  the frozen contract's path `id`: type string, minLength 1, maxLength 128 (Unicode
 *                   code points), no pattern (openapi-v1-proposed.yaml, getVerification and
 *                   getVerificationEvidence). Every such string is admitted — colon, space, "@", "+", "%",
 *                   "\", "?", "#", Unicode, controls — EXCEPT the few the authorized single-segment path API
 *                   cannot carry faithfully, which are refused as `verification_id_not_transportable`
 *                   (contract-valid, but no request could name exactly that ID; recorded for an Owner
 *                   contract decision in docs/phase3a/P3A_AUD_001_ID_COMPATIBILITY.md):
 *                     "." and ".."      every browser removes these dot segments from a URL path (also when
 *                                       written %2E) before sending, so the request would name another path;
 *                     any "/"           the Service decodes %2F before routing, so "a/b" never reaches the
 *                                       verification route and "x/evidence" reads the evidence of "x";
 *                     a lone surrogate  has no UTF-8 form; the Service would receive U+FFFD instead.
 *
 * A request carries an admitted ID as ONE path segment in canonical RFC 3986 form (encodeIdSegment):
 * the unreserved characters A–Z a–z 0–9 - . _ ~ as written, every other UTF-8 byte as %XX with uppercase
 * hex. Browsers send that segment unchanged and the Service decodes it exactly once, so the Service
 * receives the original ID (evidence: docs/phase3a/evidence/remediation-01/backend/).
 */
export type IdCheck =
  | { ok: true; id: string }
  | { ok: false; code: "invalid_history_id" | "invalid_verification_id" | "verification_id_not_transportable"; reason: string };

export const HISTORY_ID_PATTERN = /^hist_[a-f0-9]{64}$/;
export const VERIFICATION_ID_MAX = 128;

/** An unpaired UTF-16 surrogate (no Unicode scalar value, so no UTF-8 encoding). */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function checkVerificationId(raw: string): IdCheck {
  const invalid = (reason: string): IdCheck => ({ ok: false, code: "invalid_verification_id", reason });
  const untransportable = (reason: string): IdCheck => ({ ok: false, code: "verification_id_not_transportable", reason });
  if (raw.length === 0) return invalid("the ID is empty; the contract requires at least 1 character");
  if (LONE_SURROGATE.test(raw)) return untransportable("the ID contains an unpaired UTF-16 surrogate, which has no UTF-8 form, so a URL cannot carry it unchanged");
  const length = [...raw].length;
  if (length > VERIFICATION_ID_MAX) return invalid(`the ID is ${length} characters; the contract allows at most ${VERIFICATION_ID_MAX}`);
  if (raw === "." || raw === "..") return untransportable("the ID is a dot segment (\".\" or \"..\"), which browsers remove from a URL path before sending, so no request can name it");
  if (raw.includes("/")) return untransportable("the ID contains \"/\", which the local service decodes before routing, so a request would name a different path");
  return { ok: true, id: raw };
}

/** Canonical single-segment encoding of an admitted ID (RFC 3986: unreserved as written, all else %XX uppercase). */
export function encodeIdSegment(id: string): string {
  return encodeURIComponent(id).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const CANONICAL_SEGMENT = /^(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$/;

/**
 * The Verification ID carried by one raw request-path segment, or why the segment is refused. Accepted
 * only when the segment is exactly encodeIdSegment(id) of an admitted ID — one ID, one path: no
 * alternative spelling (lower-case hex, needless escapes, raw reserved or non-ASCII bytes), no malformed
 * or non-UTF-8 escape, and nothing that decodes to a separator or dot segment.
 */
export function verificationIdFromSegment(segment: string): { ok: true; id: string } | { ok: false; reason: string } {
  if (!CANONICAL_SEGMENT.test(segment)) return { ok: false, reason: "the ID segment is not canonical percent-encoding (unreserved characters as written, every other byte as %XX with uppercase hex)" };
  let id: string;
  try {
    id = decodeURIComponent(segment);
  } catch {
    return { ok: false, reason: "the ID segment is not valid UTF-8 percent-encoding" };
  }
  const check = checkVerificationId(id);
  if (!check.ok) return { ok: false, reason: `the decoded ID is refused: ${check.reason}` };
  if (encodeIdSegment(id) !== segment) return { ok: false, reason: "the ID segment is not the canonical encoding of its decoded ID" };
  return { ok: true, id };
}

/* ---------- Exact-ID query addressing (ID-addressability remediation-03) ----------
 * The additive backend contract phase3a-id-addressability-1.0.0 (FlowAssert-Phase3A-Service/contracts/
 * openapi-id-addressability-v1.yaml, SHA-256 59ac3863…d8ae) adds two read-only query-addressed operations:
 *   GET /api/v1/verification-lookup?verification_id=…&snapshot_id=…
 *   GET /api/v1/verification-evidence?verification_id=…&snapshot_id=…&limit=…&include_payload=…&cursor=…
 * The ID travels as one form-encoded query VALUE (application/x-www-form-urlencoded, UTF-8, decoded exactly once
 * by the Service), so ".", "..", "/" and "x/evidence" are values, never path segments. The only frozen-contract-valid
 * IDs a query value cannot carry are strings with a lone UTF-16 surrogate (no UTF-8 form; URLSearchParams would
 * silently substitute U+FFFD), which are refused as verification_id_not_transportable.
 */

/** Admission for the query-addressed operations: 1–128 Unicode code points, well-formed (no lone surrogate). Nothing else. */
export function checkLookupVerificationId(raw: string): IdCheck {
  if (raw.length === 0) return { ok: false, code: "invalid_verification_id", reason: "the ID is empty; the contract requires at least 1 character" };
  if (LONE_SURROGATE.test(raw))
    return { ok: false, code: "verification_id_not_transportable", reason: "the ID contains an unpaired UTF-16 surrogate, which has no UTF-8 form, so no query value can carry it unchanged" };
  const length = [...raw].length;
  if (length > VERIFICATION_ID_MAX) return { ok: false, code: "invalid_verification_id", reason: `the ID is ${length} characters; the contract allows at most ${VERIFICATION_ID_MAX}` };
  return { ok: true, id: raw };
}

/**
 * Form-encode one query value exactly as URLSearchParams serializes it (WHATWG application/x-www-form-urlencoded):
 * A–Z a–z 0–9 * - . _ as written, space as "+", every other UTF-8 byte as %XX with uppercase hex. Callers must
 * admit the value first: a lone surrogate would otherwise be replaced by U+FFFD.
 */
export function formEncodeValue(value: string): string {
  const q = new URLSearchParams();
  q.set("v", value);
  return q.toString().slice(2);
}

/** The backend's accepted raw query bytes (app/verification_lookup.py QUERY_BYTES) — RFC 3986 query characters, ASCII only. */
const QUERY_CHARS = /^[A-Za-z0-9._~!$&'()*+,;=:@/?%-]*$/;
const BAD_ESCAPE = /%(?![0-9A-Fa-f]{2})/;

export type StrictQuery = { ok: true; params: Map<string, string> } | { ok: false; reason: string };

/**
 * Strict application/x-www-form-urlencoded decode, applied exactly once — the backend's own grammar
 * (app/verification_lookup.py lookup_query: parse_qsl strict_parsing, errors='strict', separator '&'), narrowed:
 *   - only RFC 3986 query characters; every "%" starts a well-formed escape;
 *   - pairs split only at "&"; every pair is name=value; a name is written plainly ([a-z_]+, never percent-encoded,
 *     so no two spellings of one name exist); names are from `allowed` and never repeated;
 *   - a value decodes "+" as space and %XX as UTF-8; malformed or non-UTF-8 escapes (overlong, surrogate, truncated)
 *     are refused, never replaced with U+FFFD;
 *   - when `canonical`, a value must be spelled exactly as formEncodeValue spells its decoded string (one value,
 *     one spelling: no lower-case hex, needless escapes or %20-for-space).
 * Nothing is trimmed, normalized or decoded twice.
 */
export function decodeStrictQuery(query: string, allowed: readonly string[], canonical: boolean): StrictQuery {
  const params = new Map<string, string>();
  if (query === "") return { ok: true, params };
  if (!QUERY_CHARS.test(query)) return { ok: false, reason: "the query contains a character outside RFC 3986 query syntax (non-ASCII, space, quote, bracket or fragment delimiter)" };
  if (BAD_ESCAPE.test(query)) return { ok: false, reason: "the query contains a \"%\" that does not start a two-digit hexadecimal escape" };
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const name = eq === -1 ? pair : pair.slice(0, eq);
    if (eq === -1 || !/^[a-z][a-z0-9_]*$/.test(name)) return { ok: false, reason: `malformed query pair ${JSON.stringify(pair.slice(0, 64))}` };
    if (!allowed.includes(name)) return { ok: false, reason: `query key ${name} is not accepted here` };
    if (params.has(name)) return { ok: false, reason: `query key ${name} is repeated` };
    const written = pair.slice(eq + 1);
    let value: string;
    try {
      value = decodeURIComponent(written.replace(/\+/g, " "));
    } catch {
      return { ok: false, reason: `the ${name} value is not valid UTF-8 percent-encoding` };
    }
    if (canonical && formEncodeValue(value) !== written) return { ok: false, reason: `the ${name} value is not written in its one canonical form encoding` };
    params.set(name, value);
  }
  return { ok: true, params };
}

/** Characters that explain a history-ID refusal more precisely than the pattern alone. */
function describeHistory(raw: string): string | null {
  if (raw.length === 0) return "the ID is empty";
  if (raw === "." || raw === "..") return "a dot segment is not an ID";
  if (/[/\\]/.test(raw)) return "the ID contains a path separator";
  if (raw.includes("%")) return "the ID contains a percent sign (an encoded or malformed escape sequence)";
  // C0 controls, DEL and C1 controls — matching them is the point of this check.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) return "the ID contains a control character";
  if (/[\ud800-\udfff]/.test(raw)) return "the ID contains a surrogate code unit";
  if (/[?#]/.test(raw)) return "the ID contains a query or fragment delimiter";
  if (/\s/.test(raw)) return "the ID contains whitespace";
  return null;
}

export function checkHistoryId(raw: string): IdCheck {
  const refuse = (reason: string): IdCheck => ({ ok: false, code: "invalid_history_id", reason });
  const specific = describeHistory(raw);
  if (specific) return refuse(specific);
  if (!HISTORY_ID_PATTERN.test(raw)) return refuse("a history ID is hist_ followed by 64 lowercase hexadecimal characters");
  return { ok: true, id: raw };
}
