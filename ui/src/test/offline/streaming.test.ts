/**
 * Reading a file as a stream gives what reading it whole gives (docs/design/1.0-streaming.md): the same rows, the same
 * digest, the same refusal, and so the same reports, wherever the stream's chunks happen to end.
 *
 *  - Every golden case is run again with each input fed in chunks: for an input of at most 4 KiB, as two chunks split
 *    at every byte offset and as a stream of one-byte chunks; for a larger one, at offsets from a seeded generator.
 *    The exit status, the summary, the refusal and both reports must be the golden ones.
 *  - Generated files of every encoding, with quoted line breaks, CR LF and characters of two to four bytes, are read
 *    in chunks cut at random offsets and must give the rows, the digest and the line endings of the file read whole.
 *  - The pieces the reader decodes are always the same 8192 bytes, whatever the chunks are.
 */
import { webcrypto } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { check, reportHtml, reportJson, type CheckArgs, type InputFile } from "../../offline/check";
import { ByteFeed, Refused, readCsv, type ByteStream, type CsvRead, type Encoding } from "../../offline/csv";
import { compareCodePoints } from "../../offline/pystr";
import { REPO_ROOT } from "../fixtures/sources";
import { parseArgs } from "./cli-args";
import { random } from "./random-cases";

const GOLDEN = join(REPO_ROOT, "offline/golden");
const SMALL = 4096;
const EVALUATED_AT = () => "2000-01-01T00:00:00Z";

/** `bytes` as a stream whose chunks end at `cuts` (sorted offsets); each chunk is a copy, as a real stream's is. */
function chunked(bytes: Uint8Array, cuts: readonly number[]): ByteStream {
  const edges = [0, ...cuts, bytes.length];
  let i = 0;
  return {
    read: () => {
      while (i + 1 < edges.length && edges[i] === edges[i + 1] && bytes.length > 0) i++;
      if (i + 1 >= edges.length) return Promise.resolve(null);
      const chunk = bytes.slice(edges[i], edges[i + 1]);
      i++;
      return Promise.resolve(chunk);
    },
  };
}

const everyByte = (bytes: Uint8Array) => Array.from({ length: Math.max(0, bytes.length - 1) }, (_, i) => i + 1);

const text = (folder: string, file: string) => {
  try {
    return readFileSync(join(folder, file), "utf-8");
  } catch {
    return null;
  }
};

async function outcomeOf(args: CheckArgs) {
  const outcome = await check({ ...args, now: EVALUATED_AT });
  return { exit: outcome.exit, stdout: outcome.stdout, stderr: outcome.stderr, json: outcome.report ? reportJson(outcome.report) : null, html: outcome.report ? reportHtml(outcome.report) : null };
}

const names = readdirSync(GOLDEN).sort(compareCodePoints);

describe("a golden case gives its golden reports however its files are cut into chunks", () => {
  let runs = 0;

  test.each(names)("%s", async (name) => {
    const folder = join(GOLDEN, name);
    const args = parseArgs((JSON.parse(readFileSync(join(folder, "case.json"), "utf-8")) as { args: string[] }).args, folder);
    const golden = {
      exit: Number(text(folder, "exit_status.txt")),
      stdout: text(folder, "stdout.txt"),
      stderr: text(folder, "stderr.txt"),
      json: text(folder, "report.json"),
      html: text(folder, "report.html"),
    };
    const { next, int } = random(20261109 + name.length);
    void next;
    for (const side of ["source", "destination"] as const) {
      const file = args[side];
      if (statSync(join(folder, file.name)).size > 209_715_200) continue;
      const bytes = new Uint8Array(readFileSync(join(folder, file.name)));
      const small = bytes.length <= SMALL;
      // Every byte offset for a small file; 24 seeded offsets, and a spread of chunk sizes, for a larger one.
      const splits: number[][] = small ? everyByte(bytes).map((k) => [k]) : Array.from({ length: 24 }, () => [int(1, bytes.length - 1)]);
      splits.push(small ? everyByte(bytes) : Array.from({ length: 40 }, () => int(1, bytes.length - 1)).sort((a, b) => a - b));
      splits.push([]);
      for (const cuts of splits) {
        const streamed: InputFile = { ...file, open: () => chunked(bytes, cuts) };
        expect(await outcomeOf({ ...args, [side]: streamed }), `${side} cut at ${cuts.slice(0, 5).join(",")}`).toEqual(golden);
        runs++;
      }
    }
  });

  test("the inputs were cut at thousands of offsets", () => {
    expect(runs).toBeGreaterThan(20_000);
  });
});

/* ---------- generated files ---------- */

const ENCODE: Record<Encoding, (text: string) => Uint8Array> = {
  "utf-8": (t) => new TextEncoder().encode(t),
  "utf-16": (t) => {
    const out = new Uint8Array(2 + t.length * 2);
    out.set([0xff, 0xfe]);
    for (let i = 0; i < t.length; i++) {
      out[2 + i * 2] = t.charCodeAt(i) & 0xff;
      out[3 + i * 2] = t.charCodeAt(i) >> 8;
    }
    return out;
  },
  // GB18030 of the characters the generator uses: ASCII as it is, and fixed sequences of two and four bytes.
  gb18030: (t) => {
    const table: Record<string, number[]> = { 名: [0xc3, 0xfb], 字: [0xd7, 0xd6], "€": [0xa2, 0xe3], é: [0xa8, 0xa6], "😀": [0x94, 0x39, 0xfc, 0x36] };
    const out: number[] = [];
    for (const c of t) out.push(...(table[c] ?? [c.charCodeAt(0)]));
    return Uint8Array.from(out);
  },
};

function generate(seed: number, rows: number): string {
  const r = random(seed);
  const cell = () => {
    let value = "";
    for (let n = r.int(0, 9); n > 0; n--) value += r.pick(["a", "Z", "7", " ", "名", "字", "é", "€", "😀", "-"]);
    const quoted = r.int(0, 5) === 0;
    if (quoted) value += r.pick(["", ",", "\n", "\r\n", "\r", '""', "x\r\ny"]);
    return quoted ? `"${value}"` : value;
  };
  const ending = () => r.pick(["\n", "\n", "\r\n", "\r\n", "\r"]);
  let out = "k,a,b" + ending();
  for (let i = 0; i < rows; i++) {
    out += `K${i},${cell()},${cell()}${ending()}`;
    if (r.int(0, 40) === 0) out += ending(); // a blank line
  }
  return out;
}

async function read(bytes: Uint8Array, encoding: Encoding, cuts: readonly number[] | null): Promise<{ read?: CsvRead; rows: string[][]; refused?: string }> {
  const rows: string[][] = [];
  try {
    const result = await readCsv({ name: "f.csv", encoding, open: () => chunked(bytes, cuts ?? []) }, null, (row) => rows.push(row));
    return { read: result, rows };
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    return { rows: [], refused: e.message };
  }
}

const sha256 = async (bytes: Uint8Array) => [...new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("generated files read in chunks cut at random offsets", () => {
  test.each(["utf-8", "utf-16", "gb18030"] as const)("%s: the rows, the digest and the line endings of the file read whole", async (encoding) => {
    for (let seed = 1; seed <= 12; seed++) {
      const bytes = ENCODE[encoding](generate(seed * 7919 + encoding.length, 2500));
      expect(bytes.length).toBeGreaterThan(40_000);
      const whole = await read(bytes, encoding, null);
      expect(whole.refused, `seed ${seed}`).toBeUndefined();
      expect(whole.read!.sha256).toBe(await sha256(bytes));
      expect(whole.read!.bytes).toBe(bytes.length);
      const r = random(seed);
      for (const pieces of [2, 7, 300, 5000]) {
        const cuts = Array.from({ length: pieces - 1 }, () => r.int(1, bytes.length - 1)).sort((a, b) => a - b);
        expect(await read(bytes, encoding, cuts), `seed ${seed}, ${pieces} chunks`).toEqual(whole);
      }
    }
  });

  test("a damaged file is refused the same way wherever the chunks end", async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = random(seed + 500);
      const encoding = r.pick(["utf-8", "utf-16", "gb18030"] as const);
      const bytes = ENCODE[encoding](generate(seed, 600));
      // One of: an invalid byte, a truncated file, a quote opened and never closed, a row with a field too many.
      const at = r.int(10, bytes.length - 10);
      const kind = r.int(0, 3);
      const damaged =
        kind === 0 ? Uint8Array.from([...bytes.subarray(0, at), 0xff, 0xff, ...bytes.subarray(at)])
        : kind === 1 ? bytes.slice(0, at)
        : kind === 2 ? Uint8Array.from([...bytes.subarray(0, at), ...ENCODE[encoding]('\n"open')])
        : Uint8Array.from([...bytes.subarray(0, at), ...ENCODE[encoding]("\nK,1,2,3\n"), ...bytes.subarray(at)]);
      const whole = await read(damaged, encoding, null);
      for (const pieces of [2, 9, 400]) {
        const cuts = Array.from({ length: pieces - 1 }, () => r.int(1, damaged.length - 1)).sort((a, b) => a - b);
        expect(await read(damaged, encoding, cuts), `seed ${seed}, kind ${kind}, ${pieces} chunks`).toEqual(whole);
      }
      expect(await read(damaged, encoding, everyByte(damaged.subarray(0, 3000))), `seed ${seed}, one-byte chunks`).toEqual(whole);
    }
  });
});

describe("ByteFeed", () => {
  const bytes = Uint8Array.from({ length: 30_000 }, (_, i) => (i * 31 + (i >> 8)) & 0xff);

  test("hands out pieces of exactly 8192 bytes, the last one shorter and then an empty one, whatever is pushed", async () => {
    for (const size of [1, 7, 8191, 8192, 8193, 20_000, 30_000]) {
      const feed = new ByteFeed();
      const pieces: number[] = [];
      let joined: number[] = [];
      const drain = () => {
        for (let piece = feed.take(); piece !== undefined; piece = feed.take()) {
          pieces.push(piece.length);
          joined = joined.concat([...piece]);
          if (!piece.length) break;
        }
      };
      for (let at = 0; at < bytes.length; at += size) {
        feed.push(bytes.slice(at, at + size));
        drain();
      }
      expect(feed.take(), "nothing short is handed out before the end").toBeUndefined();
      feed.end();
      drain();
      expect(pieces).toEqual([8192, 8192, 8192, 30_000 - 3 * 8192, 0]);
      expect(Uint8Array.from(joined)).toEqual(bytes);
      expect(feed.bytes).toBe(bytes.length);
      expect(feed.sha256()).toBe(await sha256(bytes));
    }
  });

  test("keeps the bytes it still holds when the stream reuses its buffer", async () => {
    const feed = new ByteFeed();
    const buffer = new Uint8Array(5000);
    const out: number[] = [];
    for (let at = 0; at < bytes.length; at += 5000) {
      feed.own();
      buffer.set(bytes.subarray(at, at + 5000)); // the stream overwrites the chunk it gave last time
      feed.push(buffer.subarray(0, Math.min(5000, bytes.length - at)));
      for (let piece = feed.take(); piece !== undefined; piece = feed.take()) out.push(...piece);
    }
    feed.end();
    for (let piece = feed.take()!; piece.length; piece = feed.take()!) out.push(...piece);
    expect(Uint8Array.from(out)).toEqual(bytes);
    expect(feed.sha256()).toBe(await sha256(bytes));
  });

  test("an empty file is one empty piece", () => {
    const feed = new ByteFeed();
    expect(feed.take()).toBeUndefined();
    feed.end();
    expect(feed.take()).toEqual(new Uint8Array(0));
    expect(feed.sha256()).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
