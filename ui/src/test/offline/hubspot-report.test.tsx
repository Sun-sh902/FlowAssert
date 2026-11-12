/**
 * Reports whose destination the command line read from HubSpot's contacts (schema_version 3, 1.0.0): the browser opens
 * them as offline/bench/golden.py writes them into offline/golden-hubspot/, shows that FlowAssert listed the records and
 * what that does not show, explains it, lists every record in the result explorer, compares two
 * of them, and refuses to compare a report whose destination was a file with one whose destination was HubSpot.
 * Nothing here, or in the modules it tests, makes a request to HubSpot.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ReportStoreContext, memoryStore } from "../../lib/savedReports";
import { compareReports } from "../../offline/compare";
import { explain, textsOf } from "../../offline/explain";
import { compareCodePoints } from "../../offline/pystr";
import { NotAReport, readReport, viewOf } from "../../offline/savedReport";
import { SavedReportPage } from "../../pages/SavedReports";
import { REPO_ROOT } from "../fixtures/sources";

const HUBSPOT = join(REPO_ROOT, "offline/golden-hubspot");
const names = readdirSync(HUBSPOT).sort(compareCodePoints);
const withReport = names.filter((name) => {
  try {
    readFileSync(join(HUBSPOT, name, "report.json"));
    return true;
  } catch {
    return false;
  }
});
const bytes = (name: string) => new Uint8Array(readFileSync(join(HUBSPOT, name, "report.json")));
const read = (name: string) => readReport(bytes(name), `${name}.json`).report;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const altered = (name: string, change: (r: Json) => void) => {
  const value = JSON.parse(new TextDecoder().decode(bytes(name))) as Json;
  change(value);
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
};

describe("opening a report from a HubSpot destination", () => {
  test("the golden folder holds results and refusals", () => {
    expect(withReport.length).toBeGreaterThanOrEqual(10);
    expect(names.length).toBeGreaterThan(withReport.length);
  });

  test.each(withReport)("%s is read, with what FlowAssert listed", (name) => {
    const report = read(name);
    expect(report.schema_version).toBe(3);
    const crm = report.inputs.destination_hubspot!;
    expect([crm.read_by, crm.service, crm.object, crm.archived_excluded, crm.page_limit]).toEqual(["FlowAssert", "HubSpot CRM API v3", "contacts", true, 100]);
    expect(crm.rows).toBe(report.premises.destination_count!.observed);
    expect(report.inputs.destination_encoding).toBeUndefined();
    expect(viewOf(report).inputs.map(([k]) => k)).not.toContain("destination_hubspot");
    // The explanation says what was listed and what that does not show, and nothing that reads as completeness.
    const e = explain(report);
    const point = e.points.find((p) => p.id === "destination-hubspot")!;
    expect(point).toBeDefined();
    expect(textsOf(e).join(" ")).toContain("It does not show that the object is complete");
    for (const text of textsOf(e)) expect(text).not.toMatch(/HubSpot (shows|proves) .*complete/);
  });

  test("a report that does not hold together is refused, with the member named", () => {
    const refuse = (change: (r: Json) => void) => {
      try {
        readReport(altered("hubspot-verified", change), "r.json");
        return null;
      } catch (e) {
        expect(e).toBeInstanceOf(NotAReport);
        return (e as NotAReport).message;
      }
    };
    expect(refuse((r) => (r.inputs.destination_hubspot.rows = 7))).toContain("HubSpot listed 7 records");
    expect(refuse((r) => (r.inputs.destination_encoding = "utf-8"))).toContain("which has no encoding");
    expect(refuse((r) => (r.inputs.destination_hubspot.archived_excluded = false))).toContain("archived_excluded");
    expect(refuse((r) => (r.inputs.destination_hubspot.token = "x"))).toContain("unknown member");
    expect(refuse((r) => r.inputs.destination_hubspot.properties.push("a b"))).toContain("properties[");
    expect(refuse((r) => delete r.inputs.destination_hubspot)).toContain("destination_hubspot");
    expect(refuse((r) => (r.schema_version = 5))).toContain("schema_version must be 1, 2, 3 or 4");
  });

  test("two HubSpot reports compare; a HubSpot report and a file report of the same rows do not", () => {
    const result = compareReports(read("hubspot-verified"), read("hubspot-mismatch"));
    expect(result.comparable).toBe(true);
    const file = readReport(new Uint8Array(readFileSync(join(REPO_ROOT, "offline/golden/example/report.json"))), "e.json").report;
    const crm = readReport(
      altered("hubspot-verified", (r) => {
        r.obligation = JSON.parse(new TextDecoder().decode(readFileSync(join(REPO_ROOT, "offline/golden/example/report.json")))).obligation;
      }),
      "r.json",
    ).report;
    const refused = compareReports(file, crm);
    expect(refused.comparable === false && refused.reasons.map((r) => r.code)).toContain("different-destination");
  });
});

describe("the saved report page", () => {
  test("shows where the destination was read, and every record in the explorer", async () => {
    const store = memoryStore();
    const read_ = readReport(bytes("hubspot-mismatch"), "hubspot-mismatch.json");
    const entry = await store.add(read_, { kind: "imported", fileName: "hubspot-mismatch.json" });
    const { container } = render(
      <ReportStoreContext.Provider value={store}>
        <SavedReportPage id={entry.id} />
      </ReportStoreContext.Provider>,
    );
    const line = await screen.findByTestId("saved-destination-hubspot");
    expect(line.textContent).toContain("Listed by FlowAssert from HubSpot's contacts, read-only: 2 records in 1 page, archived records not read.");
    expect(line.textContent).toContain("This does not show that the object is complete.");
    await waitFor(() => expect(container.querySelectorAll("[data-record]").length).toBe(2));
    expect(container.querySelector('[data-point="destination-hubspot"]')?.textContent).toContain("The destination records were listed by FlowAssert from HubSpot's contacts, read-only");
  });
});
