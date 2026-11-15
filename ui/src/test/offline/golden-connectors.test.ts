/**
 * The TypeScript connectors (sheets.ts, hubspot.ts) against every case of offline/golden-sheets/ and
 * offline/golden-hubspot/, written by offline/bench/golden.py with the command line and a local fake of each service.
 * Each case runs through the TypeScript check with the same arguments and environment, and a transport that answers as
 * the fakes answer (offline/bench/fake_sheets_api.py, fake_hubspot_api.py): the recorded responses in order, a 401
 * to a request without the expected credential, a 599 when none is left. The requests sent, the exit status, the
 * summary, the refusal and both reports must be the command line's, byte for byte; read_at and evaluated_at are fixed
 * as golden.py fixes them. Nothing here contacts Google or HubSpot.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, reportHtml, reportJson } from "../../offline/check";
import type { Transport, TransportRequest } from "../../offline/connector";
import { HubSpotDestination } from "../../offline/hubspot";
import { SheetSource } from "../../offline/sheets";
import { pyDumps, type PyValue } from "../../offline/pyjson";
import { compareCodePoints } from "../../offline/pystr";
import { REPO_ROOT } from "../fixtures/sources";
import { parseAnyArgs } from "./cli-args";

const SHEETS_TOKEN = "fake-oauth-token-FA7-not-a-real-credential";
const SHEETS_KEY = "fake-api-key-FA7-not-a-real-credential";
const HUBSPOT_TOKEN = "pat-na1-fake-FA10-not-a-real-credential";
const NOW = () => "2000-01-01T00:00:00Z";
const HOSTS = { sheets: ["sheets.googleapis.com", "www.googleapis.com"], hubspot: ["api.hubapi.com"] };

interface Case {
  args: string[];
  credential: "token" | "key" | "both" | null;
  env: Record<string, string>;
}
interface Response {
  status: number;
  json?: PyValue;
  text?: string;
}

const text = (folder: string, file: string) => (existsSync(join(folder, file)) ? readFileSync(join(folder, file), "utf-8") : null);
const cases = (kind: "sheets" | "hubspot") => {
  const root = join(REPO_ROOT, "offline", kind === "sheets" ? "golden-sheets" : "golden-hubspot");
  return readdirSync(root).sort(compareCodePoints).map((name) => [name, join(root, name)] as const);
};

/** golden._sheet_environ and _hubspot_environ: the fake's endpoint and a fake credential, then the case's own values. */
function environOf(kind: "sheets" | "hubspot", c: Case): Record<string, string> {
  if (kind === "hubspot") return { FLOWASSERT_HUBSPOT_TEST_ENDPOINT: "http://127.0.0.1:9", ...(c.credential === "token" ? { FLOWASSERT_HUBSPOT_TOKEN: HUBSPOT_TOKEN } : {}), ...c.env };
  return {
    FLOWASSERT_SHEETS_TEST_ENDPOINT: "http://127.0.0.1:9",
    ...(c.credential === "token" || c.credential === "both" ? { FLOWASSERT_SHEETS_TOKEN: SHEETS_TOKEN } : {}),
    ...(c.credential === "key" || c.credential === "both" ? { FLOWASSERT_SHEETS_API_KEY: SHEETS_KEY } : {}),
    ...c.env,
  };
}

const error = (status: number, json: PyValue): Response => ({ status, json });

/** A transport that answers as the local fake does, and records each request as requests.json records it. */
function fake(kind: "sheets" | "hubspot", folder: string, c: Case, environ: Record<string, string>) {
  const file = join(folder, kind === "sheets" ? "sheet-responses.json" : "hubspot-responses.json");
  const responses = existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as Record<string, Response[]> | Response[]) : kind === "sheets" ? {} : [];
  const queue = (name: string) => (Array.isArray(responses) ? responses : (responses[name] ??= []));
  const requests: [string, string, [string, string][]][] = [];
  const transport: Transport = async (r: TransportRequest) => {
    expect(HOSTS[kind]).toContain(r.host);
    expect(r.service).toBe(kind);
    const [path, query = ""] = r.target.split("?");
    const pairs = new URLSearchParams(query.replaceAll("+", "%2B"));
    const recorded: [string, string][] = [...pairs.entries()];
    // The transport adds the credential: an API key as the last query parameter, a token as a header.
    const variable = kind === "hubspot" ? "FLOWASSERT_HUBSPOT_TOKEN" : r.credential === "key" ? "FLOWASSERT_SHEETS_API_KEY" : "FLOWASSERT_SHEETS_TOKEN";
    if (r.credential === "key") recorded.push(["key", variable]);
    requests.push(["GET", path!, recorded]);
    const expected = kind === "hubspot" ? ["token", HUBSPOT_TOKEN] : c.credential === "key" ? ["key", SHEETS_KEY] : ["token", SHEETS_TOKEN];
    let response: Response | undefined;
    if (kind === "sheets" && !path!.startsWith("/drive/v3/files/") && !(path!.startsWith("/v4/spreadsheets/") && path!.includes("/values/"))) response = error(404, { error: { code: 404, status: "NOT_FOUND" } });
    else if (kind === "hubspot" && path !== "/crm/v3/objects/contacts") response = error(404, { status: "error", category: "OBJECT_NOT_FOUND" });
    else if (r.credential !== expected[0] || environ[variable] !== expected[1]) {
      response = kind === "hubspot" ? error(401, { status: "error", message: "x", category: "INVALID_AUTHENTICATION" }) : error(401, { error: { code: 401, status: "UNAUTHENTICATED" } });
    } else {
      response = queue(kind === "hubspot" ? "pages" : path!.startsWith("/drive/") ? "drive" : "values").shift() ?? error(599, { error: { code: 599, status: "NO_RESPONSE_LEFT" } });
    }
    const body = new TextEncoder().encode(response.json !== undefined ? pyDumps(response.json) : (response.text ?? ""));
    return { status: response.status, body };
  };
  return { transport, requests };
}

describe.each(["sheets", "hubspot"] as const)("golden %s cases, through the TypeScript connectors", (kind) => {
  test("the folder holds the cases golden.py writes", () => {
    expect(cases(kind).length).toBe(kind === "sheets" ? 42 : 39);
  });

  test.each(cases(kind))("%s", async (_name, folder) => {
    const c = JSON.parse(readFileSync(join(folder, "case.json"), "utf-8")) as Case;
    const environ = environOf(kind, c);
    const { transport, requests } = fake(kind, folder, c, environ);
    const outcome = await check({ ...parseAnyArgs(c.args, folder), connectors: { environ, transport, readers: { sheet: SheetSource, hubspot: HubSpotDestination } }, now: NOW });
    expect({
      exit: outcome.exit,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      json: outcome.report ? reportJson(outcome.report) : null,
      html: outcome.report ? reportHtml(outcome.report) : null,
    }).toEqual({
      exit: Number(text(folder, "exit_status.txt")),
      stdout: text(folder, "stdout.txt"),
      stderr: text(folder, "stderr.txt"),
      json: text(folder, "report.json"),
      html: text(folder, "report.html"),
    });
    const sent = existsSync(join(folder, "requests.json")) ? JSON.parse(readFileSync(join(folder, "requests.json"), "utf-8")) : [];
    expect(requests).toEqual(sent);
  });
});

// ---------- The records to resend, against the command line run with --export-dir (offline/bench/connector_exports.py) ----------

const PYTHON = process.env.FA_PYTHON ?? "python3";
const REQUIRED = process.env.FA_PARITY_REQUIRED === "1";
function pythonVersion(): [number, number] | null {
  try {
    const [major, minor] = execFileSync(PYTHON, ["-c", "import sys; print(sys.version_info[0], sys.version_info[1])"], { encoding: "utf-8" }).trim().split(" ").map(Number);
    return [major!, minor!];
  } catch {
    return null;
  }
}
const version = pythonVersion();
const usable = version !== null && (version[0] > 3 || (version[0] === 3 && version[1] >= 9));
const skip = !usable && !REQUIRED;

interface Exported {
  exit: number;
  stdout: string;
  stderr: string;
  files: Record<string, string> | null;
}

const python = (roots: string[]) =>
  JSON.parse(execFileSync(PYTHON, [join(REPO_ROOT, "offline/bench/connector_exports.py"), ...roots], { encoding: "utf-8", maxBuffer: 1 << 28 })) as Record<string, Exported>;

async function typescript(kind: "sheets" | "hubspot", folder: string): Promise<Exported> {
  const c = JSON.parse(readFileSync(join(folder, "case.json"), "utf-8")) as Case;
  const environ = environOf(kind, c);
  const { transport } = fake(kind, folder, c, environ);
  const outcome = await check({ ...parseAnyArgs(c.args, folder), exportDir: "records-to-resend", connectors: { environ, transport, readers: { sheet: SheetSource, hubspot: HubSpotDestination } }, now: NOW });
  const hex = (text: string) => Buffer.from(text, "utf-8").toString("hex");
  return {
    exit: outcome.exit,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    files: outcome.exports ? Object.fromEntries(outcome.exports.files.map((f) => [f.file, hex(f.text)]).sort(([a], [b]) => compareCodePoints(a!, b!))) : outcome.exit === 2 ? null : {},
  };
}

/** A HubSpot destination with scope exact: the records kept from the one listing make the destination-only file. */
function exactHubSpotCase(root: string): string {
  const folder = join(root, "golden-hubspot", "hubspot-exact-exports");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "source.csv"), "external_id,email\nX-1,a@example.test\nX-2,b@example.test\n");
  const contact = (id: string, key: string, email: string | null) => ({ id, properties: { external_id: key, email }, createdAt: "2026-11-01T09:00:00.000Z", updatedAt: "2026-11-01T09:00:00.000Z", archived: false });
  const responses = [
    { status: 200, json: { results: [contact("1", "X-1", "a@example.test"), contact("2", "X-3", "c@example.test")], paging: { next: { after: "3" } } } },
    { status: 200, json: { results: [contact("3", "X-4", null)] } },
  ];
  writeFileSync(join(folder, "hubspot-responses.json"), JSON.stringify(responses));
  writeFileSync(join(folder, "case.json"), JSON.stringify({ name: "hubspot-exact-exports", args: ["--source", "source.csv", "--destination-hubspot", "contacts", "--key", "external_id", "--field", "email", "--scope", "exact", "--source-complete", "--destination-complete"], credential: "token", env: {} }));
  return join(root, "golden-hubspot");
}

describe.skipIf(skip)(skip ? `connector exports need Python 3.9 or later as ${PYTHON}` : "the records to resend of every connector case", () => {
  test("are the command line's files, byte for byte, with the same summary", { timeout: 600_000 }, async () => {
    const tmp = mkdtempSync(join(tmpdir(), "fa-connector-exports-"));
    try {
      const generated = exactHubSpotCase(tmp);
      const roots = [join(REPO_ROOT, "offline/golden-sheets"), join(REPO_ROOT, "offline/golden-hubspot"), generated];
      const expected = python(roots);
      expect(Object.keys(expected).length).toBe(82);
      let exported = 0;
      for (const root of roots) {
        const kind = root.endsWith("golden-sheets") ? "sheets" : "hubspot";
        for (const name of readdirSync(root).sort(compareCodePoints)) {
          const want = expected[`${root.split("/").pop()}/${name}`]!;
          if (want.files && Object.keys(want.files).length) exported++;
          expect({ name, ...(await typescript(kind, join(root, name))) }).toEqual({ name, ...want });
        }
      }
      // The cases give files of every kind a connector side can give, including only-in-destination.csv from HubSpot.
      expect(exported).toBe(11);
      expect(Object.keys(expected["golden-hubspot/hubspot-exact-exports"]!.files!)).toContain("only-in-destination.csv");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
