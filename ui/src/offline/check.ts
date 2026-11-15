/**
 * One check, as cli.main and cli.run perform it: the same validation in the same order, the same refusals, the same
 * report and the same exit status. The browser page calls it with a configuration object and premises from its form;
 * the parity tests call it with the command-line arguments of each case.
 *
 * Exit status: 0 Verified, 1 Mismatch, 3 Unverified, 2 the input was refused, 4 internal failure. A refused or failed
 * check has no report: nothing partial is ever returned.
 */
import { ExportPlan, summaryLines, type Export } from "./exports";
import { ENCODINGS, MAX_BYTES, MAX_ROWS, Refused, bytesStream, readCsv, sha256Hex, type ByteStream, type Encoding } from "./csv";
import { DETAILS, Evaluation, EvaluatorError, SCOPES, parseRule, type Details, type Scope } from "./evaluator";
import { DuplicateMember, JsonError, pyLoads, type PyValue } from "./pyjson";
import { compareCodePoints, pyRepr, pyStrip } from "./pystr";
import { CLAIM, LIMITS, MAX_DETAILS, ORIGINS, SCHEMA_VERSION, WORKBOOK_SCHEMA_VERSION, summaryText, writeHtml, writeJson, type Origin, type Report } from "./report";
import { FORMATS, readXlsx, type Format, type WorkbookMember } from "./xlsx";
import type { ConnectorHost, Transport } from "./connector";
import type { HubSpotDestination } from "./hubspot";
import { HUBSPOT_SCHEMA_VERSION, SHEET_SCHEMA_VERSION } from "./report";
import type { SheetSource } from "./sheets";

export { Refused };

const EXIT = { Verified: 0, Mismatch: 1, Unverified: 3, Pending: 3 } as const;
const CONFIG_MEMBERS = ["key", "fields", "scope"] as const;
// Premises are stated at each run, so a configuration file cannot carry them.
const COMMAND_LINE_ONLY = new Set(["source_complete", "destination_complete", "source_count", "destination_count", "allow_identical_content"]);

export interface InputFile {
  /** What refusals name: the path given on the command line, or the file's name in the browser. */
  name: string;
  /** The size before reading, to refuse an oversized file without reading it. */
  size: number;
  /** The whole file: for a configuration or mapping file, and for a CSV file when `open` is absent. */
  read: () => Uint8Array | Promise<Uint8Array>;
  /** The file as a stream, so a CSV file is never held whole (csv.ts). */
  open?: () => ByteStream;
  /** The file as a Blob, for a workbook, whose parts are read where the archive says they are (xlsx.ts). */
  blob?: () => Blob | Promise<Blob>;
}

export interface CheckArgs {
  /** --source FILE; absent with sourceSheet. */
  source?: InputFile;
  /** --destination FILE; absent with destinationHubspot. */
  destination?: InputFile;
  /** --source-sheet ID, --source-range RANGE, --source-timeout SECONDS, --skip-source-revision (sheets.ts). */
  sourceSheet?: string;
  sourceRange?: string;
  sourceTimeout?: string | number;
  skipSourceRevision?: boolean;
  /** --destination-hubspot OBJECT, --destination-timeout SECONDS (hubspot.ts). */
  destinationHubspot?: string;
  destinationTimeout?: string | number;
  /**
   * For a connector: the environment variables the command line would read (a credential's presence and form, a test
   * endpoint), the transport that sends the requests and holds the credential (connector.ts), and the readers
   * themselves (sheets.ts, hubspot.ts), handed in so that a build without connectors, the packaged checker, has none.
   */
  connectors?: ConnectorSupport;
  /** --key and --field as typed: "column" or "source:destination". */
  key?: string;
  field?: string[];
  /** --config FILE. */
  config?: InputFile;
  /** --mapping FILE: key and fields as column pairs, every rule exact. */
  mapping?: InputFile;
  scope?: string;
  sourceComplete?: boolean;
  destinationComplete?: boolean;
  /** --source-count and --destination-count as typed, or a number. */
  sourceCount?: string | number | bigint;
  destinationCount?: string | number | bigint;
  allowIdenticalContent?: boolean;
  sourceEncoding?: string;
  destinationEncoding?: string;
  /** --source-format and --destination-format: csv (the default) or xlsx. */
  sourceFormat?: string;
  destinationFormat?: string;
  /** --source-worksheet and --destination-worksheet. */
  sourceWorksheet?: string;
  destinationWorksheet?: string;
  maxBytes?: string | number;
  maxRows?: string | number;
  maxDetails?: string | number;
  details?: string;
  redactValues?: boolean;
  /**
   * --export-dir DIR: also the records to resend (exports.ts), read again after the check, with DIR named in the
   * summary as the command line names it. Nothing is written here; the caller writes outcome.exports.
   */
  exportDir?: string;
  /** The records to resend, as with exportDir, without the summary's lines about them: the page and checkCsv. */
  exportRecords?: boolean;
  /** The two inputs are the same file (realpath on the command line; known only when the browser can tell). */
  sameFile?: boolean;
  origin?: Origin;
  /** report["evaluated_at"]; the parity tests fix it. */
  now?: () => string;
  /** Called while files are read: which file, bytes read, rows read. */
  progress?: (side: "source" | "destination", bytes: number, rows: number) => void;
  /** Called when both files are read and the records are being evaluated, then as records are done, of `total`. */
  evaluating?: (done: number, total: number) => void;
}

export interface CheckOutcome {
  exit: 0 | 1 | 2 | 3 | 4;
  stdout: string;
  stderr: string;
  report?: Report;
  /** With exportDir: the files that have rows, and how many exported fields begin like a formula. */
  exports?: { files: Export[]; formulas: number };
}

/** evaluated_at as Python writes datetime.now(timezone.utc).isoformat() with "Z". */
export function utcNow(): string {
  const ms = Date.now();
  const iso = new Date(ms).toISOString(); // 2026-11-02T08:15:30.123Z
  const millis = ms % 1000;
  return millis ? iso.replace(/\.(\d{3})Z$/, ".$1000Z") : iso.replace(/\.\d{3}Z$/, "Z");
}

/** cli._int_arg: an int, or a string Python's int() reads in base 10, with no surrounding whitespace. */
function intArg(name: string, value: unknown, minimum: number): bigint {
  let n: bigint | null = null;
  if (typeof value === "number" && Number.isInteger(value)) n = BigInt(value);
  else if (typeof value === "bigint") n = value;
  else if (typeof value === "string" && pyStrip(value) === value && /^[+-]?[0-9]+(?:_[0-9]+)*$/.test(value)) {
    n = BigInt(value.replaceAll("_", ""));
  }
  const kind = minimum === 1 ? "positive" : "non-negative";
  if (n === null || n < BigInt(minimum)) throw new Refused(`${name} must be a ${kind} integer`);
  return n;
}

function choice<T extends string>(name: string, value: string | undefined, allowed: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(value)) throw new Refused(`${name} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

function checkSize(file: InputFile, maxBytes: bigint) {
  if (BigInt(file.size) > maxBytes) throw new Refused(`${file.name}: file size ${file.size} bytes exceeds --max-bytes limit of ${maxBytes}`);
}

/** cli.pair */
function pair(text: string): [string, string] {
  const at = text.indexOf(":");
  const source = at === -1 ? text : text.slice(0, at);
  const destination = at === -1 ? "" : text.slice(at + 1);
  if (!source) throw new Refused("empty column name in " + pyRepr(text));
  return [source, destination || source];
}

const isObject = (v: PyValue): v is { [key: string]: PyValue } => typeof v === "object" && v !== null && !Array.isArray(v);
const sortedNames = (names: Iterable<string>) => [...names].sort(compareCodePoints);

function pairList(item: PyValue | undefined, path: string, label: string): [string, string] {
  if (!Array.isArray(item) || item.length !== 2 || !item.every((c) => typeof c === "string")) throw new Refused(`${path}: ${label} must be a two-item list of strings`);
  if (!item.every((c) => pyStrip(c as string))) throw new Refused(`${path}: empty column name in ${label}`);
  return [item[0] as string, item[1] as string];
}

/** cli._read_json: UTF-8 JSON with an optional byte order mark, refusing a duplicate member. */
async function readJson(file: InputFile, maxBytes: bigint): Promise<[PyValue, string]> {
  checkSize(file, maxBytes);
  const raw = await file.read();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new Refused(`${file.name}: not UTF-8`);
  }
  let data: PyValue;
  try {
    data = pyLoads(text);
  } catch (e) {
    if (e instanceof DuplicateMember) throw new Refused(`${file.name}: duplicate member ${pyRepr(e.member)}`);
    if (e instanceof JsonError) throw new Refused(`${file.name}: invalid JSON (${e.message})`);
    throw e;
  }
  return [data, await sha256Hex(raw)];
}

export interface Selection {
  key: [string, string];
  fields: [string, string, string][];
  scope: Scope | null;
}

function configField(item: PyValue, path: string): [string, string, string] {
  if (!isObject(item)) throw new Refused(`${path}: each field must be an object with source, destination and an optional rule`);
  const unknown = sortedNames(Object.keys(item).filter((k) => !["source", "destination", "rule"].includes(k)));
  if (unknown.length) throw new Refused(`${path}: unknown member ${unknown.join(", ")} in field`);
  const missing = ["source", "destination"].filter((k) => !Object.hasOwn(item, k));
  if (missing.length) throw new Refused(`${path}: missing member ${missing.join(", ")} in field`);
  for (const name of ["source", "destination"] as const) {
    const value = item[name];
    if (typeof value !== "string") throw new Refused(`${path}: field ${name} must be a string`);
    if (!pyStrip(value)) throw new Refused(`${path}: empty column name in field`);
  }
  const rule = Object.hasOwn(item, "rule") ? item.rule : "exact";
  if (typeof rule !== "string") throw new Refused(`${path}: field rule must be a string`);
  try {
    parseRule(rule);
  } catch (e) {
    if (e instanceof EvaluatorError) throw new Refused(`${path}: field ${pyRepr(item.source as string)}: ${e.message}`);
    throw e;
  }
  return [item.source as string, item.destination as string, rule];
}

/** cli.read_config: key, fields with rules, and scope, with the same refusals. Returns the selection and the file's hash. */
export async function readConfig(file: InputFile, maxBytes: bigint = BigInt(MAX_BYTES)): Promise<[Selection, string]> {
  const path = file.name;
  const [data, digest] = await readJson(file, maxBytes);
  if (!isObject(data)) throw new Refused(`${path}: configuration must be a JSON object`);
  const premises = sortedNames(Object.keys(data).filter((n) => COMMAND_LINE_ONLY.has(n.replaceAll("-", "_").toLowerCase())));
  if (premises.length) {
    throw new Refused(
      `${path}: ${premises.join(", ")} cannot be set in a configuration file; completeness statements and counts are command-line options, chosen at each run`,
    );
  }
  const unknown = sortedNames(Object.keys(data).filter((k) => !(CONFIG_MEMBERS as readonly string[]).includes(k)));
  if (unknown.length) throw new Refused(`${path}: unknown member ${unknown.join(", ")}`);
  const missing = ["key", "fields"].filter((k) => !Object.hasOwn(data, k));
  if (missing.length) throw new Refused(`${path}: missing member ${missing.join(", ")}`);
  const key = pairList(data.key, path, "key");
  const fieldList = data.fields;
  if (!Array.isArray(fieldList) || !fieldList.length) throw new Refused(`${path}: fields must be a non-empty list`);
  const fields = fieldList.map((f: PyValue) => configField(f, path));
  if (new Set(fields.map(([s]) => s)).size !== fields.length) throw new Refused(`${path}: a source field is repeated`);
  let scope: Scope | null = null;
  if (Object.hasOwn(data, "scope")) {
    if (data.scope !== "source" && data.scope !== "exact") throw new Refused(`${path}: scope must be one of: ${SCOPES.join(", ")}`);
    scope = data.scope;
  }
  return [{ key, fields, scope }, digest];
}

/** cli.read_mapping: key and fields as [source, destination] pairs. Returns them and the file's hash. */
export async function readMapping(file: InputFile, maxBytes: bigint = BigInt(MAX_BYTES)): Promise<[[string, string], [string, string][], string]> {
  const path = file.name;
  const [data, digest] = await readJson(file, maxBytes);
  if (!isObject(data)) throw new Refused(`${path}: mapping must be a JSON object`);
  const unknown = sortedNames(Object.keys(data).filter((k) => k !== "key" && k !== "fields"));
  if (unknown.length) throw new Refused(`${path}: unknown member ${unknown.join(", ")}`);
  const missing = ["key", "fields"].filter((k) => !Object.hasOwn(data, k));
  if (missing.length) throw new Refused(`${path}: missing member ${missing.join(", ")}`);
  const key = pairList(data.key, path, "key");
  const fieldList = data.fields;
  if (!Array.isArray(fieldList) || !fieldList.length) throw new Refused(`${path}: fields must be a non-empty list`);
  return [key, fieldList.map((f: PyValue) => pairList(f, path, "field")), digest];
}

const SHORT_ESCAPES: Record<string, string> = { "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t" };

/**
 * The configuration the page writes for "Download configuration" and hashes for inputs.config_file_sha256: UTF-8
 * JSON without a byte order mark, members key, fields, scope in that order, two-space indent and a final line break,
 * characters outside ASCII written as themselves (json.dumps(indent=2, ensure_ascii=False) + "\n").
 */
export function canonicalConfig(selection: { key: readonly [string, string]; fields: readonly (readonly [string, string, string])[]; scope: Scope }): string {
  const str = (s: string) => {
    let out = '"';
    for (const c of s) {
      const code = c.charCodeAt(0);
      out += c === "\\" || c === '"' ? "\\" + c : code >= 0x20 ? c : (SHORT_ESCAPES[c] ?? "\\u" + code.toString(16).padStart(4, "0"));
    }
    return out + '"';
  };
  const fields = selection.fields.map(
    ([s, d, r]) => `    {\n      "source": ${str(s)},\n      "destination": ${str(d)},\n      "rule": ${str(r)}\n    }`,
  );
  return `{\n  "key": [\n    ${str(selection.key[0])},\n    ${str(selection.key[1])}\n  ],\n  "fields": [\n${fields.join(",\n")}\n  ],\n  "scope": ${str(selection.scope)}\n}\n`;
}

/** cli._selection. */
async function selection(args: CheckArgs, maxBytes: bigint): Promise<[Selection, Record<string, string>]> {
  if (args.config) {
    const conflicts = (
      [
        ["--mapping", args.mapping !== undefined],
        ["--key", args.key !== undefined],
        ["--field", Boolean(args.field?.length)],
        ["--scope", args.scope !== undefined],
      ] as const
    )
      .filter(([, given]) => given)
      .map(([name]) => name);
    if (conflicts.length) throw new Refused(`--config cannot be combined with ${conflicts.join(", ")}`);
    const [chosen, digest] = await readConfig(args.config, maxBytes);
    return [chosen, { config_file_sha256: digest }];
  }
  const scope = args.scope === undefined ? null : choice("--scope", args.scope, SCOPES, "source");
  if (args.mapping) {
    if (args.key !== undefined || args.field?.length) throw new Refused("--mapping cannot be combined with --key or --field");
    const [key, pairs, digest] = await readMapping(args.mapping, maxBytes);
    return [{ key, fields: pairs.map(([s, d]) => [s, d, "exact"] as [string, string, string]), scope }, { mapping_file_sha256: digest }];
  }
  if (args.key === undefined) throw new Refused("--key or --mapping is required");
  if (!args.field?.length) throw new Refused("at least one --field is required");
  const key = pair(args.key);
  return [{ key, fields: args.field.map((f) => [...pair(f), "exact"] as [string, string, string]), scope }, {}];
}

async function run(args: CheckArgs): Promise<[Report, CheckOutcome["exports"]]> {
  const maxBytes = intArg("--max-bytes", args.maxBytes ?? MAX_BYTES, 1);
  const maxRows = intArg("--max-rows", args.maxRows ?? MAX_ROWS, 1);
  const counts = {
    source_count: args.sourceCount === undefined ? null : intArg("--source-count", args.sourceCount, 0),
    destination_count: args.destinationCount === undefined ? null : intArg("--destination-count", args.destinationCount, 0),
  };
  const details: Details = choice("--details", args.details, DETAILS, "problems");
  const encodings = Object.keys(ENCODINGS) as Encoding[];
  const sourceEncoding = choice("--source-encoding", args.sourceEncoding, encodings, "utf-8");
  const destinationEncoding = choice("--destination-encoding", args.destinationEncoding, encodings, "utf-8");
  const sourceFormat: Format = choice("--source-format", args.sourceFormat, FORMATS, "csv");
  const destinationFormat: Format = choice("--destination-format", args.destinationFormat, FORMATS, "csv");
  if (args.sourceFormat !== undefined && args.sourceSheet !== undefined) throw new Refused("--source-format does not apply to a sheet source");
  if (args.destinationFormat !== undefined && args.destinationHubspot !== undefined) throw new Refused("--destination-format does not apply to a HubSpot destination");
  for (const [side, chosen, worksheet] of [["source", sourceFormat, args.sourceWorksheet], ["destination", destinationFormat, args.destinationWorksheet]] as const) {
    if (worksheet !== undefined && chosen !== "xlsx") throw new Refused(`--${side}-worksheet needs --${side}-format xlsx`);
  }
  for (const [side, chosen, encoding] of [["source", sourceFormat, args.sourceEncoding], ["destination", destinationFormat, args.destinationEncoding]] as const) {
    if (encoding !== undefined && chosen === "xlsx") throw new Refused(`--${side}-encoding does not apply to a workbook`);
  }
  const exporting = args.exportDir !== undefined || args.exportRecords === true;
  if (exporting && args.redactValues) throw new Refused("--export-dir cannot be combined with --redact-values: the exported rows hold the values");
  const host = { environ: args.connectors?.environ ?? {}, transport: args.connectors?.transport ?? noTransport, now: args.now ?? utcNow };
  const sheet = sheetSource(args, maxBytes, host);
  const crm = hubspotDestination(args, maxBytes, host);
  const [{ key, fields, scope }, selectionSha] = await selection(args, maxBytes);
  if (new Set(fields.map(([s]) => s)).size !== fields.length) throw new Refused("a source field is repeated");
  crm?.select([key[1], ...fields.map(([, d]) => d)], maxRows);
  if (!sheet && !crm && args.sameFile) throw new Refused("source and destination are the same file, so the check would not be independent");
  if (!sheet) checkSize(args.source!, maxBytes);
  if (!crm) checkSize(args.destination!, maxBytes);
  const evaluation = new Evaluation({ key, fields, scope: scope ?? "source" }, {
    source_complete: args.sourceComplete === true,
    destination_complete: args.destinationComplete === true,
    ...counts,
  });
  const books: Partial<Record<"source" | "destination", WorkbookMember>> = {};
  const formats = { source: sourceFormat, destination: destinationFormat };
  const worksheets = { source: args.sourceWorksheet, destination: args.destinationWorksheet };
  const read = async (side: "source" | "destination", file: InputFile, encoding: Encoding, columns: string[], onRow: (values: string[]) => void) => {
    if (formats[side] === "xlsx") {
      const blob = file.blob ? await file.blob() : new Blob([(await file.read()) as Uint8Array<ArrayBuffer>]);
      const result = await readXlsx({ name: file.name, blob }, columns, onRow, {
        maxRows,
        maxBytes,
        worksheet: worksheets[side],
        option: `--${side}-worksheet`,
        progress: args.progress && ((b, r) => args.progress!(side, b, r)),
      });
      books[side] = result.member;
      return result.sha256;
    }
    const read = await readCsv({ name: file.name, open: opener(file), encoding }, columns, onRow, maxRows, args.progress && ((b, r) => args.progress!(side, b, r)));
    return read.sha256;
  };
  const sourceColumns = [key[0], ...fields.map(([s]) => s)];
  const destinationColumns = [key[1], ...fields.map(([, d]) => d)];
  const onSource = (v: string[]) => evaluation.addSource(v[0]!, v.slice(1));
  const onDestination = (v: string[]) => evaluation.addDestination(v[0]!, v.slice(1));
  let sourceSha: string;
  if (sheet) {
    sheet.select(sourceColumns, maxRows);
    await sheet.read();
    // The selected columns are each listed once (dict.fromkeys); the evaluator takes the key, then each field's column.
    const at = sourceColumns.map((c) => sheet.columns.indexOf(c));
    await sheet.rows((v) => onSource(at.map((i) => v[i]!)));
    sourceSha = sheet.sha256!;
  } else sourceSha = await read("source", args.source!, sourceEncoding, sourceColumns, onSource);
  if (crm && exporting && (scope ?? "source") === "exact") crm.kept = []; // HubSpot is listed once: its records are kept for the destination-only rows
  let destinationSha: string;
  if (crm) {
    const at = destinationColumns.map((c) => crm.columns.indexOf(c));
    await crm.rows((v) => onDestination(at.map((i) => v[i]!)));
    destinationSha = crm.sha256!;
  } else destinationSha = await read("destination", args.destination!, destinationEncoding, destinationColumns, onDestination);
  args.evaluating?.(0, evaluation.keys.length);
  const result = evaluation.finish(details, args.evaluating);
  const identical = sourceSha === destinationSha;
  if (identical && !args.allowIdenticalContent) {
    throw new Refused(
      "source and destination have identical content, so the check would not be independent; " +
        "pass --allow-identical-content if they really come from different systems",
    );
  }
  const inputs: Report["inputs"] = {
    source_sha256: sourceSha,
    destination_sha256: destinationSha,
    source_complete_stated: args.sourceComplete === true,
    destination_complete_stated: args.destinationComplete === true,
    identical_content: identical,
  };
  if (identical) inputs.identical_content_allowed = true;
  Object.assign(inputs, selectionSha);
  if (crm) {
    // No destination encoding: the destination is not a file.
    if (sheet) inputs.source_sheet = sheet.member!;
    else if (args.sourceEncoding !== undefined) inputs.source_encoding = sourceEncoding;
    inputs.destination_hubspot = crm.member!;
  } else if (sheet) {
    inputs.source_sheet = sheet.member!;
    if (args.destinationEncoding !== undefined) inputs.destination_encoding = destinationEncoding;
  } else if (books.source || books.destination) {
    // Only a CSV side has an encoding; it is recorded alone when it was stated.
    if (args.sourceEncoding !== undefined) inputs.source_encoding = sourceEncoding;
    if (args.destinationEncoding !== undefined) inputs.destination_encoding = destinationEncoding;
  } else if (args.sourceEncoding !== undefined || args.destinationEncoding !== undefined) {
    inputs.source_encoding = sourceEncoding;
    inputs.destination_encoding = destinationEncoding;
  }
  if (books.source) inputs.source_workbook = books.source;
  if (books.destination) inputs.destination_workbook = books.destination;
  const premises = result.premises;
  if (args.allowIdenticalContent) premises.allow_identical_content = { stated: true };
  const origin = args.origin ?? ORIGINS.cli;
  for (const premise of Object.values(premises)) premise.origin = origin;
  const rules = fields.map(([, , r]) => r);
  const obligation: Report["obligation"] = {
    type: "current_state",
    key: [...key],
    fields: fields.map(([s, d]) => [s, d]),
    comparison: rules.every((r) => r === "exact") ? "exact-string" : "per-field-rule",
  };
  if (args.config) obligation.rules = rules;
  if (scope !== null) obligation.scope = scope;
  const report: Report = {
    ...result,
    schema_version: books.source || books.destination ? WORKBOOK_SCHEMA_VERSION : crm ? HUBSPOT_SCHEMA_VERSION : sheet ? SHEET_SCHEMA_VERSION : SCHEMA_VERSION,
    details,
    evaluated_at: (args.now ?? utcNow)(),
    inputs,
    premises,
    obligation,
    claim: result.cohort_state === "Verified" ? CLAIM : null,
    limitations: LIMITS,
  };
  if (args.redactValues) {
    report.records = report.records.redacted();
    for (const record of report.destination_only ?? []) record.key = "[redacted]";
  }
  if (!exporting) return [report, undefined];
  const side = (file: InputFile | undefined, format: Format, encoding: Encoding, worksheet: string | undefined, sha256: string, rows?: () => Iterable<string[]>): ExportSide => ({ file: file!, format, encoding, worksheet, sha256, rows });
  const exported = await exportsOf(
    report,
    side(args.source, sourceFormat, sourceEncoding, args.sourceWorksheet, sourceSha, sheet ? () => sheet.fullRows() : undefined),
    side(args.destination, destinationFormat, destinationEncoding, args.destinationWorksheet, destinationSha, crm ? () => crm.fullRows() : undefined),
    { maxRows, maxBytes },
  );
  return [report, exported];
}

/** What a check needs to read a side through a connector. */
export interface ConnectorSupport {
  environ: Readonly<Record<string, string | undefined>>;
  transport: Transport;
  readers: { sheet: typeof SheetSource; hubspot: typeof HubSpotDestination };
}

/** Without a transport, a connector's request has no answer; the command line would say the connection failed. */
const noTransport: Transport = () => Promise.resolve({ failure: "connection" });

/** The readers the caller handed in; a build without them cannot read a connector side at all. */
function readers(args: CheckArgs): ConnectorSupport["readers"] {
  if (!args.connectors?.readers) throw new Error("this build of the checker has no connectors");
  return args.connectors.readers;
}

/** cli._sheet_source: the sheet source the options name, checked, or null for a file. */
function sheetSource(args: CheckArgs, maxBytes: bigint, host: ConnectorHost): SheetSource | null {
  if (args.sourceSheet === undefined) {
    for (const [option, given] of [
      ["--source-range", args.sourceRange !== undefined],
      ["--source-timeout", args.sourceTimeout !== undefined],
      ["--skip-source-revision", args.skipSourceRevision === true],
    ] as const) {
      if (given) throw new Refused(`${option} needs --source-sheet`);
    }
    return null;
  }
  if (args.source !== undefined) throw new Refused("--source and --source-sheet cannot be combined");
  if (args.sourceRange === undefined) throw new Refused("--source-sheet needs --source-range");
  if (args.sourceEncoding !== undefined) throw new Refused("--source-encoding does not apply to a sheet source");
  const timeout = args.sourceTimeout === undefined ? undefined : Number(intArg("--source-timeout", args.sourceTimeout, 1));
  return new (readers(args).sheet)(args.sourceSheet, args.sourceRange, { maxBytes, timeout, revision: !args.skipSourceRevision, host });
}

/** cli._hubspot_destination: the HubSpot destination the options name, checked, or null for a file. */
function hubspotDestination(args: CheckArgs, maxBytes: bigint, host: ConnectorHost): HubSpotDestination | null {
  if (args.destinationHubspot === undefined) {
    if (args.destinationTimeout !== undefined) throw new Refused("--destination-timeout needs --destination-hubspot");
    return null;
  }
  if (args.destination !== undefined) throw new Refused("--destination and --destination-hubspot cannot be combined");
  if (args.destinationHubspot !== "contacts") throw new Refused("--destination-hubspot must be contacts");
  if (args.destinationEncoding !== undefined) throw new Refused("--destination-encoding does not apply to a HubSpot destination");
  const timeout = args.destinationTimeout === undefined ? undefined : Number(intArg("--destination-timeout", args.destinationTimeout, 1));
  return new (readers(args).hubspot)(args.destinationHubspot, { maxBytes, timeout, host });
}

/** A file given whole is read through the same stream reader, as one chunk. */
const opener = (file: InputFile) =>
  file.open ??
  (() => {
    const whole = file.read();
    let stream: ByteStream | null = null;
    return { read: async () => (stream ??= bytesStream(await whole)).read() };
  });

/** One side of a check, as the records to resend read it again: the file, how it was read, and its digest then. */
export interface ExportSide {
  file: InputFile;
  format: Format;
  encoding: Encoding;
  worksheet?: string;
  /** inputs.source_sha256 or inputs.destination_sha256: the file's bytes for CSV, the canonical form for a workbook. */
  sha256: string;
  /** A side a connector read: its rows as read, the header first, already in memory (cli._rows_again). */
  rows?: () => Iterable<string[]>;
}

/**
 * The records to resend of a report (exports.ts): the source read again in full, and the destination when the report
 * has destination-only records, each refused if it is not what the check read. As cli.py reads them for --export-dir.
 */
export async function exportsOf(report: Report, source: ExportSide, destination: ExportSide, limits: { maxRows?: number | bigint; maxBytes?: number | bigint } = {}): Promise<{ files: Export[]; formulas: number }> {
  const plan = new ExportPlan(report);
  const maxRows = limits.maxRows ?? MAX_ROWS;
  const again = async (s: ExportSide, onHeader: (header: string[]) => void, onRow: (values: string[]) => void) => {
    if (s.rows) {
      let first = true;
      for (const row of s.rows()) {
        if (first) onHeader(row);
        else onRow(row);
        first = false;
      }
      return;
    }
    let digest: string;
    try {
      if (s.format === "xlsx") {
        const blob = s.file.blob ? await s.file.blob() : new Blob([(await s.file.read()) as Uint8Array<ArrayBuffer>]);
        const option = s === source ? "--source-worksheet" : "--destination-worksheet";
        digest = (await readXlsx({ name: s.file.name, blob }, null, onRow, { maxRows, maxBytes: limits.maxBytes ?? MAX_BYTES, worksheet: s.worksheet, option, onHeader })).sha256;
      } else {
        digest = (await readCsv({ name: s.file.name, open: opener(s.file), encoding: s.encoding }, null, onRow, maxRows, undefined, onHeader)).sha256;
      }
    } catch (e) {
      if (e instanceof Refused) throw new Refused(`${s.file.name}: changed after it was checked; nothing was exported`);
      throw e;
    }
    if (digest !== s.sha256) throw new Refused(`${s.file.name}: changed after it was checked; nothing was exported`);
  };
  await again(source, (h) => plan.sourceHeader(h), (v) => plan.source(v));
  if (plan.needsDestination) await again(destination, (h) => plan.destinationHeader(h, report.obligation.key[1]!), (v) => plan.destination(v));
  const { exports, formulas } = plan.finish();
  return { files: exports, formulas };
}

/** cli.main: the check, its printed summary and its exit status. */
export async function check(args: CheckArgs): Promise<CheckOutcome> {
  try {
    const maxDetails = intArg("--max-details", args.maxDetails ?? MAX_DETAILS, 0);
    const [report, exported] = await run(args);
    let stdout = summaryText(report, maxDetails);
    if (exported && args.exportDir !== undefined) stdout += summaryLines(report, exported.files, args.exportDir!, exported.formulas).map((line) => line + "\n").join("");
    return { exit: EXIT[report.cohort_state], stdout, stderr: "", report, ...(exported ? { exports: exported } : {}) };
  } catch (e) {
    if (e instanceof Refused) return { exit: 2, stdout: "", stderr: `refused: ${e.message}\n` };
    // Python's default exit status 1 would read as a Mismatch.
    return { exit: 4, stdout: "", stderr: `failed: ${e instanceof Error ? e.name : "Error"}\n` };
  }
}

/** The JSON report's text, as cli.write_json writes it. */
export const reportJson = (report: Report) => [...writeJson(report)].join("");
/** The HTML report's text, as cli.write_html writes it. */
export const reportHtml = (report: Report) => [...writeHtml(report)].join("");
