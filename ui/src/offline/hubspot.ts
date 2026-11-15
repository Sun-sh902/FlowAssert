/**
 * The destination rows of HubSpot's contacts, read-only, page by page (docs/connectors/hubspot.md), as
 * offline/flowassert_offline/hubspot.py reads them: the same requests, checks, refusals, rows, canonical form and report
 * member. Requests go through a transport (connector.ts); the token never comes here, only whether one is set and has
 * the form the command line accepts.
 */
import { canonicalRow, errorStatus, getJson, has, isObject, notJson, notUnicode, urlencode, type ConnectorHost } from "./connector";
import { Refused, sha256Hex } from "./csv";
import { pyRepr } from "./pystr";
import { CREDENTIAL, testEndpoint } from "./sheets";

export const HOST = "api.hubapi.com";
const PATH = "/crm/v3/objects/contacts";
export const OBJECTS = ["contacts"] as const;
const SERVICE = "HubSpot CRM API v3";
export const TIMEOUT = 60;
const PAGE_LIMIT = 100;
const CANONICAL_FORM = "flowassert-hubspot-csv-1";
const WHAT = "HubSpot contacts";
export const TOKEN_VARIABLE = "FLOWASSERT_HUBSPOT_TOKEN";
export const ENDPOINT_VARIABLE = "FLOWASSERT_HUBSPOT_TEST_ENDPOINT";

const PROPERTY = /^[A-Za-z0-9_]{1,100}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;

/** The token's presence and form, checked as the command line checks it. */
export function credential(environ: ConnectorHost["environ"]): void {
  const token = environ[TOKEN_VARIABLE];
  if (token === undefined) throw new Refused(`no credential: set ${TOKEN_VARIABLE} to a private app access token with the scope crm.objects.contacts.read only`);
  if (!CREDENTIAL.test(token)) throw new Refused(`${TOKEN_VARIABLE} does not hold a credential: printable ASCII without spaces, at most 4096 characters`);
}

export function checkProperty(name: string) {
  if (!PROPERTY.test(name)) throw new Refused(`HubSpot property name ${pyRepr(name)} must be letters, digits and _, at most 100 characters`);
}

function statusRefusal(code: number, body: Uint8Array): Refused {
  const s = errorStatus(body, (data) => (has(data, "category") ? data.category : data.errorType));
  if (code === 400) return new Refused(`${WHAT}: the request was not accepted (HTTP 400${s})`);
  if (code === 401) return new Refused(`${WHAT}: the credential was not accepted (HTTP 401${s}); it may have expired or been rotated`);
  if (code === 403) return new Refused(`${WHAT}: access was denied (HTTP 403${s}); the token may lack the scope crm.objects.contacts.read`);
  if (code === 404) return new Refused(`${WHAT}: not found (HTTP 404${s})`);
  if (code === 429) return new Refused(`${WHAT}: rate limited (HTTP 429${s}); FlowAssert does not retry: wait, then run the check again`);
  if (code >= 500 && code <= 599) return new Refused(`${WHAT}: server error (HTTP ${code}${s}); FlowAssert does not retry: run the check again later`);
  return new Refused(`${WHAT}: unexpected response (HTTP ${code}${s})`);
}

export interface HubSpotMember {
  read_by: "FlowAssert";
  service: string;
  object: string;
  properties: string[];
  archived_excluded: true;
  page_limit: number;
  pages: number;
  rows: number;
  read_at: string;
  read_finished_at: string;
  canonical_form: string;
}

/** The destination rows of one HubSpot object, read once, as HubSpotDestination does. */
export class HubSpotDestination {
  readonly object: string;
  private readonly host: ConnectorHost;
  readonly maxBytes: number;
  readonly timeout: number;
  columns: string[] = [];
  maxRows: bigint | null = null;
  sha256: string | null = null;
  count: number | null = null;
  pages: number | null = null;
  member: HubSpotMember | null = null;
  /** With records to resend and scope exact, the records listed, kept for the destination-only rows. */
  kept: string[][] | null = null;

  constructor(objectName: string, options: { maxBytes: bigint; timeout?: number; host: ConnectorHost }) {
    if (!(OBJECTS as readonly string[]).includes(objectName)) throw new Refused("--destination-hubspot must be contacts");
    this.object = objectName;
    credential(options.host.environ);
    testEndpoint(options.host.environ, ENDPOINT_VARIABLE);
    this.host = options.host;
    this.maxBytes = Number(options.maxBytes);
    this.timeout = options.timeout ?? TIMEOUT;
  }

  select(columns: string[], maxRows: bigint) {
    for (const name of columns) checkProperty(name);
    this.columns = [...new Set(columns)];
    this.maxRows = maxRows;
  }

  private get(after: string | null) {
    const query: [string, string][] = [
      ["limit", String(PAGE_LIMIT)],
      ["archived", "false"],
      ["properties", this.columns.join(",")],
    ];
    if (after !== null) query.push(["after", after]);
    const request = { service: "hubspot" as const, host: HOST, target: PATH + "?" + urlencode(query, ","), credential: "token" as const, timeout: this.timeout, maxBytes: this.maxBytes };
    return getJson(this.host, request, WHAT, statusRefusal);
  }

  /** The records of one page, checked, and the cursor of the next page or null. */
  private records(data: Awaited<ReturnType<HubSpotDestination["get"]>>, page: number): [[string, string[]][], string | null] {
    const results = data.results;
    if (!Array.isArray(results)) throw notJson(WHAT, "results is not a list");
    if (results.length > PAGE_LIMIT) throw new Refused(`${WHAT}: page ${page} has more than ${PAGE_LIMIT} records`);
    const paging = data.paging;
    let after: string | null = null;
    if (paging !== undefined && paging !== null) {
      if (!isObject(paging)) throw notJson(WHAT, "paging is not an object");
      const following = paging.next;
      if (following !== undefined && following !== null) {
        if (!isObject(following) || typeof following.after !== "string") throw notJson(WHAT, "paging.next.after is not a string");
        after = following.after;
        if (!CURSOR.test(after)) throw new Refused(`${WHAT}: page ${page} gives a paging cursor that FlowAssert cannot send back unchanged`);
      }
    }
    const records: [string, string[]][] = [];
    for (const record of results) {
      if (!isObject(record) || typeof record.id !== "string" || !record.id) throw notJson(WHAT, "a record has no id");
      const properties = record.properties;
      if (!isObject(properties)) throw notJson(WHAT, "a record has no properties");
      const archived = has(record, "archived") ? record.archived : false;
      if (typeof archived !== "boolean") throw notJson(WHAT, "archived is not true or false");
      if (archived) throw new Refused(`${WHAT}: page ${page} lists an archived record, and the read asked for none`);
      const values: string[] = [];
      for (const name of this.columns) {
        if (!has(properties, name)) throw new Refused(`${WHAT}: page ${page} has a record without the property ${pyRepr(name)}; HubSpot leaves out a property the object does not have`);
        let value = properties[name];
        if (value === null) value = "";
        else if (typeof value !== "string") throw new Refused(`${WHAT}: page ${page} has a property value that is not text`);
        if (notUnicode(value)) throw notJson(WHAT, "a value is not valid Unicode");
        values.push(value);
      }
      records.push([record.id, values]);
    }
    if (after !== null && !records.length) throw new Refused(`${WHAT}: page ${page} has a next page and no records`);
    return [records, after];
  }

  /** Lists every page and gives each record's values in the order selected; then sha256, count, pages and member. */
  async rows(onRow: (values: string[]) => void): Promise<void> {
    const text: string[] = [canonicalRow(this.columns)];
    const seen = new Map<string, number>();
    const cursors = new Set<string>();
    let count = 0;
    let page = 0;
    let after: string | null = null;
    const readAt = this.host.now();
    for (;;) {
      page++;
      const [records, following] = this.records(await this.get(after), page);
      for (const [id, values] of records) {
        const first = seen.get(id);
        if (first !== undefined) throw new Refused(`${WHAT}: record ID appears twice (pages ${first} and ${page}): the list changed while it was read; run the check again`);
        seen.set(id, page);
        if (BigInt(count) === this.maxRows) throw new Refused(`${WHAT}: exceeds --max-rows limit of ${this.maxRows}`);
        count++;
        text.push(canonicalRow(values));
        this.kept?.push(values);
        onRow(values);
      }
      if (following === null) break;
      if (cursors.has(following)) throw new Refused(`${WHAT}: page ${page} repeats an earlier paging cursor`);
      cursors.add(following);
      after = following;
    }
    const finishedAt = this.host.now();
    this.count = count;
    this.pages = page;
    this.sha256 = await sha256Hex(new TextEncoder().encode(text.join("")));
    this.member = {
      read_by: "FlowAssert",
      service: SERVICE,
      object: this.object,
      properties: [...this.columns],
      archived_excluded: true,
      page_limit: PAGE_LIMIT,
      pages: page,
      rows: count,
      read_at: readAt,
      read_finished_at: finishedAt,
      canonical_form: CANONICAL_FORM,
    };
  }

  /** The header, then every record kept: what the records to resend read again (cli._rows_again). */
  *fullRows(): Generator<string[]> {
    yield [...this.columns];
    for (const values of this.kept ?? []) yield [...values];
  }
}
