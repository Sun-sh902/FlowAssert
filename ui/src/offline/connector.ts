/**
 * What the two read-only connectors share (sheets.ts, hubspot.ts; offline/flowassert_offline/sheets.py and hubspot.py):
 * the transport that sends their requests, Python's percent-encoding, the canonical CSV row, and the checks every
 * response goes through, in the command line's order and with its refusal texts.
 *
 * The connectors never send a request themselves and never hold a credential. A transport does both: given the host,
 * the encoded path and query, and which kind of credential to attach, it sends one HTTPS GET with the credential added
 * (an Authorization header for a token, a last `key` query parameter for an API key), follows no redirect, uses no
 * proxy, retries nothing, and answers with the status, the body and its Content-Encoding, or with why there is no
 * response. In the iPhone and iPad app the transport is Swift (URLSession) and the credential stays in the Keychain; in
 * the tests it serves the responses a golden case recorded.
 */
import { DuplicateMember, JsonError, pyLoads, type PyValue } from "./pyjson";
import { Refused } from "./csv";

export type Credential = "token" | "key";

export interface TransportRequest {
  /** "sheets" or "hubspot": whose credential the transport attaches. */
  service: "sheets" | "hubspot";
  /** The documented host: sheets.googleapis.com, www.googleapis.com or api.hubapi.com. */
  host: string;
  /** The path and query, percent-encoded as the command line encodes them, without any credential. */
  target: string;
  credential: Credential;
  /** The longest the request may take, in seconds, from connecting to the last byte. */
  timeout: number;
  /** The largest body the check reads; a transport may stop reading past it and answer "too-large". */
  maxBytes: number;
}

export type TransportResponse =
  | { status: number; body: Uint8Array; contentEncoding?: string }
  | { failure: "timeout" | "certificate" | "connection" | "too-large" };

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

/** The connectors' view of where they run: the environment variables they read, and the transport. */
export interface ConnectorHost {
  /** The variables the command line reads from its environment: in the app, a placeholder that a credential is saved. */
  environ: Readonly<Record<string, string | undefined>>;
  transport: Transport;
  /** When a request is sent, as datetime.now(timezone.utc).isoformat() with "Z". */
  now: () => string;
}

const UNRESERVED = /[A-Za-z0-9_.\-~]/;

/** urllib.parse.quote(text, safe): UTF-8, every byte but the unreserved and the safe characters as %XX. */
export function pyQuote(text: string, safe = ""): string {
  let out = "";
  for (const ch of text) {
    if (UNRESERVED.test(ch) || safe.includes(ch)) out += ch;
    else for (const b of new TextEncoder().encode(ch)) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** urllib.parse.urlencode(query, quote_via=quote, safe=safe). */
export const urlencode = (query: readonly (readonly [string, string])[], safe = "") => query.map(([k, v]) => `${pyQuote(k, safe)}=${pyQuote(v, safe)}`).join("&");

const cell = (value: string) => (/[,"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/** One row of the canonical forms (flowassert-sheet-csv-1, flowassert-hubspot-csv-1), with its line feed. */
export function canonicalRow(row: readonly string[]): string {
  // An empty line would be a blank line, which a CSV reader skips.
  if (row.length === 1 && row[0] === "") return '""\n';
  return row.map(cell).join(",") + "\n";
}

export const notJson = (what: string, detail: string) => new Refused(`${what}: the response is not the JSON the API documents (${detail})`);

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** str.encode("utf-8") fails on a lone surrogate, which only a \u escape can put into a JSON string. */
export const notUnicode = (value: string) => LONE_SURROGATE.test(value);

export const isObject = (v: PyValue | undefined): v is { readonly [key: string]: PyValue | undefined } => typeof v === "object" && v !== null && !Array.isArray(v);
/** `member in dict` for a parsed object: a member written as null is there. */
export const has = (o: { readonly [key: string]: PyValue | undefined }, name: string) => Object.prototype.hasOwnProperty.call(o, name);

/** The response as the command line's `_get` checks it, after the request: everything but the status's own refusal. */
export async function getJson(
  host: ConnectorHost,
  request: TransportRequest,
  what: string,
  statusRefusal: (code: number, body: Uint8Array) => Refused,
): Promise<{ readonly [key: string]: PyValue | undefined }> {
  let response: TransportResponse;
  try {
    response = await host.transport(request);
  } catch {
    response = { failure: "connection" };
  }
  if ("failure" in response) {
    if (response.failure === "timeout") throw new Refused(`${what}: no complete response within ${request.timeout} seconds; FlowAssert does not retry`);
    if (response.failure === "certificate") throw new Refused(`${what}: the server's TLS certificate could not be verified`);
    if (response.failure === "too-large") throw new Refused(`${what}: response exceeds --max-bytes limit of ${request.maxBytes}`);
    throw new Refused(`${what}: the connection failed`);
  }
  if (response.status >= 300 && response.status <= 399) throw new Refused(`${what}: redirected (HTTP ${response.status}), and FlowAssert does not follow redirects`);
  if (response.body.length > request.maxBytes) throw new Refused(`${what}: response exceeds --max-bytes limit of ${request.maxBytes}`);
  if (response.status !== 200) throw statusRefusal(response.status, response.body);
  if ((response.contentEncoding ?? "identity").trim().toLowerCase() !== "identity") throw notJson(what, "a compressed body");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
  } catch {
    throw notJson(what, "not UTF-8");
  }
  let data: PyValue;
  try {
    data = pyLoads(text, {
      parseConstant: (name) => {
        throw new ConstantNotJson(name);
      },
    });
  } catch (e) {
    if (e instanceof DuplicateMember) throw notJson(what, "a duplicate member");
    if (e instanceof ConstantNotJson) throw notJson(what, `${e.constant} is not JSON`);
    if (e instanceof JsonError) throw notJson(what, "not JSON");
    throw e;
  }
  if (!isObject(data)) throw notJson(what, "not an object");
  return data;
}

class ConstantNotJson extends Error {
  readonly constant: string;
  constructor(constant: string) {
    super(constant);
    this.constant = constant;
  }
}

/** The status name of an error body, as " NAME" when it is upper-case letters and _, or "". */
export function errorStatus(body: Uint8Array, pick: (data: { readonly [key: string]: PyValue | undefined }) => PyValue | undefined): string {
  let status: PyValue | undefined;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    let data: PyValue;
    try {
      data = pyLoads(text);
    } catch (e) {
      // json.loads without a hook keeps the last of a repeated member.
      if (!(e instanceof DuplicateMember)) throw e;
      data = JSON.parse(text) as PyValue;
    }
    if (!isObject(data)) return "";
    status = pick(data);
  } catch {
    return "";
  }
  return typeof status === "string" && /^[A-Z_]{1,64}$/.test(status) ? ` ${status}` : "";
}
