/**
 * The packaged checker: one function, checkCsv, for JavaScript outside the page, such as a workflow tool's code step.
 * It runs exactly the check the CSV check page runs (pageCheck): the configuration is a --config file, both encodings
 * are stated, and the premises are the caller's. The result, the printed summary and both reports are the command
 * line's for the same files and premises, byte for byte, except each premise's origin, which the caller chooses from
 * API_ORIGINS ("JavaScript call" unless it says otherwise).
 *
 * `npm run build:lib` bundles this module into one script, dist-lib/flowassert-check.js, that defines the global
 * FlowAssert with checkCsv and VERSION. It imports nothing and makes no request. It needs from its host: BigInt,
 * TextEncoder, and TextDecoder with fatal decoding of utf-8, plus utf-16le and utf-16be for a utf-16 file and gb18030
 * for a gb18030 file. Each is checked on known bytes before a check starts; when one is missing or answers
 * differently, the check is refused and says which. The two files are read through the stream reader of csv.ts, as
 * one chunk each, and hashed with the SHA-256 of sha256.ts, which the tests compare with crypto.subtle; the
 * configuration is hashed with crypto.subtle when the host has it, and with sha256.ts otherwise. A side given with
 * format "xlsx" is read as one worksheet of an .xlsx workbook (xlsx.ts), which needs the host's Blob and
 * DecompressionStream("deflate-raw"); a host without them refuses the workbook and says so.
 */
import { reportHtml, reportJson } from "./check";
import { useDigestWithoutSubtle, type Encoding } from "./csv";
import { pageCheck } from "./pageCheck";
import { ORIGINS } from "./report";
import { sha256 } from "./sha256";

/** The FlowAssert version this checker belongs to; the same as flowassert_offline.__version__. */
export const VERSION = "1.1.0";

/** The origins a caller may record for its premises. */
export const API_ORIGINS = [ORIGINS.javascript, ORIGINS.n8n, ORIGINS.n8nNode] as const;
export type ApiOrigin = (typeof API_ORIGINS)[number];

/** A file's content: its bytes (a Uint8Array, such as a Node.js Buffer, or an ArrayBuffer), or text for utf-8 only. */
export type Content = Uint8Array | ArrayBuffer | string;

export interface CsvFileInput {
  /** What refusals name, as the page names a chosen file. */
  name: string;
  content: Content;
  /** "utf-8" (the default, with an optional byte order mark), "utf-16" (with a byte order mark) or "gb18030". */
  encoding?: string;
  /** "csv" (the default) or "xlsx": one worksheet of an .xlsx workbook, as --source-format xlsx reads it (1.1.0). */
  format?: string;
  /** For a workbook: the worksheet to read, exactly as the workbook names it; needed when it has several. */
  worksheet?: string;
}

export interface CheckCsvInput {
  source: CsvFileInput;
  destination: CsvFileInput;
  /**
   * The --config file: its text or bytes, or its value, such as { key: ["id", "id"], fields: [{ source: "phone",
   * destination: "phone", rule: "exact" }], scope: "source" }, written as JSON.stringify(config, null, 2) + "\n".
   * inputs.config_file_sha256 is the SHA-256 of those bytes, and flowassert-verify gives the same report with a
   * --config file holding them.
   */
  config: Content | object;
  /** Premises. FlowAssert cannot check any of them; each is false or absent unless stated, exactly true to state it. */
  sourceComplete?: boolean;
  destinationComplete?: boolean;
  /** The totals seen in the original systems, as --source-count and --destination-count take them, or null. */
  sourceCount?: string | number | null;
  destinationCount?: string | number | null;
  allowIdenticalContent?: boolean;
  origin?: ApiOrigin;
  /** Also the records to resend (1.1.0): result.exports. Without it, the result is exactly as before. */
  exports?: boolean;
  /** 1.1.0, each as the command line's option of the same name, and its default when absent: --details ("problems"
   * or "all"), --redact-values, --max-bytes and --max-rows (a string or a safe integer). */
  details?: string;
  redactValues?: boolean;
  maxBytes?: string | number;
  maxRows?: string | number;
}

/** One file of the records to resend: what --export-dir writes under that name, as text. */
export interface CheckCsvExport {
  file: string;
  rows: number;
  /** What the file holds, in one sentence. */
  meaning: string;
  /** How many of its fields begin with =, +, -, @, a tab or a carriage return, plain numbers excepted. */
  formulaFields: number;
  /** The file's text, beginning with its byte order mark (\ufeff); written as UTF-8, it is the command line's file. */
  text: string;
}

export type CheckState = "Verified" | "Mismatch" | "Unverified" | "refused" | "failed";

export interface CheckCsvResult {
  /** As the command line exits: 0 Verified, 1 Mismatch, 3 Unverified, 2 refused, 4 failed. */
  exit: 0 | 1 | 2 | 3 | 4;
  state: CheckState;
  /** The summary flowassert-verify prints, with its final line break; empty when refused or failed. */
  summary: string;
  /** What flowassert-verify prints on stderr: "refused: ..." or "failed: ...", or empty. */
  message: string;
  /** The JSON and HTML reports, as --json and --html write them; null when refused or failed. */
  json: string | null;
  html: string | null;
  /** Only when exports was asked for: the files that have rows, in the design's order; null when refused or failed. */
  exports?: CheckCsvExport[] | null;
}

class Refusal extends Error {}

const NOT_ANOTHER_WAY = "FlowAssert does not decode, encode or hash another way, so it never gives an answer the command line would not";

/** Decode `bytes` in two pieces, as the reader streams a file, and check that invalid bytes are an error. */
function decoderProblem(label: string, bytes: number[], expected: string, invalid: number[]): string | null {
  if (typeof TextDecoder !== "function") return "has no TextDecoder";
  try {
    const d = new TextDecoder(label, { fatal: true });
    const text = d.decode(Uint8Array.from(bytes.slice(0, 3)), { stream: true }) + d.decode(Uint8Array.from(bytes.slice(3)));
    if (text !== expected) return `has a TextDecoder that decodes ${label} differently`;
  } catch {
    return `has no TextDecoder for ${label}`;
  }
  try {
    new TextDecoder(label, { fatal: true }).decode(Uint8Array.from(invalid));
  } catch {
    return null;
  }
  return `has a TextDecoder that does not reject invalid ${label}`;
}

/** The host features this check needs, tried on known bytes; the first that is missing or different, or null. */
export function hostProblem(encodings: readonly string[]): string | null {
  if (typeof BigInt !== "function" || BigInt("9007199254740993") <= BigInt(Number.MAX_SAFE_INTEGER)) return "has no BigInt";
  if (typeof TextEncoder !== "function") return "has no TextEncoder";
  const encoded = new TextEncoder().encode("a€\u{1f600}");
  if (encoded.join() !== "97,226,130,172,240,159,152,128") return "has a TextEncoder that encodes differently";
  const problem =
    decoderProblem("utf-8", [0xef, 0xbb, 0xbf, 0x61, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80], "a€\u{1f600}", [0x61, 0xff]) ??
    (encodings.includes("utf-16")
      ? decoderProblem("utf-16le", [0xff, 0xfe, 0x61, 0x00, 0x3d, 0xd8, 0x00, 0xde], "a\u{1f600}", [0x00, 0xd8, 0x61, 0x00]) ??
        decoderProblem("utf-16be", [0xfe, 0xff, 0x00, 0x61, 0xd8, 0x3d, 0xde, 0x00], "a\u{1f600}", [0xd8, 0x00, 0x00, 0x61])
      : null) ??
    (encodings.includes("gb18030")
      ? decoderProblem("gb18030", [0x61, 0xd6, 0xd0, 0x81, 0x30, 0x81, 0x30, 0x90, 0x30, 0x81, 0x30], "a中\u0080\u{10000}", [0x81, 0x7f])
      : null);
  return problem;
}

const tag = (value: unknown) => Object.prototype.toString.call(value);

/** Bytes from this realm or another (a Buffer handed in by a sandbox's host, say), without copying. */
function asBytes(value: unknown): Uint8Array | null {
  if (ArrayBuffer.isView(value) && tag(value) === "[object Uint8Array]") return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (tag(value) === "[object ArrayBuffer]") return new Uint8Array(value as ArrayBuffer);
  return null;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function text(value: string, what: string): Uint8Array {
  // TextEncoder would replace a lone surrogate with U+FFFD, a value the file never had.
  if (LONE_SURROGATE.test(value)) throw new Refusal(`${what} is not well-formed text (it has a lone surrogate); pass its bytes instead`);
  return new TextEncoder().encode(value);
}

function fileBytes(file: CsvFileInput, side: "source" | "destination"): { name: string; bytes: Uint8Array; encoding: string } {
  if (typeof file !== "object" || file === null) throw new Refusal(`${side} must be an object with name, content and encoding`);
  if (typeof file.name !== "string" || !file.name) throw new Refusal(`${side} name must be a non-empty string`);
  const encoding = file.encoding ?? "utf-8";
  if (typeof encoding !== "string") throw new Refusal(`${side} encoding must be a string`);
  if (file.format !== undefined && file.format !== "csv" && file.format !== "xlsx") throw new Refusal(`${side} format must be csv or xlsx`);
  if (file.worksheet !== undefined && typeof file.worksheet !== "string") throw new Refusal(`${side} worksheet must be a string`);
  if (file.format === "xlsx" && file.encoding !== undefined) throw new Refusal(`${side} encoding does not apply to a workbook`);
  if (file.worksheet !== undefined && file.format !== "xlsx") throw new Refusal(`${side} worksheet needs format xlsx`);
  const bytes = asBytes(file.content);
  if (bytes) return { name: file.name, bytes, encoding };
  if (file.format === "xlsx") throw new Refusal(`${side} content of a workbook must be its bytes: a Uint8Array or an ArrayBuffer`);
  if (typeof file.content !== "string") throw new Refusal(`${side} content must be a Uint8Array, an ArrayBuffer or a string`);
  if (encoding !== "utf-8") throw new Refusal(`${side} content as text can only be read as utf-8; pass the file's bytes for ${encoding}`);
  return { name: file.name, bytes: text(file.content, `${side} content`), encoding };
}

function configBytes(config: unknown): Uint8Array {
  const bytes = asBytes(config);
  if (bytes) return bytes;
  if (typeof config === "string") return text(config, "config");
  if (config === undefined || config === null) throw new Refusal("config is required: key, fields and scope, as in a --config file");
  let json: string | undefined;
  try {
    json = JSON.stringify(config, null, 2);
  } catch {
    json = undefined;
  }
  if (json === undefined) throw new Refusal("config cannot be written as JSON");
  return text(json + "\n", "config");
}

function premise(value: unknown, name: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Refusal(`${name} must be true or false`);
  return value;
}

function count(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  throw new Refusal(`${name} must be a string, an integer or null`);
}

const refused = (message: string, exports: boolean): CheckCsvResult => ({
  exit: 2,
  state: "refused",
  summary: "",
  message: `refused: ${message}\n`,
  json: null,
  html: null,
  ...(exports ? { exports: null } : {}),
});

/** Run one check. It never throws: a refusal or a failure is a result, as the command line exits with 2 or 4. */
export async function checkCsv(input: CheckCsvInput): Promise<CheckCsvResult> {
  const asked = typeof input === "object" && input !== null && input.exports !== undefined && input.exports !== false;
  try {
    if (typeof input !== "object" || input === null) throw new Refusal("checkCsv takes one object: source, destination, config and the premises");
    const origin = input.origin ?? ORIGINS.javascript;
    if (input.exports !== undefined && typeof input.exports !== "boolean") throw new Refusal("exports must be true or false");
    if (input.details !== undefined && typeof input.details !== "string") throw new Refusal("details must be a string");
    const redactValues = premise(input.redactValues, "redactValues");
    if (redactValues && input.exports) throw new Refusal("exports cannot be combined with redactValues: the exported rows hold the values");
    const limits = { maxBytes: count(input.maxBytes, "maxBytes"), maxRows: count(input.maxRows, "maxRows") };
    if (!(API_ORIGINS as readonly string[]).includes(origin)) throw new Refusal(`origin must be one of: ${API_ORIGINS.join(", ")}`);
    const encodings = [input.source, input.destination].filter((f) => f?.format !== "xlsx").map((f) => String(f?.encoding ?? "utf-8"));
    const problem = hostProblem(encodings);
    if (problem) throw new Refusal(`this JavaScript host ${problem}, which the check needs; ${NOT_ANOTHER_WAY}`);
    // For the configuration: crypto.subtle when the host has it; otherwise the pure SHA-256, which gives the same digests.
    useDigestWithoutSubtle(sha256);
    const source = fileBytes(input.source, "source");
    const destination = fileBytes(input.destination, "destination");
    const config = configBytes(input.config);
    const outcome = await pageCheck({
      source: { name: source.name, size: source.bytes.length, read: () => source.bytes },
      destination: { name: destination.name, size: destination.bytes.length, read: () => destination.bytes },
      // An unknown encoding name reaches the check as typed, and is refused there as the command line refuses it.
      sourceEncoding: source.encoding as Encoding,
      destinationEncoding: destination.encoding as Encoding,
      sourceFormat: input.source.format === "xlsx" ? "xlsx" : "csv",
      destinationFormat: input.destination.format === "xlsx" ? "xlsx" : "csv",
      sourceWorksheet: input.source.worksheet,
      destinationWorksheet: input.destination.worksheet,
      config: { loaded: { name: "configuration", size: config.length, read: () => config } },
      sourceComplete: premise(input.sourceComplete, "sourceComplete"),
      destinationComplete: premise(input.destinationComplete, "destinationComplete"),
      sourceCount: count(input.sourceCount, "sourceCount"),
      destinationCount: count(input.destinationCount, "destinationCount"),
      allowIdenticalContent: premise(input.allowIdenticalContent, "allowIdenticalContent"),
      // Only a caller sees its inputs; there are no paths to compare, so identical content is still refused below.
      sameFile: false,
      origin: origin as ApiOrigin,
      ...(input.exports ? { exportRecords: true } : {}),
      ...(input.details !== undefined ? { details: input.details } : {}),
      ...(redactValues ? { redactValues } : {}),
      ...(limits.maxBytes !== null ? { maxBytes: limits.maxBytes } : {}),
      ...(limits.maxRows !== null ? { maxRows: limits.maxRows } : {}),
    });
    const report = outcome.report;
    const state: CheckState = report ? report.cohort_state === "Pending" ? "Unverified" : report.cohort_state : outcome.exit === 2 ? "refused" : "failed";
    return {
      exit: outcome.exit,
      state,
      summary: outcome.stdout,
      message: outcome.stderr,
      json: report ? reportJson(report) : null,
      html: report ? reportHtml(report) : null,
      ...(asked ? { exports: outcome.exports ? outcome.exports.files.map((f) => ({ ...f })) : null } : {}),
    };
  } catch (e) {
    if (e instanceof Refusal) return refused(e.message, asked);
    return { exit: 4, state: "failed", summary: "", message: `failed: ${e instanceof Error ? e.name : "Error"}\n`, json: null, html: null, ...(asked ? { exports: null } : {}) };
  }
}
