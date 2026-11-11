/**
 * The CSV check page (#/check): choices are made by the user and nothing is preselected, the check gives the command
 * line's summary and reports (origin "browser form"), refusals show no result, and nothing the user states is stored:
 * a check without "Keep this report in this browser" stores nothing at all (tests of keeping: saved-reports.test.tsx).
 * The check runs in this thread here (inThreadRunner); the browser suite runs it in the real Web Worker.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Check } from "../pages/Check";
import { inThreadRunner, type CheckRunner } from "../offline/runner";
import { REPO_ROOT } from "./fixtures/sources";
import { renderApp } from "./render";
import { startLocalizer } from "../i18n/localizer";

const golden = (name: string, file: string) => readFileSync(join(REPO_ROOT, "offline/golden", name, file), "utf-8");
const example = (file: string) => new File([readFileSync(join(REPO_ROOT, "offline/examples", file))], file, { type: "text/csv" });
const asBrowser = (text: string) => text.replaceAll('"origin": "command-line option"', '"origin": "browser form"').replaceAll("· origin: command-line option", "· origin: browser form");
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
  it("chooses files with its own button, in the interface's words, never the browser's file button", async () => {
    const user = userEvent.setup();
    render(<Check runner={inThreadRunner()} />);
    for (const side of ["source", "destination"]) {
      const input = screen.getByTestId(`${side}-file`) as HTMLInputElement;
      // The browser draws its file button in the system's language; the input is hidden and out of the tab order.
      expect(input.className).toContain("sr-only");
      expect(input.tabIndex).toBe(-1);
      const button = screen.getByTestId(`${side}-choose-file`);
      expect(button.textContent).toBe("Choose a file");
      const opened = vi.fn();
      input.addEventListener("click", opened);
      await user.click(button);
      expect(opened).toHaveBeenCalledTimes(1);
    }
    expect(screen.getAllByText("No file chosen, or drop one on this panel")).toHaveLength(2);
    await user.upload(screen.getByTestId("source-file"), new File(["k\n1\n"], "s.csv", { type: "text/csv" }));
    await waitFor(() => expect(screen.getAllByText("No file chosen, or drop one on this panel")).toHaveLength(1));
  });

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

  it("says beside a total and its statement when the last check did not apply the statement, and drops that note on any change", async () => {
    const user = await chooseExample();
    await chooseColumns(user);
    await user.click(screen.getByTestId("source-complete"));
    await user.click(screen.getByTestId("destination-complete"));
    await user.type(screen.getByTestId("source-count"), "4");
    await user.type(screen.getByTestId("destination-count"), "5");
    // Before any check there is nothing to say.
    expect(screen.queryByTestId("destination-count-note")).toBeNull();
    await user.click(screen.getByTestId("run-check"));
    await screen.findByRole("region", { name: "Result" }, { timeout: 5000 });
    // The checkbox stays ticked, so the note says the check did not apply it; the matching source total says nothing.
    expect((screen.getByTestId("destination-complete") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId("destination-complete-note").textContent).toBe("Not applied in the last check: the total you entered (5) differs from the row count of the export (4).");
    expect(screen.getByTestId("destination-count-note").textContent).toBe("Not applied in the last check: this total differs from the row count of the export (4), so the destination statement was withdrawn.");
    expect(screen.queryByTestId("source-complete-note")).toBeNull();
    expect(screen.queryByTestId("source-count-note")).toBeNull();
    // Read by a screen reader with the field it is about.
    const described = screen.getByTestId("destination-count").getAttribute("aria-describedby")!.split(" ");
    expect(described).toContain(screen.getByTestId("destination-count-note").id);
    // Any change removes the result, and the note with it.
    await user.type(screen.getByTestId("destination-count"), "0");
    expect(screen.queryByTestId("destination-count-note")).toBeNull();
    expect(screen.queryByTestId("destination-complete-note")).toBeNull();
  });

  it("notes a total that differs even without the statement, and says nothing was withdrawn", async () => {
    const user = await chooseExample();
    await chooseColumns(user);
    await user.type(screen.getByTestId("source-count"), "7");
    await user.click(screen.getByTestId("run-check"));
    await screen.findByRole("region", { name: "Result" }, { timeout: 5000 });
    expect(screen.getByTestId("source-count-note").textContent).toBe("In the last check, this total differed from the row count of the file (4).");
    expect(screen.queryByTestId("source-complete-note")).toBeNull();
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
    // No hint is written for this refusal, so none is shown.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByTestId("refusal-hint")).toBeNull();
  });

  it("suggests an encoding under a refused header, and changes nothing itself", async () => {
    const user = userEvent.setup();
    render(<Check runner={inThreadRunner()} />);
    await user.upload(screen.getByTestId("source-file"), new File([readFileSync(join(REPO_ROOT, "offline/golden/decode-wrong-encoding/source.csv"))], "source.csv"));
    const hint = await screen.findByTestId("refusal-hint", {}, { timeout: 5000 });
    expect(hint.getAttribute("data-hint")).toBe("gb18030");
    expect(hint.textContent).toContain("If the file is GB18030, choose GB18030 as its encoding.");
    expect(hint.textContent).toContain("A suggestion only: nothing was changed, and the check was not tried again.");
    // The refusal is the command line's, and the encoding is still the one chosen.
    expect(screen.getByText("source.csv: not UTF-8")).toBeTruthy();
    expect((screen.getByTestId("source-encoding") as HTMLSelectElement).value).toBe("utf-8");
  });

  it("says how many fields a refused line has, under the refusal, and runs nothing again", async () => {
    const inner = inThreadRunner();
    let runs = 0;
    const runner: CheckRunner = { ...inner, run: (input, progress) => (runs++, inner.run(input, progress)) };
    const user = userEvent.setup();
    render(<Check runner={runner} />);
    await user.upload(screen.getByTestId("source-file"), new File(["k,p\n1,2\n3,4,5\n"], "s.csv"));
    await user.upload(screen.getByTestId("destination-file"), new File(["k,p\n1,2\n"], "d.csv"));
    await waitFor(() => expect(screen.getAllByText("2 columns")).toHaveLength(2));
    await user.selectOptions(screen.getByTestId("key-source"), "k");
    await user.selectOptions(screen.getByTestId("key-destination"), "k");
    await user.selectOptions(screen.getByTestId("field-0-source"), "p");
    await user.selectOptions(screen.getByTestId("field-0-destination"), "p");
    // The profile says so before any check, with the same message and the same hint.
    expect((await screen.findByTestId("source-profile-refused")).textContent).toContain("s.csv: line 3 does not match the header");
    await waitFor(() => expect(screen.getAllByTestId("refusal-hint")).toHaveLength(1));
    await user.click(screen.getByTestId("run-check"));
    expect((await screen.findByTestId("refusal", {}, { timeout: 5000 })).textContent).toContain("refused: s.csv: line 3 does not match the header");
    await waitFor(() => expect(screen.getAllByTestId("refusal-hint")).toHaveLength(2));
    for (const hint of screen.getAllByTestId("refusal-hint")) {
      expect(hint.getAttribute("data-hint")).toBe("line-fields");
      expect(hint.textContent).toContain("Line 3 has 3 fields; the header has 2.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(runs).toBe(1);
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

  it("fills in a scenario's files and configuration, states nothing, and gives the result its golden case gives", async () => {
    const user = userEvent.setup();
    render(<Check runner={inThreadRunner()} />);
    const card = screen.getByTestId("scenarios").querySelector('[data-scenario="orders-rules"]') as HTMLElement;
    // What to expect, with which premises, is written on the card.
    expect(within(card).getByText("With both statements made")).toBeTruthy();
    expect(within(card).getByText("With no statement made")).toBeTruthy();
    await user.click(screen.getByTestId("scenario-orders-rules"));
    await waitFor(() => expect(screen.getAllByText("3 columns")).toHaveLength(2));
    expect((screen.getByTestId("key-source") as HTMLSelectElement).value).toBe("order_id");
    expect((screen.getByTestId("field-0-rule") as HTMLSelectElement).value).toBe("casefold");
    expect((screen.getByTestId("field-1-rule") as HTMLSelectElement).value).toBe("trim");
    for (const id of ["source-complete", "destination-complete", "allow-identical"]) expect((screen.getByTestId(id) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("source-count") as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("scenario-status").textContent).toContain("nothing is stated");
    await user.click(screen.getByTestId("run-check"));
    let result = await screen.findByRole("region", { name: "Result" }, { timeout: 5000 });
    expect(result.getAttribute("data-result")).toBe("Unverified");
    expect(within(result).getByTestId("summary").textContent).toBe(golden("scenario-orders-rules-no-statements", "stdout.txt"));
    await user.click(screen.getByTestId("source-complete"));
    await user.click(screen.getByTestId("destination-complete"));
    await user.click(screen.getByTestId("run-check"));
    result = await screen.findByRole("region", { name: "Result" }, { timeout: 5000 });
    expect(result.getAttribute("data-result")).toBe("Verified");
    expect(within(result).getByTestId("summary").textContent).toBe(golden("scenario-orders-rules-both-statements", "stdout.txt"));
    await user.click(screen.getByTestId("download-json"));
    expect(anyTime(await saved[0]!.blob.text())).toBe(anyTime(asBrowser(golden("scenario-orders-rules-both-statements", "report.json"))));
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

describe("the file profile and the lines before a check", () => {
  const drop = (side: string, files: File[]) =>
    fireEvent.drop(screen.getByTestId(`${side}-panel`), { dataTransfer: { files, types: ["Files"] } });

  it("takes a dropped file, profiles it, and takes none when more than one is dropped", async () => {
    render(<Check runner={inThreadRunner()} />);
    fireEvent.dragOver(screen.getByTestId("source-panel"), { dataTransfer: { types: ["Files"], dropEffect: "none" } });
    expect(screen.getByTestId("source-drop-here")).toBeTruthy();
    drop("source", [example("source.csv"), example("destination.csv")]);
    expect(screen.getByTestId("source-drop-note").textContent).toBe("Drop one file: none was taken.");
    expect(screen.queryByTestId("source-drop-here")).toBeNull();
    drop("source", [example("source.csv")]);
    const profile = await screen.findByTestId("source-profile", {}, { timeout: 5000 });
    expect(screen.queryByTestId("source-drop-note")).toBeNull();
    // offline/examples/source.csv: four records, three columns, UTF-8 without a byte order mark, LF.
    expect(profile.getAttribute("data-rows")).toBe("4");
    expect(profile.textContent).toContain("Data rows4");
    expect(profile.textContent).toContain("no byte order mark");
    expect(within(profile).getByText("LF")).toBeTruthy();
    expect(profile.textContent).toContain(`${readFileSync(join(REPO_ROOT, "offline/examples/source.csv")).length} bytes`);
    expect(screen.getByTestId("source-profile-part").textContent).toContain("read from the file, before any check");
  });

  it("issue #2: says before the check that a stated total will not be applied, then the check does what it said", async () => {
    const user = await chooseExample();
    await chooseColumns(user);
    await screen.findByTestId("destination-profile", {}, { timeout: 5000 });
    const countLine = () => document.querySelector('[data-warning="destination-count"]');
    expect(countLine()).toBeNull();
    await user.click(screen.getByTestId("destination-complete"));
    await user.type(screen.getByTestId("destination-count"), "5");
    await waitFor(() => expect(countLine()?.textContent).toBe("—If you check now, the destination statement will not be applied: the export has 4 rows, not 5."));
    // It changes no choice.
    expect((screen.getByTestId("destination-complete") as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByTestId("run-check"));
    const result = await screen.findByRole("region", { name: "Result" }, { timeout: 5000 });
    expect(within(result).getByText("Destination count stated 5, file has 4 rows: absence and uniqueness stay unknown.")).toBeTruthy();
    // A total that matches says nothing.
    await user.clear(screen.getByTestId("destination-count"));
    await user.type(screen.getByTestId("destination-count"), "4");
    await waitFor(() => expect(countLine()).toBeNull());
  });

  it("names a key column with empty and repeated keys, from the key profile", async () => {
    const user = userEvent.setup();
    render(<Check runner={inThreadRunner()} />);
    await user.upload(screen.getByTestId("source-file"), new File(["k,p\n1,a\n,b\n1,c\n \t,d\n"], "s.csv"));
    await user.upload(screen.getByTestId("destination-file"), new File(["k,p\n1,a\n1,b\n,c\n"], "d.csv"));
    await waitFor(() => expect(screen.getAllByText("2 columns")).toHaveLength(2));
    await user.selectOptions(screen.getByTestId("key-source"), "k");
    await user.selectOptions(screen.getByTestId("key-destination"), "k");
    await waitFor(() => expect(within(screen.getByTestId("before-check")).getAllByRole("listitem")).toHaveLength(4), { timeout: 5000 });
    expect(within(screen.getByTestId("before-check")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "—If you check now, the batch cannot be Verified: 2 source rows have no key in this column: k",
      "—If you check now, the batch cannot be Verified: 1 key appears in more than one source row in this column: k",
      "—If you check now, absence and uniqueness will stay unknown: 1 destination row has no key in this column: k",
      "—If you check now, no source record with this key can be Verified: 1 key appears in more than one destination row in this column: k",
    ]);
  });

  it("is in Chinese, apart from values and technical names", async () => {
    const user = await chooseExample();
    await chooseColumns(user);
    await screen.findByTestId("destination-profile", {}, { timeout: 5000 });
    await user.click(screen.getByTestId("destination-complete"));
    await user.type(screen.getByTestId("destination-count"), "5");
    await screen.findByTestId("before-check");
    for (const d of document.querySelectorAll("details")) d.open = true;
    const stop = startLocalizer(document.body);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const ALLOWED = /^(FlowAssert|CSV|JSON|UTF-8|UTF-16|GB18030|LF|CRLF|CR|KiB|MiB|exact|trim|casefold|digits|date|strptime|flowassert-verify|source\.csv|destination\.csv)$/;
    const left: string[] = [];
    for (const id of ["source-profile-part", "destination-profile-part", "before-check"]) {
      const walker = document.createTreeWalker(screen.getByTestId(id), NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (node.parentElement?.closest("code, [data-no-translate]")) continue;
        for (const word of node.nodeValue!.match(/[A-Za-z][\w.-]*/g) ?? []) if (!ALLOWED.test(word)) left.push(`${word} in “${node.nodeValue!.trim()}”`);
      }
    }
    stop();
    expect(left).toEqual([]);
  });
});
