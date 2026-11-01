/**
 * The Phase 3B wire mirror (src/data/contract/phase3b.ts) against the Service's own source: the status enums, the
 * closed `run_bound_metadata` members, every status pair evaluate_admission returns, and the routes that carry them.
 * Read-only, from this repository. Plain text comparison: a change on either side fails here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMISSION_STATUSES, CAPTURE_STATUSES, PHASE3B_FLAG, PHASE3B_HISTORY_PATHS, RUN_BOUND_FIELDS } from "../data/contract/phase3b";
import { PHASE3B_PAIRS } from "../data/local/phase3b";

const app = (name: string) => readFileSync(resolve(process.cwd(), "../service/app", name), "utf8");
const models = app("admission_models.py");
const serialization = app("admission_serialization.py");
const store = app("history_store.py");
const historyApi = app("history_api.py");

const literal = (field: string) => [...new RegExp(`${field}: Literal\\[(.+?)\\]`).exec(models)![1]!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);

describe("Phase 3B wire mirror against the Service source", () => {
  it("capture_status values", () => expect([...CAPTURE_STATUSES].sort()).toEqual(literal("capture_status").sort()));
  it("admission_status values", () => expect([...ADMISSION_STATUSES].sort()).toEqual(literal("admission_status").sort()));

  it("run_bound_metadata members, in the Service's order", () => {
    const block = /_CONTEXT_FIELDS = \(([\s\S]+?)\)/.exec(serialization)![1]!;
    expect([...RUN_BOUND_FIELDS]).toEqual([...block.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));
  });

  it("the metadata never exposes receipt authentication material", () => expect(RUN_BOUND_FIELDS as readonly string[]).not.toContain("token"));

  it("every status pair evaluate_admission can return is admitted, and no other", () => {
    const body = /def evaluate_admission[\s\S]+?\ndef validate_candidate/.exec(store)![0];
    const pairs = [...body.matchAll(/result\('([A-Z_]+)', '([A-Z_]+)'\)/g)].map((m) => `${m[1]}/${m[2]}`);
    expect([...new Set(pairs)].sort()).toEqual(PHASE3B_PAIRS.map(([c, a]) => `${c}/${a}`).sort());
  });

  it("the History routes the app reads are the Service's, and they are not the frozen stripped ones", () => {
    expect(historyApi).toContain(`@app.get('${PHASE3B_HISTORY_PATHS.list}')\n    def verification_listing(request: Request): return store.listing(`);
    expect(historyApi).toContain(`@app.get('${PHASE3B_HISTORY_PATHS.detail}')\n    def verification_detail(`);
    expect(historyApi).toContain("def listing(request: Request): return legacy_history_response(");
  });

  it("the flag is honoured on exactly the two Detail reads", () => {
    for (const file of ["main.py", "verification_lookup.py"]) expect(app(file)).toContain(`public_live_run(data) if request.query_params.get('${PHASE3B_FLAG.name}') == '${PHASE3B_FLAG.value}' else data`);
    expect(historyApi).not.toContain(PHASE3B_FLAG.name);
  });
});
