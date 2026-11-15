/**
 * The source rows of one bounded range of a Google Sheets spreadsheet, read-only (docs/connectors/google-sheets.md),
 * as offline/flowassert_offline/sheets.py reads them: the same requests, checks, refusals, rows, canonical form and
 * report member. Requests go through a transport (connector.ts); the credential never comes here, only whether one of
 * each kind is set, and whether it has the form the command line accepts.
 */
import { canonicalRow, getJson, errorStatus, has, isObject, notJson, notUnicode, urlencode, pyQuote, type ConnectorHost, type Credential } from "./connector";
import { Refused, sha256Hex } from "./csv";
import { pyRepr } from "./pystr";
import type { PyValue } from "./pyjson";

export const SHEETS_HOST = "sheets.googleapis.com";
export const DRIVE_HOST = "www.googleapis.com";
export const TIMEOUT = 60;
const SERVICE = "Google Sheets API v4";
const VALUE_RENDER_OPTION = "FORMATTED_VALUE";
const DATE_TIME_RENDER_OPTION = "FORMATTED_STRING";
const MAJOR_DIMENSION = "ROWS";
const CANONICAL_FORM = "flowassert-sheet-csv-1";
export const NOT_REQUESTED = "not requested (--skip-source-revision)";
export const NO_VERSION = "Google Drive returned no version";
const VALUES = "Google Sheets values";
const DRIVE = "Google Drive revision metadata";
export const TOKEN_VARIABLE = "FLOWASSERT_SHEETS_TOKEN";
export const KEY_VARIABLE = "FLOWASSERT_SHEETS_API_KEY";
export const ENDPOINT_VARIABLE = "FLOWASSERT_SHEETS_TEST_ENDPOINT";

const ID = /^[A-Za-z0-9_-]{1,200}$/;
/** A credential's form: printable ASCII without spaces, at most 4,096 characters. */
export const CREDENTIAL = /^[\x21-\x7e]{1,4096}$/;
// Python's \w is Unicode-aware: a letter, a number or _ of any script.
const TAB = String.raw`'(?:[^']|'')+'|[\p{L}\p{N}_.]+`;
const CELL = String.raw`([A-Za-z]{1,3})([1-9][0-9]{0,7})?`;
const RANGE = new RegExp(String.raw`^(${TAB})!${CELL}:${CELL}$`, "u");
const RETURNED = new RegExp(String.raw`^(${TAB})!${CELL}(?::${CELL})?$`, "u");
export const ENDPOINT = /^http:\/\/(127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})$/;
const VERSION = /^[0-9]{1,20}$/;

const column = (letters: string) => [...letters.toUpperCase()].reduce((n, l) => n * 26 + l.charCodeAt(0) - 64, 0);
const tabName = (text: string) => (text.startsWith("'") ? text.slice(1, -1).replaceAll("''", "'") : text);

/** A range in A1 notation with a tab and bounded columns: TAB!A1:F or TAB!A1:F500. */
export class SheetRange {
  readonly text: string;
  readonly tab: string;
  readonly firstColumn: number;
  readonly lastColumn: number;
  readonly firstRow: number;
  readonly lastRow: number | null;

  constructor(text: string) {
    const m = RANGE.exec(text);
    if (!m) throw new Refused(`--source-range ${pyRepr(text)} must name a tab and bounded columns, such as Leads!A1:F or Leads!A1:F500`);
    this.text = text;
    this.tab = tabName(m[1]!);
    this.firstColumn = column(m[2]!);
    this.lastColumn = column(m[4]!);
    this.firstRow = m[3] ? Number(m[3]) : 1;
    this.lastRow = m[5] ? Number(m[5]) : null;
    if (this.firstColumn > this.lastColumn || (this.lastRow !== null && this.firstRow > this.lastRow)) throw new Refused(`--source-range ${pyRepr(text)} starts after it ends`);
  }

  /** The last row of the range the API says it read (null for none), or false when that is not the range asked for. */
  returned(text: string): number | null | false {
    const m = RETURNED.exec(text);
    if (!m) return false;
    let [, tab, firstColumn, firstRow, lastColumn, lastRow] = m;
    if (lastColumn === undefined) {
      lastColumn = firstColumn;
      lastRow = firstRow;
    }
    if (tabName(tab!) !== this.tab || column(firstColumn!) !== this.firstColumn || column(lastColumn!) !== this.lastColumn || (firstRow ? Number(firstRow) : 1) !== this.firstRow) return false;
    const last = lastRow ? Number(lastRow) : null;
    if (this.lastRow !== null) return last === this.lastRow ? last : false;
    return last === null || last >= this.firstRow ? last : false;
  }
}

/** The kind of credential the environment holds, checked as the command line checks it. */
export function credential(environ: ConnectorHost["environ"]): Credential {
  const token = environ[TOKEN_VARIABLE];
  const key = environ[KEY_VARIABLE];
  if (token === undefined && key === undefined) {
    throw new Refused(`no credential: set ${TOKEN_VARIABLE} to a read-only OAuth access token, or ${KEY_VARIABLE} to an API key for a sheet shared for viewing`);
  }
  if (token !== undefined && key !== undefined) throw new Refused(`set only one of ${TOKEN_VARIABLE} and ${KEY_VARIABLE}`);
  if (token !== undefined && !CREDENTIAL.test(token)) throw new Refused(`${TOKEN_VARIABLE} does not hold a credential: printable ASCII without spaces, at most 4096 characters`);
  if (key !== undefined && !CREDENTIAL.test(key)) throw new Refused(`${KEY_VARIABLE} does not hold a credential: printable ASCII without spaces, at most 4096 characters`);
  return token !== undefined ? "token" : "key";
}

/** A test endpoint in the environment is checked as the command line checks it; the transport decides where to send. */
export function testEndpoint(environ: ConnectorHost["environ"], variable = ENDPOINT_VARIABLE): void {
  const value = environ[variable];
  if (value === undefined) return;
  const m = ENDPOINT.exec(value);
  if (!m || Number(m[2]) > 65535) throw new Refused(`${variable} must be http://127.0.0.1:PORT or http://[::1]:PORT; it is for tests only`);
}

function statusRefusal(what: string, code: number, body: Uint8Array): Refused {
  const s = errorStatus(body, (data) => {
    const error = data.error;
    return isObject(error) ? error.status : undefined;
  });
  if (code === 400) return new Refused(`${what}: the request was not accepted (HTTP 400${s}); check that the tab exists and the range lies inside it`);
  if (code === 401) return new Refused(`${what}: the credential was not accepted (HTTP 401${s}); it may have expired or been revoked`);
  if (code === 403) {
    return new Refused(`${what}: access was denied (HTTP 403${s}); the credential may lack the read-only scope, its project may not have the API enabled, or the sheet is not shared with it`);
  }
  if (code === 404) return new Refused(`${what}: not found (HTTP 404${s}); check the spreadsheet ID and that the credential can see it`);
  if (code === 429) return new Refused(`${what}: rate limited (HTTP 429${s}); FlowAssert does not retry: wait, then run the check again`);
  if (code >= 500 && code <= 599) return new Refused(`${what}: server error (HTTP ${code}${s}); FlowAssert does not retry: run the check again later`);
  return new Refused(`${what}: unexpected response (HTTP ${code}${s})`);
}

export interface Revision {
  version: string;
  modified_time: string | null;
}

export interface SheetMember {
  read_by: "FlowAssert";
  service: string;
  spreadsheet_id: string;
  range_requested: string;
  range_returned: string;
  value_render_option: string;
  date_time_render_option: string;
  major_dimension: string;
  read_at: string;
  revision: { available: true; before: Revision; after: Revision } | { available: false; reason: string };
  canonical_form: string;
}

/**
 * The source rows of one range, read once, as SheetSource does. `read()` makes the requests; `rows()` then gives each
 * data row's selected columns, and once it is done `sha256` and `count` describe the whole range.
 */
export class SheetSource {
  readonly spreadsheetId: string;
  readonly range: SheetRange;
  private readonly kind: Credential;
  private readonly host: ConnectorHost;
  readonly maxBytes: number;
  readonly timeout: number;
  readonly revision: boolean;
  columns: string[] = [];
  maxRows: bigint | null = null;
  sha256: string | null = null;
  count: number | null = null;
  member: SheetMember | null = null;
  header: string[] | null = null;
  data: string[][] | null = null;

  constructor(spreadsheetId: string, rangeText: string, options: { maxBytes: bigint; timeout?: number; revision?: boolean; host: ConnectorHost }) {
    if (!ID.test(spreadsheetId)) throw new Refused("--source-sheet must be a spreadsheet ID: letters, digits, - and _, at most 200 characters");
    this.spreadsheetId = spreadsheetId;
    this.range = new SheetRange(rangeText);
    this.kind = credential(options.host.environ);
    testEndpoint(options.host.environ);
    this.host = options.host;
    this.maxBytes = Number(options.maxBytes);
    this.timeout = options.timeout ?? TIMEOUT;
    this.revision = options.revision ?? true;
  }

  select(columns: string[], maxRows: bigint) {
    this.columns = [...new Set(columns)];
    this.maxRows = maxRows;
  }

  private get(what: string, host: string, path: string, query: [string, string][]) {
    const request = { service: "sheets" as const, host, target: path + "?" + urlencode(query), credential: this.kind, timeout: this.timeout, maxBytes: this.maxBytes };
    return getJson(this.host, request, what, (code, body) => statusRefusal(what, code, body));
  }

  private async drive(): Promise<Revision | null> {
    const data = await this.get(DRIVE, DRIVE_HOST, "/drive/v3/files/" + pyQuote(this.spreadsheetId), [
      ["fields", "version,modifiedTime"],
      ["supportsAllDrives", "true"],
    ]);
    const version = data.version;
    if (version === undefined || version === null) return null;
    if (typeof version !== "string" || !VERSION.test(version)) throw notJson(DRIVE, "version is not a whole number written as a string");
    const modified = data.modifiedTime;
    if (modified !== undefined && modified !== null && typeof modified !== "string") throw notJson(DRIVE, "modifiedTime is not a string");
    return { version, modified_time: (modified as string | null | undefined) ?? null };
  }

  private values() {
    const path = "/v4/spreadsheets/" + pyQuote(this.spreadsheetId) + "/values/" + pyQuote(this.range.text);
    return this.get(VALUES, SHEETS_HOST, path, [
      ["majorDimension", MAJOR_DIMENSION],
      ["valueRenderOption", VALUE_RENDER_OPTION],
      ["dateTimeRenderOption", DATE_TIME_RENDER_OPTION],
    ]);
  }

  /** Makes the requests and checks the response. Refuses anything doubtful; concludes nothing. */
  async read() {
    const before = this.revision ? await this.drive() : null;
    const readAt = this.host.now();
    const data = await this.values();
    const after = this.revision ? await this.drive() : null;
    let revision: SheetMember["revision"];
    if (!this.revision) revision = { available: false, reason: NOT_REQUESTED };
    else if (before === null && after === null) revision = { available: false, reason: NO_VERSION };
    else if (before === null || after === null) throw new Refused("the sheet's revision could not be read the same way before and after the values; run the check again");
    else if (before.version !== after.version || before.modified_time !== after.modified_time) {
      throw new Refused(
        `the sheet changed while it was read: Drive version ${before.version} modified ${pyStr(before.modified_time)} before the values, version ${after.version} modified ${pyStr(after.modified_time)} after; run the check again`,
      );
    } else revision = { available: true, before, after };

    const returned = data.range;
    if (typeof returned !== "string") throw notJson(VALUES, "range is missing");
    if (data.majorDimension !== MAJOR_DIMENSION) throw notJson(VALUES, "majorDimension is not ROWS");
    const values: PyValue | undefined = has(data, "values") ? data.values : [];
    if (!Array.isArray(values) || !values.every((row) => Array.isArray(row))) throw notJson(VALUES, "values is not a list of rows");
    const rows = values as readonly (readonly PyValue[])[];
    const lastRow = this.range.returned(returned);
    if (lastRow === false) throw new Refused(`Google Sheets returned the range ${pyRepr(returned)} for ${pyRepr(this.range.text)}, which is not the range asked for`);
    const where = this.range.text;
    if (lastRow !== null && rows.length > lastRow - this.range.firstRow + 1) throw new Refused(`${where}: the response has more rows than the range holds`);
    const width = this.range.lastColumn - this.range.firstColumn + 1;
    rows.forEach((row, i) => {
      const number = this.range.firstRow + i;
      if (row.length > width) throw new Refused(`${where}: row ${number} has more cells than the range has columns`);
      for (const value of row) {
        if (typeof value !== "string") throw new Refused(`${where}: row ${number} has a cell that is not text; FlowAssert reads formatted values only`);
        if (notUnicode(value)) throw notJson(VALUES, "a cell is not valid Unicode");
      }
    });
    this.header = rows.length ? [...(rows[0] as string[])] : [];
    this.data = rows.slice(1).map((r) => [...(r as string[])]);
    this.member = {
      read_by: "FlowAssert",
      service: SERVICE,
      spreadsheet_id: this.spreadsheetId,
      range_requested: this.range.text,
      range_returned: returned,
      value_render_option: VALUE_RENDER_OPTION,
      date_time_render_option: DATE_TIME_RENDER_OPTION,
      major_dimension: MAJOR_DIMENSION,
      read_at: readAt,
      revision,
      canonical_form: CANONICAL_FORM,
    };
  }

  /** Each data row's selected columns, in the order selected; the digest of the canonical form once all are given. */
  async rows(onRow: (values: string[]) => void): Promise<void> {
    const where = this.range.text;
    const header = this.header!;
    if (new Set(header).size !== header.length) throw new Refused(`${where}: repeated column name`);
    const missing = this.columns.filter((c) => !header.includes(c));
    if (missing.length) throw new Refused(`${where}: missing column ${missing.join(", ")}`);
    const index = this.columns.map((c) => header.indexOf(c));
    const width = header.length;
    const text: string[] = [canonicalRow(header)];
    let count = 0;
    this.data!.forEach((row, i) => {
      const number = this.range.firstRow + 1 + i;
      if (row.length > width) throw new Refused(`${where}: row ${number} has a value beyond the header`);
      if (BigInt(count) === this.maxRows) throw new Refused(`${where}: exceeds --max-rows limit of ${this.maxRows}`);
      count++;
      const full = row.length < width ? [...row, ...Array<string>(width - row.length).fill("")] : row;
      text.push(canonicalRow(full));
      onRow(index.map((j) => full[j]!));
    });
    this.count = count;
    this.sha256 = await sha256Hex(new TextEncoder().encode(text.join("")));
  }

  /** The header, then every data row in full: what the records to resend read again (cli._rows_again). */
  *fullRows(): Generator<string[]> {
    const width = this.header!.length;
    yield [...this.header!];
    for (const row of this.data!) yield row.length < width ? [...row, ...Array<string>(width - row.length).fill("")] : [...row];
  }
}

/** Python's str() of a value that is a string or None. */
const pyStr = (v: string | null) => (v === null ? "None" : v);
