/**
 * The CSV check page (#/check): choices are made by the user and nothing is preselected, the check gives the command
 * line's summary and reports (origin "browser form"), refusals show no result, and nothing the user states is stored:
 * a check without "Keep this report in this browser" stores nothing at all (tests of keeping: saved-reports.test.tsx).
 * The check runs in this thread here (inThreadRunner); the browser suite runs it in the real Web Worker.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Check } from "../pages/Check";
import { inThreadRunner, type CheckRunner } from "../offline/runner";
import { REPO_ROOT } from "./fixtures/sources";
import { renderApp } from "./render";

const golden = (name: string, file: string) => readFileSync(join(REPO_ROOT, "offline/golden", name, file), "utf-8");
const example = (file: string) => new File([readFileSync(join(REPO_ROOT, "offline/examples", file))], file, { type: "text/csv" });
const asBrowser = (text: string) => text.replaceAll('"origin": "command-line option"', '"origin": "browser form"').replaceAll("<td>command-line option</td>", "<td>browser form</td>");
const anyTime = (text: string) => text.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{6})?Z/g, "TIME");

let saved: { blob: Blob; name: string }[] = [];

beforeEach(() => {
  saved = [];
  // jsdom has no object URLs; record what the page would save instead.
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (blob: Blob) => (saved.push({ blob, name: "" }), "blob:test"), revokeObjectURL: () => undefined }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved[saved.length - 1]!.name = this.download;
  });
});

afterEach(() => vi.unstubAllGlobals());

async function chooseExample() {
  const user = userEvent.setup();
  render(<Check runner={inThreadRunner()} />);
  await user.upload(screen.getByTestId("source-file"), example("source.csv"));
  await user.upload(screen.getByTestId("destination-file"), example("destination.csv"));
  await waitFor(() => expect(screen.getAllByText("3 columns")).toHaveLength(2));
  return user;
}

async function chooseColumns(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByTestId("key-source"), "external_id");
  await user.selectOptions(screen.getByTestId("key-destination"), "external_id");
  await user.selectOptions(screen.getByTestId("field-0-source"), "phone");
  await user.selectOptions(screen.getByTestId("field-0-destination"), "phone");
  await user.click(screen.getByRole("button", { name: "Add a field" }));
  await user.selectOptions(screen.getByTestId("field-1-source"), "email");
  await user.selectOptions(screen.getByTestId("field-1-destination"), "hs_email");
}

describe("CSV check page", () => {
  it("preselects nothing: no column, no rule beyond exact, no premise, no count", async () => {
    await chooseExample();
    expect((screen.getByTestId("key-source") as HTMLSelectElement).value).toBe("");
    expect((screen.getByTestId("key-destination") as HTMLSelectElement).value).toBe("");
    expect((screen.getByTestId("field-0-source") as HTMLSelectElement).value).toBe("");
    expect((screen.getByTestId("source-complete") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("destination-complete") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("allow-identical") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("source-count") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("scope-source") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("run-check") as HTMLButtonElement).disabled).toBe(true);
  });

  it("gives the command line's summary and reports, with the premises' origin the browser form", async () => {
    const user = await chooseExample();
    await chooseColumns(user);
    await user.click(screen.getByTestId("source-complete"));
    await user.click(screen.getByTestId("destination-complete"));
    await user.click(screen.getByTestId("run-check"));
    const result = await screen.findByRole("region", { name: "Result" }, { timeout: 5000 });
    expect(within(result).getByTestId("summary").textContent).toBe(golden("example-page", "stdout.txt"));
    expect(result.querySelector(".fa-seal")?.getAttribute("data-s")).toBe("Mismatch");
    expect(within(result).getByText("No claim is made: the result is not Verified.")).toBeTruthy();
    // Every stated premise is shown beside the result, with its origin.
    for (const name of ["source_complete", "destination_complete", "source_count", "destination_count"]) {
      expect(result.querySelector(`[data-premise="${name}"]`)?.textContent).toContain("browser form");
    }
    await user.click(screen.getByTestId("download-json"));
    await user.click(screen.getByTestId("download-html"));
    expect(saved.map((s) => s.name)).toEqual(["flowassert-report.json", "flowassert-report.html"]);
    expect(anyTime(await saved[0]!.blob.text())).toBe(anyTime(asBrowser(golden("example-page", "report.json"))));
    expect(anyTime(await saved[1]!.blob.text())).toBe(anyTime(asBrowser(golden("example-page", "report.html"))));
  });

  it("says what the result means next to it, read from the report, and leaves the summary as the command line prints it", async () => {
    const user = await chooseExample();
    await chooseColumns(user);
    await user.click(screen.getByTestId("run-check"));
    const result = await screen.findByRole("region", { name: "Result" }, { timeout: 5000 });
    const explanation = within(result).getByTestId("explanation");
    expect(explanation.getAttribute("data-explains")).toBe("Mismatch");
    expect(within(explanation).getByRole("heading", { name: "What this result means" })).toBeTruthy();
    // Nothing was stated: a phone differs, a key is repeated, and the rest is not established.
    expect([...explanation.querySelectorAll("[data-point]")].map((p) => p.getAttribute("data-point"))).toEqual([
      "mismatch-records", "fail:phone", "fail-duplicate", "see-records", "also",
      "population-unknown", "source-not-stated", "coverage-not-established", "destination-not-stated", "not-found", "found-once",
    ]);
    expect(explanation.querySelector('[data-point="source-not-stated"]')!.textContent).toContain("FlowAssert cannot check the statement");
    // Column names are the report's, kept out of translation.
    expect(explanation.querySelector('[data-point="fail:phone"] [data-no-translate]')!.textContent).toBe("phone");
    expect(within(result).getByTestId("summary").textContent).toBe(golden("example-page-no-premises", "stdout.txt"));
  });

  it("stores nothing the user chose or stated, and leaves the address alone", async () => {
    const before = window.location.href;
    // Saved reports (v0.5.0) live in IndexedDB: a check without "Keep" must not touch it at all, not even to read.
    const touched: string[] = [];
    vi.stubGlobal("indexedDB", new Proxy({}, { get: (_, name) => (touched.push(String(name)), () => undefined) }));
    const user = await chooseExample();
    await chooseColumns(user);
    await user.click(screen.getByTestId("source-complete"));
    await user.type(screen.getByTestId("source-count"), "4");
    await user.click(screen.getByTestId("run-check"));
    await screen.findByRole("region", { name: "Result" }, { timeout: 5000 });
    // "Keep this report in this browser" is offered, and not pressed.
    expect(screen.getByTestId("keep-report")).toBeTruthy();
    expect(touched).toEqual([]);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
    expect(window.location.href).toBe(before);
  });

  it("stops a check when a choice changes while it runs, so its result never appears beside other choices", async () => {
    const inner = inThreadRunner();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // The check starts at once and its result is held back until the choice has changed.
    const runner: CheckRunner = {
      ...inner,
      run: async (input, progress) => {
        const result = inner.run(input, progress);
        // Cancelled rejects it while it is held back; the page reads that rejection once it is returned.
        result.catch(() => undefined);
        await gate;
        return result;
      },
    };
    const user = userEvent.setup();
    render(<Check runner={runner} />);
    await user.upload(screen.getByTestId("source-file"), example("source.csv"));
    await user.upload(screen.getByTestId("destination-file"), example("destination.csv"));
    await waitFor(() => expect(screen.getAllByText("3 columns")).toHaveLength(2));
    await chooseColumns(user);
    await user.click(screen.getByTestId("source-complete"));
    await user.click(screen.getByTestId("run-check"));
    await user.click(screen.getByTestId("source-complete"));
    release();
    await waitFor(() => expect(screen.getByTestId("run-status").textContent).toBe("The choices changed during the check, so it was stopped. No result is shown."));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByRole("region", { name: "Result" })).toBeNull();
  });

  it("clears what was stated about a file when another file is chosen in its place", async () => {
    const user = await chooseExample();
    await user.click(screen.getByTestId("source-complete"));
    await user.click(screen.getByTestId("destination-complete"));
    await user.type(screen.getByTestId("source-count"), "4");
    await user.type(screen.getByTestId("destination-count"), "4");
    await user.click(screen.getByTestId("allow-identical"));
    await user.upload(screen.getByTestId("source-file"), example("destination.csv"));
    expect((screen.getByTestId("source-complete") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("source-count") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("allow-identical") as HTMLInputElement).checked).toBe(false);
    // The other file's statements were made about a file that is still chosen.
    expect((screen.getByTestId("destination-complete") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("destination-count") as HTMLInputElement).value).toBe("4");
  });

  it("shows a refusal, and no result, for a malformed file", async () => {
    const user = userEvent.setup();
    render(<Check runner={inThreadRunner()} />);
    await user.upload(screen.getByTestId("source-file"), new File(['k,p\n"1,2\n'], "bad.csv"));
    await user.upload(screen.getByTestId("destination-file"), new File(["k,p\n1,2\n"], "d.csv"));
    await waitFor(() => expect(screen.getAllByText("2 columns")).toHaveLength(2));
    await user.selectOptions(screen.getByTestId("key-source"), "k");
    await user.selectOptions(screen.getByTestId("key-destination"), "k");
    await user.selectOptions(screen.getByTestId("field-0-source"), "p");
    await user.selectOptions(screen.getByTestId("field-0-destination"), "p");
    await user.click(screen.getByTestId("run-check"));
    const refusal = await screen.findByTestId("refusal", {}, { timeout: 5000 });
    expect(refusal.textContent).toContain("bad.csv: unexpected end of data");
    expect(screen.queryByRole("region", { name: "Result" })).toBeNull();
  });

  it("downloads the configuration in its canonical form and loads it back with the CLI's validation", async () => {
    const user = await chooseExample();
    await chooseColumns(user);
    await user.selectOptions(screen.getByTestId("field-1-rule"), "casefold");
    await user.click(screen.getByTestId("download-config"));
    expect(saved[0]!.name).toBe("flowassert-config.json");
    expect(await saved[0]!.blob.text()).toBe(
      '{\n  "key": [\n    "external_id",\n    "external_id"\n  ],\n  "fields": [\n    {\n      "source": "phone",\n      "destination": "phone",\n      "rule": "exact"\n    },\n' +
        '    {\n      "source": "email",\n      "destination": "hs_email",\n      "rule": "casefold"\n    }\n  ],\n  "scope": "source"\n}\n',
    );
    const refused = new File(['{"key": ["k", "k"], "fields": [{"source": "p", "destination": "p"}], "source_complete": true}'], "with-premise.json");
    await user.upload(screen.getByTestId("config-file"), refused);
    expect(await screen.findByText(/cannot be set in a configuration file/)).toBeTruthy();
    await user.upload(screen.getByTestId("config-file"), new File([golden("config-loaded-with-bom", "config.json")], "config.json"));
    expect(await screen.findByText("Configuration loaded:")).toBeTruthy();
    expect((screen.getByTestId("field-1-rule") as HTMLSelectElement).value).toBe("casefold");
  });

  it("refuses a date format with a directive the browser does not support, before any check", async () => {
    const user = await chooseExample();
    await chooseColumns(user);
    await user.selectOptions(screen.getByTestId("field-0-rule"), "date");
    await user.type(screen.getByTestId("field-0-format"), "%Y %a");
    expect(await screen.findByText(/does not support/)).toBeTruthy();
    expect((screen.getByTestId("run-check") as HTMLButtonElement).disabled).toBe(true);
  });

  it("suggests same-named pairs only when asked", async () => {
    const user = await chooseExample();
    expect((screen.getByTestId("field-0-source") as HTMLSelectElement).value).toBe("");
    await user.click(screen.getByTestId("suggest-pairs"));
    expect(screen.queryByTestId("field-1-source")).toBeTruthy();
    expect((screen.getByTestId("field-0-source") as HTMLSelectElement).value).toBe("external_id");
    expect((screen.getByTestId("field-1-source") as HTMLSelectElement).value).toBe("phone");
  });

  it("is in the app at #/check with its own navigation entry", async () => {
    renderApp("#/check");
    expect(await screen.findByRole("heading", { level: 1, name: "CSV check" }, { timeout: 5000 })).toBeTruthy();
    const nav = screen.getAllByRole("navigation", { name: "Browser check" })[0]!;
    expect(within(nav).getByRole("link", { name: /CSV check/ }).getAttribute("aria-current")).toBe("page");
  });
});
