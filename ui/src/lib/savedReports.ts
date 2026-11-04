/**
 * Saved reports: JSON reports the person chose to keep in this browser, from the CSV check page ("Keep this report in
 * this browser") or imported from a file. Nothing is stored unless the person asks, each time: no check stores
 * anything by itself, and no setting turns saving on. The CSV files are never stored, only the report.
 *
 * Each entry holds an id, when it was saved, how it was obtained, the report's original bytes and the few summary
 * fields the list shows; nothing else. The bytes are read again (savedReport.ts) whenever a report is opened or
 * compared, so what the pages show always comes from the report itself, never from the summary.
 *
 * In the browser the entries are in one IndexedDB database of this origin, `flowassert-saved-reports`, which anyone
 * using this browser profile can read. Reading never creates it: a check without "Keep" leaves no database at all, and
 * "Delete all" deletes the database. No request is made. The unit tests use the in-memory store.
 */
import { createContext, useContext } from "react";
import type { Counts, Details, State } from "../offline/evaluator";
import type { ReadReport } from "../offline/savedReport";

export const DATABASE = "flowassert-saved-reports";
const DATABASE_VERSION = 1;
/** The entries without their bytes, so the list never reads every report. */
const ENTRIES = "entries";
/** Each entry's original bytes, under its id. */
const BYTES = "bytes";

export type Obtained = { kind: "checked" } | { kind: "imported"; fileName: string };

/** What the list shows of a report, taken from it when it was saved. */
export interface EntrySummary {
  evaluatedAt: string;
  cohortState: State;
  counts: Counts;
  destinationOnlyCounts: Counts | null;
  key: [string, string];
  fields: [string, string][];
  redacted: boolean;
  details: Details;
  /** The report's size in bytes. */
  size: number;
}

export interface SavedEntry {
  id: string;
  /** When it was saved, as UTC ISO 8601. */
  savedAt: string;
  obtained: Obtained;
  summary: EntrySummary;
}

export interface ReportStore {
  /** Where the entries are, in words, for the page to show. */
  readonly where: string;
  /** Every entry, the most recently saved first. An empty list when nothing was ever saved. */
  list(): Promise<SavedEntry[]>;
  entry(id: string): Promise<SavedEntry | null>;
  /** The original bytes of an entry, or null when there is no such entry. */
  bytes(id: string): Promise<Uint8Array | null>;
  add(read: ReadReport, obtained: Obtained): Promise<SavedEntry>;
  remove(id: string): Promise<void>;
  /** Delete every entry; in the browser, the database itself. */
  removeAll(): Promise<void>;
}

/**
 * Storage cannot be used: nothing was saved. The check and everything not stored still work. `reason` is a sentence
 * for the page; `detail` is what the browser said, kept as it said it.
 */
export class StorageUnavailable extends Error {
  readonly reason: string;
  readonly detail: string;
  constructor(reason: string, detail = "") {
    super(detail ? `${reason} (${detail})` : reason);
    this.reason = reason;
    this.detail = detail;
  }
}

export function summarize(read: ReadReport): EntrySummary {
  const r = read.report;
  return {
    evaluatedAt: r.evaluated_at,
    cohortState: r.cohort_state,
    counts: { ...r.counts },
    destinationOnlyCounts: r.destination_only_counts ? { ...r.destination_only_counts } : null,
    key: [...r.obligation.key],
    fields: r.obligation.fields.map(([s, d]) => [s, d]),
    redacted: read.redacted,
    details: r.details,
    size: read.bytes.length,
  };
}

function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function entryOf(read: ReadReport, obtained: Obtained): SavedEntry {
  return { id: newId(), savedAt: new Date().toISOString(), obtained, summary: summarize(read) };
}

const newestFirst = (a: SavedEntry, b: SavedEntry) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0);

/* ---------- In memory, for the unit tests ---------- */

export function memoryStore(): ReportStore & { readonly size: number } {
  const entries = new Map<string, { entry: SavedEntry; bytes: Uint8Array }>();
  return {
    where: "memory of this page (tests only)",
    get size() {
      return entries.size;
    },
    list: async () => [...entries.values()].map((e) => e.entry).sort(newestFirst),
    entry: async (id) => entries.get(id)?.entry ?? null,
    bytes: async (id) => entries.get(id)?.bytes.slice() ?? null,
    async add(read, obtained) {
      const entry = entryOf(read, obtained);
      entries.set(entry.id, { entry, bytes: read.bytes.slice() });
      return entry;
    },
    remove: async (id) => void entries.delete(id),
    removeAll: async () => entries.clear(),
  };
}

/* ---------- IndexedDB, in the browser ---------- */

/** Why storage could not be used, in words; the DOMException's name is kept, for anyone who needs to look it up. */
function unavailable(e: unknown): StorageUnavailable {
  const name = e instanceof DOMException || e instanceof Error ? e.name : "";
  const why =
    name === "QuotaExceededError"
      ? "There is not enough storage space in this browser."
      : name === "SecurityError"
        ? "This browser blocks storage for this page."
        : name === "InvalidStateError"
          ? "Storage is not available in this window, as in a private window."
          : name === "AbortError" || name === "UnknownError"
            ? "The browser stopped the storage request."
            : "The browser refused storage.";
  const detail = e instanceof Error && e.message ? `${name}: ${e.message}` : name || String(e);
  return new StorageUnavailable(why, detail);
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(unavailable(tx.error));
    tx.onabort = () => reject(unavailable(tx.error ?? new DOMException("the transaction was aborted", "AbortError")));
  });

const result = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(unavailable(request.error));
  });

function factory(): IDBFactory {
  try {
    if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB;
  } catch (e) {
    throw unavailable(e);
  }
  throw new StorageUnavailable("This browser offers no IndexedDB storage here.");
}

/**
 * Open the database. For reading (`create` false) a database that does not exist yet is never created: null is
 * returned, the list is empty, and nothing is left behind.
 */
async function open(create: boolean): Promise<IDBDatabase | null> {
  const idb = factory();
  if (!create && typeof idb.databases === "function") {
    try {
      if (!(await idb.databases()).some((d) => d.name === DATABASE)) return null;
    } catch (e) {
      throw unavailable(e);
    }
  }
  let request: IDBOpenDBRequest;
  try {
    request = idb.open(DATABASE, DATABASE_VERSION);
  } catch (e) {
    throw unavailable(e);
  }
  return new Promise((resolve, reject) => {
    let declined = false;
    request.onupgradeneeded = (event) => {
      // A read where no database exists yet: abort the upgrade, which removes the database it would create.
      if (!create && event.oldVersion === 0) {
        declined = true;
        request.transaction?.abort();
        return;
      }
      const db = request.result;
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BYTES)) db.createObjectStore(BYTES);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab deleting every entry closes this connection rather than waiting for it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = (event) => {
      if (declined) {
        event.preventDefault();
        resolve(null);
      } else reject(unavailable(request.error));
    };
  });
}

async function using<T>(create: boolean, empty: T, use: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await open(create);
  if (!db) return empty;
  try {
    return await use(db);
  } finally {
    db.close();
  }
}

export function indexedDbStore(): ReportStore {
  return {
    where: `IndexedDB database “${DATABASE}” of this site, in this browser profile`,
    list: () => using(false, [], async (db) => ((await result(db.transaction(ENTRIES).objectStore(ENTRIES).getAll())) as SavedEntry[]).sort(newestFirst)),
    entry: (id) => using(false, null, async (db) => ((await result(db.transaction(ENTRIES).objectStore(ENTRIES).get(id))) as SavedEntry | undefined) ?? null),
    bytes: (id) =>
      using(false, null, async (db) => {
        const value = (await result(db.transaction(BYTES).objectStore(BYTES).get(id))) as Uint8Array | undefined;
        return value ? new Uint8Array(value) : null;
      }),
    add: (read, obtained) =>
      using(true, null as unknown as SavedEntry, async (db) => {
        const entry = entryOf(read, obtained);
        let tx: IDBTransaction;
        try {
          tx = db.transaction([ENTRIES, BYTES], "readwrite");
          tx.objectStore(ENTRIES).add(entry);
          tx.objectStore(BYTES).add(read.bytes.slice(), entry.id);
        } catch (e) {
          throw unavailable(e);
        }
        await done(tx);
        return entry;
      }),
    remove: (id) =>
      using(false, undefined, async (db) => {
        const tx = db.transaction([ENTRIES, BYTES], "readwrite");
        tx.objectStore(ENTRIES).delete(id);
        tx.objectStore(BYTES).delete(id);
        await done(tx);
      }),
    async removeAll() {
      const idb = factory();
      await new Promise<void>((resolve, reject) => {
        const request = idb.deleteDatabase(DATABASE);
        request.onsuccess = () => resolve();
        // A connection of another tab closes itself on versionchange (see open), so a block ends on its own.
        request.onerror = () => reject(unavailable(request.error));
      });
    },
  };
}

/* ---------- The store the pages use ---------- */

let browserStore: ReportStore | null = null;

/** The pages' store: IndexedDB unless a test provides another. Creating it touches no storage. */
export const ReportStoreContext = createContext<ReportStore | null>(null);

export function useReportStore(): ReportStore {
  return useContext(ReportStoreContext) ?? (browserStore ??= indexedDbStore());
}
