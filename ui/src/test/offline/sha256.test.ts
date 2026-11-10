/**
 * The pure SHA-256 (sha256.ts) that the packaged checker uses where crypto.subtle is missing must give the digests
 * crypto.subtle gives: on known answers, on every length around the block boundaries, on random inputs of random
 * lengths up to 1 MiB, and on every file of offline/golden/, whose digests the reports record.
 */
import { webcrypto } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Sha256, sha256 } from "../../offline/sha256";
import { GOLDEN } from "./golden-cases";
import { random } from "./random-cases";

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const subtle = async (bytes: Uint8Array) => hex(new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)));

function randomBytes(next: () => number, length: number) {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(next() * 256);
  return bytes;
}

describe("pure SHA-256", () => {
  test("known answers (FIPS 180-4 examples)", () => {
    const ascii = (s: string) => new TextEncoder().encode(s);
    expect(hex(sha256(ascii("")))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(hex(sha256(ascii("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hex(sha256(ascii("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    expect(hex(sha256(new Uint8Array(1_000_000).fill(0x61)))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  test("every length from 0 to 300 bytes, as crypto.subtle", async () => {
    const { next } = random(20260401);
    for (let length = 0; length <= 300; length++) {
      const bytes = randomBytes(next, length);
      expect(hex(sha256(bytes)), `length ${length}`).toBe(await subtle(bytes));
    }
  });

  test("random inputs of random lengths up to 1 MiB, as crypto.subtle", async () => {
    const { next } = random(20260402);
    for (let i = 0; i < 40; i++) {
      const bytes = randomBytes(next, Math.floor(next() * (1 << 20)));
      expect(hex(sha256(bytes)), `length ${bytes.length}`).toBe(await subtle(bytes));
    }
  });

  test("a view into a larger buffer is hashed by its own bytes only", async () => {
    const whole = randomBytes(random(20260403).next, 1000);
    const view = whole.subarray(13, 813);
    expect(hex(sha256(view))).toBe(await subtle(view.slice()));
  });

  test("every golden file, as crypto.subtle", async () => {
    let files = 0;
    for (const name of readdirSync(GOLDEN)) {
      for (const file of readdirSync(join(GOLDEN, name))) {
        const bytes = new Uint8Array(readFileSync(join(GOLDEN, name, file)));
        expect(hex(sha256(bytes)), `${name}/${file}`).toBe(await subtle(bytes));
        files++;
      }
    }
    expect(files).toBeGreaterThan(500);
  });

  test("fed in pieces of every size, the digest is the one of the whole input", async () => {
    const { next, int } = random(20261109);
    const bytes = randomBytes(next, 5000);
    const whole = await subtle(bytes);
    for (let size = 1; size <= 200; size++) {
      const h = new Sha256();
      for (let at = 0; at < bytes.length; at += size) h.update(bytes.subarray(at, at + size));
      expect(hex(h.digest()), `pieces of ${size} bytes`).toBe(whole);
    }
    for (let run = 0; run < 200; run++) {
      const h = new Sha256();
      for (let at = 0; at < bytes.length; ) {
        const size = int(0, 300);
        h.update(bytes.subarray(at, at + size));
        at += size;
      }
      expect(hex(h.digest()), `random pieces, run ${run}`).toBe(whole);
    }
    expect(hex(new Sha256().update(new Uint8Array(0)).update(new Uint8Array(0)).digest())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
