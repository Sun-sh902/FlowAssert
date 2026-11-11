/**
 * The file profile and the lines before a check (offline/profile.ts) are read by the code the check uses, so they
 * cannot disagree with the report (docs/design/1.0-browser.md, "One code path for one number"):
 *
 *  - For every golden case, scenarios included: the profile's data rows are the rows the report records on each side;
 *    a file the check refuses while reading it is refused by the profile with the same message; and a file the
 *    profile refuses is the file the check refuses.
 *  - The key profile's rows without a key and repeated keys are those the report's records show.
 *  - A line about a stated total is shown exactly when the report records that total as not matching.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { bytesStream, type Encoding } from "../../offline/csv";
import { beforeYouCheck, bomOf, keyProfileCsv, profileCsv, type FileProfile, type KeyProfile, type ProfileSource, type SideFacts } from "../../offline/profile";
import { compareCodePoints } from "../../offline/pystr";
import { REPO_ROOT } from "../fixtures/sources";
import { parseArgs } from "./cli-args";

const GOLDEN = join(REPO_ROOT, "offline/golden");
const names = readdirSync(GOLDEN).sort(compareCodePoints);

const source = (name: string, bytes: Uint8Array, encoding: Encoding): ProfileSource => ({
  name,
  size: bytes.length,
  encoding,
  open: () => bytesStream(bytes),
  head: () => Promise.resolve(bytes.slice(0, 4)),
});

interface ReportRecord {
  key?: string | null;
  source_row: number;
  state: string;
  rules?: Record<string, { status: string; reason: string }>;
}
interface ReportPremise {
  stated: unknown;
  observed?: number;
  matched?: boolean | null;
}
interface Report {
  source_rows_observed: number;
  destination_rows_without_key: number;
  premises: Record<string, ReportPremise>;
  records: ReportRecord[];
  details?: { records?: string; max_details?: number };
  obligation: { key: [string, string] };
}

const read = (folder: string, file: string) => {
  try {
    return readFileSync(join(folder, file), "utf-8");
  } catch {
    return null;
  }
};

const encodingOf = (value: string | undefined): Encoding => (value === "utf-16" || value === "gb18030" ? value : "utf-8");
const CHOSEN_LIMITS = /^--max-(rows|bytes)$/;

describe("the file profile agrees with the report of every golden case", () => {
  test.each(names)("%s", async (name) => {
    const folder = join(GOLDEN, name);
    const argv = (JSON.parse(readFileSync(join(folder, "case.json"), "utf-8")) as { args: string[] }).args;
    const args = parseArgs(argv, folder);
    const exit = Number(read(folder, "exit_status.txt"));
    const stderr = read(folder, "stderr.txt") ?? "";
    const report = read(folder, "report.json");
    const profiles = new Map<string, Awaited<ReturnType<typeof profileCsv>>>();
    for (const [file, encoding] of [
      [args.source, args.sourceEncoding],
      [args.destination, args.destinationEncoding],
    ] as const) {
      // An encoding the page does not offer is refused before any file is read.
      if (encoding !== undefined && !["utf-8", "utf-16", "gb18030"].includes(encoding)) return;
      profiles.set(file.name, await profileCsv(source(file.name, await file.read(), encodingOf(encoding))));
    }
    const sourceProfile = profiles.get(args.source.name)!;
    const destinationProfile = profiles.get(args.destination.name)!;
    // The page offers only the default limits; a case that chose others is compared only where it has a report.
    const ownLimits = argv.some((a) => CHOSEN_LIMITS.test(a));

    if (report !== null) {
      const r = JSON.parse(report) as Report;
      expect(sourceProfile.ok && destinationProfile.ok).toBe(true);
      if (!sourceProfile.ok || !destinationProfile.ok) return;
      expect(sourceProfile.profile.rows).toBe(r.source_rows_observed);
      expect(sourceProfile.profile.rows).toBe(r.premises.source_count!.observed);
      expect(destinationProfile.profile.rows).toBe(r.premises.destination_count!.observed);

      // The key profiles, counted by the class the check counts keys with.
      const [sourceKey, destinationKey] = r.obligation.key;
      const sk = await keyProfileCsv(source(args.source.name, await args.source.read(), encodingOf(args.sourceEncoding)), sourceKey);
      const dk = await keyProfileCsv(source(args.destination.name, await args.destination.read(), encodingOf(args.destinationEncoding)), destinationKey);
      expect(sk.ok && dk.ok).toBe(true);
      if (!sk.ok || !dk.ok) return;
      expect(sk.key.rows).toBe(r.source_rows_observed);
      expect(dk.key.rows).toBe(destinationProfile.profile.rows);
      expect(dk.key.withoutKey).toBe(r.destination_rows_without_key);
      // Every record is listed when no limit cut the list and keys are not redacted.
      const complete = r.records.length === r.source_rows_observed && r.records.every((x) => "key" in x);
      if (complete) {
        const invalid = r.records.filter((x) => x.rules && Object.values(x.rules).some((rule) => rule.reason === "invalid or duplicate source key"));
        expect(sk.key.withoutKey).toBe(r.records.filter((x) => x.key === null).length);
        expect(sk.key.repeatedKeys).toBe(new Set(invalid.filter((x) => x.key !== null).map((x) => x.key)).size);
      }
      const uniquenessFails = r.records.some((x) => x.rules?.uniqueness?.reason === "more than one destination row carries this key");
      if (uniquenessFails) expect(dk.key.repeatedKeys).toBeGreaterThan(0);

      // A line about a stated total appears exactly when the report records it as not matching.
      const facts = (side: "source" | "destination", profile: FileProfile, key: KeyProfile): SideFacts => ({
        fileName: side === "source" ? args.source.name : args.destination.name,
        profile,
        key,
        columns: [],
        complete: r.premises[`${side}_complete`]!.stated === true,
        count: r.premises[`${side}_count`]!.stated === null ? "" : String(r.premises[`${side}_count`]!.stated),
      });
      const lines = beforeYouCheck(facts("source", sourceProfile.profile, sk.key), facts("destination", destinationProfile.profile, dk.key)).map((l) => l.id);
      for (const side of ["source", "destination"] as const) {
        expect(lines.includes(`${side}-count`)).toBe(r.premises[`${side}_count`]!.matched === false);
      }
      // A repeated or missing source key is announced exactly when the report has a record with that reason.
      if (complete) {
        const announced = lines.includes("source-without-key") || lines.includes("source-repeated-key");
        expect(announced).toBe(r.records.some((x) => x.rules && Object.values(x.rules).some((rule) => rule.reason === "invalid or duplicate source key")));
      }
      expect(lines.includes("destination-without-key")).toBe(r.destination_rows_without_key > 0);
      return;
    }

    // No report. A refusal that names a file the profile reads is the profile's refusal of that file.
    if (exit !== 2 || ownLimits) return;
    const message = stderr.replace(/^refused: /, "").trimEnd();
    // The check reads the source before the destination, so the first file the profile refuses is the one refused.
    const firstRefused = [sourceProfile, destinationProfile].find((p) => !p.ok);
    const named = [args.source.name, args.destination.name].find((file) => message.startsWith(`${file}: `));
    if (!named) return;
    const profile = profiles.get(named)!;
    if (profile.ok) {
      // The file reads well: the refusal comes from the columns chosen, which the profile does not choose.
      expect(message).toMatch(/: missing column /);
    } else {
      expect(profile.message).toBe(message);
      expect(firstRefused).toBe(profile);
    }
  });
});

describe("the parts of a profile", () => {
  test("the byte order mark is read for the chosen encoding", () => {
    const b = (...bytes: number[]) => new Uint8Array(bytes);
    expect(bomOf(b(0xef, 0xbb, 0xbf, 0x61), "utf-8")).toBe("utf-8");
    expect(bomOf(b(0x61, 0x62), "utf-8")).toBe("none");
    expect(bomOf(b(0xff, 0xfe, 0x61, 0), "utf-16")).toBe("utf-16-le");
    expect(bomOf(b(0xfe, 0xff, 0, 0x61), "utf-16")).toBe("utf-16-be");
    expect(bomOf(b(0x84, 0x31, 0x95, 0x33), "gb18030")).toBe("gb18030");
    expect(bomOf(b(0xef, 0xbb, 0xbf), "gb18030")).toBe("none");
  });

  test("empty cells are counted per column, blank lines are not rows, and line endings are counted", async () => {
    const bytes = new TextEncoder().encode('id,phone,note\r\n1,,a\r\n\r\n2,5,"x\ny"\r\n3,,\n');
    const p = await profileCsv(source("s.csv", bytes, "utf-8"));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.profile.rows).toBe(3);
    expect(p.profile.columns).toEqual([
      { name: "id", empty: 0 },
      { name: "phone", empty: 2 },
      { name: "note", empty: 1 },
    ]);
    expect(p.profile.endings).toEqual({ lf: 2, crlf: 4, cr: 0 });
    expect(p.profile.bom).toBe("none");
    expect(p.profile.size).toBe(bytes.length);
  });

  test("a file larger than the limit is refused before it is read, with the check's message", async () => {
    const opened: string[] = [];
    const big: ProfileSource = { name: "big.csv", size: 209_715_201, encoding: "utf-8", open: () => (opened.push("x"), bytesStream(new Uint8Array())), head: () => Promise.resolve(new Uint8Array()) };
    expect(await profileCsv(big)).toEqual({ ok: false, message: "big.csv: file size 209715201 bytes exceeds --max-bytes limit of 209715200" });
    expect(opened).toEqual([]);
  });

  test("a profile that is given up rejects and reports nothing more", async () => {
    const rows = ["id", ...Array.from({ length: 10_000 }, (_, i) => String(i))].join("\n") + "\n";
    let seen = 0;
    const p = profileCsv(source("s.csv", new TextEncoder().encode(rows), "utf-8"), (n) => (seen = n), () => seen >= 4096);
    await expect(p).rejects.toThrow();
    expect(seen).toBe(4096);
  });
});

describe("the lines before a check", () => {
  const profile = (rows: number, columns: string[]): FileProfile => ({ rows, columns: columns.map((name) => ({ name, empty: 0 })), encoding: "utf-8", bom: "none", endings: { lf: rows + 1, crlf: 0, cr: 0 }, size: 1 });
  const side = (over: Partial<SideFacts>): SideFacts => ({ fileName: "f.csv", profile: profile(4, ["id", "phone"]), key: null, columns: ["id", "phone"], complete: false, count: "", ...over });
  const text = (lines: ReturnType<typeof beforeYouCheck>) => lines.map((l) => l.parts.map((p) => (typeof p === "string" ? p : p.value)).join(""));

  test("issue #2: a stated total that differs from the export, with the statement ticked", () => {
    expect(text(beforeYouCheck(side({}), side({ complete: true, count: "5" })))).toEqual(["If you check now, the destination statement will not be applied: the export has 4 rows, not 5."]);
  });

  test("the same total without the statement, and a source total", () => {
    expect(text(beforeYouCheck(side({ count: "005" }), side({ count: "1" })))).toEqual([
      "If you check now, the source total will be recorded as not matching: the file has 4 rows, not 5.",
      "If you check now, the destination total will be recorded as not matching: the export has 4 rows, not 1.",
    ]);
  });

  test("nothing is said while a fact is unknown, or when nothing contradicts", () => {
    expect(beforeYouCheck(side({ profile: null, count: "9" }), side({ count: "4", complete: true }))).toEqual([]);
    expect(beforeYouCheck(side({ count: "abc" }), side({ count: "" }))).toEqual([]);
  });

  test("a chosen column that is not in its file, and key facts", () => {
    const lines = beforeYouCheck(
      side({ columns: ["id", "phone", "id"], key: { column: "id", rows: 4, withoutKey: 2, repeatedKeys: 1 } }),
      side({ columns: ["id", "hs_email"], key: { column: "id", rows: 4, withoutKey: 1, repeatedKeys: 3 } }),
    );
    expect(lines.map((l) => l.id)).toEqual(["destination-missing:hs_email", "source-without-key", "source-repeated-key", "destination-without-key", "destination-repeated-key"]);
    // A value from a file is a part of its own, never a piece of interface text.
    expect(lines[0]!.parts.filter((p) => typeof p !== "string")).toEqual([{ value: "hs_email" }]);
  });
});
