/**
 * The result explorer (components/report/Explorer.tsx) on saved golden reports: it lists what each filter selects, is
 * operated by keyboard with one tab stop, opens a panel with every rule result and both values, says plainly when a
 * report holds no rule results for a Verified record, keeps its view in the address without a key or a value, and
 * highlights where two compared values differ, labelled as a display aid.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecordExplorer, ValueDiff } from "../components/report/Explorer";
import { ANY } from "../offline/explore";
import { readReport, storeOfSaved } from "../offline/savedReport";
import { REPO_ROOT } from "./fixtures/sources";

const reportOf = (name: string) => readReport(new Uint8Array(readFileSync(join(REPO_ROOT, "offline/golden", name, "report.json"))), "report.json").report;

/** The explorer over a golden report, with the address of a test page. */
function explore(name: string, hash = "", start = ANY) {
  window.history.replaceState(null, "", `#/check/reports/x${hash}`);
  const writes: Record<string, string | null>[] = [];
  const replace = (p: Record<string, string | null>) => {
    writes.push(p);
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v) q.set(k, v);
    window.history.replaceState(null, "", `#/check/reports/x${q.toString() ? `?${q}` : ""}`);
  };
  const params = new URLSearchParams(hash.replace(/^\?/, ""));
  render(<RecordExplorer store={storeOfSaved(reportOf(name))} params={params} replace={replace} start={start} />);
  return writes;
}

const listed = () => [...document.querySelectorAll("[data-record], [data-destination-row]")].map((o) => o.getAttribute("data-record") ?? `d${o.getAttribute("data-destination-row")}`);

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => window.history.replaceState(null, "", "/"));

describe("the result explorer", () => {
  it("lists each record with its row, key and state, and counts what matches", async () => {
    explore("example");
    await waitFor(() => expect(listed()).toEqual(["1", "2", "3", "4"]));
    expect(screen.getByTestId("explorer-count").textContent).toBe("4 of 4 records match");
    const user = userEvent.setup();
    await user.selectOptions(screen.getByTestId("explorer-state"), "Mismatch");
    await waitFor(() => expect(listed()).toEqual(["2", "3", "4"]));
    expect(screen.getByTestId("explorer-count").textContent).toBe("3 of 4 records match");
    await user.selectOptions(screen.getByTestId("explorer-order"), "desc");
    await waitFor(() => expect(listed()).toEqual(["4", "3", "2"]));
    await user.selectOptions(screen.getByTestId("explorer-state"), "Verified");
    await waitFor(() => expect(listed()).toEqual(["1"]));
  });

  it("is one tab stop, moved through by arrow keys, Home and End, and opens the record chosen", async () => {
    explore("rules-fail");
    const list = await screen.findByRole("listbox");
    await waitFor(() => expect(listed().length).toBeGreaterThan(0));
    expect(list.tabIndex).toBe(0);
    for (const option of within(list).getAllByRole("option")) expect(option.tabIndex).toBe(-1);
    list.focus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    await waitFor(() => expect(within(list).getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true"));
    expect(list.getAttribute("aria-activedescendant")).toBe(within(list).getAllByRole("option")[0]!.id);
    const panel = await screen.findByTestId("record-panel");
    expect(panel.getAttribute("data-record-row")).toBe("1");
    // Every rule, its reason and both values; the normalised values as the report records them.
    for (const reason of ["comparison after trimming leading and trailing whitespace", "comparison after Unicode case folding", "comparison of the digits 0-9 only"]) {
      expect(within(panel).getAllByText(reason).length).toBeGreaterThan(0);
    }
    expect(within(panel).getAllByText("Compared as").length).toBe(5);
    fireEvent.keyDown(list, { key: "End" });
    await waitFor(() => expect(screen.getByTestId("record-panel").getAttribute("data-record-row")).toBe(listed().at(-1)));
    fireEvent.keyDown(list, { key: "Home" });
    await waitFor(() => expect(screen.getByTestId("record-panel").getAttribute("data-record-row")).toBe("1"));
    for (const option of within(list).getAllByRole("option")) {
      expect(option.getAttribute("aria-setsize")).toBe(String(listed().length));
      expect(Number(option.getAttribute("aria-posinset"))).toBeGreaterThan(0);
    }
  });

  it("says plainly that a details: problems report holds no rule results for a Verified record", async () => {
    explore("example");
    await waitFor(() => expect(listed()).toContain("1"));
    await userEvent.setup().click(document.querySelector('[data-record="1"]')!);
    expect((await screen.findByTestId("no-rule-results")).textContent).toBe(
      "This report was written with details: problems. It records that this record is Verified, but not its rule results or values.",
    );
    // A rule filter cannot test it, and says how many it could not test.
    await userEvent.setup().selectOptions(screen.getByTestId("explorer-status"), "pass");
    await waitFor(() => expect(screen.getByTestId("explorer-count").textContent).toContain("1 Verified record holds no rule results in this report (details: problems), so the rule filter cannot test it."));
  });

  it("keeps its view in the address, with numbers and fixed words only, and opens a linked view", async () => {
    const writes = explore("rules-fail", "?rule=f3&result=fail&row=2");
    const panel = await screen.findByTestId("record-panel");
    expect(panel.getAttribute("data-record-row")).toBe("2");
    expect((screen.getByTestId("explorer-rule") as HTMLSelectElement).value).toBe("4");
    // A view the address names is not written again; a search never is.
    expect(writes).toEqual([]);
    const user = userEvent.setup();
    await user.type(screen.getByTestId("explorer-search"), "P");
    await user.selectOptions(screen.getByTestId("explorer-state"), "Mismatch");
    await waitFor(() => expect(window.location.hash).toContain("state=Mismatch"));
    expect(window.location.hash).not.toMatch(/P1|P2|search|phone|signed/);
    expect(window.location.hash).toMatch(/^#\/check\/reports\/x\?(state=Mismatch&rule=f3&result=fail(&row=\d+)?)$/);
  });

  it("an untouched view leaves the address alone", async () => {
    const writes = explore("example", "", { ...ANY, state: "not-verified" });
    await waitFor(() => expect(listed()).toEqual(["2", "3", "4"]));
    expect(writes).toEqual([]);
    expect(window.location.hash).toBe("#/check/reports/x");
  });

  it("lists the destination-only records of a scope exact report", async () => {
    explore("scope-exact-source-known");
    await screen.findByTestId("explorer-list-destination-only");
    await userEvent.setup().click(screen.getByTestId("explorer-list-destination-only"));
    await waitFor(() => expect(listed().every((r) => r.startsWith("d"))).toBe(true));
    expect(listed().length).toBeGreaterThan(0);
    expect((screen.getByTestId("explorer-rule") as HTMLSelectElement).disabled).toBe(true);
  });

  it("turns search off for a report without keys, and says why", async () => {
    explore("example-redacted");
    const search = (await screen.findByTestId("explorer-search")) as HTMLInputElement;
    expect(search.disabled).toBe(true);
    expect(screen.getByText("This report was written with --redact-values: it holds no keys to search.")).toBeTruthy();
  });

  it("offers to clear filters that match nothing", async () => {
    explore("rules-pass", "?state=Mismatch");
    expect((await screen.findByTestId("explorer-empty")).textContent).toContain("No record matches these filters.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Clear the filters" }));
    await waitFor(() => expect(listed().length).toBeGreaterThan(0));
  });
});

describe("the character diff", () => {
  it("marks deleted and inserted characters by element, shows invisible ones, and is labelled a display aid", () => {
    render(<ValueDiff source={"Ada Lovelace "} destination={"Ada Lovelace"} label="Where the values differ" />);
    const diff = screen.getByTestId("value-diff");
    const source = diff.querySelector('[data-side="source"]')!;
    expect(source.querySelector("del")!.textContent).toBe("NBSP");
    expect([...source.querySelectorAll(".fa-tok")].map((t) => t.textContent)).toEqual(["NBSP", "·"]);
    expect(diff.querySelector('[data-side="destination"] ins')!.textContent).toBe("·");
    expect(diff.textContent).toContain("This highlights where the two values differ. The rule’s result above is the conclusion.");
  });

  it("lists the code points of what differs, and notes a difference of normalisation or case", () => {
    render(<ValueDiff source={"café"} destination={"café"} label="x" />);
    const diff = screen.getByTestId("value-diff");
    expect(diff.textContent).toContain("é U+00E9");
    expect(diff.textContent).toContain("U+0301");
    expect(diff.querySelector('[data-note="nfc"]')).not.toBeNull();
  });

  it("is shown for a failed field, on the values the rule compared", async () => {
    explore("rules-fail", "?row=1");
    const panel = await screen.findByTestId("record-panel");
    const diffs = within(panel).getAllByTestId("value-diff");
    // trim, casefold, digits, two dates and exact fail on record 1.
    expect(diffs.length).toBe(6);
    // trim compares " Ada " as "Ada": the compared values are highlighted.
    const trim = panel.querySelector('[data-rule="field"]')!;
    expect(within(trim as HTMLElement).getByTestId("value-diff").querySelector('[data-side="source"]')!.textContent).toBe("Ada");
  });
});

