/**
 * Drift guard for the runtime validator's schema copy (src/data/contract/v1.schemas.json).
 * The copy must equal, object for object, the frozen contract's schemas reachable from the two
 * authorized endpoints — and the frozen file must still have the reviewed digest. Fails (never skips)
 * when the contract is missing.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import copy from "../data/contract/v1.schemas.json";
import { CONTRACT } from "./contract/fixtures";

const FROZEN_SHA256 = "0688d55d3377b53f7dc5f48aad9d523df0e32bb285b4687fd06891f4a4c1d230";

describe("runtime schema copy vs frozen OpenAPI", () => {
  const raw = readFileSync(CONTRACT);
  const doc = JSON.parse(raw.toString("utf8")) as { info: { version: string }; components: { schemas: Record<string, unknown> } };

  it("the frozen contract still has the reviewed digest, and the copy records it", () => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(FROZEN_SHA256);
    expect(copy.source_sha256).toBe(FROZEN_SHA256);
    expect(copy.contract_version).toBe(doc!.info.version);
  });

  it("every copied schema equals the frozen schema exactly", () => {
    for (const [name, schema] of Object.entries(copy.schemas)) expect(schema, name).toEqual(doc!.components.schemas[name]);
  });

  it("copies exactly the closure of $refs from VerificationRun, EvidencePage and Error", () => {
    const seen = new Set<string>();
    const todo = ["VerificationRun", "EvidencePage", "Error"];
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (x && typeof x === "object")
        for (const [k, v] of Object.entries(x)) {
          if (k === "$ref" && typeof v === "string") todo.push(v.split("/").pop()!);
          else walk(v);
        }
    };
    while (todo.length) {
      const n = todo.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      walk(doc!.components.schemas[n]);
    }
    expect(Object.keys(copy.schemas).sort()).toEqual([...seen].sort());
    expect(seen.size).toBe(33);
  });
});
